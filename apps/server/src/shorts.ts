/**
 * Shorts on the server (ADR-0018): find candidate moments (read-only; a durable 'analysis' job of kind 'shorts-candidates'
 * when the audio features are not cached), plan (read-only), make (ONE internal apply_sequence_plan committed through
 * governance against the planned revision, as recipes.ts applyRecipe does), and plan a reframe of an existing short.
 * Contract: core shortsContract.ts; routes: http.ts (/projects/:id/shorts/*, /sequences/*), MCP: mcp.ts.
 *
 * W2 builds the bodies of the five functions below. Rules (W2 brief):
 * - inputs of the finder: the transcript (doc.transcripts[assetId], own property), findFillers, doc.analyses scenes, the
 *   features (shortsFeatures.ts), existing shorts from origin.kind 'short' excerpts;
 * - applyShorts parses BuildShortsBodySchema, builds ShortsPlanContext, calls planShorts, and commits
 *   gov.commitAs(principal, { projectId, expectedRevision: body.expectedRevision ?? p.revision, allowInternal: true,
 *   label: 'Make shorts', ops: [{ op: 'apply_sequence_plan', args }] }); a proposal result (propose mode) becomes
 *   ApiError 403 insufficient_scope with SHORTS_PROPOSE_REFUSED; a ShortsError goes through shortsApiError.
 * - planReframeFor uses core reframeOps.
 * In this pre-pass every body refuses honestly with 501 not_built (SHORTS_REFUSALS.notBuilt): no candidate, score, plan or
 * reframe is ever made up.
 */
import { ShortsError, SHORTS_STATUS, shortsRefusal, type FindShortsBody, type ShortCandidatesView, type ShortsApplyResult, type ShortsPlanView, type ReframePlanView } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { ApiError, type Store } from './store.ts';

/** ShortsError → ApiError (lead-owned mapping, core SHORTS_STATUS): not_found 404, invalid_args 400, needs_video 422, needs_measurement 409, not_verbatim 422, off_word_boundary 422, plan_too_large 422, tracking_not_available 409, not_built 501. */
export function shortsApiError(e: ShortsError): ApiError {
  return new ApiError(SHORTS_STATUS[e.code], e.code, e.message, e.details, e.hint);
}
/** Run `fn`, turning a ShortsError into its ApiError. */
export function withShortsErrors<R>(fn: () => R): R {
  try {
    const r = fn();
    if (r instanceof Promise) return r.catch((e: unknown) => { throw e instanceof ShortsError ? shortsApiError(e) : e; }) as R;
    return r;
  } catch (e) {
    throw e instanceof ShortsError ? shortsApiError(e) : e;
  }
}
const notBuilt = (what: string): never => { throw shortsApiError(shortsRefusal('notBuilt', {}, what)); };

/** The ranked candidates when the features of the asset are cached (200), else null (the route then starts the job, 202). */
export function cachedShortCandidates(_store: Store, _projectId: string, _body: FindShortsBody): ShortCandidatesView | null {
  return notBuilt('finding moments for shorts');
}
/** Measure what is missing and rank (the 'shorts-candidates' analysis job runs this). Checks `abandoned()` between windows. */
export async function findShortCandidates(_store: Store, _projectId: string, _body: FindShortsBody, _abandoned?: () => boolean): Promise<ShortCandidatesView> {
  return notBuilt('finding moments for shorts');
}
/** The plan view of BuildShortsBody (read-only). */
export async function planShortsFor(_store: Store, _projectId: string, _body: unknown): Promise<ShortsPlanView> {
  return notBuilt('planning shorts');
}
/** Make the shorts as one undoable step (synchronous; 409 needs_measurement when tightening needs uncached features). */
export async function applyShorts(_store: Store, _gov: Governance, _principal: Principal, _projectId: string, _body: unknown): Promise<ShortsApplyResult> {
  return notBuilt('making shorts');
}
/** At most MAX_REFRAME_OPS replace_clip_keyframes calls that reframe an existing short (read-only; the client commits them). */
export function planReframeFor(_store: Store, _projectId: string, _sequenceId: string, _body: unknown): ReframePlanView {
  return notBuilt('planning a reframe');
}
