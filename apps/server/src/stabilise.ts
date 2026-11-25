/**
 * Stabilisation jobs (wave 7 stabilise track; .artifacts/wave7/stabilise-decisions.md §2.7, §2.10, §5). A durable job of type
 * STABILISE_JOB_TYPE measures the camera's motion on the file a clip shows with the model-free kernel (vision/steady.ts: grid
 * Lucas–Kanade points and a robust similarity; NO AI model), then attaches the measurement and switches the clip on in ONE
 * transaction, so one undo returns the document from before the press.
 *
 * RULES (decisions §2.7, §2.10, §5)
 * - Permission as tracking (tracking.ts startTrackingJob): edit rights, agents not paused, a grant without track or range limits.
 *   409 stabilise_in_progress for the same file of the same project; 429 busy at five open vision jobs (tracking + stabilise).
 * - Range: the clip's shown source frames and the reach of its ramps and handles (core clipSourceFrames) widened by
 *   steadyMarginFrames(file rate) on each side (R at strength 100, so the slider never needs a second measurement), clamped to the
 *   file. Frames already measured with the same params.algo (STEADY_ALGO) and params.input are not read again: only the gaps are
 *   measured, each widened by one frame onto a neighbouring stretch so the attach merges seamlessly (steadyOps mergeCameraStretch).
 *   The route refuses clipTooLong, fileFull, tooManyStretches and budget (core STEADY_REFUSALS, 422) BEFORE it answers 202, by
 *   simulating the merge with the op's own function.
 * - The runner is copied from tracking.ts (as moments.ts did): visionLane (shared with tracking, so a tracking and a stabilise job
 *   never run together), holdHeavy in chunks of HEAVY_CHUNK frames, a yield after every 48 tracked points (the kernel is a
 *   generator) and after every frame, cancel (attaches nothing, ffmpeg killed), recovery (runs again from the start), shutdown (rows
 *   stay running). Frames from tracking.ts readFrames / frameSource. A frame at a stored scene cut of the file (core ownSceneCuts)
 *   is `start` whatever was measured: the owner's corrected cuts are trusted over the kernel's rule.
 * - The end: with nothing awaited between the last checks and the commit, ONE store.commit by the job's actor with allowInternal and
 *   dependsOn ['analysis:<assetId>'], ops [attach_camera_motion × gaps, set_clip_stabilise {strength, maxCrop}]. Clip gone, showing
 *   another file, on another kind of track or now a multicam segment: nothing attached, the job fails clip_changed. Any op refused
 *   (set_clip_stabilise's tooLittle…, attach's fileFull/budget): nothing attached, the job fails with that refusal and its details.
 *   A clip trimmed or slipped meanwhile is accepted; the op recomputes from the document and reports `measured.outside`.
 * - cameraMotionView: counts and ranges only (core cameraMotionSummary), clip ids that use it, and the NOTE below. Never the columns.
 */
import { createHash } from 'node:crypto';
import {
  MAX_CAMERA_STRETCHES, MAX_PROJECT_TRACK_SAMPLES, MAX_STEADY_SAMPLES, SST, STABILISE_JOB_TYPE, STEADY_ALGO, STEADY_DEFAULT_MAX_CROP, STEADY_DEFAULT_STRENGTH,
  STEADY_REFUSALS, TRACK_WORK_HEIGHT, TRACKING_JOB_TYPE, analysisEntityId, cameraMotionSummary, cameraSamples, clipSourceFrames, findClip, isMovingPicture,
  mergeCameraStretch, ownSceneCuts, projectCameraSamples, projectTrackSamples, sourceFrameOfTime, stabiliseStage, steadyMarginFrames, stretchEnd,
  type Asset, type CameraMotionView, type CameraStretch, type MediaClip, type ProjectDocument, type SetClipStabiliseOutput, type StabiliseJobInput,
  type StabiliseJobOutput, type StabiliseRunBody, type SteadyRefusalKey,
} from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import { assetFrames, ffmpegVersionLine, frameSource, HEAVY_CHUNK, holdHeavy, readFrames, TrackingCanceled, visionLane, workSize, type TrackingDeps } from './tracking.ts';
import { CAMERA_KERNEL_PARAMS, createCameraKernel, toCameraSample, type CameraKernel } from './vision/steady.ts';

/** True once W1 has built the job. */
export const STABILISE_JOBS_BUILT = true;
export type StabiliseDeps = TrackingDeps;

interface ServerRefusal<A extends unknown[]> { status: number; code: string; message: (...a: A) => string; hint?: string }
const r = <A extends unknown[]>(status: number, code: string, message: (...a: A) => string, hint?: string): ServerRefusal<A> => ({ status, code, message, ...(hint ? { hint } : {}) });
/** Every refusal of the stabilise routes and job. The messages are fixed: the Hebrew table (packages/i18n/src/stabilise.ts) recognises them. */
export const STABILISE_SERVER_REFUSALS = {
  inProgress: r(409, 'stabilise_in_progress', () => 'the camera motion of this file is already being measured', 'Wait for that job, or cancel it first.'),
  busy: r(429, 'busy', () => 'too many camera measurements and motion tracks are already running or waiting; try again shortly', 'Try again in half a minute.'),
  clipChanged: r(409, 'clip_changed', () => 'the clip changed while its camera motion was measured; nothing was saved', 'Run the stabilisation again.'),
} as const;
export type StabiliseServerRefusalKey = keyof typeof STABILISE_SERVER_REFUSALS;
export function stabiliseError<K extends StabiliseServerRefusalKey>(key: K, details: Record<string, unknown> = {}, ...args: Parameters<(typeof STABILISE_SERVER_REFUSALS)[K]['message']>): ApiError {
  const x = STABILISE_SERVER_REFUSALS[key] as ServerRefusal<unknown[]>;
  return new ApiError(x.status, x.code, x.message(...args), details, x.hint);
}
/** The read view's note (decisions §4). */
export const CAMERA_MOTION_NOTE = 'Camera motion per SOURCE frame, measured with optical flow and a robust fit (no AI model): the camera\'s movement, rotation and zoom are corrected; rolling-shutter "jelly", perspective and lens distortion are not. Weak and unknown stretches are listed for review. Tested on synthetic videos only.';

/** origin.method of a measured stretch. */
export const STEADY_METHOD = 'model-free camera motion: grid Lucas-Kanade points + robust similarity (no AI model)';
/** Open vision jobs (tracking + stabilise) at which a new measurement is refused with 429. */
export const MAX_OPEN_VISION_JOBS = 5;
/** Stage text is written at most this often (as tracking.ts). */
const STAGE_EVERY_MS = 500;

/** A refusal of the operations, as the route answers it (422; not_found 404), with the op's fixed sentence. */
function opRefusal<K extends SteadyRefusalKey>(key: K, details: Record<string, unknown>, ...args: Parameters<(typeof STEADY_REFUSALS)[K]['message']>): ApiError {
  const x = STEADY_REFUSALS[key] as { code: string; message: (...a: unknown[]) => string; hint?: string };
  return new ApiError(x.code === 'not_found' ? 404 : 422, x.code, x.message(...args), details, x.hint);
}

// ---------- the clip and its range (pure over the document) ----------
/** The clip as the job may stabilise it, or the reason it may not. */
export function stabiliseTarget(doc: ProjectDocument, clipId: string): { clip: MediaClip; asset: Asset } | { refusal: 'missing' | 'notVideo' | 'multicam'; assetId?: string } {
  const f = findClip(doc, clipId);
  if (!f) return { refusal: 'missing' };
  const c = f.clip;
  if (c.type !== 'media' || f.track.kind !== 'video') return { refusal: 'notVideo' };
  const asset = Object.hasOwn(doc.assets, c.assetId) ? doc.assets[c.assetId] : undefined;
  if (!asset || !isMovingPicture(asset)) return { refusal: 'notVideo', assetId: c.assetId };
  if (c.multicam) return { refusal: 'multicam', assetId: c.assetId };
  return { clip: c, asset };
}
/**
 * The frames the job measures: the clip's shown frames and the reach of its ramps and handles (core clipSourceFrames), widened by
 * steadyMarginFrames(file rate) on each side, clamped to [0, file frames). `ownLength` is the same before clamping (clipTooLong).
 */
export function stabiliseRange(doc: ProjectDocument, clip: MediaClip, asset: Asset): { from: number; to: number; ownLength: number } {
  const total = assetFrames(asset);
  const cf = clipSourceFrames(doc, clip);
  const margin = steadyMarginFrames(asset.video!.frameRate);
  const lo = Math.min(cf.first, cf.reach.first) - margin, hi = Math.max(cf.last, cf.reach.last) + margin + 1;
  return { from: Math.max(0, lo), to: Math.min(total, hi), ownLength: hi - lo };
}
/** Stretches of the file measured the same way (same algo and input) as this job would. */
const sameKind = (s: CameraStretch, input: string) => s.origin.params.algo === STEADY_ALGO && s.origin.params.input === input;
/**
 * What to measure in [from, to): the maximal runs of frames no stretch of the same kind holds, each widened by one frame onto a
 * neighbouring stretch of the same kind (left: its last frame becomes the new stretch's `start`, and the merge keeps the old sample
 * there; right: the old stretch's `start` frame gets a measured delta). Ascending, disjoint segments [a, b).
 */
export function measureSegments(stretches: readonly CameraStretch[], input: string, from: number, to: number): { from: number; to: number }[] {
  const mine = stretches.filter((s) => sameKind(s, input));
  const covered = (f: number) => mine.some((s) => f >= s.from && f < stretchEnd(s));
  const out: { from: number; to: number }[] = [];
  let f = from;
  while (f < to) {
    if (covered(f)) { f++; continue; }
    let g = f;
    while (g < to && !covered(g)) g++;
    const a = f > 0 && covered(f - 1) ? f - 1 : f, b = covered(g) ? g + 1 : g;
    const last = out.at(-1);
    if (last && a <= last.to) last.to = Math.max(last.to, b); else out.push({ from: a, to: b });
    f = g;
  }
  return out;
}
/** The file's stretches after attaching zero-filled stand-ins for the segments, by the op's own merge (for the checks before 202). */
function simulateAttach(stretches: readonly CameraStretch[], segments: { from: number; to: number }[]): CameraStretch[] {
  let out = [...stretches];
  for (const s of segments) {
    const n = s.to - s.from, z = new Array<number>(n).fill(0);
    out = mergeCameraStretch(out, { from: s.from, dx: z, dy: z, dr: z, dz: z, st: [SST.start, ...new Array<number>(n - 1).fill(SST.ok)], origin: { method: 'check', params: {}, createdAt: '', createdBy: '' } });
  }
  return out;
}

/** Everything that can be refused before a job exists (re-checked, the clip part, when it commits). */
function checkStart(store: Store, projectId: string, clipId: string, want: 'proxy' | 'original', deps: StabiliseDeps) {
  const p = store.getProject(projectId);
  const t = stabiliseTarget(p.doc, clipId);
  if ('refusal' in t) {
    if (t.refusal === 'missing') throw new ApiError(404, 'not_found', `clip ${clipId} not found`, { clipId }, 'Call get_timeline to list current clip ids.');
    throw opRefusal(t.refusal, { clipId, ...(t.assetId ? { assetId: t.assetId } : {}) });
  }
  const { clip, asset } = t;
  const range = stabiliseRange(p.doc, clip, asset);
  if (range.ownLength > MAX_STEADY_SAMPLES) throw opRefusal('clipTooLong', { clipId, frames: range.ownLength, max: MAX_STEADY_SAMPLES }, range.ownLength);
  const src = frameSource(store, deps.derivatives, asset, want);
  const cur = p.doc.analyses[asset.id]?.cameraMotion;
  const segments = measureSegments(cur?.stretches ?? [], src.kind, range.from, range.to);
  const after = simulateAttach(cur?.stretches ?? [], segments);
  const samples = cameraSamples({ stretches: after });
  if (samples > MAX_STEADY_SAMPLES) throw opRefusal('fileFull', { assetId: asset.id, samples, max: MAX_STEADY_SAMPLES }, samples);
  if (after.length > MAX_CAMERA_STRETCHES) throw opRefusal('tooManyStretches', { assetId: asset.id, stretches: after.length, max: MAX_CAMERA_STRETCHES });
  const total = projectTrackSamples(p.doc) + projectCameraSamples(p.doc) - cameraSamples(cur) + samples;
  if (total > MAX_PROJECT_TRACK_SAMPLES) throw opRefusal('budget', { samples: total, max: MAX_PROJECT_TRACK_SAMPLES }, total, MAX_PROJECT_TRACK_SAMPLES);
  return { p, clip, asset, range };
}

// ---------- jobs ----------
interface Running { store: Store; ac: AbortController; done: Promise<void>; shutdown: boolean }
const running = new Map<string, Running>();
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const yieldNow = () => new Promise<void>((res) => setImmediate(res));

/** Start a stabilise job for a clip (202). */
export function startStabiliseJob(store: Store, gov: Governance, principal: Principal, projectId: string, clipId: string, body: StabiliseRunBody, deps: StabiliseDeps = {}): JobRow {
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'change camera measurements');
  const input = body.input ?? 'proxy';
  const { p, clip, asset, range } = checkStart(store, projectId, clipId, input, deps);
  const open = store.openJobs(STABILISE_JOB_TYPE);
  const same = open.find((j) => j.projectId === projectId && (j.input as StabiliseJobInput | null)?.assetId === asset.id);
  if (same) throw stabiliseError('inProgress', { jobId: same.id, status: same.status, assetId: asset.id });
  if (open.length + store.openJobs(TRACKING_JOB_TYPE).length >= MAX_OPEN_VISION_JOBS) throw stabiliseError('busy', { retryAfterSeconds: 30 });
  const jobInput: StabiliseJobInput = {
    clipId: clip.id, assetId: asset.id, from: range.from, to: range.to,
    strength: body.strength ?? STEADY_DEFAULT_STRENGTH, maxCrop: body.maxCrop ?? STEADY_DEFAULT_MAX_CROP, input,
    analysisVersion: store.entityVersion(projectId, analysisEntityId(asset.id))?.revision ?? null, projectRevision: p.revision,
  };
  const job = store.createJob(projectId, STABILISE_JOB_TYPE, principal.actor, jobInput);
  void runStabiliseJob(store, job.id, deps);
  return store.getJob(job.id);
}

/** Cancel: a queued job is removed; a running one stops (ffmpeg is killed) and attaches nothing. */
export function cancelStabiliseJob(store: Store, jobId: string, actor: string): { jobId: string; status: string; outcome: string; note?: string } {
  const j = store.getJob(jobId);
  if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
  const run = running.get(jobId);
  if (j.status === 'queued' || !run) {
    store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: j.status === 'queued' ? `canceled by ${actor} before it started; nothing attached` : 'canceled; nothing attached' } });
    run?.ac.abort();
    return { jobId, status: 'canceled', outcome: j.status === 'queued' ? 'removed-from-queue' : 'stopped' };
  }
  store.updateJob(jobId, { status: 'cancel-requested' });
  run.ac.abort();
  return { jobId, status: 'cancel-requested', outcome: 'stopping', note: 'the measurement is being stopped; nothing will be attached' };
}

/** After a restart: jobs left running are measured again from the start; a cancel asked for before the restart is honoured. */
export function recoverStabiliseJobs(store: Store, deps: StabiliseDeps = {}): number {
  for (const j of store.openJobs(STABILISE_JOB_TYPE)) if (j.status === 'cancel-requested') store.updateJob(j.id, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; nothing attached' } });
  const jobs = store.recoverJobs(STABILISE_JOB_TYPE);
  for (const j of jobs) void runStabiliseJob(store, j.id, deps);
  return jobs.length;
}

/** Server shutdown: stop this store's stabilise work without marking it (the rows stay running and are measured again after a restart). */
export async function stopStabiliseJobs(store: Store): Promise<void> {
  const mine = [...running.values()].filter((x) => x.store === store);
  for (const x of mine) { x.shutdown = true; x.ac.abort(); }
  await Promise.all(mine.map((x) => x.done.catch(() => {})));
}

export function runStabiliseJob(store: Store, jobId: string, deps: StabiliseDeps = {}): Promise<void> {
  const prior = running.get(jobId);
  if (prior) return prior.done;
  const run: Running = { store, ac: new AbortController(), done: Promise.resolve(), shutdown: false };
  running.set(jobId, run);
  run.done = (async () => {
    let started = false;
    try {
      for (;;) {
        try {
          await visionLane(async () => { started = true; await work(store, jobId, deps, run.ac.signal); });
          return;
        } catch (e) {
          // the lane's queue was full: wait and ask again (the job stays queued)
          if (!started && e instanceof ApiError && e.code === 'busy' && !run.ac.signal.aborted) { await sleep(1000); continue; }
          throw e;
        }
      }
    } catch (e) {
      if (run.shutdown) return;
      try {
        if (['succeeded', 'failed', 'canceled'].includes(store.getJob(jobId).status)) return; // e.g. canceled while queued: keep that record
        if (e instanceof TrackingCanceled || store.getJob(jobId).status === 'cancel-requested') store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; nothing attached' } });
        else {
          if (!(e instanceof ApiError)) console.error(e);
          store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'internal_error', message: 'stabilisation failed unexpectedly' } });
        }
      } catch (e2) { console.error(e2); }
    } finally {
      running.delete(jobId);
    }
  })();
  return run.done;
}

/** Source frames of the file's stored scene cuts (the owner's corrected cuts): `start` whatever the kernel measured. */
function storedCutFrames(doc: ProjectDocument, asset: Asset): Set<number> {
  const cuts = ownSceneCuts(doc, asset.id)?.cuts ?? [];
  return new Set(cuts.map((t) => sourceFrameOfTime(asset, t)));
}

async function work(store: Store, jobId: string, deps: StabiliseDeps, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new TrackingCanceled(); // canceled or shut down while it waited for the lane
  const job = store.getJob(jobId);
  if (job.status !== 'queued') return; // canceled while it waited
  const input = job.input as StabiliseJobInput;
  const ffmpegLine = ffmpegVersionLine(); // started now, awaited before the last checks (it never rejects)
  let lastStage = 0, lastPhase = '';
  const stage = (phase: 'reading' | 'measuring' | 'saving', done = 0, total = 0) => {
    const now = performance.now();
    if (phase === lastPhase && now - lastStage < STAGE_EVERY_MS && done < total) return;
    // a cancel is never overwritten with 'running': the job stops here instead (the runner records it as canceled)
    const status = store.getJob(jobId).status;
    if (signal.aborted || (status !== 'queued' && status !== 'running')) throw new TrackingCanceled();
    lastStage = now; lastPhase = phase;
    store.updateJob(jobId, { status: 'running', stage: stabiliseStage(phase, done, total) });
  };
  stage('reading');
  /** The clip as the job was created for it: there, on a video track, the same file, not a multicam segment. */
  const recheck = () => {
    const doc = store.getProject(job.projectId).doc;
    const t = stabiliseTarget(doc, input.clipId);
    if ('refusal' in t || t.asset.id !== input.assetId) throw stabiliseError('clipChanged', { clipId: input.clipId, reason: 'refusal' in t ? t.refusal : 'otherFile' });
    return { doc, ...t };
  };
  const { doc, asset } = recheck();
  const src = frameSource(store, deps.derivatives, asset, input.input);
  if (input.to > src.frameCount) throw new ApiError(422, 'out_of_bounds', `the ${src.kind} has ${src.frameCount} frames; the range ends at ${input.to}`, { to: input.to, frames: src.frameCount });
  const segments = measureSegments(doc.analyses[asset.id]?.cameraMotion?.stretches ?? [], src.kind, input.from, input.to);
  const cutFrames = storedCutFrames(doc, asset);
  const { width: W, height: H } = workSize(src.width, src.height, TRACK_WORK_HEIGHT);
  const total = segments.reduce((n, s) => n + s.to - s.from, 0);
  const cols = segments.map((s) => ({ ...s, dx: [] as number[], dy: [] as number[], dr: [] as number[], dz: [] as number[], st: [] as number[] }));
  const digests: string[] = [];
  let delivered = 0, measured = 0;
  const t0 = performance.now();

  if (segments.length) {
    const kernel: CameraKernel = createCameraKernel();
    const read = deps.readFrames ?? readFrames;
    const lo = segments[0]!.from, hi = segments.at(-1)!.to;
    let seg = 0, release = await holdHeavy(signal), inHold = 0;
    try {
      const res = await read(src, lo, hi, TRACK_WORK_HEIGHT, async (f, frame) => {
        delivered++;
        while (seg < cols.length && f >= cols[seg]!.to) seg++;
        const c = cols[seg];
        if (c && f >= c.from) {
          if (f === c.from) kernel.reset();
          const it = kernel.push(frame, f);
          let step = it.next();
          while (!step.done) { await yieldNow(); if (signal.aborted) throw new TrackingCanceled(); step = it.next(); }
          const sample = f === c.from ? { dx: 0, dy: 0, dr: 0, dz: 0, st: SST.start } : cutFrames.has(f) ? { dx: 0, dy: 0, dr: 0, dz: 0, st: SST.start } : toCameraSample(step.value, W);
          c.dx.push(sample.dx); c.dy.push(sample.dy); c.dr.push(sample.dr); c.dz.push(sample.dz); c.st.push(sample.st);
          measured++;
          stage('measuring', measured, total);
        }
        await yieldNow();
        if (signal.aborted) throw new TrackingCanceled();
        if (++inHold >= HEAVY_CHUNK) { release(); release = () => {}; inHold = 0; release = await holdHeavy(signal); }
      }, signal);
      digests.push(res.digest);
    } finally { release(); }
  }
  const seconds = (performance.now() - t0) / 1000;

  // commit only if the clip is still what the job measured for. Nothing is awaited from these checks to the commit and the job's
  // success, so a cancel lands either before them (canceled, nothing attached) or after the job finished (already-finished).
  stage('saving');
  const ffmpeg = await ffmpegLine;
  if (signal.aborted || store.getJob(jobId).status !== 'running') throw new TrackingCanceled();
  recheck();
  const inputDigest = digests.length ? digests[0]! : createHash('sha256').update('').digest('hex');
  const K = CAMERA_KERNEL_PARAMS;
  const params: Record<string, number | string> = {
    algo: STEADY_ALGO, input: src.kind, workWidth: W, workHeight: H, inputDigest, ffmpeg,
    heuristic: `grid ${K.gridX}x${K.gridY}, ${K.levels} levels, fb<=${K.maxFb}px; ok: inliers>=${K.okInliers}, >=${K.okRatio * 100}% of survivors, >=${K.okQuadrants} quadrants, no competing motion (>=${K.competeMin} points and >=${K.competeShare * 100}%); weak: inliers>=${K.weakInliers}; cut: survivors<${K.cutSurvive * 100}% and thumbnail difference>${K.cutGrey}`,
  };
  const createdAt = new Date().toISOString();
  const ops = [
    ...cols.map((c) => ({ op: 'attach_camera_motion', args: { assetId: asset.id, from: c.from, dx: c.dx, dy: c.dy, dr: c.dr, dz: c.dz, st: c.st, method: STEADY_METHOD, params, createdAt } })),
    { op: 'set_clip_stabilise', args: { clipId: input.clipId, stabilise: { strength: input.strength, maxCrop: input.maxCrop } } },
  ];
  const commit = store.commit({ projectId: job.projectId, actor: job.actor, label: 'Stabilise clip', allowInternal: true, dependsOn: [analysisEntityId(asset.id)], ops });
  const set = commit.results.at(-1)?.output as unknown as SetClipStabiliseOutput | undefined;
  const output: StabiliseJobOutput & { revision: number; measuringFps: number } = {
    assetId: asset.id, clipId: input.clipId, measuredFrames: measured, readFrames: delivered, applied: true,
    ...(set?.crop ? { crop: set.crop } : {}), ...(set ? { strengthLowered: set.strengthLowered } : {}),
    revision: commit.revision, measuringFps: seconds > 0 ? Number((measured / seconds).toFixed(2)) : 0,
  };
  store.updateJob(jobId, { status: 'succeeded', stage: null, output });
}

// ---------- read view ----------
/** GET …/assets/:assetId/camera-motion and MCP get_camera_motion: counts and ranges only, never the columns. */
export function cameraMotionView(doc: ProjectDocument, revision: number, assetId: string): CameraMotionView {
  if (!Object.hasOwn(doc.assets, assetId)) throw new ApiError(404, 'not_found', `asset ${assetId} not found`, { assetId });
  const motion = doc.analyses[assetId]?.cameraMotion;
  const usedBy: string[] = [];
  for (const seq of Object.values(doc.sequences))
    for (const tr of seq.tracks)
      for (const c of tr.clips) if (c.type === 'media' && c.assetId === assetId && c.stabilise) usedBy.push(c.id);
  if (!motion) return { revision, assetId, stretches: [], counts: { unknown: 0, ok: 0, weak: 0, start: 0 }, review: [], usedBy, note: CAMERA_MOTION_NOTE };
  const sum = cameraMotionSummary(motion);
  return { revision, assetId, stretches: motion.stretches.map((s) => ({ from: s.from, to: stretchEnd(s), origin: s.origin })), counts: sum.counts, review: sum.review, usedBy, note: CAMERA_MOTION_NOTE };
}
