/**
 * What a made page may load besides itself («קליפ מקוד», wave 8 motioncode, W1; decision 5): catalogue fonts, pinned libraries,
 * the owner's media (read-only) and internet files fetched ONCE before drawing. Everything is served by the made browser's route
 * at https://made.invalid/…; nothing is fetched while drawing.
 *
 * - Fonts: every FONT_CATALOG family at its bundled weights, the hebrew, latin and latin-ext subsets, read from the installed
 *   @fontsource packages (the same pinned packages the editor bundles), at /fonts/<file>.woff2 with each subset's unicode-range.
 * - Libraries: a MADE_LIBRARIES row is served when its licence was read (`licenceRead`) and the package is installed at exactly its
 *   pinned version (read from the installed package.json, a fact; the row's `installed` flag is documentation the lead keeps),
 *   and only the files the row lists, at /lib/<name>@<version>/<file>.
 * - The owner's media: /assets/<assetId>, the asset's blob, for ids the request names or the page names, that exist in the project.
 * - Internet files: every http(s) address the page names (outside made.invalid and XML namespaces) on a PUBLIC host is fetched by
 *   the server before drawing (loopback, private and local addresses never: the page's request is aborted like any other), at most MADE_LIMITS.fetchFiles files and fetchBytes bytes in all; the page text served has each address replaced by
 *   https://made.invalid/fetched/<n>. A failing address fails the job (made_fetch_failed, naming it).
 */
import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { FONT_CATALOG, MADE_LIBRARIES, MADE_LIMITS, type MadeLibrary } from '@pulseframe/core';
import type { MadeServedFile } from '@pulseframe/renderer';

const ORIGIN = 'https://made.invalid';
const here = import.meta.dirname;
const webRequire = createRequire(path.resolve(here, '../../../web/package.json'));
const rendererRequire = createRequire(path.resolve(here, '../../../renderer/package.json'));
const SUBSETS = ['hebrew', 'latin', 'latin-ext'] as const;

export interface MadeFontFace { family: string; weight: number; url: string; unicodeRange?: string; file: string }
let fontCache: { faces: MadeFontFace[]; files: Map<string, string> } | null = null;
/** The catalogue faces and their files (read once). A family whose package cannot be found is left out (and its use is then reported as a missing font). */
export function madeFonts(): { faces: MadeFontFace[]; files: Map<string, string> } {
  if (fontCache) return fontCache;
  const faces: MadeFontFace[] = [];
  const files = new Map<string, string>();
  for (const f of FONT_CATALOG) {
    let dir: string;
    try { dir = path.dirname(webRequire.resolve(`${f.package}/package.json`)); } catch { continue; }
    for (const w of f.weights) {
      const css = path.join(dir, `${w}.css`);
      if (!fs.existsSync(css)) continue;
      for (const block of fs.readFileSync(css, 'utf8').split('@font-face').slice(1)) {
        const file = /url\(\.\/files\/([^)]+?\.woff2)\)/.exec(block)?.[1];
        if (!file || !SUBSETS.some((s) => file === `${f.slug}-${s}-${w}-normal.woff2`)) continue;
        const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
        files.set(file, path.join(dir, 'files', file));
        faces.push({ family: f.family, weight: w, url: `${ORIGIN}/fonts/${file}`, ...(range ? { unicodeRange: range } : {}), file });
      }
    }
  }
  fontCache = { faces, files };
  return fontCache;
}
/** Families the page text names (case-insensitive); their faces are loaded before frame 0. A heuristic: a family named only inside a value is loaded when used. */
export function namedFamilies(page: string): Set<string> {
  const low = page.toLowerCase();
  return new Set(FONT_CATALOG.filter((f) => low.includes(f.family.toLowerCase())).map((f) => f.family));
}

/** The folder of a package installed for the renderer (found on its resolution paths; some packages, three among them, do not export package.json). */
export function packageDir(name: string): string | null {
  for (const base of rendererRequire.resolve.paths(name) ?? []) { const d = path.join(base, name); if (fs.existsSync(path.join(d, 'package.json'))) return d; }
  return null;
}
/** The installed version of a library row, or null (not installed). */
export function installedVersion(name: string): string | null {
  const d = packageDir(name);
  try { return d ? JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version ?? null : null; } catch { return null; }
}
/** Rows that are served: licence read and installed at exactly the pinned version. */
export function servedLibraries(rows: readonly MadeLibrary[] = MADE_LIBRARIES): MadeLibrary[] {
  return rows.filter((r) => r.licenceRead !== null && r.files.length > 0 && installedVersion(r.name) === r.version);
}
/** A library file for /lib/<name>@<version>/<file>, or null. Only files the row lists. */
export function libraryFile(urlPath: string, rows: readonly MadeLibrary[] = servedLibraries()): { file: string; library: string } | null {
  const m = /^\/lib\/((?:@[a-z0-9-]+\/)?[a-z0-9.-]+)@(\d+\.\d+\.\d+)\/(.+)$/.exec(urlPath);
  if (!m) return null;
  const row = rows.find((r) => r.name === m[1] && r.version === m[2]);
  if (!row || !row.files.includes(m[3]!)) return null;
  const d = packageDir(row.name);
  return d ? { file: path.join(d, m[3]!), library: `${row.name}@${row.version}` } : null;
}
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.css': 'text/css; charset=utf-8' };
export const typeOf = (file: string) => TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/** Internet addresses a page names (pure): http(s) URLs outside made.invalid, minus XML namespace URIs. At most fetchFiles + 1 are returned (the caller fails above the limit). */
export function namedAddresses(page: string): string[] {
  const out: string[] = [];
  for (const m of page.matchAll(/https?:\/\/[^\s"'`<>()\\]+/g)) {
    const u = m[0].replace(/[.,;]+$/, '');
    let host: string;
    try { host = new URL(u).hostname; } catch { continue; }
    if (host === 'made.invalid' || host === 'www.w3.org') continue;
    if (!out.includes(u)) out.push(u);
    if (out.length > MADE_LIMITS.fetchFiles) break;
  }
  return out;
}
/** The page with each fetched address replaced by its local copy (longest first, so one address inside another is not split). */
export function rewriteAddresses(page: string, fetched: readonly string[]): string {
  const order = fetched.map((u, i) => ({ u, i })).sort((a, b) => b.u.length - a.u.length);
  let out = page;
  for (const { u, i } of order) out = out.split(u).join(`${ORIGIN}/fetched/${i}`);
  return out;
}
/** Whether an IP address is on the public internet (not loopback, private, link-local, shared, unspecified or multicast). */
export function isPublicIp(ip: string): boolean {
  let a = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(a);
  if (mapped) a = mapped[1] ?? [parseInt(mapped[2]!, 16) >> 8, parseInt(mapped[2]!, 16) & 255, parseInt(mapped[3]!, 16) >> 8, parseInt(mapped[3]!, 16) & 255].join('.');
  if (net.isIPv4(a)) {
    const [x, y] = a.split('.').map(Number) as [number, number];
    return !(x === 0 || x === 10 || x === 127 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) || x >= 224);
  }
  if (net.isIPv6(a)) return !(a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a));
  return false;
}
export type Lookup = (host: string) => Promise<string[]>;
const systemLookup: Lookup = async (host) => (await dns.lookup(host, { all: true })).map((r) => r.address);
/** Whether the server may fetch this address: http(s), a public host (a name must resolve to public addresses only). */
export async function mayFetch(url: string, lookup: Lookup = systemLookup): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(host)) return isPublicIp(host);
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  try { const ips = await lookup(host); return ips.length > 0 && ips.every(isPublicIp); } catch { return true; /* not resolved here: the fetch itself fails and the job names the address (made_fetch_failed) */ }
}
/**
 * The addresses the server fetches, and those it leaves to the page (never fetched: the page's own request is aborted like any
 * other). Loopback, private and link-local addresses, local names and names that resolve to them are left: the editor's own port
 * and the owner's network stay unreachable through a page (found by proof:made G3.3–G3.5, where the server fetched 127.0.0.1).
 */
export async function publicAddresses(urls: readonly string[], lookup: Lookup = systemLookup): Promise<{ fetch: string[]; skipped: string[] }> {
  const fetch: string[] = []; const skipped: string[] = [];
  for (const u of urls) (await mayFetch(u, lookup) ? fetch : skipped).push(u);
  return { fetch, skipped };
}
export interface FetchedFile { url: string; sha256: string; bytes: number; body: Buffer; contentType: string }
export class MadeFetchError extends Error { constructor(readonly url: string, why: string) { super(`${url}: ${why}`); } }
/** Fetch each address once, before drawing; any failure (status, size, network, a redirect to a local address) names the address. */
export async function fetchOnce(urls: readonly string[], opts: { fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; lookup?: Lookup } = {}): Promise<FetchedFile[]> {
  if (urls.length > MADE_LIMITS.fetchFiles) throw new MadeFetchError(urls[MADE_LIMITS.fetchFiles]!, `a page may name at most ${MADE_LIMITS.fetchFiles} internet files`);
  const get = opts.fetch ?? fetch;
  const out: FetchedFile[] = [];
  let total = 0;
  for (const url of urls) {
    const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 30_000), ...(opts.signal ? [opts.signal] : [])]);
    let res: Response | null = null;
    let at = url;
    for (let hop = 0; hop <= 5; hop++) {
      if (!(await mayFetch(at, opts.lookup))) throw new MadeFetchError(url, `it leads to a local or private address (${at})`);
      try { res = await get(at, { redirect: 'manual', signal }); } catch (e: any) { throw new MadeFetchError(url, String(e?.message ?? e)); }
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      at = new URL(next, at).toString();
      res = null;
    }
    if (!res) throw new MadeFetchError(url, 'too many redirects');
    if (!res.ok) throw new MadeFetchError(url, `HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    total += body.length;
    if (total > MADE_LIMITS.fetchBytes) throw new MadeFetchError(url, `the internet files of a page may hold at most ${MADE_LIMITS.fetchBytes} bytes in all`);
    out.push({ url, body, bytes: body.length, sha256: `sha256:${createHash('sha256').update(body).digest('hex')}`, contentType: res.headers.get('content-type') ?? 'application/octet-stream' });
  }
  return out;
}
/** Asset ids a page names at https://made.invalid/assets/<id> (pure). */
export function namedAssetIds(page: string): string[] {
  return [...new Set([...page.matchAll(/made\.invalid\/assets\/([A-Za-z0-9_-]{1,64})/g)].map((m) => m[1]!))];
}

/** The route's file resolver for one draw. `asset(id)` returns the blob path and mime of an asset of the project, or null. */
export function madeFileResolver(o: { fetched: readonly FetchedFile[]; assets: ReadonlyMap<string, { file: string; mime: string }> }): (urlPath: string) => MadeServedFile | null {
  const fonts = madeFonts();
  const libs = servedLibraries();
  return (p) => {
    if (p.startsWith('/fonts/')) { const f = fonts.files.get(p.slice(7)); return f ? { body: fs.readFileSync(f), contentType: 'font/woff2' } : null; }
    if (p.startsWith('/lib/')) { const l = libraryFile(p, libs); return l ? { body: fs.readFileSync(l.file), contentType: typeOf(l.file) } : null; }
    if (p.startsWith('/fetched/')) { const f = o.fetched[Number(p.slice(9))]; return f && /^\d+$/.test(p.slice(9)) ? { body: f.body, contentType: f.contentType } : null; }
    if (p.startsWith('/assets/')) { const a = o.assets.get(p.slice(8)); return a ? { body: fs.readFileSync(a.file), contentType: a.mime } : null; }
    return null;
  };
}
/** `name@version` of the libraries a draw loaded, from the served paths. */
export const librariesServed = (served: readonly string[]): string[] => [...new Set(served.flatMap((p) => { const l = libraryFile(p); return l ? [l.library] : []; }))].sort();
