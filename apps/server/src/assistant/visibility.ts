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
 */
import { ASSISTANT_ACTOR, ASSISTANT_JOB_TYPE } from '@pulseframe/core';
import type { Principal } from '../governance.ts';
import { ApiError, type JobRow } from '../store.ts';
import { isOwnerSession } from './contract.ts';

/** All that a principal other than the owner's session reads of an assistant job. */
export interface AssistantJobStub { id: string; projectId: string; type: typeof ASSISTANT_JOB_TYPE; actor: typeof ASSISTANT_ACTOR; status: string; createdAt: string; updatedAt: string }

/** The reduced job for `p`, or null when `p` reads the job whole (not an assistant job, or the owner's own session). */
export function assistantJobStub(p: Principal, j: Pick<JobRow, 'id' | 'projectId' | 'type' | 'status' | 'createdAt' | 'updatedAt'>): AssistantJobStub | null {
  if (j.type !== ASSISTANT_JOB_TYPE || isOwnerSession(p)) return null;
  return { id: j.id, projectId: j.projectId, type: ASSISTANT_JOB_TYPE, actor: ASSISTANT_ACTOR, status: j.status, createdAt: j.createdAt, updatedAt: j.updatedAt };
}

/** Whether `p` may read a proposal (a stored row or its event): every proposal but the assistant's, which is the owner's own. */
export const mayReadProposal = (p: Principal, proposal: { actor: string }): boolean => proposal.actor !== ASSISTANT_ACTOR || isOwnerSession(p);
/** The proposals `p` may read, in order. */
export const proposalsFor = <P extends { actor: string }>(p: Principal, rows: P[]): P[] => rows.filter((r) => mayReadProposal(p, r));
/** A proposal answered by id: refused exactly as an id that does not exist (Governance.getProposal), so asking tells nothing. */
export function assertMayReadProposal(p: Principal, proposal: { id: string; actor: string }): void {
  if (!mayReadProposal(p, proposal)) throw new ApiError(404, 'proposal_not_found', `proposal ${proposal.id} not found`);
}
