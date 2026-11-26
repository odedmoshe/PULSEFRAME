/**
 * REST calls of «מאגר» / «ייבוא מקישור» (wave 8 sources; apps/server/src/sources/contract.ts SOURCES_ROUTES, documented in openapi.ts).
 * Kept apart from apps/web/src/api.ts. Until W2 builds the runtime every call answers 501 sources_not_built (ApiFailure).
 */
import type { SourceCredentialsBody, SourceImportAnswer, SourceImportBody, SourceLinkBody, SourcePage, SourceSearchQuery, SourceState, SourcesSettings } from '@pulseframe/core';
import { ApiFailure } from '../../api.ts';

async function call<R>(path: string, init?: RequestInit): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
const send = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const qs = (q: SourceSearchQuery) => new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
export const sourcesApi = {
  list: () => call<{ sources: SourceState[]; settings: SourcesSettings }>('/sources'),
  search: (provider: string, q: SourceSearchQuery, signal?: AbortSignal) => call<SourcePage>(`/sources/${encodeURIComponent(provider)}/search?${qs(q)}`, signal ? { signal } : undefined),
  /** a handle from a search answer, used as <img>/<video>/<audio> src (same origin; never a service's own URL) */
  previewUrl: (handle: string) => `/api/v1/source-previews/${encodeURIComponent(handle)}`,
  setCredentials: (provider: string, body: SourceCredentialsBody) => call<SourceState>(`/sources/${encodeURIComponent(provider)}/credentials`, send('PUT', body)),
  deleteCredentials: (provider: string) => call<SourceState>(`/sources/${encodeURIComponent(provider)}/credentials`, { method: 'DELETE' }),
  settings: () => call<SourcesSettings>('/sources/settings'),
  setSettings: (maxDownloadBytes: number | null) => call<SourcesSettings>('/sources/settings', send('PUT', { maxDownloadBytes })),
  importItem: (projectId: string, body: SourceImportBody) => call<SourceImportAnswer>(`/projects/${encodeURIComponent(projectId)}/sources/import`, send('POST', body)),
  importLink: (projectId: string, body: SourceLinkBody) => call<SourceImportAnswer>(`/projects/${encodeURIComponent(projectId)}/sources/link`, send('POST', body)),
};
