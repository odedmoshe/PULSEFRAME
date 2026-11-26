/**
 * The server side of «מה יש בקליפ» (wave 8 `understand`; core understandContract.ts). LEAD-OWNED and frozen after the pre-pass: the
 * route table, the MCP tool names, what routes.ts gets from http.ts, the runtime interface W2 builds, the view functions W1 builds,
 * the describer seam on the agent adapters, and the not-built runtime.
 *
 * RULES (decisions «understand» 1–8; verify C1–C12 win over the plan):
 * - OPEN, no owner-only route (ADR-0036): any credential that may observe reads status, shots and notes; any credential that may edit
 *   starts or joins the project's job and changes the settings. Notes are NOT withheld from agents in any mode (decision 6, C8).
 *   Choosing which CONNECTED provider describes is a setting; connecting a provider (its key, its address) stays the agent track's
 *   floor (agent/routes.ts, FLOOR_SITES C9b) — nothing here reads or stores a key.
 * - THE DESCRIBER is the agent track's adapter (decision 1, C1): `providers.resolve(providerId, model)` (agent/providers.ts) gives the
 *   adapter, endpoint, key and model row; one `adapter.turn({system: DESCRIBE_SYSTEM, messages: [{role:'user', text, images}],
 *   tools: [], maxOutputTokens: UNDERSTAND_LIMITS.replyMaxTokens, cache: false, parallelToolCalls: false})` per span (1–4 frames in
 *   ONE request); no `temperature`; usage → one ledger row per call (agent/ledger.ts reserveModelCall / settleModelCall /
 *   releaseModelCall / markModelCallUnknown with modelCallLedgerId(jobId, n)); an adapter whose family is 'mock-scripted' (the
 *   labelled test double) makes the producer's describer 'TEST-DOUBLE-describer'.
 * - THE JOB (type `understand`, one open per project, W2): its work list is COMPUTED (picture assets without a complete footage_notes
 *   row for the current producer, C6); started from the IMPORT COMMIT (a store `revision` event whose ops hold import_asset, or the
 *   import queue's completion) when settings.auto is on (decision 4), never from the `derivative` event; waits for the proxy inside
 *   the job; shots measured with analysis.ts detectScenes on the proxy with the proxy's own probed start (C3) under `heavy`, one at
 *   a time, a 429 busy retried; a hand-edited scenes record is never overwritten (re-checked right before the commit); ALL shots
 *   of a pass in ONE commit of N attach_analysis ops, and ALL pointers of a pass in ONE attach_footage_notes, actor UNDERSTAND_ACTOR
 *   for automatic runs, the caller's actor otherwise (C7). Key frames from the proxy (C4: frameSource, `scale=…:flags=bilinear,
 *   format=yuvj420p -c:v mjpeg -q:v 3 -f image2pipe`, split on SOI/EOI, delivered = asked or decode_failed); photos: the original.
 *   Before each call `lane.waitForExportIdle`, then the lane is held as `${UNDERSTAND_LANE_PREFIX}${projectId}` for that call only.
 *   Each validated span → footage_note_spans at once (resume keyed by key frames, C12); a crash re-sends at most the span in flight,
 *   its first cost recorded unknown. Cancel stops at a span boundary and attaches nothing.
 * - Text from media and model replies is data, not instructions (said in every tool description).
 */
import type { Context, Hono } from 'hono';
import type { AgentTurnResponse } from '@pulseframe/providers';
import { UNDERSTAND_API, type DescriberKind, type NotesQuery, type NotesPage, type ProjectDocument, type ShotsPage, type ShotsQuery, type StartUnderstandAnswer, type StartUnderstandBody, type UnderstandApiKey, type UnderstandDescriberView, type UnderstandSettings, type UnderstandSettingsBody, type UnderstandStatusAnswer } from '@pulseframe/core';
import type { Scope } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Derivatives } from '../derive.ts';
import type { Governance, Principal } from '../governance.ts';
import type { FifoComputeLane } from '../lane.ts';
import type { AgentProvidersService } from '../agent/providers.ts';
import type { AgentProviders } from '../agent/contract.ts';
import { ApiError, type Store } from '../store.ts';

const P = '/api/v1/projects/:id';
/** Every understand route, as Hono registers it (peopleSurfaces.ts classifies each; openapi.ts documents each). */
export const UNDERSTAND_ROUTES = [
  `GET ${P}/understand`,
  `POST ${P}/understand`,
  `GET ${P}/assets/:assetId/shots`,
  `GET ${P}/assets/:assetId/notes`,
  'GET /api/v1/understand/settings',
  'PUT /api/v1/understand/settings',
] as const;
/** The MCP tools of this track (registered in mcp.ts by the pre-pass; peopleSurfaces.ts classifies each). find_in_footage gains the notes section. */
export const UNDERSTAND_MCP_TOOLS = ['get_shots', 'describe_clip', 'understand_footage'] as const;

/** One describe call: 1–4 JPEG frames of one span with their labels («frame 2 of 3, 00:12.4»), in time order. */
export interface DescribeFrame { jpeg: Uint8Array; label: string }
/** A describer for one job pass, built from the agent providers (W2 understand/describer.ts). */
export interface Describer {
  kind: DescriberKind;
  providerId: string;
  model: string;
  /** a local server (preset.local): 1 frame per span by default, nothing leaves the machine */
  local: boolean;
  framesPerSpan: number;
  /** ONE adapter.turn; the raw answer (text, finish, usage) — validated by core validateDescribeReply before anything is stored */
  describe(frames: readonly DescribeFrame[], signal: AbortSignal): Promise<AgentTurnResponse>;
}

/** What W2's runtime is built from (index.ts passes it; tests pass labelled doubles through `providers` built with MOCK adapters). */
export interface UnderstandDeps {
  cfg: Config; store: Store; gov: Governance; lane: FifoComputeLane;
  derivatives: Pick<Derivatives, 'get' | 'ensure'>;
  /** the agent track's providers (agent/providers.ts createAgentProviders, the SAME instance the agent loop uses): resolve, and the
   *  merged model table (vision rows) when the instance has it (a test's bare AgentProviders may not: then no row is known) */
  providers: AgentProviders & Partial<Pick<AgentProvidersService, 'models'>>;
  /** the owner-wide agents' budget (autonomy.ts agentBudgetCents), read per call; null = none */
  ownerBudgetCents?: () => number | null;
}
/** W2 builds the real runtime (understand/runtime.ts + job.ts + keyframes.ts + shots.ts + describer.ts + testDescriber.ts). */
export interface UnderstandRuntime {
  /** GET …/understand: the describer's state, the settings, per-asset states, the open job */
  status(p: Principal, projectId: string, doc: ProjectDocument): Promise<UnderstandStatusAnswer>;
  /** POST …/understand (202): start the project's job, or join the open one (409 understand_in_progress only for other settings) */
  start(p: Principal, projectId: string, body: StartUnderstandBody): Promise<StartUnderstandAnswer>;
  /** POST /jobs/:jobId/cancel and MCP cancel_job for type `understand` (http.ts / mcp.ts dispatch line) */
  cancel(p: Principal, jobId: string): { jobId: string; status: string; outcome: string };
  settings(): { settings: UnderstandSettings; describer: UnderstandDescriberView };
  setSettings(p: Principal, body: UnderstandSettingsBody): { settings: UnderstandSettings; describer: UnderstandDescriberView };
  /** restart recovery (index.ts): running jobs continue; rows already described are not sent again */
  recover(): number;
  stop(): Promise<void>;
}

/**
 * The read side, W1 (understand/view.ts): GET …/shots, GET …/notes, get_shots, describe_clip, and the notes the search section reads.
 * Pure over the reader document and the footage_notes table (notesDb.ts); no job, no model.
 */
export interface UnderstandView {
  shots(doc: ProjectDocument, assetId: string, q: ShotsQuery): ShotsPage;
  notes(doc: ProjectDocument, assetId: string, q: NotesQuery, defaultLang: 'he' | 'en'): NotesPage;
}

export type UnderstandEnv = { Variables: { principal: Principal } };
export type UnderstandApp = Hono<UnderstandEnv>;
/** What routes.ts gets from http.ts (one-line delegation; no builder edits http.ts). */
export interface UnderstandRouteDeps {
  store: Store; gov: Governance;
  need: (c: Context<UnderstandEnv>, scope: Scope) => Principal;
  /** absent = the not-built runtime */
  runtime?: UnderstandRuntime;
}

/** An understand route's error from the core UNDERSTAND_API table. */
export function understandError(key: UnderstandApiKey, details: Record<string, unknown> = {}): ApiError {
  const r = UNDERSTAND_API[key];
  return new ApiError(r.status, r.code, r.message, details, r.hint);
}
/** The runtime until W2 lands: every call answers 501 understand_not_built (after the route's checks). */
export const notBuiltUnderstandRuntime: UnderstandRuntime = {
  status: async () => { throw understandError('notBuilt'); },
  start: async () => { throw understandError('notBuilt'); },
  cancel: () => { throw understandError('notBuilt'); },
  settings: () => { throw understandError('notBuilt'); },
  setSettings: () => { throw understandError('notBuilt'); },
  recover: () => 0,
  stop: async () => {},
};
