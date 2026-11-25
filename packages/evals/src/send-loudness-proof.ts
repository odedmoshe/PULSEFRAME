/**
 * pnpm proof:send — loudness: clip match and master limiter (worker A) (wave 7, track send; .artifacts/wave7/send-decisions.md §4).
 * CPU only: ffmpeg and headless Chromium (needs `pnpm build` for the selftest page and the editor). Every fixture is synthetic,
 * made here with ffmpeg lavfi; nothing of the owner's. Every number is measured on what the routes produced; nobody has listened.
 *
 * Checks (each can fail; a check that needs another builder's part says BLOCKED and why, never passes):
 *  L1 measure_clip_loudness on F4 is within 0.1 LU of ffmpeg run here on the same audio; the 0.3 s clip is too_short
 *  L2 after the match every clip re-measures within 0.1 LU of the target; the click clip says limitedBy peak; one undo restores the document hash; a changed gain is refused stale_measurement; an old expectedRevision is refused
 *  L3 without a limiter the exported WAV is byte-identical to this proof's own run of unchanged mixToRaw + a frozen copy of the conversion command
 *  L4 with a limiter, a +6 dB mix: every 16-bit sample <= floor(10^(c/20)*32767), true peak <= c + 0.05 dB, samples outside the limiting window equal the unlimited export
 *  L5 a target the static gain misses (limitedByPeak) lands within 0.5 LU with the limiter; the report equals this proof's measurement
 *  L6 the same hash from the engine kernel in Node, on the selftest page, and from public/pf-master-limiter.js in an OfflineAudioContext
 *  L7 preview: limiter on -> the tap after it never exceeds the ceiling, reduction shown only in the loud part, «לפני הגברת הייצוא» shown with a loudness target; absent -> no worklet node and the Phase 0 preview-audio checks unchanged
 *  L8 a range export equals the full export from 125 ms after its start
 *
 *   pnpm build && tsx packages/evals/src/send-loudness-proof.ts      exit 0 = all passed, 1 = a check failed, 2 = blocked (nothing failed)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { canonical, timeOriginSeconds, type ProjectDocument } from '@pulseframe/core';
import { audioPlan } from '@pulseframe/engine';
import { limiterCeilingLinear, limiterFixture, limiterRun, limiterWindow } from '@pulseframe/engine/masterLimiter.ts';
import { startServer, type RunningServer } from '@pulseframe/server';
import { measureLoudness, mixToRaw, normalisationGain } from '@pulseframe/server/audiomix.ts';
import { evidenceRows } from './send-evidence.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/send-loudness');
const SR = 48000, FPS = { num: 30, den: 1 };
const fr = (n: number) => T.frameTime(n, FPS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 30 });
type State = 'ok' | 'FAIL' | 'BLOCKED';
const checks: { id: string; state: State; detail?: unknown }[] = [];
const check = (id: string, text: string, state: State | boolean, detail?: unknown) => {
  const st: State = state === true ? 'ok' : state === false ? 'FAIL' : state;
  checks.push({ id, state: st, detail });
  console.log(`${st === 'ok' ? '  ok     ' : st === 'FAIL' ? '  FAIL   ' : '  BLOCKED'} ${id} ${text}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 900)}` : ''}`);
};
const sha = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');
const r2 = (x: number) => Number(x.toFixed(2));
/** 16-bit samples of a WAV (interleaved stereo), read by its RIFF chunks */
function pcm16(file: string): Int16Array {
  const b = fs.readFileSync(file);
  let off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), len = b.readUInt32LE(off + 4);
    if (id === 'data') { const d = b.subarray(off + 8, off + 8 + Math.min(len, b.length - off - 8)); return new Int16Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)); }
    off += 8 + len + (len & 1);
  }
  throw new Error(`no data chunk in ${file}`);
}
/** ffmpeg's own R128 of a file (optionally of its first `seconds`): the reference, run here (the summary is on stderr) */
function ffR128e(file: string, seconds?: number): { I: number | null; TP: number | null } {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, ...(seconds !== undefined ? ['-t', String(seconds)] : []), '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const sum = p.stderr.slice(p.stderr.lastIndexOf('Summary:'));
  const num = (re: RegExp) => { const m = re.exec(sum); return m ? Number(m[1]) : null; };
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(path.join(art, 'fixtures'), { recursive: true });
  const gen = (name: string, l: string, r: string, seconds: number) => { const f = path.join(art, 'fixtures', `${name}.wav`); ff(['-f', 'lavfi', '-i', `aevalsrc=${l}|${r}:s=48000:d=${seconds}`, '-c:a', 'pcm_f32le', f]); return f; };
  // F4 levels: clips at known different levels, one with a single loud click, one of 0.3 s, one of 2 s
  const F4 = {
    soft: gen('soft', '0.05*sin(2*PI*220*t)', '0.05*sin(2*PI*220*t)', 6),
    noise: gen('noise', '0.2*(random(1)-0.5)', '0.2*(random(2)-0.5)', 6),
    mid: gen('mid', '0.3*sin(2*PI*1000*t)', '0.3*sin(2*PI*1000*t)', 6),
    click: gen('click', '0.04*sin(2*PI*330*t)+if(between(t\\,2\\,2.0001)\\,0.95\\,0)', '0.04*sin(2*PI*330*t)', 6),
    two: gen('two', '0.1*sin(2*PI*440*t)', '0.1*sin(2*PI*440*t)', 2),
    blip: gen('blip', '0.2*sin(2*PI*440*t)', '0.2*sin(2*PI*440*t)', 0.3),
  };
  const bed = gen('bed', '0.25*sin(2*PI*110*t)', '0.25*sin(2*PI*110*t)', 8);
  const hot = gen('hot', '0.9*sin(2*PI*110*t)', '-0.9*sin(2*PI*110*t)', 4);
  // a tone bed with a 5 ms 1 kHz burst near full scale every 2 s: the loudness is the bed's, and the static gain to a loud target is
  // stopped by the bursts' peak
  const bursts = '0.1*sin(2*PI*220*t)+if(lt(mod(t\\,2)\\,0.005)\\,0.9*sin(2*PI*1000*t)\\,0)';
  const loudBed = gen('bursts', bursts, bursts, 8);

  const s: RunningServer = await startServer({ port: 8871, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[], extra: Record<string, unknown> = {}) => { const r = await call(`/projects/${pid}/transactions`, { ops, ...extra }); if (r.status !== 200) throw new Error(`transaction refused: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const docOf = async (pid: string) => (await call(`/projects/${pid}`)).body.project as ProjectDocument;
  const docHash = (d: ProjectDocument) => sha(Buffer.from(canonical({ settings: d.settings, sequences: d.sequences, assets: d.assets })));
  const newProject = async (name: string) => (await call('/projects', { name, width: 320, height: 180 })).body.project.id as string;
  const upload = async (pid: string, file: string) => { const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json(); if (!up.assetId) throw new Error(`upload failed: ${JSON.stringify(up).slice(0, 300)}`); return up.assetId as string; };
  /** one audio track holding the given clips (frames at 30 fps) */
  const soundProject = async (name: string, clips: { file: string; at: number; frames: number; gain?: number }[]) => {
    const pid = await newProject(name);
    const trackId = (await tx(pid, [{ op: 'add_track', args: { kind: 'audio', name: 'sound' } }])).results[0].output.trackId as string;
    const ids: string[] = [];
    for (const c of clips) {
      const assetId = await upload(pid, c.file);
      const out = (await tx(pid, [{ op: 'add_clip', args: { assetId, trackId, start: fr(c.at), duration: fr(c.frames) } }])).results[0].output;
      const id = (out.audioClipId ?? out.clipId) as string;
      if (c.gain !== undefined) await tx(pid, [{ op: 'set_clip_gain', args: { clipId: id, gain: c.gain } }]);
      ids.push(id);
    }
    return { pid, ids };
  };
  const exportWav = async (pid: string, name: string, options: Record<string, unknown> = {}) => {
    const r = await call(`/projects/${pid}/exports`, { format: 'wav', ...options });
    if (!r.body.jobId) throw new Error(`export refused: ${JSON.stringify(r.body).slice(0, 400)}`);
    let job: any;
    for (;;) { job = (await call(`/jobs/${r.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
    if (job.status !== 'succeeded') throw new Error(`export ${job.status}: ${JSON.stringify(job.error)}`);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${r.body.jobId}/output`)).body);
    return { file, job };
  };
  const section = async (id: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { console.error(e); check(id, 'the block ran to its end', false, String((e as Error)?.stack ?? e).slice(0, 800)); } };
  const measurements: Record<string, unknown> = {};
  let browser: Browser | null = null;

  try {
    // ================= L1, L2: clip measurement and the match =================
    await section('L1/L2', async () => {
      const clips = [
        { file: F4.soft, at: 0, frames: 150 }, { file: F4.noise, at: 150, frames: 150 }, { file: F4.mid, at: 300, frames: 150 },
        { file: F4.click, at: 450, frames: 150 }, { file: F4.two, at: 600, frames: 60 }, { file: F4.blip, at: 660, frames: 9 },
      ];
      const { pid, ids } = await soundProject('F4 levels', clips);
      const m = await call(`/projects/${pid}/analysis/clip-loudness`, { clipIds: ids });
      if (m.status !== 200) throw new Error(`clip-loudness ${m.status}: ${JSON.stringify(m.body).slice(0, 300)}`);
      const rows = m.body.clips as any[];
      const L1 = rows.map((r, i) => {
        const seconds = clips[i]!.frames / 30;
        const ref = r.status === 'too_short' ? null : ffR128e(clips[i]!.file, seconds).I;
        return { clip: path.basename(clips[i]!.file), status: r.status, measured: r.measuredLufs, ffmpeg: ref, diff: ref === null || r.measuredLufs === null ? null : r2(r.measuredLufs - ref) };
      });
      measurements.L1 = { rows: L1, median: m.body.medianLufs, revision: m.body.revision };
      check('L1', 'measure_clip_loudness on F4 is within 0.1 LU of ffmpeg run here on the same audio; the 0.3 s clip is too_short (and the 2 s clip short)',
        L1.filter((x) => x.status !== 'too_short').every((x) => x.diff !== null && Math.abs(x.diff) <= 0.1) && L1[5]!.status === 'too_short' && L1[4]!.status === 'short', measurements.L1);

      const before = docHash(await docOf(pid));
      const target = -20;
      const matchArgs = (rs: any[]) => ({ target, clips: rs.filter((r) => r.measuredLufs !== null).map((r) => ({ clipId: r.clipId, measuredLufs: r.measuredLufs, peakDbfs: r.peakDbfs, gain: r.gain })) });
      const done = await tx(pid, [{ op: 'match_clip_loudness', args: matchArgs(rows) }], { expectedRevision: m.body.revision });
      const out = done.results[0].output.clips as any[];
      const again = await call(`/projects/${pid}/analysis/clip-loudness`, { clipIds: out.map((o) => o.clipId) });
      const re = (again.body.clips as any[]).map((r) => ({ clipId: r.clipId, lufs: r.measuredLufs, limitedBy: out.find((o) => o.clipId === r.clipId)!.limitedBy }));
      const clickId = ids[3]!;
      const onTarget = re.filter((r) => r.limitedBy === null).every((r) => Math.abs(r.lufs - target) <= 0.1);
      // undo restores the document
      const undo = await call(`/projects/${pid}/undo`, {});
      const after = docHash(await docOf(pid));
      // a changed gain is refused stale_measurement (measured values of before, no expectedRevision)
      await tx(pid, [{ op: 'set_clip_gain', args: { clipId: ids[0], gain: 0.5 } }]);
      const stale = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'match_clip_loudness', args: matchArgs(rows) }] });
      const old = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'match_clip_loudness', args: matchArgs(rows) }], expectedRevision: m.body.revision });
      measurements.L2 = { remeasured: re, undoStatus: undo.status, hashRestored: before === after, stale: { status: stale.status, code: stale.body?.error?.code, reason: stale.body?.error?.details?.reason }, oldRevision: { status: old.status, code: old.body?.error?.code } };
      check('L2', 'after the match every clip re-measures within 0.1 LU of the target; the click clip says limitedBy peak; one undo restores the document hash; a changed gain is refused stale_measurement; an old expectedRevision is refused',
        onTarget && out.find((o) => o.clipId === clickId)?.limitedBy === 'peak' && undo.status === 200 && before === after && stale.status !== 200 && stale.body?.error?.details?.reason === 'stale_measurement' && old.status !== 200, measurements.L2);
    });

    // ================= L3: byte identity without a limiter =================
    await section('L3', async () => {
      const { pid } = await soundProject('no limiter', [{ file: bed, at: 0, frames: 180 }, { file: hot, at: 30, frames: 15, gain: 2 }]);
      await tx(pid, [{ op: 'set_loudness_target', args: { target: -16, truePeak: -1 } }]);
      const { file, job } = await exportWav(pid, 'l3.wav');
      const d = await docOf(pid), plan = audioPlan(d);
      const raw = path.join(art, 'l3.f32'), ref = path.join(art, 'l3-ref.wav');
      await mixToRaw(plan, (id) => s.store.blobPath(d.assets[id]!.contentHash), 0, plan.totalSamples, raw, undefined, (id) => timeOriginSeconds(d.assets[id]), (id) => d.assets[id]?.audio?.channels === 1);
      const g = normalisationGain(await measureLoudness(raw, SR), plan.loudness!.target, plan.loudness!.truePeak).gainDb;
      // the conversion command of before wave 7 (audiomix.ts renderMix at e01c6cc), frozen here
      ff(['-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', raw, ...(g !== 0 ? ['-af', `volume=${g.toFixed(4)}dB`] : []), '-c:a', 'pcm_s16le', '-f', 'wav', ref]);
      fs.rmSync(raw);
      const a = sha(fs.readFileSync(file)), b = sha(fs.readFileSync(ref));
      measurements.L3 = { export: a, proof: b, gainDb: r2(g), limiterInOutput: job.output?.audio?.limiter ?? null };
      check('L3', "without a limiter the exported WAV is byte-identical to this proof's own run of unchanged mixToRaw + a frozen copy of the conversion command", a === b && g !== 0, measurements.L3);
    });

    // ================= L4, L8: the limiter on a +6 dB mix; a range =================
    let limPid = '';
    await section('L4/L8', async () => {
      const { pid } = await soundProject('limiter', [{ file: bed, at: 0, frames: 180 }, { file: hot, at: 30, frames: 15, gain: 2 }]);
      limPid = pid;
      const off = await exportWav(pid, 'l4-unlimited.wav');
      const ceiling = -1, top = Math.floor(10 ** (ceiling / 20) * 32767);
      await tx(pid, [{ op: 'set_master_limiter', args: { ceiling } }]);
      const on = await exportWav(pid, 'l4-limited.wav');
      const a = pcm16(off.file), b = pcm16(on.file);
      let peak = 0;
      for (const v of b) peak = Math.max(peak, Math.abs(v));
      const tp = ffR128e(on.file).TP;
      // the limiting window: from M before the first sample the unlimited export holds at or over the ceiling to 2M + release after
      // the last (the kernel's bound: a sample's gain depends on r over the M before and the M after it, and q releases in 120 ms)
      const { lookahead: M, release: R } = limiterWindow(SR);
      let first = -1, last = -1;
      for (let i = 0; i < a.length / 2; i++) if (Math.max(Math.abs(a[i * 2]!), Math.abs(a[i * 2 + 1]!)) >= top) { if (first < 0) first = i; last = i; }
      let diff = 0, outside = 0;
      for (let i = 0; i < a.length / 2; i++) {
        if (i >= first - M && i <= last + 2 * M + R) continue;
        outside++;
        if (a[i * 2] !== b[i * 2] || a[i * 2 + 1] !== b[i * 2 + 1]) diff++;
      }
      measurements.L4 = { peakSample: peak, ceilingSample: top, truePeakDbtp: tp, window: { fromSample: first - M, toSample: last + 2 * M + R }, samplesOutside: outside, differentOutside: diff, sameLength: a.length === b.length, jobLimiterReport: on.job.output?.audio?.limiter ?? null };
      check('L4', 'with a limiter, a +6 dB mix: every 16-bit sample <= floor(10^(c/20)*32767), true peak <= c + 0.05 dB, samples outside the limiting window (M before the first sample at the ceiling to 2M + 120 ms after the last) equal the unlimited export; the export job reports its limiter',
        peak <= top && tp !== null && tp <= ceiling + 0.05 && first >= 0 && diff === 0 && outside > SR && a.length === b.length && on.job.output?.audio?.limiter?.ceiling === ceiling, measurements.L4);

      // L8: a range starting inside the hot stretch (frame 33 = 1.1 s, where the limiter holds) against the full export
      const part = await exportWav(pid, 'l8-range.wav', { range: { startFrame: 33, endFrame: 120 } });
      const p = pcm16(part.file), first8 = T.nearestSampleIndex(fr(33), SR), from = Math.round(0.125 * SR);
      let d8 = 0, n8 = 0, early = 0;
      for (let j = 0; j < p.length / 2; j++) {
        const same = p[j * 2] === b[(first8 + j) * 2] && p[j * 2 + 1] === b[(first8 + j) * 2 + 1];
        if (j < from) { if (!same) early++; continue; }
        n8++;
        if (!same) d8++;
      }
      measurements.L8 = { rangeFirstSample: first8, compared: n8, different: d8, differentInFirst125ms: early };
      check('L8', 'a range export equals the full export from 125 ms after its start', n8 > SR && d8 === 0, measurements.L8);
    });

    // ================= L5: a target the static gain misses =================
    await section('L5', async () => {
      const { pid } = await soundProject('target', [{ file: loudBed, at: 0, frames: 240 }]);
      const target = -14;
      await tx(pid, [{ op: 'set_loudness_target', args: { target, truePeak: -1 } }]);
      const plain = await exportWav(pid, 'l5-static.wav');
      await tx(pid, [{ op: 'set_master_limiter', args: { ceiling: -1 } }]);
      const lim = await exportWav(pid, 'l5-limited.wav');
      const mine = ffR128e(lim.file);
      const report = lim.job.output?.audio?.limiter;
      const ml = (await call(`/projects/${pid}/analysis/loudness`, {})).body;
      measurements.L5 = { staticLimitedByPeak: plain.job.output?.audio?.loudness?.limitedByPeak, staticGainDb: plain.job.output?.audio?.loudness?.appliedGainDb, measuredHere: mine, jobReport: report ?? null, measureLoudnessReport: ml.limiter };
      const lands = plain.job.output?.audio?.loudness?.limitedByPeak === true && mine.I !== null && Math.abs(mine.I - target) <= 0.5;
      const mlEquals = ml.limiter && ml.limiter.achievedLufs === mine.I && ml.limiter.truePeakDbtp === mine.TP;
      if (report) check('L5', "a target the static gain misses (limitedByPeak) lands within 0.5 LU with the limiter; the export's report equals this proof's measurement", lands && report.achievedLufs === mine.I && report.truePeakDbtp === mine.TP && !!mlEquals, measurements.L5);
      else if (!lands || !mlEquals) check('L5', 'a target the static gain misses lands within 0.5 LU with the limiter; measure_loudness reports what this proof measures on the export', false, measurements.L5);
      else check('L5', "lands within 0.5 LU and measure_loudness's limiter report equals this proof's measurement of the exported WAV; the export job's own report is not in its output yet (export.ts output.audio must carry MixResult.limiter: worker B / lead)", 'BLOCKED', measurements.L5);
    });

    // ================= L6: one hash in Node, on the selftest page, and from the public worklet file =================
    await section('L6', async () => {
      const node = limiterRun(limiterFixture(SR, 2), SR, -1, 128);
      const nodeHash = sha(new Uint8Array(node.out.buffer, node.out.byteOffset, node.out.byteLength));
      browser ??= await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
      const st = await browser.newPage();
      await st.goto(`${s.url}/selftest.html`);
      await st.waitForFunction(() => document.body.dataset.ready === '1' && typeof (window as any).__pfLimiterRun === 'function', undefined, { timeout: 60000 });
      const page = await st.evaluate(() => (window as any).__pfLimiterRun(48000, 2, -1));
      const worklet = await st.evaluate(() => (window as any).__pfLimiterWorkletRun(48000, 2, -1));
      await st.close();
      measurements.L6 = { node: nodeHash, selftestKernel: page, publicWorkletFile: worklet, limited: node.stats };
      check('L6', 'the same hash from the engine kernel in Node, on the selftest page, and from public/pf-master-limiter.js in an OfflineAudioContext', nodeHash === page.sha256 && nodeHash === worklet.sha256 && node.stats.limitedSamples > 0, measurements.L6);
    });

    // ================= L7: preview =================
    await section('L7', async () => {
      if (!limPid) throw new Error('the L4 project is missing');
      browser ??= await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
      const openEditor = async (pid: string): Promise<Page> => {
        const page = await browser!.newPage({ viewport: { width: 1500, height: 950 } });
        await page.addInitScript(() => { (window as any).__pfAudioTap = true; try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
        await page.goto(`${s.ownerUrl}&project=${pid}`);
        await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 30000 });
        await page.waitForFunction(() => !!(window as any).__pfPlayer?.doc, undefined, { timeout: 30000 });
        return page;
      };
      const playFor = (page: Page, seconds: number) => page.evaluate(async (seconds) => {
        const p = (window as any).__pfPlayer;
        p.seek(0);
        await p.play();
        const reductions: (number | null)[] = [];
        const t = performance.now();
        while (performance.now() - t < seconds * 1000) { await new Promise((r) => setTimeout(r, 100)); reductions.push(p.limiterReductionDb()); }
        const stats = p.syncStats();
        p.pause();
        return { stats, polled: reductions };
      }, seconds);
      const c = limiterCeilingLinear(-1);
      await tx(limPid, [{ op: 'set_loudness_target', args: { target: -16, truePeak: -1 } }]);
      const page = await openEditor(limPid);
      const on = await playFor(page, 3.2);
      // the note sits in the sound panel's meter (LimiterSwitch.tsx ReductionMeter, test id meter-before-export-gain): read that element
      await page.getByTestId('meter-before-export-gain').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
      const noteText = (await page.getByTestId('meter-before-export-gain').textContent().catch(() => null))?.trim() ?? null;
      const note = !!noteText && noteText.includes('לפני הגברת הייצוא');
      await page.close();
      const lv: { t: number; peak: number }[] = on.stats.audioLevels ?? [];
      const red: { t: number; reductionDb: number }[] = on.stats.limiter?.reductions ?? [];
      const loud = red.filter((x) => x.reductionDb < -0.5);
      // the hot clip plays 1.0–1.5 s; a 50 ms window and the 5 ms look-ahead may reach a little either side, the release 120 ms after
      const onlyInLoudPart = loud.length > 0 && loud.every((x) => x.t >= 0.9 && x.t <= 1.5 + 0.2);
      const underCeiling = lv.length > 0 && lv.every((x) => x.peak <= Number(c.toFixed(4)) + 0.00005);
      await tx(limPid, [{ op: 'set_master_limiter', args: { ceiling: null } }]);
      const page2 = await openEditor(limPid);
      const offRun = await playFor(page2, 1.5);
      await page2.close();
      measurements.L7 = { clock: on.stats.clock, limiter: { ...on.stats.limiter, reductions: red.length }, loudWindows: loud, maxTapPeak: Math.max(0, ...lv.map((x) => x.peak)), ceilingLinear: c, tapWindows: lv.length, noteShown: note, noteText, withoutLimiter: { active: offRun.stats.limiter?.active, polled: [...new Set(offRun.polled)] } };
      check('L7a', 'preview, limiter on: the tap after it never exceeds the ceiling and the reduction is shown only in the loud part (on the audio clock)', on.stats.clock === 'audio' && on.stats.limiter?.active === true && underCeiling && onlyInLoudPart, measurements.L7);
      check('L7b', 'preview, limiter absent: no worklet node (the graph of before) and no reduction reported', offRun.stats.limiter?.active === false && offRun.polled.every((x) => x === null), measurements.L7);
      check('L7c', 'the sound panel\'s meter says «לפני הגברת הייצוא» with a loudness target and the limiter on (element meter-before-export-gain of the open editor)', note, { noteText });
      // L7d: the Phase 0 preview-audio checks (phase0-proof.ts) are read from its evidence, which must be recorded on this build
      const p0 = evidenceRows('phase0-proof.json', /^preview audio|^preview playback|^preview: playback/, 'pnpm proof');
      check('L7d', 'the Phase 0 preview-audio checks unchanged (rows "preview audio …" / "preview playback …" of phase0-proof, read from its evidence)', p0.state === 'pass' ? true : p0.state === 'fail' ? false : 'BLOCKED', p0);
    });
  } finally {
    if (browser) await (browser as Browser).close();
    await s.close();
    fs.rmSync(path.join(art, 'data'), { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(art, 'results.json'), JSON.stringify({ checks, measurements }, null, 2));
  const failed = checks.filter((c) => c.state === 'FAIL').length, blocked = checks.filter((c) => c.state === 'BLOCKED').length;
  console.log(`send-loudness-proof: ${checks.filter((c) => c.state === 'ok').length} ok, ${failed} failed, ${blocked} blocked (one sample each; results in .artifacts/send-loudness/results.json)`);
  process.exit(failed ? 1 : blocked ? 2 : 0);
}
void main().catch((e) => { console.error(e); process.exit(1); });
