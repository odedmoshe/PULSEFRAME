/**
 * «גדלים מול העיניים» on the server (wave 8 growing; W2 owns this file after the pre-pass). Mirrors story.ts: plan (read-only), apply
 * (ONE internal apply_template committed through governance against the revision the plan was built from, recordRanges), rebuild
 * (runHandEdits(…, 'any-move'): hand edits kept, a deleted pick stays out unless restoreRemoved AND it is marked again). Reached
 * through the existing recipe routes and MCP recipe tools: recipes.ts dispatches recipe 'growing' and runs
 * 'template:tpl.growing' here, templates.ts sends such a run's regeneration here too. No new route, no new tool.
 *
 * OWNER'S OWN SESSION ONLY (decisions; verifier C8 "Kept"): every call answers 403 owner_required to anything that is not the owner's
 * browser session (principal.kind 'user', as http.ts owner()), before the body is looked at, so no agent supplies eye points worked out from stills.
 * THE EYES ARE REQUEST DATA ONLY: GrowingParams.picks[].eyes are read here and passed to the planner; they are never echoed in an
 * answer (the plan view's params are growingRunRecordParams), never committed (the run record is growingRunRecordParams), never
 * written to a log line, an error's details or the event stream. growing.test.ts plants a coordinate and looks for it in the stored
 * document, the events, the transactions table and the summary.
 * A rebuild derives an untouched pick's eyes from its clip's current transform (core eyesFromTransform); a pick edited by hand is
 * kept as it is; a pick deleted by hand comes back only with restoreRemoved and eyes in the request (else excluded needs_marks).
 * Until W2 builds the bodies (and W1 the planner), the owner gets 501 growing_not_built: nothing is planned or changed.
 * Every refusal's English sentence is fixed here (GROWING_API_ERRORS); the Hebrew is packages/i18n/src/growing.ts HE_GROWING.
 */
import type { GrowingApplyResult, GrowingPlanView, GrowingRegenerateResult, RegenerateOptions } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { ApiError, type Store } from './store.ts';

/** True once the bodies below are built (W2 flips it). */
export const GROWING_SERVER_BUILT: boolean = false;

/** The fixed refusals of the growing calls (Hebrew: i18n growing.ts HE_GROWING; growing-wording.test.ts provokes each). */
export const GROWING_API_ERRORS = {
  ownerRequired: () => new ApiError(403, 'owner_required', 'growing up before your eyes is made from the owner\'s own session only', {}, 'The owner makes it in the editor on this computer; an agent cannot plan, apply or rebuild it.'),
  notBuilt: () => new ApiError(501, 'growing_not_built', 'growing up before your eyes is not built in this version yet', {}, 'Nothing was changed. The family film, the story and templates still work.'),
  runNotFound: (runId: string) => new ApiError(404, 'not_found', `growing run ${runId} not found`, { runId }, 'A growing run id is returned by apply (runId).'),
} as const;
export type GrowingApiErrorKey = keyof typeof GROWING_API_ERRORS;

/** The first check of every growing call: the credential may see the project, and it is the owner's own session. Exported for templates.ts. */
export function assertGrowingCaller(gov: Governance, principal: Principal, projectId: string): void {
  gov.assertMayAct(principal, projectId, 'observe');
  if (principal.kind !== 'user') throw GROWING_API_ERRORS.ownerRequired(); // the owner's browser session (http.ts owner(); auth.ts makes no other user session)
}

/** POST …/recipes/growing/plan. W2: planGrowing on the live document with the capture context; the view without ops and without eyes. */
export async function planGrowingFor(_store: Store, gov: Governance, principal: Principal, projectId: string, _params: unknown): Promise<GrowingPlanView> {
  assertGrowingCaller(gov, principal, projectId);
  throw GROWING_API_ERRORS.notBuilt();
}
/** POST …/recipes/growing/apply. W2: plan, then ONE apply_template { templateId tpl.growing, params: plan.record, recordRanges } against the plan's revision. */
export async function applyGrowingFor(_store: Store, gov: Governance, principal: Principal, projectId: string, _params: unknown, _expectedRevision?: number): Promise<GrowingApplyResult> {
  assertGrowingCaller(gov, principal, projectId);
  throw GROWING_API_ERRORS.notBuilt();
}
/** POST …/recipe-runs/{runId}/regenerate (and …/template-runs/…) for a 'template:tpl.growing' run. W2: the rebuild of C8. */
export async function regenerateGrowingFor(_store: Store, gov: Governance, principal: Principal, projectId: string, _runId: string, _newParams?: unknown, _expectedRevision?: number, _options: RegenerateOptions = {}): Promise<GrowingRegenerateResult> {
  assertGrowingCaller(gov, principal, projectId);
  throw GROWING_API_ERRORS.notBuilt();
}
