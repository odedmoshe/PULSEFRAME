import type { Asset, BuildShortsBody, ExportMode, FindShortsBody, ReframePlanBody, ReframePlanView, SequenceSummary, ShortCandidatesView, ShortsApplyResult, ShortsPlanView, FamilyFilmApplyResult, FamilyFilmParams, FamilyFilmPlanView, FamilyFilmRegenerateResult, MomentsData, OpCall, ProjectDocument, RenderCacheStatus, SegmentPlanView, SelfCheckMode, StartMomentsBody } from '@pulseframe/core';
import type { MulticamSyncReport, MulticamSyncRequest, MulticamView } from '@pulseframe/core';
import type { TakePlanView, TakeRequest, TakeResult } from '@pulseframe/core';
import type { GradeFit, GradeParams, PictureStats, VoiceMeasurement } from '@pulseframe/engine';
import type { RationalTime } from '@pulseframe/time';

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
export interface CommitResult { revision: number; committed: boolean; /** the transaction this commit made (null when nothing changed): undo names it to reverse exactly this edit */ transactionId?: string | null; summary: string; affectedIds: string[]; results: { op: string; output?: Record<string, any> }[] }
export interface SilenceResult { revision: number; candidates: { start: unknown; end: unknown; startSeconds: number; seconds: number }[]; removableSeconds: number; ops: OpCall[]; note?: string }
/** measure_voice (ADR-0013; apps/server/src/voiceClean.ts): the same shapes as the server's VoiceMeasureBody and VoiceCheck. */
export interface VoiceMeasureRequest { clipId: string; strength?: number; /** SOURCE-time stretches that hold only noise */ noiseRanges?: { start: RationalTime; end: RationalTime }[]; scope?: 'clip' | 'asset' }
export interface VoiceCheck { revision: number; assetId: string; clipIds: string[]; method: string; /** ranges in source seconds */ report: VoiceMeasurement; recommendedStrength: number; /** clean_voice candidates: send as ONE transaction */ ops: OpCall[]; note: string }
/** match_colour (ADR-0014; apps/server/src/colourMatch.ts): the same shapes as the server's ColourMatchBody and ColourMatch. */
export interface ColourMatchRequest { method?: 'match' | 'balance'; referenceClipId?: string; targetClipIds: string[] | 'all'; amount?: number; samples?: 1 | 3 }
export interface ColourMatchTarget { clipId: string; params: GradeParams; residual: { model: number; verified: number | null }; verdict: GradeFit['verdict']; limitedBy: (keyof GradeParams)[]; warnings: ('changes_within_clip' | 'not_verified' | 'replaces_grade' | 'animated_grade')[]; statsBefore: PictureStats; statsAfter: PictureStats | null }
export interface ColourMatch { revision: number; method: 'match' | 'balance'; reference: { clipId: string; stats: PictureStats } | null; targets: ColourMatchTarget[]; /** set_colour_grade candidates: send as ONE transaction */ ops: OpCall[]; unavailable: string | null; note: string }
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
export interface StorageReport { projects: number; databaseBytes: number; media: { files: number; bytes: number }; exportsBytes: number; totalBytes: number; quotaBytes: number | null; unreferenced: { files: number; bytes: number; tooNewToJudge?: number }; rule: string; /** Present when the render cache is wired (ADR-0024). */ renderCache?: RenderCacheStatus }
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
  // render cache (ADR-0024): the owner's size row and «ניקוי מטמון הרינדור»; the routes are mounted by the lead's wiring (renderCacheRoutes.ts)
  renderCache: () => call<RenderCacheStatus>('/storage/render-cache'),
  clearRenderCache: () => call<{ removed: number; bytes: number; keptPinned: number }>('/storage/render-cache', { method: 'DELETE' }),
  /** What a fast export of these options would reuse and render (the sheet line and the timeline lane); aborted when a newer revision asks. */
  planSegments: (id: string, options: object, signal?: AbortSignal) => call<SegmentPlanView>(`/projects/${id}/exports/segments/plan`, { ...json(options), ...(signal ? { signal } : {}) }),
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
  /** Without `transactionId` the server reverses the caller's own newest edit; with it, exactly that transaction (the owner may name an agent's). */
  undo: (id: string, mode: 'undo' | 'redo', transactionId?: string) => call<CommitResult>(`/projects/${id}/${mode}`, json(transactionId ? { transactionId } : {})),
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
  /** The programme loudness of the main edit, or of one sequence (a short) with `sequenceId`. */
  measureLoudness: (id: string, sequenceId?: string) => call<LoudnessResult>(`/projects/${id}/analysis/loudness`, json(sequenceId ? { sequenceId } : {})),
  measureVoice: (id: string, body: VoiceMeasureRequest) => call<VoiceCheck>(`/projects/${id}/analysis/voice`, json(body)),
  /** The same measurement as a durable job (its output is { kind: 'voice', result: VoiceCheck }). */
  startVoiceMeasureJob: (id: string, body: VoiceMeasureRequest) => call<{ jobId: string; status: string }>(`/projects/${id}/analysis/voice`, json({ ...body, background: true })),
  matchColour: (id: string, body: ColourMatchRequest) => call<ColourMatch>(`/projects/${id}/analysis/colour-match`, json(body)),
  /** The same match as a durable job (its output is { kind: 'colour', result: ColourMatch }). */
  startColourMatchJob: (id: string, body: ColourMatchRequest) => call<{ jobId: string; status: string }>(`/projects/${id}/analysis/colour-match`, json({ ...body, background: true })),
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
  startExport: (id: string, options?: { variantId?: string; sequenceId?: string; format?: string; frame?: number; mode?: ExportMode; selfCheck?: SelfCheckMode }) => call<{ jobId: string }>(`/projects/${id}/exports`, options ? json(options) : { method: 'POST' }),
  exportBatch: (id: string, variantIds: string[]) => call<{ jobs: { jobId: string; variantId: string; status: string }[] }>(`/projects/${id}/exports/batch`, json({ variantIds })),
  /** One export job per sequence (shorts), all or nothing. */
  exportSequences: (id: string, sequenceIds: string[], options?: { format?: string }) => call<{ jobs: { jobId: string; sequenceId?: string; status: string }[] }>(`/projects/${id}/exports/batch`, json({ items: sequenceIds.map((sequenceId) => ({ sequenceId })), ...(options ? { options } : {}) })),
  // ----- perform mode (ADR-0025): a take's raw taps, planned on the server and committed as ONE undoable step (dryRun: plan only) -----
  performTake: (id: string, body: TakeRequest) => call<TakeResult | TakePlanView>(`/projects/${id}/takes`, json(body)),
  // ----- shorts (ADR-0018): sequences, candidate moments, plan, make, reframe -----
  sequences: (id: string) => call<{ revision: number; sequences: SequenceSummary[] }>(`/projects/${id}/sequences`),
  /** The ranked candidates when the audio is already measured (200), else a measuring job to poll (202). */
  findShorts: (id: string, body: Partial<FindShortsBody> & { assetId: string }) => call<ShortCandidatesView | { jobId: string; status: string }>(`/projects/${id}/shorts/candidates`, json(body)),
  planShorts: (id: string, body: Partial<BuildShortsBody>) => call<ShortsPlanView>(`/projects/${id}/shorts/plan`, json(body)),
  /** Makes the shorts as ONE undoable step. */
  makeShorts: (id: string, body: Partial<BuildShortsBody>) => call<ShortsApplyResult>(`/projects/${id}/shorts`, json(body)),
  planReframe: (id: string, sequenceId: string, body: Partial<ReframePlanBody>) => call<ReframePlanView>(`/projects/${id}/sequences/${encodeURIComponent(sequenceId)}/reframe-plan`, json(body)),
  job: (jobId: string) => call<JobEvent & { status: string; /** an export's stored options (POST /exports body) */ options?: { variantId?: string; format?: string; scale?: number; quality?: string; captions?: string } }>(`/jobs/${jobId}`),
  preflight: (id: string, variantId: string | null, sequenceId?: string | null) => {
    const q = [variantId ? `variant=${encodeURIComponent(variantId)}` : '', sequenceId ? `sequence=${encodeURIComponent(sequenceId)}` : ''].filter(Boolean).join('&');
    return call<PreflightReport>(`/projects/${id}/preflight${q ? `?${q}` : ''}`);
  },
  planRecipe: (id: string, recipeId: string, params: RecipeParams) => call<RecipePlanResult>(`/projects/${id}/recipes/${recipeId}/plan`, json({ params })),
  applyRecipe: (id: string, recipeId: string, params: RecipeParams) => call<RecipeApplyResult>(`/projects/${id}/recipes/${recipeId}/apply`, json({ params })),
  regenerateRecipeRun: (id: string, runId: string, params?: RecipeParams) => call<RecipeRegenerateResult>(`/projects/${id}/recipe-runs/${runId}/regenerate`, json(params ? { params } : {})),
  soundEffects: async () => (await call<{ soundEffects: SoundEffectInfo[] }>('/catalog')).soundEffects,
  soundEffectAudio: async (id: string) => {
    const r = await fetch(`/api/v1/sfx/${encodeURIComponent(id)}/audio`, { credentials: 'same-origin' });
    if (!r.ok) throw new ApiFailure(r.status, 'sfx_fetch_failed', `HTTP ${r.status}`);
    return r.blob();
  },
  addElement: (id: string, body: { elementId: string; color?: string; color2?: string; start?: unknown; duration?: unknown; trackId?: string }) => call<{ assetId: string; revision: number; placed: unknown }>(`/projects/${id}/elements`, json(body)),
  addSoundEffect: (id: string, body: { sfxId: string; start?: unknown; trackId?: string }) => call<{ assetId: string; revision: number; placed: unknown }>(`/projects/${id}/sfx`, json(body)),
  events: (id: string, since: number) => new EventSource(`/api/v1/projects/${id}/events?since=${since}`, { withCredentials: true }),
  // ----- the family film (ADR-0026): measured moments and the film recipe -----
  /** Start measuring moments (202 → job; poll it as any job, cancel with cancelJob), or { cached: true } when every file already has a current measurement. */
  measureMoments: (projectId: string, body: StartMomentsBody) => call<{ jobId: string; status: string } | { cached: true; revision: number }>(`/projects/${projectId}/moments`, json(body)),
  /** The per-sample series of one file (the derivative of kind moments); 404 derivative_not_ready until it is measured. */
  momentsData: (projectId: string, assetId: string) => call<MomentsData>(`/projects/${projectId}/assets/${assetId}/derivatives/moments`),
  planFilm: (projectId: string, params: FamilyFilmParams) => call<FamilyFilmPlanView>(`/projects/${projectId}/recipes/family-film/plan`, json({ params })),
  applyFilm: (projectId: string, params: FamilyFilmParams, expectedRevision: number) => call<FamilyFilmApplyResult>(`/projects/${projectId}/recipes/family-film/apply`, json({ params, expectedRevision })),
  /** Regenerate a film run (from this tab's filmRun or the document's run after a reload) with changed parameters. */
  regenerateFilm: (projectId: string, runId: string, params?: Partial<FamilyFilmParams>) => call<FamilyFilmRegenerateResult>(`/projects/${projectId}/recipe-runs/${runId}/regenerate`, json(params ? { params } : {})),
  // ----- multicam (ADR-0020): the routes of core multicamApi.ts -----
  /** The group's view: coverage, program tracks, out-of-sync segments, envelope states and capture-time priors. */
  multicamView: (id: string, groupId: string) => call<MulticamView>(`/projects/${id}/multicam/${encodeURIComponent(groupId)}`),
  /** Sync by sound. Without `background` the report (200); with it a durable job to poll (202). A hand-synced file measured again without `overwrite` answers 409 would_discard_edits. */
  multicamSync: (id: string, groupId: string, body: MulticamSyncRequest = {}) => call<MulticamSyncReport | { jobId: string; status: string }>(`/projects/${id}/multicam/${encodeURIComponent(groupId)}/sync`, json(body)),
  /** Build (on demand) the level envelope of a file; its bytes come from envelopeBytes. */
  buildEnvelope: (id: string, assetId: string) => call<{ kind: string; status: string }>(`/projects/${id}/assets/${assetId}/derivatives/envelope`, { method: 'POST' }),
  envelopeBytes: async (id: string, assetId: string): Promise<Uint8Array | null> => {
    const r = await fetch(`/api/v1/projects/${id}/assets/${assetId}/derivatives/envelope`, { credentials: 'same-origin' });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  },
};

export interface BackupStatus { enabled: boolean; everyHours: number; keep: number; lastAt: number | null; lastOk: boolean | null; lastError: string | null; nextAt: number | null; snapshots: number; running: boolean }

/** A request by an agent that only the owner can decide (for example downloading model files). */
export interface Approval { id: string; kind: string; action: { capabilityId?: string; bytes?: number; models?: { path: string }[] } & Record<string, unknown>; costCents: number; requestedBy: string; status: 'pending' | 'approved' | 'consumed' | 'rejected' | 'expired'; expiresAt: string; createdAt: string }
