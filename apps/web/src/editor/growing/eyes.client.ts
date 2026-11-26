/**
 * The editor's calls of «הציעו עיניים» (wave 8 picmodels; server picmodels/contract.ts PICMODELS_ROUTES). A server without the runtime
 * answers 501 `eyes_not_built`, which the caller shows as the honest "not built" state. A failure is the shared ApiFailure. The answer
 * is held in the dialog's memory only (never browser storage, never a log line, never an address); the request is aborted when the
 * picture changes, the dialog closes or «עצרו» is pressed.
 */
import type { EyesAnswer, EyesProposeBody, PictureModelsAnswer, AgentPictureModelsAnswer } from '@pulseframe/core';
import { ApiFailure } from '../../api.ts';

async function send<R>(path: string, init: RequestInit): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
const enc = encodeURIComponent;

export const eyesApi = {
  /** GET /api/v1/picture-models: every model's setup state (the owner's own session sees the yunet row and the sentences). */
  models: (signal?: AbortSignal) => send<PictureModelsAnswer | AgentPictureModelsAnswer>('/picture-models', signal ? { signal } : {}),
  /** POST …/eyes/propose (owner's own session only): two points per face as shown, never stored. */
  propose: (projectId: string, body: EyesProposeBody, signal?: AbortSignal) =>
    send<EyesAnswer>(`/projects/${enc(projectId)}/eyes/propose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) }),
};
