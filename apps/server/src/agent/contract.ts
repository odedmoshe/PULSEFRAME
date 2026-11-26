/**
 * The in-editor agent on the server (wave 8 autonomy Part 2; core agentContract.ts). LEAD PRE-PASS: the tables, the run's principal,
 * the resume rule, the ledger rows of model calls, file locations. BUILDER W1 (opus) owns apps/server/src/agent/{contract,loop,
 * runs,undoAll,ledger}.ts after the pre-pass; W2 owns agent/{keys,providers}.ts; the shared files are frozen.
 *
 * ONE AUTHORITY. The loop calls the editor's own MCP tools in process through `serveAs(principal, request)` (mcp.ts; verifier C9:
 * no run token, nothing reachable from http.ts). Every edit therefore goes Governance.commitAs → Store.commit exactly as Claude
 * Code's do; a test greps agent/ for `.commit(` and `store.db.prepare('UPDATE projects` (none allowed).
 *
 * THE PRINCIPAL. `runPrincipal(runId)` is the built-in agent token's principal with the run's own actor: an ORDINARY agent
 * credential. Part 1 (wt/auto-p1) stamps open-mode principals in Auth.authenticate; serveAs bypasses authenticate, so the loop
 * applies Part 1's exported stamp (`stampOpen(p, serverMode())`) to this principal at the start of EVERY step (a mode switch
 * reaches the next step; C4 also stops open runs as stopped_mode_changed). Until Part 1 lands the principal is used as it is.
 *
 * THE RESUME RULE (C8, checked by proof:agent check 6):
 *  1. A step row (status running, started_at) is INSERTED and committed before its model call or tool call is made.
 *  2. Every acting tool call carries idempotencyKey `<runId>.<n>.<k>` (core agentIdempotencyKey): apply_transaction and the op
 *     tools (Store.commit replays), export_project / export_batch (findJobByKey), make_shorts / apply_template / apply_recipe
 *     (Store.findTransactionByKey, checked BEFORE planning). A resend after a restart returns the stored commit or job.
 *  3. On restart (`recoverAgentRuns`, called beside recoverAssistantJobs in index.ts), for each run whose job is running/queued:
 *     a tool step with no result is RESENT with the same key when its tool is in IDEMPOTENT_TOOLS; any other tool step with no
 *     result is reconciled: if ANY transaction or job of the run's actor exists with created_at >= the step's started_at, the step
 *     is not resent and the model gets «הצעד הושלם בחלקו: …» with what exists; otherwise it is resent. A model step with no
 *     result is resent and its cost recorded as unknown (ledger state 'unknown'), never as zero.
 *  4. Messages for the model are rebuilt from the steps (images re-rendered at their {frame, revision}; at most keepImages).
 */
import type Database from 'better-sqlite3';
import { agentRunActor, AgentNotBuiltError } from '@pulseframe/core';
import type { Principal } from '../governance.ts';
import type { AgentEndpoint, AgentModelAdapter, AgentModelRow, AgentProviderPreset } from '@pulseframe/providers';
import type { Store } from '../store.ts';

export const AGENT_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor TEXT NOT NULL UNIQUE, started_by TEXT NOT NULL, goal TEXT NOT NULL,
    provider_id TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, stop_reason TEXT, steps_used INTEGER NOT NULL DEFAULT 0,
    step_limit INTEGER, spend_limit_cents INTEGER, spent_cents REAL NOT NULL DEFAULT 0, unknown_cost_calls INTEGER NOT NULL DEFAULT 0,
    tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, plan TEXT NOT NULL DEFAULT '[]', start_revision INTEGER NOT NULL,
    job_id TEXT NOT NULL, summary TEXT, created_at TEXT NOT NULL, ended_at TEXT, undone_by TEXT);
  CREATE INDEX IF NOT EXISTS agent_runs_project ON agent_runs(project_id, created_at);
  CREATE TABLE IF NOT EXISTS agent_steps (
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, n INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
    model TEXT, tool TEXT, note TEXT, started_at TEXT NOT NULL, ended_at TEXT, revision_after INTEGER,
    PRIMARY KEY (run_id, n));
`;
/** Complete: creates the two tables (idempotent). Called by the run service's constructor (W1). */
export function ensureAgentTables(db: Database.Database): void { db.exec(AGENT_TABLES_SQL); }

/** The run's principal before Part 1's stamp: the built-in agent token's (auth.ts) with the run's own actor. */
export function runPrincipal(runId: string): Principal {
  return { actor: agentRunActor(runId), kind: 'agent', scopes: ['observe', 'edit'] };
}

/** Tools whose resend with the same idempotency key cannot act twice (rule 2 above). */
export const IDEMPOTENT_TOOLS: ReadonlySet<string> = new Set(['apply_transaction', 'export_project', 'export_batch', 'make_shorts', 'apply_template', 'apply_recipe']);

/** Where a run's files live: keys and provider settings under <dataDir>/agent (backup.ts NEVER_BACKED_UP 'agent'). */
export const AGENT_DIR = 'agent';
export const AGENT_KEYS_DIR = 'agent/keys';
export const AGENT_PROVIDERS_FILE = 'agent/providers.json';
export const AGENT_MODELS_FILE = 'agent/models.json';
export const AGENT_FILE_MODE = 0o600;

// ---------- model-call money (C8/C9): one ledger row per call, settled explicitly ----------
/** budget_ledger.job_id of a model call: never equal to a job id, so Governance.settleFor never settles it by a job event. */
export const modelCallLedgerId = (jobId: string, n: number): string => `${jobId}:${n}`;
/**
 * W1. Reserve before the call (state 'reserved', reserved_cents = the bound from maxOutputTokens and the input estimate at the row's
 * prices, 0 when unpriced), under grant_id = the principal's grant id, or Part 1's owner-wide 'open-agents' ledger. Refuses with
 * 402 budget_reached past the owner-wide budget or the run's spend limit (the run stops `stopped_at_limit`, reason budget_reached).
 */
export function reserveModelCall(store: Store, principal: Principal, jobId: string, n: number, boundCents: number): void { void store; void principal; void jobId; void n; void boundCents; throw new AgentNotBuiltError('reserveModelCall'); }
/** W1. Settle with the actual cents (null usage = settle at the reservation, as settleAssistant does). */
export function settleModelCall(store: Store, jobId: string, n: number, actualCents: number | null): void { void store; void jobId; void n; void actualCents; throw new AgentNotBuiltError('settleModelCall'); }
/** W1. unknown_after_send: state 'unknown', never released automatically. */
export function markModelCallUnknown(store: Store, jobId: string, n: number): void { void store; void jobId; void n; throw new AgentNotBuiltError('markModelCallUnknown'); }

// ---------- the seam between the loop (W1) and the providers (W2): FROZEN after the pre-pass ----------
/** What a run needs to call its model: built by W2's agent/providers.ts createAgentProviders(dataDir, adapters), used by W1's loop. */
export interface ResolvedProvider {
  preset: AgentProviderPreset;
  endpoint: AgentEndpoint;
  adapter: AgentModelAdapter;
  /** read from the key file for this call only; null for a local server (preset.needsKey false) */
  key: string | null;
  /** the model table row for endpoint.model (owner rows merged), or null when the owner typed a model the table does not list */
  row: AgentModelRow | null;
}
export interface AgentProviders {
  /** providerId omitted = the default (the one connected last). 409 agent_provider_not_connected when it has no model, or needs a key and has none. */
  resolve(providerId?: string, model?: string): ResolvedProvider;
  /** GET /api/v1/agent/providers (AgentProvidersAnswer): never a key. */
  view(): import('@pulseframe/core').AgentProvidersAnswer;
}
/** TEST and proof seam: the loop takes its adapters from here, so proof:agent can place the MOCK scripted model in each family's slot. */
export type AgentAdapters = ReadonlyMap<AgentProviderPreset['family'], AgentModelAdapter>;
