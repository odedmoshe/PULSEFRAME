/**
 * The safe downloader (wave 8 `sources`, plan §3.4 with verify C8, C10; sources/contract.ts). Own code on node:http / node:https:
 * Node's fetch is not used (its proxy rule, docs/BLOCKERS.md B-6, and it has no lookup hook). No dependency.
 *
 * - http and https only. The address of every connection is checked INSIDE the `lookup` hook, so a name cannot be swapped for
 *   another address after the check (DNS rebinding). Node 22 calls the hook with `all: true` (autoSelectFamily) and expects an
 *   array: EVERY address the name resolves to is checked, and one refused address refuses the request. A literal address in the
 *   link (Node calls no lookup for it) is checked before connecting.
 * - Addresses are normalised first (brackets, zone, IPv4-mapped and IPv4-compatible IPv6, NAT64): `::ffff:127.0.0.1` is 127.0.0.1.
 * - The default policy REFUSES loopback, unspecified, link-local (169.254.0.0/16 with the cloud metadata address, fe80::/10),
 *   multicast, reserved IPv4 and every address of this machine's own network interfaces (os.networkInterfaces: the editor's own
 *   doors, e.g. the phone drop on the LAN). That protects the editor's own ports; it is a fact of where the link leads, not a
 *   policy on what the owner may fetch. RFC 1918, 100.64.0.0/10 and fc00::/7 are ALLOWED with the warning link_private_network
 *   (a NAS at home). Anything else is public.
 * - At most SOURCES_LIMITS.redirects redirects, each one checked again (scheme, address, and for a service's API call its hosts);
 *   an Authorization header never follows a redirect to another host.
 * - Header timeout and idle timeout (SOURCES_LIMITS); the caller caps bytes while streaming (a lying Content-Length cannot pass).
 * - User-Agent from the caller (providers userAgentFor); no Referer, no cookies are ever sent.
 * - The policy is a parameter: the runtime passes the default, or the one SourcesDeps.test injects for tests and the proof. Never
 *   from the environment or a route. `resolve` exists for this module's own unit tests only (labelled there).
 */
import dns from 'node:dns';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { PassThrough, type Readable } from 'node:stream';
import { SOURCES_LIMITS } from '@pulseframe/core';
import type { AddressPolicy } from '../sources/contract.ts';

export type FetchFailure = 'link_address_refused' | 'link_not_http' | 'too_many_redirects' | 'host_not_allowed' | 'header_timeout' | 'stalled' | 'network' | 'canceled';
/** Why the downloader stopped. `host` is the host (never a full link: links may carry tokens). */
export class FetchRefusal extends Error {
  constructor(readonly code: FetchFailure, message: string, readonly host: string | null = null, readonly address: string | null = null) { super(message); }
}

// ---------------------------------------------------------------- addresses
function v6Groups(a: string): number[] | null {
  let s = a;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const o = v4.slice(1, 5).map(Number);
    if (o.some((x) => x > 255)) return null;
    s = s.slice(0, v4.index) + `${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const rest = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...rest].map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN));
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g))) return null;
  return groups;
}
const v4FromGroups = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
/**
 * The address as the policy sees it: no brackets, no zone, lower case; an IPv4 address carried in IPv6 (::ffff:a.b.c.d,
 * ::a.b.c.d, 64:ff9b::a.b.c.d, also in hex) becomes that IPv4 address. Null when it is not an address.
 */
export function normaliseAddress(raw: string): { address: string; family: 4 | 6 } | null {
  const a = raw.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();
  if (net.isIPv4(a)) return { address: a.split('.').map((x) => String(Number(x))).join('.'), family: 4 };
  if (!net.isIPv6(a)) return null;
  const g = v6Groups(a);
  if (!g) return null;
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && g[5] === 0xffff) return { address: v4FromGroups(g[6]!, g[7]!), family: 4 };
  if (zero(0, 6) && !(g[6] === 0 && (g[7] === 0 || g[7] === 1))) return { address: v4FromGroups(g[6]!, g[7]!), family: 4 };
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return { address: v4FromGroups(g[6]!, g[7]!), family: 4 };
  return { address: g.map((x) => x.toString(16)).join(':'), family: 6 };
}
const v4n = (a: string) => a.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const inV4 = (a: string, base: string, bits: number) => { const m = bits === 0 ? 0 : 2 ** 32 - 2 ** (32 - bits); return (v4n(a) & m) >>> 0 === (v4n(base) & m) >>> 0; };
/** This machine's own interface addresses, normalised (read on every check: interfaces come and go). */
export function ownAddresses(): Set<string> {
  const out = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) { const n = normaliseAddress(i.address); if (n) out.add(n.address); }
  return out;
}
/** The default policy (see the header). `address` is normalised. */
export const defaultAddressPolicy: AddressPolicy = {
  classify(address, family) {
    if (ownAddresses().has(address)) return 'refuse';
    if (family === 4) {
      if (inV4(address, '0.0.0.0', 8) || inV4(address, '127.0.0.0', 8) || inV4(address, '169.254.0.0', 16) || inV4(address, '224.0.0.0', 4) || inV4(address, '240.0.0.0', 4)) return 'refuse';
      if (inV4(address, '10.0.0.0', 8) || inV4(address, '172.16.0.0', 12) || inV4(address, '192.168.0.0', 16) || inV4(address, '100.64.0.0', 10)) return 'private';
      return 'public';
    }
    const g = v6Groups(address);
    if (!g) return 'refuse';
    if (g.every((x) => x === 0)) return 'refuse'; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return 'refuse'; // ::1
    if ((g[0]! & 0xffc0) === 0xfe80) return 'refuse'; // link-local
    if ((g[0]! & 0xff00) === 0xff00) return 'refuse'; // multicast
    if ((g[0]! & 0xfe00) === 0xfc00) return 'private'; // ULA
    return 'public';
  },
};
/** One address through a policy: normalised, then classified; anything that is not an address is refused. */
export function classifyAddress(policy: AddressPolicy, raw: string): { verdict: 'refuse' | 'private' | 'public'; address: string } {
  const n = normaliseAddress(raw);
  if (!n) return { verdict: 'refuse', address: raw };
  return { verdict: policy.classify(n.address, n.family), address: n.address };
}

// ---------------------------------------------------------------- media
/** What the first bytes of a file are (magic numbers), or null when they are not a picture, sound or video this check knows. */
export function sniffMedia(b: Buffer): 'video' | 'audio' | 'image' | null {
  const at = (o: number, s: string) => b.length >= o + s.length && b.toString('latin1', o, o + s.length) === s;
  if (at(4, 'ftyp')) { const brand = b.toString('latin1', 8, 12); return /^M4[AB] /.test(brand) ? 'audio' : /^(heic|heix|mif1|msf1|avif|avis)$/.test(brand) ? 'image' : 'video'; }
  if (at(4, 'moov') || at(4, 'mdat') || at(4, 'wide') || at(4, 'free')) return 'video';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video';
  if (at(0, 'RIFF')) return at(8, 'WAVE') ? 'audio' : at(8, 'AVI ') ? 'video' : at(8, 'WEBP') ? 'image' : null;
  if (at(0, 'OggS') || at(0, 'fLaC') || at(0, 'ID3')) return 'audio';
  if (b.length >= 8 && b[0] === 0x89 && at(1, 'PNG')) return 'image';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image';
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image';
  if (at(0, 'II*\u0000') || at(0, 'MM\u0000*')) return 'image';
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return 'audio'; // MPEG audio / ADTS frame
  if (b.length >= 189 && b[0] === 0x47 && b[188] === 0x47) return 'video'; // MPEG-TS
  return null;
}
/** The Content-Type's verdict: media, a type that is plainly not media (html, json, text…), or neutral (octet-stream or absent). */
export function contentTypeVerdict(ct: string | undefined): 'media' | 'not-media' | 'neutral' {
  const t = (ct ?? '').split(';')[0]!.trim().toLowerCase();
  if (!t || t === 'application/octet-stream' || t === 'binary/octet-stream' || t === 'application/binary') return 'neutral';
  if (/^(video|audio|image)\//.test(t) && t !== 'image/svg+xml') return 'media';
  if (t === 'application/ogg' || t === 'application/mp4') return 'media';
  return 'not-media';
}

// ---------------------------------------------------------------- the request
export interface SafeOpenOptions {
  userAgent: string;
  policy?: AddressPolicy;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** a service's API call: every hop must be one of these hosts (C10); null/absent = any host that passes the address floor */
  allowHosts?: readonly string[] | null;
  maxRedirects?: number;
  headerTimeoutMs?: number;
  idleTimeoutMs?: number;
  signal?: AbortSignal;
  /** UNIT TESTS of this module only (labelled there): answers a name with these addresses instead of the system resolver */
  resolve?: (host: string) => Promise<{ address: string; family: number }[]>;
}
export interface SafeResponse {
  status: number; headers: IncomingHttpHeaders;
  /** the body, watched for idleness; errors end it */ body: Readable;
  /** the final URL after redirects (may carry a token: never log it) */ url: string;
  host: string;
  /** link_private_network when any connected address was a home-network one */ warnings: Set<'link_private_network'>;
}
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const sysResolve = async (host: string) => dns.promises.lookup(host, { all: true, verbatim: true });

/** Opens a URL through the floor (see the header). Redirects are followed; the answer of the last hop is returned, any status. */
export async function safeOpen(rawUrl: string, o: SafeOpenOptions): Promise<SafeResponse> {
  const policy = o.policy ?? defaultAddressPolicy;
  const warnings = new Set<'link_private_network'>();
  const maxRedirects = o.maxRedirects ?? SOURCES_LIMITS.redirects;
  let url = rawUrl;
  let method = o.method ?? 'GET';
  let body = o.body;
  let headers: Record<string, string> = { ...(o.headers ?? {}) };
  let firstHost: string | null = null;
  for (let hop = 0; ; hop++) {
    let u: URL;
    try { u = new URL(url); } catch { throw new FetchRefusal('link_not_http', 'the address is not a web address'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchRefusal('link_not_http', 'only http and https are followed', u.hostname || null);
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    firstHost ??= host;
    if (o.allowHosts && !o.allowHosts.includes(host)) throw new FetchRefusal('host_not_allowed', `the service's answer led to ${host}, which is not one of its API hosts`, host);
    if (host !== firstHost) { delete headers.authorization; delete headers.Authorization; }
    if (net.isIP(host)) {
      const c = classifyAddress(policy, host);
      if (c.verdict === 'refuse') throw new FetchRefusal('link_address_refused', `${host} is an address of this computer, its own network doors or a link-local address`, host, c.address);
      if (c.verdict === 'private') warnings.add('link_private_network');
    }
    const res = await requestOnce(u, host, method, headers, body, o, policy, warnings);
    if (REDIRECTS.has(res.statusCode ?? 0) && res.headers.location) {
      res.resume(); res.destroy();
      if (hop >= maxRedirects) throw new FetchRefusal('too_many_redirects', `more than ${maxRedirects} redirects`, host);
      url = new URL(res.headers.location, u).href;
      if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === 'POST')) { method = 'GET'; body = undefined; headers = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'content-type')); }
      continue;
    }
    return { status: res.statusCode ?? 0, headers: res.headers, body: watched(res, o.idleTimeoutMs ?? SOURCES_LIMITS.idleTimeoutMs), url: u.href, host, warnings };
  }
}

function requestOnce(u: URL, host: string, method: string, headers: Record<string, string>, body: string | undefined, o: SafeOpenOptions, policy: AddressPolicy, warnings: Set<'link_private_network'>): Promise<IncomingMessage> {
  const resolve = o.resolve ?? sysResolve;
  const lookup = (hostname: string, options: { all?: boolean; family?: number | string }, cb: (err: Error | null, address?: string | { address: string; family: number }[], family?: number) => void) => {
    resolve(hostname).then((list) => {
      if (!list.length) return cb(Object.assign(new Error(`${hostname} has no address`), { code: 'ENOTFOUND' }));
      for (const a of list) {
        const c = classifyAddress(policy, a.address);
        if (c.verdict === 'refuse') return cb(new FetchRefusal('link_address_refused', `${hostname} leads to ${c.address}, an address of this computer, its own network doors or a link-local address`, hostname, c.address));
        if (c.verdict === 'private') warnings.add('link_private_network');
      }
      const fam = Number(options.family) || 0;
      const usable = fam ? list.filter((a) => a.family === fam) : list;
      if (!usable.length) return cb(Object.assign(new Error(`${hostname} has no IPv${fam} address`), { code: 'ENOTFOUND' }));
      if (options.all) return cb(null, usable.map((a) => ({ address: a.address, family: a.family })));
      return cb(null, usable[0]!.address, usable[0]!.family);
    }, (e: Error) => cb(e));
  };
  return new Promise((resolveP, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const finalHeaders: Record<string, string> = { 'user-agent': o.userAgent, accept: '*/*', ...Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(cookie|referer|user-agent|host)$/i.test(k))) };
    if (body !== undefined) finalHeaders['content-length'] = String(Buffer.byteLength(body));
    let settled = false;
    const req = mod.request(u, { method, headers: finalHeaders, lookup: lookup as never, agent: false, ...(o.signal ? { signal: o.signal } : {}) });
    const timer = setTimeout(() => { req.destroy(new FetchRefusal('header_timeout', `${host} sent no answer within ${Math.round((o.headerTimeoutMs ?? SOURCES_LIMITS.headerTimeoutMs) / 1000)} seconds`, host)); }, o.headerTimeoutMs ?? SOURCES_LIMITS.headerTimeoutMs);
    timer.unref?.();
    req.on('response', (res) => { clearTimeout(timer); settled = true; resolveP(res); });
    req.on('error', (e: Error & { code?: string }) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (e instanceof FetchRefusal) return reject(e);
      if (o.signal?.aborted || e.name === 'AbortError') return reject(new FetchRefusal('canceled', 'the download was stopped', host));
      reject(new FetchRefusal('network', `${host} could not be reached (${e.code ?? e.message})`, host));
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** The body passed through (with backpressure), ending with `stalled` when no byte arrives for idleMs; every error is a FetchRefusal. */
function watched(res: IncomingMessage, idleMs: number): Readable {
  const out = new PassThrough();
  let timer: NodeJS.Timeout | null = null;
  let done = false;
  const stop = () => { if (timer) clearTimeout(timer); timer = null; };
  const fail = (e: unknown) => {
    if (done) return;
    done = true; stop();
    out.destroy(e instanceof FetchRefusal ? e : new FetchRefusal('network', 'the connection ended before the whole answer arrived'));
    if (!res.destroyed) res.destroy();
  };
  const arm = () => { stop(); timer = setTimeout(() => fail(new FetchRefusal('stalled', `no bytes arrived for ${Math.round(idleMs / 1000)} seconds`)), idleMs); timer.unref?.(); };
  arm();
  res.on('data', (c: Buffer) => { arm(); if (!out.write(c)) res.pause(); });
  out.on('drain', () => res.resume());
  res.on('end', () => { if (done) return; done = true; stop(); out.end(); });
  res.on('error', fail);
  res.on('aborted', () => fail(null));
  res.on('close', () => { if (!res.complete) fail(null); });
  out.on('close', () => { done = true; stop(); if (!res.destroyed) res.destroy(); });
  return out;
}

/** Reads a whole (small) answer into memory, at most `cap` bytes (a service's JSON). */
export async function readCapped(body: Readable, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of body) {
    n += (c as Buffer).length;
    if (n > cap) { body.destroy(); throw new FetchRefusal('network', `the answer was longer than ${cap} bytes`); }
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}
