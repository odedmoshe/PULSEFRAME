/**
 * REST calls of «מה יש בקליפ» (wave 8 understand; apps/server/src/understand/contract.ts UNDERSTAND_ROUTES, documented in openapi.ts).
 * Kept apart from apps/web/src/api.ts. Until W1/W2 build them every call answers 501 understand_not_built (ApiFailure). «ביטול התיאורים»
 * is api.undo(projectId, 'undo', row.transactionId) (C7).
 */
import type { NotesPage, NotesQuery, ShotsPage, ShotsQuery, StartUnderstandAnswer, StartUnderstandBody, UnderstandDescriberView, UnderstandSettings, UnderstandSettingsBody, UnderstandStatusAnswer } from '@pulseframe/core';
import { ApiFailure } from '../../api.ts';

async function call<R>(path: string, init?: RequestInit): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
const send = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const qs = (q: Record<string, unknown>) => new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
const pid = (id: string) => `/projects/${encodeURIComponent(id)}`;
export type UnderstandSettingsAnswer = { settings: UnderstandSettings; describer: UnderstandDescriberView };
export const understandApi = {
  status: (projectId: string) => call<UnderstandStatusAnswer>(`${pid(projectId)}/understand`),
  start: (projectId: string, body: StartUnderstandBody = {}) => call<StartUnderstandAnswer>(`${pid(projectId)}/understand`, send('POST', body)),
  shots: (projectId: string, assetId: string, q: Partial<ShotsQuery> = {}) => call<ShotsPage>(`${pid(projectId)}/assets/${encodeURIComponent(assetId)}/shots?${qs(q)}`),
  notes: (projectId: string, assetId: string, q: Partial<NotesQuery> = {}, signal?: AbortSignal) => call<NotesPage>(`${pid(projectId)}/assets/${encodeURIComponent(assetId)}/notes?${qs(q)}`, signal ? { signal } : undefined),
  settings: () => call<UnderstandSettingsAnswer>('/understand/settings'),
  setSettings: (body: UnderstandSettingsBody) => call<UnderstandSettingsAnswer>('/understand/settings', send('PUT', body)),
};
