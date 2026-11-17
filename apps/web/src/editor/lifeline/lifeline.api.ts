/**
 * REST calls of the life line (ADR-0021). Kept apart from apps/web/src/api.ts (the project and owner calls) and from
 * editor/api.ts (the AI wave's module); the routes are in apps/server/src/http.ts and documented in openapi.ts.
 * Every persistent edit of the life line is an operation through Editor.commit; these two calls are the only server
 * actions of the track: a read, and a server-side reading of the stored files that commits its own transaction.
 */
import type { OnThisDayItem } from '@pulseframe/core';
import { ApiFailure } from '../../api.ts';

async function call<R>(path: string, init?: RequestInit): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
/** The viewer's own day as YYYY-MM-DD (the browser's local clock): what "on this day" is asked with. */
export const localDay = (now = new Date()): string => `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
export const lifeApi = {
  /** Files of the owner's projects taken on this day of an earlier year (owner session only: 403 owner_required otherwise). */
  onThisDay: (date: string = localDay()) => call<{ items: OnThisDayItem[] }>(`/on-this-day?date=${encodeURIComponent(date)}`),
  /** Read capture dates again from the stored originals of the files that have none; the server commits one transaction. */
  readCaptureDates: (projectId: string) => call<{ read: number; dated: number; revision: number }>(`/projects/${encodeURIComponent(projectId)}/captures/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
};
