/**
 * The moments job (wave 5 family film, ADR-0026): the model-free measurement of candidate moments of video files, declared in
 * core momentsContract.ts (read it first: the reader, the maths, the gates, the cache and the job rules are stated there with
 * the verifier's corrections). A durable job of type MOMENTS_JOB_TYPE on its own lane (limiter(1, 4)), modelled on the
 * tracking job (tracking.ts: start, run, cancel, recover, stop; stage momentsStage, written at most every 500 ms). Per asset a
 * cache hit (core momentsCacheState) or a measurement stored as a derivative of kind 'moments' (Derivatives.put); at the end
 * ONE store.commit of attach_moments (allowInternal) for every asset still in the project whose record differs. A canceled or
 * failed job attaches nothing. Permission as tracking: gov.assertMayAct edit and assertUnrestricted. At most
 * MOMENTS_MAX_OPEN_JOBS open jobs per server (429 busy) and one per project (409 moments_in_progress). Started only by the
 * film dialog's plan step or the MCP tool measure_moments, never on import.
 *
 * LEAD STUB, final signatures. W2 (server) owns the bodies and moments.test.ts; the lead has wired them (http.ts POST
 * /projects/:id/moments and the cancel branch, mcp.ts measure_moments and cancel_job, index.ts recover and stop). Until then
 * starting a measurement is refused honestly with 501 moments_not_built and nothing runs.
 */
import { MOMENTS_JOB_TYPE, type StartMomentsBody } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Derivatives } from './derive.ts';
import type { Governance } from './governance.ts';
import type { FifoComputeLane } from './lane.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import type { FrameSource, GreyFrame } from './vision/types.ts';

/** Picture samples of `src`: sample k is source frame k*step, for k*step < maxFrames, grey at long side MOMENTS_LONG_SIDE; SIGKILL on abort. */
export type ReadSamples = (src: FrameSource, step: number, maxFrames: number, onSample: (k: number, frame: GreyFrame) => void | Promise<void>, signal: AbortSignal) => Promise<{ samples: number; digest: string }>;
export interface MomentsDeps {
  derivatives: Pick<Derivatives, 'get' | 'put'>;
  /** Between assets the job waits while a server export runs (ADR-0017 lane). */
  lane?: Pick<FifoComputeLane, 'waitForExportIdle'>;
  /** Tests may wrap the reader; default: ffmpeg as stated in momentsContract.ts. */
  readSamples?: ReadSamples;
}

/** The lane to wait on between assets, when the given object is one (the exporter holds the server's FifoComputeLane, typed narrowly). */
export const momentsLaneOf = (lane: unknown): Pick<FifoComputeLane, 'waitForExportIdle'> | undefined =>
  lane && typeof (lane as { waitForExportIdle?: unknown }).waitForExportIdle === 'function' ? (lane as Pick<FifoComputeLane, 'waitForExportIdle'>) : undefined;

/** The fixed refusal while the job is not built (W2 removes it with the bodies). */
export const momentsNotBuilt = () => new ApiError(501, 'moments_not_built', 'measuring moments is not built in this version yet', {}, 'Nothing was measured. The film can still be planned: clips without measured moments take the middle of the file and say so.');

/** Start a measurement (202 with the job), or answer { cached: true, revision } when every asset already has a current record and overwrite is not set. */
export function startMomentsJob(store: Store, gov: Governance, principal: Principal, projectId: string, body: StartMomentsBody, deps: MomentsDeps): JobRow | { cached: true; revision: number } {
  void store; void principal; void projectId; void body; void deps;
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'measure moments (it attaches analyses)');
  throw momentsNotBuilt();
}
/** Cancel: a queued job is removed; a running one stops (ffmpeg is killed) and attaches nothing. */
export function cancelMomentsJob(store: Store, jobId: string, actor: string): { jobId: string; status: string; outcome: string } {
  // No job of this type can exist while the job is not built; a row left by a later build is closed honestly.
  const j = store.getJob(jobId);
  if (j.type !== MOMENTS_JOB_TYPE) throw new ApiError(409, 'invalid_request', `job ${jobId} is not a moments job`);
  if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
  store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor}; nothing attached` } });
  return { jobId, status: 'canceled', outcome: 'stopped' };
}
/** After a restart: jobs left running are measured again (cached files make that cheap); a cancel asked for before the restart is honoured. Returns how many were restarted. */
export function recoverMomentsJobs(store: Store, deps: MomentsDeps): number {
  void deps;
  // Not built: nothing can be measured, so an open row (from a later build's data directory) is failed, not left hanging.
  for (const j of store.openJobs(MOMENTS_JOB_TYPE)) store.updateJob(j.id, { status: 'failed', stage: null, error: { code: 'moments_not_built', message: 'measuring moments is not built in this version; nothing attached' } });
  return 0;
}
/** Server shutdown: stop this store's moments work without marking it (the rows stay running and are measured again after a restart). */
export async function stopMomentsJobs(store: Store): Promise<void> {
  void store;
}
