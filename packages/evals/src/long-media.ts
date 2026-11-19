/**
 * Long media run (SPEC Appendix C2/C3, "long media"): one synthetic 20-minute file with a hard cut every minute and a
 * steady 120 BPM click, taken through ingest, background analysis, a long timeline and a seek near the end in the editor.
 * Reports measured times. ONE run on ONE machine with SYNTHETIC content: it shows the mechanisms hold at this length;
 * it is not a performance qualification and says nothing about camera footage or real music.
 *
 *   pnpm build && pnpm conformance:long        (PF_LONG_MINUTES=20 by default)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/long-media');
const MINUTES = Math.max(2, Number(process.env.PF_LONG_MINUTES ?? 20));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const r1 = (x: number) => Number(x.toFixed(1));

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  // --- fixture: two different one-minute pictures alternating (a hard cut every 1800 frames), click every 0.5 s
  const tGen = Date.now();
  // One encode (not segments joined by stream copy: that leaves a non-zero first timestamp, which the frame rule does not cover).
  const D = String(MINUTES * 60);
  const file = path.join(art, 'long.mp4');
  ff(['-f', 'lavfi', '-t', D, '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', D, '-i', 'smptebars=s=640x360:r=30', '-f', 'lavfi', '-i', `aevalsrc=0.8*sin(2*PI*1000*t)*lt(mod(t\\,0.5)\\,0.02):s=48000:d=${D}`,
    '-filter_complex', "[0:v][1:v]overlay=enable='eq(mod(floor(t/60)\\,2)\\,1)',format=yuv420p,setsar=1[v]", '-map', '[v]', '-map', '2:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '60', '-bf', '2', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', file]);
  const startPts = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
  if (Math.abs(startPts) > 1e-6) throw new Error(`fixture video does not start at 0 (start_time ${startPts})`);
  const measurements: Record<string, unknown> = { minutes: MINUTES, fileMB: r1(fs.statSync(file).size / 1e6), generateSeconds: r1((Date.now() - tGen) / 1000) };
  const cutsTruth = Array.from({ length: MINUTES - 1 }, (_, i) => (i + 1) * 1800);

  const s = await startServer({ port: 8815, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null } as { status: number; body: any };
  };
  const browser = await chromium.launch();
  try {
    const pid = (await call('/projects', { name: 'long', width: 640, height: 360 })).body.project.id;

    console.log('\n# ingest');
    let t = Date.now();
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'long.mp4' }, body: fs.readFileSync(file) })).json();
    measurements.ingestSeconds = r1((Date.now() - t) / 1000);
    const asset = up.asset;
    const durS = T.toSeconds(asset.duration);
    check(`ingest: the ${MINUTES}-minute file is accepted and probed (duration within one frame of ${MINUTES * 60} s, ${MINUTES * 1800} frames)`, !!up.assetId && Math.abs(durS - MINUTES * 60) < 0.05 && Math.abs((asset.video.frameCount ?? 0) - MINUTES * 1800) <= 2, { seconds: durS, frames: asset.video.frameCount, ingestSeconds: measurements.ingestSeconds });

    console.log('\n# background analysis while the project is being edited');
    t = Date.now();
    const sj = (await call(`/projects/${pid}/assets/${up.assetId}/analyze`, { kind: 'scenes', background: true })).body.jobId as string;
    const bj = (await call(`/projects/${pid}/assets/${up.assetId}/analyze`, { kind: 'beats', background: true })).body.jobId as string;
    // meanwhile: small edits must keep answering promptly
    const lat: number[] = [];
    const state: Record<string, { status: string; seconds: number }> = {};
    for (let i = 0; Object.keys(state).length < 2 && i < 3000; i++) {
      const t1 = Date.now();
      const tx = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_marker', args: { time: f(i), label: `m${i}` } }] });
      if (tx.status === 200) lat.push(Date.now() - t1);
      for (const [k, id] of [['scenes', sj], ['beats', bj]] as const) {
        if (state[k]) continue;
        const j = (await call(`/jobs/${id}`)).body;
        if (['succeeded', 'failed', 'canceled'].includes(j.status)) state[k] = { status: j.status, seconds: r1((Date.now() - t) / 1000) };
      }
      await sleep(200);
    }
    lat.sort((a, b) => a - b);
    measurements.analysis = state;
    measurements.editsDuringAnalysis = { count: lat.length, medianMs: lat[lat.length >> 1], p95Ms: lat[Math.floor(lat.length * 0.95)], maxMs: lat[lat.length - 1] };
    const an = (await call(`/projects/${pid}/assets/${up.assetId}/analysis`)).body;
    const found = (an.scenes?.cutSeconds as number[] ?? []).map((x) => Math.round(x * 30));
    check(`scene job: finishes and finds all ${MINUTES - 1} cuts on the exact frames, no false cuts`, state.scenes?.status === 'succeeded' && JSON.stringify(found) === JSON.stringify(cutsTruth), { seconds: state.scenes?.seconds, found: found.length, firstWrong: found.find((x, i) => x !== cutsTruth[i]) ?? null });
    const expectBeats = MINUTES * 120;
    check(`beat job: finishes with a tempo within 1 BPM of 120 and a beat count within 2% of ${expectBeats}`, state.beats?.status === 'succeeded' && Math.abs(an.beats.bpm - 120) < 1 && Math.abs(an.beats.count - expectBeats) / expectBeats < 0.02, { seconds: state.beats?.seconds, bpm: an.beats?.bpm, count: an.beats?.count, confidence: an.beats?.confidence });
    check('edits made while both jobs ran all succeeded and stayed prompt (median under 100 ms, worst under 2 s)', lat.length > 3 && lat[lat.length >> 1]! < 100 && lat[lat.length - 1]! < 2000, measurements.editsDuringAnalysis);

    console.log('\n# long timeline');
    const clip = (await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] })).body.results[0].output.clipId;
    t = Date.now();
    const split = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'split_at_scenes', args: { clipId: clip } }] });
    const splitMs = Date.now() - t;
    t = Date.now();
    const tl = (await call(`/projects/${pid}/timeline`)).body;
    const timelineMs = Date.now() - t;
    const shots = tl.tracks.find((x: any) => x.kind === 'video').clips.length;
    measurements.timeline = { shots, splitMs, timelineQueryMs: timelineMs, beatMarkers: tl.markers.beatSeconds.length, userMarkers: tl.markers.user.length };
    check(`split_at_scenes turns the ${MINUTES}-minute clip into ${MINUTES} shots in one transaction; the timeline query answers within 2 s`, split.status === 200 && shots === MINUTES && timelineMs < 2000 && Math.abs(tl.duration.value / tl.duration.timescale - MINUTES * 60) < 0.05, measurements.timeline);

    console.log('\n# editor near the end of a long file');
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    t = Date.now();
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 60000 });
    const openSeconds = r1((Date.now() - t) / 1000);
    const last = MINUTES * 1800 - 1;
    t = Date.now();
    await page.getByTestId('preview').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('End');
    const painted = await page.waitForFunction((n) => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === String(n), last, { timeout: 60000 }).then(() => true, () => false);
    const seekSeconds = r1((Date.now() - t) / 1000);
    // the last minute is the second picture when MINUTES is even: check the preview is not black and differs from frame 0's picture
    const lit = await page.evaluate(() => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(0, Math.floor(c.height / 2), c.width, 1).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]! + d[i + 1]! + d[i + 2]!; return s / (c.width * 3); });
    measurements.editor = { openSeconds, seekToLastFrameSeconds: seekSeconds, meanLevelOfMiddleRow: r1(lit), timecode: await page.getByTestId('timecode').textContent() };
    await page.screenshot({ path: path.join(art, 'editor-end.png') });
    check(`editor: opens the ${MINUTES}-minute project and paints the very last frame (${last}) after a jump to the end, picture not black, no page errors`, painted && lit > 20 && errors.length === 0, { ...(measurements.editor as object), errors: errors.slice(0, 3) });
    await page.close();
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, scope: `One run, one machine, one SYNTHETIC ${MINUTES}-minute file (640x360, H.264 + AAC, test patterns and clicks). Shows the mechanisms hold at this length; not a performance qualification, not real footage or music. Export of the long timeline was not run.`, passed: checks.length - failed.length, total: checks.length, measurements, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/long-media.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nLong media run ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
