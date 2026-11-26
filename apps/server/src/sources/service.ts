/**
 * What the three service adapters share (wave 8 `sources`; W2): the call context, the item as a service describes it, the API call
 * through the safe downloader (its hosts bound, C10) with the services' answers mapped to the core error table, and the record and
 * row built from an item. A service is sent ONLY the caller's words and filters (and the owner's key or contact line where it needs
 * one); nothing here logs a query, a key or a link.
 */
import { licenceFacts, sourceDuties, SourcesNotBuiltError, type SourceKind, type SourceRecord, type SourceResultRow, type SourceWarning, type SearchableSourceId } from '@pulseframe/core';
import type { MappedLicence } from '@pulseframe/providers';
import { FetchRefusal, readCapped, safeOpen } from '../connectors/fetch.ts';
import { ApiError } from '../store.ts';
import { sourcesError, type AddressPolicy } from './contract.ts';

/** One API call's context. `apiHosts` binds the call (C10); the file and preview URLs of the answer pass the address floor only. */
export interface ServiceCtx {
  baseUrl: string; apiHosts: readonly string[]; policy: AddressPolicy; userAgent: string;
  /** Pixabay's key; Openverse's bearer token (from the owner's client); null otherwise */ secret: string | null;
  redact: (s: string) => string; signal?: AbortSignal;
}
export interface Rendition { id: string; url: string; width: number | null; height: number | null; bytes: number | null }
/** One item as a service describes it (before any byte is fetched). */
export interface ServiceItem {
  provider: SearchableSourceId; itemId: string; kind: SourceKind; title: string; author: string | null; pageUrl: string | null;
  durationSeconds: number | null; width: number | null; height: number | null;
  licence: MappedLicence; credit: { text: string; due: boolean } | null; terms: string[];
  /** renditions offered, first = the default; `original` for one-file services */ renditions: Rendition[];
  previewUrl: string | null; thumbUrl: string | null;
  /** a file extension the service names (mp4, jpg…), for the file name */ ext: string | null;
}
export interface ServicePage { items: ServiceItem[]; total: number | null; next: number | null }
export interface SearchArgs { q: string; kind?: SourceKind; page: number; orientation?: 'horizontal' | 'vertical'; lang?: string }
export interface ServiceAdapter {
  search(ctx: ServiceCtx, a: SearchArgs): Promise<ServicePage>;
  /** null = the service has no such item (any more) */
  item(ctx: ServiceCtx, itemId: string): Promise<ServiceItem | null>;
}

/** The largest JSON answer read from a service. */
export const API_ANSWER_MAX = 8 * 1024 * 1024;
/**
 * GET (or POST) a service's JSON through the safe downloader with its API hosts bound. 404 → null; 429 → provider_rate_limited
 * (retryAfterSeconds from Retry-After, else the given window); 401/403 (and a 400 naming the key) → provider_key_rejected; any
 * other answer → provider_unavailable with the status. Nothing a service answers is kept unless it passed `redact`.
 */
export async function callJson(ctx: ServiceCtx, url: string, o: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string>; windowSeconds?: number } = {}): Promise<unknown | null> {
  let res;
  try {
    res = await safeOpen(url, { userAgent: ctx.userAgent, policy: ctx.policy, allowHosts: ctx.apiHosts, method: o.method ?? 'GET', ...(o.body !== undefined ? { body: o.body } : {}), headers: { accept: 'application/json', ...(o.headers ?? {}) }, ...(ctx.signal ? { signal: ctx.signal } : {}) });
  } catch (e) {
    if (e instanceof FetchRefusal) throw sourcesError('providerFailed', { reason: e.code, host: e.host });
    throw e;
  }
  const status = res.status;
  let text = '';
  try { text = (await readCapped(res.body, API_ANSWER_MAX)).toString('utf8'); } catch (e) { if (status >= 200 && status < 300) throw sourcesError('providerFailed', { reason: e instanceof FetchRefusal ? e.code : 'read' }); }
  if (status === 404) return null;
  if (status === 429) {
    const ra = Number(res.headers['retry-after']);
    throw sourcesError('rateLimited', { retryAfterSeconds: Number.isFinite(ra) && ra >= 0 ? Math.ceil(ra) : (o.windowSeconds ?? 60) });
  }
  if (status === 401 || status === 403 || (status === 400 && /key/i.test(text))) throw sourcesError('keyRejected', { status });
  if (status < 200 || status >= 300) throw sourcesError('providerFailed', { status, said: ctx.redact(text.slice(0, 200)) });
  try { return JSON.parse(text); } catch { throw sourcesError('providerFailed', { status, reason: 'not JSON' }); }
}

/** The flags a record must carry for its licence id (sourceDuties.ts sourceRecordProblems: the record is never weaker). */
export function flagsFor(licenceId: string): SourceRecord['flags'] {
  const f = licenceFacts(licenceId);
  return {
    ...(f.nonCommercial ? { nonCommercial: true as const } : {}), ...(f.noDerivatives ? { noDerivatives: true as const } : {}), ...(f.shareAlike ? { shareAlike: true as const } : {}),
    ...(!f.known ? { licenceUnconfirmed: true as const } : {}), ...(!f.shareable ? { notShareable: true as const } : {}),
  };
}
/** The credit a record carries: the service's line; a licence that names a credit always gets one, due (a data fact). */
export function creditFor(item: ServiceItem): SourceRecord['credit'] | undefined {
  const due = licenceFacts(item.licence.id).credit || !!item.credit?.due;
  const text = (item.credit?.text ?? '').trim() || (due ? [item.title, item.author, item.licence.name].filter(Boolean).join(', ').slice(0, 500) : '');
  return text ? { text, placement: 'description', due } : undefined;
}
/** The record of fetched bytes (written by the server only, from a fresh answer of the service, never from the client). */
export function recordOf(item: ServiceItem, bytes: { sha256: string; byteSize: number; fetchedAt: string }): SourceRecord {
  const credit = creditFor(item);
  return {
    provider: item.provider, itemId: item.itemId, kind: item.kind, title: item.title.slice(0, 200),
    ...(item.author ? { author: item.author.slice(0, 200) } : {}),
    ...(item.pageUrl ? { pageUrl: item.pageUrl.slice(0, 500) } : {}),
    fetchedAt: bytes.fetchedAt, sha256: bytes.sha256, byteSize: bytes.byteSize,
    licence: { id: item.licence.id.slice(0, 80), name: item.licence.name.slice(0, 200), ...(item.licence.url ? { url: item.licence.url.slice(0, 500) } : {}), from: item.licence.from },
    ...(credit ? { credit } : {}),
    flags: flagsFor(item.licence.id),
    ...(item.terms.length ? { terms: item.terms.slice(0, 8) } : {}),
  };
}
/** The warnings of a record (core sourceDuties, W1); until W1's body lands it answers none rather than inventing any. */
export function warningsOf(record: SourceRecord): SourceWarning[] {
  try { return sourceDuties(record, record.title); } catch (e) { if (e instanceof SourcesNotBuiltError) return []; throw e; }
}
/** A result row (the preview and thumbnail handles are minted by the caller). */
export function rowOf(item: ServiceItem, handles: { preview: string | null; thumb: string | null }): SourceResultRow {
  const record = recordOf(item, { sha256: '0'.repeat(64), byteSize: 0, fetchedAt: '' });
  return {
    provider: item.provider, itemId: item.itemId, kind: item.kind, title: item.title, author: item.author,
    durationSeconds: item.durationSeconds, width: item.width, height: item.height,
    licence: { id: record.licence.id, name: record.licence.name, url: record.licence.url ?? null, from: record.licence.from },
    flags: record.flags, creditPreview: record.credit?.text ?? null, pageUrl: item.pageUrl,
    preview: handles.preview, thumb: handles.thumb,
    renditions: item.renditions.map((r) => ({ id: r.id, width: r.width, height: r.height, bytes: r.bytes })),
    warnings: warningsOf(record),
  };
}
/** A number from a service's answer, or null. */
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
/** A service answer that is not the documented shape. */
export const badAnswer = (what: string) => sourcesError('providerFailed', { reason: `unexpected answer: ${what}` });
export { ApiError };
