/**
 * Stabilisation jobs (wave 7 stabilise track; .artifacts/wave7/stabilise-decisions.md). W1 BUILDS THIS FILE against the final
 * signatures below; http.ts, mcp.ts, openapi.ts and index.ts already call them. Until then every entry point checks its scope
 * and answers 501 stabilise_not_built: nothing is read, measured or stored, and no answer is made up.
 *
 * RULES W1 KEEPS (decisions §2.7, §2.10, §5)
 * - Permission as tracking (tracking.ts startTrackingJob): edit rights, agents not paused, a grant without track or range limits.
 *   409 stabilise_in_progress for the same file; 429 busy above five open vision jobs.
 * - Range: the clip's shown source frames (core clipSourceFrames) widened by steadyMarginFrames(file rate) on each side, clamped to
 *   the file; frames already measured with the same params.algo (STEADY_ALGO) and params.input are not read again. The route
 *   refuses clipTooLong, fileFull and budget (core STEADY_REFUSALS, 422) BEFORE it answers 202.
 * - The runner is copied from moments.ts / tracking.ts: visionLane (tracking.ts, shared, so a tracking and a stabilise job never run
 *   together), holdHeavy, setImmediate yields, cancel (attaches nothing, ffmpeg killed), recovery (runs again from the start),
 *   shutdown (rows stay running). Frames from tracking.ts readFrames / frameSource.
 * - The end: with nothing awaited between the last checks and the commit, ONE store.commit by the job's actor with allowInternal and
 *   dependsOn ['analysis:<assetId>'], ops [attach_camera_motion, set_clip_stabilise {strength, maxCrop}]. Clip gone, showing another
 *   file or now a multicam segment: nothing attached, the job fails clip_changed. set_clip_stabilise refused (tooLittle…): nothing
 *   attached, the job fails with that refusal and its details. Output StabiliseJobOutput.
 * - cameraMotionView: counts and ranges only (core cameraMotionSummary), clip ids that use it, and the NOTE below. Never the columns.
 */
import { STABILISE_JOB_TYPE, type CameraMotionView, type ProjectDocument, type StabiliseRunBody } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import type { TrackingDeps } from './tracking.ts';

/** True once W1 has built the job. */
export const STABILISE_JOBS_BUILT = false;
export type StabiliseDeps = TrackingDeps;

interface ServerRefusal<A extends unknown[]> { status: number; code: string; message: (...a: A) => string; hint?: string }
const r = <A extends unknown[]>(status: number, code: string, message: (...a: A) => string, hint?: string): ServerRefusal<A> => ({ status, code, message, ...(hint ? { hint } : {}) });
/** Every refusal of the stabilise routes and job. The messages are fixed: the Hebrew table (packages/i18n/src/stabilise.ts) recognises them. */
export const STABILISE_SERVER_REFUSALS = {
  notBuilt: r(501, 'stabilise_not_built', () => 'stabilisation of video clips is not built in this build yet', 'Update the editor.'),
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

/** Start a stabilise job for a clip (202). */
export function startStabiliseJob(store: Store, gov: Governance, principal: Principal, projectId: string, clipId: string, body: StabiliseRunBody, deps: StabiliseDeps = {}): JobRow {
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'change camera measurements');
  store.getProject(projectId);
  void clipId; void body; void deps;
  throw stabiliseError('notBuilt');
}
/** Cancel: a queued job is removed; a running one stops and attaches nothing. */
export function cancelStabiliseJob(store: Store, jobId: string, actor: string): { jobId: string; status: string; outcome: string; note?: string } {
  void store; void actor;
  throw stabiliseError('notBuilt', { jobId });
}
/** After a restart. Before W1 no stabilise job can exist; a row left by another build is ended honestly. */
export function recoverStabiliseJobs(store: Store, deps: StabiliseDeps = {}): number {
  void deps;
  for (const j of store.openJobs(STABILISE_JOB_TYPE)) store.updateJob(j.id, { status: 'failed', stage: null, error: stabiliseError('notBuilt').toJSON().error });
  return 0;
}
/** Server shutdown: stop this store's stabilise work without marking it. */
export async function stopStabiliseJobs(store: Store): Promise<void> { void store; }
/** GET …/assets/:assetId/camera-motion. */
export function cameraMotionView(doc: ProjectDocument, revision: number, assetId: string): CameraMotionView {
  if (!Object.hasOwn(doc.assets, assetId)) throw new ApiError(404, 'not_found', `asset ${assetId} not found`, { assetId });
  void revision;
  throw stabiliseError('notBuilt');
}
