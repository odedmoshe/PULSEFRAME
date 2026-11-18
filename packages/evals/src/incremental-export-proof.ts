/**
 * `pnpm proof:incremental` — the end-to-end proof of the fast export and the render cache (ADR-0024; plan §10 with the verifier's
 * corrections), on a CPU, with no model. Evidence: docs/evidence/incremental-export.json (every measurement, and which claim was
 * proven: byte-equal segments, or render-equal frames with a PSNR floor).
 *
 * The checks run against a server started with startServer on its own port and data directory (fixtures built through the REST
 * API with ops only, incremental-fixtures.ts). Exit codes: 0 = every check passed; 1 = a check failed (its numbers are in the
 * evidence, never relaxed); 2 = blocked (the route is not wired on this build, or a check could not run: it is listed as
 * `blocked` with its reason and proves nothing). Written by W3 without being run: the lead runs it after merging and `pnpm build`.
 *
 * The deliberate mutation (a key that ignores one input): (a) I8 stores the stored segment of one stretch under the key of another
 * through the SegmentStore API, which is what a key that ignored the picture would do, and the self-check must catch it; (b) I8c
 * runs the frame comparator (the one I5 uses) on a known-bad file, the export from before the title edit, which is what a key that
 * ignored the title text would publish: it must differ from the clean export, and only inside the title's frames; it also checks
 * that the engine's real frame keys differ across the edit.
 * An edit set after the first export: one title inside one segment (I4), a new title across a join (I4b), a keyframe edit whose
 * echo reaches into the next segment (I4c), an edit to a clip a transition reaches back into (I4d), a sound-only change and a
 * sound tail (I6), a privacy-region change that must purge the project's segments at once (I20). After each: the incremental
 * file against a clean segmented export of the same revision, frame by frame (decoded md5 when the encoder is deterministic,
 * per-segment RGBA hashes always, PSNR floor otherwise) and sample by sample (decoded PCM).
 *
 * The proof plan: an incremental export is compared with a full export FRAME BY FRAME and SAMPLE BY SAMPLE after a set of edits.
 * Fixture A: 640×360, 30 fps, 1801 frames (a 1-frame tail; a second variant has 1802), barcode video with B-frames and a 1-second
 * GOP, titles at 20–24 s and 40–41 s, grain on one clip, one transition, an echo time effect crossing a segment boundary, a
 * caption track, one followed redaction (no strobe and no snow: those are fixture C). Fixture B: a flashing stretch across the joins
 * at 4 s and 6 s.
 * What the checks must be able to fail for:
 * - I1  clean segmented export: exact frame count, constant frame rate (sorted packet PTS deltas all equal frameTicks, first 0), reused 0;
 * - I2  against single pass at the same revision: every barcode frame source-exact; minimum PSNR reported (fail below 38 dB); size ratio reported (fail above 1.15);
 * - I3  clear and export again: per-segment sha256 equal; else encoderDeterministic: false is recorded;
 * - I4  one title changed: the plan marks exactly the two segments under it; the export renders exactly 2;
 * - I5  the incremental file equals a clean segmented export of the same revision on an empty cache: decoded framemd5 lists equal
 *       (and the video stream hash) when I3 held; otherwise the per-frame RGBA sha256 lists equal plus a decoded PSNR floor;
 *       the audio: decoded PCM sample by sample equal to the clean export's (sound is mixed whole; the join must not move it);
 * - I6  an audio gain change only: every segment reused; the sound differs where it must and the picture frames are equal;
 * - I7  a restart with another PF_SEGMENT_THREADS: every segment misses (encoder id) and the export equals clean (no test seam);
 * - I8  a planted stale segment (barcode frames, stale on every frame, stored under another key through the SegmentStore API on the
 *       stopped server's data directory): every-segment fails with render_cache_self_check_failed, nothing in out/, entries purged,
 *       the clean counter reset; the retry succeeds and equals clean;
 * - I8b a segment stale in half its frames: detection rate over 20 seeds in sample mode reported; in every-segment mode detection
 *       asserted only when the three checked frames include a stale one (stated which);
 * - I9  a flipped byte in a stored video: dropped by the integrity check, re-rendered, output equals clean;
 * - I10 fixture B with an edit inside 4–6 s: the photosensitivity report deep-equals the single-pass report of the same revision;
 * - I11 a small cap: cache <= cap after the export and at the store's high-water mark, LRU order respected; a cap smaller than one
 *       export: success with notStored > 0, cache never above the cap; a tight ceiling: data directory never above it, success, or a
 *       typed 507 with nothing published;
 * - I11b cache full under a ceiling: a small upload succeeds (the reclaimer made room);
 * - I12 ten-minute A/V sync (av-sync-long.ts PF_AVSYNC_MODE=incremental): clean segmented, one title at 5:00, incremental; max
 *       offset <= 1 ms and drift 0 on both; wall seconds of single pass, clean segmented (fail above 1.25×) and incremental (fail
 *       above 30 % of clean, target 15 %); the seconds spent in the self-check with 3 frames per segment;
 * - I13 cancel at about half, retry: finished segments are reused; result equals clean;
 * - I14 keying a ten-minute project: seconds and maximum event-loop lag (fail above 100 ms);
 * - I15 range exports starting and ending 1 and 2 frames off the grid, and a 2-frame range: equal to the same frames of the full export;
 * - I16 undo the title change: the plan shows everything reused;
 * - I17 delete the project: its exclusive segments are gone, shared ones stay;
 * - I18 UI on the harness page until the redesign surfaces mount: sheet numbers equal the plan, the lane shows the two stale
 *       stretches, a11y 0 findings in Hebrew and English;
 * - I19 regressions: proof:phase4 and the parity suite unchanged; I19b one GPU effect on the software adapter: engine.browser
 *       carries the launch mode, and whether adding the effect kept the other segments reusable is recorded;
 * - expected numbers are typed in this file, never computed by the code under test; a failing check is reported with its numbers, never relaxed.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { findEffect, LANE_AUTO_REFRESH_MAX_KEYING_MS, type ProjectDocument, type SegmentPlanView } from '@pulseframe/core';
import { frameKey, type FrameKeyContext } from '@pulseframe/engine';
import { readBarcode } from '@pulseframe/fixtures';
import { startServer, type Config } from '@pulseframe/server';
import { SegmentStore } from '../../../apps/server/src/segmentStore.ts';
import { A_LAYOUT, C_LAYOUT, SEG_FRAMES, buildFixtureA, buildFixtureB, buildFixtureC, buildLongProject, cellsOf, f, makeApi, ownerApi, segmentCount, sleep, type Api, type CallResult, type FixtureA } from './incremental-fixtures.ts';
import { runRenderCacheUiChecks } from './a11y-render-cache.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/incremental');
const evidenceFile = path.join(root, 'docs/evidence/incremental-export.json');
const PORT = Number(process.env.PF_PROOF_PORT ?? 8931);
const QUALITY = 'standard' as const;
/** The options of every fast export of project A; the plan route is asked with the same, because the encoder arguments are part of the key. */
const INC = { format: 'mp4-h264-aac', mode: 'incremental', quality: QUALITY, selfCheck: 'every-segment' } as const;
const SINGLE = { format: 'mp4-h264-aac', mode: 'single-pass', quality: QUALITY } as const;

// ---- expected numbers, typed here from the plan and the layout, never computed by the code under test ----
const W = 640, H = 360, FRAMES_A = 1801, SEGMENTS_A = 30;
/** Fixture C: 240 frames at 30 fps, 4 segments of 60 (the strobe in the first two, the snow in the last two). */
const C_SEGMENTS = 4;
/** 30 fps: timescale 30·512 = 15360, a frame is 512 ticks (plan §3: k = 512 is the smallest power of two with 30k >= 10000). */
const TIMESCALE_30 = 15360, FRAME_TICKS_30 = 512;
const PSNR_FLOOR_DB = 38, SIZE_RATIO_CEILING = 1.15, LAG_CEILING_MS = 100;
const SYNC_OFFSET_CEILING_MS = 1, SYNC_DRIFT_CEILING_MS = 1, CLEAN_TO_SINGLE_CEILING = 1.25, INC_TO_CLEAN_CEILING = 0.3, INC_TO_CLEAN_TARGET = 0.15;

interface Check { id: string; name: string; pass: boolean | null; numbers: unknown; blocked?: string }
const checks: Check[] = [];
const measurements: Record<string, unknown> = {};
function check(id: string, name: string, pass: boolean, numbers: unknown = {}) { checks.push({ id, name, pass, numbers }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}${pass ? '' : `\n      ${JSON.stringify(numbers).slice(0, 900)}`}`); }
function blocked(id: string, name: string, why: string) { checks.push({ id, name, pass: null, numbers: {}, blocked: why }); console.log(`BLOCKED  ${id}  ${name}: ${why}`); }

// ---- server handling ----
type Server = Awaited<ReturnType<typeof startServer>>;
let s: Server;
let api: Api;
let own: Api;
const dataDir = path.join(art, 'data');
async function boot(over: Partial<Config> = {}) {
  s = await startServer({ port: PORT, dataDir, ...over });
  api = makeApi(s.url, s.auth.tokens.agent);
  own = await ownerApi(s.url, s.auth.tokens.owner); // the owner's session cookie: the launch key as a bearer token is refused (401)
}
async function halt() { await s.close(); }
async function reboot(over: Partial<Config> = {}) { await halt(); await boot(over); }

// ---- media helpers ----
const ff = (args: string[], o: { encoding?: 'utf8' } = {}) => spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...o });
/** Decoded frame md5s of the first video stream, in presentation order. */
function frameMd5(file: string): string[] {
  const r = ff(['-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'], { encoding: 'utf8' });
  return String(r.stdout).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop()!.trim());
}
/** Decoded stereo 48 kHz PCM of the first sound stream. */
function pcm(file: string): Buffer { return ff(['-i', file, '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-f', 's16le', '-']).stdout as Buffer; }
function probe(file: string) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', '-count_packets', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return JSON.parse(r.stdout) as { streams: any[]; format: any };
}
/** Sorted video packet PTS of the file: for the constant-frame-rate check. */
function packetPts(file: string): number[] {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts', '-of', 'csv=p=0', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return r.stdout.split('\n').filter(Boolean).map(Number).sort((a, b) => a - b);
}
interface Cfr { frames: number; firstPts: number; timeBase: string; deltas: number[]; constant: boolean; ticks: number | null }
function cfr(file: string): Cfr {
  const pts = packetPts(file);
  const deltas = [...new Set(pts.slice(1).map((v, i) => v - pts[i]!))];
  const tb = String(probe(file).streams.find((x) => x.codec_type === 'video')?.time_base ?? '');
  return { frames: pts.length, firstPts: pts[0] ?? NaN, timeBase: tb, deltas, constant: deltas.length === 1, ticks: deltas.length === 1 ? deltas[0]! : null };
}
/** min and average PSNR (dB) between two decodes, frame for frame (inf for identical frames). */
function psnr(a: string, b: string, trimA?: { from: number; to: number }): { min: number; average: number } {
  const first = trimA ? `[0:v]trim=start_frame=${trimA.from}:end_frame=${trimA.to},setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]psnr` : '[0:v][1:v]psnr';
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', first, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const m = /average:(\S+) min:(\S+)/.exec(r.stderr);
  const num = (x: string | undefined) => (x === undefined ? NaN : x === 'inf' ? Infinity : Number(x));
  return { min: num(m?.[2]), average: num(m?.[1]) };
}
/** Streams the raw frames of a video and reads the barcode of each (only for the frames `want` asks for; others are skipped). */
function barcodes(file: string, want: (frame: number) => boolean): Promise<Map<number, number>> {
  return new Promise((resolve, reject) => {
    const fb = W * H * 3;
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const out = new Map<number, number>();
    let carry: Buffer = Buffer.alloc(0), n = 0;
    p.stdout.on('data', (d: Buffer) => {
      carry = carry.length ? Buffer.concat([carry, d]) : d;
      while (carry.length >= fb) {
        if (want(n)) out.set(n, readBarcode(carry.subarray(0, fb), W, 3, { x: 0, y: 0, w: W, h: H }));
        carry = carry.subarray(fb); n++;
      }
    });
    p.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(`ffmpeg ${c}`))));
  });
}
const sha256File = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const pcmDiff = (a: Buffer, b: Buffer) => { let n = 0, first = -1, last = -1; const len = Math.min(a.length, b.length); for (let i = 0; i + 1 < len; i += 2) if (a.readInt16LE(i) !== b.readInt16LE(i)) { n++; if (first < 0) first = Math.floor(i / 4); last = Math.floor(i / 4); } return { lengthA: a.length, lengthB: b.length, differing: n + Math.abs(a.length - b.length) / 2, firstSample: first, lastSample: last }; };

/** Decoded stereo PCM a against b in a window of sample frames: how many differ by more than one 16-bit step inside it, and the largest difference outside it. */
function soundChange(a: Buffer, b: Buffer, w: { from: number; to: number }) {
  let insideOverStep = 0, outsideMaxAbs = 0, outsideFirst = -1, outsideLast = -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i + 1 < len; i += 2) {
    const d = Math.abs(a.readInt16LE(i) - b.readInt16LE(i)), frame = Math.floor(i / 4);
    if (frame >= w.from && frame < w.to) { if (d > 1) insideOverStep++; }
    else if (d > 0) { outsideMaxAbs = Math.max(outsideMaxAbs, d); if (outsideFirst < 0) outsideFirst = frame; outsideLast = frame; }
  }
  return { insideOverStep, outsideMaxAbs, outsideFirst, outsideLast, lengthsEqual: a.length === b.length };
}

// ---- cache inspection (the server's own directory, read from the proof) ----
const cacheDir = () => path.join(dataDir, 'render-cache');
function cacheKeys(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.mp4')) out.set(e.name.slice(0, -4), p); } };
  walk(cacheDir());
  return out;
}
/** The sidecar header (SegmentMeta): magic 'PFSEG1\n', u32le header length, JSON. */
function sidecar(videoPath: string): { rgbaSha256: string[]; frames: number; ptsOffsetTicks?: number; createdAt?: number } | null {
  try { const b = fs.readFileSync(videoPath.replace(/\.mp4$/, '.side')); const len = b.readUInt32LE(7); return JSON.parse(b.subarray(11, 11 + len).toString('utf8')); } catch { return null; }
}
interface Snap { sha: string; rgba: string[]; frames: number; path: string; created: number }
function snapshot(): Map<string, Snap> {
  const m = new Map<string, Snap>();
  for (const [k, p] of cacheKeys()) { const meta = sidecar(p); m.set(k, { sha: sha256File(p), rgba: meta?.rgbaSha256 ?? [], frames: meta?.frames ?? 0, path: p, created: meta?.createdAt ?? 0 }); }
  return m;
}
function dirBytes(dir: string): number { let n = 0; if (!fs.existsSync(dir)) return 0; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); try { n += e.isDirectory() ? dirBytes(p) : e.isFile() ? fs.statSync(p).size : 0; } catch { /* removed while walking */ } } return n; }
const outFiles = () => (fs.existsSync(path.join(dataDir, 'out')) ? fs.readdirSync(path.join(dataDir, 'out')).sort() : []);
const cacheStatus = async () => (await own.call('/storage/render-cache')).body as { enabled: boolean; capBytes: number; usedBytes: number; segments: number; highWaterBytes: number };
const clearCache = async () => (await own.call('/storage/render-cache', undefined, 'DELETE')).body;
/** First frame of a stored segment, by its barcode: which grid cell it is (only for stretches without captions or effects). */
function firstFrameOf(videoPath: string): number {
  const r = ff(['-i', videoPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return readBarcode(r.stdout as Buffer, W, 3, { x: 0, y: 0, w: W, h: H });
}

// ---- plans and exports ----
async function planOf(pid: string, options: object = INC): Promise<{ status: number; view: SegmentPlanView; error?: any }> {
  const r = await api.call(`/projects/${pid}/exports/segments/plan`, options);
  return { status: r.status, view: r.body as SegmentPlanView, error: r.status >= 300 ? r.body?.error : undefined };
}
/** The segment numbers of a plan in one state (segments count from the first segment of the exported range). */
function segmentsIn(view: SegmentPlanView, state: 'cached' | 'render' | 'uncacheable'): number[] {
  return view.runs.filter((r) => r.state === state).flatMap((r) => Array.from({ length: r.segments }, (_, i) => r.firstSegment + i)).sort((a, b) => a - b);
}
const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);
interface Run { post: CallResult; job?: any; seconds: number; file?: string; report?: any }
async function exportRun(pid: string, options: object, tag: string): Promise<Run> {
  const t0 = Date.now();
  const post = await api.call(`/projects/${pid}/exports`, options);
  if (post.status >= 300) return { post, seconds: (Date.now() - t0) / 1000 };
  const job = await api.waitJob(post.body.jobId);
  const seconds = (Date.now() - t0) / 1000;
  const file = job.status === 'succeeded' ? await api.download(job.id, path.join(art, `${tag}.mp4`)) : undefined;
  return { post, job, seconds, file, report: job.output?.segments };
}
/** Everything a fast export must satisfy by itself: success, the segmented route, an exact frame count, a constant frame rate from 0. */
function wellFormed(run: Run, frames: number): { ok: boolean; numbers: unknown } {
  if (!run.file || !run.job) return { ok: false, numbers: { post: run.post.status, status: run.job?.status, error: run.job?.error ?? run.post.body?.error } };
  const c = cfr(run.file);
  const ok = run.job.output?.route === 'server-segmented-canvas2d' && c.frames === frames && c.firstPts === 0 && c.constant && c.ticks === FRAME_TICKS_30 && c.timeBase === `1/${TIMESCALE_30}`;
  return { ok, numbers: { route: run.job.output?.route, cfr: c, validationFrames: run.job.output?.validation?.frames, wantFrames: frames } };
}

interface Against { framesEqual: boolean; firstDiff: number; psnr: { min: number; average: number } | null; pcmEqual: boolean; pcm: ReturnType<typeof pcmDiff>; keysCovered: boolean; rgbaEqual: boolean; rgbaChecked: number; videoBytesEqual: number; keys: number; cleanSeconds: number; cleanFile: string; ok: boolean }
/** Encoder determinism, decided by I3 (null until then): decoded md5 equality is claimed only when it held. */
let encoderDeterministic: boolean | null = null;
/**
 * The incremental export `inc` against a clean segmented export of the same revision on an empty cache (this empties the cache and
 * fills it again with the clean export, which holds every stretch of this revision). Frame by frame: the per-segment RGBA hashes
 * (every stored stretch of the clean export against the same key in the cache the incremental export left), the decoded md5 list
 * when the encoder is deterministic, else a PSNR floor; sample by sample: decoded PCM.
 */
async function againstClean(pid: string, inc: Run, tag: string): Promise<Against> {
  const snapInc = snapshot();
  await clearCache();
  const clean = await exportRun(pid, INC, `${tag}-clean`);
  if (!clean.file || !inc.file) throw new Error(`${tag}: no file to compare (clean ${clean.job?.status}, incremental ${inc.job?.status})`);
  const snapClean = snapshot();
  let rgbaEqual = true, rgbaChecked = 0, videoBytesEqual = 0, keysCovered = true;
  for (const [k, c] of snapClean) {
    const i = snapInc.get(k);
    if (!i) { keysCovered = false; continue; }
    rgbaChecked++;
    if (!same(i.rgba, c.rgba) || i.rgba.length === 0) rgbaEqual = false;
    if (i.sha === c.sha) videoBytesEqual++;
  }
  const a = frameMd5(inc.file), b = frameMd5(clean.file);
  const framesEqual = same(a, b);
  const firstDiff = framesEqual ? -1 : a.findIndex((v, i) => v !== b[i]);
  const ps = framesEqual ? null : psnr(inc.file, clean.file);
  const pa = pcm(inc.file), pb = pcm(clean.file);
  const pd = pcmDiff(pa, pb);
  const pcmEqual = pa.equals(pb);
  // frame equality is the claim only when the encoder is deterministic; otherwise the RGBA hashes carry it, with a decoded PSNR floor
  const frameOk = encoderDeterministic === true ? framesEqual : framesEqual || (ps !== null && ps.min >= PSNR_FLOOR_DB);
  return { framesEqual, firstDiff, psnr: ps, pcmEqual, pcm: pd, keysCovered, rgbaEqual, rgbaChecked, videoBytesEqual, keys: snapClean.size, cleanSeconds: clean.seconds, cleanFile: clean.file, ok: frameOk && pcmEqual && rgbaEqual && keysCovered && clean.job.status === 'succeeded' };
}

// =====================================================================================================================
async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  await boot();
  const t0 = Date.now();
  const A: FixtureA = await buildFixtureA(api, art, { frames: 1801, name: 'incremental A' });
  const pid = A.pid;
  const evidence: Record<string, unknown> = { ranAt: new Date().toISOString(), machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1) }, config: { segmentThreads: s.cfg.segmentThreads, renderCacheBytes: s.cfg.renderCacheBytes }, quality: QUALITY };

  // The route must be wired on this build; otherwise this proof is blocked, and says so.
  const probePlan = await planOf(pid);
  // Blocked only when the route is not there (404/405) or says it is not built; any other refusal of a wired route is a FAIL of I0.
  const notWired = probePlan.status === 404 || probePlan.status === 405 || /not built yet/.test(JSON.stringify(probePlan.error ?? probePlan.view ?? ''));
  if (!notWired && probePlan.status >= 300) {
    check('I0', 'the plan route of a wired build answers fixture A', false, { status: probePlan.status, error: probePlan.error });
    finish(evidence, true);
    await halt();
    process.exit(1);
  }
  if (notWired) {
    const why = `the plan route answered ${probePlan.status}: ${JSON.stringify(probePlan.error ?? probePlan.view).slice(0, 300)}`;
    blocked('I1', 'the segmented export route is wired', why);
    finish(evidence, true);
    await halt();
    process.exit(2);
  }
  check('I0', 'fixture A is the typed layout: 1801 frames, 30 segments, the first plan marks all 30 as to render', probePlan.view.segments.total === SEGMENTS_A && probePlan.view.segments.render === SEGMENTS_A && probePlan.view.frames === FRAMES_A && probePlan.view.segFrames === SEG_FRAMES && segmentCount(FRAMES_A) === SEGMENTS_A, { plan: probePlan.view.segments, segFrames: probePlan.view.segFrames, frames: probePlan.view.frames });

  // ---------------------------------------------------------------- I1, I2, I3
  console.log('\n# I1 clean segmented export');
  const e0 = await exportRun(pid, INC, 'e0-clean');
  const w0 = wellFormed(e0, FRAMES_A);
  check('I1', 'clean segmented export: exact frame count, constant frame rate (every packet 512 ticks apart from 0), 30 segments rendered, none reused', w0.ok && e0.report?.total === SEGMENTS_A && e0.report?.reused === 0 && e0.report?.rendered === SEGMENTS_A, { ...(w0.numbers as object), report: e0.report && { total: e0.report.total, reused: e0.report.reused, rendered: e0.report.rendered, notStored: e0.report.notStored } });
  const cleanSeconds = e0.seconds;

  console.log('\n# I2 against the single pass');
  const single = await exportRun(pid, SINGLE, 'single-pass');
  if (!e0.file || !single.file) throw new Error(`I2 needs both files (clean ${e0.job?.status}: ${JSON.stringify(e0.job?.error)}; single ${single.job?.status}: ${JSON.stringify(single.job?.error)})`);
  // frames whose picture is the source frame unchanged: outside grain, the transition, the echo, the snow and the captions
  const caption = (n: number) => A_LAYOUT.cues.some((c) => n >= c.start && n < c.start + c.frames);
  const plain = (n: number) => !(n >= 300 && n < 450) && !(n >= 600 && n < 615) && !(n >= 960 && n < 1080) && !(n >= 1500 && n < 1650) && !caption(n);
  const plainFrames = Array.from({ length: FRAMES_A }, (_, n) => n).filter(plain).length; // typed by the layout: 1801 frames less the effect stretches and the captions (1096 for this fixture)
  const [bcInc, bcSingle] = [await barcodes(e0.file, plain), await barcodes(single.file, plain)];
  let wrongInc = 0, wrongSingle = 0, readFrames = 0;
  for (const [n, code] of bcInc) { readFrames++; if (code !== n) wrongInc++; }
  for (const [n, code] of bcSingle) if (code !== n) wrongSingle++;
  const ps2 = psnr(e0.file, single.file);
  const sizeRatio = (e0.job.output.bytes as number) / (single.job.output.bytes as number);
  measurements.sizeRatio = +sizeRatio.toFixed(4); measurements.minPsnrDb = +ps2.min.toFixed(2); measurements.singlePassSeconds = +single.seconds.toFixed(1); measurements.cleanSegmentedSeconds = +cleanSeconds.toFixed(1);
  check('I2', `fast export against the single pass at one revision: every unchanged frame reads back its own barcode in both, minimum PSNR >= ${PSNR_FLOOR_DB} dB, size ratio <= ${SIZE_RATIO_CEILING}`,
    readFrames === plainFrames && plainFrames > 1000 && wrongInc === 0 && wrongSingle === 0 && ps2.min >= PSNR_FLOOR_DB && sizeRatio <= SIZE_RATIO_CEILING, { barcodeFramesRead: readFrames, plainFrames, wrongInSegmented: wrongInc, wrongInSinglePass: wrongSingle, minPsnrDb: ps2.min, averagePsnrDb: ps2.average, sizeRatio, bytes: { segmented: e0.job.output.bytes, single: single.job.output.bytes } });

  console.log('\n# I3 determinism');
  const before = snapshot();
  await clearCache();
  const e0b = await exportRun(pid, INC, 'e0-again');
  const after = snapshot();
  let equalSegs = 0;
  for (const [k, v] of before) if (after.get(k)?.sha === v.sha) equalSegs++;
  const sameKeys = before.size === after.size && [...before.keys()].every((k) => after.has(k));
  encoderDeterministic = sameKeys && equalSegs === before.size && before.size > 0;
  const fileBytesEqual = !!e0.file && !!e0b.file && sha256File(e0.file) === sha256File(e0b.file);
  measurements.encoderDeterministic = encoderDeterministic;
  check('I3', 'clear and export again: the same keys come back; per-segment sha256 equality is recorded (encoderDeterministic false is allowed and changes what I5 claims)', e0b.job?.status === 'succeeded' && sameKeys && before.size === SEGMENTS_A, { segments: before.size, sameKeys, segmentsByteEqual: equalSegs, encoderDeterministic, wholeFileByteEqual: fileBytesEqual });

  // ---------------------------------------------------------------- I6 a sound-only change, then a sound tail
  console.log('\n# I6 sound only');
  const soundBefore = pcm(e0b.file!), framesBefore = frameMd5(e0b.file!);
  await api.tx(pid, [{ op: 'set_clip_gain', args: { clipId: A.audio.p2, gain: 0.5 } }]);
  const p6 = await planOf(pid);
  const i6 = await exportRun(pid, INC, 'i6-gain');
  const soundGain = i6.file ? pcm(i6.file) : Buffer.alloc(0);
  const fr6 = i6.file ? frameMd5(i6.file) : [];
  const gainDiff = pcmDiff(soundBefore, soundGain);
  // the gain clip sits on frames 300..449; 1600 samples a frame at 48 kHz (a stereo pair counts once). The sound is compared after AAC: its long blocks overlap by 1024 samples, so a gain step changes the block before it too; the window is the clip widened by two AAC frames (2 x 1024 samples) each side
  const AAC_SLACK = 2048;
  const gainWindow = { from: 300 * 1600 - AAC_SLACK, to: 450 * 1600 + AAC_SLACK };
  // "The sound differs where the clip is" (corrected measure, lead run 2026-11-18): the AAC encoder carries its state across
  // frames, so after the change it rounds the following frames by one 16-bit step differently (measured: |Δ| = 1 for about
  // 3000 samples after the window, on a signal of amplitude 16436). The claim is that the SOUND differs only there: inside the
  // window the gain step must show (|Δ| above one step), outside it nothing may differ by more than one step. Control: the same
  // measure with the window put on the next clip (frames 450..599) must fail, so the measure can fail.
  const soundOnly = (w: { from: number; to: number }) => soundChange(soundBefore, soundGain, w);
  const inClip = soundOnly(gainWindow), control = soundOnly({ from: 450 * 1600 - AAC_SLACK, to: 600 * 1600 + AAC_SLACK });
  const soundOk = inClip.insideOverStep > 0 && inClip.outsideMaxAbs <= 1, controlFails = !(control.insideOverStep > 0 && control.outsideMaxAbs <= 1);
  check('I6', 'a sound gain change only: every segment reused and none rendered; the picture frames equal the earlier export; the sound differs where the clip is (beyond one 16-bit step only inside it; the measure fails with the window on the wrong clip)',
    p6.status === 200 && p6.view.segments.cached === SEGMENTS_A && p6.view.framesToRender === 0 && i6.report?.reused === SEGMENTS_A && i6.report?.rendered === 0 && same(fr6, framesBefore) && gainDiff.differing > 0 && soundOk && controlFails,
    { plan: p6.view?.segments, report: i6.report && { reused: i6.report.reused, rendered: i6.report.rendered, selfCheck: i6.report.selfCheck, ms: i6.report.ms }, picturesEqual: same(fr6, framesBefore), soundDiff: gainDiff, window: gainWindow, inClip, controlWindowOnNextClip: control, controlFails, seconds: i6.seconds });
  measurements.soundOnlyExportSeconds = +i6.seconds.toFixed(1);
  console.log('\n# I6b sound tail');
  const tailBefore = soundGain;
  await api.tx(pid, [{ op: 'add_audio_effect', args: { clipId: A.audio.p1, type: 'space.reverb', params: {} } }]);
  const p6b = await planOf(pid);
  const i6b = await exportRun(pid, INC, 'i6b-tail');
  const tailPcm = i6b.file ? pcm(i6b.file) : Buffer.alloc(0);
  // the tail reaches past the end of the clip (frame 300 = 10 s): samples after 10 s differ from the export without it
  const afterClip = pcmDiff(tailBefore.subarray(10 * 48000 * 4), tailPcm.subarray(10 * 48000 * 4));
  const ref6b = i6b.file ? await againstClean(pid, i6b, 'i6b') : null;
  check('I6b', 'a sound tail (reverb on the first clip): no picture segment rendered; the tail reaches past the end of its clip; the incremental file equals a clean segmented export sample by sample and frame by frame',
    p6b.status === 200 && p6b.view.framesToRender === 0 && i6b.report?.rendered === 0 && afterClip.differing > 0 && !!ref6b?.ok, { plan: p6b.view?.segments, samplesDifferingAfterTheClipEnds: afterClip.differing, against: ref6b });

  // ---------------------------------------------------------------- I4, I16, I5: one title, inside one segment
  console.log('\n# I4 one title changed');
  const rev0Pcm = pcm(i6b.file!);
  await api.tx(pid, [{ op: 'update_text', args: { clipId: A.titles.t1, text: 'כותרת חדשה' } }]);
  const p4 = await planOf(pid);
  const stale4 = cellsOf(A_LAYOUT.t1.start, A_LAYOUT.t1.start + A_LAYOUT.t1.frames); // typed: frames 600..719 are cells 10 and 11
  const i4 = await exportRun(pid, INC, 'i4-title');
  measurements.incrementalOneTitleSeconds = +i4.seconds.toFixed(1);
  const w4 = wellFormed(i4, FRAMES_A);
  check('I4', 'one title changed: the plan marks exactly segments 10 and 11 and the export renders exactly 2 (28 reused)',
    same(stale4, [10, 11]) && same(segmentsIn(p4.view, 'render'), [10, 11]) && p4.view.segments.cached === 28 && p4.view.framesToRender === 120 && i4.report?.rendered === 2 && i4.report?.reused === 28 && w4.ok, { plan: p4.view.segments, renderSegments: segmentsIn(p4.view, 'render'), framesToRender: p4.view.framesToRender, report: i4.report && { reused: i4.report.reused, rendered: i4.report.rendered, selfCheck: i4.report.selfCheck, ms: i4.report.ms }, wellFormed: w4.numbers });
  console.log('\n# I16 undo');
  const undone = await api.call(`/projects/${pid}/undo`, {});
  const p16 = await planOf(pid);
  const redone = await api.call(`/projects/${pid}/redo`, {});
  const p16b = await planOf(pid);
  check('I16', 'undo the title change: the plan shows everything reused (the old segments are still stored); redo: everything reused again (the new ones are stored)',
    undone.status === 200 && p16.view.segments.cached === SEGMENTS_A && p16.view.framesToRender === 0 && redone.status === 200 && p16b.view.segments.cached === SEGMENTS_A && p16b.view.framesToRender === 0, { undo: undone.status, afterUndo: p16.view?.segments, redo: redone.status, afterRedo: p16b.view?.segments });
  console.log('\n# I5 against a clean export of the same revision');
  const ref4 = await againstClean(pid, i4, 'i4');
  check('I5', 'the incremental file equals a clean segmented export of the same revision: stored stretches equal by per-frame RGBA hash, decoded frames equal (md5 when the encoder is deterministic, PSNR floor otherwise), decoded sound equal sample by sample',
    ref4.ok, { encoderDeterministic, ...ref4 });
  // the comparator's negative control: the file of the revision before the title edit is exactly what a key that ignored the title text would publish
  const staleTitle = e0b.file ? frameMd5(e0b.file) : [], cleanTitle = frameMd5(ref4.cleanFile);
  const diffAt = staleTitle.map((v, i) => (v !== cleanTitle[i] ? i : -1)).filter((i) => i >= 0);
  const comparatorControl = { stale: !!e0b.file, differingFrames: diffAt.length, first: diffAt[0] ?? -1, last: diffAt[diffAt.length - 1] ?? -1, staleFileVerdict: !!e0b.file && !same(staleTitle, cleanTitle) };
  const sound4 = pcm(i4.file!);
  measurements.soundUnchangedByTitleEdit = pcmDiff(rev0Pcm, sound4).differing === 0;

  // ---------------------------------------------------------------- edits across a join, with time reach, a transition reaching in
  const edits: { id: string; name: string; expected: number[]; apply: () => Promise<unknown> }[] = [
    { id: 'I4b', name: 'a new title across a join (frames 1190..1214 straddle the line at 1200): the plan marks segments 19 and 20', expected: cellsOf(1190, 1215), apply: () => api.tx(pid, [{ op: 'add_text', args: { text: 'גשר', start: f(1190), duration: f(25), transform: { y: 0 } } }]) },
    // keys at clip-local 45, 48, 51 = frames 1005, 1008, 1011; changing the one at 48 changes frames 1006..1010; the echo (4 pictures, 12 frames apart) reads 36 frames back, so frames up to 1046 change: cells 16 and 17
    { id: 'I4c', name: 'an edit with time reach: a keyframe inside segment 16 whose echo trail reaches into segment 17: the plan marks exactly 16 and 17', expected: cellsOf(1005 + 1, 1011 + 36), apply: () => api.tx(pid, [{ op: 'set_keyframe', args: { clipId: A.clips.pe, property: 'x', time: f(48), value: 0.06 } }]) },
    // grain on the clip before the transition: frames 450..599, and the outgoing picture under the dissolve of 600..614
    { id: 'I4d', name: 'a transition reaching in: grain on the clip the dissolve plays on from; the plan marks 7, 8, 9 and 10 (the dissolve starts in 10)', expected: cellsOf(A_LAYOUT.p3.start, A_LAYOUT.p4.start + A_LAYOUT.transitionFrames), apply: () => api.tx(pid, [{ op: 'add_effect', args: { clipId: A.clips.p3, type: 'stylize.grain', params: {} } }]) },
  ];
  const editedCells: Record<string, { expected: number[]; plan: number[]; report: unknown }> = {};
  let lastRun: Run = i4;
  for (const e of edits) {
    console.log(`\n# ${e.id}`);
    await e.apply();
    const pl = await planOf(pid);
    const run = await exportRun(pid, INC, e.id.toLowerCase());
    lastRun = run;
    const wf = wellFormed(run, FRAMES_A);
    const ref = await againstClean(pid, run, e.id.toLowerCase());
    const planned = segmentsIn(pl.view, 'render');
    editedCells[e.id] = { expected: e.expected, plan: planned, report: run.report && { reused: run.report.reused, rendered: run.report.rendered } };
    check(e.id, e.name + '; the export renders exactly those and equals a clean export frame by frame and sample by sample',
      same(planned, e.expected) && run.report?.rendered === e.expected.length && run.report?.reused === SEGMENTS_A - e.expected.length && wf.ok && ref.ok, { expected: e.expected, planned, uncacheable: segmentsIn(pl.view, 'uncacheable'), report: run.report && { reused: run.report.reused, rendered: run.report.rendered, selfCheck: run.report.selfCheck }, wellFormed: wf.numbers, against: ref });
  }
  evidence.editedCells = editedCells;
  void lastRun;

  // ---------------------------------------------------------------- I20 a privacy-region change purges at once
  console.log('\n# I20 privacy region');
  const cacheBefore = await cacheStatus();
  await api.tx(pid, [{ op: 'set_redact_region', args: { clipId: A.clips.p1, regionId: A.regionId, region: { strength: 0.4 } } }]);
  let purged = await cacheStatus();
  for (let k = 0; k < 40 && (purged.segments > 0 || cacheKeys().size > 0); k++) { await sleep(100); purged = await cacheStatus(); }
  const filesLeft = cacheKeys().size, bytesOnDisk = dirBytes(cacheDir()); // the un-redacted pictures and their sidecars must be gone from the disk, not only from the index
  const p20 = await planOf(pid);
  const i20 = await exportRun(pid, INC, 'i20-privacy');
  const ref20 = i20.file ? await againstClean(pid, i20, 'i20') : null;
  check('I20', 'a privacy-region change purges the project\'s stored segments at once (the cache holds none of them before the next plan), the plan then marks every segment, and the export equals a clean one',
    cacheBefore.segments >= SEGMENTS_A && purged.segments === 0 && filesLeft === 0 && p20.view.segments.render === SEGMENTS_A && i20.report?.reused === 0 && i20.report?.rendered === SEGMENTS_A && !!ref20?.ok, { segmentsBefore: cacheBefore.segments, segmentsAfterTheEdit: purged.segments, segmentFilesLeftOnDisk: filesLeft, bytesLeftOnDisk: bytesOnDisk, bytesAfter: purged.usedBytes, plan: p20.view?.segments, report: i20.report && { reused: i20.report.reused, rendered: i20.report.rendered }, against: ref20 });

  // ---------------------------------------------------------------- I15 ranges off the grid (the cache holds the full export of this revision)
  console.log('\n# I15 ranges');
  const fullFile = path.join(art, 'i20-clean.mp4');
  const range = await exportRun(pid, { ...INC, range: { startFrame: 61, endFrame: 1202 } }, 'i15-range');
  const rangeFrames = 1202 - 61;
  const rc = range.file ? cfr(range.file) : null;
  const rpsnr = range.file ? psnr(fullFile, range.file, { from: 61, to: 1202 }) : { min: NaN, average: NaN };
  const rbc = range.file ? await barcodes(range.file, (n) => n >= 800 - 61 && n < 900 - 61) : new Map<number, number>(); // 800..899 are plain frames of the clip p4 (after its transition and under no title)
  const bcWrong = [...rbc].filter(([n, v]) => v !== n + 61).length;
  const two = await exportRun(pid, { ...INC, range: { startFrame: 100, endFrame: 102 } }, 'i15-two');
  const tpsnr = two.file ? psnr(fullFile, two.file, { from: 100, to: 102 }) : { min: NaN, average: NaN };
  const tbc = two.file ? await barcodes(two.file, () => true) : new Map<number, number>();
  // the head 61..119 (59 frames) and the tail 1200..1201 (2 frames, joined to the cell before it: 1140..1201 = 62 frames) are new segments; cells 2..18 (17) are reused
  check('I15', 'range exports 1 frame after the grid line to 2 frames past one (and a 2-frame range) equal the same frames of the full export: 19 segments, 17 reused, 2 rendered; decoded PSNR floor and barcodes; the 2-frame range is one segment',
    range.job?.status === 'succeeded' && rc?.frames === rangeFrames && rc.constant && rc.firstPts === 0 && range.report?.total === 19 && range.report?.reused === 17 && range.report?.rendered === 2 && rpsnr.min >= PSNR_FLOOR_DB && rbc.size === 100 && bcWrong === 0
      && two.job?.status === 'succeeded' && two.report?.total === 1 && cfr(two.file!).frames === 2 && tpsnr.min >= PSNR_FLOOR_DB && [...tbc.values()].join() === '100,101',
    { range: rc, report: range.report && { total: range.report.total, reused: range.report.reused, rendered: range.report.rendered }, psnr: rpsnr, barcodeFramesRead: rbc.size, barcodesWrong: bcWrong, twoFrame: two.report && { total: two.report.total, reused: two.report.reused, rendered: two.report.rendered }, twoPsnr: tpsnr, twoBarcodes: [...tbc.values()] });

  // ---------------------------------------------------------------- I13 cancel at about half
  console.log('\n# I13 cancel and retry');
  await clearCache();
  const startPost = await api.call(`/projects/${pid}/exports`, INC);
  let canceledAt = '', sawHalf = false;
  for (let k = 0; k < 6000; k++) {
    const j = (await api.call(`/jobs/${startPost.body.jobId}`)).body;
    const m = /(\d+)\s*\/\s*(\d+)/.exec(String(j.stage ?? ''));
    if (/render/.test(String(j.stage ?? '')) && m && Number(m[1]) >= Math.ceil(Number(m[2]) / 2)) { canceledAt = String(j.stage); sawHalf = true; await api.call(`/jobs/${j.id}/cancel`, {}); break; }
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) break;
    await sleep(40);
  }
  const canceledJob = await api.waitJob(startPost.body.jobId);
  const keptAfterCancel = (await cacheStatus()).segments;
  const publishedAfterCancel = canceledJob.status === 'canceled' ? !!canceledJob.output?.file : null;
  const resumed = await exportRun(pid, INC, 'i13-resumed');
  const ref13 = resumed.file ? await againstClean(pid, resumed, 'i13') : null;
  check('I13', 'cancel at about half, then retry: the stretches finished before the cancel stay, the retry reuses them and the result equals a clean export; nothing was published by the canceled job',
    sawHalf && canceledJob.status === 'canceled' && publishedAfterCancel === false && keptAfterCancel > 0 && keptAfterCancel < SEGMENTS_A && (resumed.report?.reused ?? 0) >= keptAfterCancel - 1 && (resumed.report?.reused ?? 0) > 0 && !!ref13?.ok,
    { canceledAt, status: canceledJob.status, segmentsKeptAfterCancel: keptAfterCancel, resumed: resumed.report && { reused: resumed.report.reused, rendered: resumed.report.rendered }, against: ref13 });

  // ---------------------------------------------------------------- I9 a flipped byte in a stored video (the cache holds the full export again)
  console.log('\n# I9 a damaged stored video');
  await halt();
  const damaged = [...snapshot().entries()].map(([k, v]) => ({ k, v, first: firstFrameOf(v.path) })).find((x) => x.first >= 1080 && x.first < 1500 && x.first % SEG_FRAMES === 0);
  let flippedKey = '';
  if (damaged) {
    const b = fs.readFileSync(damaged.v.path);
    const mid = Math.floor(b.length / 2);
    b[mid] = (b[mid] ?? 0) ^ 0xff;
    fs.writeFileSync(damaged.v.path, b);
    flippedKey = damaged.k;
  }
  await boot();
  const i9 = await exportRun(pid, INC, 'i9-damaged');
  const ref9 = i9.file ? await againstClean(pid, i9, 'i9') : null;
  check('I9', 'a flipped byte in one stored video: the integrity check drops it (corruptDropped 1), it is rendered again (rendered 1, reused 29) and the output equals a clean export',
    !!damaged && i9.job?.status === 'succeeded' && i9.report?.corruptDropped === 1 && i9.report?.rendered === 1 && i9.report?.reused === SEGMENTS_A - 1 && !!ref9?.ok, { flippedKey: flippedKey.slice(0, 12), report: i9.report && { corruptDropped: i9.report.corruptDropped, reused: i9.report.reused, rendered: i9.report.rendered }, against: ref9 });

  // ---------------------------------------------------------------- I8 a stale stored segment (the deliberate mutation), planted through the store API
  console.log('\n# I8 planted stale segment');
  const engine = e0.report?.engine as { bundle: string; browser: string; schemaVersion: number } | undefined;
  await halt();
  const fresh = snapshot();
  const cellOf = new Map<number, string>();
  for (const [k, v] of fresh) { const first = firstFrameOf(v.path); if (first >= 1080 && first < 1500 && first % SEG_FRAMES === 0) cellOf.set(first / SEG_FRAMES, k); }
  const keyA = cellOf.get(23), keyB = cellOf.get(24);
  if (!keyA || !keyB) throw new Error(`I8: could not find the stored stretches of cells 23 and 24 (found cells ${[...cellOf.keys()].join(',')})`); // two stretches of the plain clip p6 (frames 1380..1439 and 1440..1499): different barcodes on every frame
  let store = mkStore();
  const cleanBefore = engine ? store.cleanSelfChecks(engine) : -1;
  const hB = await store.open(keyB, { verify: false });
  if (hB) {
    const metaB = hB.meta;
    store.drop([keyA]);
    const tmp = path.join(art, 'planted.mp4');
    fs.copyFileSync(hB.videoPath, tmp);
    const pin = store.pin([]);
    await store.put(keyA, { videoFile: tmp, frames: metaB.frames, width: metaB.width, height: metaB.height, rgbaSha256: metaB.rgbaSha256, ptsOffsetTicks: metaB.ptsOffsetTicks, cells: await store.readCells(keyB), renderMs: metaB.renderMs, projectId: pid }, pin);
    pin.release();
  }
  store.close();
  await boot();
  const outBefore = outFiles();
  const pPlant = await planOf(pid);
  const planted = await exportRun(pid, { ...INC, selfCheck: 'every-segment' }, 'i8-planted');
  const outAfter = outFiles();
  const cacheAfterFail = await cacheStatus();
  const failCode = planted.job?.error?.code ?? planted.post.body?.error?.code;
  await halt();
  store = mkStore();
  const cleanAfter = engine ? store.cleanSelfChecks(engine) : -1;
  store.close();
  await boot();
  const retry = planted.job ? await api.call(`/jobs/${planted.job.id}/retry`, {}) : null;
  const retried = retry && retry.status < 300 ? await api.waitJob(retry.body.jobId) : null;
  const retriedFile = retried?.status === 'succeeded' ? await api.download(retried.id, path.join(art, 'i8-retry.mp4')) : null;
  const ref8 = retriedFile ? await againstClean(pid, { post: retry!, job: retried, seconds: 0, file: retriedFile, report: retried.output?.segments }, 'i8') : null;
  check('I8', 'a planted stale segment (the stored stretch of cells 24 under the key of cell 23, differing on every frame): the plan still says cached, every-segment fails with render_cache_self_check_failed, nothing is published, the entries this export reused are purged and the clean counter is reset; the retry succeeds and equals a clean export',
    !!hB && !!engine && pPlant.view.segments.cached === SEGMENTS_A && failCode === 'render_cache_self_check_failed' && planted.job?.status === 'failed' && same(outBefore, outAfter) && cacheAfterFail.segments < 5 && cleanBefore > 0 && cleanAfter === 0 && retried?.status === 'succeeded' && !!ref8?.ok,
    { failCode, status: planted.job?.status, planPlanted: pPlant.view?.segments, outFilesBefore: outBefore.length, outFilesAfter: outAfter.length, segmentsLeftInCache: cacheAfterFail.segments, cleanCounterBefore: cleanBefore, cleanCounterAfter: cleanAfter, error: planted.job?.error?.message, hint: planted.job?.error?.hint, retry: retried?.status, against: ref8 });

  // ---------------------------------------------------------------- I8b half-stale hashes
  console.log('\n# I8b a stretch stale in half its frames');
  const detection = await halfStale(A.pid, e0.report?.engine);
  measurements.halfStale = detection;
  check('I8b', 'a stretch whose stored per-frame hashes are stale in half its frames (the second half): every-segment (first, last and one seeded frame per stretch) always includes a stale frame (the last) and fails; sample mode detection over 20 seeds is reported (expected about one in two per export on a 5-segment project, since every segment is sampled once)',
    detection.everySegmentDetected && detection.sampleDetections > 0 && detection.sampleRuns === 20, detection);

  // ---------------------------------------------------------------- I7 another thread count
  console.log('\n# I7 PF_SEGMENT_THREADS');
  const was = s.cfg.segmentThreads;
  const other = was === 2 ? 3 : 2;
  const encBefore = e0.report?.encoderId;
  await clearCache();
  const fill7 = await exportRun(pid, INC, 'i7-fill'); // the cache holds every stretch, made with the old thread count
  if (fill7.job?.status !== 'succeeded') throw new Error(`I7: the fill export failed: ${JSON.stringify(fill7.job?.error)}`);
  await reboot({ segmentThreads: other });
  const p7 = await planOf(pid);
  const i7 = await exportRun(pid, INC, 'i7-threads');
  const ref7 = i7.file ? await againstClean(pid, i7, 'i7') : null;
  check('I7', `a restart with another thread count (${was} -> ${other}): every segment misses (the encoder id differs) and the export equals a clean one; no test seam`,
    p7.view?.segments?.render === SEGMENTS_A && p7.view.segments.cached === 0 && i7.report?.reused === 0 && i7.report?.rendered === SEGMENTS_A && !!encBefore && i7.report?.encoderId !== encBefore && !!ref7?.ok, { threads: { was, now: other }, plan: p7.view?.segments, encoderIds: { before: encBefore, after: i7.report?.encoderId }, against: ref7 });
  await reboot();

  // ---------------------------------------------------------------- I11 caps and ceilings
  console.log('\n# I11 cache cap and storage ceiling');
  await runCaps(pid);

  // ---------------------------------------------------------------- I10 flash report across the joins
  console.log('\n# I10 photosensitivity across joins');
  await runFlash();

  // ---------------------------------------------------------------- I19b strobe and snow (Infinity)
  console.log('\n# strobe and snow');
  await runStrobeSnow();

  // ---------------------------------------------------------------- I14 keying ten minutes
  console.log('\n# I14 keying a ten-minute project');
  await runKeying();

  // ---------------------------------------------------------------- I8c the offline mutation
  console.log('\n# I8c a key that ignores the title text');
  mutationCheck(A, comparatorControl);

  // ---------------------------------------------------------------- I18 UI
  console.log('\n# I18 UI');
  await runUi(A);

  // ---------------------------------------------------------------- I17 delete a project
  console.log('\n# I17 delete a project');
  await runDelete(A);

  // ---------------------------------------------------------------- I12, I19 child runs
  await halt(); // the child runs start their own servers; this one must not take their CPU
  await runLong();
  await runRegressions();

  evidence.wallMinutes = +((Date.now() - t0) / 60000).toFixed(1);
  finish(evidence, false);
}

// =====================================================================================================================
const mkStore = () => new SegmentStore({ dir: cacheDir(), capBytes: 2 * 1024 ** 3, autoClear: false, minFreeBytes: 0, quota: () => ({ quotaBytes: 0, otherBytes: 0 }) });
const isSelfCheckFailure = (r: Run) => (r.job?.error?.code ?? r.post.body?.error?.code) === 'render_cache_self_check_failed';

/** I8b: a stretch whose stored per-frame hashes are stale in the second half, on a 5-segment project (every segment is sampled once per export). */
async function halfStale(_pid: string, _engine: unknown) {
  const B8 = await buildFixtureB(api, art, 'half-stale');
  const sample = { format: 'mp4-h264-aac', mode: 'incremental', quality: QUALITY, selfCheck: 'sample' } as const;
  const every = { ...INC } as const;
  await clearCache();
  const fill = async () => { const r = await exportRun(B8.pid, every, 'b8-fill'); if (r.job?.status !== 'succeeded') throw new Error(`I8b: filling the cache failed: ${JSON.stringify(r.job?.error)}`); return r; };
  /** Stops the server, rewrites one stored stretch's per-frame hashes (the second half fabricated), starts it again. */
  const plant = async () => {
    await halt();
    const store = mkStore();
    const key = [...cacheKeys().keys()].sort()[0]!;
    const h = (await store.open(key, { verify: false }))!;
    const tmp = path.join(art, 'half-stale.mp4');
    fs.copyFileSync(h.videoPath, tmp);
    const m = h.meta;
    const stale = m.rgbaSha256.map((x, i) => (i >= m.frames / 2 ? sha256(`stale:${i}:${x}`) : x));
    const cells = await store.readCells(key);
    store.drop([key]);
    const pin = store.pin([]);
    await store.put(key, { videoFile: tmp, frames: m.frames, width: m.width, height: m.height, rgbaSha256: stale, ptsOffsetTicks: m.ptsOffsetTicks, cells, renderMs: m.renderMs, projectId: B8.pid }, pin);
    pin.release();
    store.close();
    await boot();
    return { key, frames: m.frames, staleFrom: Math.ceil(m.frames / 2) };
  };
  await fill();
  const p1 = await plant();
  const ev = await exportRun(B8.pid, every, 'b8-every');
  const everySegmentDetected = isSelfCheckFailure(ev);
  await fill();
  let detections = 0;
  const runs: boolean[] = [];
  for (let k = 0; k < 20; k++) {
    await plant();
    const r = await exportRun(B8.pid, sample, `b8-sample-${k}`);
    const d = isSelfCheckFailure(r);
    runs.push(d);
    if (d) { detections++; await fill(); }
  }
  return { project: 'fixture B, 5 segments, R <= 8 so sample mode checks every segment once', stalePositions: `frames ${p1.staleFrom}..${p1.frames - 1} of the stretch`, everySegmentDetected, everySegmentNote: 'every-segment checks the first, the last and one seeded frame of each stretch; the last frame is in the stale half, so detection is asserted', sampleRuns: runs.length, sampleDetections: detections, sampleDetectionRate: +(detections / runs.length).toFixed(2), perRun: runs };
}

/** I11, I11b: the cache cap and the data-directory ceiling. */
async function runCaps(pid: string) {
  await clearCache();
  const full = await exportRun(pid, INC, 'cap-fill');
  const total = await cacheStatus();
  const outBytes = (full.job?.output?.bytes as number) ?? 0;
  const baseline = full.file!;
  // (1) a cap of about 60 %: a range export fills 15 stretches, the next range needs room: the least recently used go first
  const cap60 = Math.floor(total.usedBytes * 0.7);
  await clearCache();
  await reboot({ renderCacheBytes: cap60 });
  const r1 = await exportRun(pid, { ...INC, range: { startFrame: 0, endFrame: 900 } }, 'cap-r1');
  const s1 = snapshot();
  const created = (m: Map<string, Snap>) => new Map([...m].map(([k, v]) => [k, sidecar(v.path)?.createdAt ?? 0]));
  const c1 = created(s1);
  const r2 = await exportRun(pid, { ...INC, range: { startFrame: 900, endFrame: 1801 } }, 'cap-r2');
  const st1 = await cacheStatus();
  const s2 = snapshot();
  const evicted = [...s1.keys()].filter((k) => !s2.has(k)), survived = [...s1.keys()].filter((k) => s2.has(k));
  const lru = evicted.length > 0 && Math.max(...evicted.map((k) => c1.get(k)!)) <= Math.min(...(survived.length ? survived.map((k) => c1.get(k)!) : [Infinity]));
  check('I11', `a cap of 70 % of the full cache (${cap60} bytes): the cache stays within the cap after each export and at its high-water mark; the oldest stored stretches are evicted first (every evicted stretch is older than every surviving one of the first range)`,
    r1.job?.status === 'succeeded' && r2.job?.status === 'succeeded' && st1.usedBytes <= cap60 && st1.highWaterBytes <= cap60 && lru && (r2.report?.notStored ?? 1) === 0,
    { capBytes: cap60, fullCacheBytes: total.usedBytes, used: st1.usedBytes, highWater: st1.highWaterBytes, range1Segments: s1.size, evicted: evicted.length, survivedFromRange1: survived.length, lruRespected: lru, notStored: [r1.report?.notStored, r2.report?.notStored] });
  // (2) a cap smaller than one export: the export succeeds, some stretches are joined from the job's work directory (notStored), the cache never passes the cap
  const cap30 = Math.floor(total.usedBytes * 0.3);
  await reboot({ renderCacheBytes: cap30 });
  await clearCache();
  const small = await exportRun(pid, INC, 'cap-small');
  const st2 = await cacheStatus();
  let equalToFull = false, minPsnr = NaN;
  if (small.file) { const a = frameMd5(small.file), b = frameMd5(baseline); equalToFull = same(a, b); if (!equalToFull) minPsnr = psnr(small.file, baseline).min; }
  const pcmEq = small.file ? pcm(small.file).equals(pcm(baseline)) : false;
  check('I11c', `a cap smaller than one export (${cap30} bytes): the export succeeds with notStored > 0 and the cache never passes the cap; the file equals the full export`,
    small.job?.status === 'succeeded' && (small.report?.notStored ?? 0) > 0 && st2.usedBytes <= cap30 && st2.highWaterBytes <= cap30 && (equalToFull || minPsnr >= PSNR_FLOOR_DB) && pcmEq, { capBytes: cap30, notStored: small.report?.notStored, used: st2.usedBytes, highWater: st2.highWaterBytes, framesEqual: equalToFull, minPsnr, soundEqual: pcmEq });
  // (3) a storage ceiling: the data directory is sampled every 50 ms during the export and never passes it
  await reboot();
  await clearCache();
  const D0 = dirBytes(dataDir);
  const ceiling = D0 + Math.ceil(total.usedBytes * 0.5) + 24 * 2 ** 20; // room for the sound mix and the joined file and half the cache: the rest cannot be stored
  await reboot({ maxStorageBytes: ceiling });
  let maxSeen = 0;
  const sampler = setInterval(() => { maxSeen = Math.max(maxSeen, dirBytes(dataDir)); }, 50);
  const outsBefore = outFiles();
  const tight = await exportRun(pid, INC, 'cap-ceiling');
  clearInterval(sampler);
  maxSeen = Math.max(maxSeen, dirBytes(dataDir));
  const tightCode = tight.job?.error?.code ?? tight.post.body?.error?.code;
  const outsAfter = outFiles();
  const okTight = tight.job?.status === 'succeeded' || (tightCode === 'storage_quota_exceeded' && same(outsBefore, outsAfter));
  // an impossible ceiling: below what the data directory already holds plus a mix: a typed 507 and nothing published
  await reboot({ maxStorageBytes: dirBytes(dataDir) + 64 * 1024 });
  const outsBefore2 = outFiles();
  const impossible = await exportRun(pid, INC, 'cap-impossible');
  const impCode = impossible.job?.error?.code ?? impossible.post.body?.error?.code;
  check('I11d', 'a tight storage ceiling: the data directory never passes it at any 50 ms sample; the export succeeds, or stops with a typed 507 and nothing published; an impossible ceiling gives the typed 507 and nothing published',
    maxSeen <= ceiling && okTight && impCode === 'storage_quota_exceeded' && same(outsBefore2, outFiles()), { ceiling, startBytes: D0, maxSampledBytes: maxSeen, tightOutcome: tight.job?.status ?? `refused ${tight.post.status}`, tightCode, impossibleOutcome: impossible.job?.status ?? `refused ${impossible.post.status}`, impossibleCode: impCode });
  // I11b: the cache is full and the data directory is at its ceiling: a small upload still succeeds because the reclaimer trims the cache
  await reboot();
  await clearCache();
  await exportRun(pid, INC, 'cap-fill-2');
  const used = dirBytes(dataDir), cacheBefore = (await cacheStatus()).usedBytes;
  await reboot({ maxStorageBytes: used + 100_000 });
  const noise = path.join(art, 'noise.png');
  ff(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360,format=gbrp,geq=r=random(1)*255:g=random(2)*255:b=random(3)*255', '-frames:v', '1', noise]);
  const noiseBytes = fs.statSync(noise).size;
  let uploaded = false, uploadError = '';
  try { await api.upload(pid, noise); uploaded = true; } catch (e) { uploadError = String((e as Error).message).slice(0, 300); }
  const cacheAfter = (await cacheStatus()).usedBytes;
  check('I11b', 'the cache is full and the data directory is within 100 kB of its ceiling: an upload of a file larger than that succeeds because the cache gives room', uploaded && cacheAfter < cacheBefore && noiseBytes > 100_000, { ceiling: used + 100_000, fileBytes: noiseBytes, cacheBytesBefore: cacheBefore, cacheBytesAfter: cacheAfter, uploadError });
  await reboot();
}

/** I10: a strobe-like flashing stretch across the joins at 4 s and 6 s, an edit inside 4–6 s. */
async function runFlash() {
  const B = await buildFixtureB(api, art, 'flash B');
  const fill = await exportRun(B.pid, INC, 'b-fill');
  await api.tx(B.pid, [{ op: 'add_text', args: { text: 'עריכה', start: f(140), duration: f(30), transform: { y: 0 } } }]);
  const inc = await exportRun(B.pid, INC, 'b-inc');
  const single = await exportRun(B.pid, SINGLE, 'b-single');
  const ri = inc.job?.output?.photosensitivity, rs = single.job?.output?.photosensitivity;
  const sec = (x: { value: string; timescale: number }) => Number(x.value) / x.timescale;
  const range = rs?.ranges?.[0];
  const deepEqual = isDeepStrictEqual(ri, rs);
  measurements.photosensitivity = { single: rs, incremental: ri };
  // the edit [140, 170) lies in cell 2 only (frames 120..179): 1 rendered, 4 reused
  check('I10', 'fixture B (a flashing stretch from 3.5 s to 6.5 s across the joins at 4 s and 6 s) with an edit inside 4-6 s: the photosensitivity report of the fast export deep-equals the single pass report of the same revision, the stretch is found, one segment was rendered',
    fill.job?.status === 'succeeded' && inc.job?.status === 'succeeded' && single.job?.status === 'succeeded' && deepEqual && rs?.verdict === 'fail' && rs.ranges.length === 1 && sec(range.from) <= 4 && sec(range.to) >= 6 && inc.report?.rendered === 1 && inc.report?.reused === 4,
    { deepEqual, verdict: rs?.verdict, range: range && { fromSeconds: sec(range.from), toSeconds: sec(range.to), kind: range.kind, flashesPerSecond: range.flashesPerSecond, area: range.area }, incrementalReport: inc.report && { reused: inc.report.reused, rendered: inc.report.rendered }, singleVerdict: rs?.verdict, incVerdict: ri?.verdict, frames: [ri?.frames, rs?.frames] });
}

/** Infinity values stay cacheable (a snow overlay always; a strobe before its first flash); I19b: what a GPU effect does to reuse. */
async function runStrobeSnow() {
  const snow = await buildFixtureC(api, art, 'snow only', { strobe: false });
  await exportRun(snow.pid, INC, 'c-snow-1');
  const ps = await planOf(snow.pid);
  const snowRun = await exportRun(snow.pid, INC, 'c-snow-2');
  const snowCells = cellsOf(C_LAYOUT.snow.start, C_LAYOUT.snow.start + C_LAYOUT.snow.frames);
  check('I3b', 'a snow overlay (a speed limit of Infinity in its graph) keys without error: after one export every segment is cached, none unkeyable, and a second export reuses all',
    ps.status === 200 && ps.view.segments.cached === 4 && ps.view.uncacheable.length === 0 && snowCells.every((c) => segmentsIn(ps.view, 'cached').includes(c)) && snowRun.report?.reused === 4 && snowRun.report?.rendered === 0, { plan: ps.view?.segments, uncacheable: ps.view?.uncacheable, second: snowRun.report && { reused: snowRun.report.reused, rendered: snowRun.report.rendered } });
  const st = await buildFixtureC(api, art, 'strobe and snow', { strobe: true });
  const first = await planOf(st.pid);
  const r1 = await exportRun(st.pid, INC, 'c-strobe-1');
  if (r1.post.status >= 300 || r1.job?.status !== 'succeeded') {
    blocked('I19b', 'a GPU effect on the software adapter (a strobe)', `the export with a strobe did not run on this machine: ${JSON.stringify(r1.job?.error ?? r1.post.body?.error).slice(0, 300)}`);
    return;
  }
  const after = await planOf(st.pid);
  const r2 = await exportRun(st.pid, INC, 'c-strobe-2');
  const codes = after.view.uncacheable.map((u) => u.code);
  const strobeCells = cellsOf(C_LAYOUT.strobe.start, C_LAYOUT.strobe.start + C_LAYOUT.strobe.frames);
  // what the strobe stretches actually did (measured, not typed): cached after the first export and reused by the second
  // (cacheable on a software adapter), or listed as uncacheable for the GPU reason and rendered again; anything else fails
  const cachedNow = segmentsIn(after.view, 'cached'), uncacheableNow = segmentsIn(after.view, 'uncacheable');
  const strobeOutcome = strobeCells.every((c) => cachedNow.includes(c)) && r2.report?.reused === C_SEGMENTS && r2.report?.rendered === 0 ? 'cacheable'
    : strobeCells.every((c) => uncacheableNow.includes(c)) && codes.includes('gpu_not_reproducible') && (r2.report?.uncacheable ?? 0) >= strobeCells.length ? 'uncacheable-gpu' : 'neither';
  measurements.strobe = { outcome: strobeOutcome, cachedAfterFirstExport: segmentsIn(after.view, 'cached'), uncacheable: after.view.uncacheable, strobeCellsReusedOnSecondExport: r2.report?.reused, browser: r1.report?.engine?.browser };
  check('I19b', 'a GPU effect (a strobe: Infinity before its first flash): never unkeyable; either cacheable on the software adapter or uncacheable for the stated GPU reason; the snow stretches stay cached; engine.browser carries the launch mode; what the strobe did to reuse is recorded',
    !codes.includes('unkeyable_value') && !codes.includes('unknown_layer_kind') && snowCells.every((c) => segmentsIn(after.view, 'cached').includes(c)) && /launch=/.test(String(r1.report?.engine?.browser)) && (codes.length === 0 || codes.every((c) => c === 'gpu_not_reproducible')) && strobeOutcome !== 'neither' && first.status === 200,
    { cached: segmentsIn(after.view, 'cached'), uncacheable: after.view.uncacheable, browser: r1.report?.engine?.browser, secondExport: r2.report && { reused: r2.report.reused, rendered: r2.report.rendered, uncacheable: r2.report.uncacheable } });
}

/** I14: the keying time and the event-loop lag of a ten-minute project (the server runs in this process, so the lag is the server's). */
async function runKeying() {
  const L = await buildLongProject(api, art, 'ten minutes');
  const hist = monitorEventLoopDelay({ resolution: 10 });
  hist.enable();
  const t = Date.now();
  const pl = await planOf(L.pid);
  const wall = (Date.now() - t) / 1000;
  hist.disable();
  const lagMs = Math.max(0, hist.max / 1e6 - 10);
  measurements.keyingTenMinutes = { wallSeconds: +wall.toFixed(2), keyingMs: pl.view?.keyingMs, maxEventLoopLagMs: +lagMs.toFixed(1), refreshOnDemand: (pl.view?.keyingMs ?? 0) >= LANE_AUTO_REFRESH_MAX_KEYING_MS };
  check('I14', `keying a ten-minute project (18000 frames, 300 segments): seconds and the maximum event-loop lag are reported; the lag stays under ${LAG_CEILING_MS} ms (from ${LANE_AUTO_REFRESH_MAX_KEYING_MS / 1000} s of keying the lane refreshes on demand only; recorded)`,
    pl.status === 200 && pl.view.segments.total === 300 && pl.view.frames === L.frames && lagMs <= LAG_CEILING_MS, { ...(measurements.keyingTenMinutes as object), segments: pl.view?.segments });
}

/** I8c: the engine's real frame key for the frames of a title before and after a text edit, and with a digest that ignores the text. */
function mutationCheck(A: FixtureA, control: { stale: boolean; differingFrames: number; first: number; last: number; staleFileVerdict: boolean }) {
  try {
    const doc = s.store.getProject(A.pid).doc as ProjectDocument;
    const after = structuredClone(doc);
    const was = (() => { for (const seq of Object.values(after.sequences)) for (const tr of seq.tracks) for (const c of tr.clips) if (c.id === A.titles.t1 && c.type === 'text') { const old = (c as { text: string }).text; (c as { text: string }).text = 'מילה אחרת לגמרי'; return old; } return null; })();
    const base = (d: ProjectDocument, digest: (t: string) => string): FrameKeyContext => ({
      digest, output: { width: W, height: H }, gpu: null,
      assetHash: (id) => (d.assets[id] as { contentHash?: string } | undefined)?.contentHash ?? null, fontHash: () => 'bundled-font', effectVersion: (t) => findEffect(t)?.version ?? 0,
    });
    // frame 700 is under the first title (frames 600..719); frame 10 is not
    const real = [frameKey(doc, 700, base(doc, sha256)), frameKey(after, 700, base(after, sha256))];
    const away = [frameKey(doc, 10, base(doc, sha256)), frameKey(after, 10, base(after, sha256))];
    // the negative control runs the proof's own comparator on a known-bad file: the pre-edit export stands for what a key ignoring the title text would publish
    const inTitle = (n: number) => n >= A_LAYOUT.t1.start && n < A_LAYOUT.t1.start + A_LAYOUT.t1.frames;
    check('I8c', 'the comparator catches a key that ignores one input (the title text): the engine\'s real keys of a frame under the title differ across the text edit and a frame away from it keeps its key; the frame comparator, given the pre-edit file as a stand-in for what such a key would publish, reports it unequal to the clean export, and only inside the title\'s frames',
      was !== null && real[0] !== real[1] && away[0] === away[1] && control.stale && control.staleFileVerdict && control.differingFrames > 0 && inTitle(control.first) && inTitle(control.last), { realDiffer: real[0] !== real[1], awayEqual: away[0] === away[1], editedText: was, comparator: control });
  } catch (e) {
    check('I8c', 'a key that ignores one input (the title text) is detectable', false, { error: String((e as Error).stack ?? e).slice(0, 600) });
  }
}

/** I18: the sheet line and the lane in the editor (they exist only once the lead has mounted them). */
async function runUi(A: FixtureA) {
  await clearCache();
  const fill = await exportRun(A.pid, INC, 'ui-fill');
  await api.tx(A.pid, [{ op: 'update_text', args: { clipId: A.titles.t1, text: 'כותרת לבדיקת הממשק' } }]);
  const pl = await planOf(A.pid);
  if (fill.job?.status !== 'succeeded') { blocked('I18', 'UI: the sheet line and the lane', `the export that fills the cache failed: ${JSON.stringify(fill.job?.error)}`); return; }
  const browser = await chromium.launch();
  try {
    const results = [];
    for (const lang of ['he', 'en'] as const) results.push(await runRenderCacheUiChecks({ browser, ownerUrl: s.ownerUrl, pid: A.pid, lang, plan: pl.view, expectedStale: [10, 11], shotDir: path.join(root, 'docs/evidence') }));
    measurements.ui = results;
    if (results.some((r) => !r.mounted)) { blocked('I18', 'UI: sheet numbers equal the plan, the lane shows the two stale stretches, a11y 0 findings in Hebrew and English', `the lane or the sheet line is not mounted in this build: ${results.map((r) => `${r.lang}: ${r.reason ?? 'ok'}`).join('; ')}`); return; }
    check('I18', 'UI: the sheet numbers equal the plan, the lane shows the two stale segments as one stale stretch, a11y 0 findings in Hebrew and English (screenshots of the sheet line and the lane at 1440 px in RTL in docs/evidence)',
      results.every((r) => r.ok), results);
  } finally { await browser.close(); }
}

/** I17: deleting a project removes the segments only it used; a segment another project shares stays. */
async function runDelete(A: FixtureA) {
  const Y = await buildFixtureA(api, art, { frames: 1801, name: 'incremental Y' });
  await clearCache();
  await exportRun(A.pid, INC, 'del-a');
  const keysA = new Set(cacheKeys().keys());
  const ry = await exportRun(Y.pid, INC, 'del-y');
  const keysBoth = new Set(cacheKeys().keys());
  const onlyY = [...keysBoth].filter((k) => !keysA.has(k));
  const shared = [...keysA].filter((k) => keysBoth.has(k)).length;
  const delY = await own.call(`/projects/${Y.pid}/delete`, { confirmName: 'incremental Y' });
  const afterY = new Set(cacheKeys().keys());
  const delA = await own.call(`/projects/${A.pid}/delete`, { confirmName: 'incremental A' });
  const afterA = new Set(cacheKeys().keys());
  check('I17', 'delete a project: the segments only it used are gone, the ones another project shares stay; deleting the last project that uses them empties the cache',
    ry.job?.status === 'succeeded' && onlyY.length > 0 && (ry.report?.reused ?? -1) === SEGMENTS_A - onlyY.length && delY.status === 200 && onlyY.every((k) => !afterY.has(k)) && [...keysA].every((k) => afterY.has(k)) && delA.status === 200 && afterA.size === 0,
    { keysA: keysA.size, keysOnlyY: onlyY.length, sharedKeys: shared, reportReused: ry.report?.reused, afterDeletingY: afterY.size, afterDeletingA: afterA.size, deleteStatus: [delY.status, delA.status] });
}

/** I12: the ten-minute A/V sync on this route, run by av-sync-long.ts in its incremental mode. */
async function runLong() {
  if (process.env.PF_INC_SKIP_LONG === '1') { blocked('I12', 'ten-minute A/V sync on the fast export route', 'PF_INC_SKIP_LONG=1: not run (it takes several minutes)'); return; }
  console.log('\n# I12 ten-minute A/V sync (av-sync-long.ts, incremental mode)');
  const r = spawnSync('pnpm', ['exec', 'tsx', path.join(root, 'packages/evals/src/av-sync-long.ts')], { cwd: root, env: { ...process.env, PF_AVSYNC_MODE: 'incremental' }, stdio: 'inherit', timeout: 4 * 3600_000 });
  const file = path.join(root, 'docs/evidence/av-sync-long-incremental.json');
  if (!fs.existsSync(file)) { check('I12', 'ten-minute A/V sync on the fast export route', false, { exitCode: r.status, error: 'av-sync-long.ts wrote no incremental evidence' }); return; }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  measurements.avSync = j;
  const ok = (x: any) => x.sync.maxAbsOffsetMs <= SYNC_OFFSET_CEILING_MS && Math.abs(x.sync.driftFirstThirdToLastThirdMs) < SYNC_DRIFT_CEILING_MS && x.sync.flashesDetected > 0;
  const cleanVsSingle = j.times.cleanSegmentedSeconds / j.times.singlePassSeconds, incVsClean = j.times.incrementalSeconds / j.times.cleanSegmentedSeconds;
  check('I12', `ten-minute A/V sync on the fast export route: max offset <= ${SYNC_OFFSET_CEILING_MS} ms and no drift on the clean segmented file and on the incremental file; wall seconds of the single pass, the clean segmented export (<= ${CLEAN_TO_SINGLE_CEILING}x the single pass) and the incremental export (<= ${INC_TO_CLEAN_CEILING * 100} % of clean, target ${INC_TO_CLEAN_TARGET * 100} %)`,
    r.status === 0 && ok(j.clean) && ok(j.incremental) && cleanVsSingle <= CLEAN_TO_SINGLE_CEILING && incVsClean <= INC_TO_CLEAN_CEILING,
    { exitCode: r.status, clean: j.clean.sync, incremental: j.incremental.sync, times: j.times, cleanOverSingle: +cleanVsSingle.toFixed(3), incrementalOverClean: +incVsClean.toFixed(3), targetMet: incVsClean <= INC_TO_CLEAN_TARGET, selfCheckSeconds: j.incremental.report?.ms?.selfCheck, reusedRendered: j.incremental.report && { reused: j.incremental.report.reused, rendered: j.incremental.report.rendered } });
}

/** I19: the regressions (the phase 4 proof and the parity suite), run as they are. */
async function runRegressions() {
  if (process.env.PF_INC_SKIP_REGRESSIONS === '1') { blocked('I19', 'regressions: proof:phase4 and the parity suite', 'PF_INC_SKIP_REGRESSIONS=1: not run'); return; }
  console.log('\n# I19 regressions');
  const run = (script: string) => spawnSync('pnpm', [script], { cwd: root, stdio: 'inherit', timeout: 3 * 3600_000 }).status;
  const phase4 = run('proof:phase4');
  const parity = run('conformance:parity');
  check('I19', 'regressions: proof:phase4 and the parity suite (single-pass route untouched)', phase4 === 0 && parity === 0, { 'proof:phase4 exit code': phase4, 'conformance:parity exit code': parity });
}

function finish(evidence: Record<string, unknown>, blockedAtStart: boolean) {
  const failed = checks.filter((c) => c.pass === false), notRun = checks.filter((c) => c.pass === null), passed = checks.filter((c) => c.pass === true);
  const report = {
    ...evidence, claims: {
      frameEquality: encoderDeterministic === null ? 'not determined' : encoderDeterministic ? 'encoder deterministic (I3): decoded frame md5 lists are equal, and the per-segment RGBA hashes' : 'encoder NOT deterministic (I3): the per-segment RGBA sha256 lists are equal key by key, plus a decoded PSNR floor of 38 dB; decoded md5 equality is not claimed',
      soundEquality: 'decoded 48 kHz stereo PCM of the incremental file equals the clean segmented file sample by sample',
      selfCheck: 'proves the frames it checked, nothing more',
    },
    measurements, summary: { passed: passed.length, failed: failed.length, notRun: notRun.length, blockedAtStart },
    checks,
  };
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nproof:incremental: ${passed.length} passed, ${failed.length} failed, ${notRun.length} not run. Evidence: docs/evidence/incremental-export.json`);
  for (const c of failed) console.log(`  FAILED ${c.id}: ${c.name}`);
  process.exitCode = failed.length ? 1 : notRun.length ? 2 : 0;
}

main().catch(async (e) => {
  console.error(e);
  checks.push({ id: 'crash', name: 'the proof ran to its end', pass: false, numbers: { error: String((e as Error).stack ?? e).slice(0, 1500) } });
  try { await halt(); } catch { /* already stopped */ }
  finish({ ranAt: new Date().toISOString(), crashed: true }, false);
  process.exit(1);
});
