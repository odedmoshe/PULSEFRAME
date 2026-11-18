/**
 * REST calls of the import queue and the phone drop (ADR-0023). Kept apart from apps/web/src/api.ts (whose upload() stays the
 * synchronous POST …/assets) and from editor/api.ts (the AI wave's module). The routes are the lead's (apps/server/src/http.ts,
 * openapi.ts), mounted once the queue and the door are built; until then these answer with the server's 404.
 *   POST /projects/:id/imports   headers x-filename, x-pf-via, x-pf-relative-path?, x-pf-last-modified?, x-pf-batch? → 202 { job }
 *   GET  /projects/:id/imports   → { imports, room }
 *   POST /jobs/:jobId/cancel | retry | dismiss
 *   GET  /drop/addresses (owner) → { addresses } · POST /projects/:id/drop (owner) { address } → 201 { drop }
 *   GET  /projects/:id/drop (owner) → { drop | null } · POST /projects/:id/drop/:dropId/close (owner) → { drop }
 * Every persistent edit stays an operation through Editor.commit; the import's own commit is the server's.
 */
import { cutUploadName, MAX_RELATIVE_PATH_CHARS, type DropAddress, type DropCodeView, type ImportJobView, type ImportRoom } from '@pulseframe/core';
import { ApiFailure } from '../api.ts';

async function call<R>(path: string, init?: RequestInit): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
const post = (body: unknown = {}): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const p = encodeURIComponent;

/**
 * The name cut of the upload headers (core importView.ts): at most `max` characters AND at most MAX_NAME_HEADER_BYTES once
 * percent-encoded, extension kept, no code point split. x-filename uses 256, x-pf-relative-path 512 (the schema's limits).
 */
export { cutUploadName };

export const importsApi = {
  list: (projectId: string) => call<{ imports: ImportJobView[]; room: ImportRoom }>(`/projects/${p(projectId)}/imports`),
  /** The server's record of one job (status, stage, output, error), the same fields an SSE job event carries. */
  job: (jobId: string) => call<{ id: string; type: string; status: string; stage: string | null; output: unknown; error: unknown }>(`/jobs/${p(jobId)}`),
  cancel: (jobId: string) => call<{ jobId: string; status: string }>(`/jobs/${p(jobId)}/cancel`, post()),
  retry: (jobId: string) => call<{ jobId: string; status: string; retryOf?: string }>(`/jobs/${p(jobId)}/retry`, post()),
  dismiss: (jobId: string) => call<{ jobId: string }>(`/jobs/${p(jobId)}/dismiss`, post()),
  /** One file to POST …/imports with upload progress (XMLHttpRequest streams the File from disk). abort() cancels it. */
  upload(projectId: string, file: File, meta: { via: 'browser' | 'folder'; relativePath?: string; batchId: string }, onProgress: (sent: number, total: number) => void): { done: Promise<{ job: ImportJobView }>; abort(): void } {
    const xhr = new XMLHttpRequest();
    const done = new Promise<{ job: ImportJobView }>((resolve, reject) => {
      xhr.open('POST', `/api/v1/projects/${p(projectId)}/imports`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('content-type', 'application/octet-stream');
      xhr.setRequestHeader('x-filename', encodeURIComponent(cutUploadName(file.name)));
      xhr.setRequestHeader('x-pf-via', meta.via);
      xhr.setRequestHeader('x-pf-batch', encodeURIComponent(meta.batchId));
      if (meta.relativePath) xhr.setRequestHeader('x-pf-relative-path', encodeURIComponent(cutUploadName(meta.relativePath, MAX_RELATIVE_PATH_CHARS)));
      if (Number.isFinite(file.lastModified) && file.lastModified > 0) xhr.setRequestHeader('x-pf-last-modified', String(Math.floor(file.lastModified)));
      xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
      xhr.onload = () => {
        let data: any;
        try { data = JSON.parse(xhr.responseText); } catch { data = undefined; }
        if (xhr.status >= 200 && xhr.status < 300 && data?.job) resolve(data as { job: ImportJobView });
        else reject(new ApiFailure(xhr.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${xhr.status}`, data?.error?.details, data?.error?.hint));
      };
      xhr.onerror = () => reject(new ApiFailure(0, 'network_error', 'the upload was interrupted'));
      xhr.onabort = () => reject(new ApiFailure(0, 'canceled', 'the upload was canceled'));
      xhr.send(file);
    });
    return { done, abort: () => xhr.abort() };
  },
};
export const dropApi = {
  addresses: () => call<{ addresses: DropAddress[] }>('/drop/addresses'),
  /** The owner confirms the address shown (the preferred one first); the server never picks one alone. */
  open: (projectId: string, address: string) => call<{ drop: DropCodeView }>(`/projects/${p(projectId)}/drop`, post({ address })),
  current: (projectId: string) => call<{ drop: DropCodeView | null }>(`/projects/${p(projectId)}/drop`),
  close: (projectId: string, dropId: string) => call<{ drop: DropCodeView }>(`/projects/${p(projectId)}/drop/${p(dropId)}/close`, post()),
};
