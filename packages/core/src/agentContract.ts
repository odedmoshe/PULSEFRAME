/**
 * The in-editor agent «סוכן» (wave 8 autonomy, Part 2): the CONTRACT shared by the server loop, the routes, MCP and the tab.
 * LEAD PRE-PASS. Authority: the owner's decisions of 2026-11-26 (docs/BLOCKERS.md, CLAUDE.md "Product scope": a general-purpose
 * editor, autonomy first, open by default) > .artifacts/wave8/autonomy-verify.md (C1–C16) > autonomy-plan.md Part 2.
 *
 * What a run is: the owner (or an agent with the edit scope) types a goal; a language model plans and acts through the editor's own
 * MCP tools (in process, `serveAs`, no token: verifier C9) as the principal `agent:run_<id>`, an ORDINARY agent credential in
 * whatever server mode Part 1 sets (open: full; guarded: today's agent). Every edit is a registered op through Store.commit; every
 * step is recorded before its tool runs (C8.2); «ביטול הכול» reverses every edit of the run as ONE revision and never erases an
 * edit somebody else made in between (C6), and says what it could not undo (C7).
 *
 * Skills (distil and replay) are NOT here: Part 3.
 */
import { z } from 'zod';

// ---------- identity ----------
/** The actor prefix of a run (C8.1: a grant may not be named `run_…`; Part 1's createGrant reserves it, as `assistant` is). */
export const AGENT_RUN_ACTOR_PREFIX = 'agent:run_';
export const agentRunActor = (runId: string): string => `agent:${runId}`;
/** Run ids are `run_<base64url>`; the actor is `agent:<runId>`. */
export const AGENT_RUN_ID_PATTERN = /^run_[A-Za-z0-9]{8,32}$/;
/** True for a grant name that would collide with a run actor (`agent:run_…`). Part 1 calls it in Governance.createGrant. */
export const isReservedAgentName = (name: string): boolean => name.startsWith('run_');

// ---------- limits (capacity, not policy: decisions Part 2 §5) ----------
export const AGENT_LIMITS = Object.freeze({
  goalChars: 4000,
  /** default step limit of a run; the owner may raise it or choose none (null) */
  defaultStepLimit: 100,
  maxStepLimit: 10_000,
  /** «להמשיך עוד N צעדים» adds this many */
  continueSteps: 100,
  /** images kept in the rebuilt messages (older ones are replaced by their text line; re-rendered at their revision: C11) */
  keepImages: 6,
  /** render_frame scale the loop asks for when the output is wider than 1280 px (C11) */
  frameScaleOver1280: 0.5 as const,
  /** wait_for_job blocks at most this long per call */
  waitForJobMaxSeconds: 600,
  planSteps: 40,
  planStepChars: 200,
  finishSummaryChars: 4000,
  /** what a step keeps of a tool's answer (the full answer is never stored: plan §2.3) */
  resultSummaryChars: 2000,
  /** model output cap per turn the loop asks for */
  maxOutputTokens: 8192,
  /** parallel tool calls in one model turn the loop runs (in order); more are answered as an error to the model */
  toolCallsPerTurn: 8,
});

// ---------- statuses ----------
/**
 * queued → running ⇄ waiting → one final state. `waiting` = the project is paused (423) or the provider asked to wait (429): no
 * steps are burned (C16). A run that stops at a limit can continue (POST …/continue → running), as can stopped_mode_changed and
 * provider_unavailable.
 */
export const AGENT_RUN_STATUSES = ['queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled', 'stopped_at_limit', 'stopped_mode_changed', 'provider_unavailable'] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export const AGENT_RUN_FINAL: readonly AgentRunStatus[] = ['succeeded', 'failed', 'canceled', 'stopped_at_limit', 'stopped_mode_changed', 'provider_unavailable'];
export const AGENT_RUN_CONTINUABLE: readonly AgentRunStatus[] = ['stopped_at_limit', 'stopped_mode_changed', 'provider_unavailable'];
/** Why a run ended (the line under its status says WHY on the same line: C16). */
export const AGENT_STOP_REASONS = [
  'finished', 'step_limit', 'spend_limit', 'budget_reached', 'mode_changed', 'canceled_by_owner',
  'provider_unauthorized', 'provider_no_credit', 'provider_unreachable', 'provider_overloaded', 'local_server_down',
  'model_no_tools', 'model_refused', 'unknown_after_send', 'internal_error',
] as const;
export type AgentStopReason = (typeof AGENT_STOP_REASONS)[number];

export const AGENT_STEP_KINDS = ['model', 'tool', 'note'] as const;
export const AGENT_STEP_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type AgentStepStatus = (typeof AGENT_STEP_STATUSES)[number];

// ---------- the plan (update_plan) ----------
export const AgentPlanItemSchema = z.object({
  title: z.string().min(1).max(AGENT_LIMITS.planStepChars),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']).default('pending'),
}).strict();
export const AgentPlanSchema = z.array(AgentPlanItemSchema).max(AGENT_LIMITS.planSteps);
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

// ---------- usage and cost ----------
export const AgentUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
}).strict();
export type AgentUsage = z.infer<typeof AgentUsageSchema>;
/**
 * Cost of one model call in cents, from the model table's prices (per million tokens). null = no price entered (the tab then shows
 * tokens), `unknown: true` = the request was sent and its answer lost (C16 unknown_after_send: counted as unknown money, never re-sent).
 */
export const AgentCostSchema = z.object({ cents: z.number().nonnegative().nullable(), unknown: z.boolean() }).strict();

// ---------- the step record (agent_steps row, as the routes answer it) ----------
export const AgentToolCallRecordSchema = z.object({
  /** the provider's call id (toolu_… / call_…), or the loop's own for the scripted double */
  callId: z.string().max(128),
  tool: z.string().max(128),
  /** the arguments as the model sent them (parsed object; never a provider payload) */
  input: z.unknown(),
  /** at most AGENT_LIMITS.resultSummaryChars of the answer's text; images are listed as {image: frameIndex, revision} */
  resultSummary: z.string().max(AGENT_LIMITS.resultSummaryChars).nullable(),
  isError: z.boolean(),
  /** the error code when isError (an ApiError code, or the loop's own: unknown_tool, bad_arguments, too_many_calls) */
  errorCode: z.string().max(80).nullable(),
  transactionIds: z.array(z.string()).max(64),
  jobIds: z.array(z.string()).max(64),
  /** the idempotency key the loop sent (`<runId>.<n>.<k>`): a resend after a restart returns the stored commit or job (C8) */
  idempotencyKey: z.string().max(128).nullable(),
}).strict();
export type AgentToolCallRecord = z.infer<typeof AgentToolCallRecordSchema>;

export const AgentStepSchema = z.object({
  runId: z.string(),
  /** 1-based; model and tool steps share one sequence; the step limit counts model steps only */
  n: z.number().int().positive(),
  kind: z.enum(AGENT_STEP_KINDS),
  status: z.enum(AGENT_STEP_STATUSES),
  /** model steps: what the model said (text) and which tools it asked for */
  model: z.object({
    text: z.string().nullable(),
    toolCalls: z.array(z.object({ callId: z.string(), tool: z.string(), input: z.unknown() }).strict()),
    finish: z.enum(['tool', 'stop', 'length', 'refusal', 'other']),
    usage: AgentUsageSchema.nullable(),
    cost: AgentCostSchema,
    providerId: z.string(),
    model: z.string(),
  }).strict().nullable(),
  /** tool steps: one call (a model turn with three calls makes three tool steps) */
  tool: AgentToolCallRecordSchema.nullable(),
  /** note steps: the loop's own lines («הבנתי את זה כך: …», «קיצרתי את ההיסטוריה», «מושהה») */
  note: z.object({ code: z.string().max(80), text: z.string().max(1000) }).strict().nullable(),
  /** committed BEFORE the tool or model call (C8.2) */
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  revisionAfter: z.number().int().nonnegative().nullable(),
}).strict();
export type AgentStep = z.infer<typeof AgentStepSchema>;

// ---------- the run record (agent_runs row) ----------
export const AgentRunSchema = z.object({
  id: z.string().regex(AGENT_RUN_ID_PATTERN),
  projectId: z.string(),
  actor: z.string().startsWith(AGENT_RUN_ACTOR_PREFIX),
  /** who started it (the owner's session, or an agent credential's actor) */
  startedBy: z.string(),
  /** stored: needed to resume and show (plan §1.3 C10 "changed"); deleted with the run */
  goal: z.string().min(1).max(AGENT_LIMITS.goalChars),
  providerId: z.string(),
  model: z.string(),
  status: z.enum(AGENT_RUN_STATUSES),
  stopReason: z.enum(AGENT_STOP_REASONS).nullable(),
  /** model steps counted against stepLimit (null = no limit) */
  stepsUsed: z.number().int().nonnegative(),
  stepLimit: z.number().int().positive().max(AGENT_LIMITS.maxStepLimit).nullable(),
  spendLimitCents: z.number().int().nonnegative().nullable(),
  spentCents: z.number().nonnegative(),
  /** model calls whose answer was lost after sending: money unknown (C16) */
  unknownCostCalls: z.number().int().nonnegative(),
  tokens: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).strict(),
  plan: AgentPlanSchema,
  /** the project's revision when the run started: «ביטול הכול» composes from here (C6) */
  startRevision: z.number().int().nonnegative(),
  jobId: z.string(),
  summary: z.string().max(AGENT_LIMITS.finishSummaryChars).nullable(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  /** set once «ביטול הכול» committed: the composite undo transaction */
  undoneBy: z.string().nullable(),
}).strict();
export type AgentRun = z.infer<typeof AgentRunSchema>;

// ---------- the durable job ----------
/** One job row per run (type below). Its stage is `step:<n>:<status>` so the existing SSE `job` event carries live progress. */
export const AGENT_JOB_TYPE = 'agent.run';
export const agentJobStage = (n: number, status: AgentStepStatus | 'waiting'): string => `step:${n}:${status}`;
/** `<runId>.<n>.<k>`: step n, k-th call of that model turn (0-based). */
export const agentIdempotencyKey = (runId: string, n: number, k: number): string => `${runId}.${n}.${k}`;

// ---------- routes (wire types) ----------
export const AGENT_ROUTES = [
  { method: 'POST', path: '/api/v1/projects/:id/agent/runs', who: 'edit', what: 'start a run' },
  { method: 'GET', path: '/api/v1/projects/:id/agent/runs', who: 'observe', what: 'list runs (newest first, without steps)' },
  { method: 'GET', path: '/api/v1/projects/:id/agent/runs/:runId', who: 'observe', what: 'one run with its steps' },
  { method: 'POST', path: '/api/v1/projects/:id/agent/runs/:runId/cancel', who: 'edit', what: 'cancel (the step running finishes; open jobs are cancelled)' },
  { method: 'POST', path: '/api/v1/projects/:id/agent/runs/:runId/continue', who: 'edit', what: 'continue a stopped run (more steps, or after a mode change / provider outage)' },
  { method: 'POST', path: '/api/v1/projects/:id/agent/runs/:runId/undo-all', who: 'edit', what: '«ביטול הכול»: every edit of the run as ONE revision' },
  { method: 'POST', path: '/api/v1/projects/:id/undo-actor', who: 'edit', what: 'undo every edit of one actor since a revision (dryRun previews; agent:local defaults to its last session: C6)' },
  { method: 'GET', path: '/api/v1/agent/providers', who: 'observe', what: 'presets and their state (keySet, never the key)' },
  { method: 'PUT', path: '/api/v1/agent/providers/:providerId', who: 'owner-floor', what: 'base URL and model (the floor: a base URL decides where the key goes)' },
  { method: 'PUT', path: '/api/v1/agent/providers/:providerId/key', who: 'owner-floor', what: 'store the key (0600, never returned)' },
  { method: 'DELETE', path: '/api/v1/agent/providers/:providerId/key', who: 'owner-floor', what: 'forget the key' },
  { method: 'POST', path: '/api/v1/agent/providers/:providerId/probe', who: 'owner-floor', what: '«בדיקה»: one small request, the answer worded with its next step' },
  { method: 'GET', path: '/api/v1/agent/models', who: 'observe', what: 'the model table (data, with the date each row was read)' },
  { method: 'PUT', path: '/api/v1/agent/models', who: 'owner-floor', what: 'the owner\'s edits of the model table' },
] as const;

export const AgentStartBodySchema = z.object({
  goal: z.string().trim().min(1).max(AGENT_LIMITS.goalChars),
  providerId: z.string().max(64).optional().describe('default: the provider the owner connected last'),
  model: z.string().max(128).optional(),
  stepLimit: z.number().int().positive().max(AGENT_LIMITS.maxStepLimit).nullable().optional(),
  spendLimitCents: z.number().int().nonnegative().nullable().optional(),
}).strict();
export type AgentStartBody = z.infer<typeof AgentStartBodySchema>;
export interface AgentStartAnswer { runId: string; jobId: string; status: AgentRunStatus }
export const AgentContinueBodySchema = z.object({ addSteps: z.number().int().positive().max(AGENT_LIMITS.maxStepLimit).optional() }).strict();
export interface AgentRunAnswer { run: AgentRun; steps: AgentStep[] }
export interface AgentRunListAnswer { runs: AgentRun[] }

/** GET /api/v1/agent/providers: one row per preset; NEVER the key. `unencrypted` = http:// to a non-loopback host (C5). */
export interface AgentProviderView { id: string; family: 'anthropic-messages' | 'openai-chat'; baseUrl: string; model: string | null; needsKey: boolean; keySet: boolean; keyAddedAt: string | null; unencrypted: boolean; compatNote: boolean; local: boolean }
export interface AgentProvidersAnswer { providers: AgentProviderView[]; /** the provider a run uses when the start body names none */ defaultProviderId: string | null }
export interface AgentProbeAnswer { ok: boolean; /** AGENT_PROVIDER_ERROR_CODES or bad_config when not ok */ code: string | null; model: string | null }

export const UndoActorBodySchema = z.object({
  actor: z.string().min(1).max(128),
  /** omitted for agent:local = the first revision of its last continuous activity (C6), shown by dryRun before pressing */
  sinceRevision: z.number().int().nonnegative().optional(),
  dryRun: z.boolean().optional(),
  /** «ביטול מה שאפשר»: skip the conflicting entities and undo the rest */
  partial: z.boolean().optional(),
}).strict();

/** One entity another actor changed between the actor's first and last touch of it (C6): never overwritten. */
export interface UndoActorConflict { entityId: string; changedAtRevision: number; by: string }
/** What «ביטול הכול» answers (and the dry run previews). */
export interface UndoAllAnswer {
  /** null for a dry run, and when nothing was undoable */
  transactionId: string | null;
  revision: number;
  sinceRevision: number;
  /** the actor's transactions the composite reverses (stored in its result as `undoesAll`) */
  undoes: string[];
  entities: number;
  conflicts: UndoActorConflict[];
  /** C7: what no undo can reverse, from the run's steps (summarizeNotUndone), shown under the button every time */
  notUndone: NotUndoneItem[];
  /** open jobs of the run that were cancelled */
  canceledJobs: string[];
}

// ---------- what «ביטול הכול» cannot undo (C7) ----------
/** Effects of tools that are not ops. Tool names of Part 1 (versions, storage, library, downloads, engine) are as planned in C3. */
export const AGENT_EFFECT_CLASSES = ['export_file', 'library_file', 'model_download', 'engine_install', 'version_deleted', 'storage_freed', 'library_folder', 'money_spent', 'data_sent'] as const;
export type AgentEffectClass = (typeof AGENT_EFFECT_CLASSES)[number];
export const TOOL_EFFECTS: Readonly<Record<string, AgentEffectClass>> = Object.freeze({
  export_project: 'export_file', export_batch: 'export_file', retry_job: 'export_file',
  generate_narration: 'library_file', narrate_script: 'library_file', add_sound_effect: 'library_file', add_builtin_music: 'library_file',
  add_graphic_element: 'library_file', run_capability: 'library_file', apply_music_fit: 'library_file', use_library_item: 'library_file',
  start_model_download: 'model_download', install_speech_engine: 'engine_install',
  delete_version: 'version_deleted', free_storage: 'storage_freed', set_library_folder: 'library_folder',
});
export interface NotUndoneItem { kind: AgentEffectClass; count: number; /** money_spent: cents (null = no prices entered); data_sent: the provider id */ cents?: number | null; providerId?: string }
/** The step fields summarizeNotUndone reads. */
export type NotUndoneStep = Pick<AgentStep, 'kind' | 'status'> & { tool: Pick<AgentToolCallRecord, 'tool' | 'isError' | 'jobIds'> | null; model: { cost: { cents: number | null; unknown: boolean }; providerId: string } | null };
/**
 * C7, complete: counts by effect class, in AGENT_EFFECT_CLASSES order. A tool step that failed has no effect; an export batch counts
 * its jobs. Every model call sent something to the provider (data_sent, once per provider); money is summed over priced calls
 * (null when none was priced). The wording is i18n agent.notUndone.*.
 */
export function summarizeNotUndone(steps: readonly NotUndoneStep[]): NotUndoneItem[] {
  const counts = new Map<AgentEffectClass, number>();
  let cents: number | null = null, calls = 0;
  const providers = new Map<string, number>();
  for (const s of steps) {
    if (s.kind === 'tool' && s.tool && !s.tool.isError && s.status === 'done') {
      const k = TOOL_EFFECTS[s.tool.tool];
      if (k) counts.set(k, (counts.get(k) ?? 0) + (k === 'export_file' ? Math.max(1, s.tool.jobIds.length) : 1));
    }
    if (s.kind === 'model' && s.model && s.status !== 'queued') {
      calls++;
      providers.set(s.model.providerId, (providers.get(s.model.providerId) ?? 0) + 1);
      if (s.model.cost.cents !== null) cents = (cents ?? 0) + s.model.cost.cents;
    }
  }
  const out: NotUndoneItem[] = [];
  for (const k of AGENT_EFFECT_CLASSES) {
    if (k === 'money_spent') { if (calls) out.push({ kind: k, count: calls, cents: cents === null ? null : Math.round(cents * 100) / 100 }); continue; }
    if (k === 'data_sent') { for (const [providerId, n] of providers) out.push({ kind: k, count: n, providerId }); continue; }
    const n = counts.get(k);
    if (n) out.push({ kind: k, count: n });
  }
  return out;
}

// ---------- refusals (wording he/en with the next step: packages/i18n/src/agent.ts agent.error.<code>) ----------
export const AGENT_REFUSAL_CODES = {
  notBuilt: { status: 501, code: 'agent_not_built' },
  runNotFound: { status: 404, code: 'agent_run_not_found' },
  providerNotConnected: { status: 409, code: 'agent_provider_not_connected' },
  providerUnknown: { status: 404, code: 'agent_provider_unknown' },
  runActive: { status: 409, code: 'agent_run_active' },
  notContinuable: { status: 409, code: 'agent_run_not_continuable' },
  alreadyUndone: { status: 409, code: 'agent_run_already_undone' },
  undoConflict: { status: 409, code: 'undo_conflict' },
  ownerRequired: { status: 403, code: 'owner_required' },
  notYourActor: { status: 403, code: 'agent_undo_not_yours' },
} as const;
/** Provider failures as the run records them (C16); each is worded in Hebrew with its next step (agent.provider.<code>). */
export const AGENT_PROVIDER_ERROR_CODES = ['unauthorized', 'no_credit', 'rate_limited', 'overloaded', 'unreachable', 'local_server_down', 'context_too_long', 'no_tool_calling', 'bad_tool_call', 'refused', 'bad_request', 'unknown_after_send'] as const;
export type AgentProviderErrorCode = (typeof AGENT_PROVIDER_ERROR_CODES)[number];

export class AgentNotBuiltError extends Error {
  readonly code = 'agent_not_built';
  constructor(readonly fn: string) { super(`${fn}: the in-editor agent is not built in this build yet`); }
}
/** Flipped by the integrator once the loop (W1), the adapters (W2) and the tab (W3) are in and proof:agent passes. */
export const AGENT_BUILT: boolean = false;
