/**
 * REST calls of «קליפ מקוד» (wave 8 motioncode; apps/server/src/made/contract.ts MADE_ROUTES, documented in openapi.ts). Kept apart from
 * apps/web/src/api.ts. Until W1/W2 build the server every call but templates answers 501 made_not_built (ApiFailure).
 */
import type { MadeApplyRequest, MadeAssetPage, MadeJobReport, MadeRenderRequest, MadeTemplateInfo, ApplyMadeClipOutput } from '@pulseframe/core';
import { ApiFailure } from '../../api.ts';

async function call<R>(path: string, init?: RequestInit): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const P = (id: string) => `/projects/${encodeURIComponent(id)}/made`;
export const madeApi = {
  templates: () => call<{ templates: MadeTemplateInfo[]; limits: Record<string, number> }>('/made/templates'),
  render: (projectId: string, req: MadeRenderRequest) => call<{ jobId: string; warnings?: { what: string; at: number }[] }>(`${P(projectId)}/render`, post(req)),
  report: (projectId: string, jobId: string) => call<MadeJobReport>(`${P(projectId)}/jobs/${encodeURIComponent(jobId)}`),
  stillUrl: (projectId: string, jobId: string, k: 0 | 1 | 2) => `/api/v1${P(projectId)}/jobs/${encodeURIComponent(jobId)}/still/${k}`,
  fileUrl: (projectId: string, jobId: string) => `/api/v1${P(projectId)}/jobs/${encodeURIComponent(jobId)}/file`,
  apply: (projectId: string, jobId: string, req: MadeApplyRequest) => call<{ revision: number; output: ApplyMadeClipOutput }>(`${P(projectId)}/jobs/${encodeURIComponent(jobId)}/apply`, post(req)),
  dismiss: (projectId: string, jobId: string) => call<{ dismissed: true }>(`${P(projectId)}/jobs/${encodeURIComponent(jobId)}/dismiss`, post({})),
  page: (projectId: string, assetId: string) => call<MadeAssetPage>(`${P(projectId)}/assets/${encodeURIComponent(assetId)}/page`),
};
