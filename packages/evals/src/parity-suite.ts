/**
 * Render parity suite (SPEC §8 measured tolerances, Appendix C3).
 *   Test 1: raw preview canvas vs raw headless compositor still (same compositor, two hosts): channel error <= 2/255 for >= 99.9% of samples.
 *   Test 2: headless compositor still vs decoded lossy export: SSIM >= 0.985, PSNR >= 36 dB, plus regional, colour and temporal checks.
 * Real server, real Chromium, real ffmpeg. Requires apps/web/dist to be built.   pnpm conformance:parity
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { evaluate } from '@pulseframe/engine';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/parity');
const W = 640, H = 360, FRAMES = 150;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, input });
const decodePng = (png: Buffer) => { const b = ff(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], png); if (b.length !== W * H * 4) throw new Error(`unexpected PNG size ${b.length}`); return b; };
const rgbaToRgb = (b: Buffer) => { const o = Buffer.alloc(W * H * 3); for (let i = 0, j = 0; i < W * H; i++) { o[j++] = b[i * 4]!; o[j++] = b[i * 4 + 1]!; o[j++] = b[i * 4 + 2]!; } return o; };

// ---------- thresholds ----------
const TH = { previewWithin2: 0.999, previewTol: 2, outlier: 16, ssim: 0.985, psnr: 36, regionalPsnrFail: 30, regionalPsnrWarn: 33, colourTol: 6, displacementTolPx: 1 };

// ---------- layout (known from the scene) ----------
type Rect = { x0: number; y0: number; x1: number; y1: number };
const REGIONS = {
  largeText: { x0: 20, y0: 160, x1: 620, y1: 270 } as Rect, // y=+0.1 -> centre 216; ~43 px font, rotation <= 4 deg, box
  smallText: { x0: 0, y0: 318, x1: 640, y1: 356 } as Rect, // y=+0.42 -> centre 331; 14.4 px font
  textBox: { x0: 17, y0: 272, x1: 60, y1: 304 } as Rect, // third clip: whitespace-only text with background box, centre (38,288)
  imageBand: 'annulus radius 75..120 px about the image centre (alpha edge is at ~97 px), centre follows the evaluated x keyframes, y = 126',
};
const IMG_Y = 180 + -0.15 * H;
const BOX_C = { x: 320 + -0.44 * W, y: 180 + 0.3 * H };
const inRect = (r: Rect, x: number, y: number) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
const maskOf = (fn: (x: number, y: number) => boolean) => { const m = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = fn(x, y) ? 1 : 0; return m; };
const annulus = (cx: number) => maskOf((x, y) => { const d = Math.hypot(x + 0.5 - cx, y + 0.5 - IMG_Y); return d >= 75 && d <= 120; });
const rectMask = (r: Rect) => maskOf((x, y) => inRect(r, x, y));

// ---------- stats ----------
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const summ = (xs: number[]) => ({ min: Math.min(...xs), median: median(xs), max: Math.max(...xs) });
const r4 = (x: number) => (Number.isFinite(x) ? +x.toFixed(4) : x);

function cmpRgb(a: Buffer, b: Buffer, mask?: Uint8Array) {
  let n = 0, within = 0, max = 0, outliers = 0;
  for (let p = 0; p < W * H; p++) {
    if (mask && !mask[p]) continue;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[p * 4 + c]! - b[p * 4 + c]!); n++; if (d <= TH.previewTol) within++; if (d > max) max = d; if (d > TH.outlier) outliers++; }
  }
  return { samples: n, fractionWithin2: n ? within / n : 1, maxDiff: max, outliers };
}
function psnrRgb(a: Buffer, b: Buffer, stride: number, mask?: Uint8Array) {
  let se = 0, n = 0;
  for (let p = 0; p < W * H; p++) { if (mask && !mask[p]) continue; for (let c = 0; c < 3; c++) { const d = a[p * stride + c]! - b[p * stride + c]!; se += d * d; n++; } }
  const mse = se / Math.max(1, n);
  return mse === 0 ? 99 : Math.min(99, 10 * Math.log10((255 * 255) / mse));
}
const luma = (b: Buffer) => { const y = new Float32Array(W * H); for (let p = 0; p < W * H; p++) y[p] = 0.2126 * b[p * 3]! + 0.7152 * b[p * 3 + 1]! + 0.0722 * b[p * 3 + 2]!; return y; };
/** Mean SSIM over 8x8 uniform windows, stride 4, BT.709 luma, L=255, k1=0.01, k2=0.03. */
function ssim(a: Buffer, b: Buffer) {
  const ya = luma(a), yb = luma(b), C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let sum = 0, n = 0;
  for (let y0 = 0; y0 + 8 <= H; y0 += 4)
    for (let x0 = 0; x0 + 8 <= W; x0 += 4) {
      let ma = 0, mb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) { const va = ya[y * W + x]!, vb = yb[y * W + x]!; ma += va; mb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; }
      ma /= 64; mb /= 64;
      const va = saa / 64 - ma * ma, vb = sbb / 64 - mb * mb, cv = sab / 64 - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
    }
  return sum / n;
}
function meanRgb(b: Buffer, stride: number, cx: number, cy: number, r: number) {
  const m = [0, 0, 0]; let n = 0;
  for (let y = Math.round(cy) - r; y <= Math.round(cy) + r; y++) for (let x = Math.round(cx) - r; x <= Math.round(cx) + r; x++) { for (let c = 0; c < 3; c++) m[c]! += b[(y * W + x) * stride + c]!; n++; }
  return m.map((v) => v / n);
}
/** Centroid x of "strongly red" pixels near the expected centre. */
function redCentroid(b: Buffer, stride: number, cx: number) {
  let sx = 0, n = 0;
  for (let y = Math.max(0, Math.round(IMG_Y) - 70); y < Math.min(H, Math.round(IMG_Y) + 70); y++)
    for (let x = Math.max(0, Math.round(cx) - 70); x < Math.min(W, Math.round(cx) + 70); x++) {
      const o = (y * W + x) * stride;
      if (b[o]! - Math.max(b[o + 1]!, b[o + 2]!) > 120) { sx += x + 0.5; n++; }
    }
  return n > 50 ? sx / n : NaN;
}
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// frames: first, around each keyframe (image start 20, text opacity key 25, rotation keys 50/90/130, image end 139), image crossing text, last
const BASE_FRAMES = [0, 9, 10, 11, 19, 20, 21, 24, 25, 26, 49, 50, 51, 79, 80, 81, 89, 90, 91, 100, 129, 130, 131, 139, 140, 149];
const rand = rng(20260101);
const randomFrames = (n: number, avoid: Set<number>) => { const out: number[] = []; while (out.length < n) { const v = Math.floor(rand() * FRAMES); if (!avoid.has(v)) { avoid.add(v); out.push(v); } } return out; };
const T1_FRAMES = (() => { const s = new Set(BASE_FRAMES); return [...BASE_FRAMES, ...randomFrames(4, s)]; })();
const TEMPORAL = Array.from({ length: 11 }, (_, i) => 60 + i); // 10 consecutive pairs inside the position animation
const T2_FRAMES = (() => { const s = new Set([...T1_FRAMES, ...TEMPORAL]); return [...new Set([...T1_FRAMES, ...TEMPORAL])].concat(randomFrames(6, s)).sort((a, b) => a - b); })();

async function main() {
  const t0 = Date.now();
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: apps/web/dist must be built');
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'barcode_640x360_30fps_5s.mp4'), frames: FRAMES });
  ff(['-y', '-f', 'lavfi', '-i', "color=c=red:s=200x200,format=rgba,geq=r='255':g='40':b='40':a='if(lt(max(abs(X-100),abs(Y-100)),30),255,if(lt(hypot(X-100,Y-100),90),255*(1-hypot(X-100,Y-100)/90),0))'", '-frames:v', '1', path.join(art, 'alpha.png')]);
  const alphaPng = fs.readFileSync(path.join(art, 'alpha.png'));

  const s = await startServer({ port: 8794, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const upload = async (pid: string, name: string, data: Buffer) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': name }, body: new Uint8Array(data) })).json()) as any;
  const waitDerivatives = async (pid: string, assetId: string) => { for (let i = 0; i < 300; i++) { const d = (await call(`/projects/${pid}/assets/${assetId}/derivatives`)).body.derivatives as any[]; if (d.every((x) => x.status !== 'queued' && x.status !== 'running')) return d; await sleep(100); } throw new Error('derivatives did not settle'); };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200 && r.status !== 201) throw new Error(`transaction failed ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

  /** Build the scene. withVideo=false gives the variant over the solid project background. */
  async function build(name: string, withVideo: boolean) {
    const pid = (await call('/projects', { name, width: W, height: H })).body.project.id as string;
    const img = await upload(pid, 'alpha.png', alphaPng);
    let vid: any = null;
    if (withVideo) { vid = await upload(pid, 'barcode.mp4', fs.readFileSync(fixture.file)); await tx(pid, [{ op: 'add_clip', args: { assetId: vid.assetId, start: f(0) } }]); }
    const r1 = await tx(pid, [{ op: 'add_clip', args: { assetId: img.assetId, start: f(20), duration: f(120) } }]);
    const imgClip = r1.results[0].output.clipId as string;
    const r2 = await tx(pid, [
      { op: 'add_text', args: { text: 'שָׁלוֹם PULSEFRAME 2026', start: f(10), duration: f(140), style: { sizeFrac: 0.12, stroke: '#000000', strokeFrac: 0.06, background: '#101418CC' }, transform: { y: 0.1 } } },
      { op: 'add_text', args: { text: 'Thin strokes over moving picture: 0123456789 עברית', start: f(10), duration: f(140), style: { sizeFrac: 0.04, color: '#FFFFFF', stroke: '#000000', strokeFrac: 0.04, fontWeight: 400 }, transform: { y: 0.42 } } },
      { op: 'add_text', args: { text: '      ', start: f(10), duration: f(140), style: { sizeFrac: 0.06, background: '#101418CC' }, transform: { x: -0.44, y: 0.3 } } },
    ]);
    const [big, small, box] = r2.results.map((x: any) => x.output.clipId as string);
    await tx(pid, [
      { op: 'set_clip_transform', args: { clipId: imgClip, transform: { scale: 0.6, rotation: 20, opacity: 0.8, y: -0.15 } } },
      { op: 'set_keyframe', args: { clipId: imgClip, property: 'x', time: f(0), value: -0.3, easing: 'ease-in-out' } },
      { op: 'set_keyframe', args: { clipId: imgClip, property: 'x', time: f(120), value: 0.3, easing: 'ease-in-out' } },
      { op: 'set_keyframe', args: { clipId: big, property: 'opacity', time: f(0), value: 0, easing: 'linear' } },
      { op: 'set_keyframe', args: { clipId: big, property: 'opacity', time: f(15), value: 1, easing: 'linear' } },
      ...[[0, 0], [40, 4], [80, -4], [120, 0]].map(([t, v]) => ({ op: 'set_keyframe', args: { clipId: big, property: 'rotation', time: f(t!), value: v, easing: 'ease-in-out' } })),
    ]);
    if (vid) await waitDerivatives(pid, vid.assetId);
    await waitDerivatives(pid, img.assetId);
    const doc = (await call(`/projects/${pid}`)).body.project;
    return { pid, doc, big, small, box, imgAsset: img.assetId as string };
  }
  const still = async (pid: string, n: number) => { const r = await call(`/projects/${pid}/frame?index=${n}`); if (r.status !== 200) throw new Error(`frame ${n}: ${r.status}`); return r.body as Buffer; };
  const imageCx = (doc: any, n: number) => { const l = evaluate(doc, f(n)).layers.find((x: any) => x.kind === 'image') as any; return l ? 320 + l.transform.x * W : null; };

  const browser = await chromium.launch();
  const warnings: string[] = [];
  const failures: string[] = [];
  const report: any = { suite: 'render-parity', specRef: 'SPEC §8 measured pixel/perceptual tolerances; Appendix C3 render parity' };

  try {
    // ================= Test 1 =================
    async function previewTest(label: string, scene: Awaited<ReturnType<typeof build>>, strict: boolean) {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
      const errs: string[] = [];
      page.on('pageerror', (e) => errs.push(String(e)));
      await page.goto(`${s.url}/?project=${scene.pid}`);
      await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement)?.dataset.frame === '0');
      await page.locator('[data-testid=ruler]').waitFor();
      const rows: any[] = [];
      const sources = new Set<string>();
      const bandCache = new Map<number, Uint8Array>();
      const rText = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) rText[i] = 0;
      const textMask = maskOf((x, y) => inRect(REGIONS.largeText, x, y) || inRect(REGIONS.smallText, x, y) || inRect(REGIONS.textBox, x, y));
      void rText;
      for (const n of T1_FRAMES) {
        const ref = decodePng(await still(scene.pid, n));
        await page.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); }, (n / 30) * 90 + 0.5);
        await page.waitForFunction((fr) => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; return c?.dataset.frame === String(fr) && c.dataset.quality === 'full'; }, n, { timeout: 30_000 });
        await sleep(50);
        const shot = await page.evaluate(async () => {
          const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
          const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
          const data: string = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]!); fr.readAsDataURL(blob); });
          return { w: c.width, h: c.height, quality: c.dataset.quality, frame: c.dataset.frame, source: c.dataset.source, data };
        });
        if (shot.w !== W || shot.h !== H || shot.frame !== String(n)) throw new Error(`preview canvas ${shot.w}x${shot.h} frame ${shot.frame}, wanted ${W}x${H} frame ${n}`);
        sources.add(String(shot.source));
        const pv = decodePng(Buffer.from(shot.data, 'base64'));
        const cx = imageCx(scene.doc, n);
        let band: Uint8Array | undefined;
        if (cx !== null) { const k = Math.round(cx * 10); band = bandCache.get(k) ?? annulus(cx); bandCache.set(k, band); }
        const inBand = band;
        const row: any = { frame: n, overall: cmpRgb(ref, pv), text: cmpRgb(ref, pv, textMask), imageBand: inBand ? cmpRgb(ref, pv, inBand) : null };
        // "video-only" region: everything outside text regions and the image band (still contains no video-independent pixels in (i): see notes)
        row.rest = cmpRgb(ref, pv, maskOf((x, y) => textMask[y * W + x] === 0 && !(inBand && inBand[y * W + x])));
        let aMax = 0, aNon255 = 0;
        for (let p = 0; p < W * H; p++) { aMax = Math.max(aMax, Math.abs(ref[p * 4 + 3]! - pv[p * 4 + 3]!)); if (ref[p * 4 + 3] !== 255 || pv[p * 4 + 3] !== 255) aNon255++; }
        row.alpha = { maxDiff: aMax, pixelsNotOpaqueInEither: aNon255 };
        rows.push(row);
        if (rows.length === 1 || n === 80) fs.writeFileSync(path.join(art, `${label}-preview-${n}.png`), Buffer.from(shot.data, 'base64'));
      }
      await page.close();
      const reg = (k: string) => { const xs = rows.filter((r) => r[k]).map((r) => r[k]); return { fractionWithin2: summ(xs.map((x: any) => x.fractionWithin2)), maxDiff: summ(xs.map((x: any) => x.maxDiff)), outliersTotal: xs.reduce((a: number, x: any) => a + x.outliers, 0) }; };
      const summary = { overall: reg('overall'), text: reg('text'), imageBand: reg('imageBand'), rest: reg('rest'), alphaMaxDiff: Math.max(...rows.map((r) => r.alpha.maxDiff)), exactFrames: rows.filter((r) => r.overall.maxDiff === 0).length, previewSources: [...sources], pageErrors: errs };
      if (!(sources.size === 1 && sources.has('original'))) warnings.push(`test1(${label}) canvas data-source was ${[...sources].join(',')}, expected original`);
      const worst = rows.reduce((a, b) => (b.overall.fractionWithin2 < a.overall.fractionWithin2 ? b : a));
      const bad = (k: string) => rows.filter((r) => r[k] && (r[k].fractionWithin2 < TH.previewWithin2 || r[k].outliers > 0)).map((r) => `${r.frame}:${k}`);
      const failing = strict ? [...bad('overall'), ...bad('text'), ...bad('imageBand')] : [];
      if (strict && failing.length) failures.push(`test1(${label}) below 99.9%/outliers: ${failing.slice(0, 12).join(', ')}`);
      return { label, passFail: strict, frames: T1_FRAMES, summary, worstFrame: { frame: worst.frame, overall: worst.overall }, failing, rows };
    }
    console.log('# Test 1: raw preview vs raw headless still');
    const sceneB = await build('parity-novideo', false);
    const t1b = await previewTest('ii-no-video', sceneB, true);
    console.log(`  (ii) no video: overall min within2=${t1b.summary.overall.fractionWithin2.min} maxDiff=${t1b.summary.overall.maxDiff.max} outliers=${t1b.summary.overall.outliersTotal} exact frames=${t1b.summary.exactFrames}/${T1_FRAMES.length}`);
    const sceneA = await build('parity-scene', true);
    const t1a = await previewTest('i-with-video', sceneA, true);
    console.log(`  (i) with video: overall min within2=${t1a.summary.overall.fractionWithin2.min} maxDiff=${t1a.summary.overall.maxDiff.max} outliers=${t1a.summary.overall.outliersTotal} exact frames=${t1a.summary.exactFrames}/${T1_FRAMES.length}`);
    report.test1 = { pass: failures.filter((x) => x.startsWith('test1')).length === 0, thresholds: { fractionWithin2: TH.previewWithin2, tolerance: TH.previewTol, outlierAbove: TH.outlier }, variantNoVideo: t1b, variantWithVideo: t1a };

    // ================= Test 2 =================
    console.log('# Test 2: compositor still vs decoded export');
    const refs = new Map<number, Buffer>();
    for (const n of T2_FRAMES) refs.set(n, decodePng(await still(sceneA.pid, n)));
    const refRgb = new Map<number, Buffer>([...refs].map(([n, b]) => [n, rgbaToRgb(b)]));
    const cxs = new Map<number, number | null>(T2_FRAMES.map((n) => [n, imageCx(sceneA.doc, n)]));
    const textM = { large: rectMask(REGIONS.largeText), small: rectMask(REGIONS.smallText) };
    const bandM = new Map<number, Uint8Array>();
    const bandFor = (n: number) => { const cx = cxs.get(n); if (cx == null) return null; const k = Math.round(cx * 10); const m = bandM.get(k) ?? annulus(cx); bandM.set(k, m); return m; };

    async function exportAndDecode(opts: Record<string, unknown>, file: string) {
      const started = Date.now();
      const acc = await call(`/projects/${sceneA.pid}/exports`, opts);
      if (acc.status !== 202) throw new Error(`export refused ${acc.status} ${JSON.stringify(acc.body)}`);
      let j: any;
      for (;;) { j = (await call(`/jobs/${acc.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) break; await sleep(200); }
      if (j.status !== 'succeeded') throw new Error(`export ${JSON.stringify(opts)} ${j.status}: ${JSON.stringify(j.error)}`);
      const out = path.join(art, file);
      fs.writeFileSync(out, (await call(`/jobs/${acc.body.jobId}/output`)).body);
      const raw = ff(['-i', out, '-vf', 'scale=in_color_matrix=bt709:in_range=limited:out_range=full', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      if (raw.length !== FRAMES * W * H * 3) throw new Error(`decoded ${raw.length / (W * H * 3)} frames, expected ${FRAMES}`);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', out], { encoding: 'utf8' }));
      return { raw, file: out, bytes: fs.statSync(out).size, wallSeconds: (Date.now() - started) / 1000, video: probe.streams.find((x: any) => x.codec_type === 'video') };
    }
    const frameOf = (raw: Buffer, n: number) => raw.subarray(n * W * H * 3, (n + 1) * W * H * 3);
    const global = (raw: Buffer) => T2_FRAMES.map((n) => { const e = frameOf(raw, n), r = refRgb.get(n)!; return { frame: n, psnr: psnrRgb(r, e, 3), ssim: ssim(r, e) }; });

    const high = await exportAndDecode({ format: 'mp4-h264-aac', quality: 'high' }, 'export-high.mp4');
    if (high.video.color_space !== 'bt709') warnings.push(`export colour_space tag is ${high.video.color_space}, expected bt709`);
    const rows: any[] = [];
    const region = (name: string, n: number, e: Buffer, mask: Uint8Array | null | undefined) => {
      if (!mask) return null;
      const r = refs.get(n)!; // rgba, stride 4
      let se = 0, cnt = 0;
      for (let p = 0; p < W * H; p++) { if (!mask[p]) continue; for (let c = 0; c < 3; c++) { const d = r[p * 4 + c]! - e[p * 3 + c]!; se += d * d; cnt++; } }
      void name;
      const mse = se / cnt;
      return mse === 0 ? 99 : Math.min(99, 10 * Math.log10((255 * 255) / mse));
    };
    for (const n of T2_FRAMES) {
      const e = frameOf(high.raw, n), r = refRgb.get(n)!;
      const row: any = { frame: n, psnr: r4(psnrRgb(r, e, 3)), ssim: r4(ssim(r, e)), largeTextPsnr: r4(region('large', n, e, textM.large)!), smallTextPsnr: r4(region('small', n, e, textM.small)!), imageBandPsnr: null as number | null, barcode: readBarcode(e, W, 3, { x: 0, y: 0, w: W, h: H }) };
      const bm = bandFor(n); const bp = region('band', n, e, bm); row.imageBandPsnr = bp === null ? null : r4(bp);
      rows.push(row);
    }
    for (const row of rows) {
      if (row.psnr < TH.psnr || row.ssim < TH.ssim) failures.push(`test2 global frame ${row.frame}: PSNR ${row.psnr} SSIM ${row.ssim}`);
      for (const k of ['largeTextPsnr', 'smallTextPsnr', 'imageBandPsnr'] as const) {
        const v = row[k]; if (v === null) continue;
        if (k === 'smallTextPsnr') { if (v < TH.regionalPsnrWarn) warnings.push(`test2 smallTextPsnr frame ${row.frame}: ${v} dB (14 px text: below the qualified text size for H.264 4:2:0; see textSizeEnvelope)`); continue; }
        if (v < TH.regionalPsnrFail) failures.push(`test2 ${k} frame ${row.frame}: ${v} dB < ${TH.regionalPsnrFail}`);
        else if (v < TH.regionalPsnrWarn) warnings.push(`test2 ${k} frame ${row.frame}: ${v} dB < ${TH.regionalPsnrWarn}`);
      }
      if (row.barcode !== row.frame) failures.push(`test2 barcode: export frame ${row.frame} shows source frame ${row.barcode}`);
    }
    // colour: red square flat core at the image centre; text background box (third clip), frames where both are on screen
    const colour: any[] = [];
    for (const n of T2_FRAMES.filter((x) => x >= 26 && x < 139)) {
      const e = frameOf(high.raw, n), r = refRgb.get(n)!;
      const cx = cxs.get(n)!;
      const sq = { ref: meanRgb(r, 3, cx, IMG_Y, 8), exp: meanRgb(e, 3, cx, IMG_Y, 8) };
      const bx = { ref: meanRgb(r, 3, BOX_C.x, BOX_C.y, 4), exp: meanRgb(e, 3, BOX_C.x, BOX_C.y, 4) };
      const dSq = Math.max(...sq.ref.map((v, c) => Math.abs(v - sq.exp[c]!))), dBx = Math.max(...bx.ref.map((v, c) => Math.abs(v - bx.exp[c]!)));
      colour.push({ frame: n, redSquare: { ref: sq.ref.map(r4), export: sq.exp.map(r4), maxChannelDiff: r4(dSq) }, textBox: { ref: bx.ref.map(r4), export: bx.exp.map(r4), maxChannelDiff: r4(dBx) } });
      if (dSq > TH.colourTol) failures.push(`test2 colour red square frame ${n}: ${r4(dSq)}/255`);
      if (dBx > TH.colourTol) failures.push(`test2 colour text box frame ${n}: ${r4(dBx)}/255`);
    }
    // temporal: image centroid displacement
    const temporal: any[] = [];
    for (let i = 0; i + 1 < TEMPORAL.length; i++) {
      const a = TEMPORAL[i]!, b = TEMPORAL[i + 1]!;
      const dRef = redCentroid(refRgb.get(b)!, 3, cxs.get(b)!) - redCentroid(refRgb.get(a)!, 3, cxs.get(a)!);
      const dExp = redCentroid(frameOf(high.raw, b), 3, cxs.get(b)!) - redCentroid(frameOf(high.raw, a), 3, cxs.get(a)!);
      const dEval = cxs.get(b)! - cxs.get(a)!;
      temporal.push({ pair: [a, b], referenceDx: r4(dRef), exportDx: r4(dExp), evaluatorDx: r4(dEval), absError: r4(Math.abs(dRef - dExp)) });
      if (!(Math.abs(dRef - dExp) <= TH.displacementTolPx)) failures.push(`test2 temporal frames ${a}->${b}: ref dx ${r4(dRef)} export dx ${r4(dExp)}`);
    }
    const sRow = (k: string) => { const xs = rows.map((r) => r[k]).filter((v) => v !== null) as number[]; const worst = rows.filter((r) => r[k] !== null).reduce((a, b) => (b[k] < a[k] ? b : a)); const q = summ(xs); return { min: r4(q.min), median: r4(q.median), max: r4(q.max), worstFrame: worst.frame as number }; };
    const summary = { psnr: sRow('psnr'), ssim: sRow('ssim'), largeTextPsnr: sRow('largeTextPsnr'), smallTextPsnr: sRow('smallTextPsnr'), imageBandPsnr: sRow('imageBandPsnr') };
    console.log(`  high: PSNR min ${summary.psnr.min} (f${summary.psnr.worstFrame}) SSIM min ${summary.ssim.min} (f${summary.ssim.worstFrame}); large text ${summary.largeTextPsnr.min}, small text ${summary.smallTextPsnr.min}, image band ${summary.imageBandPsnr.min}`);

    // worst-frame side-by-sides
    const worstFrames = [...rows].sort((a, b) => a.psnr - b.psnr).slice(0, 3).map((r) => r.frame);
    for (const n of worstFrames) {
      const e = frameOf(high.raw, n), r = refRgb.get(n)!, out = Buffer.alloc(W * 3 * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
        const i = (y * W + x) * 3 + c, o = (y * 3 * W + x) * 3 + c;
        out[o] = r[i]!; out[o + W * 3] = e[i]!; out[o + W * 6] = Math.min(255, Math.abs(r[i]! - e[i]!) * 8);
      }
      ff(['-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${W * 3}x${H}`, '-i', 'pipe:0', '-frames:v', '1', path.join(art, `worst-frame-${n}.png`)], out);
    }

    // quality ladder (report only)
    const ladder: any = { high: { bytes: high.bytes, wallSeconds: high.wallSeconds, psnr: summary.psnr, ssim: summary.ssim } };
    for (const [key, opts, file] of [['mp4-standard', { format: 'mp4-h264-aac', quality: 'standard' }, 'export-standard.mp4'], ['mp4-draft', { format: 'mp4-h264-aac', quality: 'draft' }, 'export-draft.mp4'], ['webm-vp9-standard', { format: 'webm-vp9-opus', quality: 'standard' }, 'export-standard.webm']] as const) {
      const ex = await exportAndDecode(opts as any, file);
      const g = global(ex.raw);
      ladder[key] = { bytes: ex.bytes, wallSeconds: ex.wallSeconds, psnr: Object.fromEntries(Object.entries(summ(g.map((x) => x.psnr))).map(([a, b]) => [a, r4(b)])), ssim: Object.fromEntries(Object.entries(summ(g.map((x) => x.ssim))).map(([a, b]) => [a, r4(b)])) };
      console.log(`  ${key}: PSNR min ${ladder[key].psnr.min} SSIM min ${ladder[key].ssim.min} bytes ${ex.bytes}`);
    }

    // ---- text size envelope (high quality, flash frames included) ----
    console.log('# Text size envelope');
    const LADDER_RANGES: [number, number][] = [[58, 62], [88, 92], [118, 122]];
    const ladderCfgs = [{ w: 640, h: 360, s: 0.04 }, { w: 640, h: 360, s: 0.06 }, { w: 640, h: 360, s: 0.08 }, { w: 1280, h: 720, s: 0.04 }, { w: 1920, h: 1080, s: 0.04 }];
    const fixtures = new Map<number, string>();
    const table: any[] = [];
    for (const c of ladderCfgs) {
      if (!fixtures.has(c.w)) fixtures.set(c.w, (await generateBarcodeFixture({ out: path.join(art, `ladder_${c.w}.mp4`), width: c.w, height: c.h, frames: FRAMES })).file);
      const pid = (await call('/projects', { name: `ladder-${c.w}-${c.s}`, width: c.w, height: c.h })).body.project.id as string;
      const vid = await upload(pid, 'barcode.mp4', fs.readFileSync(fixtures.get(c.w)!));
      await tx(pid, [{ op: 'add_clip', args: { assetId: vid.assetId, start: f(0) } }]);
      await tx(pid, [{ op: 'add_text', args: { text: 'Thin strokes 0123456789', start: f(10), duration: f(140), style: { sizeFrac: c.s, color: '#FFFFFF', stroke: '#000000', strokeFrac: 0.04, fontWeight: 400 }, transform: { y: 0.42 } } }]);
      await waitDerivatives(pid, vid.assetId);
      const cy = c.h / 2 + 0.42 * c.h, half = c.s * c.h * 1.1;
      const y0 = Math.max(0, Math.floor(cy - half)), y1 = Math.min(c.h, Math.ceil(cy + half));
      const dec = (png: Buffer) => ff(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
      const perFrame: { frame: number; psnr: number }[] = [];
      for (const [a, b] of LADDER_RANGES) {
        const acc = await call(`/projects/${pid}/exports`, { format: 'mp4-h264-aac', quality: 'high', range: { startFrame: a, endFrame: b } });
        if (acc.status !== 202) throw new Error(`ladder export refused ${acc.status} ${JSON.stringify(acc.body)}`);
        let j: any; for (;;) { j = (await call(`/jobs/${acc.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) break; await sleep(150); }
        if (j.status !== 'succeeded') throw new Error(`ladder export ${j.status} ${JSON.stringify(j.error)}`);
        const out = path.join(art, 'ladder.mp4'); fs.writeFileSync(out, (await call(`/jobs/${acc.body.jobId}/output`)).body);
        const raw = ff(['-i', out, '-vf', 'scale=in_color_matrix=bt709:in_range=limited:out_range=full', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        const fb = c.w * c.h * 3;
        if (raw.length !== (b - a) * fb) throw new Error('ladder export frame count');
        for (let n = a; n < b; n++) {
          const ref = dec(await still(pid, n)), e = raw.subarray((n - a) * fb, (n - a + 1) * fb);
          let se = 0, cnt = 0;
          for (let y = y0; y < y1; y++) for (let x = 0; x < c.w * 3; x++) { const d = ref[y * c.w * 3 + x]! - e[y * c.w * 3 + x]!; se += d * d; cnt++; }
          perFrame.push({ frame: n, psnr: r4(se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / cnt))) });
        }
      }
      const worst = perFrame.reduce((x, y) => (y.psnr < x.psnr ? y : x));
      const flash = perFrame.filter((x) => x.frame % 30 < 2), non = perFrame.filter((x) => x.frame % 30 >= 2);
      table.push({ project: `${c.w}x${c.h}`, sizeFrac: c.s, textHeightPx: r4(c.s * c.h), region: { y0, y1 }, minRegionalPsnrDb: worst.psnr, worstFrame: worst.frame, minFlashFramesDb: Math.min(...flash.map((x) => x.psnr)), minNonFlashFramesDb: Math.min(...non.map((x) => x.psnr)), frames: perFrame.map((x) => x.frame), meetsThreshold: worst.psnr >= TH.regionalPsnrFail });
      console.log(`  ${c.w}x${c.h} sizeFrac ${c.s} (${r4(c.s * c.h)} px): min ${worst.psnr} dB @f${worst.frame}, flash min ${r4(Math.min(...flash.map((x) => x.psnr)))}`);
    }
    table.sort((a, b) => a.textHeightPx - b.textHeightPx);
    const okFrom = table.find((r) => table.filter((q) => q.textHeightPx >= r.textHeightPx).every((q) => q.meetsThreshold));
    const textSizeEnvelope = {
      thresholdDb: TH.regionalPsnrFail, quality: 'high', frames: 'flash frames 60,61,90,91,120,121 and neighbours 58,59,88,89,118,119',
      table,
      statement: okFrom ? `Text at or above ${okFrom.textHeightPx} px rendered height keeps >= ${TH.regionalPsnrFail} dB regionally at quality high (all tested sizes >= that height passed; the smallest failing tested height is ${table.filter((r) => !r.meetsThreshold).map((r) => r.textHeightPx).at(-1) ?? 'none'} px).` : `No tested text size reached ${TH.regionalPsnrFail} dB on every tested frame at quality high.`,
      criterionMetAtPx: okFrom?.textHeightPx ?? null,
      caveat: 'One synthetic scene (white text with black stroke over saturated flat colour edges incl. a yellow flash band) on one encoder setting (x264 crf per quality high, 4:2:0). Not a general guarantee.',
    };
    if (!okFrom) failures.push('textSizeEnvelope: no tested text size reached 30 dB regionally on all tested frames');
    report.textSizeEnvelope = textSizeEnvelope;
    report.test2 = {
      pass: failures.filter((x) => x.startsWith('test2') || x.startsWith('textSizeEnvelope')).length === 0,
      thresholds: { ssim: TH.ssim, psnrDb: TH.psnr, regionalPsnrFailDb: TH.regionalPsnrFail, regionalPsnrWarnDb: TH.regionalPsnrWarn, colourTolPerChannel: TH.colourTol, displacementTolPx: TH.displacementTolPx },
      method: 'PSNR over all RGB samples; SSIM computed in-process on BT.709 luma, 8x8 uniform window, stride 4, L=255, k1=0.01, k2=0.03; export decoded with ffmpeg scale=in_color_matrix=bt709:in_range=limited to rgb24',
      frames: T2_FRAMES, exportVideoStream: { codec: high.video.codec_name, pix_fmt: high.video.pix_fmt, color_space: high.video.color_space, color_range: high.video.color_range },
      summary, worstFramesSavedAsPng: worstFrames, colour, temporal, qualityLadderReportOnly: ladder, rows,
    };
  } finally {
    await browser.close();
    await s.close();
  }

  report.pass = failures.length === 0;
  report.failures = failures;
  report.warnings = warnings;
  report.machine = { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu: 'none', node: process.version, ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0] };
  report.fixture = { barcode: 'generateBarcodeFixture 640x360 30fps 150 frames H.264 crf14', image: '200x200 RGBA PNG: opaque central 60x60 square inside a radial alpha gradient (radius 90 px)', project: `${W}x${H} @30`, frameRate: '30/1' };
  report.scene = { V1: 'barcode video frames 0..150', V2: 'alpha image frames 20..140, scale 0.6, rotation 20, opacity 0.8, y -0.15, x keyframes -0.3 -> 0.3 ease-in-out', T1: 'Hebrew+niqqud+Latin text frames 10..150 sizeFrac 0.12 stroke, background #101418CC, y 0.1, opacity key 0->1 over 15 frames, rotation keys 0/4/-4/0 at +0/40/80/120', T2: 'small text sizeFrac 0.04 weight 400 white, y 0.42', T3: 'six NBSP with background box (flat colour reference) sizeFrac 0.06 at x -0.44 y 0.3' };
  report.regions = { ...REGIONS, imageCentreY: IMG_Y, textBoxCentre: BOX_C, colourSamples: 'red square core: 17x17 px about image centre; text box: 9x9 px about box centre' };
  report.notes = ['Test 1 (i) and (ii) are both strict; the paused preview decodes the original media (data-source=original), playback uses the proxy.', 'Small-text (14.4 px) regional PSNR in Test 2 is report+warning only; the pass/fail criterion is textSizeEnvelope.'];
  report.runtimeSeconds = +((Date.now() - t0) / 1000).toFixed(1);
  const json = JSON.stringify(report, null, 2) + '\n';
  fs.writeFileSync(path.join(art, 'parity-suite.json'), json);
  fs.writeFileSync(path.join(root, 'docs/evidence/parity-suite.json'), json);
  console.log(`\nTest 1: ${report.test1.pass ? 'PASS' : 'FAIL'}   Test 2: ${report.test2.pass ? 'PASS' : 'FAIL'}   warnings: ${warnings.length}   runtime ${report.runtimeSeconds}s`);
  for (const x of failures.slice(0, 20)) console.log(' FAIL', x);
  for (const x of warnings.slice(0, 10)) console.log(' warn', x);
  console.log('Evidence: docs/evidence/parity-suite.json');
  process.exit(report.pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
