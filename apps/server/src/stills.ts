/**
 * «הפריים הכי חד» on the server (wave 8 cover, version 1): the durable, model-free measurement job of the sharpest frames of one
 * stretch of one file, and the read of what is stored. Lead pre-pass: these exports with their final signatures, wired into
 * http.ts (POST/GET …/stills, the cancel dispatch), mcp.ts (find_sharp_frames, read_sharp_frames, cancel_job) and index.ts
 * (recover, stop). W1 builds the bodies here and in stills.math.ts (new), against core stillsContract.ts.
 *
 * Rules W1 keeps (cover-verify C1–C4, C11, C12; the contract's header):
 * - Order of checks in startStillsJob: gov.assertMayAct(p, projectId, 'edit') (as moments), the project (404), the asset (404
 *   not_found), the range (rangeOfClip or the typed one; STILLS_REFUSALS rows), then the cache: every frame of the range already
 *   stored under the current stillsCacheState → { cached: true, answer } and no job. Then one open job per project (409
 *   stills_in_progress, details.jobId) and STILLS_MAX_OPEN_JOBS per server (429 busy).
 * - The job reads the STORED file (frameSource(…, 'original'), never the proxy) with the input seek of the contract, runs moments'
 *   grey self-check first, and shares the moments lane (waitForExportIdle before reading; never two heavy reads at once on 4 CPUs).
 * - Validated before success (exact frame count, every frame of the range has a record), merged as a union by frame, written with
 *   Derivatives.put (kind 'stills', meta StillsDerivativeMeta). A cancelled or failed job writes nothing. Output StillsJobOutput.
 * - Recovered after a restart: run again from the start (cached frames make it cheap). Stopped on shutdown: the row stays running.
 * - Agents get numbers only: no image part in any answer.
 */
import { STILLS_JOB_TYPE, STILLS_MEASURE_BUILT, STILLS_REFUSALS, StillsRefusal, type FindSharpBody, type FindSharpResult, type ReadSharpQuery, type SharpAnswer } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Derivatives } from './derive.ts';
import type { Governance } from './governance.ts';
import type { FifoComputeLane } from './lane.ts';
import { ApiError, type Store } from './store.ts';

export interface StillsDeps {
  derivatives: Pick<Derivatives, 'get' | 'put'>;
  /** the moments lane: the job waits while a server export runs (momentsLaneOf(exporter.lane)) */
  lane?: Pick<FifoComputeLane, 'waitForExportIdle'>;
}

/** A core StillsRefusal as the ApiError the routes and tools answer (same status, code, message and hint). */
export function stillsApiError(e: StillsRefusal): ApiError {
  return new ApiError(e.status || 422, e.code, e.message, e.details, e.hint);
}
/** Runs a body that may throw a core StillsRefusal, answering it as its ApiError (routes and MCP tools both use it). */
export function withStillsErrors<R>(fn: () => R): R {
  try { return fn(); } catch (e) { if (e instanceof StillsRefusal) throw stillsApiError(e); throw e; }
}
/** The honest state of a build without the measurement (501 stills_not_built). */
export const stillsNotBuilt = () => new ApiError(STILLS_REFUSALS.notBuilt.status, STILLS_REFUSALS.notBuilt.code, STILLS_REFUSALS.notBuilt.message(), {}, STILLS_REFUSALS.notBuilt.hint);

/** POST …/stills and MCP find_sharp_frames: a job (202) or the stored answer. W1. */
export function startStillsJob(store: Store, gov: Governance, p: Principal, projectId: string, body: FindSharpBody, deps: StillsDeps): FindSharpResult {
  gov.assertMayAct(p, projectId, 'edit');
  store.getProject(projectId); // 404 before anything else
  void body; void deps;
  if (!STILLS_MEASURE_BUILT) throw stillsNotBuilt();
  throw new Error('stills: W1 builds this body');
}
/** GET …/stills and MCP read_sharp_frames: what is stored for [from, to), complete or not (never starts a job). W1. */
export function readSharpFrames(store: Store, projectId: string, q: ReadSharpQuery, deps: Pick<StillsDeps, 'derivatives'>): SharpAnswer {
  store.getProject(projectId); // 404 before anything else
  void q; void deps;
  if (!STILLS_MEASURE_BUILT) throw stillsNotBuilt();
  throw new Error('stills: W1 builds this body');
}
/** Cancel a stills job (the job routes' dispatch). W1. */
export function cancelStillsJob(store: Store, jobId: string, actor: string): { jobId: string; status: string; outcome: string } {
  const j = store.getJob(jobId);
  if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
  // Before W1 no stills job can exist; a row made by hand is ended honestly.
  store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor}` } });
  return { jobId, status: 'canceled', outcome: 'removed-from-queue' };
}
/** After a restart: stills jobs cut off are run again from the start (W1). Before W1 a left-over row fails honestly. Returns the count. */
export function recoverStillsJobs(store: Store, deps: StillsDeps): number {
  void deps;
  const jobs = store.recoverJobs(STILLS_JOB_TYPE);
  const nb = STILLS_REFUSALS.notBuilt;
  for (const j of jobs) store.updateJob(j.id, { status: 'failed', stage: null, error: { code: nb.code, message: nb.message(), retryable: false } });
  return jobs.length;
}
/** Shutdown: running readers are killed; their rows stay running for recoverStillsJobs. W1. */
export async function stopStillsJobs(store: Store): Promise<void> { void store; }
