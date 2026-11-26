/**
 * LABELLED TEST DOUBLES of the stock sources (wave 8 `sources`): `double: openverse`, `double: pixabay`, `double: wikimedia` and
 * `double: link-host` (a file host). Each is a node:http server on a loopback address, port 0, started by a test or the proof and
 * closed by it. Wire shapes follow .artifacts/wave8/sources-research.md A1/A2 (read 2026-11-26) and the services' documented field
 * names; nothing here claims how the real services answer (their live answers are a laptop check, BLOCKERS S1). Every answer
 * carries `x-double: <name>`. No real service is ever contacted; no real media: the caller hands in synthetic bytes.
 *
 * The runtime reaches a double through SourcesDeps.test.baseUrls (the API base) and SourcesDeps.test.addressPolicy (doublePolicy
 * below): the safe downloader's DEFAULT policy refuses loopback, so the doubles listen on 127.0.0.9 (a loopback address of its own)
 * and the injected policy calls exactly that address "public" (and, if asked, another one "private", standing in for a home NAS),
 * leaving the default answer for every other address: 127.0.0.1, ::1, ::ffff:127.0.0.1, 169.254.169.254 and this machine's own
 * interface addresses stay refused.
 */
import { createHash } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The loopback address the doubles listen on (the injected policy calls it public). */
export const DOUBLE_HOST = '127.0.0.9';
/** A second loopback address the injected policy may call "private" (a stand-in for a 192.168.x.x NAS). */
export const DOUBLE_PRIVATE_HOST = '127.0.0.10';

/** The shape of sources/contract.ts AddressPolicy (kept structural: this module imports nothing of the server). */
export interface PolicyLike { classify(address: string, family: 4 | 6): 'refuse' | 'private' | 'public' }
/** LABELLED test policy: `publicAddrs` → public, `privateAddrs` → private, every other address → the given default policy. */
export function doublePolicy(fallback: PolicyLike, publicAddrs: readonly string[] = [DOUBLE_HOST], privateAddrs: readonly string[] = [DOUBLE_PRIVATE_HOST]): PolicyLike & { label: string } {
  return {
    label: 'double: address policy (tests and the proof only)',
    classify: (address, family) => (publicAddrs.includes(address) ? 'public' : privateAddrs.includes(address) ? 'private' : fallback.classify(address, family)),
  };
}

export interface SeenRequest { method: string; path: string; query: Record<string, string>; headers: Record<string, string | string[] | undefined>; body: string }
export interface Double { label: string; url: string; host: string; port: number; seen: SeenRequest[]; close(): Promise<void> }

async function start(label: string, handler: (req: IncomingMessage, res: ServerResponse, seen: SeenRequest) => void | Promise<void>, host = DOUBLE_HOST): Promise<Double> {
  const seen: SeenRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://double');
    let body = '';
    for await (const c of req) body += c;
    const s: SeenRequest = { method: req.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body };
    seen.push(s);
    res.setHeader('x-double', label.replace(/^double: /, ''));
    try { await handler(req, res, s); } catch (e) { if (!res.headersSent) { res.statusCode = 500; res.end(String(e)); } else res.destroy(); }
  });
  server.keepAliveTimeout = 100;
  await new Promise<void>((r, j) => { server.once('error', j); server.listen(0, host, () => r()); });
  const port = (server.address() as AddressInfo).port;
  return {
    label, host, port, url: `http://${host}:${port}`, seen,
    close: () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }),
  };
}
/** The double with live accessors onto its state (a test changes the state while the double runs). */
function live<D extends object, S extends object>(d: D, state: S, onSet: Partial<Record<keyof S, () => void>> = {}): D & S {
  for (const k of Object.keys(state) as (keyof S & string)[]) Object.defineProperty(d, k, { enumerable: true, get: () => state[k], set: (v) => { state[k] = v; onSet[k]?.(); } });
  return d as D & S;
}
const json = (res: ServerResponse, status: number, v: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(v)); };

// ---------------------------------------------------------------- double: link-host (files)
export interface HostedFile {
  bytes: Buffer; contentType?: string; etag?: string | null; lastModified?: string | null;
  /** the first N answers of this path are cut after this many body bytes (the connection is destroyed) */ cutAfterBytes?: number; cutTimes?: number;
  /**
   * Content-Length sent instead of the real one (a lying server). Node's HTTP parser never hands a client more than a declared
   * length, so a LOW lie ends the body at that length (a short file); a HIGH one is refused by the downloader before any byte.
   */ lieContentLength?: number;
  /** no Content-Length at all (chunked): the size is unknown until the end, so only the cap while streaming can stop it */ noContentLength?: boolean;
  /** answer 200 with the whole file even when a Range is asked */ ignoreRange?: boolean;
  /** redirect to this absolute URL */ redirectTo?: string;
  /** stop sending after this many bytes and keep the connection open (an idle server) */ stallAfterBytes?: number;
  /** called after the n-th answer of this path has been written (a test changes the file between two requests) */ onAnswer?: (n: number, f: HostedFile) => void;
}
export interface LinkHost extends Double { files: Map<string, HostedFile>; put(path: string, f: HostedFile): string }
/** `double: link-host`: serves the files put into it, with ETag, Last-Modified, Range and If-Range, and the faults asked for. */
export async function startLinkHost(host = DOUBLE_HOST): Promise<LinkHost> {
  const files = new Map<string, HostedFile>();
  const answered = new Map<string, number>();
  const d = await start('double: link-host', (req, res, s) => {
    const f = files.get(s.path);
    if (!f) { res.writeHead(404, { 'content-type': 'text/plain' }); return void res.end('not here'); }
    if (f.redirectTo) { res.writeHead(302, { location: f.redirectTo }); return void res.end(); }
    const n = (answered.get(s.path) ?? 0) + 1;
    answered.set(s.path, n);
    const etag = f.etag === undefined ? `"${createHash('sha256').update(f.bytes).digest('hex').slice(0, 16)}"` : f.etag;
    const lm = f.lastModified === undefined ? 'Wed, 25 Nov 2026 10:00:00 GMT' : f.lastModified;
    const base: Record<string, string> = { 'content-type': f.contentType ?? 'application/octet-stream', 'accept-ranges': 'bytes', ...(etag ? { etag } : {}), ...(lm ? { 'last-modified': lm } : {}) };
    const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
    const ifRange = req.headers['if-range'];
    const rangeOk = range && !f.ignoreRange && (!ifRange || ifRange === etag || ifRange === lm);
    let start = 0, end = f.bytes.length - 1, status = 200;
    if (rangeOk) {
      start = Number(range![1]); end = range![2] ? Math.min(Number(range![2]), end) : end;
      if (start > end) { res.writeHead(416, { 'content-range': `bytes */${f.bytes.length}` }); return void res.end(); }
      status = 206; base['content-range'] = `bytes ${start}-${end}/${f.bytes.length}`;
    }
    const slice = f.bytes.subarray(start, end + 1);
    const cut = f.cutAfterBytes !== undefined && n <= (f.cutTimes ?? 1);
    f.onAnswer?.(n, f); // the answer below is already decided; a change applies to the next request
    if (!f.noContentLength) base['content-length'] = String(f.lieContentLength ?? slice.length);
    res.writeHead(status, base);
    if (req.method === 'HEAD') return void res.end();
    if (f.stallAfterBytes !== undefined) { res.write(slice.subarray(0, f.stallAfterBytes)); return; } // never ends: the client's idle timer must
    if (cut) { res.write(slice.subarray(0, f.cutAfterBytes), () => res.destroy()); return; }
    if (f.lieContentLength !== undefined && f.lieContentLength < slice.length) { res.write(slice.subarray(0, f.lieContentLength), () => res.destroy()); return; }
    res.end(slice);
  }, host);
  return Object.assign(d, { files, put: (p: string, f: HostedFile) => { files.set(p, f); return `${d.url}${p}`; } });
}

// ---------------------------------------------------------------- double: openverse
export interface OpenverseItem { id: string; media: 'images' | 'audio'; title: string; creator: string | null; license: string; license_version: string; fileUrl: string; thumbnail?: string | null; filetype?: string; filesize?: number | null; duration?: number | null; width?: number | null; height?: number | null; category?: string }
export interface OpenverseDouble extends Double { items: OpenverseItem[]; /** answer 429 once this many search/item calls were made (null = never) */ limitAfter: number | null; retryAfter: string; client: { id: string; secret: string; token: string } }
/** `double: openverse`: /v1/images/, /v1/audio/ (search), /v1/{images,audio}/<id>/ (item), POST /v1/auth_tokens/token/. */
export async function startOpenverseDouble(items: OpenverseItem[] = []): Promise<OpenverseDouble> {
  let calls = 0;
  const state = { items, limitAfter: null as number | null, retryAfter: '1800', client: { id: 'double-client-id', secret: 'double-client-secret', token: 'double-access-token' } };
  const row = (it: OpenverseItem) => {
    const licUrl = it.license === 'cc0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : it.license === 'pdm' ? 'https://creativecommons.org/publicdomain/mark/1.0/' : `https://creativecommons.org/licenses/${it.license}/${it.license_version}/`;
    const licName = it.license === 'cc0' ? 'CC0 1.0' : it.license === 'pdm' ? 'Public Domain Mark 1.0' : `CC ${it.license.toUpperCase()} ${it.license_version}`;
    return {
      id: it.id, title: it.title, foreign_landing_url: `https://example.invalid/landing/${it.id}`, url: it.fileUrl, creator: it.creator, creator_url: null,
      license: it.license, license_version: it.license_version, license_url: licUrl, provider: 'double', source: 'double', category: it.category ?? null,
      filesize: it.filesize ?? null, filetype: it.filetype ?? null, tags: [], mature: false, width: it.width ?? null, height: it.height ?? null,
      thumbnail: it.thumbnail ?? null, detail_url: `/v1/${it.media}/${it.id}/`, related_url: `/v1/${it.media}/${it.id}/related/`,
      attribution: `"${it.title}" by ${it.creator ?? 'Unknown'} is licensed under ${licName}. To view a copy of this license, visit ${licUrl}.`,
      ...(it.media === 'audio' ? { duration: it.duration ?? null, genres: [], alt_files: null, bit_rate: null, sample_rate: null } : {}),
    };
  };
  const d = await start('double: openverse', (req, res, s) => {
    if (s.method === 'POST' && s.path === '/v1/auth_tokens/token/') {
      const f = new URLSearchParams(s.body);
      if (f.get('grant_type') === 'client_credentials' && f.get('client_id') === state.client.id && f.get('client_secret') === state.client.secret) return json(res, 200, { access_token: state.client.token, scope: 'read write groups', expires_in: 36000, token_type: 'Bearer' });
      return json(res, 401, { detail: 'invalid client' });
    }
    if (req.headers.authorization && req.headers.authorization !== `Bearer ${state.client.token}`) return json(res, 401, { detail: 'Authentication credentials were not provided.' });
    calls++;
    if (state.limitAfter !== null && calls > state.limitAfter) return json(res, 429, { detail: 'Request was throttled.' }, { 'retry-after': state.retryAfter });
    const m = /^\/v1\/(images|audio)\/(?:([^/]+)\/)?$/.exec(s.path);
    if (!m) return json(res, 404, { detail: 'Not found.' });
    if (m[2]) { const it = state.items.find((x) => x.id === m[2] && x.media === m[1]); return it ? json(res, 200, row(it)) : json(res, 404, { detail: 'Not found.' }); }
    const q = (s.query.q ?? '').toLowerCase();
    const hits = state.items.filter((x) => x.media === m[1] && (!q || x.title.toLowerCase().includes(q) || q.split(/\s+/).some((w) => x.title.toLowerCase().includes(w))));
    const size = Number(s.query.page_size ?? 20), page = Number(s.query.page ?? 1);
    json(res, 200, { result_count: hits.length, page_count: Math.max(1, Math.ceil(hits.length / size)), page_size: size, page, results: hits.slice((page - 1) * size, page * size).map(row), warnings: [] });
  });
  return live(d, state, { limitAfter: () => { calls = 0; } });
}

// ---------------------------------------------------------------- double: pixabay
export interface PixabayItem { id: number; type: 'photo' | 'illustration' | 'film'; tags: string; user: string; fileUrl: string; previewUrl?: string; size?: number; width?: number; height?: number; duration?: number }
export interface PixabayDouble extends Double { items: PixabayItem[]; key: string; /** the status answered for a wrong key (unconfirmed: a laptop check) */ wrongKeyStatus: number }
/** `double: pixabay`: GET /api/ (pictures) and /api/videos/ with `key`, `q`, `id`, filters. */
export async function startPixabayDouble(key: string, items: PixabayItem[] = []): Promise<PixabayDouble> {
  const state = { items, key, wrongKeyStatus: 401 };
  const d = await start('double: pixabay', (_req, res, s) => {
    if (s.query.key !== state.key) { res.writeHead(state.wrongKeyStatus, { 'content-type': 'text/plain' }); return void res.end('[ERROR 400] "key" is invalid.'); }
    const video = s.path === '/api/videos/';
    if (!video && s.path !== '/api/') return json(res, 404, {});
    let hits = state.items.filter((x) => (video ? x.type === 'film' : x.type !== 'film'));
    if (s.query.id) hits = hits.filter((x) => String(x.id) === s.query.id);
    else if (s.query.q) { const words = s.query.q.toLowerCase().split(/[\s+]+/); hits = hits.filter((x) => words.some((w) => x.tags.includes(w))); }
    if (!video && s.query.image_type && s.query.image_type !== 'all') hits = hits.filter((x) => x.type === s.query.image_type);
    const per = Number(s.query.per_page ?? 20), page = Number(s.query.page ?? 1);
    const out = hits.slice((page - 1) * per, page * per).map((x) => video
      ? { id: x.id, pageURL: `https://pixabay.example.invalid/videos/${x.id}/`, type: 'film', tags: x.tags, duration: x.duration ?? 2, user_id: 1, user: x.user, userImageURL: '',
        videos: { large: { url: x.fileUrl, width: x.width ?? 320, height: x.height ?? 180, size: x.size ?? 0, thumbnail: x.previewUrl ?? '' }, medium: { url: x.fileUrl, width: x.width ?? 320, height: x.height ?? 180, size: x.size ?? 0, thumbnail: x.previewUrl ?? '' }, small: { url: x.fileUrl, width: 160, height: 90, size: x.size ?? 0, thumbnail: x.previewUrl ?? '' }, tiny: { url: x.fileUrl, width: 160, height: 90, size: x.size ?? 0, thumbnail: x.previewUrl ?? '' } } }
      : { id: x.id, pageURL: `https://pixabay.example.invalid/photos/${x.id}/`, type: x.type, tags: x.tags, previewURL: x.previewUrl ?? x.fileUrl, previewWidth: 150, previewHeight: 84, webformatURL: x.previewUrl ?? x.fileUrl, webformatWidth: 640, webformatHeight: 360,
        largeImageURL: x.fileUrl, imageWidth: x.width ?? 64, imageHeight: x.height ?? 64, imageSize: x.size ?? 0, views: 0, downloads: 0, likes: 0, comments: 0, user_id: 1, user: x.user, userImageURL: '' });
    json(res, 200, { total: hits.length, totalHits: hits.length, hits: out }, { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '99', 'x-ratelimit-reset': '60' });
  });
  return live(d, state);
}

// ---------------------------------------------------------------- double: wikimedia
export interface CommonsItem { pageid: number; title: string; fileUrl: string; thumbUrl?: string; mime: string; mediatype: string; size?: number; width?: number; height?: number; duration?: number; extmetadata: Record<string, { value: string }> }
export interface WikimediaDouble extends Double { items: CommonsItem[] }
/** `double: wikimedia`: GET /w/api.php?action=query (generator=search, or pageids=). */
export async function startWikimediaDouble(items: CommonsItem[] = []): Promise<WikimediaDouble> {
  const state = { items };
  const d = await start('double: wikimedia', (_req, res, s) => {
    if (s.path !== '/w/api.php' || s.query.action !== 'query') return json(res, 400, { error: { code: 'badparams' } });
    let hits = state.items;
    if (s.query.pageids) hits = hits.filter((x) => s.query.pageids!.split('|').includes(String(x.pageid)));
    else { const words = (s.query.gsrsearch ?? '').toLowerCase().replace(/filetype:\S+/g, '').split(/\s+/).filter(Boolean); hits = hits.filter((x) => words.some((w) => x.title.toLowerCase().includes(w))); }
    const off = Number(s.query.gsroffset ?? 0), lim = Number(s.query.gsrlimit ?? 20);
    const page = s.query.pageids ? hits : hits.slice(off, off + lim);
    const pages = Object.fromEntries(page.map((x, i) => [String(x.pageid), { pageid: x.pageid, ns: 6, title: x.title, index: off + i + 1, imagerepository: 'local',
      imageinfo: [{ url: x.fileUrl, descriptionurl: `https://commons.example.invalid/wiki/${encodeURIComponent(x.title)}`, thumburl: x.thumbUrl ?? x.fileUrl, size: x.size ?? 0, width: x.width ?? 0, height: x.height ?? 0, ...(x.duration ? { duration: x.duration } : {}), mime: x.mime, mediatype: x.mediatype, extmetadata: x.extmetadata }] }]));
    json(res, 200, { batchcomplete: '', ...(!s.query.pageids && off + lim < hits.length ? { continue: { gsroffset: off + lim, continue: 'gsroffset||' } } : {}), ...(page.length ? { query: { pages } } : {}) });
  });
  return live(d, state);
}
