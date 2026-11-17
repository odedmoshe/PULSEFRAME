/**
 * The AI-model wave's REST calls and shapes as the editor uses them (ADR-0017). The server's contracts are in
 * apps/server/src/aiContracts.ts; these types repeat the parts the editor reads, so the browser bundle imports no server code.
 * Every run is a durable job the server validates; nothing here makes or fakes a result.
 */
import type { OpCall } from '@pulseframe/core';
import { ApiFailure, type Approval } from '../api.ts';

export type SetupCode = 'ready' | 'provider_not_configured' | 'provider_unreachable' | 'engine_not_configured' | 'engine_not_working'
  | 'engine_unverified' | 'model_missing' | 'licence_blocked' | 'host_not_allowed' | 'disk_insufficient';
export interface SetupState { code: SetupCode; detail: string; hosts?: string[]; missingBytes?: number; freeBytes?: number; device?: string | null; versions?: Record<string, string> }
export interface JobProgress { unit: 'frames' | 'chunks' | 'phrases' | 'samples'; done: number; total: number; basis: 'measured' }
export interface JobEta { seconds: number | null; basis: 'this-run' | 'measured-profile' | 'none' }
export type RunSource = { clipId: string } | { assetId: string; range?: { firstFrame: number; frameCount: number } };
export type ApplyMode = 'library' | 'replace-clip' | 'new-track';
export interface CapabilityEstimate {
  capabilityId: string; setup: SetupState; frames: number | null; chunks: number | null;
  missingDownloadBytes: number; scratchBytes: number; seconds: number | null; basis: 'measured-profile' | 'none';
  needsConfirm: boolean; blockers: { code: string; message: string }[];
}
export interface ModelStatusInfo { state: string; missingBytes: number; expectedBytes: number | null; detail?: string }
export interface CapModel { role?: string; path: string; publisher?: string | null; revision?: string | null; bytes?: number | null; license?: string | null; licenseEvidence?: string | null; commercialUse?: string; source?: string | null; attribution?: string | null; status?: ModelStatusInfo }
export interface CapInput { name: string; label?: { he: string; en: string }; type: string; required: boolean; default?: number | string | boolean; min?: number; max?: number; options?: string[]; allowed?: number[] }
export interface Evidence { status: string; evidence?: string | null }
/** One entry of GET /capabilities. Fields the L0 bridge does not send yet (provider, task, frames, setup) are optional. */
export interface CapInfo {
  id: string; version?: string; provider?: 'comfyui' | 'local'; state?: string; runnable: boolean;
  title: { he: string; en: string }; description?: { he: string; en: string };
  inputs?: CapInput[]; outputs?: { name: string; role: string; mediaType: string; encoding?: string; expectFrames?: string | null }[];
  frames?: { input: string; mode: string; chunkFrames: number; multiplierParam?: string } | null; task?: 'translate' | 'voice-clean' | 'vocals-classic' | null;
  models?: CapModel[]; missingDownloadBytes?: number; limits?: { maxFrames: number | null; maxPixels: number | null }; limitations?: string[];
  qualification?: Record<string, Evidence>; blockers?: { code: string; message: string }[]; setup?: SetupState; experimental?: boolean; openReviews?: string[];
}
/** Where a validated result went (job.output.attachment). */
export interface Attachment {
  status: 'attached' | 'imported' | 'proposed' | 'not-attached';
  mode?: ApplyMode; assetId?: string; clipId?: string; trackId?: string; previousAssetId?: string; variantId?: string;
  reason?: string; error?: string; conflicts?: unknown[];
  /** The placement that was not made (a proposal): { mode, clipId, start?, sourceIn?, duration?, speed? }, or an op for a translation. */
  proposal?: Record<string, unknown>;
}

async function call<R>(path: string, init?: RequestInit): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const enc = encodeURIComponent;

export interface RunBody { params: Record<string, unknown>; source?: RunSource; apply?: ApplyMode; confirmLongRun?: boolean; dependsOn?: string[] }
export const aiApi = {
  estimate: (projectId: string, capabilityId: string, q: { params?: Record<string, unknown>; source?: RunSource }) =>
    call<CapabilityEstimate>(`/projects/${enc(projectId)}/capabilities/${enc(capabilityId)}/estimate?${[q.source ? `source=${enc(JSON.stringify(q.source))}` : '', q.params && Object.keys(q.params).length ? `params=${enc(JSON.stringify(q.params))}` : ''].filter(Boolean).join('&')}`),
  run: (projectId: string, capabilityId: string, body: RunBody) =>
    call<{ jobId: string; status: string }>(`/projects/${enc(projectId)}/capabilities/${enc(capabilityId)}/runs`, post({ ...body, idempotencyKey: crypto.randomUUID() })),
  /** Ask for the model download: an approval the owner decides in the Review tab. Never a download by itself. */
  requestModels: (projectId: string, capabilityId: string) => call<{ approval: Approval }>(`/projects/${enc(projectId)}/capabilities/${enc(capabilityId)}/models/request`, post({})),
  /** The owner's mark on a machine translation (refused for agents by the server). */
  reviewTranslation: (projectId: string, variantId: string, review: 'reviewed' | 'needed') =>
    call<{ revision: number }>(`/projects/${enc(projectId)}/variants/${enc(variantId)}/translation/review`, post({ review })),
  assetUrl: (projectId: string, assetId: string) => `/api/v1/projects/${enc(projectId)}/assets/${enc(assetId)}/content`,
};
export type { OpCall };
