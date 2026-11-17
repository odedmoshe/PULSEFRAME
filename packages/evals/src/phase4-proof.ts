/**
 * Phase 4 gate (SPEC Appendix D): immutable snapshots with a manifest, export options and formats,
 * preflight blockers that fail clearly, cancellation, retry, and editing during export.
 * Real server, real render worker, real ffmpeg.   pnpm build && pnpm proof:phase4
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
const art = path.join(root, '.artifacts/phase4');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-count_packets', file], { encoding: 'utf8' }));
const measurements: Record<string, unknown> = {};

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4') });
  const s = await startServer({ port: 8793, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const waitJob = async (id: string, until = ['succeeded', 'failed', 'canceled']) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (until.includes(j.status)) return j; await sleep(150); } };
  const download = async (id: string, name: string) => { const file = path.join(art, name); fs.writeFileSync(file, (await call(`/jobs/${id}/output`)).body); return file; };
  try {
    // 640x360 project, clip of the whole fixture (120 frames) + Hebrew text over frames 30..90.
    const pid = (await call('/projects', { name: 'phase4', width: 640, height: 360 })).body.project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const tx = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }, { op: 'add_text', args: { text: 'ייצוא', start: f(30), duration: f(60), transform: { y: 0.3 } } }] });
    const textId = tx.body.results[1].output.clipId;
    const rect = { x: 0, y: 0, w: 640, h: 360 };

    console.log('\n# manifest and preflight');
    const plan = (await call(`/projects/${pid}/exports/plan`, {})).body;
    const m = plan.manifest;
    check('plan lists exact dependencies: asset content hash, bundled font files with SHA-256, engine versions, output geometry', plan.blockers.length === 0 && m.assets[0].contentHash === up.asset.contentHash && m.fonts[0].family === 'Heebo' && m.fonts[0].files.length >= 2 && m.fonts[0].files.every((x: any) => /^[0-9a-f]{64}$/.test(x.sha256)) && m.engine.compositor === 'canvas2d/1' && m.output.frames === 120 && m.output.width === 640, { fonts: m.fonts[0].files.map((x: any) => x.name), engine: m.engine });
    check('size estimate is labelled as an estimate with its basis', typeof m.estimate.bytes === 'number' && /heuristic/.test(m.estimate.basis), m.estimate);
    check('planning started nothing', (await call(`/projects/${pid}/history?since=0`)).body.events.length === 2);
    await call(`/projects/${pid}/transactions`, { ops: [{ op: 'update_text', args: { clipId: textId, style: { fontFamily: 'Not Installed Sans' } } }] });
    const blockedFont = await call(`/projects/${pid}/exports`, {});
    check('missing font: export is refused with a typed render blocker instead of silently falling back', blockedFont.status === 422 && blockedFont.body.error.code === 'render_blocked' && blockedFont.body.error.details.blockers[0].code === 'missing_font', blockedFont.body.error?.details?.blockers);
    const outsideRange = await call(`/projects/${pid}/exports/plan`, { range: { startFrame: 0, endFrame: 20 } });
    check('a blocker outside the exported range does not block that range', outsideRange.body.blockers.length === 0);
    await call(`/projects/${pid}/transactions`, { ops: [{ op: 'update_text', args: { clipId: textId, style: { fontFamily: 'Heebo' } } }] });
    const blob = path.join(s.cfg.dataDir, 'blobs', up.asset.contentHash.slice(7));
    fs.renameSync(blob, `${blob}.away`);
    const blockedMedia = await call(`/projects/${pid}/exports`, {});
    fs.renameSync(`${blob}.away`, blob);
    check('missing media: refused with the asset named', blockedMedia.status === 422 && blockedMedia.body.error.details.blockers[0].code === 'missing_media' && blockedMedia.body.error.details.blockers[0].ids[0] === up.assetId);
    check('bad options are rejected before any job exists', (await call(`/projects/${pid}/exports`, { format: 'avi' })).status === 400 && (await call(`/projects/${pid}/exports`, { range: { startFrame: 500, endFrame: 600 } })).status === 422);

    console.log('\n# formats, range, scale, quality');
    const j1 = await waitJob((await call(`/projects/${pid}/exports`, { range: { startFrame: 45, endFrame: 75 }, scale: 0.5, quality: 'draft' })).body.jobId);
    const f1 = await download(j1.id, 'range.mp4');
    const p1 = probe(f1);
    const v1 = p1.streams.find((x: any) => x.codec_type === 'video');
    const a1 = p1.streams.find((x: any) => x.codec_type === 'audio');
    const raw1 = ff(['-i', f1, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const codes1 = Array.from({ length: 30 }, (_, k) => readBarcode(raw1.subarray(k * 320 * 180 * 3, (k + 1) * 320 * 180 * 3), 320, 3, { x: 0, y: 0, w: 320, h: 180 }));
    check('MP4 range [45,75) at half size, draft: exactly 30 frames, 320x180, each showing source frames 45..74', j1.status === 'succeeded' && v1.width === 320 && v1.height === 180 && Number(v1.nb_frames) === 30 && codes1.every((c, k) => c === 45 + k), { codes: [codes1[0], codes1[29]], bytes: j1.output.bytes, estimate: j1.output.estimate });
    check('range audio is cut by absolute samples: 1.000 s, and the beep of second 2 lands 0.5 s into the range', Math.abs(Number(a1.duration) - 1) < 0.03 && (() => { const pcm = ff(['-i', f1, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']); for (let i = 0; i < pcm.length / 2; i++) if (Math.abs(pcm.readInt16LE(i * 2)) > 6000) return Math.abs(i / 48000 - 0.5) < 1 / 30; return false; })(), { audioSeconds: a1.duration });
    const j2 = await waitJob((await call(`/projects/${pid}/exports`, { format: 'webm-vp9-opus', quality: 'standard', range: { startFrame: 0, endFrame: 60 } })).body.jobId);
    const f2 = await download(j2.id, 'out.webm');
    const p2 = probe(f2);
    const raw2 = ff(['-i', f2, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const codes2 = Array.from({ length: 60 }, (_, k) => readBarcode(raw2.subarray(k * 640 * 360 * 3, (k + 1) * 640 * 360 * 3), 640, 3, rect));
    check('WebM VP9 + Opus: validated codecs, 60 frames, every frame the right source frame', j2.status === 'succeeded' && p2.streams.find((x: any) => x.codec_type === 'video').codec_name === 'vp9' && p2.streams.find((x: any) => x.codec_type === 'audio').codec_name === 'opus' && raw2.length === 60 * 640 * 360 * 3 && codes2.every((c, k) => c === k), { error: j2.error, bytes: j2.output?.bytes });
    const j3 = await waitJob((await call(`/projects/${pid}/exports`, { format: 'wav', range: { startFrame: 30, endFrame: 90 } })).body.jobId);
    const p3 = probe(await download(j3.id, 'out.wav'));
    check('WAV audio-only: exact sample count for the range (2 s = 96,000 samples) without rendering video', j3.status === 'succeeded' && Number(p3.streams[0].duration_ts) === 96000 && j3.output.renderStageMs === null, j3.output?.validation);
    const j4 = await waitJob((await call(`/projects/${pid}/exports`, { format: 'png', frame: 50 })).body.jobId);
    const f4 = await download(j4.id, 'still.png');
    const still = ff(['-i', f4, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const sense = Buffer.from(await (await fetch(`${s.url}/api/v1/projects/${pid}/frame?index=50`, { headers: h })).arrayBuffer());
    fs.writeFileSync(path.join(art, 'sense.png'), sense);
    check('PNG still of frame 50: correct source frame, and byte-identical pixels to the agent render_frame sense', j4.status === 'succeeded' && readBarcode(still, 640, 3, rect) === 50 && still.equals(ff(['-i', path.join(art, 'sense.png'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])));
    measurements.formats = { mp4Draft: { wall: j1.output.wallSeconds, bytes: j1.output.bytes, estimate: j1.output.estimate.bytes }, webm: { wall: j2.output?.wallSeconds, bytes: j2.output?.bytes, estimate: j2.output?.estimate?.bytes }, wav: { wall: j3.output.wallSeconds }, png: { wall: j4.output.wallSeconds } };

    console.log('\n# cancellation, retry, queue, snapshot immutability');
    // A long job: a 1920x1080 project, 20 s (the clip five times).
    const big = (await call('/projects', { name: 'long', width: 1920, height: 1080 })).body.project.id;
    const up2: any = await (await fetch(`${s.url}/api/v1/projects/${big}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    await call(`/projects/${big}/transactions`, { ops: Array.from({ length: 5 }, (_, i) => ({ op: 'add_clip', args: { assetId: up2.assetId, start: f(i * 120) } })) });
    const before = (await call(`/projects/${big}`)).body;
    const run = (await call(`/projects/${big}/exports`, {})).body;
    const second = (await call(`/projects/${big}/exports`, { quality: 'draft', scale: 0.25 })).body;
    for (let i = 0; i < 200 && !/rendering \d+\//.test((await call(`/jobs/${run.jobId}`)).body.stage ?? ''); i++) await sleep(100);
    const edit = await call(`/projects/${big}/transactions`, { ops: [{ op: 'add_text', args: { text: 'נוסף בזמן הייצוא', start: f(0), duration: f(60) } }] });
    const qCancel = (await call(`/jobs/${second.jobId}/cancel`, {})).body;
    check('a queued export is removed from the queue', qCancel.outcome === 'removed-from-queue' && (await call(`/jobs/${second.jobId}`)).body.status === 'canceled');
    await sleep(800);
    const stageAtCancel = (await call(`/jobs/${run.jobId}`)).body.stage;
    const t0 = Date.now();
    const cancel = (await call(`/jobs/${run.jobId}/cancel`, {})).body;
    const cj = await waitJob(run.jobId);
    const cancelMs = Date.now() - t0;
    await sleep(300);
    const leftovers = fs.readdirSync(path.join(s.cfg.dataDir, 'out')).filter((n) => n.startsWith(run.jobId));
    const tmpLeft = fs.readdirSync(path.join(s.cfg.dataDir, 'tmp')).filter((n) => n.startsWith(run.jobId));
    let ffAlive = '';
    try { ffAlive = execFileSync('pgrep', ['-f', `${run.jobId}`], { encoding: 'utf8' }); } catch { /* none */ }
    measurements.cancel = { stageAtCancel, msToCanceled: cancelMs };
    check('a running export is canceled promptly: encoder stopped, no partial file published, scratch removed', cancel.outcome === 'stopping' && cj.status === 'canceled' && cj.error.code === 'canceled' && leftovers.length === 0 && tmpLeft.length === 0 && ffAlive.trim() === '' && cancelMs < 5000, measurements.cancel);
    check('canceled output cannot be downloaded', (await call(`/jobs/${run.jobId}/output`)).status === 409);
    const retry = (await call(`/jobs/${run.jobId}/retry`, {})).body;
    check('retry of a succeeded job is refused; retry of the canceled job creates a new job', (await call(`/jobs/${j1.id}/retry`, {})).status === 409 && retry.retryOf === run.jobId && retry.jobId !== run.jobId);
    const rj = await waitJob(retry.jobId);
    const fr = await download(retry.jobId, 'retry.mp4');
    const pr = probe(fr);
    const vr = pr.streams.find((x: any) => x.codec_type === 'video');
    // The retried job must render the ORIGINAL snapshot: 600 frames and no text, although the project was edited meanwhile.
    const frame10 = ff(['-i', fr, '-vf', 'select=eq(n\\,10),scale=640:360', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const now = (await call(`/projects/${big}`)).body;
    measurements.longExport = { frames: Number(vr.nb_frames), size: `${vr.width}x${vr.height}`, wallSeconds: rj.output.wallSeconds, realtimeFactor: rj.output.realtimeFactor, renderStageMs: rj.output.renderStageMs, bytes: rj.output.bytes, estimateBytes: rj.output.estimate.bytes };
    check('retry renders the same immutable snapshot (revision before the mid-export edit), although the project moved on', rj.status === 'succeeded' && rj.revision === before.revision && edit.body.revision === before.revision + 1 && now.revision > rj.revision && Number(vr.nb_frames) === 600 && readBarcode(frame10, 640, 3, rect) === 10, measurements.longExport);
    check('the retried output records the manifest it was rendered from', rj.output.manifest.assets[0].contentHash === up2.asset.contentHash && rj.output.options.format === 'mp4-h264-aac' && rj.retryOf === run.jobId);

    // Cancel at the very moment the picture render starts (the render page is still being opened): it must stop just as promptly.
    const early = (await call(`/projects/${big}/exports`, {})).body;
    for (let i = 0; i < 3000 && !/rendering \d+\//.test((await call(`/jobs/${early.jobId}`)).body.stage ?? ''); i++) await sleep(10);
    const stageEarly = (await call(`/jobs/${early.jobId}`)).body.stage;
    const tEarly = Date.now();
    await call(`/jobs/${early.jobId}/cancel`, {});
    const ej = await Promise.race([waitJob(early.jobId), sleep(60_000).then(() => ({ status: 'still running after 60 s' }))]);
    measurements.cancelAtRenderStart = { stageAtCancel: stageEarly, msToCanceled: Date.now() - tEarly };
    check('an export canceled as its picture render is starting stops promptly too', ej.status === 'canceled' && Date.now() - tEarly < 5000, measurements.cancelAtRenderStart);
    if (ej.status !== 'canceled') await waitJob(early.jobId);

    console.log('\n# cancel and retry from the editor');
    // Photosensitivity check of exports (ADR-0009 decision 4): a timeline that alternates black and white every 3 frames for
    // 3 s (5 flashes a second over the whole picture) exports with a failing report naming that stretch; the calm fixture
    // export above passed. The check never changes or blocks the export.
    let flashProject = '', flashFrom = -1;
    {
      const fl = (await call('/projects', { name: 'flashing', width: 320, height: 180 })).body.project.id as string;
      flashProject = fl;
      const img = (name: string, colour: string) => { const file = path.join(art, `${name}.png`); ff(['-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=320x180`, '-frames:v', '1', file]); return file; };
      const upImg = async (file: string) => ((await (await fetch(`${s.url}/api/v1/projects/${fl}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any).assetId as string;
      const black = await upImg(img('flash-black', 'black')), white = await upImg(img('flash-white', 'white'));
      // 1 s calm (black), then 30 clips of 3 frames alternating, then 1 s calm: frames 30..119 flash
      const ops: unknown[] = [{ op: 'add_clip', args: { assetId: black, start: f(0), duration: f(30) } }];
      for (let k = 0; k < 30; k++) ops.push({ op: 'add_clip', args: { assetId: k % 2 ? black : white, start: f(30 + 3 * k), duration: f(3) } });
      ops.push({ op: 'add_clip', args: { assetId: black, start: f(120), duration: f(30) } });
      const built = await call(`/projects/${fl}/transactions`, { ops });
      const fj = await waitJob((await call(`/projects/${fl}/exports`, { quality: 'draft' })).body.jobId);
      const rep = fj.output?.photosensitivity;
      const sec = (x: { value: string; timescale: number }) => Number(x.value) / x.timescale;
      const range = rep?.ranges?.[0];
      if (range) flashFrom = Math.floor(sec(range.from) * 30);
      measurements.photosensitivity = { flashing: rep && { verdict: rep.verdict, frames: rep.frames, ranges: rep.ranges.map((r: any) => ({ fromSeconds: sec(r.from), toSeconds: sec(r.to), kind: r.kind, flashesPerSecond: r.flashesPerSecond, area: r.area })) }, calm: j1.output?.photosensitivity?.verdict };
      check('photosensitivity: an export that alternates black and white every 3 frames for 3 s reports dangerous flashing over the whole frame in that stretch (and succeeds: nothing is changed or blocked); the calm fixture export passed', built.status === 200 && fj.status === 'succeeded' && rep?.verdict === 'fail' && rep.ranges.length === 1 && range.kind === 'general' && range.area === 1 && range.flashesPerSecond >= 4 && sec(range.from) >= 0 && sec(range.from) <= 1.2 && sec(range.to) >= 3.9 && sec(range.to) <= 5 && j1.output?.photosensitivity?.verdict === 'pass', measurements.photosensitivity);
    }

    const browser = await chromium.launch();
    try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    await page.goto(`${s.ownerUrl}&project=${big}`);
    await page.locator('.clip').first().waitFor();
    await page.getByTestId('export').click();
    await page.getByTestId('export-cancel').waitFor();
    await page.waitForFunction(() => /\d+\/\d+/.test(document.querySelector('[data-testid=export]')?.textContent ?? ''), undefined, { timeout: 30_000 });
    await page.getByTestId('export-cancel').click();
    await page.getByTestId('export-canceled').waitFor({ timeout: 15_000 });
    check('editor: Cancel stops a running export and shows that it was canceled; Retry is offered', (await page.getByTestId('export-retry').count()) === 1 && (await page.getByTestId('export-download').count()) === 0);
    // the same flashing project exported from the editor: the header says dangerous flashing was found; the list names the
    // stretch and its button moves the playhead there
    {
      const fp = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
      const fErrors: string[] = [];
      fp.on('pageerror', (e) => fErrors.push(String(e)));
      await fp.goto(`${s.ownerUrl}&project=${flashProject}`);
      await fp.locator('.clip').first().waitFor();
      await fp.getByTestId('export').click();
      await fp.getByTestId('flash-fail').waitFor({ timeout: 120_000 });
      await fp.locator('[data-testid=flash-fail] > summary').click();
      const ranges = await fp.getByTestId('flash-range').count();
      await fp.getByTestId('flash-jump').first().click();
      await fp.waitForFunction((want) => document.querySelector('canvas[data-testid=preview]')?.getAttribute('data-frame') === String(want), flashFrom, { timeout: 10_000 }).catch(() => {});
      const at = Number(await fp.locator('canvas[data-testid=preview]').getAttribute('data-frame'));
      const text = (await fp.getByTestId('flash-fail').textContent()) ?? '';
      check('editor: after exporting the flashing project the header warns of dangerous flashing (Hebrew), lists the one stretch, and its button moves the playhead to its start', ranges === 1 && at === flashFrom && /הבהוב/.test(text) && fErrors.length === 0, { ranges, playheadFrame: at, wanted: flashFrom, errors: fErrors.slice(0, 2) });
      await fp.close();
    }
    } finally { await browser.close(); } // always: a page left open keeps its event stream, which used to make shutdown wait forever after a failed step
  } catch (e) {
    // A crash must never look like a pass: record it as a failed check so the report says FAILED.
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await s.close();
    const failed = checks.filter((c) => !c.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu: 'none' }, measurements, notDone: ['browser export route', 'GIF/animated WebP', 'subtitle sidecars', 'project archive', 'batch variants', 'checkpoint/resume of a partially rendered job (a retry restarts from frame 0)'], checks };
    fs.writeFileSync(path.join(root, 'docs/evidence/phase4-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${report.result}: ${checks.length - failed.length}/${checks.length} checks. Evidence: docs/evidence/phase4-proof.json`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
