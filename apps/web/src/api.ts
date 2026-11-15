import type { Asset, OpCall, ProjectDocument } from '@pulseframe/core';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public hint?: string) {
    super(message);
  }
}
async function call<R>(path: string, init?: RequestInit): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export interface RevisionEvent { projectId: string; revision: number; transactionId: string; actor: string; label: string | null; summary: string; affectedIds: string[]; at: string; kind?: string; ops?: string[] }
export interface Proposal { id: string; actor: string; label: string | null; summary: string; status: string; baseRevision: number; createdAt: string; previewFrame: number }
export interface JobEvent { id: string; type: string; status: string; stage: string | null; output: any; error: any }
export interface PreflightIssue { code: string; severity: 'blocker' | 'warning' | 'note'; message: string; ids: string[]; range?: { startFrame: number; endFrame: number }; fix?: { label: string; ops: OpCall[] } }
export interface PreflightReport { revision: number; ok: boolean; blockers: number; warnings: number; notes: number; issues: PreflightIssue[]; output: unknown; scope: string }
export interface CommitResult { revision: number; committed: boolean; summary: string; affectedIds: string[]; results: { op: string; output?: Record<string, any> }[] }
export interface SilenceResult { revision: number; candidates: { start: unknown; end: unknown; startSeconds: number; seconds: number }[]; removableSeconds: number; ops: OpCall[]; note?: string }
export interface LoudnessResult { integratedLufs: number | null; truePeakDbtp: number | null; rangeLu: number | null; mixPeakDbfs: number | null; wouldClipWithoutNormalisation: boolean; target: number | null; exportWouldApplyGainDb: number | null; limitedByPeak: boolean; method: string; note?: string }

export type RecipeParams = Record<string, unknown>;
export interface RecipeAlternative { label: string; params: RecipeParams }
export interface RecipePlanResult { revision: number; steps: string[]; basis: string[]; operations?: unknown; alternatives: RecipeAlternative[]; method?: string; note?: string }
export interface RecipeApplyResult { revision: number; runId: string; createdIds: string[]; steps: string[]; basis: string[]; alternatives: RecipeAlternative[] }
export interface RecipeRegenerateResult { revision: number; runId: string; replaced: number; protected: string[]; steps: string[] }

export interface AnalyzeResult{ revision: number; summary: string; scenes?: { count: number }; beats?: { bpm: number | null; confidence: number | null; count: number } }

const SNAP_BEATS_KEY = 'pf.snap.beats.v1';
/** Personal setting (default on), never stored in the project. */
export function readSnapBeats(): boolean {
  try { return globalThis.localStorage?.getItem(SNAP_BEATS_KEY) !== '0'; } catch { return true; }
}
export function writeSnapBeats(on: boolean): void {
  try { globalThis.localStorage?.setItem(SNAP_BEATS_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

export const api = {
  analyzeAsset: (id: string, assetId: string, body: { kind: 'scenes' | 'beats'; threshold?: number }) =>
    call<AnalyzeResult>(`/projects/${id}/assets/${assetId}/analyze`, json(body)),
  session: () => call<{ actor: string }>('/session'),
  listProjects: () => call<{ projects: { id: string; name: string; revision: number }[] }>('/projects'),
  createProject: (name: string) => call<{ project: ProjectDocument; revision: number }>('/projects', json({ name })),
  getProject: (id: string) => call<{ project: ProjectDocument; revision: number }>(`/projects/${id}`),
  history: (id: string) => call<{ events: RevisionEvent[] }>(`/projects/${id}/history?since=0`),
  commit: (id: string, baseRevision: number, ops: OpCall[], label?: string) =>
    call<CommitResult>(`/projects/${id}/transactions`, json({ baseRevision, idempotencyKey: crypto.randomUUID(), label, ops })),
  undo: (id: string, mode: 'undo' | 'redo') => call<CommitResult>(`/projects/${id}/${mode}`, json({})),
  upload: (id: string, file: File) =>
    call<{ assetId: string; revision: number; asset: Asset }>(`/projects/${id}/assets`, { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name), 'content-type': 'application/octet-stream' }, body: file }),
  assetBlob: async (id: string, assetId: string) => {
    const r = await fetch(`/api/v1/projects/${id}/assets/${assetId}/content`, { credentials: 'same-origin' });
    if (!r.ok) throw new ApiFailure(r.status, 'asset_fetch_failed', `HTTP ${r.status}`);
    return r.blob();
  },
  findSilences: (id: string, body: { assetId: string; minSeconds: number; keepSeconds: number }) =>
    call<SilenceResult>(`/projects/${id}/analysis/silences`, json(body)),
  measureLoudness: (id: string) => call<LoudnessResult>(`/projects/${id}/analysis/loudness`, json({})),
  capabilities: () => call<{ provider: { configured: boolean; reason: string | null; readiness: { reachable: boolean; runtimeVersion: string | null; device: { name: string; type: string } | null } | null }; capabilities: { id: string; runnable: boolean; title: { he: string; en: string } }[] }>('/capabilities'),
  runCapability: (id: string, capabilityId: string, params: Record<string, unknown>) => call<{ jobId: string }>(`/projects/${id}/capabilities/${capabilityId}/runs`, json({ params, idempotencyKey: crypto.randomUUID() })),
  derivatives: (id: string, assetId: string) => call<{ derivatives: { kind: string; status: string; meta: any }[] }>(`/projects/${id}/assets/${assetId}/derivatives`),
  presence: (id: string, sessionId: string, frame: number, selection: string[]) => call<unknown>(`/projects/${id}/presence`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, frame, selection }) }),
  cancelJob: (jobId: string) => call<{ status: string; outcome: string }>(`/jobs/${jobId}/cancel`, json({})),
  retryJob: (jobId: string) => call<{ jobId: string }>(`/jobs/${jobId}/retry`, json({})),
  controls: (id: string) => call<{ agentsPaused: boolean }>(`/projects/${id}/controls`),
  setPaused: (id: string, paused: boolean) => call<{ agentsPaused: boolean }>(`/projects/${id}/agents/${paused ? 'pause' : 'resume'}`, json({})),
  proposals: (id: string) => call<{ proposals: Proposal[] }>(`/projects/${id}/proposals?status=open`),
  decideProposal: (id: string, proposalId: string, decision: 'accept' | 'reject') => call<{ proposal: Proposal }>(`/projects/${id}/proposals/${proposalId}/${decision}`, json({})),
  startExport: (id: string, options?: { variantId?: string }) => call<{ jobId: string }>(`/projects/${id}/exports`, options ? json(options) : { method: 'POST' }),
  exportBatch: (id: string, variantIds: string[]) => call<{ jobs: { jobId: string; variantId: string; status: string }[] }>(`/projects/${id}/exports/batch`, json({ variantIds })),
  job: (jobId: string) => call<JobEvent & { status: string }>(`/jobs/${jobId}`),
  preflight: (id: string, variantId: string | null) => call<PreflightReport>(`/projects/${id}/preflight${variantId ? `?variant=${encodeURIComponent(variantId)}` : ''}`),
  planRecipe: (id: string, recipeId: string, params: RecipeParams) => call<RecipePlanResult>(`/projects/${id}/recipes/${recipeId}/plan`, json({ params })),
  applyRecipe: (id: string, recipeId: string, params: RecipeParams) => call<RecipeApplyResult>(`/projects/${id}/recipes/${recipeId}/apply`, json({ params })),
  regenerateRecipeRun: (id: string, runId: string, params?: RecipeParams) => call<RecipeRegenerateResult>(`/projects/${id}/recipe-runs/${runId}/regenerate`, json(params ? { params } : {})),
  events: (id: string, since: number) => new EventSource(`/api/v1/projects/${id}/events?since=${since}`, { withCredentials: true }),
};
