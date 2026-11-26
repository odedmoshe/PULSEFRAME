/**
 * Money of the in-editor agent's MODEL calls (wave 8 autonomy Part 2; verifier C8/C9). A model call is not a job, so it never rides
 * Governance.settleFor: every call gets its own budget_ledger row `<jobId>:<n>` (modelCallLedgerId), reserved before the call and
 * settled, released or left 'unknown' here, explicitly. Never optimistic about money: an answer lost after sending stays 'unknown'
 * (counted against the budget) until the owner releases it.
 *
 * Which ledger group a call spends from (C13): the principal's own grant when it carries a budget (> 0), else the owner-wide group
 * `open-agents` (Part 1's OPEN_AGENTS_LEDGER, autonomy.ts). The owner-wide
 * budget (Part 1's AutonomySettings.agentBudgetCents; null = no limit) is checked at reservation against settled + held rows.
 *
 * The bound reserved is an ESTIMATE (a heuristic, labelled): input tokens ≈ the request's JSON characters / 4, output = the turn's
 * maxOutputTokens, at the model row's prices; 0 when the row has no prices (the run then counts tokens).
 */
import { costCents, type AgentModelRow, type AgentProviderErrorCode } from '@pulseframe/providers';
import { OPEN_AGENTS_LEDGER } from '../autonomy.ts';
import type { Principal } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';
import { modelCallLedgerId } from './contract.ts';

/** Part 1's owner-wide group (autonomy.ts OPEN_AGENTS_LEDGER): Governance.reserveOpen and the run's model calls spend from the same rows. */
export const OPEN_AGENTS_GROUP = OPEN_AGENTS_LEDGER;
const now = () => new Date().toISOString();

/** The heuristic bound of one call in cents (see the file header); 0 when unpriced. */
export function boundCents(row: AgentModelRow | null, requestChars: number, maxOutputTokens: number): number {
  const c = costCents(row, { inputTokens: Math.ceil(requestChars / 4), outputTokens: maxOutputTokens });
  return c === null ? 0 : Math.ceil(c * 100) / 100;
}
export const ledgerGroup = (p: Principal): string => (p.grant && p.grant.budgetCents > 0 ? p.grant.id : OPEN_AGENTS_GROUP);

function held(store: Store, group: string): number {
  const r = store.db.prepare("SELECT COALESCE(SUM(CASE WHEN state = 'settled' THEN actual_cents WHEN state IN ('reserved','unknown') THEN reserved_cents ELSE 0 END),0) AS n FROM budget_ledger WHERE grant_id = ?").get(group) as { n: number };
  return r.n;
}

/**
 * Reserve before the call. 402 budget_reached past the grant's budget or the owner-wide budget (`ownerBudgetCents`, null = none):
 * the run stops stopped_at_limit with reason budget_reached. Atomic (one SQLite transaction).
 */
export function reserveModelCall(store: Store, principal: Principal, jobId: string, n: number, bound: number, ownerBudgetCents: number | null = null): void {
  const group = ledgerGroup(principal);
  const limit = group === OPEN_AGENTS_GROUP ? ownerBudgetCents : principal.grant!.budgetCents;
  store.db.transaction(() => {
    const used = held(store, group);
    if (limit !== null && used + bound > limit) throw new ApiError(402, 'budget_reached', 'this model call would pass the agents\' budget', { budgetCents: limit, usedCents: used, requestedCents: bound }, 'Raise the budget in Settings › Access and press continue.');
    store.db.prepare('INSERT INTO budget_ledger (job_id, grant_id, reserved_cents, state, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(modelCallLedgerId(jobId, n), group, bound, 'reserved', now(), now());
  }).immediate();
}
/** Settle with the actual cents (null = the cost is not known from usage: settled at the reservation, as settleAssistant does). */
export function settleModelCall(store: Store, jobId: string, n: number, actualCents: number | null): void {
  store.db.prepare("UPDATE budget_ledger SET state = 'settled', actual_cents = COALESCE(?, reserved_cents), updated_at = ? WHERE job_id = ? AND state = 'reserved'").run(actualCents, now(), modelCallLedgerId(jobId, n));
}
/** Nothing was charged (the provider refused before generating). */
export function releaseModelCall(store: Store, jobId: string, n: number): void {
  store.db.prepare("UPDATE budget_ledger SET state = 'released', updated_at = ? WHERE job_id = ? AND state = 'reserved'").run(now(), modelCallLedgerId(jobId, n));
}
/** unknown_after_send, a crash during the call, or an answer whose usage was lost: state 'unknown', never released automatically. */
export function markModelCallUnknown(store: Store, jobId: string, n: number): void {
  store.db.prepare("UPDATE budget_ledger SET state = 'unknown', updated_at = ? WHERE job_id = ? AND state = 'reserved'").run(now(), modelCallLedgerId(jobId, n));
}
/** Provider failures that come back before anything is generated: nothing charged. The rest are counted as unknown money. */
const NOT_CHARGED: ReadonlySet<AgentProviderErrorCode> = new Set(['unauthorized', 'no_credit', 'rate_limited', 'overloaded', 'unreachable', 'local_server_down', 'context_too_long', 'bad_request']);
export const chargedIsUnknown = (code: AgentProviderErrorCode): boolean => !NOT_CHARGED.has(code);
export function ledgerState(store: Store, jobId: string, n: number): { state: string; reservedCents: number; actualCents: number | null } | null {
  return (store.db.prepare('SELECT state, reserved_cents AS reservedCents, actual_cents AS actualCents FROM budget_ledger WHERE job_id = ?').get(modelCallLedgerId(jobId, n)) as never) ?? null;
}
