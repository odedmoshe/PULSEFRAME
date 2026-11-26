/**
 * Who reads what of the language assistant's work (ADR-0027, note of 2026-11-25). A request to the assistant is the owner's own:
 * their typed words, their money, an answer written for them. So the job it runs and the proposal it leaves are whole only for
 * the owner's own session (contract.ts isOwnerSession). Every other principal, whatever its grant (observe, propose, edit,
 * autopilot, people 'full'), reads of an assistant job its id, project, type, status and times, and nothing else (the actor is in
 * the answer because the API's Job has one; it is the same word for every assistant job, agent:assistant): no stage, no
 * attempt, no output (the model's explanation, the proposal id, the cost), no error (its text can quote the service or the
 * model), nothing of the input. The assistant's proposals (their operations can repeat what the owner typed) are not listed for
 * it, not answered by id (404 as for an id that does not exist), not rendered and not announced in its event stream. Accepted,
 * a proposal's operations become ordinary edits of the project, read like any other.
 *
 * ONE place decides it, for every surface that answers a job or a proposal: GET /jobs/:jobId and MCP get_job (http.ts
 * jobViewFor), the project's event stream (job and proposal events, per listener), GET …/proposals, GET …/proposals/:id and its
 * frame, MCP list_proposals. assistant/jobPrivacy.test.ts walks every REST route and MCP tool with planted words.
 *
 * THE MONEY AND THE PROVIDER (same note, "money and provider"; lead decision). What the assistant spent, holds and may spend,
 * its prices, its service host, its model, its adapter, the two data switches and whether a key is stored are the owner's. The
 * owner's own session reads them whole; every other principal reads whether the assistant is connected, and nothing else, not
 * even which setting is missing (assistantStatusFor). The same facts are in a job's input (host, model, estimate, reservation)
 * and output (cost): assistantJobStub above already keeps those from everyone else. A ledger row is answered, and a held amount
 * released, for the owner's session only (assertMayReleaseBudget: POST /jobs/:jobId/budget/release; no MCP tool releases).
 * The refusals that carry amounts (402 budget_exceeded, 409 assistant_not_connected with its blockers) are given by owner-only
 * routes. What a credential still reads about money is its OWN grant's budget (MCP get_controls: budgetCents, spentCents,
 * reservedCents of the grant it authenticates with, a different ledger id), because an agent needs it to decide whether paid
 * work can start; and its own request rate limit as the 429 it gets. assistant/statusPrivacy.test.ts plants amounts, a host and
 * a model and walks the same surfaces with the same seven kinds of credential.
 */
import { ASSISTANT_ACTOR, ASSISTANT_JOB_TYPE, type AssistantPublicStatus, type AssistantStatus, type AssistantStatusAnswer } from '@pulseframe/core';
import type { Principal } from '../governance.ts';
import { ApiError, type JobRow } from '../store.ts';
import { isOwnerSession } from './contract.ts';
import { actsAsOwner } from '../autonomy.ts';

/** All that a principal other than the owner's session reads of an assistant job. */
export interface AssistantJobStub { id: string; projectId: string; type: typeof ASSISTANT_JOB_TYPE; actor: typeof ASSISTANT_ACTOR; status: string; createdAt: string; updatedAt: string }

/** The reduced job for `p`, or null when `p` reads the job whole (not an assistant job, or the owner's own session). */
export function assistantJobStub(p: Principal, j: Pick<JobRow, 'id' | 'projectId' | 'type' | 'status' | 'createdAt' | 'updatedAt'>): AssistantJobStub | null {
  if (j.type !== ASSISTANT_JOB_TYPE || actsAsOwner(p)) return null;
  return { id: j.id, projectId: j.projectId, type: ASSISTANT_JOB_TYPE, actor: ASSISTANT_ACTOR, status: j.status, createdAt: j.createdAt, updatedAt: j.updatedAt };
}

/** Whether `p` may read a proposal (a stored row or its event): every proposal but the assistant's, which is the owner's own. */
export const mayReadProposal = (p: Principal, proposal: { actor: string }): boolean => proposal.actor !== ASSISTANT_ACTOR || actsAsOwner(p);
/** The proposals `p` may read, in order. */
export const proposalsFor = <P extends { actor: string }>(p: Principal, rows: P[]): P[] => rows.filter((r) => mayReadProposal(p, r));
/** A proposal answered by id: refused exactly as an id that does not exist (Governance.getProposal), so asking tells nothing. */
export function assertMayReadProposal(p: Principal, proposal: { id: string; actor: string }): void {
  if (!mayReadProposal(p, proposal)) throw new ApiError(404, 'proposal_not_found', `proposal ${proposal.id} not found`);
}

// ---------- the assistant's money and provider ----------
/** The two sentences a principal other than the owner's session can read: fixed words, nothing of the setup in them. */
export const PUBLIC_STATUS_DETAIL = {
  ready: 'the language assistant is connected; its settings, its requests and its spending are the owner\'s own',
  not_connected: 'the language assistant is not connected; the owner connects it in the editor\'s Settings',
} as const satisfies Record<AssistantPublicStatus['setup'], string>;
/**
 * The assistant's status as `p` may read it: whole for the owner's own session; for anyone else connected or not. Every answer
 * that carries the status goes through here (GET /assistant/status, PUT /assistant/config).
 */
export function assistantStatusFor(p: Principal, whole: AssistantStatus): AssistantStatusAnswer {
  if (actsAsOwner(p)) return whole;
  const setup = whole.setup === 'ready' ? 'ready' : 'not_connected';
  return { connected: setup === 'ready', setup, detail: PUBLIC_STATUS_DETAIL[setup] };
}
/**
 * Releasing a held amount, and the ledger row the release answers with, are the owner's session's (the owner checked the
 * service's billing; an agent cannot know). The one refusal for every other credential, whatever its grant and whatever the
 * job: the reason, the next step and the job id it asked about; nothing of the ledger (not even whether an amount is held).
 */
export const budgetReleaseRefusal = (jobId: string) => new ApiError(403, 'owner_required',
  'a reserved amount is released from the owner\'s own session only, so an agent credential cannot release it', { jobId },
  'Ask the owner to release it after checking the service\'s billing: for a language-assistant request, «שחרור הסכום השמור» (Release the held amount) in the editor\'s command bar or in Settings; for any job, POST /api/v1/jobs/{jobId}/budget/release from the owner\'s session. Until then the amount stays counted.');
export function assertMayReleaseBudget(p: Principal, jobId: string): void {
  if (!actsAsOwner(p)) throw budgetReleaseRefusal(jobId);
}
