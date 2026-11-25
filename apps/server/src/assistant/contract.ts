/**
 * The server side of the command bar's language-model assistant (ADR-0027, plan §7.3–7.6). LEAD: W2 implements against it
 * (summary.ts, prompt.ts, validate.ts, job.ts, credential.ts, routes.ts, testAdapter.ts) and does not edit it, governance.ts,
 * store.ts, http.ts, mcp.ts, peoplePrivacy.ts or descriptor.ts. The wire types are core's (assistantContract.ts), re-exported here.
 *
 * Built now (lead): the files' names and modes, the owner-session test, the in-memory propose-only principal, the route
 * table (registered by http.ts; every handler answers 501 not_built until W2), Governance.reserveAssistant / settleAssistant
 * / assistantSpend, PF_ASSISTANT_HOSTS (config.ts assistantHosts) and the backup exclusion (backup.ts NEVER_BACKED_UP).
 */
import type { AssistantConfigBody, AssistantJobOutput, AssistantKeyState, AssistantRequestBody, AssistantStatus, AssistantStatusAnswer, AssistantSummary, AssistantToggles } from '@pulseframe/core';
import { ASSISTANT_ACTOR, ASSISTANT_GRANT_ID } from '@pulseframe/core';
import type { AssistantLocalCheck } from '@pulseframe/core';
import type { ChatEndpoint, ChatModelAdapter, LocalModelAdapter } from '@pulseframe/providers';
import type { ComputeLane } from '../aiContracts.ts';
import type { Grant, Principal } from '../governance.ts';

export type { AssistantConfigBody, AssistantJobOutput, AssistantKeyState, AssistantRequestBody, AssistantStatus, AssistantStatusAnswer, AssistantSummary, AssistantToggles };

/** In the data directory, outside every project, archive and backup (backup.ts NEVER_BACKED_UP): the owner's config (no key) and the key alone. */
export const ASSISTANT_CONFIG_FILE = 'assistant.json';
export const ASSISTANT_KEY_FILE = 'assistant.key';
/** Both files are written to a temporary name with this mode, then renamed into place. */
export const ASSISTANT_FILE_MODE = 0o600;

/**
 * The owner's own browser session: the money and the key are the owner's (plan §7.4). An agent token or grant gets 403
 * owner_required on every owner route, also when it could observe; of the status it reads connected or not (visibility.ts).
 */
export const isOwnerSession = (p: Principal): boolean => p.kind === 'user' && p.actor === 'user:local';

/**
 * The principal one assistant job proposes as, built in memory per job (plan §7.4): agent:assistant in Propose mode, people
 * 'names', limited to the one project, with the monthly limit as its budget. No token for it exists, so nothing outside the
 * server can act as it; Pause Agent stops it (Governance.assertMayAct). Governance.reserveAssistant accepts only this shape.
 */
export function assistantPrincipal(projectId: string, monthlyLimitCents: number, createdAt: string): Principal {
  const grant: Grant = { id: ASSISTANT_GRANT_ID, name: 'assistant', mode: 'propose', projectIds: [projectId], trackIds: null, range: null, budgetCents: monthlyLimitCents,
    requestsPerMinute: null, exportsPerDay: null, people: 'names', expiresAt: null, revokedAt: null, createdAt, createdBy: 'user:local' };
  return { actor: ASSISTANT_ACTOR, kind: 'agent', scopes: ['observe'], mode: 'propose', grant };
}

/** The installed adapters (a Map: an adapter id is never used as a plain-object key) — empty in wave 1 — and the owner's endpoint, null until configured. */
export interface AssistantDeps {
  adapters: ReadonlyMap<string, ChatModelAdapter>; endpoint(): ChatEndpoint | null;
  /**
   * wave 7, the LOCAL assistant: the loopback-only adapter (llamaAdapter.ts in production, installed by index.ts; a labelled MOCK in
   * tests); absent or null = no local adapter in this build (setup provider_not_configured).
   */
  local?: LocalModelAdapter | null;
  /** wave 7: the compute lane a local request takes while the owner's model computes (label ASSISTANT_LOCAL_LANE_LABEL); index.ts passes it. */
  lane?: ComputeLane | null;
}
/** The lane label of a local request (the lane hooks release the kept speech and tool workers before it starts). */
export const ASSISTANT_LOCAL_LANE_LABEL = 'assistant (local model)';

/** What `GET …/assistant/summary` and the job send: the summary and the switches it was built with. */
export interface AssistantSummaryContext { playheadFrame: number; selection: readonly string[]; sequenceId?: string }

/** The assistant's REST routes. 'owner' = isOwnerSession, else 403 owner_required; 'observe' = any credential with observe. */
export const ASSISTANT_ROUTES = [
  { method: 'GET', path: '/api/v1/assistant/status', access: 'observe', answers: 'AssistantStatus for the owner\'s own session (never the key); AssistantPublicStatus, connected or not and nothing else, for any other credential' },
  { method: 'GET', path: '/api/v1/projects/:id/assistant/summary', access: 'owner', answers: 'exactly the AssistantSummary a request would send now' },
  { method: 'PUT', path: '/api/v1/assistant/config', access: 'owner', answers: 'AssistantStatus' },
  { method: 'PUT', path: '/api/v1/assistant/key', access: 'owner', answers: 'AssistantKeyState' },
  { method: 'DELETE', path: '/api/v1/assistant/key', access: 'owner', answers: 'AssistantKeyState' },
  { method: 'POST', path: '/api/v1/projects/:id/assistant/requests', access: 'owner', answers: '202 { jobId } | 409 assistant_not_connected (no job row) | 402 budget_exceeded' },
  // wave 7, the LOCAL assistant (assistant-decisions.md §4)
  { method: 'POST', path: '/api/v1/assistant/local/check', access: 'owner', answers: 'AssistantLocalCheck: what answers on 127.0.0.1:<the saved port> (running, loading, stopped, not_llama) and the model name it reports' },
  { method: 'POST', path: '/api/v1/assistant/jobs/:jobId/taken', access: 'owner', answers: '204: the owner\'s tab took or ignored the local phrase; the phrase and the text slot leave the job row (Store.erasing)' },
] as const;
export type AssistantRoute = (typeof ASSISTANT_ROUTES)[number];

/** The handlers W2 provides in routes.ts; http.ts parses bodies with core's schemas, checks the scope and calls them. */
export interface AssistantHandlers {
  status(p: Principal): AssistantStatusAnswer | Promise<AssistantStatusAnswer>;
  summary(p: Principal, projectId: string, ctx: AssistantSummaryContext): AssistantSummary | Promise<AssistantSummary>;
  putConfig(p: Principal, body: AssistantConfigBody): AssistantStatusAnswer | Promise<AssistantStatusAnswer>;
  putKey(p: Principal, key: string): AssistantKeyState | Promise<AssistantKeyState>;
  deleteKey(p: Principal): AssistantKeyState | Promise<AssistantKeyState>;
  request(p: Principal, projectId: string, body: AssistantRequestBody): { jobId: string } | Promise<{ jobId: string }>;
  /** wave 7: POST /assistant/local/check (owner). */
  localCheck(p: Principal): AssistantLocalCheck | Promise<AssistantLocalCheck>;
  /** wave 7: POST /assistant/jobs/:jobId/taken (owner); resolves when the phrase is cleared. */
  taken(p: Principal, jobId: string): void | Promise<void>;
}

/**
 * wave 7, the LOCAL assistant: the job's and the routes' fixed sentences (reason, then the next step in `hint`). Builder B uses exactly
 * these (job.ts, routes.ts); packages/i18n commandBar.ts HE_ASSISTANT words each in Hebrew; command-bar-wording.test.ts checks both, and
 * that none speaks of money, a charge or a reservation (a local request costs nothing). `local_server_error` carries a status code or
 * a code word only, never a reply body.
 */
export const ASSISTANT_LOCAL_SENTENCES = {
  grammar_understood: { message: 'the command bar reads this request itself, so it is not sent to the local assistant', hint: 'Use the bar\'s own answer: press Enter on it, or answer its question.' },
  local_not_running: { message: 'the local assistant is not running on this computer: nothing answers on 127.0.0.1 at the saved port', hint: 'Start it as the guide «עוזר שפה מקומי» says, then ask again.' },
  local_loading: { message: 'the local assistant is still loading its model', hint: 'Wait a little, then ask again.' },
  local_timeout: { message: 'the local assistant took longer than the time limit, and the request was stopped', hint: 'Ask again, or raise the time limit in Settings, under the language assistant.' },
  local_not_loopback: { message: 'the local assistant\'s address did not lead to this computer, so nothing was sent', hint: 'Check the port in Settings, and that the local server listens on 127.0.0.1 only.' },
  local_server_error: { message: (detail: string) => `the local assistant answered with an error (${detail})`, hint: 'Look at the local assistant\'s window, start it again if needed, then ask again.' },
  canceled_unsent: { message: 'canceled before anything was sent to the local assistant', hint: 'Ask again when you want.' },
  canceled_sent: { message: 'canceled while the local assistant was answering; nothing left this computer', hint: 'Ask again when you want.' },
  recovered: { message: 'the server stopped during a local request; nothing left this computer and nothing is held', hint: 'Ask again.' },
  invalid: { message: (category: string) => `the local assistant's answer was not a command of the bar (${category}); nothing was changed`, hint: 'Say it differently, or use one of the bar\'s examples.' },
} as const;
