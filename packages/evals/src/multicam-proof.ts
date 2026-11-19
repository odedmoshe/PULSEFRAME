/**
 * `pnpm proof:multicam` — the server proof of multicam (ADR-0020, plan §4–§7, W2), CPU only, no model. Evidence:
 * .artifacts/multicam/multicam-proof.json and docs/evidence/multicam-proof.json: every measured number with its budget and
 * pass or fail. The lead runs it after merging and `pnpm build`. Exit codes: 0 = every check passed; 1 = a check failed (its
 * numbers are in the evidence, never relaxed); 2 = blocked (a part not built on this tree, or a prerequisite missing: listed
 * under `blocked` with its reason).
 *
 * Fixtures: packages/fixtures/src/multicam.ts (seeded speech from docs/demo/narration-sample-he.m4a; the truth is the
 * construction: offsets, drift, polarity; barcode red = group frame, green = angle index).
 * - M1 sync to the sample: cameras 1 and 2 recover their offsets to ≤ 1 sample through REST, in the request (dry run) and as
 *   a background job that commits; the committed anchors are the same numbers.
 * - M2 drift: camera 3 |ppm − 100| ≤ 2; its committed map is within 2 samples of the truth at 10 probes per file; the second
 *   file (after the card change) is placed.
 * - M3 time: envelopes + sync of 3 × 10 min (sound only) on this CPU, target ≤ 60 s, and one 60-minute run (PF_MULTICAM_LONG=0
 *   skips it, recorded as not run); a miss is reported, not hidden.
 * - M4 edit and export: place_multicam, 60 switch_angles, cut_range, insert_gap, trims and a delete_transcript_range, then a
 *   server export. At every cut ±2 frames the barcode gives the planned angle and exactly the group frame of the source frame
 *   the evaluator shows (0 mismatches), within one frame of the program's group time. The exported sound cross-correlates
 *   with the recorder at lag 0 ± 1 sample at 20 windows (avsync method). A drifting camera's sound laid as chunks stays
 *   within ± 1 ms at 20 windows; 'listened' is recorded as NOT done.
 * - M5 undo of a 1000-cut switch gives an equal creativeProjection; the time of the switch and of the undo are recorded.
 * - M6 auto-switch on the dialogue fixture: the active speaker's shot on ≥ 90 % of single-speaker speech (outside the first
 *   minShot + switchHold + preRoll of each turn); wide on ≥ 80 % of overlaps ≥ 1 s; 0 shots < minShot; the heuristic label is
 *   present; planning time for a 60-minute program recorded.
 * - M7 the loop-only, noise-only and paused cameras get ambiguous, no-shared-sound and inconsistent, attach 0 anchors, and the
 *   job output names each angle.
 * - M8 at 1000 segments: document bytes, commit p95 and GET project p95 recorded.
 *
 *   pnpm build && pnpm proof:multicam
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { applyTransaction, creativeProjection, createProject, groupTimeAt, masterGroupTimeAt, MULTICAM_AUTO_LABEL, MULTICAM_OPS_BUILT, planMulticamAuto, type LevelEnvelope, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { readBarcodeChannel } from '@pulseframe/fixtures';
import { generateMulticamFixture, type MulticamFixture } from '@pulseframe/fixtures/multicam.ts';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/multicam');
const evidenceFiles = [path.join(art, 'multicam-proof.json'), path.join(root, 'docs/evidence/multicam-proof.json')];
const narration = path.join(root, 'docs/demo/narration-sample-he.m4a');
const R = { num: 30, den: 1 }, SR = 48000, W = 320, H = 180;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const r2 = (v: number) => Number(v.toFixed(2));
const pct = (v: number[], p: number) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };
const f = (n: number) => T.frameTime(n, R);

// ---------- evidence ----------
interface Row { id: string; name: string; value: unknown; budget: string; pass: boolean }
const rows: Row[] = [];
const blocked: { id: string; reason: string }[] = [];
const measurements: Record<string, unknown> = {};
const check = (id: string, name: string, pass: boolean, value: unknown, budget: string) => { rows.push({ id, name, value, budget, pass }); console.log(`${pass ? '  ok  ' : ' FAIL '} ${id} ${name}  ${JSON.stringify(value)}  (budget ${budget})`); };
class Blocked extends Error {}
async function section(id: string, fn: () => Promise<void>) {
  console.log(`\n# ${id}`);
  try { await fn(); } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Blocked || /not_built|not built yet/.test(msg)) { blocked.push({ id, reason: msg.slice(0, 400) }); console.log(` BLOCKED ${id}: ${msg.slice(0, 300)}`); }
    else check(id, 'section ran to its end', false, msg.slice(0, 400), 'no error');
  }
}
const pcm = (file: string, channels = 1) => { const b = ff(['-i', file, '-map', '0:a:0', '-ac', String(channels), '-ar', String(SR), '-f', 'f32le', '-']); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~3))); };
/** Integer lag d (|d| ≤ maxLag) maximising Σ a[i]·b[i + d] over a window; the avsync method: plain cross-correlation. */
function lagOf(a: Float32Array, a0: number, b: Float32Array, b0: number, n: number, maxLag: number): number {
  let best = 0, bestV = -Infinity;
  for (let d = -maxLag; d <= maxLag; d++) {
    let s = 0;
    for (let i = 0; i < n; i++) { const j = b0 + i + d; if (j >= 0 && j < b.length && a0 + i < a.length) s += a[a0 + i]! * b[j]!; }
    if (s > bestV) { bestV = s; best = d; }
  }
  return best;
}
/** RMS of a[a0 .. a0 + n). */
const rms = (a: Float32Array, a0: number, n: number) => { let e = 0; for (let i = 0; i < n; i++) e += (a[a0 + i] ?? 0) ** 2; return Math.sqrt(e / n); };
/**
 * A window where both signals have sound: the lag is meaningless in a pause (every lag correlates to 0 and the search answers
 * its first candidate, −maxLag). From the planned timeline time, step forward a quarter second at a time (at most 4 s) to the
 * first window where both RMS are ≥ 0.02 (−34 dBFS); null when there is none. `at` gives the reference sample for a timeline
 * time. (In a quieter window, after AAC, the plain correlation's broad low-pitch peak was seen to move: one window at RMS 0.012
 * read lag 5 with a ½ s window and 0 with ⅛ s and ¼ s windows.)
 */
function soundedWindow(a: Float32Array, b: Float32Array, t0: number, n: number, at: (t: number) => number | null): { a0: number; b0: number } | null {
  for (let k = 0; k <= 16; k++) {
    const t = t0 + k * 0.25, b0 = at(t);
    if (b0 === null) continue;
    const a0 = Math.round(t * SR);
    if (rms(a, a0, n) >= 0.02 && rms(b, b0, n) >= 0.02) return { a0, b0 };
  }
  return null;
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  for (const e of evidenceFiles) fs.mkdirSync(path.dirname(e), { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Blocked('web bundle missing: run `pnpm build` first');
  if (!MULTICAM_OPS_BUILT) throw new Blocked('the multicam operations (W1) are not built in this tree');
  const tGen = Date.now();
  const fx = await generateMulticamFixture({ outDir: path.join(art, 'fx'), seconds: 150, seed: 7, narrationPath: narration, extras: true });
  const dx = await generateMulticamFixture({ outDir: path.join(art, 'dialogue'), seconds: 120, seed: 9, narrationPath: narration, dialogue: true });
  measurements.fixtures = { mainSeconds: 150, dialogueSeconds: 120, angles: fx.angles.map((a) => ({ label: a.label, files: a.files.length, expect: a.expect })), turns: dx.turns.length, generateSeconds: r2((Date.now() - tGen) / 1000) };
  const server = await startServer({ port: 8857, dataDir: path.join(art, 'data'), webDist: path.join(root, 'apps/web/dist') });
  const h = { authorization: `Bearer ${server.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown, method?: string) => {
    const r = await fetch(`${server.url}/api/v1${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const must = async (p: string, body?: unknown, want = [200]) => { const r = await call(p, body); if (!want.includes(r.status)) throw new Error(`${p} → ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`); return r.body; };
  const tx = (pid: string, ops: unknown[]) => must(`/projects/${pid}/transactions`, { ops });
  const doc = async (pid: string) => (await must(`/projects/${pid}`)).project as ProjectDocument;
  const waitJob = async (id: string, ms = 3_600_000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${id} did not finish`); await sleep(200); } };
  const upload = async (pid: string, file: string) => (await (await fetch(`${server.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  let exports = 0;
  const exportFile = async (pid: string, options: Record<string, unknown>, ext = 'mp4') => {
    const st = await call(`/projects/${pid}/exports`, options);
    if (st.status !== 202) throw new Error(`export refused ${st.status}: ${JSON.stringify(st.body?.error ?? st.body).slice(0, 300)}`);
    const job = await waitJob(st.body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
    const file = path.join(art, `export-${++exports}.${ext}`);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    return file;
  };
  /** A project holding the fixture as one group (angles in fixture order; the recorder is the reference). */
  const groupOf = async (name: string, x: MulticamFixture) => {
    const pid = (await must('/projects', { name, width: W, height: H, frameRate: R }, [201])).project.id as string;
    const assets: string[][] = [];
    for (const a of x.angles) assets.push(await Promise.all(a.files.map(async (file) => (await upload(pid, file.path)).assetId as string)));
    const r = await tx(pid, [{ op: 'create_multicam', args: { name, angles: x.angles.map((a, i) => ({ label: a.label, kind: a.kind, assetIds: assets[i]! })), referenceAngleIndex: 0 } }]);
    const out = r.results[0].output as { groupId: string; angleIds: string[] };
    return { pid, groupId: out.groupId, angleIds: out.angleIds, assets };
  };
  const commitP95 = async (pid: string, sequenceId: string, trackId: string, n = 30) => { const ms: number[] = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); await tx(pid, [{ op: 'update_track', args: { sequenceId, trackId, name: `V ${i}` } }]); ms.push(performance.now() - t0); } return r2(pct(ms, 95)); };

  try {
    const main = await groupOf('multicam proof', fx);
    const cam = (i: number) => main.angleIds[i]!;
    let jobReport: any = null;
    // ---------- M1, M2, M7: sync ----------
    await section('M1', async () => {
      const dry = await must(`/projects/${main.pid}/multicam/${main.groupId}/sync`, { dryRun: true });
      measurements.dryRunTimingsMs = dry.timingsMs;
      const started = await must(`/projects/${main.pid}/multicam/${main.groupId}/sync`, { background: true }, [202]);
      const job = await waitJob(started.jobId);
      if (job.status !== 'succeeded') throw new Error(`sync job ${job.status}: ${JSON.stringify(job.error)}`);
      jobReport = job.output;
      const d = await doc(main.pid);
      const g = d.multicam![main.groupId]!;
      for (const i of [1, 2]) {
        const truth = fx.angles[i]!.files[0]!.groupStartSamples;
        const inReq = Math.round(dry.pieces.find((p: any) => p.angleId === cam(i)).offsetSeconds * SR);
        const viaJob = Math.round(job.output.report.pieces.find((p: any) => p.angleId === cam(i)).offsetSeconds * SR);
        const a = g.angles.find((x) => x.id === cam(i))!.pieces[0]!.anchors[0]!;
        const committed = T.nearestSampleIndex(a.group, SR) - T.nearestSampleIndex(a.source, SR);
        check('M1', `${fx.angles[i]!.label}: offset to the sample (in the request, as a job, committed)`, [inReq, viaJob, committed].every((v) => Math.abs(v - truth) <= 1), { truth, inRequest: inReq, job: viaJob, committed }, '≤ 1 sample');
      }
    });
    await section('M2', async () => {
      const d = await doc(main.pid);
      const a = d.multicam![main.groupId]!.angles.find((x) => x.id === cam(3))!;
      const truth = fx.angles[3]!;
      const rep = jobReport?.report?.pieces?.filter((p: any) => p.angleId === cam(3)) ?? [];
      check('M2', 'drift of camera 3', rep.length === 2 && rep.every((p: any) => Math.abs(p.driftPpm - 100) <= 2), rep.map((p: any) => p.driftPpm), '|ppm − 100| ≤ 2 on both files');
      const errs: number[] = [];
      a.pieces.forEach((piece, k) => {
        const len = T.toSeconds(d.assets[piece.assetId]!.duration) * SR;
        const m = piece.anchors.map((x) => ({ s: T.nearestSampleIndex(x.source, SR), g: T.nearestSampleIndex(x.group, SR) }));
        for (let p = 0; p < 10; p++) {
          const s = ((p + 0.5) / 10) * len;
          const seg = m.length === 1 ? [m[0]!, { s: m[0]!.s + 1, g: m[0]!.g + 1 }] : [m[0]!, m[m.length - 1]!];
          const got = seg[0]!.g + ((s - seg[0]!.s) * (seg[1]!.g - seg[0]!.g)) / (seg[1]!.s - seg[0]!.s);
          errs.push(Math.abs(got - (truth.files[k]!.groupStartSamples + s * (1 + truth.truth.driftPpm * 1e-6))));
        }
      });
      check('M2', 'map error at 10 probes per file', errs.length === 20 && Math.max(...errs) <= 2, { maxSamples: r2(Math.max(...errs)) }, '≤ 2 samples');
      check('M2', 'the second file after the card change is placed', a.pieces.length === 2 && a.pieces[1]!.anchors.length > 0 && ['confident', 'check'].includes(a.pieces[1]!.quality.verdict), a.pieces.map((p) => [p.quality.verdict, p.quality.chainDepth]), 'placed');
    });
    await section('M7', async () => {
      const d = await doc(main.pid);
      const g = d.multicam![main.groupId]!;
      for (const i of [4, 5, 6]) {
        const want = fx.angles[i]!.expect, piece = g.angles.find((x) => x.id === cam(i))!.pieces[0]!;
        const named = jobReport?.angles?.find((x: any) => x.angleId === cam(i));
        check('M7', `${fx.angles[i]!.label}`, piece.quality.verdict === want && piece.anchors.length === 0 && named?.label === fx.angles[i]!.label, { verdict: piece.quality.verdict, anchors: piece.anchors.length, jobNames: named?.label ?? null }, `${want}, 0 anchors, named in the job output`);
      }
    });

    // ---------- M4: place, edit, export ----------
    await section('M4', async () => {
      const placed = (await tx(main.pid, [{ op: 'place_multicam', args: { groupId: main.groupId, at: T.ZERO, angleId: cam(1), fill: true } }])).results[0].output as { sequenceId: string; videoTrackId: string; soundTrackIds: string[] };
      let d = await doc(main.pid);
      const seqId = placed.sequenceId, trackId = placed.videoTrackId;
      const end = () => Math.max(...d.sequences[seqId]!.tracks.find((t) => t.id === trackId)!.clips.map((c) => T.frameIndexAt(T.add(c.start, c.duration), R)));
      // 60 single switches spread over the program, cycling the cameras
      const total = end(), plannedCuts: { frame: number; angle: number }[] = [];
      for (let k = 0; k < 60; k++) {
        const frame = Math.round(((k + 0.5) * (total - 60)) / 60) + 15, angle = 1 + (k % 3);
        await tx(main.pid, [{ op: 'switch_angles', args: { groupId: main.groupId, sequenceId: seqId, trackId, cuts: [{ at: f(frame), angleId: cam(angle) }], until: { at: f(Math.min(total, frame + 45)) }, coverage: 'clip' } }]);
        plannedCuts.push({ frame, angle });
      }
      // a transcript on the recorder, so a delete_transcript_range has words to remove
      const words = Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, start: T.rt(60 + i, 1), duration: T.rt(1, 2) }));
      const ts = await tx(main.pid, [{ op: 'set_transcript', args: { assetId: main.assets[0]![0]!, language: 'he', origin: 'manual', segments: [{ start: T.rt(60, 1), duration: T.rt(40, 1), text: words.map((w) => w.text).join(' '), words }] } }]);
      void ts;
      d = await doc(main.pid);
      const tr = d.transcripts[main.assets[0]![0]!]!;
      const w = tr.segments[0]!.words;
      const vclips = () => d.sequences[seqId]!.tracks.find((t) => t.id === trackId)!.clips;
      await tx(main.pid, [{ op: 'cut_range', args: { sequenceId: seqId, start: f(300), end: f(345) } }]);
      await tx(main.pid, [{ op: 'insert_gap', args: { sequenceId: seqId, at: f(900), duration: f(30) } }]);
      d = await doc(main.pid);
      const c5 = vclips()[5]!, c9 = vclips()[9]!;
      await tx(main.pid, [{ op: 'trim_clip', args: { clipId: c5.id, edge: 'end', to: T.sub(T.add(c5.start, c5.duration), f(4)) } }]);
      await tx(main.pid, [{ op: 'trim_clip', args: { clipId: c9.id, edge: 'start', to: T.add(c9.start, f(3)) } }]);
      await tx(main.pid, [{ op: 'delete_transcript_range', args: { sequenceId: seqId, assetId: main.assets[0]![0]!, fromWordId: w[10]!.id, toWordId: w[14]!.id } }]);
      d = await doc(main.pid);
      measurements.m4 = { segments: vclips().length, frames: end() };
      const mp4 = await exportFile(main.pid, { sequenceId: seqId });
      // picture: at every segment boundary ±2 frames
      const bounds = [...new Set(vclips().flatMap((c) => [T.frameIndexAt(c.start, R)]))].filter((x) => x > 2 && x < end() - 3);
      let mismatches = 0, offByOne = 0, checked = 0;
      const truthOf = (assetId: string) => { for (const [i, a] of fx.angles.entries()) for (const [k, file] of a.files.entries()) if (main.assets[i]![k] === assetId) return { angle: i, file, ppm: a.truth.driftPpm }; return null; };
      const samples: unknown[] = [];
      for (const b of bounds) for (let df = -2; df <= 2; df++) {
        const fr = b + df;
        const layer = evaluate(d, f(fr), seqId).layers.find((l) => l.kind === 'video' && l.trackId === trackId) as { assetId: string; sourceFrameIndex: number } | undefined;
        if (!layer) continue;
        const t = truthOf(layer.assetId);
        if (!t) continue;
        const want = Math.round((t.file.groupStartSamples / SR + (layer.sourceFrameIndex / 30) * (1 + t.ppm * 1e-6)) * 30);
        const img = ff(['-i', mp4, '-vf', `select=eq(n\\,${fr})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        const rect = { x: 0, y: 0, w: W, h: H };
        const gotFrame = readBarcodeChannel(img, W, 3, rect, 0), gotAngle = readBarcodeChannel(img, W, 3, rect, 1);
        const gp = groupTimeAt(d, seqId, trackId, f(fr));
        const progFrame = gp ? Math.round(T.toSeconds(gp.g) * 30) : null;
        checked++;
        if (gotAngle !== t.angle || gotFrame !== ((want % 65536) + 65536) % 65536) { mismatches++; if (samples.length < 10) samples.push({ frame: fr, gotFrame, want, gotAngle, wantAngle: t.angle }); }
        if (progFrame !== null && Math.abs(gotFrame - progFrame) === 1) offByOne++;
        if (progFrame !== null && Math.abs(gotFrame - progFrame) > 1) { mismatches++; if (samples.length < 10) samples.push({ frame: fr, gotFrame, progFrame }); }
      }
      const angleAtCuts = plannedCuts.length;
      check('M4', 'barcode at every cut ±2 frames: planned angle and exact group frame', checked > 0 && mismatches === 0, { checked, mismatches, offByOneAgainstProgramGroupTime: offByOne, plannedCuts: angleAtCuts, samples }, '0 mismatches');
      // sound: export vs the recorder at 20 windows
      const out = pcm(mp4), rec = pcm(fx.angles[0]!.files[0]!.path);
      const lags: number[] = [];
      let silentM = 0;
      for (let k = 0; k < 20; k++) {
        const fr = Math.round(((k + 0.5) * end()) / 20);
        // the recorder sample at the master's group time of a timeline time (whole seconds of timeline → the nearest frame time)
        const w = soundedWindow(out, rec, fr / 30, SR / 2, (ts) => { const g = masterGroupTimeAt(d, seqId, main.groupId, T.rt(Math.round(ts * SR), SR)); return g ? Math.round(T.toSeconds(g) * SR) : null; });
        if (!w) { silentM++; continue; }
        lags.push(lagOf(out, w.a0, rec, w.b0, SR / 2, 200));
      }
      check('M4', 'exported sound against the recorder (avsync method)', lags.length >= 15 && lags.every((l) => Math.abs(l) <= 1), { windows: lags.length, noSoundedWindow: silentM, lags }, 'lag 0 ± 1 sample at ≥ 15 windows with sound');
      // a drifting camera's sound laid as chunks, alone in a new sequence
      const chunked = (await tx(main.pid, [{ op: 'place_multicam', args: { groupId: main.groupId, newSequence: { name: 'chunks' }, at: T.ZERO, angleId: cam(3), sound: [cam(3)] } }])).results[0].output as { sequenceId: string; soundChunks: number; maxSoundErrorSeconds: number };
      d = await doc(main.pid);
      const wav = await exportFile(main.pid, { sequenceId: chunked.sequenceId, format: 'wav' }, 'wav');
      const cw = pcm(wav), cl: number[] = [];
      // The reference is the truth, not the document: this sequence has no master sound (masterGroupTimeAt is null there), and
      // its picture's group time moves in whole frames of the drifting camera. The program starts where camera 3's first file
      // starts (fixture groupStartSamples) and runs at one group second per timeline second, so timeline t is group time g0 + t.
      const g0 = fx.angles[3]!.files[0]!.groupStartSamples;
      const firstPicture = groupTimeAt(d, chunked.sequenceId, d.sequences[chunked.sequenceId]!.tracks.find((t) => t.kind === 'video' && t.clips.length)!.id, T.ZERO);
      let silentC = 0;
      for (let k = 0; k < 20; k++) {
        const w = soundedWindow(cw, rec, ((k + 0.5) * (cw.length / SR)) / 20, SR / 4, (ts) => g0 + Math.round(ts * SR));
        if (!w) { silentC++; continue; }
        cl.push(lagOf(cw, w.a0, rec, w.b0, SR / 4, 96));
      }
      measurements.soundChunks = { chunks: chunked.soundChunks, maxSoundErrorSeconds: chunked.maxSoundErrorSeconds, listened: false };
      check('M4', 'sound chunks of the drifting camera against the recorder', chunked.soundChunks > 1 && cl.length >= 15 && cl.every((l) => Math.abs(l) <= 48), { chunks: chunked.soundChunks, windows: cl.length, noSoundedWindow: silentC, lagsSamples: cl, g0Samples: g0, pictureGroupTimeAtZero: firstPicture ? T.toSeconds(firstPicture.g) : null, listened: 'NOT done' }, '± 1 ms (48 samples) at ≥ 15 windows with sound');
    });

    // ---------- M5, M8: 1000 cuts ----------
    await section('M5', async () => {
      const placed = (await tx(main.pid, [{ op: 'place_multicam', args: { groupId: main.groupId, newSequence: { name: '1000 cuts' }, at: T.ZERO, angleId: cam(1), fill: true } }])).results[0].output as { sequenceId: string; videoTrackId: string };
      const before = creativeProjection(await doc(main.pid));
      // 1000 cuts spread over the program from 2 s (camera 2 has picture from 1.19 s) to 2 s before its end, so every cut lands
      // where its camera has picture and each makes a segment
      const d0 = await doc(main.pid);
      const programEnd = Math.max(...d0.sequences[placed.sequenceId]!.tracks.find((t) => t.id === placed.videoTrackId)!.clips.map((c) => T.frameIndexAt(T.add(c.start, c.duration), R)));
      const cuts = Array.from({ length: 1000 }, (_, k) => ({ at: f(60 + Math.floor((k * (programEnd - 120)) / 1000)), angleId: cam(1 + (k % 3)) }));
      const t0 = performance.now();
      await tx(main.pid, [{ op: 'switch_angles', args: { groupId: main.groupId, sequenceId: placed.sequenceId, trackId: placed.videoTrackId, cuts, until: { at: f(programEnd - 60) }, coverage: 'clip', heal: false } }]);
      const switchMs = r2(performance.now() - t0);
      const d = await doc(main.pid);
      const segments = d.sequences[placed.sequenceId]!.tracks.find((t) => t.id === placed.videoTrackId)!.clips.length;
      // M8 at this size
      const bytes = JSON.stringify(d).length;
      const p95 = await commitP95(main.pid, placed.sequenceId, placed.videoTrackId);
      const gets: number[] = [];
      for (let i = 0; i < 10; i++) { const g0 = performance.now(); await doc(main.pid); gets.push(performance.now() - g0); }
      measurements.m8 = { segments, documentBytes: bytes, commitP95Ms: p95, getProjectP95Ms: r2(pct(gets, 95)) };
      check('M8', 'document bytes, commit p95, GET project p95 at 1000 segments (recorded)', segments >= 1000, measurements.m8, 'recorded');
      // undo the renames, then the switch: the projection equals the one before the switch
      for (let i = 0; i < 30; i++) await must(`/projects/${main.pid}/undo`, {});
      const u0 = performance.now();
      await must(`/projects/${main.pid}/undo`, {});
      const undoMs = r2(performance.now() - u0);
      const equal = creativeProjection(await doc(main.pid)) === before;
      measurements.m5 = { switchMs, undoMs, segments };
      check('M5', 'undo of a 1000-cut switch gives an equal creativeProjection', equal, { switchMs, undoMs }, 'equal');
    });

    // ---------- M6: auto-switch on the dialogue ----------
    await section('M6', async () => {
      const dg = await groupOf('dialogue', dx);
      const [mic, wide, host, guest] = dg.angleIds as [string, string, string, string];
      const synced = await must(`/projects/${dg.pid}/multicam/${dg.groupId}/sync`, {});
      measurements.dialogueSync = synced.pieces.map((p: any) => [p.verdict, p.offsetSeconds]);
      await tx(dg.pid, [{ op: 'update_multicam', args: { groupId: dg.groupId, wideAngleId: wide, speakers: [{ label: 'Host', micAngleId: mic, channel: 0, shotAngleId: host }, { label: 'Guest', micAngleId: mic, channel: 1, shotAngleId: guest }] } }]);
      const placed = (await tx(dg.pid, [{ op: 'place_multicam', args: { groupId: dg.groupId, at: T.ZERO, angleId: wide, fill: true } }])).results[0].output as { sequenceId: string; videoTrackId: string };
      const plan = await must(`/projects/${dg.pid}/recipes/multicam-auto/plan`, { params: { groupId: dg.groupId } });
      check('M6', 'the heuristic label is the first step', plan.steps[0] === MULTICAM_AUTO_LABEL, plan.steps[0], MULTICAM_AUTO_LABEL);
      await must(`/projects/${dg.pid}/recipes/multicam-auto/apply`, { params: { groupId: dg.groupId } });
      const d = await doc(dg.pid);
      const clips = (d.sequences[placed.sequenceId]!.tracks.find((t) => t.id === placed.videoTrackId)!.clips as MediaClip[]).filter((c) => c.multicam);
      const angleAt = (fr: number) => clips.find((c) => T.frameIndexAt(c.start, R) <= fr && fr < T.frameIndexAt(T.add(c.start, c.duration), R))?.multicam?.angleId ?? null;
      const gAt = (fr: number) => { const g = groupTimeAt(d, placed.sequenceId, placed.videoTrackId, f(fr)); return g ? T.toSeconds(g.g) : null; };
      const settle = 2 + 0.3 + 0.2;
      let single = 0, singleOk = 0, both = 0, bothOk = 0;
      const total = Math.max(...clips.map((c) => T.frameIndexAt(T.add(c.start, c.duration), R)));
      for (let fr = 0; fr < total; fr++) {
        const g = gAt(fr);
        if (g === null) continue;
        const talking = dx.turns.filter((t) => g >= t.startSeconds && g < t.endSeconds);
        if (talking.length === 1) {
          const t = talking[0]!;
          if (g - t.startSeconds < settle) continue;
          single++; if (angleAt(fr) === (t.speaker === 0 ? host : guest)) singleOk++;
        } else if (talking.length === 2) {
          const ov = Math.min(talking[0]!.endSeconds, talking[1]!.endSeconds) - Math.max(talking[0]!.startSeconds, talking[1]!.startSeconds);
          if (ov >= 1) { both++; if (angleAt(fr) === wide) bothOk++; }
        }
      }
      const shots = clips.map((c) => T.toSeconds(c.duration)).sort((a, b) => a - b);
      // shots: neighbouring segments of the same angle count as one shot (a piece edge or a drift through-edit is invisible)
      const merged: number[] = [];
      let run = 0;
      clips.forEach((c, i) => { run += T.toSeconds(c.duration); if (clips[i + 1]?.multicam?.angleId !== c.multicam?.angleId) { merged.push(run); run = 0; } });
      const m6: Record<string, unknown> = { singleFrames: single, bothFrames: both, shots: merged.length, shortestShot: r2(Math.min(...merged)), segments: shots.length };
      measurements.m6 = m6;
      check('M6', 'active speaker shown on single-speaker speech', single > 0 && singleOk / single >= 0.9, { share: r2(singleOk / Math.max(1, single)), frames: single }, '≥ 90 %');
      check('M6', 'wide shown on overlaps of ≥ 1 s', both > 0 && bothOk / both >= 0.8, { share: r2(bothOk / Math.max(1, both)), frames: both }, '≥ 80 %');
      check('M6', 'no shot shorter than minShot (2 s), the last excepted where the program ends', merged.slice(0, -1).every((s) => s >= 2 - 1e-9), { shortest: r2(Math.min(...merged.slice(0, -1))) }, '0 shots < 2 s');
      // planning time for a 60-minute program, in process (the same planner): one wide segment and a synthetic envelope
      const env: LevelEnvelope = (() => { const F = 3600 * 100, a = new Int16Array(F).fill(-8000), b = new Int16Array(F).fill(-8000); for (let i = 0; i < F; i++) { const turn = Math.floor(i / 700) % 3; if (turn === 0) { a[i] = -2000; b[i] = -3500; } else if (turn === 1) { a[i] = -3500; b[i] = -2000; } } return { assetId: 'x', rate: 100, frames: F, channels: [a, b], mix: a, flux: new Float32Array(F) }; })();
      const g60 = structuredClone(d.multicam![dg.groupId]!);
      let p = createProject({ id: 'prj_m6', name: 'm6', width: W, height: H, frameRate: R });
      const { id: _id, ...wideFile } = d.assets[dg.assets[1]![0]!]!;
      void _id;
      const imp = applyTransaction(p, [{ op: 'import_asset', args: { asset: { ...wideFile, duration: T.rt(3600, 1), video: { ...wideFile.video!, frameCount: 108000 } } } } as OpCall], { idSeed: 'm6_', actor: 'proof', allowInternal: true });
      p = imp.doc;
      const wideAsset = imp.results[0]!.output!.assetId as string;
      p = applyTransaction(p, [{ op: 'add_clip', args: { assetId: wideAsset, start: T.ZERO, duration: f(108000), withLinkedAudio: false } }], { idSeed: 'm6b_', actor: 'proof' }).doc;
      g60.angles = g60.angles.map((a) => (a.id === wide ? { ...a, pieces: [{ ...a.pieces[0]!, assetId: wideAsset, anchors: [{ group: T.ZERO, source: T.ZERO }] }] } : a));
      p.multicam = { [g60.id]: g60 };
      for (const s of Object.values(p.sequences)) for (const t of s.tracks) for (const c of t.clips) if (c.type === 'media') c.multicam = { groupId: g60.id, angleId: wide };
      const micAsset = g60.angles.find((a) => a.id === mic)!.pieces[0]!.assetId;
      const t60 = performance.now();
      const plan60 = planMulticamAuto(p, { groupId: g60.id }, { multicamLevels: { [micAsset]: { ...env, assetId: micAsset } } });
      m6.planning60minMs = r2(performance.now() - t60);
      m6.planning60minOps = plan60.ops.length;
      check('M6', 'planning time for a 60-minute program (recorded)', plan60.ops.length >= 1, { ms: m6.planning60minMs, ops: plan60.ops.length }, 'recorded');
    });

    // ---------- M3: time ----------
    await section('M3', async () => {
      const timed = async (name: string, seconds: number) => {
        const x = await generateMulticamFixture({ outDir: path.join(art, name), seconds, seed: 11, narrationPath: narration, video: false });
        const g = await groupOf(name, { ...x, angles: x.angles.slice(0, 3).map((a) => ({ ...a, kind: 'sound' as const })) }); // sound-only files
        const t0 = performance.now();
        const r = await must(`/projects/${g.pid}/multicam/${g.groupId}/sync`, { dryRun: true });
        const wall = r2((performance.now() - t0) / 1000);
        fs.rmSync(path.join(art, name), { recursive: true, force: true });
        return { wallSeconds: wall, timingsMs: r.timingsMs, verdicts: r.pieces.map((p: any) => p.verdict) };
      };
      const ten = await timed('m3-10min', 600);
      measurements.m3 = { threeTimesTenMinutes: ten, cpus: os.cpus().length, cpu: os.cpus()[0]?.model ?? null };
      check('M3', 'envelope + sync of 3 × 10 min on this CPU (a miss is reported)', ten.wallSeconds <= 60, ten, '≤ 60 s');
      if (process.env.PF_MULTICAM_LONG === '0') { (measurements.m3 as any).sixtyMinutes = 'not run (PF_MULTICAM_LONG=0)'; return; }
      const sixty = await timed('m3-60min', 3600);
      (measurements.m3 as any).sixtyMinutes = sixty;
      check('M3', 'one 60-minute run (recorded)', sixty.verdicts.length === 3, sixty, 'recorded');
    });
  } finally {
    await server.close();
  }
}

function write(report: unknown) { for (const e of evidenceFiles) fs.writeFileSync(e, JSON.stringify(report, null, 2) + '\n'); }
main().then(
  () => {
    const failed = rows.filter((r) => !r.pass);
    const status = failed.length ? 'fail' : blocked.length ? 'blocked' : 'pass';
    write({ proof: 'multicam', adr: 'ADR-0020', status, generatedAt: new Date().toISOString(), machine: { platform: process.platform, cpus: os.cpus().length, node: process.version },
      note: 'CPU only, no model; synthetic speech built from the narration sample; thresholds tuned on synthetic speech only; the sound-chunk joins were NOT listened to; one run on one machine.', checks: rows, blocked, measurements });
    console.log(`\n${status.toUpperCase()}: ${rows.length - failed.length}/${rows.length} checks passed, ${blocked.length} section(s) blocked`);
    process.exit(failed.length ? 1 : blocked.length ? 2 : 0);
  },
  (e) => {
    const isBlocked = e instanceof Blocked;
    console.error(isBlocked ? `BLOCKED: ${e.message}` : e);
    write({ proof: 'multicam', adr: 'ADR-0020', status: isBlocked ? 'blocked' : 'fail', reason: e instanceof Error ? e.message : String(e), checks: rows, blocked, measurements });
    process.exit(isBlocked ? 2 : 1);
  },
);
