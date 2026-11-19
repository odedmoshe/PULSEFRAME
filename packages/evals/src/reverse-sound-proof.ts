/**
 * A clip played backwards, picture and sound, on the three routes: server export, browser export and editor preview.
 * Fixture: 4 s of frame-barcode video with a 1 kHz beep at each second. Reversed, timeline frame i must show source frame
 * 119 − i, and each beep must be heard mirrored in time: where the forward beep ENDS at e seconds, the reversed one STARTS at 4 − e.
 *   pnpm build && pnpm proof:reverse-sound
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/reverse-sound');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const W = 640, H = 360;
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

/** [start, end] in seconds of every stretch of sound louder than the threshold (gaps shorter than 50 ms are bridged). */
function bursts(file: string): [number, number][] {
  const pcm = ff(['-i', file, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-']);
  const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
  const out: [number, number][] = [];
  let start = -1, last = -1;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]!) > 0.1) { if (start < 0) start = i; last = i; }
    else if (start >= 0 && i - last > 2400) { out.push([start / 48000, (last + 1) / 48000]); start = -1; }
  }
  if (start >= 0) out.push([start / 48000, (last + 1) / 48000]);
  return out.map(([a, b]) => [Number(a.toFixed(4)), Number(b.toFixed(4))]);
}
const codesOf = (file: string) => { const raw = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const fb = W * H * 3; return Array.from({ length: Math.floor(raw.length / fb) }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H })); };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4') });
  const s = await startServer({ port: 8823, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const exportTo = async (pid: string, name: string, options: unknown = {}) => {
    const jobId = (await call(`/projects/${pid}/exports`, options)).body.jobId;
    let job: any;
    for (;;) { job = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
    if (job.status !== 'succeeded') throw new Error(`export ${job.status}: ${JSON.stringify(job.error)}`);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${jobId}/output`)).body);
    return file;
  };
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const pid = (await call('/projects', { name: 'reverse sound', width: W, height: H })).body.project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const added = (await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] })).body;
    const clipId = added.results[0].output.clipId as string, audioId = added.results[0].output.audioClipId as string;

    console.log('# forward reference');
    const fwd = await exportTo(pid, 'forward.mp4');
    const fwdBursts = bursts(fwd), fwdCodes = codesOf(fwd);
    const D = 4;
    const want = fwdBursts.map(([a, b]) => [Number((D - b).toFixed(4)), Number((D - a).toFixed(4))] as [number, number]).sort((x, y) => x[0] - y[0]);
    check('forward export: 120 frames in order and four beeps, one per second', fwdCodes.length === 120 && fwdCodes.every((c, i) => c === i) && fwdBursts.length === 4, { beeps: fwdBursts });

    console.log('# reversed: server export');
    const rev = (await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_reverse', args: { clipId, reverse: true } }] })).body;
    const doc = (await call(`/projects/${pid}`)).body.project;
    const clipsNow = doc.sequences.seq_main.tracks.flatMap((t: any) => t.clips);
    check('one transaction reverses the picture and its linked sound together; they stay linked', rev.revision === added.revision + 1 && clipsNow.find((c: any) => c.id === clipId).reverse === true && clipsNow.find((c: any) => c.id === audioId).reverse === true && clipsNow.find((c: any) => c.id === clipId).linkGroupId === clipsNow.find((c: any) => c.id === audioId).linkGroupId);
    const srv = await exportTo(pid, 'reversed-server.mp4');
    const srvCodes = codesOf(srv), srvBursts = bursts(srv);
    const near = (got: [number, number][], tol: number) => got.length === want.length && got.every((g, i) => Math.abs(g[0] - want[i]![0]) <= tol && Math.abs(g[1] - want[i]![1]) <= tol);
    check('server export, reversed: frame i shows source frame 119 − i for all 120 frames, and each beep starts and ends within 3 ms of its mirrored position', srvCodes.length === 120 && srvCodes.every((c, i) => c === 119 - i) && near(srvBursts, 0.003), { want, got: srvBursts, firstFrames: srvCodes.slice(0, 4), lastFrames: srvCodes.slice(-4) });
    const part = await exportTo(pid, 'reversed-range.wav', { format: 'wav', range: { startFrame: 45, endFrame: 105 } }); // 1.5 s – 3.5 s
    const partWant = want.map(([a, b]) => [a - 1.5, b - 1.5] as [number, number]).filter(([a, b]) => b > 0 && a < 2).map(([a, b]) => [Math.max(0, a), Math.min(2, b)] as [number, number]);
    const partGot = bursts(part);
    check('a frame range of the reversed clip (sound only) has its beeps where that range has them', partGot.length === partWant.length && partGot.every((g, i) => Math.abs(g[0] - partWant[i]![0]) <= 0.003 && Math.abs(g[1] - partWant[i]![1]) <= 0.003), { want: partWant, got: partGot });

    console.log('# reversed: browser export and preview');
    let browserBursts: [number, number][] = [], browserCodes: number[] = [], browserNote = '', previewOnsets: number[] = [], previewClock = 'none', previewFrames: Record<number, number> = {};
    const bp = await browser.newPage();
    await bp.goto(`${s.url}/browser-export.html?key=${s.auth.tokens.owner}`);
    await bp.evaluate(() => (window as any).__pfBrowserExport.ready);
    const r: any = await bp.evaluate((p) => (window as any).__pfBrowserExport.tryRun(p, { quality: 'high' }), pid);
    if (r.ok) { const bf = path.join(art, `reversed-browser.${r.result.container}`); fs.writeFileSync(bf, Buffer.from(r.result.base64, 'base64')); browserBursts = bursts(bf); browserCodes = codesOf(bf); browserNote = `${r.result.container}/${r.result.audioCodec}`; }
    else browserNote = `browser export did not run: ${JSON.stringify(r).slice(0, 200)}`;
    await bp.close();
    check('browser export, reversed: the same 120 frames in the same order, and each beep within one frame of its mirrored position', browserCodes.length === 120 && browserCodes.every((c, i) => c === 119 - i) && near(browserBursts, 1 / 30), { note: browserNote, want, got: browserBursts, firstFrames: browserCodes.slice(0, 4) });

    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { (window as any).__pfAudioTap = true; });
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 30000 });
    // paused frames, by barcode from the preview canvas
    for (const target of [0, 1, 60, 119]) {
      await page.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const rr = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: rr.left + x, clientY: rr.top + 5, bubbles: true })); }, (target / 30) * 90 + 0.5);
      await page.waitForFunction((t) => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return cv?.dataset.frame === String(t) && cv?.dataset.quality === 'full'; }, target, { timeout: 15000 }).catch(() => {});
      const shot = await page.evaluate(() => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; return { w: cv.width, data: Array.from(cv.getContext('2d')!.getImageData(0, Math.round(cv.height / 12), cv.width, 1).data.filter((_, i) => i % 4 !== 3)) }; });
      previewFrames[target] = readBarcode(Uint8Array.from(shot.data), shot.w, 3, { x: 0, y: 0, w: shot.w, h: 0 });
    }
    await page.evaluate(() => { const el = document.querySelector('[data-testid=ruler]')!; const rr = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: rr.left + 0.5, clientY: rr.top + 5, bubbles: true })); });
    await page.getByTestId('preview').click({ position: { x: 5, y: 5 } });
    await page.getByTestId('play').click();
    await page.waitForFunction(() => (window as any).__pfSync().framesPainted > 10 && document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'false', undefined, { timeout: 40000 }).catch(() => {});
    const sync = await page.evaluate(() => (window as any).__pfSync());
    previewClock = sync.clock;
    previewOnsets = (sync.audioOnsetsTimelineSeconds ?? []).map((x: number) => Number(x.toFixed(3)));
    const wantOnsets = want.map((w) => w[0]);
    const badge = await page.locator(`.clip[data-clip-id="${audioId}"]`).getAttribute('data-reverse');
    await page.close();
    check('editor preview, reversed: paused frames 0, 1, 60 and 119 show source frames 119, 118, 59 and 0; played on the audio clock, each beep starts within one frame of its mirrored position; the sound clip is marked as reversed; no page errors', JSON.stringify(previewFrames) === JSON.stringify({ 0: 119, 1: 118, 60: 59, 119: 0 }) && previewClock === 'audio' && previewOnsets.length === wantOnsets.length && previewOnsets.every((g, i) => Math.abs(g - wantOnsets[i]!) <= 1 / 30) && badge === 'true' && errors.length === 0, { previewFrames, previewClock, wantOnsets, previewOnsets, badge, errors: errors.slice(0, 3) });

    console.log('# back to forwards');
    await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_reverse', args: { clipId, reverse: false } }] });
    const again = await exportTo(pid, 'forward-again.mp4');
    const againBursts = bursts(again);
    check('switched back, the export is the forward one again (frames in order, beeps where they were)', codesOf(again).every((c, i) => c === i) && againBursts.length === fwdBursts.length && againBursts.every((g, i) => Math.abs(g[0] - fwdBursts[i]![0]) <= 0.003));
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' }, scope: 'One synthetic 4-second fixture (frame barcode + 1 kHz beeps), reversed as a linked picture+sound pair, on the server export, the browser export and the editor preview. Not covered: long clips, speed combined with reverse in the browser routes, crossfades.', passed: checks.length - failed.length, total: checks.length, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/reverse-sound-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nReverse sound proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
