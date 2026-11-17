/**
 * Motion tracking jobs (ADR-0015). A track's machine samples are computed by a durable job of type 'tracking' with the
 * model-free kernel in ./vision (pyramidal Lucas–Kanade median flow, NCC verification; no AI model) and attached through the
 * internal op attach_motion_track, exactly like analysis results (http.ts measureAndAttach). Nothing is attached when the job
 * is canceled, when the track or its media changed while it ran (track_changed), or when anything fails.
 *
 * Frames come from the asset's editing proxy when it is ready (its frames map 1:1 to the original's, derive.ts) or else from
 * the stored media, decoded by ffmpeg with `trim` on the frame counter, so output frame k is evaluator source index k
 * (core sourceFrameIndexAt; the thumbnail rule of derive.ts) with no timestamp arithmetic. Each read decodes from the start of
 * the file (a seek reader is wave 2): backward passes read 240-frame chunks forward and walk them in reverse.
 *
 * The CPU work runs on the server's event loop, so the runner yields after every frame (setImmediate) and holds the shared
 * `heavy` slot for at most 300 frames at a time so still renders and loudness measurements interleave. One tracking job runs
 * at a time (trackingLane); at most four wait.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as T from '@pulseframe/time';
import { MAX_PROJECT_TRACK_SAMPLES, MAX_TRACK_SAMPLES, SIZE_UNIT, ST, TRACK_MARGIN_FRAMES, TRACK_UNIT, TRACK_WORK_HEIGHT, TRACKER_METHOD, TRACKING_JOB_TYPE, sourceFrameIndexAt, trackSummary, trackingStage, type Asset, type MotionTrack, type MotionTrackView, type ProjectDocument, type TrackingJobInput, type TrackingJobOutput, type TrackRun } from '@pulseframe/core';
import { heavy, limiter } from './analysis.ts';
import type { Principal } from './auth.ts';
import type { Derivatives } from './derive.ts';
import type { Governance } from './governance.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import { createTracker, TRACKER_ALGO } from './vision/tracker.ts';
import type { FrameSource, GreyFrame, ReadFrames, Tracker, TrackerStep } from './vision/types.ts';

/** A reader that delivers no frame for this long is killed (analysis.ts kills its processes after the same time). */
export const READ_STALL_MS = 10 * 60_000;
/** Frames the runner works on per hold of the shared `heavy` slot. */
export const HEAVY_CHUNK = 300;
/** Frames per backward chunk (read forward, then walked in reverse). */
export const BACKWARD_CHUNK = 240;
/** Usable samples of the two passes that disagree by more than this (work px) make the frame weak. */
const DISAGREE_PX = 2;
/** Stage text is written at most this often (export.ts throttles its progress the same way). */
const STAGE_EVERY_MS = 500;

export interface TrackingDeps {
  /** Where the editing proxy is looked up; without it the stored media is read. */
  derivatives?: Pick<Derivatives, 'get'> | null;
  /** Frame reader (tests may wrap it); default readFrames below. */
  readFrames?: ReadFrames;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
/** Work frame size: at most TRACK_WORK_HEIGHT high (never enlarged), width in proportion and even. */
export function workSize(srcW: number, srcH: number, workHeight = TRACK_WORK_HEIGHT): { width: number; height: number } {
  const height = Math.min(workHeight, srcH);
  return { width: even((srcW * height) / srcH), height };
}

export class TrackingCanceled extends Error { constructor() { super('canceled'); } }

/**
 * Frames [from, to) of the source at work size, grey, in order. ffmpeg runs with an argument array (no shell); `trim` counts
 * decoded pictures, so the k-th output is source index from + k. The count must equal to − from (frame_count_mismatch
 * otherwise). An abort SIGKILLs ffmpeg and rejects with TrackingCanceled. digest = SHA-256 of all grey bytes delivered.
 * onFrame may be async: reading waits for it (the pipe applies back-pressure).
 */
export const readFrames: ReadFrames = async (src, from, to, workHeight, onFrame, signal) => {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) throw new ApiError(422, 'invalid_range', `cannot read frames [${from}, ${to})`, { from, to });
  if (signal.aborted) throw new TrackingCanceled();
  const { width: W, height: H } = workSize(src.width, src.height, workHeight);
  const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-i', src.file, '-map', '0:v:0', '-an', '-vf', `trim=start_frame=${from}:end_frame=${to},scale=${W}:${H}:flags=area,format=gray`, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = () => { if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL'); };
  let stalled = false, spawnError: Error | null = null, err = '';
  let timer = setTimeout(() => { stalled = true; kill(); }, READ_STALL_MS);
  const onAbort = () => kill();
  signal.addEventListener('abort', onAbort, { once: true });
  p.stderr.on('data', (d) => { err = (err + d).slice(-800); });
  const closed = new Promise<{ code: number | null; sig: NodeJS.Signals | null }>((resolve) => {
    p.on('close', (code, sig) => resolve({ code, sig }));
    p.on('error', (e) => { spawnError = e; resolve({ code: null, sig: null }); }); // a process that never started may not emit 'close'
  });
  const size = W * H;
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
        const data = new Uint8Array(buf.buffer, buf.byteOffset, size);
        hash.update(data);
        if (k >= to - from) throw new ApiError(422, 'frame_count_mismatch', `ffmpeg delivered more than the ${to - from} frames asked for`, { expected: to - from });
        await onFrame(from + k, { width: W, height: H, data });
        k++;
        buf = Buffer.alloc(size); have = 0;
        clearTimeout(timer);
        timer = setTimeout(() => { stalled = true; kill(); }, READ_STALL_MS);
        if (signal.aborted) throw new TrackingCanceled();
      }
    }
    const { code, sig } = await closed;
    if (signal.aborted) throw new TrackingCanceled();
    if (spawnError) throw new ApiError(503, 'tracking_unavailable', `ffmpeg could not be started: ${(spawnError as Error).message}`);
    if (stalled) throw new ApiError(422, 'decode_failed', 'reading frames stalled and was stopped', { from, to });
    if (code !== 0) throw new ApiError(422, 'decode_failed', `ffmpeg could not decode frames [${from}, ${to}) of the ${src.kind}`, { exit: code ?? sig, tail: err.trim().slice(-400) });
    if (have !== 0 || k !== to - from) throw new ApiError(422, 'frame_count_mismatch', `ffmpeg delivered ${k} frames for [${from}, ${to}) of the ${src.kind}; expected ${to - from}`, { expected: to - from, got: k, from, to });
    return { frames: k, digest: hash.digest('hex') };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    kill();
    await Promise.race([closed, new Promise((r) => setTimeout(r, 5000))]); // return only once ffmpeg is gone
  }
};

let ffmpegVersion: Promise<string> | null = null;
/** First line of `ffmpeg -version` (recorded with every track: the proxy is encoded by this build's x264). */
export const ffmpegVersionLine = () => (ffmpegVersion ??= new Promise((resolve) => execFile('ffmpeg', ['-hide_banner', '-version'], { timeout: 10_000 }, (e, out) => resolve(e ? 'unknown' : String(out).split('\n')[0]!.trim().slice(0, 120)))));

/** Frames in the asset's stream, as sourceFrameIndexAt counts them. */
export const assetFrames = (a: Asset): number => a.video!.frameCount ?? Math.max(1, T.frameIndexAt(a.duration, a.video!.frameRate));

/** The proxy when it is ready and maps frames 1:1 to the original; otherwise the stored media. */
export function frameSource(store: Store, derivatives: TrackingDeps['derivatives'], asset: Asset, want: 'proxy' | 'original'): FrameSource {
  const v = asset.video!;
  const row = want === 'proxy' ? derivatives?.get(asset.contentHash, 'proxy') : null;
  const m = row?.meta as { frameMapping?: string; proxy?: { width: number; height: number; frameCount: number; frameRate: { num: number; den: number } } } | null | undefined;
  if (row?.status === 'ready' && row.blobHash && m?.frameMapping === 'identity' && m.proxy) return { file: store.blobPath(row.blobHash), kind: 'proxy', blobHash: row.blobHash, width: m.proxy.width, height: m.proxy.height, frameCount: m.proxy.frameCount, rate: m.proxy.frameRate };
  return { file: store.blobPath(asset.contentHash), kind: 'original', blobHash: asset.contentHash, width: v.width, height: v.height, frameCount: assetFrames(asset), rate: v.frameRate };
}

const ownTrack = (doc: ProjectDocument, id: string): MotionTrack | undefined => (doc.motionTracks && Object.hasOwn(doc.motionTracks, id) ? doc.motionTracks[id] : undefined);
/** Source frames of the track's manual samples, ascending. */
export const manualFrames = (t: MotionTrack): number[] => t.st.flatMap((st, i) => (st === ST.manual ? [t.from + i] : []));

/**
 * The frames a run covers. Default: the union over the asset's clips on video tracks of the source frames shown at their first
 * and last timeline frame, widened by TRACK_MARGIN_FRAMES and always including the manual samples, clamped to the media; the
 * whole media when no clip uses it. Explicit from/to replace either end. Refused when it has no manual sample, leaves the
 * media, or would make the track (or the project's tracks) hold more samples than allowed.
 */
export function trackingRange(doc: ProjectDocument, track: MotionTrack, asset: Asset, run: Pick<TrackRun, 'from' | 'to'>): { from: number; to: number } {
  const total = assetFrames(asset);
  const rate = doc.settings.frameRate;
  const manual = manualFrames(track);
  let lo = Infinity, hi = -Infinity;
  for (const seq of Object.values(doc.sequences))
    for (const tr of seq.tracks) {
      if (tr.kind !== 'video') continue;
      for (const c of tr.clips) {
        if (c.type !== 'media' || c.assetId !== asset.id) continue;
        const last = T.max(c.start, T.sub(T.add(c.start, c.duration), T.frameTime(1, rate)));
        const a = sourceFrameIndexAt({ ...asset, video: asset.video! }, c, c.start, rate), b = sourceFrameIndexAt({ ...asset, video: asset.video! }, c, last, rate);
        lo = Math.min(lo, a, b); hi = Math.max(hi, a, b);
      }
    }
  if (lo === Infinity) { lo = 0; hi = total - 1; }
  else { lo -= TRACK_MARGIN_FRAMES; hi += TRACK_MARGIN_FRAMES; }
  for (const f of manual) { lo = Math.min(lo, f); hi = Math.max(hi, f); }
  const from = run.from ?? Math.max(0, lo), to = run.to ?? Math.min(total, hi + 1);
  if (from >= to) throw new ApiError(422, 'invalid_range', `the range [${from}, ${to}) is empty`, { from, to });
  if (to > total) throw new ApiError(422, 'out_of_bounds', `the media has ${total} frames; the range ends at ${to}`, { from, to, frames: total });
  if (to - from > MAX_TRACK_SAMPLES) throw new ApiError(422, 'range_too_long', `${to - from} frames is more than one track can hold (${MAX_TRACK_SAMPLES})`, { from, to, max: MAX_TRACK_SAMPLES }, 'Give a shorter from/to range.');
  if (!manual.some((f) => f >= from && f < to)) throw new ApiError(422, 'no_anchor', `no manual sample of the track lies in [${from}, ${to})`, { from, to, manualFrames: manual.slice(0, 20) }, 'Place the point or box on a frame inside the range first (edit_motion_track set).');
  const after = Math.max(track.from + track.x.length, to) - Math.min(track.from, from);
  if (after > MAX_TRACK_SAMPLES) throw new ApiError(422, 'range_too_long', `the track would hold ${after} samples; at most ${MAX_TRACK_SAMPLES}`, { from, to, samples: after, max: MAX_TRACK_SAMPLES }, 'Track a range closer to the existing samples, or start a new track.');
  const others = Object.values(doc.motionTracks ?? {}).reduce((n, t) => n + (t.id === track.id ? 0 : t.x.length), 0);
  if (others + after > MAX_PROJECT_TRACK_SAMPLES) throw new ApiError(422, 'range_too_long', `the project's motion tracks would hold ${others + after} samples; at most ${MAX_PROJECT_TRACK_SAMPLES}`, { from, to, projectSamples: others + after, max: MAX_PROJECT_TRACK_SAMPLES }, 'Remove tracks that are no longer needed, or track a shorter range.');
  return { from, to };
}

// ---------- jobs ----------
const trackingLane = limiter(1, 4);
interface Running { store: Store; ac: AbortController; done: Promise<void>; shutdown: boolean }
const running = new Map<string, Running>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const yieldNow = () => new Promise<void>((r) => setImmediate(r));

/** Everything that can be refused before a tracking job exists (also re-checked when it runs). */
function checkTrack(store: Store, projectId: string, motionTrackId: string, overwrite: boolean | undefined) {
  const p = store.getProject(projectId);
  const track = ownTrack(p.doc, motionTrackId);
  if (!track) throw new ApiError(404, 'not_found', `motion track ${motionTrackId} not found`, { motionTrackId }, 'get_summary and the project document list the motion tracks.');
  const asset = p.doc.assets[track.assetId];
  if (!asset) throw new ApiError(404, 'asset_not_found', `the media of motion track ${motionTrackId} is not in the library`, { motionTrackId, assetId: track.assetId });
  if (!asset.video) throw new ApiError(422, 'no_video', 'the media of this track has no moving picture to track', { assetId: asset.id });
  if (track.origin.edited && !overwrite) throw new ApiError(409, 'would_discard_edits', 'this track was corrected by hand; tracking again would replace its machine samples (hand-placed samples are always kept)', { motionTrackId }, 'Pass overwrite=true to track again.');
  return { p, track, asset };
}

/** Start a tracking job (202). Permission as for analysis: edit rights, agents not paused, and a grant without track or range limits. */
export function startTrackingJob(store: Store, gov: Governance, principal: Principal, projectId: string, motionTrackId: string, run: TrackRun, deps: TrackingDeps = {}): JobRow {
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'change motion tracks');
  const { p, track, asset } = checkTrack(store, projectId, motionTrackId, run.overwrite);
  const open = store.openJobs(TRACKING_JOB_TYPE);
  const same = open.find((j) => j.projectId === projectId && j.input?.motionTrackId === motionTrackId);
  if (same) throw new ApiError(409, 'tracking_in_progress', 'this track is already being tracked', { jobId: same.id, status: same.status }, 'Wait for that job, or cancel it first.');
  if (open.length >= 5) throw new ApiError(429, 'busy', 'too many tracking jobs are already running or waiting; try again shortly', { retryAfterSeconds: 30 });
  const range = trackingRange(p.doc, track, asset, run);
  const input: TrackingJobInput = { motionTrackId, assetId: asset.id, from: range.from, to: range.to, direction: run.direction ?? 'both', input: run.input ?? 'proxy', ...(run.overwrite ? { overwrite: true as const } : {}), trackVersion: store.entityVersion(projectId, motionTrackId)?.revision ?? null, projectRevision: p.revision };
  const job = store.createJob(projectId, TRACKING_JOB_TYPE, principal.actor, input);
  void runTrackingJob(store, job.id, deps);
  return store.getJob(job.id);
}

/** Cancel: a queued job is removed; a running one stops (ffmpeg is killed) and attaches nothing. */
export function cancelTrackingJob(store: Store, jobId: string, actor: string) {
  const j = store.getJob(jobId);
  if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
  const r = running.get(jobId);
  if (j.status === 'queued' || !r) {
    store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: j.status === 'queued' ? `canceled by ${actor} before it started; nothing attached` : 'canceled; nothing attached' } });
    r?.ac.abort();
    return { jobId, status: 'canceled', outcome: j.status === 'queued' ? 'removed-from-queue' : 'stopped' };
  }
  store.updateJob(jobId, { status: 'cancel-requested' });
  r.ac.abort();
  return { jobId, status: 'cancel-requested', outcome: 'stopping', note: 'the tracker is being stopped; nothing will be attached' };
}

/** After a restart: jobs left running are tracked again from the start; a cancel asked for before the restart is honoured. */
export function recoverTrackingJobs(store: Store, deps: TrackingDeps = {}): number {
  for (const j of store.openJobs(TRACKING_JOB_TYPE)) if (j.status === 'cancel-requested') store.updateJob(j.id, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; nothing attached' } });
  const jobs = store.recoverJobs(TRACKING_JOB_TYPE);
  for (const j of jobs) void runTrackingJob(store, j.id, deps);
  return jobs.length;
}

/** Server shutdown: stop this store's tracking work without marking it (the rows stay running and are tracked again after a restart). */
export async function stopTrackingJobs(store: Store): Promise<void> {
  const mine = [...running.values()].filter((r) => r.store === store);
  for (const r of mine) { r.shutdown = true; r.ac.abort(); }
  await Promise.all(mine.map((r) => r.done.catch(() => {})));
}

export function runTrackingJob(store: Store, jobId: string, deps: TrackingDeps = {}): Promise<void> {
  const prior = running.get(jobId);
  if (prior) return prior.done;
  const r: Running = { store, ac: new AbortController(), done: Promise.resolve(), shutdown: false };
  running.set(jobId, r);
  r.done = (async () => {
    let started = false;
    try {
      for (;;) {
        try {
          await trackingLane(async () => { started = true; await work(store, jobId, deps, r.ac.signal); });
          return;
        } catch (e) {
          // the lane's queue was full: wait and ask again (the job stays queued)
          if (!started && e instanceof ApiError && e.code === 'busy' && !r.ac.signal.aborted) { await sleep(1000); continue; }
          throw e;
        }
      }
    } catch (e) {
      if (r.shutdown) return;
      try {
        if (['succeeded', 'failed', 'canceled'].includes(store.getJob(jobId).status)) return; // e.g. canceled while it was queued: keep that record
        if (e instanceof TrackingCanceled || store.getJob(jobId).status === 'cancel-requested') store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; nothing attached' } });
        else {
          if (!(e instanceof ApiError)) console.error(e);
          store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'internal_error', message: 'tracking failed unexpectedly' } });
        }
      } catch (e2) { console.error(e2); }
    } finally {
      running.delete(jobId);
    }
  })();
  return r.done;
}

/** One pass's result for a frame, in work px; sPm = size per mille of the track's box. */
interface Rec { cx: number; cy: number; sPm: number; q: number; st: number }

/**
 * Hold the shared heavy slot until the returned release is called; waits (and asks again) while its queue is full. A cancel
 * while waiting rejects at once; a slot granted after that is handed straight back.
 */
function holdHeavy(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return false; settled = true; signal.removeEventListener('abort', onAbort); fn(); return true; };
    const onAbort = () => settle(() => reject(new TrackingCanceled()));
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

async function work(store: Store, jobId: string, deps: TrackingDeps, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new TrackingCanceled(); // canceled or shut down while it waited for the lane
  const job = store.getJob(jobId);
  if (job.status !== 'queued') return; // canceled while it waited
  const input = job.input as TrackingJobInput;
  const ffmpegLine = ffmpegVersionLine(); // started now, awaited before the last checks (it never rejects)
  let lastStage = 0, lastPhase = '';
  const stage = (phase: 'reading' | 'forward' | 'backward' | 'saving', done = 0, total = 0) => {
    const now = performance.now();
    if (phase === lastPhase && now - lastStage < STAGE_EVERY_MS && done < total) return;
    // a cancel is never overwritten with 'running': the job stops here instead (the runner records it as canceled)
    const status = store.getJob(jobId).status;
    if (signal.aborted || (status !== 'queued' && status !== 'running')) throw new TrackingCanceled();
    lastStage = now; lastPhase = phase;
    store.updateJob(jobId, { status: 'running', stage: trackingStage(phase, done, total) });
  };
  stage('reading');
  const changed = (why: string) => new ApiError(409, 'track_changed', `the motion track ${why} while it was being tracked; nothing was attached`, { motionTrackId: input.motionTrackId }, 'Track it again.');
  /**
   * The track and its media as the job was created against. The track's version is compared first, so any change since then
   * is track_changed: a hand correction (which sets origin.edited) must not surface as would_discard_edits.
   */
  const recheck = () => {
    const v = store.entityVersion(job.projectId, input.motionTrackId);
    if ((v?.revision ?? null) !== input.trackVersion) throw changed(v?.deleted ? 'was removed' : 'changed');
    try { return checkTrack(store, job.projectId, input.motionTrackId, input.overwrite); } catch (e) {
      if (e instanceof ApiError && e.status === 404) throw changed('or its media was removed');
      if (e instanceof ApiError && e.code === 'would_discard_edits') throw changed('was corrected by hand');
      throw e;
    }
  };
  const { track, asset } = recheck();
  const src = frameSource(store, deps.derivatives, asset, input.input);
  const read = deps.readFrames ?? readFrames;
  const { width: W, height: H } = workSize(src.width, src.height);
  const from = input.from, to = input.to;
  if (to > src.frameCount) throw new ApiError(422, 'out_of_bounds', `the ${src.kind} has ${src.frameCount} frames; the range ends at ${to}`, { to, frames: src.frameCount });

  // anchors: the manual samples inside the range, in work px (pixel centres: u = (cx + 0.5) / W)
  const box = track.box;
  const anchors = new Map<number, { cx: number; cy: number; sPm: number }>();
  for (const f of manualFrames(track)) {
    if (f < from || f >= to) continue;
    const i = f - track.from;
    anchors.set(f, { cx: (track.x[i]! / TRACK_UNIT) * W - 0.5, cy: (track.y[i]! / TRACK_UNIT) * H - 0.5, sPm: track.kind === 'region' ? track.s?.[i] ?? SIZE_UNIT : SIZE_UNIT });
  }
  const frames = [...anchors.keys()].sort((a, b) => a - b);
  if (!frames.length) throw new ApiError(422, 'no_anchor', `no manual sample of the track lies in [${from}, ${to})`, { from, to });
  const first = frames[0]!, last = frames.at(-1)!;
  const seedOf = (f: number) => {
    const a = anchors.get(f)!;
    return track.kind === 'region' && box ? { kind: 'region' as const, cx: a.cx, cy: a.cy, w: (box.w / TRACK_UNIT) * W * (a.sPm / SIZE_UNIT), h: (box.h / TRACK_UNIT) * H * (a.sPm / SIZE_UNIT) } : { kind: 'point' as const, cx: a.cx, cy: a.cy };
  };
  const fwdOn = input.direction !== 'backward', bwdOn = input.direction !== 'forward';
  const fwd: (Rec | null)[] = new Array(to - from).fill(null), bwd: (Rec | null)[] = new Array(to - from).fill(null);
  const t0 = performance.now();
  let decoded = 0, tracked = 0;
  const digests: string[] = [];
  /** Feed one frame to a pass: the first frame seeds it; a manual frame re-anchors it; others are tracked. */
  const pass = (out: (Rec | null)[]) => {
    let tracker: Tracker | null = null, seedPm = SIZE_UNIT;
    return (f: number, frame: GreyFrame) => {
      const a = anchors.get(f);
      if (!tracker) {
        if (!a) return; // before the first anchor of this pass
        tracker = createTracker(frame, seedOf(f));
        seedPm = a.sPm;
        return;
      }
      const s: TrackerStep = tracker.step(frame);
      tracked++;
      if (a) { tracker.anchor(frame, { cx: a.cx, cy: a.cy, s: a.sPm / seedPm }); return; }
      out[f - from] = { cx: s.cx, cy: s.cy, sPm: s.s * seedPm, q: s.q, st: s.st };
    };
  };

  if (fwdOn && first < to - 1) {
    const feed = pass(fwd);
    const total = to - first - 1;
    let release = await holdHeavy(signal), inHold = 0;
    try {
      const r = await read(src, first, to, TRACK_WORK_HEIGHT, async (f, frame) => {
        feed(f, frame);
        if (f > first) stage('forward', f - first, total);
        await yieldNow();
        if (signal.aborted) throw new TrackingCanceled();
        if (++inHold >= HEAVY_CHUNK) { release(); release = () => {}; inHold = 0; release = await holdHeavy(signal); }
      }, signal);
      decoded += to; digests.push(r.digest);
    } finally { release(); }
  }
  if (bwdOn && last > from) {
    const feed = pass(bwd);
    const total = last - from;
    for (let end = last + 1; end > from; end -= BACKWARD_CHUNK) {
      const start = Math.max(from, end - BACKWARD_CHUNK);
      const release = await holdHeavy(signal);
      try {
        const chunk: GreyFrame[] = [];
        const r = await read(src, start, end, TRACK_WORK_HEIGHT, (_f, frame) => { chunk.push({ width: frame.width, height: frame.height, data: frame.data.slice() }); }, signal);
        decoded += end; digests.push(r.digest);
        for (let f = end - 1; f >= start; f--) {
          feed(f, chunk[f - start]!);
          chunk[f - start] = undefined as unknown as GreyFrame; // free as we go
          if (f < last) stage('backward', last - f, total);
          await yieldNow();
          if (signal.aborted) throw new TrackingCanceled();
        }
      } finally { release(); }
    }
  }

  // merge: the higher confidence wins; two usable samples further apart than DISAGREE_PX make a weak frame (q = the lower)
  const lo = fwdOn && !bwdOn ? first : from, hi = bwdOn && !fwdOn ? last + 1 : to;
  const usable = (st: number) => st === ST.tracked || st === ST.reacquired;
  const x: number[] = [], y: number[] = [], s: number[] = [], q: number[] = [], st: number[] = [];
  const clampPos = (v: number) => Math.min(15_000, Math.max(-5_000, v));
  for (let f = lo; f < hi; f++) {
    const a = anchors.get(f);
    let r: Rec | null;
    // an anchor frame goes out as a machine sample at the anchor: attach_motion_track refuses samples marked manual and keeps
    // the track's hand-placed sample there (the track is unchanged since the job read it, checked below)
    if (a) r = { cx: a.cx, cy: a.cy, sPm: a.sPm, q: 100, st: ST.tracked };
    else {
      const fa = fwd[f - from] ?? null, ba = bwd[f - from] ?? null;
      if (fa && ba) {
        const win = fa.q >= ba.q ? fa : ba;
        const d = Math.sqrt((fa.cx - ba.cx) ** 2 + (fa.cy - ba.cy) ** 2);
        r = usable(fa.st) && usable(ba.st) && d > DISAGREE_PX ? { ...win, q: Math.min(fa.q, ba.q), st: ST.weak } : win;
      } else r = fa ?? ba;
    }
    // a frame no pass reached (cannot happen inside [lo, hi)) stays unknown at the nearest anchor
    const v = r ?? { ...anchors.get(first)!, q: 0, st: ST.unknown };
    x.push(clampPos(Math.round(((v.cx + 0.5) / W) * TRACK_UNIT)));
    y.push(clampPos(Math.round(((v.cy + 0.5) / H) * TRACK_UNIT)));
    s.push(Math.min(10_000, Math.max(100, Math.round(v.sPm))));
    q.push(Math.min(100, Math.max(0, Math.round(v.q))));
    st.push(v.st);
  }
  const seconds = (performance.now() - t0) / 1000;

  // attach only if nothing it depends on changed meanwhile (the pattern of measureAndAttach). Nothing is awaited from these
  // checks to the commit and the job's success, so a cancel lands either before them (canceled, nothing attached) or after
  // the job finished (already-finished): never between an accepted cancel and an attach.
  stage('saving');
  const ffmpeg = await ffmpegLine;
  if (signal.aborted || store.getJob(jobId).status !== 'running') throw new TrackingCanceled();
  recheck();
  const inputDigest = digests.length === 1 ? digests[0]! : createHash('sha256').update(digests.join(',')).digest('hex');
  const params: Record<string, number | string> = { algo: TRACKER_ALGO, input: src.kind, workWidth: W, workHeight: H, inputDigest, ffmpeg, direction: input.direction };
  const commit = store.commit({ projectId: job.projectId, actor: job.actor, label: `Track ${track.name}`, allowInternal: true, ops: [{ op: 'attach_motion_track', args: { motionTrackId: input.motionTrackId, from: lo, x, y, ...(track.kind === 'region' ? { s } : {}), q, st, method: TRACKER_METHOD, params, createdAt: new Date().toISOString() } }] });
  const after = ownTrack(store.getProject(job.projectId).doc, input.motionTrackId)!;
  const sum = trackSummary(after);
  const output: TrackingJobOutput = { motionTrackId: input.motionTrackId, revision: commit.revision, from: lo, to: hi, frames: hi - lo, decodedFrames: decoded, trackingFps: seconds > 0 ? Number((tracked / seconds).toFixed(2)) : 0, input: src.kind, counts: sum.counts, problems: sum.problems };
  store.updateJob(jobId, { status: 'succeeded', stage: null, output });
}

// ---------- read view ----------
const NOTE = 'Positions are in 1/10000 of the source picture (x across, y down; 0.5 = centre); size s is per mille of the box. Samples are per SOURCE frame. Found by optical flow and template matching (no AI model). Lost frames hold the last usable position and are never extrapolated; weak, lost and re-acquired frames are listed in problems and should be checked. A tracked blur is not guaranteed redaction. Correct samples with edit_motion_track.';

/** GET …/motion-tracks/:motionTrackId and MCP get_motion_track. */
export function motionTrackView(doc: ProjectDocument, revision: number, motionTrackId: string): MotionTrackView {
  const t = ownTrack(doc, motionTrackId);
  if (!t) throw new ApiError(404, 'not_found', `motion track ${motionTrackId} not found`, { motionTrackId });
  const sum = trackSummary(t);
  const follow: string[] = [], redact: string[] = [];
  for (const seq of Object.values(doc.sequences))
    for (const tr of seq.tracks)
      for (const c of tr.clips) {
        if (c.type !== 'caption' && c.follow?.motionTrackId === motionTrackId) follow.push(c.id);
        if (c.type === 'media' && c.redact?.some((r) => r.motionTrackId === motionTrackId)) redact.push(c.id);
      }
  return { revision, motionTrackId: t.id, assetId: t.assetId, name: t.name, kind: t.kind, from: t.from, to: t.from + t.x.length, origin: t.origin, counts: sum.counts, problems: sum.problems, usedBy: { follow, redact }, note: NOTE };
}
