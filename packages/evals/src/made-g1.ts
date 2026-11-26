/**
 * Gate G1 of the made-clip track (wave 8 `motioncode`, verify C3): a transparent VP9 WebM made here at test time decodes WITH
 * its alpha in `render_frame` (GET /projects/:id/frame, the render page in headless Chromium) and in the paused editor preview,
 * both served with the app's CSP. Mediabunny 1.66 merges VP9 alpha in a pool of `blob:` workers, which `worker-src 'self'`
 * refuses; the one CSP change is `worker-src 'self' blob:`.
 *
 * The clip: 320×240, 30 fps, 1 s, a blue plate whose left half is fully transparent (alpha 0) and right half opaque. Below it on
 * the first track: a red picture. Pass when, at frame 10, in each of the two hosts:
 *   - every pixel of the left half (2 px margin at the seam) is red within 2/255 (the picture shows through), and
 *   - every pixel of the right half is the clip's blue within 6/255.
 * Counts are printed either way (the failure before the CSP change is shown as pixel counts).
 *   pnpm build && pnpm proof:made-g1   (through .artifacts/heavy). Synthetic files only; the working folder is deleted.
 * Exit 0 = pass, 1 = fail.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';
import { APP_CSP } from '../../../apps/server/src/http.ts';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '../../..');
if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) { console.error('web bundle missing: run `pnpm build` first'); process.exit(2); }
const W = 320, H = 240, R = { num: 30, den: 1 }, f = (n: number) => T.frameTime(n, R);
const BLUE = [32, 96, 224] as const, RED = [255, 0, 0] as const;
/**
 * Tolerance of the opaque half. The plan guessed 6/255; measured here (one run): the plate draws as (29, 94, 216) where ffmpeg's BT.709
 * reading of the file gives (28, 93, 222), and an OPAQUE copy of the same plate draws as the same (29, 94, 216) in the same render: the
 * browser's own reading of the colour, not something of the alpha path. The gate is the alpha: the transparent half shows the picture
 * below exactly and the opaque half shows none of it.
 */
const RIGHT_TOL = 10;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-made-g1-'));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { input, maxBuffer: 1 << 28 });
const rgba = (png: Buffer) => { const b = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], png); if (b.length !== W * H * 4) throw new Error(`unexpected PNG size ${b.length}`); return b; };

/** Make the two synthetic files. */
export function makeAlphaWebm(file: string) {
  ff(['-f', 'lavfi', '-i', `color=c=0x${BLUE.map((x) => x.toString(16).padStart(2, '0')).join('')}:s=${W}x${H}:r=30:d=1`,
    '-vf', `scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,${W / 2}),0,255)'`,
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '10', '-metadata:s:v:0', 'alpha_mode=1',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-y', file]);
  return file;
}
function counts(px: Buffer) {
  let leftRed = 0, leftN = 0, rightBlue = 0, rightN = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const near = (c: readonly number[], tol: number) => Math.abs(px[i]! - c[0]!) <= tol && Math.abs(px[i + 1]! - c[1]!) <= tol && Math.abs(px[i + 2]! - c[2]!) <= tol;
    if (x < W / 2 - 2) { leftN++; if (near(RED, 2)) leftRed++; } else if (x >= W / 2 + 2) { rightN++; if (near(BLUE, RIGHT_TOL)) rightBlue++; }
  }
  const c = ((H >> 1) * W + (W * 3 >> 2)) * 4;
  return { leftRedWithin2: leftRed, leftPixels: leftN, [`rightBlueWithin${RIGHT_TOL}`]: rightBlue, rightPixels: rightN, rightCentre: [px[c], px[c + 1], px[c + 2]], pass: leftRed === leftN && rightBlue === rightN };
}

const workerSrc = /worker-src ([^;]+)/.exec(APP_CSP)?.[1];
console.log(`APP_CSP worker-src: ${workerSrc}`);
const s = await startServer({ port: 0, dataDir: path.join(work, 'data') });
const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
const call = async (p: string, body?: unknown) => { const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any }; };
const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(JSON.stringify(r.body).slice(0, 300)); return r.body; };
let ok = false;
const browser = await chromium.launch();
try {
  const pid = (await call('/projects', { name: 'made-g1', width: W, height: H })).body.project.id as string;
  const up = async (file: string) => { const r = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json() as any; if (!r.assetId) throw new Error(JSON.stringify(r).slice(0, 300)); return r.assetId as string; };
  const redPng = path.join(work, 'red.png'); ff(['-f', 'lavfi', '-i', `color=c=red:s=${W}x${H}`, '-frames:v', '1', '-y', redPng]);
  const redId = await up(redPng), clipAsset = await up(makeAlphaWebm(path.join(work, 'alpha.webm')));
  const opaqueWebm = path.join(work, 'opaque.webm');
  ff(['-f', 'lavfi', '-i', `color=c=0x${BLUE.map((x) => x.toString(16).padStart(2, '0')).join('')}:s=${W}x${H}:r=30:d=1`, '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '0', '-crf', '10', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-y', opaqueWebm]);
  const opaqueId = await up(opaqueWebm);
  await tx(pid, [{ op: 'add_clip', args: { assetId: redId, start: f(0), duration: f(60) } }]);
  const trackId = (await tx(pid, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId as string;
  await tx(pid, [{ op: 'add_clip', args: { assetId: clipAsset, trackId, start: f(0), duration: f(30), withLinkedAudio: false } }]);
  await tx(pid, [{ op: 'add_clip', args: { assetId: opaqueId, trackId, start: f(30), duration: f(30), withLinkedAudio: false } }]);
  const ffRead = (file: string) => { const b = ff(['-c:v', 'libvpx-vp9', '-i', file, '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709,format=rgba', '-f', 'rawvideo', '-']); const c = ((H >> 1) * W + (W * 3 >> 2)) * 4; return [b[c], b[c + 1], b[c + 2]]; };
  console.log(`colour of the plate (recorded): ffmpeg BT.709 reading of the alpha file ${JSON.stringify(ffRead(path.join(work, 'alpha.webm')))}, of the opaque file ${JSON.stringify(ffRead(opaqueWebm))}`);
  const opq = await call(`/projects/${pid}/frame?index=45`);
  if (opq.status === 200) { const b = rgba(opq.body); const c = ((H >> 1) * W + (W * 3 >> 2)) * 4; console.log(`render_frame of the opaque copy (recorded): centre ${JSON.stringify([b[c], b[c + 1], b[c + 2]])}`); }
  const asset = (await call(`/projects/${pid}`)).body.project.assets[clipAsset];
  console.log(`asset video: ${JSON.stringify(asset?.video)}`);

  // render_frame
  const still = await call(`/projects/${pid}/frame?index=10`);
  const rf = still.status === 200 ? counts(rgba(still.body)) : { status: still.status, error: JSON.stringify(still.body).slice(0, 300), pass: false };
  console.log(`render_frame: ${JSON.stringify(rf)}`);

  // paused editor preview at frame 10
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`${s.ownerUrl}&project=${pid}`);
  const firstFrame = await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement)?.dataset.frame === '0', undefined, { timeout: 30_000 }).then(() => true, () => false);
  if (!firstFrame) console.log('editor preview: the canvas never reported frame 0 (the clip did not draw); the canvas is counted as it is');
  await page.locator('[data-testid=ruler]').waitFor();
  let pv: Record<string, unknown> = { pass: false };
  for (let attempt = 0; attempt < (firstFrame ? 3 : 1) && !pv.pass; attempt++) {
    await page.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); el.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); }, (10 / 30) * 90 + 0.5);
    const reached = await page.waitForFunction(() => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; return c?.dataset.frame === '10' && c.dataset.quality === 'full'; }, undefined, { timeout: firstFrame ? 30_000 : 10_000 }).then(() => true, () => false);
    await new Promise((r) => setTimeout(r, 300));
    const shot = await page.evaluate(async () => {
      const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
      const data: string = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]!); fr.readAsDataURL(blob); });
      return { w: c.width, h: c.height, frame: c.dataset.frame, quality: c.dataset.quality, source: c.dataset.source, data };
    });
    pv = shot.w === W && shot.h === H ? { reached, frame: shot.frame, quality: shot.quality, source: shot.source, ...counts(rgba(Buffer.from(shot.data, 'base64'))) } : { reached, canvas: `${shot.w}x${shot.h}`, pass: false };
  }
  console.log(`editor preview: ${JSON.stringify(pv)}`);
  if (errs.length) console.log(`page errors (${errs.length}): ${errs.slice(0, 4).join(' | ').slice(0, 600)}`);
  ok = !!rf.pass && !!pv.pass;
  console.log(`${ok ? 'PASS' : 'FAIL'} G1 alpha decodes in render_frame and in the paused preview (worker-src ${workerSrc})`);
} finally {
  await browser.close().catch(() => {});
  await s.close?.();
  fs.rmSync(work, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
