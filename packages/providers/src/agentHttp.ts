/**
 * The network half the two agent adapters share (wave 8 autonomy Part 2, builder W2): one POST with Node's own `fetch` (no new
 * dependency, no streaming in version 1), the caller's AbortSignal joined with a time limit (120 s by default), and the split C16
 * needs between "never sent" and "sent, answer lost":
 *  - a failure while CONNECTING (refused, no such host, no route, the TLS handshake, the connect timer) means no byte of the
 *    request reached the provider: `local_server_down` when the base URL is this computer or a home-network address, else
 *    `unreachable` (both retryable; nothing was charged);
 *  - ANY other failure once fetch started (the time limit, a reset socket, a body that cannot be read, an answer that is not
 *    JSON, the caller's cancel) may come after the provider took the request: `unknown_after_send`, not retryable, never re-sent
 *    by the adapter (the loop counts it as unknown money). Node's fetch does not say whether the body was written, so every
 *    ambiguous case is put on this side.
 * The key travels in one header of one request and is never put in a detail: every detail passes `redactKey` (the same rule as
 * apps/server assistant/credential.ts redact, which the server applies a second time).
 */
import { AgentProviderError, type AgentProviderErrorCode } from './agentModel.ts';

export const AGENT_HTTP_TIMEOUT_MS = 120_000;
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export interface AgentHttpOptions { fetch?: FetchLike; timeoutMs?: number }

/** Every occurrence of the key (as typed and URL-encoded) replaced; null key = unchanged. */
export function redactKey(key: string | null, text: string): string {
  if (!key) return text;
  return [...new Set([key, encodeURIComponent(key)])].filter((f) => f.length > 0).reduce((s, f) => s.split(f).join('[redacted]'), text);
}

/** This computer, or an address of a home network (RFC 1918, link-local, .local, a bare host name): where a model runs locally. */
export function isLocalOrLanHost(baseUrl: string): boolean {
  let h: string;
  try { h = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return false; }
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.localhost') || !h.includes('.') && !h.includes(':')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd');
}

/** `{base}{path}` with exactly one slash between them (the owner may type the base URL with or without a trailing slash). */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

const CONNECT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_CONNECT', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const causeCode = (e: unknown): string | null => {
  for (let c: unknown = e, i = 0; c && i < 5; c = (c as { cause?: unknown }).cause, i++) {
    const code = (c as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
};

export interface AgentHttpAnswer { status: number; headers: Headers; text: string }

/** One POST of a JSON body. Throws AgentProviderError for every failure that is not an HTTP answer (see the header). */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal, key: string | null, opts: AgentHttpOptions = {}): Promise<AgentHttpAnswer> {
  const r = (t: string) => redactKey(key, t);
  if (signal.aborted) throw new AgentProviderError('unreachable', true, 'canceled before the request was sent');
  const f: FetchLike = opts.fetch ?? ((i, init) => fetch(i, init));
  const joined = AbortSignal.any([signal, AbortSignal.timeout(opts.timeoutMs ?? AGENT_HTTP_TIMEOUT_MS)]);
  let res: Response;
  try {
    res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: joined, redirect: 'error' });
  } catch (e) {
    const code = causeCode(e);
    if (code && CONNECT_CODES.has(code)) {
      const local = isLocalOrLanHost(url);
      throw new AgentProviderError(local ? 'local_server_down' : 'unreachable', true, r(`${code}: no connection to ${new URL(url).host}${local ? ' (is the local model server running on that port?)' : ''}`));
    }
    const why = signal.aborted ? 'canceled' : joined.aborted ? 'no answer within the time limit' : (code ?? (e as Error).message ?? 'connection lost');
    throw new AgentProviderError('unknown_after_send', false, r(`the request may have reached the provider and its answer was lost (${why}); it is not sent again`));
  }
  let text: string;
  try { text = await res.text(); } catch (e) {
    throw new AgentProviderError('unknown_after_send', false, r(`HTTP ${res.status} arrived and its body was lost (${causeCode(e) ?? (e as Error).message}); it is not sent again`));
  }
  return { status: res.status, headers: res.headers, text };
}

/** retry-after in whole seconds (a number or an HTTP date), or null. */
export function retryAfterSeconds(h: Headers): number | null {
  const v = h.get('retry-after');
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v.trim())) return Math.ceil(Number(v));
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : null;
}

export const RETRYABLE: ReadonlySet<AgentProviderErrorCode> = new Set(['rate_limited', 'overloaded', 'unreachable', 'local_server_down']);
export const providerError = (code: AgentProviderErrorCode, detail: string, retryAfter: number | null = null) => new AgentProviderError(code, RETRYABLE.has(code), detail, retryAfter);
/** The error body's type/code and message, whatever the family's shape ({error:{type,code,message}} or {error:"..."}). */
export function errorFields(text: string): { type: string | null; code: string | null; message: string } {
  try {
    const j = JSON.parse(text) as { error?: unknown; message?: unknown };
    const e = j.error;
    if (typeof e === 'string') return { type: null, code: null, message: e };
    if (e && typeof e === 'object') {
      const o = e as { type?: unknown; code?: unknown; message?: unknown; status?: unknown };
      return { type: typeof o.type === 'string' ? o.type : typeof o.status === 'string' ? o.status : null, code: typeof o.code === 'string' ? o.code : null, message: typeof o.message === 'string' ? o.message : '' };
    }
    if (typeof j.message === 'string') return { type: null, code: null, message: j.message };
  } catch { /* not JSON */ }
  return { type: null, code: null, message: text.slice(0, 300) };
}
/** A detail line: provider, status, type/code and the message, cut to 300 characters, key redacted. */
export const detailOf = (providerId: string, status: number, f: { type: string | null; code: string | null; message: string }, key: string | null) =>
  redactKey(key, `${providerId} HTTP ${status}${f.type ? ` ${f.type}` : ''}${f.code ? ` (${f.code})` : ''}: ${f.message}`.slice(0, 300));
