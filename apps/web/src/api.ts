import type { Asset, OpCall, ProjectDocument } from '@pulseframe/core';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public hint?: string) {
    super(message);
  }
}
/**
 * The owner link printed by the server carries `?key=…`. It is sent once to obtain the session cookie and then removed
 * from the address bar, so it does not linger in the visible URL or get copied by accident.
 */
export function ownerKeyHeader(): Record<string, string> {
  const url = new URL(location.href);
  const key = url.searchParams.get('key');
  if (!key) return {};
  url.searchParams.delete('key');
  history.replaceState(null, '', url);
  return { 'x-pf-owner-key': key };
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

export interface ProjectListItem { id: string; name: string; revision: number; updatedAt?: string }
export interface StorageReport { projects: number; databaseBytes: number; media: { files: number; bytes: number }; exportsBytes: number; totalBytes: number; quotaBytes: number | null; unreferenced: { files: number; bytes: number; tooNewToJudge?: number }; rule: string }
export interface GcResult { applied: boolean; wouldRemove?: { files: number; bytes: number }; removed?: { files: number; bytes: number }; note?: string }
export type GrantMode = 'observe' | 'propose' | 'edit' | 'autopilot';
export interface GrantItem { id: string; name: string; mode: GrantMode; projectIds: string[] | null; trackIds: string[] | null; range: unknown; budgetCents: number; requestsPerMinute?: number | null; exportsPerDay?: number | null; expiresAt: string | null; revokedAt: string | null; createdAt: string }

export interface SpeechStatus {
  narration: { ready: boolean; reason: 'engine_not_configured' | 'engine_not_working' | 'model_missing' | null; detail: string; device: 'cpu' | 'cuda' | null; maxCharacters: number };
  transcription: { ready: boolean; reason: 'engine_not_configured' | 'engine_not_working' | 'model_missing' | null; detail: string; device: 'cpu' | 'cuda' | null };
  engine: { configured: boolean; ok: boolean; detail: string };
  models: { id: string; kind: 'asr' | 'tts'; title: { he: string; en: string }; license: string | null; totalBytes: number; missingDownloadBytes: number; ready: boolean }[];
}
export interface SoundEffectInfo { id: string; version: number; name: { he: string; en: string }; seconds: number; category: string }
export const api = {
  listProjectsFull: () => call<{ projects: ProjectListItem[] }>('/projects'),
  deleteProject: (id: string, confirmName: string) => call<unknown>(`/projects/${encodeURIComponent(id)}/delete`, json({ confirmName })),
  storage: () => call<StorageReport>('/storage'),
  backup: () => call<BackupStatus>('/backup'),
  backupNow: () => call<BackupStatus>('/backup', json({})),
  storageGc: (apply: boolean) => call<GcResult>('/storage/gc', json(apply ? { apply: true } : {})),
  listGrants: () => call<{ grants: GrantItem[] }>('/grants'),
  createGrant: (body: { name: string; mode: GrantMode; projectIds?: string[]; budgetCents?: number; requestsPerMinute?: number; exportsPerDay?: number }) => call<{ grant: GrantItem; token: string }>('/grants', json(body)),
  revokeGrant: (id: string) => call<{ grant: GrantItem }>(`/grants/${encodeURIComponent(id)}/revoke`, json({})),
  analyzeAsset: (id: string, assetId: string, body: { kind: 'scenes' | 'beats'; threshold?: number }) =>
    call<AnalyzeResult>(`/projects/${id}/assets/${assetId}/analyze`, json(body)),
  /** The same analysis as a background job (long media cannot time out a request). Resolves when the job has finished; a failed job rejects with its typed error. */
  analyzeAssetJob: async (id: string, assetId: string, body: { kind: 'scenes' | 'beats'; threshold?: number }, onJob?: (jobId: string) => void) => {
    const { jobId } = await call<{ jobId: string; status: string }>(`/projects/${id}/assets/${assetId}/analyze`, json({ ...body, background: true }));
    onJob?.(jobId);
    for (;;) {
      const j = await call<{ status: string; error?: { code?: string; message?: string } | null }>(`/jobs/${jobId}`);
      if (j.status === 'succeeded') return;
      if (j.status === 'failed' || j.status === 'canceled') throw new ApiFailure(409, j.error?.code ?? j.status, j.error?.message ?? `analysis ${j.status}`);
      await new Promise((r) => setTimeout(r, 400));
    }
  },
  session: () => call<{ actor: string }>('/session', { headers: ownerKeyHeader() }),
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
  findFillers: (id: string, body: { assetId: string; words?: string[] }) => call<SilenceResult & { words: { kind: 'hesitation' | 'repeat' | 'listed'; text: string; sourceStartSeconds: number; onTimeline: { startSeconds: number }[] }[] }>(`/projects/${id}/analysis/fillers`, json(body)),
  measureLoudness: (id: string) => call<LoudnessResult>(`/projects/${id}/analysis/loudness`, json({})),
  capabilities: () => call<{ provider: { configured: boolean; reason: string | null; readiness: { reachable: boolean; runtimeVersion: string | null; device: { name: string; type: string } | null } | null }; capabilities: { id: string; runnable: boolean; title: { he: string; en: string } }[] }>('/capabilities'),
  runCapability: (id: string, capabilityId: string, params: Record<string, unknown>) => call<{ jobId: string }>(`/projects/${id}/capabilities/${capabilityId}/runs`, json({ params, idempotencyKey: crypto.randomUUID() })),
  derivatives: (id: string, assetId: string) => call<{ derivatives: { kind: string; status: string; meta: any }[] }>(`/projects/${id}/assets/${assetId}/derivatives`),
  presence: (id: string, sessionId: string, frame: number, selection: string[]) => call<unknown>(`/projects/${id}/presence`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, frame, selection }) }),
  speech: () => call<SpeechStatus>('/speech'),
  downloadSpeechModel: (id: string, modelId: string, confirmBytes: number) => call<{ jobId: string }>(`/projects/${id}/speech/models/${encodeURIComponent(modelId)}/download`, json({ confirmBytes })),
  transcribe: (id: string, assetId: string, body: { language: string; overwrite?: boolean; mode?: 'recognise' | 'align' }) => call<{ jobId: string }>(`/projects/${id}/assets/${assetId}/transcribe`, json(body)),
  transcribeAll: (id: string, language: string) => call<{ jobs: { assetId: string; jobId: string }[]; alreadyQueued: number }>(`/projects/${id}/transcribe`, json({ language })),
  narrate: (id: string, body: { text: string; language: string; start?: unknown; referenceAssetId?: string; consent?: { speaker: string; confirmed: true } }) => call<{ jobId: string }>(`/projects/${id}/narration`, json(body)),
  narrateScript: (id: string, body: { text: string; language: string; start: unknown; referenceAssetId?: string; consent?: { speaker: string; confirmed: true } }) => call<{ sentences: string[]; jobs: { jobId: string }[] }>(`/projects/${id}/narration/script`, json(body)),
  cancelJob: (jobId: string) => call<{ status: string; outcome: string }>(`/jobs/${jobId}/cancel`, json({})),
  retryJob: (jobId: string) => call<{ jobId: string }>(`/jobs/${jobId}/retry`, json({})),
  controls: (id: string) => call<{ agentsPaused: boolean }>(`/projects/${id}/controls`),
  setPaused: (id: string, paused: boolean) => call<{ agentsPaused: boolean }>(`/projects/${id}/agents/${paused ? 'pause' : 'resume'}`, json({})),
  approvals: (id: string) => call<{ approvals: Approval[] }>(`/projects/${id}/approvals`),
  decideApproval: (id: string, approvalId: string, decision: 'approve' | 'reject') => call<{ approval: Approval; jobId?: string }>(`/projects/${id}/approvals/${approvalId}/${decision}`, json({})),
  proposals: (id: string) => call<{ proposals: Proposal[] }>(`/projects/${id}/proposals?status=open`),
  decideProposal: (id: string, proposalId: string, decision: 'accept' | 'reject') => call<{ proposal: Proposal }>(`/projects/${id}/proposals/${proposalId}/${decision}`, json({})),
  startExport: (id: string, options?: { variantId?: string }) => call<{ jobId: string }>(`/projects/${id}/exports`, options ? json(options) : { method: 'POST' }),
  exportBatch: (id: string, variantIds: string[]) => call<{ jobs: { jobId: string; variantId: string; status: string }[] }>(`/projects/${id}/exports/batch`, json({ variantIds })),
  job: (jobId: string) => call<JobEvent & { status: string }>(`/jobs/${jobId}`),
  preflight: (id: string, variantId: string | null) => call<PreflightReport>(`/projects/${id}/preflight${variantId ? `?variant=${encodeURIComponent(variantId)}` : ''}`),
  planRecipe: (id: string, recipeId: string, params: RecipeParams) => call<RecipePlanResult>(`/projects/${id}/recipes/${recipeId}/plan`, json({ params })),
  applyRecipe: (id: string, recipeId: string, params: RecipeParams) => call<RecipeApplyResult>(`/projects/${id}/recipes/${recipeId}/apply`, json({ params })),
  regenerateRecipeRun: (id: string, runId: string, params?: RecipeParams) => call<RecipeRegenerateResult>(`/projects/${id}/recipe-runs/${runId}/regenerate`, json(params ? { params } : {})),
  soundEffects: async () => (await call<{ soundEffects: SoundEffectInfo[] }>('/catalog')).soundEffects,
  soundEffectAudio: async (id: string) => {
    const r = await fetch(`/api/v1/sfx/${encodeURIComponent(id)}/audio`, { credentials: 'same-origin' });
    if (!r.ok) throw new ApiFailure(r.status, 'sfx_fetch_failed', `HTTP ${r.status}`);
    return r.blob();
  },
  addSoundEffect: (id: string, body: { sfxId: string; start?: unknown; trackId?: string }) => call<{ assetId: string; revision: number; placed: unknown }>(`/projects/${id}/sfx`, json(body)),
  events: (id: string, since: number) => new EventSource(`/api/v1/projects/${id}/events?since=${since}`, { withCredentials: true }),
};

export interface BackupStatus { enabled: boolean; everyHours: number; keep: number; lastAt: number | null; lastOk: boolean | null; lastError: string | null; nextAt: number | null; snapshots: number; running: boolean }

/** A request by an agent that only the owner can decide (for example downloading model files). */
export interface Approval { id: string; kind: string; action: { capabilityId?: string; bytes?: number; models?: { path: string }[] } & Record<string, unknown>; costCents: number; requestedBy: string; status: 'pending' | 'approved' | 'consumed' | 'rejected' | 'expired'; expiresAt: string; createdAt: string }
