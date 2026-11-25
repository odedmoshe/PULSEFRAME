/**
 * The editor's calls to the footage search routes (wave 7 search track, builder C). The routes are contract (search/contract.ts
 * SEARCH_ROUTES); while the server's runtime is not built they answer 501 `footage_search_not_built`, which the caller shows as the
 * honest "not built" state. A failure is the shared ApiFailure. The query travels in the request body only: it is never put in an
 * address, a header, browser storage or a log line by this file.
 */
import type { FootageAnswer, FootageIndexStatus } from '@pulseframe/core';
import { ApiFailure } from '../../api.ts';

async function send<R>(path: string, init: RequestInit): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
const body = (method: string, value: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
const enc = encodeURIComponent;

export const searchApi = {
  /** POST …/search: the picture part of an answer (the editor asks for the exact part in this browser, so `picture: true` is the only reason to call). */
  picture: (projectId: string, query: string, signal?: AbortSignal) => send<FootageAnswer>(`/projects/${enc(projectId)}/search`, { ...body('POST', { query, picture: true }), ...(signal ? { signal } : {}) }),
  /** GET …/search/index (owner only): setup, what is scanned, the open job. */
  status: (projectId: string, signal?: AbortSignal) => send<FootageIndexStatus>(`/projects/${enc(projectId)}/search/index`, signal ? { signal } : {}),
  /** POST …/search/index: start the durable scan of every video not yet in the index (202 { jobId }). */
  scan: (projectId: string) => send<{ jobId: string; status: string }>(`/projects/${enc(projectId)}/search/index`, body('POST', {})),
  /** DELETE …/search/index: forget what the scan kept for this project. */
  forget: (projectId: string) => send<{ forgotten: { files: number; bytes: number } }>(`/projects/${enc(projectId)}/search/index`, { method: 'DELETE' }),
};

/** A failure as the two things the interface needs: the code and a status (a network failure is status 0). */
export const failureOf = (e: unknown): { status: number; code: string; message: string } =>
  e instanceof ApiFailure ? { status: e.status, code: e.code, message: e.message } : { status: 0, code: 'network', message: e instanceof Error ? e.message : String(e) };
