/**
 * Long-form A/V synchronisation (SPEC Appendix C3 "Synchronization"): export a ten-minute flash/beep
 * fixture with an edit in the middle and measure, for every second, the offset between the flash in
 * the exported picture and the beep in the exported audio. Reports drift, not just a pass flag.
 *
 *   pnpm build && pnpm conformance:avsync        (PF_AVSYNC_SECONDS=600 by default)
 *
 * PF_AVSYNC_MODE=incremental (ADR-0024, proof I12 of incremental-export-proof.ts): the same ten-minute project is exported on the
 * fast export route: first a clean segmented export on an empty cache, then one title is added at 5:00 and the project is exported
 * again with the cache warm. Sync is measured on both files exactly as above. A single pass of the same project is timed here too
 * (PF_AVSYNC_SINGLE=0 reads the committed record docs/evidence/av-sync-long.json instead), so all three wall times sit side by
 * side. The result goes to docs/evidence/av-sync-long-incremental.json; the single-pass record is not touched.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const MODE: 'incremental' | 'single-pass' = process.env.PF_AVSYNC_MODE === 'incremental' ? 'incremental' : 'single-pass';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/avsync');
const SECONDS = Number(process.env.PF_AVSYNC_SECONDS ?? 600);
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const t0 = Date.now();
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'long.mp4'), frames: SECONDS * 30 });
  const genSeconds = (Date.now() - t0) / 1000;
  const s = await startServer({ port: 8795, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const post = async (p: string, body?: unknown) => (await fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })).json() as Promise<any>;
  try {
    const pid = (await post('/projects', { name: 'avsync', width: 640, height: 360 })).project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'long.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    if (!up.assetId) throw new Error(`upload failed: ${JSON.stringify(up)}`);
    // Edit: remove 37 s + 11 frames from the middle (not a whole number of seconds), close the gap.
    const total = SECONDS * 30;
    const cutA = Math.floor(total * 0.4) + 7;
    const cutLen = 37 * 30 + 11;
    const add = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] });
    const clip = add.results[0].output.clipId;
    const s1 = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'split_clip', args: { clipId: clip, at: f(cutA) } }] });
    const mid = s1.results[0].output.rightClipId;
    const s2 = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'split_clip', args: { clipId: mid, at: f(cutA + cutLen) } }] });
    const tail = s2.results[0].output.rightClipId;
    const fin = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'delete_clip', args: { clipId: mid } }, { op: 'move_clip', args: { clipId: tail, start: f(cutA) } }] });
    if (!fin.committed) throw new Error(`edit failed: ${JSON.stringify(fin)}`);
    const outFrames = total - cutLen;
    const tExp = Date.now();
    const job = await post(`/projects/${pid}/exports`);
    let j: any;
    for (;;) { j = await (await fetch(`${s.url}/api/v1/jobs/${job.jobId}`, { headers: h })).json(); if (['succeeded', 'failed'].includes(j.status)) break; await sleep(2000); }
    if (j.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(j.error)}`);
    const exportSeconds = (Date.now() - tExp) / 1000;
    const mp4 = path.join(s.cfg.dataDir, 'out', j.output.file);

    // Audio: beep onsets (sample-accurate threshold crossing after >= 0.5 s of quiet).
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
    const beeps: number[] = [];
    let quiet = 0;
    for (let i = 0; i < pcm.length / 2; i++) { if (i < quiet) continue; if (Math.abs(pcm.readInt16LE(i * 2)) > 6000) { beeps.push(i / 48000); quiet = i + 24000; } }
    // Video: flash = bright yellow strip at the bottom for the first 2 frames of each source second. Stream a 1x1 probe pixel per frame.
    const flashes: number[] = await new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', ['-v', 'error', '-i', mp4, '-vf', 'crop=8:8:320:350,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const out: number[] = [];
      let n = 0;
      let prev = false;
      let carry = Buffer.alloc(0);
      p.stdout.on('data', (d: Buffer) => {
        const b = Buffer.concat([carry, d]);
        let o = 0;
        for (; o + 3 <= b.length; o += 3) { const on = b[o]! > 180 && b[o + 1]! > 160 && b[o + 2]! < 90; if (on && !prev) out.push(n / 30); prev = on; n++; }
        carry = b.subarray(o);
      });
      p.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(`ffmpeg ${c}`))));
    });
    // Pair each flash with the nearest beep.
    const offsets = flashes.map((ft) => { const b = beeps.reduce((best, x) => (Math.abs(x - ft) < Math.abs(best - ft) ? x : best), Infinity); return { t: ft, offsetMs: (b - ft) * 1000 }; });
    const abs = offsets.map((o) => Math.abs(o.offsetMs));
    const third = Math.floor(offsets.length / 3);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const firstMean = mean(offsets.slice(0, third).map((o) => o.offsetMs));
    const lastMean = mean(offsets.slice(-third).map((o) => o.offsetMs));
    const expectedEvents = SECONDS - 38; // seconds whose first frame survives the cut (37 full seconds removed, one more loses its flash/beep start)
    const report = {
      ranAt: new Date().toISOString(),
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu: 'none' },
      fixture: { seconds: SECONDS, frames: total, size: '640x360', fps: '30/1', bytes: fs.statSync(fixture.file).size, generateSeconds: +genSeconds.toFixed(1) },
      edit: { removedFrames: cutLen, atFrame: cutA, outputFrames: outFrames },
      export: { wallSeconds: +exportSeconds.toFixed(1), realtimeFactor: +((outFrames / 30) / exportSeconds).toFixed(2), frames: j.output.validation.frames, renderStageMs: j.output.renderStageMs, bytes: j.output.bytes },
      sync: { flashesDetected: flashes.length, beepsDetected: beeps.length, expectedEventsApprox: expectedEvents, maxAbsOffsetMs: +Math.max(...abs).toFixed(3), meanOffsetMs: +mean(offsets.map((o) => o.offsetMs)).toFixed(3), driftFirstThirdToLastThirdMs: +(lastMean - firstMean).toFixed(3), frameMs: 33.333 },
      pass: j.output.validation.frames === outFrames && flashes.length >= expectedEvents - 1 && Math.abs(flashes.length - beeps.length) <= 1 && Math.max(...abs) < 33.34 && Math.abs(lastMean - firstMean) < 1,
      criteria: 'frame count exact; every flash has a beep within one frame (33.3 ms); mean offset of the last third differs from the first third by < 1 ms (no cumulative drift)',
    };
    fs.writeFileSync(path.join(art, 'av-sync-long.json'), JSON.stringify(report, null, 2) + '\n');
    fs.copyFileSync(path.join(art, 'av-sync-long.json'), path.join(root, 'docs/evidence/av-sync-long.json'));
    console.log(JSON.stringify({ pass: report.pass, export: report.export, sync: report.sync }, null, 1));
    if (!report.pass) process.exitCode = 1;
  } catch (e) {
    // A crash must never look like a pass: record it as a failed check so the report says FAILED.
    console.error(e);
    process.exitCode = 1;
    throw e;
  } finally {
    await s.close();
    fs.rmSync(path.join(art, 'data'), { recursive: true, force: true });
    fs.rmSync(fixture.file, { force: true });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// PF_AVSYNC_MODE=incremental
// ---------------------------------------------------------------------------------------------------------------------------
/** Beep onsets in the exported sound and flash starts in the exported picture, paired by nearest time (as in main). */
async function measureSync(mp4: string) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', mp4, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  const beeps: number[] = [];
  let quiet = 0;
  for (let i = 0; i < pcm.length / 2; i++) { if (i < quiet) continue; if (Math.abs(pcm.readInt16LE(i * 2)) > 6000) { beeps.push(i / 48000); quiet = i + 24000; } }
  const flashes: number[] = await new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', mp4, '-vf', 'crop=8:8:320:350,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const out: number[] = [];
    let n = 0, prev = false;
    let carry: Buffer = Buffer.alloc(0);
    p.stdout.on('data', (d: Buffer) => {
      const b = Buffer.concat([carry, d]);
      let o = 0;
      for (; o + 3 <= b.length; o += 3) { const on = b[o]! > 180 && b[o + 1]! > 160 && b[o + 2]! < 90; if (on && !prev) out.push(n / 30); prev = on; n++; }
      carry = b.subarray(o);
    });
    p.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(`ffmpeg ${c}`))));
  });
  const offsets = flashes.map((ft) => { const b = beeps.reduce((best, x) => (Math.abs(x - ft) < Math.abs(best - ft) ? x : best), Infinity); return { t: ft, offsetMs: (b - ft) * 1000 }; });
  const abs = offsets.map((o) => Math.abs(o.offsetMs));
  const third = Math.floor(offsets.length / 3);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const firstMean = mean(offsets.slice(0, third).map((o) => o.offsetMs));
  const lastMean = mean(offsets.slice(-third).map((o) => o.offsetMs));
  return { flashesDetected: flashes.length, beepsDetected: beeps.length, maxAbsOffsetMs: +Math.max(...abs).toFixed(3), meanOffsetMs: +mean(offsets.map((o) => o.offsetMs)).toFixed(3), driftFirstThirdToLastThirdMs: +(lastMean - firstMean).toFixed(3), frameMs: 33.333 };
}

async function mainIncremental() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'long.mp4'), frames: SECONDS * 30 });
  const s = await startServer({ port: 8795, dataDir: path.join(art, 'data') });
  const call = async (token: string, p: string, body?: unknown, method?: string) => (await fetch(`${s.url}/api/v1${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { authorization: `Bearer ${token}`, connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })).json() as Promise<any>;
  const post = (p: string, body?: unknown) => call(s.auth.tokens.agent, p, body ?? {});
  const run = async (pid: string, options: object, tag: string) => {
    const t = Date.now();
    const job = await post(`/projects/${pid}/exports`, options);
    if (!job.jobId) throw new Error(`export refused: ${JSON.stringify(job).slice(0, 400)}`);
    let j: any;
    for (;;) { j = await call(s.auth.tokens.agent, `/jobs/${job.jobId}`); if (['succeeded', 'failed', 'canceled'].includes(j.status)) break; await sleep(2000); }
    if (j.status !== 'succeeded') throw new Error(`${tag} export failed: ${JSON.stringify(j.error)}`);
    return { job: j, seconds: (Date.now() - t) / 1000, file: path.join(s.cfg.dataDir, 'out', j.output.file) as string };
  };
  try {
    const pid = (await post('/projects', { name: 'avsync-incremental', width: 640, height: 360 })).project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'x-filename': 'long.mp4', connection: 'close' }, body: fs.readFileSync(fixture.file) })).json();
    if (!up.assetId) throw new Error(`upload failed: ${JSON.stringify(up)}`);
    // the same edit as the single-pass run: 37 s + 11 frames removed from the middle, the gap closed
    const total = SECONDS * 30;
    const cutA = Math.floor(total * 0.4) + 7;
    const cutLen = 37 * 30 + 11;
    const add = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] });
    const clip = add.results[0].output.clipId;
    const s1 = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'split_clip', args: { clipId: clip, at: f(cutA) } }] });
    const mid = s1.results[0].output.rightClipId;
    const s2 = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'split_clip', args: { clipId: mid, at: f(cutA + cutLen) } }] });
    const tail = s2.results[0].output.rightClipId;
    const fin = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'delete_clip', args: { clipId: mid } }, { op: 'move_clip', args: { clipId: tail, start: f(cutA) } }] });
    if (!fin.committed) throw new Error(`edit failed: ${JSON.stringify(fin)}`);
    const outFrames = total - cutLen;
    const expectedEvents = SECONDS - 38; // as in the single-pass run
    const INC = { mode: 'incremental', selfCheck: 'auto' } as const;
    const summary = (r: { job: any; seconds: number }) => ({ wallSeconds: +r.seconds.toFixed(1), frames: r.job.output.validation.frames, bytes: r.job.output.bytes, route: r.job.output.route, renderStageMs: r.job.output.renderStageMs, report: r.job.output.segments });

    // 1. the single pass, for the wall time to compare with (or the committed record)
    let singleSeconds: number, singleSource: string;
    if (process.env.PF_AVSYNC_SINGLE === '0') {
      singleSeconds = JSON.parse(fs.readFileSync(path.join(root, 'docs/evidence/av-sync-long.json'), 'utf8')).export.wallSeconds;
      singleSource = 'the committed record docs/evidence/av-sync-long.json (another run, another load)';
    } else {
      const single = await run(pid, {}, 'single-pass');
      singleSeconds = single.seconds;
      singleSource = 'measured here on the same project, one run';
      fs.rmSync(single.file, { force: true });
    }
    // 2. clean segmented export on an empty cache
    await call(s.auth.tokens.owner, '/storage/render-cache', undefined, 'DELETE');
    const clean = await run(pid, INC, 'clean segmented');
    const cleanSync = await measureSync(clean.file);
    // 3. one title at 5:00 (programme time), then the incremental export with the cache warm
    const title = await post(`/projects/${pid}/transactions`, { ops: [{ op: 'add_text', args: { text: 'כותרת במרכז', start: f(300 * 30), duration: f(60), transform: { y: 0 } } }] });
    if (!title.committed) throw new Error(`title failed: ${JSON.stringify(title)}`);
    const inc = await run(pid, INC, 'incremental');
    const incSync = await measureSync(inc.file);

    const ok = (m: typeof cleanSync) => m.flashesDetected >= expectedEvents - 1 && Math.abs(m.flashesDetected - m.beepsDetected) <= 1 && m.maxAbsOffsetMs <= 1 && Math.abs(m.driftFirstThirdToLastThirdMs) < 1;
    const report = {
      ranAt: new Date().toISOString(),
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu: 'none' },
      fixture: { seconds: SECONDS, frames: total, size: '640x360', fps: '30/1', bytes: fs.statSync(fixture.file).size },
      edit: { removedFrames: cutLen, atFrame: cutA, outputFrames: outFrames, thenTitleAtSeconds: 300 },
      times: { singlePassSeconds: +singleSeconds.toFixed(1), singlePassSource: singleSource, cleanSegmentedSeconds: +clean.seconds.toFixed(1), incrementalSeconds: +inc.seconds.toFixed(1), cleanOverSingle: +(clean.seconds / singleSeconds).toFixed(3), incrementalOverClean: +(inc.seconds / clean.seconds).toFixed(3) },
      clean: { ...summary(clean), sync: cleanSync },
      incremental: { ...summary(inc), sync: incSync },
      pass: clean.job.output.validation.frames === outFrames && inc.job.output.validation.frames === outFrames && ok(cleanSync) && ok(incSync) && clean.seconds / singleSeconds <= 1.25 && inc.seconds / clean.seconds <= 0.3,
      criteria: 'frame count exact on both files; every flash has a beep within 1 ms (max offset); no drift (last third against first third under 1 ms); clean segmented export at most 1.25 times the single pass; incremental export at most 30 % of the clean segmented export (target 15 %)',
    };
    fs.writeFileSync(path.join(art, 'av-sync-long-incremental.json'), JSON.stringify(report, null, 2) + '\n');
    fs.copyFileSync(path.join(art, 'av-sync-long-incremental.json'), path.join(root, 'docs/evidence/av-sync-long-incremental.json'));
    console.log(JSON.stringify({ pass: report.pass, times: report.times, cleanSync, incSync }, null, 1));
    if (!report.pass) process.exitCode = 1;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
    throw e;
  } finally {
    await s.close();
    fs.rmSync(path.join(art, 'data'), { recursive: true, force: true });
    fs.rmSync(fixture.file, { force: true });
  }
}
(MODE === 'incremental' ? mainIncremental() : main()).catch((e) => { console.error(e); process.exit(1); });
