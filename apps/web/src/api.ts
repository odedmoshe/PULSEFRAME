import type { Asset, OpCall, ProjectDocument } from '@pulseframe/core';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
async function call<R>(path: string, init?: RequestInit): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details);
  return data as R;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export interface RevisionEvent { projectId: string; revision: number; transactionId: string; actor: string; label: string | null; summary: string; affectedIds: string[]; at: string; kind?: string; ops?: string[] }
export interface JobEvent { id: string; type: string; status: string; stage: string | null; output: any; error: any }
export interface CommitResult { revision: number; committed: boolean; summary: string; affectedIds: string[]; results: { op: string; output?: Record<string, any> }[] }

export const api = {
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
  capabilities: () => call<{ provider: { configured: boolean; reason: string | null; readiness: { reachable: boolean; runtimeVersion: string | null; device: { name: string; type: string } | null } | null }; capabilities: { id: string; runnable: boolean; title: { he: string; en: string } }[] }>('/capabilities'),
  runCapability: (id: string, capabilityId: string, params: Record<string, unknown>) => call<{ jobId: string }>(`/projects/${id}/capabilities/${capabilityId}/runs`, json({ params, idempotencyKey: crypto.randomUUID() })),
  derivatives: (id: string, assetId: string) => call<{ derivatives: { kind: string; status: string; meta: any }[] }>(`/projects/${id}/assets/${assetId}/derivatives`),
  presence: (id: string, sessionId: string, frame: number, selection: string[]) => call<unknown>(`/projects/${id}/presence`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, frame, selection }) }),
  cancelJob: (jobId: string) => call<{ status: string; outcome: string }>(`/jobs/${jobId}/cancel`, json({})),
  retryJob: (jobId: string) => call<{ jobId: string }>(`/jobs/${jobId}/retry`, json({})),
  startExport: (id: string) => call<{ jobId: string }>(`/projects/${id}/exports`, { method: 'POST' }),
  events: (id: string, since: number) => new EventSource(`/api/v1/projects/${id}/events?since=${since}`, { withCredentials: true }),
};
