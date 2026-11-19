/**
 * Sources whose first video timestamp is not 0 (common after remuxing, in MKV/TS, or with B-frames and no edit list).
 * Measures, with the frame-barcode fixture shifted by known amounts, which source frame each exported frame shows.
 *   pnpm build && pnpm conformance:start-offset
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
const art = path.join(root, '.artifacts/start-offset');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const W = 640, H = 360;
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'zero.mp4') });
  // offsets in seconds: under half a frame, over half a frame (the B-frame/priming case), and several frames
  const cases: { name: string; offset: number; container: string }[] = [
    { name: 'zero', offset: 0, container: 'mp4' },
    { name: 'off-0.010', offset: 0.010, container: 'mp4' },
    { name: 'off-0.021', offset: 0.021, container: 'mp4' },
    { name: 'off-0.021-mkv', offset: 0.021, container: 'mkv' },
    { name: 'off-0.500', offset: 0.5, container: 'mp4' },
  ];
  for (const c of cases.slice(1)) ff(['-y', '-itsoffset', String(c.offset), '-i', fixture.file, '-i', fixture.file, '-map', '0:v', '-map', '1:a', '-c', 'copy', path.join(art, `${c.name}.${c.container}`)]);
  const s = await startServer({ port: 8817, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const rows: any[] = [];
  try {
    for (const c of cases) {
      const file = path.join(art, c.name === 'zero' ? 'zero.mp4' : `${c.name}.${c.container}`);
      const startTime = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().replace(',', ''));
      const pid = (await call('/projects', { name: c.name, width: W, height: H })).body.project.id;
      const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json();
      if (!up.assetId) { rows.push({ case: c.name, startTime, refused: up.error?.code ?? 'unknown' }); continue; }
      await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] });
      const jobId = (await call(`/projects/${pid}/exports`, {})).body.jobId;
      let job: any;
      for (;;) { job = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
      if (job.status !== 'succeeded') { rows.push({ case: c.name, startTime, exportFailed: job.error }); continue; }
      const mp4 = path.join(art, `${c.name}-export.mp4`);
      fs.writeFileSync(mp4, (await call(`/jobs/${jobId}/output`)).body);
      const raw = ff(['-i', mp4, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const fb = W * H * 3;
      const shown = Array.from({ length: raw.length / fb }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H }));
      const lag = shown.map((g, i) => i - g);
      const scenes = await call(`/projects/${pid}/assets/${up.assetId}/analyze`, { kind: 'scenes' });
      rows.push({ case: c.name, projectId: pid, container: c.container, startTime, storedStart: up.asset.video?.startTime ?? null, assetFrames: up.asset.video?.frameCount, assetSeconds: T.toSeconds(up.asset.duration), exportedFrames: shown.length, first8: shown.slice(0, 8), last3: shown.slice(-3), lagFrames: [...new Set(lag.slice(20, 100))], sceneStatus: scenes.status });
    }
    // Rule under test: the picture is placed the NEAREST whole number of frames after time 0 (error against the sound ≤ half a frame),
    // the first frame is held until then, and after that every source frame is shown exactly once, up to the last one.
    const expectLag = (r: any) => Math.round(r.startTime * 30);
    const ok = (r: any) => r.exportedFrames === 120 + expectLag(r) && JSON.stringify(r.lagFrames) === JSON.stringify([expectLag(r)]) && r.first8.slice(0, expectLag(r) + 1).every((x: number) => x === 0) && r.last3?.join() === '117,118,119';
    check('every shifted file exports; the picture is placed the nearest whole frame after time 0 (0.010 s → 0, 0.021 s → 1, 0.042 s → 1, 0.5 s → 15 frames), the first frame is held until then, and every source frame up to the last is shown exactly once', rows.length === cases.length && rows.every(ok), rows.map((r) => ({ case: r.case, startTime: r.startTime, lag: r.lagFrames, frames: r.exportedFrames, first4: r.first8?.slice(0, 4), last3: r.last3, failed: r.exportFailed?.code ?? r.refused })));

    // Scene detection must agree with what is shown: the detected cut is the timeline frame at which the exported picture changes.
    const cutSrc = path.join(art, 'cut-zero.mp4');
    ff(['-y', '-f', 'lavfi', '-t', '4', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', '4', '-i', 'smptebars=s=640x360:r=30', '-f', 'lavfi', '-t', '4', '-i', 'sine=f=440:r=48000', '-filter_complex', "[0:v][1:v]overlay=enable='gte(t\\,2)',format=yuv420p,setsar=1[v]", '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '30', '-bf', '2', '-c:a', 'aac', cutSrc]);
    const cutRows: any[] = [];
    for (const offset of [0, 0.021, 0.5]) {
      const file = offset ? path.join(art, `cut-${offset}.mp4`) : cutSrc;
      if (offset) ff(['-y', '-itsoffset', String(offset), '-i', cutSrc, '-i', cutSrc, '-map', '0:v', '-map', '1:a', '-c', 'copy', file]);
      const pid = (await call('/projects', { name: `cut-${offset}`, width: W, height: H })).body.project.id;
      const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json();
      await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] });
      const an = (await call(`/projects/${pid}/assets/${up.assetId}/analyze`, { kind: 'scenes' })).body;
      const detected = (an.scenes?.cutSeconds as number[] ?? []).map((x) => Math.round(x * 30));
      const jobId = (await call(`/projects/${pid}/exports`, {})).body.jobId;
      let job: any;
      for (;;) { job = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
      const mp4 = path.join(art, `cut-${offset}-export.mp4`);
      fs.writeFileSync(mp4, (await call(`/jobs/${jobId}/output`)).body);
      const raw = ff(['-i', mp4, '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
      const fb = 64 * 36, n = raw.length / fb;
      let best = -1, bestD = 0;
      for (let i = 1; i < n; i++) { let d = 0; for (let p = 0; p < fb; p++) d += Math.abs(raw[i * fb + p]! - raw[(i - 1) * fb + p]!); if (d > bestD) { bestD = d; best = i; } }
      cutRows.push({ offset, detectedCutFrames: detected, pictureChangesAtFrame: best, expected: 60 + Math.round(offset * 30) });
    }
    check('scene detection agrees with the picture for shifted files: the one detected cut is exactly the exported frame where the picture changes (60, 61 and 75)', cutRows.every((r) => r.detectedCutFrames.length === 1 && r.detectedCutFrames[0] === r.pictureChangesAtFrame && r.pictureChangesAtFrame === r.expected), cutRows);
    rows.push(...cutRows.map((r) => ({ cutCase: r })));

    // The editor preview uses the same rule and the same decoder: paused frames of the file that starts 15 frames late.
    const late = rows.find((r) => r.case === 'off-0.500');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(`${s.ownerUrl}&project=${late.projectId}`);
      await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 30000 });
      const seen: Record<number, number> = {};
      for (const target of [0, 14, 15, 16, 100, 134]) {
        await page.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); }, (target / 30) * 90 + 0.5);
        await page.waitForFunction((t) => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return c?.dataset.frame === String(t) && c?.dataset.quality === 'full'; }, target, { timeout: 15000 }).catch(() => {});
        const shot = await page.evaluate(() => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; return { w: c.width, data: Array.from(c.getContext('2d')!.getImageData(0, Math.round(c.height / 12), c.width, 1).data.filter((_, i) => i % 4 !== 3)) }; });
        seen[target] = readBarcode(Uint8Array.from(shot.data), shot.w, 3, { x: 0, y: 0, w: shot.w, h: 0 });
      }
      check('editor preview of the file that starts 15 frames late: paused frames 0, 14 and 15 show source frame 0, then 16 → 1, 100 → 85, 134 → 119; no page errors', JSON.stringify(seen) === JSON.stringify({ 0: 0, 14: 0, 15: 0, 16: 1, 100: 85, 134: 119 }) && errors.length === 0, { seen, errors: errors.slice(0, 3) });
    } finally { await browser.close(); }

    // --- sound that starts late: the file delays its sound by 0.5 s; the picture starts at 0.
    // The fixture beeps at source 0, 1, 2, 3 s, so on the file's own clock the beeps are at 0.5, 1.5, 2.5, 3.5 s.
    const lateFile = path.join(art, 'audio-late.mp4');
    ff(['-y', '-i', fixture.file, '-itsoffset', '0.5', '-i', fixture.file, '-map', '0:v', '-map', '1:a', '-c', 'copy', lateFile]);
    const ap = (await call('/projects', { name: 'audio-late', width: W, height: H })).body.project.id;
    const aup: any = await (await fetch(`${s.url}/api/v1/projects/${ap}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'audio-late.mp4' }, body: fs.readFileSync(lateFile) })).json();
    await call(`/projects/${ap}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: aup.assetId, start: f(0) } }] });
    const onsetsOf = (file: string) => {
      const pcm = ff(['-i', file, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-']);
      const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
      const out: number[] = [];
      for (let i = 0, quiet = 0; i < x.length; i++) if (i >= quiet && Math.abs(x[i]!) > 0.15) { out.push(Number((i / 48000).toFixed(3))); quiet = i + 48000 * 0.3; }
      return out;
    };
    const want = [0.5, 1.5, 2.5, 3.5];
    const near = (got: number[], tol: number) => got.length === want.length && got.every((g, i) => Math.abs(g - want[i]!) <= tol);
    const wjob = (await call(`/projects/${ap}/exports`, { format: 'wav' })).body.jobId;
    let wj: any;
    for (;;) { wj = (await call(`/jobs/${wjob}`)).body; if (['succeeded', 'failed', 'canceled'].includes(wj.status)) break; await sleep(100); }
    const wavFile = path.join(art, 'audio-late.wav');
    fs.writeFileSync(wavFile, (await call(`/jobs/${wjob}/output`)).body);
    const serverOnsets = onsetsOf(wavFile);
    const b2 = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    let previewOnsets: number[] = [], previewClock = 'none', browserOnsets: number[] = [], browserNote = '';
    try {
      const page = await b2.newPage({ viewport: { width: 1500, height: 950 } });
      await page.addInitScript(() => { (window as any).__pfAudioTap = true; });
      await page.goto(`${s.ownerUrl}&project=${ap}`);
      await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 30000 });
      await page.getByTestId('preview').click({ position: { x: 5, y: 5 } });
      await page.getByTestId('play').click();
      await page.waitForFunction(() => (window as any).__pfSync().framesPainted > 10 && document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'false', undefined, { timeout: 30000 }).catch(() => {});
      const sync = await page.evaluate(() => (window as any).__pfSync());
      previewClock = sync.clock;
      previewOnsets = (sync.audioOnsetsTimelineSeconds ?? []).map((x: number) => Number(x.toFixed(3)));
      await page.close();
      const bp = await b2.newPage();
      await bp.goto(`${s.url}/browser-export.html?key=${s.auth.tokens.owner}`);
      await bp.evaluate(() => (window as any).__pfBrowserExport.ready);
      const r: any = await bp.evaluate((p) => (window as any).__pfBrowserExport.tryRun(p, { quality: 'draft' }), ap);
      if (r.ok) { const bf = path.join(art, `audio-late-browser.${r.result.container}`); fs.writeFileSync(bf, Buffer.from(r.result.base64, 'base64')); browserOnsets = onsetsOf(bf); browserNote = `${r.result.container}/${r.result.audioCodec}`; }
      else browserNote = `browser export did not run: ${JSON.stringify(r).slice(0, 200)}`;
    } finally { await b2.close(); }
    rows.push({ audioLate: { storedAudioStart: aup.asset.audio?.startTime ?? null, want, serverOnsets, previewClock, previewOnsets, browserOnsets, browserNote } });
    check('sound that starts 0.5 s late in the file is heard 0.5 s late on every route: server export within 3 ms; preview playback (audio clock) and browser export within one frame', near(serverOnsets, 0.003) && previewClock === 'audio' && near(previewOnsets, 1 / 30) && near(browserOnsets, 1 / 30), { want, serverOnsets, previewClock, previewOnsets, browserOnsets, browserNote });
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' }, scope: 'Synthetic fixtures remuxed with shifted video timestamps (MP4 and Matroska): server export, scene detection, and paused preview frames in the editor. Sound that starts late is measured on the server export, preview playback and browser export. Not covered: playback (proxy) picture frames, negative start times, real camera files.', passed: checks.length - failed.length, total: checks.length, rows, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/start-offset.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nStart-offset run ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
