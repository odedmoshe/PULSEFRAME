/**
 * Perform mode on the server (ADR-0025): POST /api/v1/projects/:id/takes and the MCP tool perform_take. The browser sends the
 * RAW taps of a take (calibration already subtracted), the pad bank (catalogue ids), the project assets the pads resolved to
 * and the snap settings; the server plans with the same pure functions the browser used for its preview (core
 * planTakeRequest: grid, quantise, planPerformance) and commits ONE internal apply_take against the revision the take was
 * performed on — one transaction, one undo (the ADR-0016 pattern: a composite op is issued by the server from a plan it built,
 * never sent by a client).
 * - dryRun: plan only (observe), nothing committed; the determinism proof compares these args with the browser's.
 * - Agents in propose mode are refused (403 insufficient_scope), and so is a grant limited to tracks or a time range (403
 *   out_of_scope): a take adds tracks and a run record, through an internal op a proposal cannot carry.
 * - While the planner is not built (core PERFORM_PLANNER_BUILT false) every call answers 501 take_not_built after the
 *   permission checks; nothing is planned or changed.
 * - A take whose planner kept no hit answers 409 take_empty with the chips (why each tap was held); nothing is changed.
 * Lead-built; the planner is W1's (core moves.ts). Pads never add people fields or ages; the take reads nothing about people.
 */
import { PERFORM_API_REFUSALS as A, PERFORM_PLANNER_BUILT, planTakeRequest, type TakePlanView, type TakeRequest, type TakeResult } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { ApiError, type Store } from './store.ts';

export const PERFORM_API_ERRORS = {
  notBuilt: () => new ApiError(A.notBuilt.status, A.notBuilt.code, A.notBuilt.message(), {}, A.notBuilt.hint),
  empty: (taps: number, chips: unknown) => new ApiError(A.empty.status, A.empty.code, A.empty.message(taps), { chips }, A.empty.hint),
  propose: () => new ApiError(A.propose.status, A.propose.code, A.propose.message(), { mode: 'propose' }, A.propose.hint),
} as const;

function mayRecord(gov: Governance, principal: Principal, projectId: string) {
  gov.assertMayAct(principal, projectId, 'observe'); // the grant covers this project at all (403 out_of_scope otherwise)
  if (principal.kind === 'agent' && principal.mode === 'propose') throw PERFORM_API_ERRORS.propose();
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'record a performance take (it adds tracks, clips and a run record)');
}
type CommitOut = { revision: number; results?: { output?: { runId?: string; createdIds?: string[] } }[] };

/** Plan (dryRun) or record a take. `req` is already parsed with core TakeRequestSchema. */
export function takeFor(store: Store, gov: Governance, principal: Principal, projectId: string, req: TakeRequest): TakeResult | TakePlanView {
  if (req.dryRun) gov.assertMayAct(principal, projectId, 'observe'); else mayRecord(gov, principal, projectId);
  const p = store.getProject(projectId);
  if (!PERFORM_PLANNER_BUILT) throw PERFORM_API_ERRORS.notBuilt();
  const plan = planTakeRequest(p.doc, req);
  if (req.dryRun) return { revision: p.revision, args: plan.args, chips: plan.chips, warnings: plan.warnings };
  if (!plan.args) throw PERFORM_API_ERRORS.empty(req.taps.length, plan.chips);
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: req.expectedRevision ?? p.revision, allowInternal: true, label: 'Performance take',
    ops: [{ op: 'apply_take', args: plan.args }],
  }) as CommitOut;
  const out = r.results?.[0]?.output ?? {};
  return { revision: r.revision, runId: out.runId ?? '', createdIds: out.createdIds ?? [], chips: plan.chips, warnings: plan.warnings };
}
