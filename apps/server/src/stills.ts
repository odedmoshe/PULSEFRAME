/**
 * «הפריים הכי חד» on the server (wave 8 cover, version 1): the durable, model-free measurement of the sharpest frames of one
 * stretch of one file, and the read of what is stored. Lead pre-pass: these exports with their final signatures, wired into
 * http.ts (POST/GET …/stills, the cancel dispatch), mcp.ts (find_sharp_frames, read_sharp_frames, cancel_job) and index.ts
 * (recover, stop). W1 builds the bodies here and in stills.math.ts (new), against core stillsContract.ts.
 *
 * Rules W1 keeps (cover-verify C1–C4, C11, C12; the contract's header):
 * - Order of checks in startStillsJob: gov.assertMayAct(p, projectId, 'edit') (as moments), the project (404), the asset (404
 *   not_found), the range (rangeOfClip or the typed one; STILLS_REFUSALS rows), then the cache: every frame of the range already
 *   stored under the current stillsCacheState → { cached: true, answer } and no job. Then one open job per project (409
 *   stills_in_progress, details.jobId) and STILLS_MAX_OPEN_JOBS per server (429 busy).
 * - The job reads the STORED file (frameSource(…, 'original'), never the proxy) with the input seek of the contract, runs the
 *   grey self-check first, and waits while a server export runs (waitForExportIdle before reading AND while reading: the reader
 *   stops pulling frames, so ffmpeg blocks on the pipe, and goes on once the export has ended).
 * - Validated before success (exact frame count, the first and last delivered frames' timestamps equal to the asked frames' times
 *   within a quarter of a frame, every frame of the range has a record), merged as a union by frame (a stored record is never
 *   rewritten), written with Derivatives.put (kind 'stills', meta StillsDerivativeMeta). A cancelled or failed job writes nothing.
 * - Input seeking is not trusted: a read whose frames are not the asked ones (an MPEG-TS seek lands after a key frame and the
 *   decoder drops the frames before the next one) is read once more starting STILLS_SEEK_PREROLL_US earlier, the frames before the
 *   wanted time dropped by their timestamps (`trim=start`); a second miss fails the job frame_count_mismatch, nothing saved.
 * - Recovered after a restart: run again from the start (cached frames make it cheap). Stopped on shutdown: the row stays running.
 * - Agents get numbers only: no image part in any answer.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  isMovingPicture, rangeOfClip, rankStills, startOffsetFrames, stillsCacheState, stillsRefusal, stillsSeekSeconds, stillsStage, videoFrames,
  STILLS_ALGO, STILLS_DERIVATIVE_KIND, STILLS_JOB_TYPE, STILLS_LABEL, STILLS_LONG_SIDE, STILLS_MAX_OPEN_JOBS, STILLS_MAX_RANGE_FRAMES, STILLS_METHOD,
  STILLS_REFUSALS, StillsRefusal,
  type Asset, type FindSharpBody, type FindSharpResult, type ReadSharpQuery, type SharpAnswer, type StillMeasure, type StillsData, type StillsDerivativeMeta, type StillsJobInput, type StillsJobOutput,
} from '@pulseframe/core';
import { heavy, limiter } from './analysis.ts';
import type { Principal } from './auth.ts';
import type { Derivatives } from './derive.ts';
import type { Governance } from './governance.ts';
import type { FifoComputeLane } from './lane.ts';
import { measureFrame } from './stills.math.ts';
import { ApiError, type Store } from './store.ts';
import { ffmpegVersionLine, frameSource, HEAVY_CHUNK, READ_STALL_MS } from './tracking.ts';
import type { FrameSource, GreyFrame } from './vision/types.ts';

/** Frames [first, first + count) of `src` by input seek, grey (or rgb24 for a proof's barcode) at the stills size; see readStillsFrames. */
export type ReadStillsFrames = (src: FrameSource, asset: Pick<Asset, 'video'>, first: number, count: number, onFrame: (frame: number, f: GreyFrame) => void | Promise<void>, signal: AbortSignal, opts?: ReadStillsOptions) => Promise<StillsRead>;
export interface StillsDeps {
  derivatives: Pick<Derivatives, 'get' | 'put'>;
  /** the moments lane: the job waits while a server export runs (momentsLaneOf(exporter.lane)) */
  lane?: Pick<FifoComputeLane, 'waitForExportIdle'>;
  /** Tests and proofs may wrap the reader (to count ffmpeg starts or slow it down); default: readStillsFrames. */
  readFrames?: ReadStillsFrames;
}

/** A core StillsRefusal as the ApiError the routes and tools answer (same status, code, message and hint). */
export function stillsApiError(e: StillsRefusal): ApiError {
  return new ApiError(e.status || 422, e.code, e.message, e.details, e.hint);
}
/** Runs a body that may throw a core StillsRefusal, answering it as its ApiError (routes and MCP tools both use it). */
export function withStillsErrors<R>(fn: () => R): R {
  try { return fn(); } catch (e) { if (e instanceof StillsRefusal) throw stillsApiError(e); throw e; }
}

// ---------- the reader ----------
/** When a seek delivers other frames than asked, the one retry starts this much earlier and drops frames by timestamp. */
export const STILLS_SEEK_PREROLL_US = 10_000_000;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
/** The grey size of the measurement: long side STILLS_LONG_SIDE (never enlarged), even sides, in proportion (as momentsSize). */
export function stillsGreySize(width: number, height: number): { width: number; height: number } {
  const s = Math.min(1, STILLS_LONG_SIDE / Math.max(width, height));
  return { width: even(width * s), height: even(height * s) };
}
export interface ReadStillsOptions { pixFmt?: 'gray' | 'rgb24'; /** start the decode this many microseconds before the seek point and drop the frames before it by timestamp */ prerollUs?: number }
export interface StillsRead {
  frames: number; digest: string;
  /** the seconds written: the input seek and, with a preroll, the trim start (6 decimals) */
  seek: string; trim: string | null;
  /** the first and last delivered frames' times relative to the seek point, and what the asked frames' times are (µs) */
  firstUs: number | null; lastUs: number | null; wantFirstUs: number; wantLastUs: number;
}
/** A read whose frames are not the asked ones (count or timestamps); the job retries once with a preroll, then fails. */
export class StillsSeekMiss extends Error {
  constructor(readonly details: Record<string, unknown>) { super('the frames delivered are not the frames asked for'); this.name = 'StillsSeekMiss'; }
}
export class StillsCanceled extends Error { constructor() { super('canceled'); } }

const usOf = (s: string): number => { const [a, b = ''] = s.split('.'); return Number(a) * 1_000_000 + Number((b + '000000').slice(0, 6)); };
const secondsOfUs = (us: number): string => `${Math.floor(us / 1_000_000)}.${String(us % 1_000_000).padStart(6, '0')}`;
/** Microseconds of source frame `frame` on the file's own clock (from its start): (frame + startOffsetFrames) · den / num, rounded. */
const frameUs = (asset: Pick<Asset, 'video'>, frame: number): number => {
  const v = asset.video!, k = BigInt(frame + startOffsetFrames(v));
  const n = k * BigInt(v.frameRate.den) * 1_000_000n, d = BigInt(v.frameRate.num);
  return Number((2n * n + d) / (2n * d));
};

/**
 * The stills reader (C1): ffmpeg with an argument array, no shell:
 *   -ss S -i <file> -map 0:v:0 -an -frames:v N -vf [trim=start=P,]showinfo,scale=W:H:flags=area,format=gray -fps_mode passthrough
 *   -f rawvideo pipe:1
 * with S = stillsSeekSeconds(asset, first) (minus the preroll P when one is given). Frame k delivered is taken as source frame
 * first + k ONLY after two checks: exactly N frames arrived, and showinfo's timestamps of the first and the last delivered frame
 * (relative to S, as ffmpeg numbers them after an input seek, the container start time included) equal the asked frames' times
 * within a quarter of a frame. Otherwise StillsSeekMiss. The consumer's onFrame may wait (an export running): ffmpeg then blocks
 * on the pipe, and the stall guard is paused meanwhile. SIGKILL on abort; a reader that delivers nothing for READ_STALL_MS is killed.
 */
export async function readStillsFrames(src: FrameSource, asset: Pick<Asset, 'video'>, first: number, count: number, onFrame: (frame: number, f: GreyFrame) => void | Promise<void>, signal: AbortSignal, opts: ReadStillsOptions = {}): Promise<StillsRead> {
  if (!asset.video) throw stillsApiError(stillsRefusal('noVideo', ['?']));
  if (!Number.isSafeInteger(first) || first < 0 || !Number.isSafeInteger(count) || count < 1 || count > STILLS_MAX_RANGE_FRAMES + 1) throw new ApiError(422, 'invalid_range', `cannot read ${count} frames from frame ${first}`, { first, count });
  if (signal.aborted) throw new StillsCanceled();
  const pixFmt = opts.pixFmt ?? 'gray';
  const { width: W, height: H } = stillsGreySize(src.width, src.height);
  const sUs = usOf(stillsSeekSeconds(asset, first));
  const pre = Math.max(0, Math.min(sUs, Math.floor(opts.prerollUs ?? 0)));
  const aUs = sUs - pre;
  const seek = secondsOfUs(aUs), trim = pre > 0 ? secondsOfUs(pre) : null;
  const vf = `${trim ? `trim=start=${trim},` : ''}showinfo,scale=${W}:${H}:flags=area,format=${pixFmt}`;
  const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', '-v', 'info', '-protocol_whitelist', 'file', '-ss', seek, '-i', src.file, '-map', '0:v:0', '-an', '-frames:v', String(count), '-vf', vf, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = () => { if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL'); };
  let stalled = false, spawnError: Error | null = null, tail = '', line = '';
  let timer: NodeJS.Timeout | null = null;
  const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { stalled = true; kill(); }, READ_STALL_MS); };
  const disarm = () => { if (timer) clearTimeout(timer); timer = null; };
  arm();
  const onAbort = () => kill();
  signal.addEventListener('abort', onAbort, { once: true });
  // showinfo: "config in time_base: 1/15360" once, then "n:   0 pts:    256 pts_time:0.0166667 …" per frame
  let tbNum = 0, tbDen = 0;
  const pts = new Map<number, { pts: number; time: string }>();
  const onLine = (l: string) => {
    const tb = /showinfo.*config in time_base:\s*(\d+)\/(\d+)/.exec(l);
    if (tb && !tbDen) { tbNum = Number(tb[1]); tbDen = Number(tb[2]); return; }
    const m = /showinfo.*\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:(\S+)/.exec(l);
    if (m) { const n = Number(m[1]); if (n === 0 || n === count - 1) pts.set(n, { pts: Number(m[2]), time: m[3]! }); return; }
    if (!/showinfo/.test(l)) tail = (tail + l + '\n').slice(-800);
  };
  p.stderr.on('data', (d) => { line += String(d); const parts = line.split('\n'); line = parts.pop() ?? ''; for (const l of parts) onLine(l); });
  const closed = new Promise<{ code: number | null; sig: NodeJS.Signals | null }>((resolve) => {
    p.on('close', (code, sig) => resolve({ code, sig }));
    p.on('error', (e) => { spawnError = e; resolve({ code: null, sig: null }); });
  });
  const size = W * H * (pixFmt === 'rgb24' ? 3 : 1);
  const hash = createHash('sha256');
  let buf = Buffer.alloc(size), have = 0, k = 0;
  try {
    for await (const chunk of p.stdout as AsyncIterable<Buffer>) {
      let off = 0;
      while (off < chunk.length) {
        const n = Math.min(size - have, chunk.length - off);
        chunk.copy(buf, have, off, off + n);
        have += n; off += n;
        if (have < size) break;
        if (k >= count) throw new StillsSeekMiss({ reason: 'more frames than asked', count });
        const data = new Uint8Array(buf.buffer, buf.byteOffset, size);
        hash.update(data);
        disarm();
        await onFrame(first + k, { width: W, height: H, data });
        arm();
        k++;
        buf = Buffer.alloc(size); have = 0;
        if (signal.aborted) throw new StillsCanceled();
      }
    }
    const { code, sig } = await closed;
    if (line) onLine(line);
    if (signal.aborted) throw new StillsCanceled();
    if (spawnError) throw new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${(spawnError as Error).message}`, {}, 'Check that ffmpeg is installed and on the PATH.');
    if (stalled) throw new ApiError(422, 'decode_failed', 'reading the picture stalled and was stopped', {});
    if (code !== 0) throw new ApiError(422, 'decode_failed', `ffmpeg could not decode frames from ${first} of the ${src.kind}`, { exit: code ?? sig, tail: tail.trim().slice(-400) });
    const rel = (n: number): number | null => {
      const r = pts.get(n);
      if (!r) return null;
      return tbDen ? Math.round((r.pts * tbNum * 1_000_000) / tbDen) : usOf(r.time);
    };
    const wantFirstUs = frameUs(asset, first) - aUs, wantLastUs = frameUs(asset, first + count - 1) - aUs;
    const read: StillsRead = { frames: k, digest: hash.digest('hex'), seek, trim, firstUs: rel(0), lastUs: k ? rel(k - 1) : null, wantFirstUs, wantLastUs };
    const quarter = Math.floor((asset.video.frameRate.den * 1_000_000) / (4 * asset.video.frameRate.num));
    const off1 = read.firstUs === null ? null : read.firstUs - wantFirstUs, off2 = read.lastUs === null ? null : read.lastUs - wantLastUs;
    if (have !== 0 || k !== count || off1 === null || off2 === null || Math.abs(off1) > quarter || Math.abs(off2) > quarter)
      throw new StillsSeekMiss({ first, count, got: k, seek, trim, firstUs: read.firstUs, wantFirstUs, lastUs: read.lastUs, wantLastUs, toleranceUs: quarter });
    return read;
  } finally {
    disarm();
    signal.removeEventListener('abort', onAbort);
    kill();
    await Promise.race([closed, new Promise((r) => setTimeout(r, 5000))]); // return only once ffmpeg is gone
  }
}

let greyChecked: Promise<void> | null = null;
/**
 * moments' grey self-check (moments.ts momentsSelfCheck), with the stills reader's own chain: one white and one black picture through
 * scale=…:flags=area,format=gray must come out >= 250 and <= 5 (full-range grey). Once per process; a failure is grey_check_failed
 * with the two numbers and is checked again next time.
 */
export function stillsGreyCheck(): Promise<void> {
  const one = (colour: string) => new Promise<number[]>((resolve, reject) => execFile('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=64x36:r=1:d=1,format=yuv420p`, '-vf', 'scale=32:18:flags=area,format=gray', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', timeout: 30_000 }, (e, out) => (e ? reject(e) : resolve([...(out as Buffer)]))));
  greyChecked ??= (async () => {
    let w: number[] = [], b: number[] = [];
    try { [w, b] = await Promise.all([one('white'), one('black')]); } catch (e) {
      greyChecked = null;
      throw new ApiError(503, 'analysis_unavailable', `ffmpeg could not run the grey self-check (${(e as Error).message}); nothing was measured`, {}, 'Check that ffmpeg is installed and on the PATH.');
    }
    const white = w.length ? Math.min(...w) : -1, black = b.length ? Math.max(...b) : 256;
    if (w.length !== 32 * 18 || b.length !== 32 * 18 || white < 250 || black > 5) { greyChecked = null; throw stillsApiError(stillsRefusal('greyCheck', [white, black], { white, black })); }
  })();
  return greyChecked;
}

// ---------- the data file and the answer ----------
let knownFfmpeg: string | null = null;
const ffmpegLine = async () => (knownFfmpeg = await ffmpegVersionLine());
const warming = ffmpegLine(); // warm: the synchronous read and the cache check of a POST need the build line
/**
 * Resolves once the ffmpeg build line is known (it never rejects: an ffmpeg that cannot run gives 'unknown'). The routes and the
 * MCP tools await it before startStillsJob / readSharpFrames, so a first read right after start answers what is stored instead of
 * "nothing measured" (W1 note 5).
 */
export const stillsReady = (): Promise<string> => warming;
/** The build line, or the honest 503 stills_warming («עוד רגע») when a caller did not await stillsReady and it is not known yet. */
function ffmpegKnown(): string {
  if (knownFfmpeg === null) throw stillsApiError(stillsRefusal('warming', []));
  return knownFfmpeg;
}
const own = <V>(o: Record<string, V>, k: string): V | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

/** The stored data file of an asset when it can be merged into (same algo, long side, ffmpeg build and file), else null. */
function storedData(store: Store, d: StillsDeps['derivatives'], asset: Asset, line: string | null): StillsData | null {
  if (!line) return null;
  const row = d.get(asset.contentHash, STILLS_DERIVATIVE_KIND);
  if (row?.status !== 'ready' || !row.blobHash) return null;
  if (stillsCacheState(row.meta as Partial<StillsDerivativeMeta> | null, line) !== 'hit') return null;
  try {
    const data = JSON.parse(fs.readFileSync(store.blobPath(row.blobHash), 'utf8')) as StillsData;
    const grey = stillsGreySize(asset.video!.width, asset.video!.height);
    if (data.algo !== STILLS_ALGO || data.asset?.contentHash !== asset.contentHash || data.longSide !== STILLS_LONG_SIDE || data.ffmpeg !== line || data.grey?.width !== grey.width || data.grey?.height !== grey.height || !Array.isArray(data.measured)) return null;
    return data;
  } catch { return null; }
}
function answerOf(assetId: string, asset: Asset, from: number, to: number, data: StillsData | null): SharpAnswer {
  const frames = (data?.measured ?? []).filter((m) => m.frame >= from && m.frame < to);
  const complete = frames.length === to - from;
  const ranking = complete ? rankStills(asset, frames, from, to) : { median: null, candidates: [] };
  const v = asset.video!;
  return {
    assetId, from, to, measuredFrames: frames.length, complete, median: ranking.median, candidates: ranking.candidates,
    frames: frames.map((m) => ({ ...m })),
    source: { width: v.width, height: v.height, rate: { num: v.frameRate.num, den: v.frameRate.den }, conformed: asset.conform ? [...asset.conform.reasons] : null },
    method: STILLS_METHOD, label: { he: STILLS_LABEL.he, en: STILLS_LABEL.en }, heuristic: true,
  };
}
/** The checks of a typed stretch, shared by POST and GET. */
function checkStretch(asset: Asset, from: number, to: number): void {
  if (!isMovingPicture(asset)) throw stillsRefusal('noVideo', [asset.id], { assetId: asset.id });
  if (to <= from) throw stillsRefusal('emptyRange', [from, to], { from, to });
  const frames = videoFrames(asset)!;
  if (to > frames) throw stillsRefusal('outsideFile', [from, to, frames], { from, to, frames });
}
function assetOf(store: Store, projectId: string, assetId: string): Asset {
  const asset = own(store.getProject(projectId).doc.assets, assetId);
  if (!asset) throw new ApiError(404, 'not_found', `asset ${assetId} not found`, { assetId }, 'get_summary lists the library files.');
  return asset;
}

// ---------- jobs ----------
const stillsLane = limiter(1, STILLS_MAX_OPEN_JOBS + 1);
interface Running { store: Store; ac: AbortController; done: Promise<void>; shutdown: boolean }
const running = new Map<string, Running>();
const STAGE_EVERY_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const yieldNow = () => new Promise<void>((r) => setImmediate(r));

/** POST …/stills and MCP find_sharp_frames: a job (202) or the stored answer. */
export function startStillsJob(store: Store, gov: Governance, p: Principal, projectId: string, body: FindSharpBody, deps: StillsDeps): FindSharpResult {
  gov.assertMayAct(p, projectId, 'edit');
  const proj = store.getProject(projectId); // 404 before anything else
  const line = ffmpegKnown();
  const asset = assetOf(store, projectId, body.assetId);
  if (!isMovingPicture(asset)) throw stillsRefusal('noVideo', [asset.id], { assetId: asset.id });
  let from: number, to: number;
  if (body.clipId !== undefined) {
    const r = rangeOfClip(proj.doc, body.clipId);
    if (r.assetId !== asset.id) throw stillsRefusal('otherFile', [body.clipId, asset.id], { clipId: body.clipId, assetId: asset.id, clipAssetId: r.assetId });
    ({ from, to } = r);
  } else {
    from = body.from!; to = body.to!;
    checkStretch(asset, from, to);
    if (to - from > STILLS_MAX_RANGE_FRAMES) throw stillsRefusal('rangeTooLong', [to - from, STILLS_MAX_RANGE_FRAMES], { from, to, max: STILLS_MAX_RANGE_FRAMES });
  }
  const answer = answerOf(asset.id, asset, from, to, storedData(store, deps.derivatives, asset, line));
  if (answer.complete) return { cached: true, answer };
  const open = store.openJobs(STILLS_JOB_TYPE);
  const same = open.find((j) => j.projectId === projectId);
  if (same) throw stillsRefusal('inProgress', [], { jobId: same.id, status: same.status });
  if (open.length >= STILLS_MAX_OPEN_JOBS) throw stillsRefusal('busy', [STILLS_MAX_OPEN_JOBS], { retryAfterSeconds: 30 });
  const input: StillsJobInput = { assetId: asset.id, from, to, clipId: body.clipId ?? null };
  const job = store.createJob(projectId, STILLS_JOB_TYPE, p.actor, input);
  setImmediate(() => void runStillsJob(store, job.id, deps)); // the answer reports the job as it is: queued
  const j = store.getJob(job.id);
  return { jobId: j.id, status: j.status };
}
/** GET …/stills and MCP read_sharp_frames: what is stored for [from, to), complete or not (never starts a job). */
export function readSharpFrames(store: Store, projectId: string, q: ReadSharpQuery, deps: Pick<StillsDeps, 'derivatives'>): SharpAnswer {
  store.getProject(projectId); // 404 before anything else
  const line = ffmpegKnown();
  const asset = assetOf(store, projectId, q.assetId);
  checkStretch(asset, q.from, q.to);
  return answerOf(asset.id, asset, q.from, q.to, storedData(store, deps.derivatives, asset, line));
}
/** Cancel a stills job: a queued one is removed; a running one stops (ffmpeg is killed) and writes nothing. */
export function cancelStillsJob(store: Store, jobId: string, actor: string): { jobId: string; status: string; outcome: string } {
  const j = store.getJob(jobId);
  if (j.type !== STILLS_JOB_TYPE) throw new ApiError(409, 'invalid_request', `job ${jobId} is not a stills job`);
  if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
  const r = running.get(jobId);
  if (j.status === 'queued' || !r) {
    store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor}; nothing saved` } });
    r?.ac.abort();
    return { jobId, status: 'canceled', outcome: j.status === 'queued' ? 'removed-from-queue' : 'stopped' };
  }
  store.updateJob(jobId, { status: 'cancel-requested' });
  r.ac.abort();
  return { jobId, status: 'cancel-requested', outcome: 'stopping' };
}
/** After a restart: stills jobs cut off are run again from the start (stored frames are reused); a cancel asked before is honoured. */
export function recoverStillsJobs(store: Store, deps: StillsDeps): number {
  for (const j of store.openJobs(STILLS_JOB_TYPE)) if (j.status === 'cancel-requested') store.updateJob(j.id, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; nothing saved' } });
  const jobs = store.recoverJobs(STILLS_JOB_TYPE);
  for (const j of jobs) void runStillsJob(store, j.id, deps);
  return jobs.length;
}
/** Shutdown: running readers are killed; their rows stay running for recoverStillsJobs. */
export async function stopStillsJobs(store: Store): Promise<void> {
  const mine = [...running.values()].filter((r) => r.store === store);
  for (const r of mine) { r.shutdown = true; r.ac.abort(); }
  await Promise.all(mine.map((r) => r.done.catch(() => {})));
}

/** Runs (or joins) a stills job; exported for tests and the proof. */
export function runStillsJob(store: Store, jobId: string, deps: StillsDeps): Promise<void> {
  const prior = running.get(jobId);
  if (prior) return prior.done;
  const r: Running = { store, ac: new AbortController(), done: Promise.resolve(), shutdown: false };
  running.set(jobId, r);
  r.done = (async () => {
    let started = false;
    try {
      for (;;) {
        try {
          await stillsLane(async () => { started = true; await work(store, jobId, deps, r.ac.signal); });
          return;
        } catch (e) {
          if (!started && e instanceof ApiError && e.code === 'busy' && !r.ac.signal.aborted) { await sleep(1000); continue; }
          throw e;
        }
      }
    } catch (e) {
      if (r.shutdown) return;
      try {
        if (['succeeded', 'failed', 'canceled'].includes(store.getJob(jobId).status)) return;
        if (e instanceof StillsCanceled || r.ac.signal.aborted || store.getJob(jobId).status === 'cancel-requested') store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; nothing saved' } });
        else {
          const err = e instanceof StillsRefusal ? stillsApiError(e) : e;
          if (!(err instanceof ApiError)) console.error(e);
          store.updateJob(jobId, { status: 'failed', stage: null, error: err instanceof ApiError ? err.toJSON().error : { code: 'internal_error', message: 'measuring the sharpest frame failed unexpectedly; nothing saved' } });
        }
      } catch (e2) { console.error(e2); }
    } finally {
      running.delete(jobId);
    }
  })();
  return r.done;
}

/** Hold the shared heavy slot until the returned release is called (as moments does); a cancel while waiting rejects at once. */
function holdHeavy(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return false; settled = true; signal.removeEventListener('abort', onAbort); fn(); return true; };
    const onAbort = () => settle(() => reject(new StillsCanceled()));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    const attempt = () => {
      if (settled) return;
      heavy(() => new Promise<void>((release) => { if (!settle(() => resolve(release))) release(); }))
        .catch((e) => { if (settled) return; if (e instanceof ApiError && e.code === 'busy') setTimeout(attempt, 250); else settle(() => reject(e)); });
    };
    attempt();
  });
}
async function exportIdle(deps: StillsDeps, signal: AbortSignal): Promise<void> {
  if (!deps.lane) return;
  try { await deps.lane.waitForExportIdle(signal); } catch (e) { if (signal.aborted) throw new StillsCanceled(); throw e; }
}

async function work(store: Store, jobId: string, deps: StillsDeps, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new StillsCanceled();
  const job = store.getJob(jobId);
  if (job.status !== 'queued') return; // canceled while it waited
  const input = job.input as StillsJobInput;
  const { from, to } = input;
  const total = to - from;
  let lastStage = -Infinity;
  const stage = (done: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastStage < STAGE_EVERY_MS) return;
    const status = store.getJob(jobId).status;
    if (signal.aborted || (status !== 'queued' && status !== 'running')) throw new StillsCanceled(); // a cancel is never overwritten
    lastStage = now;
    store.updateJob(jobId, { status: 'running', stage: stillsStage(done, total) });
  };
  stage(0, true);
  const t0 = performance.now();
  await exportIdle(deps, signal);
  const asset = own(store.getProject(job.projectId).doc.assets, input.assetId);
  if (!asset) throw new ApiError(404, 'not_found', `asset ${input.assetId} is no longer in the project; nothing was measured`, { assetId: input.assetId });
  checkStretch(asset, from, to);
  const line = await ffmpegLine();
  const d = deps.derivatives;
  const old = storedData(store, d, asset, line);
  const have = new Map<number, StillMeasure>((old?.measured ?? []).map((m) => [m.frame, m]));
  const missing: number[] = [];
  for (let f = from; f < to; f++) if (!have.has(f)) missing.push(f);
  const reused = total - missing.length;
  let readCount = 0;
  let readRow: StillsData['reads'][number] | null = null;
  const fresh = new Map<number, StillMeasure>();
  if (missing.length) {
    const m0 = missing[0]!, m1 = missing[missing.length - 1]!;
    const first = m0 > 0 ? m0 - 1 : 0; // the frame before, for motion (C4)
    const count = m1 + 1 - first;
    const src = frameSource(store, d, asset, 'original'); // the STORED file, never the proxy (C2)
    if (!fs.existsSync(src.file)) throw new ApiError(404, 'not_found', 'the stored file of this asset is missing; nothing was measured', { assetId: asset.id }, 'Import the file again.');
    await stillsGreyCheck();
    const read = deps.readFrames ?? readStillsFrames;
    const attempt = async (prerollUs: number) => {
      fresh.clear();
      let prev: GreyFrame | null = null, inHold = 0;
      let release = await holdHeavy(signal);
      try {
        const r = await read(src, asset, first, count, async (frame, f) => {
          if (frame >= m0) fresh.set(frame, measureFrame(frame, prev, f));
          prev = f;
          if (++inHold >= HEAVY_CHUNK) { release(); release = () => {}; inHold = 0; release = await holdHeavy(signal); }
          await exportIdle(deps, signal); // an export started meanwhile goes first: the pipe waits
          await yieldNow();
          if (signal.aborted) throw new StillsCanceled();
          if (frame >= m0) stage(reused + [...fresh.keys()].filter((x) => x >= from && x < to).length);
        }, signal, { prerollUs });
        return r;
      } finally { release(); }
    };
    let r: StillsRead;
    try { r = await attempt(0); } catch (e) {
      if (!(e instanceof StillsSeekMiss)) throw e;
      try { r = await attempt(STILLS_SEEK_PREROLL_US); } catch (e2) {
        if (!(e2 instanceof StillsSeekMiss)) throw e2;
        const got = Number(e2.details.got ?? 0), details = { first: e.details, second: e2.details };
        if (got !== count) throw stillsApiError(stillsRefusal('decodeFailed', [got, count], details));
        // the count was right but the timestamps say the frames are not the asked ones: same code and way forward, its own sentence
        throw stillsApiError(stillsRefusal('decodeTimes', [count, STILLS_SEEK_PREROLL_US / 1_000_000], details));
      }
    }
    readCount = r.frames;
    readRow = { from: first, to: m1 + 1, digest: r.digest };
  }
  // validated before success: every frame of the range has a record; a stored record is never rewritten
  const merged = new Map(have);
  for (const [f, m] of fresh) if (!merged.has(f)) merged.set(f, m);
  for (let f = from; f < to; f++) if (!merged.has(f)) throw stillsApiError(stillsRefusal('decodeFailed', [readCount, total], { missingFrame: f }));
  const v = asset.video!;
  const data: StillsData = {
    algo: STILLS_ALGO, method: STILLS_METHOD, longSide: STILLS_LONG_SIDE, ffmpeg: line,
    asset: { contentHash: asset.contentHash, frames: videoFrames(asset)!, rate: { num: v.frameRate.num, den: v.frameRate.den }, width: v.width, height: v.height, startOffsetFrames: startOffsetFrames(v) },
    grey: stillsGreySize(v.width, v.height),
    measured: [...merged.values()].sort((a, b) => a.frame - b.frame),
    reads: [...(old?.reads ?? []), ...(readRow ? [readRow] : [])],
  };
  if (readRow) {
    const status = store.getJob(jobId).status;
    if (signal.aborted || status !== 'running') throw new StillsCanceled(); // nothing is written after a cancel
    const tmp = path.join(store.tmpDir, `st_${randomBytes(8).toString('hex')}.json`);
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    const meta: StillsDerivativeMeta = { algo: STILLS_ALGO, longSide: STILLS_LONG_SIDE, ffmpeg: line, frames: data.measured.length };
    try { await d.put(asset.contentHash, STILLS_DERIVATIVE_KIND, tmp, 'application/json', meta as unknown as Record<string, unknown>); } finally { fs.rmSync(tmp, { force: true }); }
  }
  const status = store.getJob(jobId).status;
  if (signal.aborted || status !== 'running') throw new StillsCanceled();
  const output: StillsJobOutput = { answer: answerOf(asset.id, asset, from, to, data), read: readCount, reused, wallSeconds: Math.round(performance.now() - t0) / 1000 };
  store.updateJob(jobId, { status: 'succeeded', stage: stillsStage(total, total), output });
}
