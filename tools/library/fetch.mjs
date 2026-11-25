// Library fetcher: one self-contained file for Node >= 22 (built-in modules only, no build step).
//   node fetch.mjs --root <library folder> --manifest <file.json> [--dry-run] [--only id,id] [--skip id,id]
//                  [--max-gb n] [--delay-ms n] [--verify]
// Everything is downloaded under <root>/_downloads-in-progress, verified, then renamed into place.
// Downloaded content is data: it is never executed, imported or passed to an interpreter.
// The only external program started is `git` (for items of kind "git"). See README.md next to this file.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const VERSION = 1;
const UA = 'library-fetch/1 (node)';
export const LIB_DIRS = ['music', 'sounds', 'visual', 'models', 'instruments'];
const STAGE = '_downloads-in-progress', META = '_manifests';
const MiB = 2 ** 20, GiB = 2 ** 30;
const LONG_PATH = 240; // absolute paths longer than this are written, counted and reported (see README)
const FLAGS = ['diskOnly', 'creditInExport', 'shareAlike', 'people', 'aiGenerated', 'repoAllowed'];
const OPT_FLAGS = ['needsOwnerKey', 'trademark', 'personalOnly'];
const USAGE = `usage: node fetch.mjs --root <library folder> --manifest <file.json>
       [--dry-run] [--only id,id] [--skip id,id] [--max-gb n (default 100)] [--delay-ms n (default 500)] [--verify]
  ids are item ids or source ids. Exit code: 0 all present, 1 an item failed or was refused, 2 bad arguments or manifest.`;

export class Fail extends Error {
  constructor(msg, retryable = false) { super(msg); this.retryable = retryable; }
}
export const fmt = (n) => n == null ? 'size unknown' : n >= GiB ? `${(n / GiB).toFixed(2)} GiB` : n >= MiB ? `${(n / MiB).toFixed(1)} MiB` : `${n} B`;
const exists = (p) => fs.existsSync(p);
const sizeOf = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
const rmrf = (p) => fsp.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- arguments
export function parseArgs(argv) {
  const o = { dryRun: false, verify: false, maxGb: 100, delayMs: 500, only: null, skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Fail(`${a} needs a value`); return argv[++i]; };
    if (a === '--root') o.root = val();
    else if (a === '--manifest') o.manifest = val();
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--verify') o.verify = true;
    else if (a === '--only') o.only = val().split(',').filter(Boolean);
    else if (a === '--skip') o.skip = val().split(',').filter(Boolean);
    else if (a === '--max-gb') o.maxGb = Number(val());
    else if (a === '--delay-ms') o.delayMs = Number(val());
    else throw new Fail(`unknown option ${a}`);
  }
  if (!o.root || !o.manifest) throw new Fail('--root and --manifest are required');
  if (!(o.maxGb > 0)) throw new Fail('--max-gb must be a positive number');
  if (!(o.delayMs >= 0)) throw new Fail('--delay-ms must be zero or more');
  return o;
}

// ---------------------------------------------------------------- names and paths
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** One path segment made safe for Windows: no <>:"|?* or control characters, no trailing dot or space, no device name. */
export function sanitizeSegment(s) {
  let t = String(s).replace(/[<>:"|?*\\/\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (!t) t = '_';
  if (RESERVED.test(t)) t = '_' + t;
  if (t.length > 200) {
    const ext = /\.[A-Za-z0-9]{1,10}$/.exec(t)?.[0] ?? '';
    t = t.slice(0, 180) + '~' + crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8) + ext;
  }
  return t;
}
/** A manifest destination: relative, forward slashes, already Windows-safe, inside one of the library folders. */
export function checkDest(rel) {
  if (typeof rel !== 'string' || !rel) return 'must be a non-empty string';
  if (rel.includes('\\') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return 'must be relative with forward slashes (no drive, no backslash)';
  if (rel.length > 120) return 'is longer than 120 characters';
  const segs = rel.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return 'has an empty, "." or ".." segment';
    if (sanitizeSegment(s) !== s) return `segment "${s}" is not a Windows-safe name`;
  }
  if (!LIB_DIRS.includes(segs[0])) return `must start with one of ${LIB_DIRS.join(', ')}`;
  if (segs.length < 2) return 'must name something inside a library folder';
  return null;
}
/**
 * Archive entry name -> safe relative path (posix), or null when filtered out by strip/keep.
 * Absolute paths, drive letters and ".." are refused (throws): the whole archive is then rejected.
 * `seen` (a Map) makes names unique on a case-insensitive file system; renames are counted in seen.renamed.
 */
export function entryPath(name, { strip = 0, keep = null, seen = null } = {}) {
  if (/^[\\/]+$/.test(name)) return null; // a bare "/" folder entry (some services start their zips with one) is the destination itself
  if (name.includes('\0') || /^[\\/]/.test(name) || /^[A-Za-z]:/.test(name)) throw new Fail(`archive entry refused (absolute path or drive letter): ${JSON.stringify(name)}`);
  let segs = name.split(/[\\/]/).filter((s) => s !== '' && s !== '.');
  if (segs.includes('..')) throw new Fail(`archive entry refused (".." in path): ${JSON.stringify(name)}`);
  if (segs.length <= strip) return null;
  segs = segs.slice(strip);
  const raw = segs.join('/');
  if (keep && !keep.some((k) => raw === k.replace(/\/$/, '') || raw.startsWith(k.endsWith('/') ? k : k + '/'))) return null;
  let rel = segs.map(sanitizeSegment).join('/');
  if (seen) {
    const base = rel;
    for (let n = 2; seen.has(rel.toLowerCase()) && seen.get(rel.toLowerCase()) !== name; n++) {
      const dot = base.lastIndexOf('.'), cut = dot > base.lastIndexOf('/') + 1 ? dot : base.length;
      rel = `${base.slice(0, cut)}~${n}${base.slice(cut)}`;
    }
    if (rel !== base) seen.renamed = (seen.renamed || 0) + 1;
    seen.set(rel.toLowerCase(), name);
  }
  return rel;
}

// ---------------------------------------------------------------- manifest
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/, DATE = /^\d{4}-\d{2}-\d{2}$/, HEX64 = /^[0-9a-f]{64}$/;
const ITEM_KEYS = {
  file: ['url', 'sha256', 'bytes'],
  archive: ['url', 'format', 'sha256', 'bytes', 'approxUnpackedBytes', 'strip', 'keep'],
  npm: ['name', 'version', 'integrity', 'bytes', 'approxUnpackedBytes', 'keep'],
  git: ['repo', 'commit', 'sparse', 'sparseNoCone', 'approxBytes'],
};
/** Returns { errors: string[], items: [{ src, item }] }. A manifest with errors is never run. */
export function validateManifest(m, { insecureOk = false } = {}) {
  const errors = [], items = [];
  const E = (where, msg) => errors.push(`${where}: ${msg}`);
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => typeof v === 'string' && v.trim() !== '';
  const posInt = (v) => Number.isSafeInteger(v) && v > 0;
  const keys = (w, o, allowed) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) E(w, `unknown field "${k}"`); };
  const url = (w, v, protos = ['https:']) => {
    let u; try { u = new URL(v); } catch { return E(w, 'is not a URL'); }
    if (u.username || u.password) return E(w, 'must not carry a user name or password');
    if (!protos.includes(u.protocol) && !(insecureOk && ['http:', 'file:'].includes(u.protocol))) E(w, `only https: URLs are fetched (got ${u.protocol})`);
  };
  if (!isObj(m)) return { errors: ['manifest: must be a JSON object'], items };
  if (Object.keys(m)[0] !== 'manifestVersion') E('manifest', '"manifestVersion" must be the first field');
  if (m.manifestVersion !== VERSION) E('manifest', `manifestVersion must be ${VERSION}`);
  keys('manifest', m, ['manifestVersion', 'id', 'title', 'created', 'notes', 'sources']);
  if (!ID.test(m.id ?? '')) E('manifest', 'id must match [a-z0-9][a-z0-9._-]*');
  if (!str(m.title)) E('manifest', 'title is required');
  if (!DATE.test(m.created ?? '')) E('manifest', 'created must be YYYY-MM-DD');
  if (!Array.isArray(m.sources) || !m.sources.length) { E('manifest', 'sources must be a non-empty list'); return { errors, items }; }
  const srcIds = new Set(), itemIds = new Set(), dests = [];
  m.sources.forEach((s, si) => {
    const w = `source ${isObj(s) && s.id ? s.id : '#' + si}`;
    if (!isObj(s)) return E(w, 'must be an object');
    keys(w, s, ['id', 'title', 'homepage', 'licence', 'credit', ...FLAGS, ...OPT_FLAGS, 'notes', 'items']);
    if (!ID.test(s.id ?? '')) E(w, 'id must match [a-z0-9][a-z0-9._-]*');
    else if (srcIds.has(s.id)) E(w, 'duplicate source id'); else srcIds.add(s.id);
    if (!str(s.title)) E(w, 'title is required');
    if (s.homepage !== undefined) url(`${w} homepage`, s.homepage);
    const L = s.licence;
    if (!isObj(L)) E(w, 'licence is required');
    else {
      keys(`${w} licence`, L, ['spdx', 'custom', 'url', 'readOn', 'quote']);
      if (str(L.spdx) === str(L.custom)) E(w, 'licence needs exactly one of "spdx" or "custom"');
      url(`${w} licence.url`, L.url);
      if (!DATE.test(L.readOn ?? '')) E(w, 'licence.readOn must be YYYY-MM-DD');
      if (!str(L.quote)) E(w, 'licence.quote (the publisher\'s own words) is required');
    }
    if (!('credit' in s) || !(s.credit === null || str(s.credit))) E(w, 'credit must be the exact credit line, or null');
    for (const f of FLAGS) if (typeof s[f] !== 'boolean') E(w, `flag "${f}" must be true or false`);
    for (const f of OPT_FLAGS) if (s[f] !== undefined && typeof s[f] !== 'boolean') E(w, `flag "${f}" must be true or false`);
    if (s.creditInExport === true && !str(s.credit)) E(w, 'creditInExport needs a credit line');
    if (s.diskOnly === true && s.repoAllowed === true) E(w, 'diskOnly and repoAllowed cannot both be true');
    if (s.notes !== undefined && typeof s.notes !== 'string') E(w, 'notes must be text');
    if (!Array.isArray(s.items) || !s.items.length) return E(w, 'items must be a non-empty list');
    s.items.forEach((it, ii) => {
      const iw = `item ${isObj(it) && it.id ? it.id : `${w}#${ii}`}`;
      if (!isObj(it)) return E(iw, 'must be an object');
      if (typeof it.id !== 'string' || it.id.length > 100 || !it.id.split('/').every((p) => ID.test(p))) E(iw, 'id must be lower-case segments [a-z0-9._-] joined by "/"');
      else if (itemIds.has(it.id) || srcIds.has(it.id) && it.id !== s.id) E(iw, 'duplicate id'); else itemIds.add(it.id);
      if (!ITEM_KEYS[it.kind]) return E(iw, 'kind must be file, archive, npm or git');
      keys(iw, it, ['id', 'kind', 'dest', 'notes', ...ITEM_KEYS[it.kind]]);
      const d = checkDest(it.dest);
      if (d) E(iw, `dest ${d}`); else dests.push([it.dest.toLowerCase(), iw]);
      if (it.sha256 !== undefined && !HEX64.test(it.sha256)) E(iw, 'sha256 must be 64 lower-case hex digits');
      for (const k of ['bytes', 'approxUnpackedBytes', 'approxBytes']) if (it[k] !== undefined && !posInt(it[k])) E(iw, `${k} must be a positive whole number`);
      if (it.keep !== undefined && !(Array.isArray(it.keep) && it.keep.length && it.keep.every((k) => str(k) && !/^[\\/]|\\|(^|\/)\.\.?(\/|$)/.test(k)))) E(iw, 'keep must be a list of relative path prefixes');
      if (it.kind === 'file' || it.kind === 'archive') url(`${iw} url`, it.url);
      if (it.kind === 'archive') {
        if (!['zip', 'tar.gz'].includes(it.format)) E(iw, 'format must be "zip" or "tar.gz"');
        if (it.strip !== undefined && !(Number.isInteger(it.strip) && it.strip >= 0 && it.strip <= 8)) E(iw, 'strip must be 0..8');
      }
      if (it.kind === 'npm') {
        if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(it.name ?? '')) E(iw, 'name is not an npm package name');
        if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(it.version ?? '')) E(iw, 'version must be exact (1.2.3), not a range or tag');
        if (it.integrity !== undefined && !/^sha512-[A-Za-z0-9+/]{86}==$/.test(it.integrity)) E(iw, 'integrity must be an npm sha512 value');
      }
      if (it.kind === 'git') {
        url(`${iw} repo`, it.repo);
        if (!/^[0-9a-f]{40}$/.test(it.commit ?? '')) E(iw, 'commit must be the full 40-digit sha');
        if (!posInt(it.approxBytes)) E(iw, 'approxBytes (size estimate for the budget) is required');
        if (it.sparse !== undefined && !(Array.isArray(it.sparse) && it.sparse.length && it.sparse.every((p) => str(p) && !p.startsWith('-') && !/\\|(^|\/)\.\.(\/|$)|[\n\r\0]/.test(p)))) E(iw, 'sparse must be a list of repository paths');
        if (it.sparseNoCone !== undefined && typeof it.sparseNoCone !== 'boolean') E(iw, 'sparseNoCone must be true or false');
      }
      items.push({ src: s, item: it });
    });
  });
  dests.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (let i = 1; i < dests.length; i++) {
    const [a, wa] = dests[i - 1], [b, wb] = dests[i];
    if (a === b || b.startsWith(a + '/')) E(wb, `dest overlaps the dest of ${wa}`);
  }
  return { errors, items };
}

// ---------------------------------------------------------------- budget
/** The byte budget counts what is already in the library, what running items reserved, and this item's need. */
export function budgetCheck({ budget, used, reserved = 0, need = 0 }) {
  const after = used + reserved + need;
  if (after <= budget) return { ok: true, after };
  return { ok: false, after, reason: `byte budget: ${fmt(used)} already in the library + ${fmt(reserved)} in progress + ${fmt(need)} for this item is more than --max-gb ${fmt(budget)}` };
}
/** Bytes an item is expected to add while it runs (download plus unpacked copy). Unknown parts count as 0. */
export function itemNeed(item, probe = {}) {
  const dl = item.bytes ?? probe.bytes ?? 0;
  if (item.kind === 'file') return dl;
  if (item.kind === 'git') return item.approxBytes;
  return dl + (item.approxUnpackedBytes ?? probe.unpackedBytes ?? dl);
}

// ---------------------------------------------------------------- hashing and trees
async function hashFile(p, algos = ['sha256']) {
  const hs = algos.map((a) => crypto.createHash(a));
  let bytes = 0;
  for await (const c of fs.createReadStream(p)) { bytes += c.length; for (const h of hs) h.update(c); }
  return { bytes, digests: hs.map((h) => h.digest()) };
}
export const sha256File = async (p) => (await hashFile(p)).digests[0].toString('hex');
async function walk(dir, { skipGit = false } = {}) {
  const out = [];
  const rec = async (abs, rel) => {
    for (const e of await fsp.readdir(abs, { withFileTypes: true })) {
      if (skipGit && !rel && e.name === '.git') continue;
      const a = path.join(abs, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await rec(a, r);
      else if (e.isFile()) out.push({ rel: r, abs: a, size: (await fsp.stat(a)).size });
    }
  };
  await rec(dir, '');
  return out.sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0));
}
/** sha256 over "path<TAB>size<TAB>sha256" lines of every file, sorted; a top-level .git folder is left out. */
export async function hashTree(dir, root = dir) {
  const h = crypto.createHash('sha256');
  let files = 0, bytes = 0, longPaths = 0;
  for (const f of await walk(dir, { skipGit: true })) {
    h.update(`${f.rel}\t${f.size}\t${await sha256File(f.abs)}\n`);
    files++; bytes += f.size;
    if (path.join(root, f.rel).length > LONG_PATH) longPaths++;
  }
  return { files, bytes, longPaths, sha256: h.digest('hex') };
}
export async function dirBytes(dir) {
  let n = 0;
  if (exists(dir)) for (const f of await walk(dir)) n += f.size;
  return n;
}

// ---------------------------------------------------------------- network
export function makeTransport(mod, proto) {
  return (url, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    if (url.protocol !== proto) return reject(new Fail(`only ${proto} URLs are fetched (got ${url.protocol}//${url.host})`));
    const req = mod.request(url, { method, headers, timeout: 60000 }, (res) => resolve({ status: res.statusCode, headers: res.headers, body: res }));
    req.on('timeout', () => req.destroy(Object.assign(new Error('no data for 60 s'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}
export const httpsTransport = makeTransport(https, 'https:');
const NET_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED', 'ERR_STREAM_PREMATURE_CLOSE', 'UND_ERR_SOCKET']);
const httpFail = (res, what) => {
  const ra = Number(res.headers['retry-after']);
  const e = new Fail(`HTTP ${res.status} for ${what}`, res.status >= 500 || res.status === 429 || res.status === 408);
  if (ra > 0) e.retryAfterMs = Math.min(ra, 60) * 1000;
  return e;
};
/**
 * Polite client: https only (redirects too), no cookies, no credentials, a generic User-Agent,
 * at most `perHost` open requests per host, `delayMs` between request starts to one host, retries with backoff.
 */
export function makeNet({ transport = httpsTransport, sleep = realSleep, now = Date.now, delayMs = 500, perHost = 2, retries = 4, insecureOk = false, log = () => {} } = {}) {
  const hosts = new Map();
  async function acquire(host) {
    let h = hosts.get(host);
    if (!h) hosts.set(host, (h = { active: 0, next: 0, q: [] }));
    if (h.active >= perHost) await new Promise((r) => h.q.push(r)); else h.active++;
    const wait = h.next - now();
    h.next = Math.max(now(), h.next) + delayMs;
    if (wait > 0) await sleep(wait);
    let done = false;
    return () => { if (done) return; done = true; const r = h.q.shift(); if (r) r(); else h.active--; };
  }
  const checkUrl = (u) => {
    if (u.protocol !== 'https:' && !(insecureOk && u.protocol === 'http:')) throw new Fail(`only https: URLs are fetched (got ${u.protocol}//${u.host})`);
    if (u.username || u.password) throw new Fail('URLs with a user name or password are not fetched');
  };
  /** Runs fn(response, finalUrl) while holding the host slot; follows up to 5 redirects, each checked. */
  async function withResponse(url, { method = 'GET', headers = {} } = {}, fn) {
    let u = new URL(url);
    for (let hop = 0; hop <= 5; hop++) {
      checkUrl(u);
      const release = await acquire(u.host);
      try {
        const res = await transport(u, { method, headers: { 'user-agent': UA, accept: '*/*', 'accept-encoding': 'identity', ...headers } });
        if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
          res.body.resume();
          u = new URL(res.headers.location, u);
          continue;
        }
        const ce = res.headers['content-encoding'];
        if (ce && ce !== 'identity') { res.body.resume(); throw new Fail(`${u.host} sent "${ce}"-encoded bytes although plain bytes were asked for; not stored`); }
        return await fn(res, u);
      } finally { release(); }
    }
    throw new Fail(`too many redirects for ${url}`);
  }
  async function retrying(what, fn) {
    for (let attempt = 1; ; attempt++) {
      try { return await fn(attempt); } catch (e) {
        if (!(e.retryable === true || NET_CODES.has(e.code)) || attempt >= retries) throw e;
        const wait = e.retryAfterMs ?? 1000 * 2 ** (attempt - 1);
        log(`  retry ${attempt}/${retries - 1} for ${what} in ${wait} ms: ${e.message}`);
        await sleep(wait);
      }
    }
  }
  /** Small body into memory (metadata, licence text). */
  const getBuffer = (url, max = 8 * MiB) => retrying(url, () => withResponse(url, {}, async (res) => {
    if (res.status !== 200) { res.body.resume(); throw httpFail(res, url); }
    const chunks = []; let n = 0;
    for await (const c of res.body) { n += c.length; if (n > max) { res.body.destroy(); throw new Fail(`${url} is larger than ${fmt(max)}`); } chunks.push(c); }
    return { body: Buffer.concat(chunks), type: res.headers['content-type'] ?? null };
  }));
  /** Size without downloading: HEAD, or a one-byte range request when HEAD gives none. null when unknown. */
  async function probeSize(url) {
    try {
      const n = await retrying(url, () => withResponse(url, { method: 'HEAD' }, async (res) => { res.body.resume(); return res.status === 200 && res.headers['content-length'] ? Number(res.headers['content-length']) : null; }));
      if (n != null) return n;
      return await retrying(url, () => withResponse(url, { headers: { range: 'bytes=0-0' } }, async (res) => {
        res.body.destroy();
        const m = /\/(\d+)$/.exec(res.headers['content-range'] ?? '');
        return res.status === 206 && m ? Number(m[1]) : null;
      }));
    } catch { return null; }
  }
  return { acquire, withResponse, retrying, getBuffer, probeSize };
}

// ---------------------------------------------------------------- resumable download
/** Range headers for a partial file: only when the first response gave a strong ETag for the same URL. */
export function resumeHeaders(have, meta, url) {
  if (!have || !meta || meta.url !== url || !meta.etag || meta.etag.startsWith('W/')) return {};
  return { range: `bytes=${have}-`, 'if-range': meta.etag };
}
/** What to do with the response to a (possibly ranged) request. */
export function resumeDecision({ have, ranged, status, contentRange, etag, meta }) {
  if (status === 200) return 'restart';
  if (status === 206 && ranged) {
    const m = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(contentRange ?? '');
    if (m && Number(m[1]) === have && (!etag || etag === meta?.etag)) return 'append';
    return 'discard';
  }
  if (status === 416 && ranged) return 'discard';
  return 'error';
}
/** Downloads url to `part` (resuming a previous partial file when the server allows). Returns { bytes }. */
export async function download(net, url, part, { tick = () => {}, log = () => {} } = {}) {
  const metaFile = part + '.json';
  return net.retrying(url, async () => {
    let meta = null;
    try { meta = JSON.parse(await fsp.readFile(metaFile, 'utf8')); } catch { /* no usable record */ }
    let have = sizeOf(part);
    const rh = resumeHeaders(have, meta, url), ranged = !!rh.range;
    if (ranged && meta.total === have) return { bytes: have }; // finished earlier; the caller verifies it
    if (have && !ranged) { await rmrf(part); have = 0; }
    return net.withResponse(url, { headers: rh }, async (res) => {
      const what = resumeDecision({ have, ranged, status: res.status, contentRange: res.headers['content-range'], etag: res.headers.etag, meta });
      if (what === 'error') { res.body.resume(); throw httpFail(res, url); }
      if (what === 'discard') { res.body.resume(); await rmrf(part); await rmrf(metaFile); throw new Fail('the partial download no longer matches the server; starting again', true); }
      if (what === 'restart') have = 0; else log(`  resuming at ${fmt(have)}`);
      const len = res.headers['content-length'] ? Number(res.headers['content-length']) : null;
      const total = len == null ? null : have + len;
      await fsp.writeFile(metaFile, JSON.stringify({ url, etag: res.headers.etag ?? null, total }));
      const meter = new Transform({ transform(c, _e, cb) { try { tick(c.length); cb(null, c); } catch (e) { cb(e); } } });
      await pipeline(res.body, meter, fs.createWriteStream(part, { flags: what === 'append' ? 'a' : 'w' }));
      const got = sizeOf(part);
      if (total != null && got !== total) throw new Fail(`short download: ${got} of ${total} bytes`, true);
      return { bytes: got };
    });
  });
}

// ---------------------------------------------------------------- archives (read in this process; no external tool)
const newStats = () => ({ files: 0, skipped: 0, renamed: 0 });
/** .tar.gz / .tgz reader: plain files and folders only; links and devices are skipped and counted. */
export async function extractTarGz(file, dest, { strip = 0, keep = null, tick = () => {} } = {}) {
  const st = newStats(), seen = new Map();
  const gz = zlib.createGunzip(), rs = fs.createReadStream(file);
  rs.on('error', (e) => gz.destroy(e));
  rs.pipe(gz);
  const str = (b, a, n) => { const s = b.subarray(a, a + n); const z = s.indexOf(0); return s.subarray(0, z < 0 ? n : z).toString('utf8'); };
  const num = (b, a, n) => (b[a] & 0x80 ? Number(b.readBigUInt64BE(a + n - 8)) : parseInt(str(b, a, n).trim() || '0', 8));
  let pend = Buffer.alloc(0), mode = 'header', remain = 0, padding = 0, fh = null, meta = null, metaType = '', longName = null, pax = {}, ended = false;
  const finish = async () => {
    if (mode === 'file') { await fh.close(); fh = null; st.files++; }
    if (mode === 'meta') {
      const body = Buffer.concat(meta);
      if (metaType === 'L') longName = body.toString('utf8').replace(/\0.*$/s, '');
      else if (metaType === 'x') for (const m of body.toString('utf8').matchAll(/\d+ ([^=]+)=([^\n]*)\n/g)) pax[m[1]] = m[2];
    }
    mode = padding ? 'pad' : 'header'; remain = padding; padding = 0;
  };
  try {
    for await (let chunk of gz) {
      if (ended) continue;
      if (pend.length) chunk = Buffer.concat([pend, chunk]);
      let off = 0;
      while (off < chunk.length && !ended) {
        if (mode === 'header') {
          if (chunk.length - off < 512) break;
          const h = chunk.subarray(off, off + 512); off += 512;
          if (h.every((b) => b === 0)) { ended = true; break; }
          let sum = 256; for (let i = 0; i < 512; i++) if (i < 148 || i >= 156) sum += h[i];
          if (sum !== parseInt(str(h, 148, 8).trim() || '0', 8)) throw new Fail('tar header checksum mismatch (damaged archive)');
          const type = String.fromCharCode(h[156] || 48);
          let size = num(h, 124, 12);
          const prefix = str(h, 257, 5) === 'ustar' ? str(h, 345, 155) : '';
          if ('Lxg'.includes(type) || type === 'K') { mode = type === 'K' ? 'skip' : 'meta'; meta = []; metaType = type; }
          else {
            const name = longName ?? pax.path ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
            if (pax.size) size = Number(pax.size);
            longName = null; pax = {};
            const isFile = type === '0' || type === '7', rel = isFile || type === '5' ? entryPath(name, { strip, keep, seen: isFile ? seen : null }) : null;
            if (!isFile && type !== '5') st.skipped++;
            if (isFile && rel) {
              const abs = path.join(dest, ...rel.split('/'));
              await fsp.mkdir(path.dirname(abs), { recursive: true });
              fh = await fsp.open(abs, 'wx'); mode = 'file';
            } else { if (type === '5' && rel) await fsp.mkdir(path.join(dest, ...rel.split('/')), { recursive: true }); mode = 'skip'; }
          }
          remain = size; padding = (512 - (size % 512)) % 512;
          if (!remain) await finish();
        } else {
          const n = Math.min(remain, chunk.length - off), piece = chunk.subarray(off, off + n);
          off += n; remain -= n;
          if (mode === 'file') { tick(n); await fh.write(piece); } else if (mode === 'meta') meta.push(Buffer.from(piece));
          if (!remain) { if (mode === 'pad') mode = 'header'; else await finish(); }
        }
      }
      pend = ended ? Buffer.alloc(0) : Buffer.from(chunk.subarray(off));
    }
    if (mode !== 'header' || pend.length) throw new Fail('tar archive ends in the middle of an entry');
  } finally { if (fh) await fh.close(); rs.destroy(); }
  st.renamed = seen.renamed || 0;
  return st;
}
/** .zip reader (stored and deflate, zip64). Every entry name is checked before anything is written. */
export async function extractZip(file, dest, { strip = 0, keep = null, tick = () => {} } = {}) {
  const st = newStats(), seen = new Map(), fh = await fsp.open(file, 'r');
  const read = async (pos, len) => { const b = Buffer.alloc(len); const { bytesRead } = await fh.read(b, 0, len, pos); if (bytesRead !== len) throw new Fail('zip file is truncated'); return b; };
  try {
    const { size } = await fh.stat(), tail = await read(Math.max(0, size - 65577), Math.min(size, 65577));
    const i = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
    if (i < 0) throw new Fail('not a zip file (no end record)');
    let cdSize = tail.readUInt32LE(i + 12), cdOff = tail.readUInt32LE(i + 16);
    if (cdSize === 0xffffffff || cdOff === 0xffffffff || tail.readUInt16LE(i + 10) === 0xffff) {
      if (i < 20 || tail.readUInt32LE(i - 20) !== 0x07064b50) throw new Fail('zip64 locator missing');
      const e = await read(Number(tail.readBigUInt64LE(i - 12)), 56);
      if (e.readUInt32LE(0) !== 0x06064b50) throw new Fail('zip64 end record missing');
      cdSize = Number(e.readBigUInt64LE(40)); cdOff = Number(e.readBigUInt64LE(48));
    }
    if (cdSize > 256 * MiB) throw new Fail('zip directory is unreasonably large');
    const cd = await read(cdOff, cdSize), entries = [];
    for (let p = 0; p + 46 <= cd.length; ) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Fail('zip directory is damaged');
      const flags = cd.readUInt16LE(p + 8), nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const e = { method: cd.readUInt16LE(p + 10), crc: cd.readUInt32LE(p + 16), csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24), off: cd.readUInt32LE(p + 42) };
      e.name = cd.subarray(p + 46, p + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1');
      for (let x = p + 46 + nl, end = x + el; x + 4 <= end; ) { // zip64 extra field
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 1) { let q = x + 4; for (const k of ['usize', 'csize', 'off']) if (e[k] === 0xffffffff) { e[k] = Number(cd.readBigUInt64LE(q)); q += 8; } }
        x += 4 + len;
      }
      if (flags & 1) throw new Fail(`zip entry is encrypted: ${e.name}`);
      e.dir = e.name.endsWith('/') || e.name.endsWith('\\');
      e.symlink = (cd.readUInt16LE(p + 4) >> 8) === 3 && ((cd.readUInt32LE(p + 38) >>> 16) & 0xf000) === 0xa000;
      e.rel = e.symlink ? null : entryPath(e.name, { strip, keep, seen: e.dir ? null : seen }); // throws on a bad name: nothing written yet
      if (e.rel && !e.dir && e.method !== 0 && e.method !== 8) throw new Fail(`zip entry uses an unsupported compression method (${e.method}): ${e.name}`);
      entries.push(e); p += 46 + nl + el + cl;
    }
    for (const e of entries) {
      if (e.symlink) { st.skipped++; continue; }
      if (!e.rel) continue;
      if (e.dir) { await fsp.mkdir(path.join(dest, ...e.rel.split('/')), { recursive: true }); continue; }
      const lh = await read(e.off, 30);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Fail(`zip local header is damaged: ${e.name}`);
      const start = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      let crc = 0, n = 0;
      const check = new Transform({ transform(c, _e, cb) { try { n += c.length; tick(c.length); crc = zlib.crc32(c, crc); cb(null, c); } catch (err) { cb(err); } } });
      const stages = e.csize ? [fs.createReadStream(file, { start, end: start + e.csize - 1 }), ...(e.method === 8 ? [zlib.createInflateRaw()] : [])] : [Readable.from([])];
      const abs = path.join(dest, ...e.rel.split('/'));
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await pipeline(...stages, check, fs.createWriteStream(abs, { flags: 'wx' }));
      st.files++;
      if (n !== e.usize || crc !== e.crc) throw new Fail(`zip entry failed its size or CRC check: ${e.name}`);
    }
  } finally { await fh.close(); }
  st.renamed = seen.renamed || 0;
  return st;
}
// ---------------------------------------------------------------- git
const GIT_SAFE = ['-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always'];
export function runGit(args, { cwd, insecureOk = false } = {}) {
  return new Promise((resolve) => {
    const pre = insecureOk ? [...GIT_SAFE, '-c', 'protocol.file.allow=always'] : [...GIT_SAFE];
    // A drive that records no owner makes git call the repository's owner someone else; `safe.directory` on the command line (a protected scope) trusts exactly this folder, so no global setting is needed.
    if (cwd) pre.push('-c', `safe.directory=${path.resolve(cwd).replaceAll('\\', '/')}`);
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '' };
    const p = spawn('git', [...pre, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 2 * 3600 * 1000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => { if (out.length < 65536) out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (e) => resolve({ code: -1, out, err: `git could not be started: ${e.message}` }));
    p.on('close', (code, sig) => resolve({ code: code ?? -1, out: out.trim(), err: sig ? `git was stopped (${sig}) after running for 2 hours` : err.trim() }));
  });
}
/** Exact commit of a repository into `tree`: one commit deep, blobs fetched only for the checked-out paths. */
async function gitFetch(ctx, item, tree) {
  const g = async (args, cwd = tree) => {
    const r = await ctx.git(args, { cwd, insecureOk: ctx.insecureOk });
    if (r.code !== 0) throw new Fail(`git ${args[0]} failed: ${r.err.split('\n').slice(-3).join(' | ')}`, /timed out|early EOF|RPC failed|Could not resolve|unable to access|reset by peer/i.test(r.err));
    return r.out;
  };
  await fsp.mkdir(tree, { recursive: true });
  await g(['init', '-q']);
  await g(['remote', 'add', 'origin', item.repo]);
  for (const [k, v] of [['core.autocrlf', 'false'], ['core.longpaths', 'true'], ['core.symlinks', 'false'], ['advice.detachedHead', 'false']]) await g(['config', k, v]);
  if (item.sparse) await g(['sparse-checkout', 'set', item.sparseNoCone ? '--no-cone' : '--cone', ...item.sparse]);
  try { await g(['fetch', '-q', '--depth=1', '--filter=blob:none', '--no-tags', 'origin', item.commit]); } catch (e) {
    ctx.log(`  ${item.id}: the server did not give the single commit (${e.message}); fetching the history without file contents`);
    await g(['fetch', '-q', '--filter=blob:none', '--no-tags', 'origin']);
  }
  await g(['checkout', '-q', '--detach', item.commit]);
  const head = await g(['rev-parse', 'HEAD']);
  if (head !== item.commit) throw new Fail(`checked-out commit ${head} is not the pinned ${item.commit}`);
}

// ---------------------------------------------------------------- ledger, credits, licence texts
function openLedger(file) {
  let data = { ledgerVersion: 1, entries: [], licenceTexts: [] };
  if (exists(file)) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Fail(`${file} cannot be read (${e.message}); it is not overwritten - repair or move it first`); }
    if (data.ledgerVersion !== 1 || !Array.isArray(data.entries)) throw new Fail(`${file} is not a version 1 ledger; move it away first`);
    data.licenceTexts ||= [];
  }
  let chain = Promise.resolve();
  const save = () => (chain = chain.then(async () => {
    await fsp.writeFile(file + '.tmp', JSON.stringify(data, null, 1) + '\n');
    await renameRetry(file + '.tmp', file);
  }));
  return {
    data, save,
    latest: (id) => data.entries.findLast((e) => e.item === id),
    add: (e) => { data.entries.push(e); return save(); },
    addLicence: (e) => { data.licenceTexts.push(e); return save(); },
  };
}
const flagWords = (f) => [
  f.diskOnly && 'DISK ONLY: never in the repository, never inside a shared project archive',
  f.repoAllowed && 'may be committed with its licence text',
  f.creditInExport && 'credit must appear in every shared video',
  f.shareAlike && 'share-alike', f.people && 'shows people', f.aiGenerated && 'AI-generated',
  f.trademark && 'names or marks are trademarks', f.personalOnly && 'personal use only',
].filter(Boolean);
export function creditsText(entries) {
  const bySource = new Map();
  for (const e of entries) { if (!bySource.has(e.source)) bySource.set(e.source, { first: e, items: new Map() }); bySource.get(e.source).items.set(e.item, e); }
  const lines = ['Library credits and licences', 'Generated from ledger.json by fetch.mjs - do not edit by hand.', ''];
  for (const [id, { first, items }] of [...bySource].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const e = [...items.values()].at(-1), L = e.licence;
    lines.push(`${e.sourceTitle ?? id}  [${id}]`, `  Licence: ${L.spdx ?? L.custom} - ${L.url} (read ${L.readOn})`, `  Licence text: LICENCES/${id}.txt`);
    lines.push(`  Credit line: ${e.credit ?? 'none required'}`);
    const fw = flagWords(e.flags ?? first.flags ?? {});
    if (fw.length) lines.push(`  Rules: ${fw.join('; ')}`);
    for (const it of items.values()) lines.push(`  - ${it.path}  (${it.kind}, ${fmt(it.bytes)}${it.pinned ? '' : ', hash first seen - not yet pinned'})`);
    lines.push('');
  }
  return lines.join('\n');
}
async function saveLicenceText(ctx, src) {
  const dir = path.join(ctx.root, META, 'LICENCES'), file = path.join(dir, `${src.id}.txt`), url = src.licence.url;
  const rec = { source: src.id, url, time: new Date().toISOString() };
  try {
    const { body, type } = await ctx.net.getBuffer(url, 4 * MiB);
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    await fsp.mkdir(dir, { recursive: true });
    let name = `${src.id}.txt`;
    if (exists(file) && (await sha256File(file)) !== sha256) {
      name = `${src.id}.${sha256.slice(0, 8)}.txt`;
      ctx.warn(`licence text of ${src.id} CHANGED since it was first stored: new copy kept as LICENCES/${name} - read it before using new files`);
    }
    if (!exists(path.join(dir, name))) await fsp.writeFile(path.join(dir, name), body, { flag: 'wx' });
    Object.assign(rec, { path: `${META}/LICENCES/${name}`, sha256, bytes: body.length, contentType: type });
  } catch (e) {
    rec.error = e.message;
    ctx.warn(`licence text of ${src.id} could not be stored (${e.message}); recorded in the ledger, not fatal`);
  }
  await ctx.ledger.addLicence(rec);
}

// ---------------------------------------------------------------- moving into place
async function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { return await fsp.rename(from, to); } catch (e) {
      if (e.code === 'EXDEV') throw new Fail(`${STAGE} and the destination are on different volumes; an atomic move is not possible`);
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(e.code) || i >= 9) throw e;
      await realSleep(300 * (i + 1)); // a virus scanner or indexer may hold a new file for a moment
    }
  }
}
async function moveIntoPlace(from, dest) {
  if (exists(dest)) throw new Fail(`${dest} appeared while the item was being fetched; nothing was overwritten`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await renameRetry(from, dest);
}

// ---------------------------------------------------------------- one item
const identity = (it) => it.kind === 'npm' ? `${it.name}@${it.version}` : it.kind === 'git' ? `${it.repo}#${it.commit}` : it.url;
async function npmMeta(ctx, item) {
  const { body } = await ctx.net.getBuffer(`${ctx.npmRegistry}/${item.name}/${item.version}`);
  const meta = JSON.parse(body.toString('utf8')), dist = meta.dist ?? {};
  if (meta.name !== item.name || meta.version !== item.version) throw new Fail(`registry answered for ${meta.name}@${meta.version}`);
  if (!/^sha512-/.test(dist.integrity ?? '')) throw new Fail('registry gives no sha512 integrity value');
  if (item.integrity && item.integrity !== dist.integrity) throw new Fail(`registry integrity ${dist.integrity} differs from the manifest`);
  if (new URL(dist.tarball).host !== new URL(ctx.npmRegistry).host) throw new Fail(`tarball is on another host: ${dist.tarball}`);
  return { url: dist.tarball, integrity: dist.integrity, unpackedBytes: dist.unpackedSize };
}
async function probe(ctx, item) {
  if (item.kind === 'git') return { url: item.repo };
  if (item.kind === 'npm') { const m = await npmMeta(ctx, item); return { ...m, bytes: item.bytes ?? await ctx.net.probeSize(m.url) }; }
  return { url: item.url, bytes: item.bytes ?? await ctx.net.probeSize(item.url) };
}
/** Is the item already in the library? Returns 'present', or null; throws when something else occupies the place. */
async function presentCheck(ctx, item, dest) {
  if (!exists(dest)) return null;
  const prior = ctx.ledger.latest(item.id);
  if (item.kind === 'file') {
    const want = item.sha256 ?? (prior?.path === item.dest ? prior.sha256 : null), have = await sha256File(dest);
    if (want && have === want) return 'present';
    throw new Fail(want ? `${item.dest} exists with other content (sha256 ${have}, expected ${want}); it is not overwritten - move it away to fetch again`
      : `${item.dest} exists but is not in the ledger (sha256 ${have}); it is not overwritten`);
  }
  if (!prior || prior.path !== item.dest || prior.identity !== identity(item)) throw new Fail(`${item.dest} exists but the ledger has no entry for this exact version; it is not overwritten - move it away to fetch again`);
  if (ctx.verify) {
    const t = await hashTree(dest);
    if (t.sha256 !== prior.treeSha256) throw new Fail(`${item.dest} no longer matches the ledger (tree sha256 ${t.sha256}, recorded ${prior.treeSha256})`);
  }
  return 'present';
}
async function fetchItem(ctx, src, item, pr, stage) {
  const dest = path.join(ctx.root, ...item.dest.split('/'));
  const part = path.join(stage, 'payload.part'), tree = path.join(stage, 'tree');
  const need = itemNeed(item, pr), others = () => ctx.reserved - need;
  let live = 0, said = Date.now();
  const tick = (n) => {
    live += n;
    if (Date.now() - said > 20000) { said = Date.now(); ctx.log(`  ...     ${item.id}: ${fmt(live)} so far`); }
    if (ctx.used + others() + live > ctx.budget) throw new Fail(`byte budget (--max-gb ${fmt(ctx.budget)}) would be exceeded while fetching; stopped`);
  };
  await fsp.mkdir(stage, { recursive: true });
  await rmrf(tree);
  const entry = { item: item.id, source: src.id, sourceTitle: src.title, manifest: ctx.manifest.id, manifestSha256: ctx.manifestSha256, kind: item.kind, identity: identity(item), url: pr.url, path: item.dest };
  const warnings = [];
  if (item.kind === 'git') {
    const release = await ctx.net.acquire(new URL(item.repo).host);
    try { await ctx.net.retrying(item.repo, async () => { await rmrf(tree); await gitFetch(ctx, item, tree); }); } finally { release(); }
    Object.assign(entry, { commit: item.commit, pinned: true });
  } else {
    const { bytes } = await download(ctx.net, pr.url, part, { tick, log: ctx.log });
    if (item.bytes && bytes !== item.bytes) throw new Fail(`size ${bytes} differs from the manifest (${item.bytes})`);
    const { digests } = await hashFile(part, ['sha256', 'sha512']);
    Object.assign(entry, { sha256: digests[0].toString('hex'), downloadBytes: bytes });
    if (item.kind === 'npm') {
      const got = `sha512-${digests[1].toString('base64')}`;
      if (got !== pr.integrity) throw new Fail(`integrity mismatch: tarball is ${got}, registry says ${pr.integrity}`);
      Object.assign(entry, { integrity: got, pinned: true, version: item.version });
    } else {
      if (item.sha256 && entry.sha256 !== item.sha256) throw new Fail(`sha256 mismatch: downloaded ${entry.sha256}, manifest says ${item.sha256}`);
      entry.pinned = !!item.sha256;
    }
    if (item.kind !== 'file') {
      const opt = { strip: item.kind === 'npm' ? 1 : item.strip ?? 0, keep: item.keep ?? null, tick };
      await fsp.mkdir(tree, { recursive: true });
      const st = await (item.kind === 'npm' || item.format === 'tar.gz' ? extractTarGz : extractZip)(part, tree, opt);
      if (!st.files) throw new Fail('the archive gave no files (check "keep" and "strip")');
      if (st.skipped) warnings.push(`${st.skipped} links or special entries were not unpacked`);
      if (st.renamed) warnings.push(`${st.renamed} entries were renamed (names that differ only by letter case)`);
    }
  }
  if (item.kind === 'file') {
    entry.bytes = sizeOf(part);
    if (dest.length > LONG_PATH) warnings.push(`path is longer than ${LONG_PATH} characters`);
    await moveIntoPlace(part, dest);
  } else {
    const t = await hashTree(tree, dest);
    Object.assign(entry, { files: t.files, treeSha256: t.sha256, bytes: item.kind === 'git' ? await dirBytes(tree) : t.bytes });
    if (t.longPaths) warnings.push(`${t.longPaths} files have a path longer than ${LONG_PATH} characters`);
    if (ctx.used + others() + entry.bytes > ctx.budget) throw new Fail(`byte budget (--max-gb ${fmt(ctx.budget)}) would be exceeded by this item (${fmt(entry.bytes)}); not moved into place`);
    await moveIntoPlace(tree, dest);
  }
  await rmrf(stage);
  const flags = Object.fromEntries([...FLAGS, ...OPT_FLAGS].filter((f) => src[f] !== undefined).map((f) => [f, src[f]]));
  Object.assign(entry, { licence: { ...src.licence }, credit: src.credit, flags, ...(warnings.length ? { warnings } : {}), time: new Date().toISOString() });
  await ctx.ledger.add(entry);
  return entry;
}

// ---------------------------------------------------------------- run
export async function run(argv, deps = {}) {
  const log = deps.log ?? ((s) => console.log(s));
  const started = Date.now();
  let o;
  try { o = parseArgs(argv); } catch (e) { log(`error: ${e.message}`); log(USAGE); return { code: 2 }; }
  const insecureOk = deps.insecureOk === true; // tests only: never reachable from the command line
  let manifest, raw;
  try {
    raw = fs.readFileSync(o.manifest);
    if (raw[0] === 0xff && raw[1] === 0xfe) throw new Error('the file is UTF-16 (written by a PowerShell ">" redirect?); save it as UTF-8');
    manifest = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (e) { log(`error: manifest ${o.manifest} cannot be read: ${e.message}`); return { code: 2 }; }
  const v = validateManifest(manifest, { insecureOk });
  if (v.errors.length) { log(`error: manifest ${o.manifest} is not valid:`); for (const e of v.errors) log(`  - ${e}`); return { code: 2 }; }
  const root = path.resolve(o.root);
  if (!exists(root) || !fs.statSync(root).isDirectory()) { log(`error: --root ${root} is not an existing folder (it is not created, to catch a mistyped drive)`); return { code: 2 }; }
  const known = new Set(v.items.flatMap(({ src, item }) => [src.id, item.id]));
  const bad = [...(o.only ?? []), ...o.skip].filter((id) => !known.has(id));
  if (bad.length) { log(`error: --only/--skip names ids that are not in the manifest: ${bad.join(', ')}`); return { code: 2 }; }
  const picked = (src, item) => (!o.only || o.only.includes(src.id) || o.only.includes(item.id)) && !o.skip.includes(src.id) && !o.skip.includes(item.id);

  const stageRoot = path.join(root, STAGE), lock = path.join(stageRoot, '.lock');
  const results = [], warns = [];
  const ctx = {
    root, manifest, manifestSha256: crypto.createHash('sha256').update(raw).digest('hex'), insecureOk, verify: o.verify, log,
    warn: (s) => { warns.push(s); log(`  warning: ${s}`); },
    net: makeNet({ transport: deps.transport, sleep: deps.sleep, delayMs: o.delayMs, insecureOk, log }),
    git: deps.git ?? runGit, npmRegistry: deps.npmRegistry ?? 'https://registry.npmjs.org',
    budget: Math.floor(o.maxGb * GiB), used: 0, reserved: 0, ledger: null,
  };
  if (!o.dryRun) {
    await fsp.mkdir(stageRoot, { recursive: true });
    await fsp.mkdir(path.join(root, META), { recursive: true });
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); } catch {
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      let alive = true; try { process.kill(pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
      if (alive && pid !== process.pid) { log(`error: another run (process ${pid}) is using this library; if that is wrong, delete ${lock}`); return { code: 2 }; }
      fs.writeFileSync(lock, String(process.pid));
    }
  }
  try {
    try { ctx.ledger = openLedger(path.join(root, META, 'ledger.json')); } catch (e) { log(`error: ${e.message}`); return { code: 2 }; }
    ctx.used = await dirBytes(root) - (o.dryRun ? 0 : sizeOf(lock));
    const freeOf = async () => { try { const s = await fsp.statfs(root); return s.bavail * s.bsize; } catch { return null; } };
    log(`${o.dryRun ? 'DRY RUN - nothing is downloaded. ' : ''}manifest ${manifest.id} (${v.items.length} items) -> ${root}`);
    log(`library holds ${fmt(ctx.used)}; budget --max-gb ${o.maxGb} = ${fmt(ctx.budget)}; free on the volume: ${fmt(await freeOf())}`);
    const done = (item, status, extra = {}) => { results.push({ id: item.id, status, ...extra }); };
    const touched = new Set();
    let dryTotal = 0, dryKeep = 0;
    const work = async ({ src, item }) => {
      const tag = `${item.id} [${item.kind}, ${src.licence.spdx ?? src.licence.custom}]`;
      if (!picked(src, item)) return done(item, 'not selected');
      if (src.needsOwnerKey) { log(`skip    ${tag}: needs the owner's own key or account - not handled by this version`); return done(item, 'skipped', { reason: 'needs the owner\'s key' }); }
      const stage = path.join(stageRoot, item.id.replaceAll('/', '__'));
      let need = 0, reserved = false;
      try {
        if (await presentCheck(ctx, item, path.join(root, ...item.dest.split('/')))) { log(`present ${tag} at ${item.dest}`); return done(item, 'present'); }
        const pr = await probe(ctx, item);
        need = itemNeed(item, pr);
        const b = budgetCheck({ budget: ctx.budget, used: ctx.used, reserved: ctx.reserved, need });
        const size = item.kind === 'git' ? `about ${fmt(item.approxBytes)}` : `${fmt(pr.bytes)}${item.kind === 'file' ? '' : ` + unpacked ${item.approxUnpackedBytes ?? pr.unpackedBytes ? 'about ' + fmt(item.approxUnpackedBytes ?? pr.unpackedBytes) : 'size unknown'}`}`;
        if (o.dryRun) {
          dryTotal += need; dryKeep += need - (item.kind === 'archive' || item.kind === 'npm' ? item.bytes ?? pr.bytes ?? 0 : 0); ctx.reserved += b.ok ? need : 0;
          log(`${b.ok ? 'would fetch' : 'REFUSED    '} ${tag}: ${size} -> ${item.dest}${b.ok ? '' : `\n            ${b.reason}`}\n            from ${pr.url}${item.kind === 'git' ? ` @ ${item.commit}` : ''}`);
          return done(item, b.ok ? 'would fetch' : 'refused', { bytes: need, reason: b.ok ? undefined : b.reason });
        }
        if (!b.ok) throw new Fail(b.reason);
        const free = await freeOf();
        if (free != null && free < ctx.reserved + need + 512 * MiB) throw new Fail(`not enough free space: ${fmt(free)} free, ${fmt(ctx.reserved + need)} needed plus a 512 MiB reserve`);
        ctx.reserved += need; reserved = true;
        log(`fetch   ${tag}: ${size} -> ${item.dest}`);
        const e = await fetchItem(ctx, src, item, pr, stage);
        ctx.used += e.bytes; touched.add(src);
        log(`done    ${item.id}: ${fmt(e.bytes)}${e.files ? ` in ${e.files} files` : ''}, ${e.pinned ? 'hash verified' : `hash FIRST SEEN ${e.sha256}`}${e.warnings ? `; ${e.warnings.join('; ')}` : ''}`);
        done(item, 'fetched', { bytes: e.bytes, entry: e });
      } catch (e) {
        const keep = e.retryable === true || NET_CODES.has(e.code); // network trouble: keep the partial file for the next run
        if (!keep) await rmrf(stage).catch(() => {});
        log(`FAILED  ${tag}: ${e.message}${keep ? ' (partial download kept for the next run)' : ''}`);
        done(item, 'failed', { reason: e.message });
      } finally { if (reserved) ctx.reserved -= need; }
    };
    const queue = [...v.items];
    await Promise.all(Array.from({ length: o.dryRun ? 1 : 4 }, async () => { for (let j; (j = queue.shift()); ) await work(j); }));
    if (!o.dryRun) {
      for (const src of manifest.sources) {
        const has = ctx.ledger.data.entries.some((e) => e.source === src.id);
        const stored = ctx.ledger.data.licenceTexts.some((l) => l.source === src.id && l.url === src.licence.url && l.sha256);
        if (has && (touched.has(src) || !stored)) await saveLicenceText(ctx, src);
      }
      await fsp.writeFile(path.join(root, META, 'CREDITS.txt'), creditsText(ctx.ledger.data.entries));
      await ctx.ledger.save();
    }
    const by = (s) => results.filter((r) => r.status === s);
    const fetched = by('fetched'), failed = [...by('failed'), ...by('refused')];
    log('');
    log(`SUMMARY ${manifest.id}: ${o.dryRun ? `would fetch ${by('would fetch').length} (about ${fmt(dryTotal)} while running, about ${fmt(dryKeep)} kept)` : `fetched ${fetched.length} (${fmt(fetched.reduce((a, r) => a + r.bytes, 0))})`}, already present ${by('present').length}, skipped ${by('skipped').length}, not selected ${by('not selected').length}, failed ${failed.length}; ${((Date.now() - started) / 1000).toFixed(1)} s`);
    for (const r of by('skipped')) log(`  skipped ${r.id}: ${r.reason}`);
    for (const r of failed) log(`  failed  ${r.id}: ${r.reason}`);
    for (const r of fetched) if (!r.entry.pinned) log(`  PIN     ${r.id} sha256=${r.entry.sha256} bytes=${r.entry.downloadBytes}`);
    for (const w of warns) log(`  warning: ${w}`);
    if (!o.dryRun) log(`library now holds ${fmt(ctx.used)}; ledger: ${path.join(root, META, 'ledger.json')}`);
    return { code: failed.length ? 1 : 0, results, warnings: warns, used: ctx.used };
  } finally { if (!o.dryRun) await rmrf(lock).catch(() => {}); }
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1] ?? '') === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); process.exit(0); }
  // The very last stdout line is `EXIT <code>`, for wrappers that lose the process exit code.
  const finish = (code) => { process.exitCode = code; console.log(`EXIT ${code}`); };
  run(args).then((r) => finish(r.code), (e) => { console.error(`error: ${e?.stack ?? e}`); finish(1); });
}
