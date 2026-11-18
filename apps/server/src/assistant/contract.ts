/**
 * The server side of the command bar's language-model assistant (ADR-0027, plan §7.3–7.6). LEAD: W2 implements against it
 * (summary.ts, prompt.ts, validate.ts, job.ts, credential.ts, routes.ts, testAdapter.ts) and does not edit it, governance.ts,
 * store.ts, http.ts, mcp.ts, peoplePrivacy.ts or descriptor.ts. The wire types are core's (assistantContract.ts), re-exported here.
 *
 * Built now (lead): the files' names and modes, the owner-session test, the in-memory propose-only principal, the route
 * table (registered by http.ts; every handler answers 501 not_built until W2), Governance.reserveAssistant / settleAssistant
 * / assistantSpend, PF_ASSISTANT_HOSTS (config.ts assistantHosts) and the backup exclusion (backup.ts NEVER_BACKED_UP).
 */
import type { AssistantConfigBody, AssistantJobOutput, AssistantKeyState, AssistantRequestBody, AssistantStatus, AssistantSummary, AssistantToggles } from '@pulseframe/core';
import { ASSISTANT_ACTOR, ASSISTANT_GRANT_ID } from '@pulseframe/core';
import type { ChatEndpoint, ChatModelAdapter } from '@pulseframe/providers';
import type { Grant, Principal } from '../governance.ts';

export type { AssistantConfigBody, AssistantJobOutput, AssistantKeyState, AssistantRequestBody, AssistantStatus, AssistantSummary, AssistantToggles };

/** In the data directory, outside every project, archive and backup (backup.ts NEVER_BACKED_UP): the owner's config (no key) and the key alone. */
export const ASSISTANT_CONFIG_FILE = 'assistant.json';
export const ASSISTANT_KEY_FILE = 'assistant.key';
/** Both files are written to a temporary name with this mode, then renamed into place. */
export const ASSISTANT_FILE_MODE = 0o600;

/**
 * The owner's own browser session: the money and the key are the owner's (plan §7.4). An agent token or grant gets 403
 * owner_required on every owner route, also when it could observe.
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
export interface AssistantDeps { adapters: ReadonlyMap<string, ChatModelAdapter>; endpoint(): ChatEndpoint | null }

/** What `GET …/assistant/summary` and the job send: the summary and the switches it was built with. */
export interface AssistantSummaryContext { playheadFrame: number; selection: readonly string[]; sequenceId?: string }

/** The assistant's REST routes. 'owner' = isOwnerSession, else 403 owner_required; 'observe' = any credential with observe. */
export const ASSISTANT_ROUTES = [
  { method: 'GET', path: '/api/v1/assistant/status', access: 'observe', answers: 'AssistantStatus (never the key)' },
  { method: 'GET', path: '/api/v1/projects/:id/assistant/summary', access: 'owner', answers: 'exactly the AssistantSummary a request would send now' },
  { method: 'PUT', path: '/api/v1/assistant/config', access: 'owner', answers: 'AssistantStatus' },
  { method: 'PUT', path: '/api/v1/assistant/key', access: 'owner', answers: 'AssistantKeyState' },
  { method: 'DELETE', path: '/api/v1/assistant/key', access: 'owner', answers: 'AssistantKeyState' },
  { method: 'POST', path: '/api/v1/projects/:id/assistant/requests', access: 'owner', answers: '202 { jobId } | 409 assistant_not_connected (no job row) | 402 budget_exceeded' },
] as const;
export type AssistantRoute = (typeof ASSISTANT_ROUTES)[number];

/** The handlers W2 provides in routes.ts; http.ts parses bodies with core's schemas, checks the scope and calls them. */
export interface AssistantHandlers {
  status(p: Principal): AssistantStatus | Promise<AssistantStatus>;
  summary(p: Principal, projectId: string, ctx: AssistantSummaryContext): AssistantSummary | Promise<AssistantSummary>;
  putConfig(p: Principal, body: AssistantConfigBody): AssistantStatus | Promise<AssistantStatus>;
  putKey(p: Principal, key: string): AssistantKeyState | Promise<AssistantKeyState>;
  deleteKey(p: Principal): AssistantKeyState | Promise<AssistantKeyState>;
  request(p: Principal, projectId: string, body: AssistantRequestBody): { jobId: string } | Promise<{ jobId: string }>;
}
