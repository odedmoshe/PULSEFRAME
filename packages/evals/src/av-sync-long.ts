/**
 * Long-form A/V synchronisation (SPEC Appendix C3 "Synchronization"): export a ten-minute flash/beep
 * fixture with an edit in the middle and measure, for every second, the offset between the flash in
 * the exported picture and the beep in the exported audio. Reports drift, not just a pass flag.
 *
 *   pnpm build && pnpm conformance:avsync        (PF_AVSYNC_SECONDS=600 by default)
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

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
  } finally {
    await s.close();
    fs.rmSync(path.join(art, 'data'), { recursive: true, force: true });
    fs.rmSync(fixture.file, { force: true });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
