/**
 * The server side of «קליפ מקוד» (wave 8 motioncode; core madeContract.ts). LEAD-OWNED and frozen after the pre-pass: the route table,
 * the dependencies routes.ts gets, the job runner interface W1 builds and W2's routes call, and the not-built runner.
 *
 * RULES (decisions.md motioncode; verify's last section wins over C1–C11 and the plan):
 * - OPEN: any credential with scope 'edit' that governance lets act ('job', governance.ts assertMayAct; Observe is refused) starts a
 *   render (POST …/made/render) and applies its own result (POST …/apply), committed AS THAT CREDENTIAL with apply_made_clip
 *   (allowInternal): one transaction, undoable, in the history like any edit. No propose step, no owner-only route, no hourly cap.
 * - Capacity only: MADE_LIMITS.activePerCredential (1) and activeTotal (3) answer 429 made_busy with Retry-After; agent jobs yield
 *   the compute lane to the owner's own jobs. While agents are paused, an agent's render is refused (403 made_agents_paused).
 * - Reading: a job's report, stills and file to the owner and to the credential that submitted it; the page of a made asset to any
 *   observer (it holds no more than the typed values of a title).
 * - The page is a blob (Store.putBlob, text/html) named by pageSha256; a pending result lives only in its job row (output:
 *   { fileSha256, pageSha256, record, stills, report }); jobPins (storage.ts) keeps its blobs until it is applied, dismissed, or
 *   7 days after it finished unapplied (W1).
 */
import type { Context, Hono } from 'hono';
import { MADE_API, type ApplyMadeClipOutput, type MadeApplyRequest, type MadeJobReport, type MadeRenderRequest } from '@pulseframe/core';
import type { Principal, Scope } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Governance } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';

const P = '/api/v1/projects/:id';
/** Every made route, as Hono registers it (peopleSurfaces.ts classifies each; openapi.ts documents each). */
export const MADE_ROUTES = [
  'GET /api/v1/made/templates',
  `POST ${P}/made/render`,
  `GET ${P}/made/jobs/:jobId`,
  `GET ${P}/made/jobs/:jobId/still/:index`,
  `GET ${P}/made/jobs/:jobId/file`,
  `POST ${P}/made/jobs/:jobId/apply`,
  `POST ${P}/made/jobs/:jobId/dismiss`,
  `GET ${P}/made/assets/:assetId/page`,
] as const;
/** The MCP tools of this track (W2 builds them in mcp.ts; peopleSurfaces.ts classifies each). */
export const MADE_MCP_TOOLS = ['submit_made_clip', 'view_made_clip'] as const;
/** The MCP resource with the page contract (W2, mcpResources.ts). */
export const MADE_MCP_RESOURCE = 'pulseframe://made/contract' as const;

export type MadeEnv = { Variables: { principal: Principal } };
export type MadeApp = Hono<MadeEnv>;
/** What routes.ts gets from http.ts (one-line delegation; no builder edits http.ts). */
export interface MadeRouteDeps {
  cfg: Config; store: Store; gov: Governance;
  need: (c: Context<MadeEnv>, scope: Scope) => Principal;
  /** absent = the not-built runner */
  runner?: MadeRunner;
}

/** W1 builds the real runner (made/job.ts: harness, encode, validate, durable job `made.render` on the compute lane). */
export interface MadeRunner {
  /** Start a render for a validated request; the page text is already resolved (built-in page or pasted). Returns the job id. */
  start(p: Principal, projectId: string, req: MadeRenderRequest, page: { text: string; sha256: string; templateId?: string; templateVersion?: number }): Promise<{ jobId: string }>;
  report(p: Principal, projectId: string, jobId: string): MadeJobReport;
  still(p: Principal, projectId: string, jobId: string, index: 0 | 1 | 2): { png: Buffer };
  file(p: Principal, projectId: string, jobId: string): { path: string; bytes: number };
  /** commits apply_made_clip as `p` in one transaction (W2 builds the op body; W1 the asset from the job output) */
  apply(p: Principal, projectId: string, jobId: string, req: MadeApplyRequest): Promise<{ revision: number; output: ApplyMadeClipOutput }>;
  dismiss(p: Principal, projectId: string, jobId: string): void;
  /** the job type's cancel and restart recovery are wired in index.ts (append only) */
}

/** A made route's error from the MADE_API table. */
export function madeError(key: keyof typeof MADE_API, details: Record<string, unknown> = {}): ApiError {
  const r = MADE_API[key];
  return new ApiError(r.status, r.code, r.message, details, r.hint);
}
/** The runner until W1 lands: every call answers 501 made_not_built (after the route's scope and project checks). */
export const notBuiltMadeRunner: MadeRunner = {
  start: async () => { throw madeError('notBuilt'); },
  report: () => { throw madeError('notBuilt'); },
  still: () => { throw madeError('notBuilt'); },
  file: () => { throw madeError('notBuilt'); },
  apply: async () => { throw madeError('notBuilt'); },
  dismiss: () => { throw madeError('notBuilt'); },
};
