/**
 * Previews without importing (wave 8 `sources`, plan §3.4 with C10): a handle is 16 random bytes (hex) that maps, in memory, for
 * SOURCES_LIMITS.previewHandleMs, to ONE file URL a service's own answer produced. A URL from a client is never fetched (the route
 * takes a handle only, so this is not an open proxy). The bytes are streamed through the safe downloader with the client's Range
 * passed on, cut at SOURCES_LIMITS.previewBytes, and only when the answer is a picture, sound or video; nothing is written to disk.
 */
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { SOURCES_LIMITS } from '@pulseframe/core';
import { contentTypeVerdict, FetchRefusal, safeOpen } from '../connectors/fetch.ts';
import { sourcesError, type AddressPolicy } from './contract.ts';

/** The most handles kept (the oldest go first). */
export const PREVIEW_HANDLES_MAX = 4000;
interface Held { url: string; provider: string; expires: number }

export class PreviewHandles {
  private byHandle = new Map<string, Held>();
  private byUrl = new Map<string, string>();
  constructor(private now: () => number = Date.now) {}
  /** The handle of a URL (an alive one is reused and its life renewed). */
  mint(url: string, provider: string): string {
    const t = this.now();
    const old = this.byUrl.get(url);
    if (old) { const h = this.byHandle.get(old); if (h && h.expires > t) { h.expires = t + SOURCES_LIMITS.previewHandleMs; this.byHandle.delete(old); this.byHandle.set(old, h); return old; } }
    const handle = randomBytes(16).toString('hex');
    this.byHandle.set(handle, { url, provider, expires: t + SOURCES_LIMITS.previewHandleMs });
    this.byUrl.set(url, handle);
    while (this.byHandle.size > PREVIEW_HANDLES_MAX) { const [k, v] = this.byHandle.entries().next().value!; this.byHandle.delete(k); if (this.byUrl.get(v.url) === k) this.byUrl.delete(v.url); }
    return handle;
  }
  resolve(handle: string): Held | null {
    if (!/^[0-9a-f]{32}$/.test(handle)) return null;
    const h = this.byHandle.get(handle);
    if (!h) return null;
    if (h.expires <= this.now()) { this.byHandle.delete(handle); if (this.byUrl.get(h.url) === handle) this.byUrl.delete(h.url); return null; }
    return h;
  }
}

const RANGE = /^bytes=\d*-\d*$/;
/** Streams a held URL (see the header). 404 preview_not_found for an unknown or expired handle. */
export async function previewResponse(handles: PreviewHandles, handle: string, range: string | null, o: { policy: AddressPolicy; userAgentFor: (provider: string) => string }): Promise<Response> {
  const held = handles.resolve(handle);
  if (!held) throw sourcesError('previewNotFound');
  let res;
  try {
    res = await safeOpen(held.url, { userAgent: o.userAgentFor(held.provider), policy: o.policy, headers: range && RANGE.test(range) ? { range } : {} });
  } catch (e) {
    if (e instanceof FetchRefusal && e.code === 'link_address_refused') throw sourcesError('linkAddressRefused', { host: e.host });
    if (e instanceof FetchRefusal) throw sourcesError('providerFailed', { reason: e.code, host: e.host });
    throw e;
  }
  if (res.status === 404 || res.status === 410) { res.body.destroy(); throw sourcesError('previewNotFound'); }
  if (res.status !== 200 && res.status !== 206 && res.status !== 416) { res.body.destroy(); throw sourcesError('providerFailed', { status: res.status }); }
  const ct = String(res.headers['content-type'] ?? '');
  if (res.status !== 416 && contentTypeVerdict(ct) !== 'media') { res.body.destroy(); throw sourcesError('linkNotMedia', { contentType: ct.split(';')[0]!.slice(0, 80) }); }
  const headers = new Headers({ 'content-type': ct.split(';')[0]!.trim(), 'cache-control': 'private, max-age=600', 'x-content-type-options': 'nosniff' });
  for (const h of ['content-range', 'accept-ranges', 'content-length'] as const) { const v = res.headers[h]; if (typeof v === 'string') headers.set(h, v); }
  const len = Number(res.headers['content-length']);
  if (Number.isFinite(len) && len > SOURCES_LIMITS.previewBytes) headers.delete('content-length');
  let sent = 0, ended = false;
  const capped = new Readable({ read() {} });
  const finish = () => { if (!ended) { ended = true; capped.push(null); } };
  res.body.on('data', (c: Buffer) => {
    const left = SOURCES_LIMITS.previewBytes - sent;
    if (left <= 0) return;
    const part = c.length > left ? c.subarray(0, left) : c;
    sent += part.length;
    capped.push(part);
    if (sent >= SOURCES_LIMITS.previewBytes) { finish(); res.body.destroy(); }
  });
  res.body.on('end', finish);
  res.body.on('error', (e) => { if (!ended) capped.destroy(e); });
  capped.on('close', () => { if (!res.body.destroyed) res.body.destroy(); });
  return new Response(Readable.toWeb(capped) as unknown as ReadableStream, { status: res.status, headers });
}
