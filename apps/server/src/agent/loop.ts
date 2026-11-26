/**
 * The agent loop and run service (wave 8 autonomy Part 2). LEAD PRE-PASS: the service interface every surface calls (REST routes in
 * agent/routes.ts, the MCP tools start_agent_run / get_agent_run / undo_actor_since in mcp.ts) and the not-built service they get
 * until W1 builds `createAgentService`. BUILDER W1 (opus) owns this file.
 *
 * The loop (W1), one durable job of type AGENT_JOB_TYPE per run, run on its own async lane (not the compute lane: a model call is
 * network wait; the tools it calls take the compute lane themselves):
 *   repeat: stamp the principal (contract.ts) → stop if the run was cancelled, the mode changed (C4), a limit is reached (step,
 *   spend, budget: «הגעתם ל…», continuable) → rebuild messages from the steps → insert the model step (running) → reserve the
 *   ledger row → adapter.turn → settle → for each tool call (≤ toolCallsPerTurn, in order): insert the tool step (running), answer a
 *   loop tool itself or call MCP through serveAs with idempotencyKey <runId>.<n>.<k>, store the summary, transaction and job ids →
 *   until `finish`, a turn with no tool call (succeeded with the text as summary), or a provider error (C16 table, i18n
 *   agent.provider.*). 423 agent_paused → status waiting, no step burned, retried when the project is resumed. 429 → waiting with
 *   retry-after. context_too_long → drop the oldest images, then the oldest tool results (a note step says so), and go on.
 *   A model that answers without tool calls on the first turn, or whose call does not parse twice → stop model_no_tools
 *   («המודל הזה לא מפעיל כלים»), not counted as a step.
 */
import { AGENT_REFUSAL_CODES, type AgentContinueBodySchema, type AgentRunAnswer, type AgentRunListAnswer, type AgentStartAnswer, type AgentStartBody, type UndoAllAnswer, type UndoActorBodySchema } from '@pulseframe/core';
import type { z } from 'zod';
import type { Principal } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';

export interface AgentRunService {
  start(p: Principal, projectId: string, body: AgentStartBody): AgentStartAnswer;
  list(p: Principal, projectId: string): AgentRunListAnswer;
  get(p: Principal, projectId: string, runId: string): AgentRunAnswer;
  cancel(p: Principal, projectId: string, runId: string): AgentRunAnswer;
  continue(p: Principal, projectId: string, runId: string, body: z.infer<typeof AgentContinueBodySchema>): AgentRunAnswer;
  /** «ביטול הכול» of one run: Store.undoActor(projectId, run.actor, run.startRevision) + cancel its open jobs + notUndone (C7). */
  undoAll(p: Principal, projectId: string, runId: string, opts: { dryRun?: boolean; partial?: boolean }): UndoAllAnswer;
  /** Any actor since a revision (agent:local defaults to its last continuous session: C6). Own actor, or any actor for a principal that acts as owner. */
  undoActor(p: Principal, projectId: string, body: z.infer<typeof UndoActorBodySchema>): UndoAllAnswer;
  /** Server shutdown: steps in flight finish their write; runs stay running for recover. */
  stop(): Promise<void>;
}

export const agentNotBuilt = (): ApiError => new ApiError(AGENT_REFUSAL_CODES.notBuilt.status, AGENT_REFUSAL_CODES.notBuilt.code, 'the in-editor agent is not built in this build yet', {}, 'Use an outside agent (Claude Code) over MCP with the agent key meanwhile.');
/** What every surface uses until W1's service exists: an honest 501 agent_not_built (after the surface's own checks). */
export function notBuiltAgentService(): AgentRunService {
  const no = (): never => { throw agentNotBuilt(); };
  return { start: no, list: no, get: no, cancel: no, continue: no, undoAll: no, undoActor: no, stop: async () => {} };
}

/** W1. Re-queue runs whose job was running when the process died, applying the resume rule (contract.ts). Until built: nothing to recover. */
export function recoverAgentRuns(store: Store): string[] { void store; return []; }
