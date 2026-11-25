// Tests for the library fetcher. Nothing here touches the network: HTTP goes to a server on 127.0.0.1 through an
// injected plain-http transport (labelled test-only), git uses a repository made in a temp folder.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import {
  budgetCheck, checkDest, creditsText, download, entryPath, extractTarGz, extractZip, hashTree, httpsTransport, itemNeed, makeNet, makeTransport,
  parseArgs, resumeDecision, resumeHeaders, run, sanitizeSegment, validateManifest,
  type Item, type LedgerEntry, type Manifest, type Seen, type Source, type Transport, type TransportResponse,
} from './fetch.mjs';

const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const httpTransport = makeTransport(http, 'http:'); // test-only transport
const noSleep = async () => {};
const tmpDirs: string[] = [];
function tmp(): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'libfetch-')); tmpDirs.push(d); return d; }
function mkRoot(): string { const r = tmp(); for (const d of ['music', 'sounds', 'visual', 'models', 'instruments']) fs.mkdirSync(path.join(r, d)); return r; }
afterAll(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

// ---- fixtures: a tiny zip writer, a tiny tar writer, a manifest builder
interface ZipEntry { name: string; data?: Buffer; store?: boolean }
function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0), name = Buffer.from(e.name, 'utf8'), method = e.store || !data.length ? 0 : 8;
    const comp = method ? zlib.deflateRawSync(data) : data, crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, comp); centrals.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
interface TarEntry { name: string; data?: Buffer; type?: string }
function makeTgz(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0), h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148);
    h.write(e.type ?? '0', 156); h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}
const FLAGS = { diskOnly: false, creditInExport: false, shareAlike: false, people: false, aiGenerated: false, repoAllowed: true };
function source(id: string, items: Item[], over: Partial<Source> = {}): Source {
  return { id, title: `Source ${id}`, licence: { spdx: 'MIT', url: `${base}/licence/${id}`, readOn: '2026-11-25', quote: 'MIT License' }, credit: null, ...FLAGS, items, ...over };
}
function manifest(sources: Source[]): Manifest { return { manifestVersion: 1, id: 'test-01', title: 'Test set', created: '2026-11-25', sources }; }
function writeManifest(m: unknown): string { const f = path.join(tmp(), 'm.json'); fs.writeFileSync(f, JSON.stringify(m)); return f; }

// ---- local server: routes are replaced per test
type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server, base = '', routes: Record<string, Handler> = {}, hits: string[] = [];
function serveBytes(body: Buffer, opt: { etag?: string | null; ranges?: boolean } = {}): Handler {
  const etag = opt.etag === undefined ? `"${sha256(body).slice(0, 16)}"` : opt.etag;
  return (req, res) => {
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    const head: Record<string, string> = etag ? { etag } : {};
    if (m && opt.ranges !== false && (!req.headers['if-range'] || req.headers['if-range'] === etag)) {
      const from = Number(m[1]);
      if (from >= body.length) { res.writeHead(416, { 'content-range': `bytes */${body.length}` }); return void res.end(); }
      res.writeHead(206, { ...head, 'content-length': String(body.length - from), 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` });
      return void res.end(req.method === 'HEAD' ? undefined : body.subarray(from));
    }
    res.writeHead(200, { ...head, 'content-length': String(body.length) });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const p = (req.url ?? '').split('?')[0]!;
    hits.push(`${req.method} ${p}${req.headers.range ? ` [${req.headers.range}]` : ''}`);
    const h = routes[p];
    if (h) return h(req, res);
    if (p.startsWith('/licence/')) return serveBytes(Buffer.from(`licence text of ${p.slice(9)}\n`))(req, res);
    res.writeHead(404); res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
afterEach(() => { routes = {}; hits = []; });

async function go(root: string, m: unknown, extra: string[] = [], deps: Parameters<typeof run>[1] = {}) {
  const lines: string[] = [];
  const r = await run(['--root', root, '--manifest', writeManifest(m), '--delay-ms', '0', ...extra], { transport: httpTransport, insecureOk: true, sleep: noSleep, log: (s) => lines.push(s), ...deps });
  return { ...r, out: lines.join('\n') };
}
const ledgerOf = (root: string) => JSON.parse(fs.readFileSync(path.join(root, '_manifests', 'ledger.json'), 'utf8')) as { entries: LedgerEntry[]; licenceTexts: { source: string; sha256?: string; error?: string; path?: string }[] };
const stageLeft = (root: string) => fs.readdirSync(path.join(root, '_downloads-in-progress'));

describe('manifest validation', () => {
  const ok = () => manifest([source('a', [
    { id: 'a/file', kind: 'file', url: 'https://example.org/x.png', dest: 'visual/a/x.png', sha256: 'a'.repeat(64), bytes: 10 },
    { id: 'a/zip', kind: 'archive', url: 'https://example.org/x.zip', format: 'zip', dest: 'visual/a/zip', keep: ['img/'] },
    { id: 'a/npm', kind: 'npm', name: '@scope/pkg', version: '1.2.3', dest: 'visual/a/npm' },
    { id: 'a/git', kind: 'git', repo: 'https://example.org/r.git', commit: 'c'.repeat(40), sparse: ['ofl/x'], approxBytes: 1000, dest: 'visual/a/git' },
  ], { licence: { spdx: 'MIT', url: 'https://example.org/LICENSE', readOn: '2026-11-25', quote: 'MIT License' } })]);
  const errs = (m: unknown) => validateManifest(m).errors.join('\n');

  it('accepts a complete manifest and lists its items', () => {
    const v = validateManifest(ok());
    expect(v.errors).toEqual([]);
    expect(v.items.map((x) => x.item.id)).toEqual(['a/file', 'a/zip', 'a/npm', 'a/git']);
  });
  it('wants the version first and equal to 1', () => {
    const { manifestVersion, ...rest } = ok();
    expect(errs({ ...rest, manifestVersion })).toMatch(/"manifestVersion" must be the first field/);
    expect(errs({ ...ok(), manifestVersion: 2 })).toMatch(/manifestVersion must be 1/);
  });
  it('refuses anything that is not https, and URLs with credentials', () => {
    const m = ok(); m.sources[0]!.items[0]!.url = 'http://example.org/x.png';
    expect(errs(m)).toMatch(/item a\/file url: only https: URLs are fetched \(got http:\)/);
    m.sources[0]!.items[0]!.url = 'https://user:secret@example.org/x.png';
    expect(errs(m)).toMatch(/must not carry a user name or password/);
    m.sources[0]!.items[0]!.url = 'ftp://example.org/x.png';
    expect(errs(m)).toMatch(/got ftp:/);
    m.sources[0]!.items[3]!.repo = 'git@github.com:a/b.git';
    expect(errs(m)).toMatch(/item a\/git repo: is not a URL/);
  });
  it('wants every licence field and every flag, stated explicitly', () => {
    const m = ok(); const s = m.sources[0]! as unknown as Record<string, unknown>;
    delete s.people; (s.licence as Record<string, unknown>).custom = 'also custom'; delete (s.licence as Record<string, unknown>).quote; delete s.credit;
    const e = errs(m);
    expect(e).toMatch(/flag "people" must be true or false/);
    expect(e).toMatch(/exactly one of "spdx" or "custom"/);
    expect(e).toMatch(/licence.quote/);
    expect(e).toMatch(/credit must be the exact credit line, or null/);
  });
  it('catches contradictory flags', () => {
    expect(errs(manifest([source('a', ok().sources[0]!.items, { creditInExport: true })]))).toMatch(/creditInExport needs a credit line/);
    expect(errs(manifest([source('a', ok().sources[0]!.items, { diskOnly: true })]))).toMatch(/diskOnly and repoAllowed cannot both be true/);
  });
  it('refuses unsafe or overlapping destinations', () => {
    for (const [dest, why] of [['../x', '".."'], ['visual/../../x', '".."'], ['/abs/x', 'relative'], ['C:/x', 'relative'], ['visual\\x', 'relative'], ['_manifests/x', 'must start with'],
      ['visual/nul.txt', 'Windows-safe'], ['visual/a:b', 'Windows-safe'], ['visual/dot.', 'Windows-safe'], ['visual', 'inside a library folder']] as const) {
      const m = ok(); m.sources[0]!.items[0]!.dest = dest;
      expect(errs(m), dest).toContain(why);
    }
    const m = ok(); m.sources[0]!.items[0]!.dest = 'visual/a/ZIP/inner.png';
    expect(errs(m)).toMatch(/dest overlaps the dest of item a\/zip/);
  });
  it('refuses loose pins, unknown fields and duplicate ids', () => {
    const m = ok(); const it0 = m.sources[0]!.items;
    it0[0]!.sha256 = 'ABC'; it0[2]!.version = '^1.2.3'; it0[3]!.commit = 'abc1234'; delete it0[3]!.approxBytes; (it0[1] as unknown as Record<string, unknown>).sha265 = 'typo'; it0[1]!.id = 'a/file';
    const e = errs(m);
    expect(e).toMatch(/sha256 must be 64 lower-case hex digits/);
    expect(e).toMatch(/version must be exact/);
    expect(e).toMatch(/commit must be the full 40-digit sha/);
    expect(e).toMatch(/approxBytes .* is required/);
    expect(e).toMatch(/unknown field "sha265"/);
    expect(e).toMatch(/duplicate id/);
  });
  it('the shipped manifests are valid', () => {
    const dir = path.join(import.meta.dirname, 'manifests');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toContain('visual-01.json');
    for (const f of files) {
      const v = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      expect(v.errors, f).toEqual([]);
      for (const { src } of v.items) { // first set: only sources that may be kept in an application's library, no key, no share-alike
        expect(src.shareAlike || src.needsOwnerKey || src.creditInExport || src.personalOnly, `${f} ${src.id}`).toBeFalsy();
      }
    }
  });
});

describe('names and paths', () => {
  it('makes single names safe for Windows', () => {
    expect(sanitizeSegment('a<b>c:d"e|f?g*h')).toBe('a_b_c_d_e_f_g_h');
    expect(sanitizeSegment('trailing. . ')).toBe('trailing');
    expect(sanitizeSegment('NUL')).toBe('_NUL');
    expect(sanitizeSegment('com1.txt')).toBe('_com1.txt');
    expect(sanitizeSegment('console.log')).toBe('console.log');
    expect(sanitizeSegment('...')).toBe('_');
    expect(sanitizeSegment('tab\tnew\nline')).toBe('tab_new_line');
    expect(sanitizeSegment('PlaypenSansHebrew[wght].ttf')).toBe('PlaypenSansHebrew[wght].ttf');
    const long = sanitizeSegment('x'.repeat(300) + '.svg');
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith('.svg')).toBe(true);
    expect(sanitizeSegment('y'.repeat(300) + '.svg')).not.toBe(long);
  });
  it('refuses archive entries that could leave the folder', () => {
    for (const bad of ['/etc/passwd', '\\windows\\x', 'C:\\x.txt', 'c:x.txt', '../x', 'a/../../x', 'a\\..\\x', 'ok/..', 'nul\0byte']) {
      expect(() => entryPath(bad), bad).toThrow(/archive entry refused/);
    }
    expect(entryPath('a/./b//c.txt')).toBe('a/b/c.txt');
    expect(entryPath('/')).toBeNull(); // a bare root-folder entry is ignored, not followed
    expect(entryPath('a\\b\\c.txt')).toBe('a/b/c.txt');
    expect(entryPath('dir/con/a?.png')).toBe('dir/_con/a_.png');
    expect(entryPath('..hidden/file..name')).toBe('..hidden/file..name');
  });
  it('applies strip and keep, and keeps names apart that differ only by case', () => {
    expect(entryPath('package/dist/a.js', { strip: 1 })).toBe('dist/a.js');
    expect(entryPath('package', { strip: 1 })).toBeNull();
    expect(entryPath('pkg/img/a.png', { strip: 1, keep: ['img/'] })).toBe('img/a.png');
    expect(entryPath('pkg/imgs/a.png', { strip: 1, keep: ['img'] })).toBeNull();
    expect(entryPath('pkg/LICENSE', { strip: 1, keep: ['img/', 'LICENSE'] })).toBe('LICENSE');
    const seen: Seen = new Map();
    expect(entryPath('icons/Home.svg', { seen })).toBe('icons/Home.svg');
    expect(entryPath('icons/home.svg', { seen })).toBe('icons/home~2.svg');
    expect(entryPath('icons/HOME.svg', { seen })).toBe('icons/HOME~3.svg');
    expect(seen.renamed).toBe(2);
  });
  it('checks manifest destinations', () => {
    expect(checkDest('visual/emoji/fluent')).toBeNull();
    expect(checkDest('visual/' + 'x'.repeat(120))).toMatch(/longer than 120/);
    expect(checkDest(42)).toMatch(/non-empty string/);
  });
});

describe('arguments and budget arithmetic', () => {
  it('parses the command line', () => {
    expect(parseArgs(['--root', 'E:\\Lib', '--manifest', 'm.json', '--dry-run', '--only', 'a,b', '--max-gb', '2.5'])).toMatchObject({ root: 'E:\\Lib', dryRun: true, only: ['a', 'b'], maxGb: 2.5, delayMs: 500 });
    expect(parseArgs(['--root', 'r', '--manifest', 'm']).maxGb).toBe(100);
    expect(() => parseArgs(['--manifest', 'm'])).toThrow(/--root and --manifest/);
    expect(() => parseArgs(['--root', 'r', '--manifest', 'm', '--max-gb', '0'])).toThrow(/positive/);
    expect(() => parseArgs(['--root', 'r', '--manifest', 'm', '--force'])).toThrow(/unknown option --force/);
    expect(() => parseArgs(['--root'])).toThrow(/needs a value/);
  });
  it('counts library, reservations and the new item against the budget', () => {
    const G = 2 ** 30;
    expect(budgetCheck({ budget: 100 * G, used: 60 * G, reserved: 30 * G, need: 10 * G })).toEqual({ ok: true, after: 100 * G });
    const no = budgetCheck({ budget: 100 * G, used: 60 * G, reserved: 30 * G, need: 10 * G + 1 });
    expect(no.ok).toBe(false);
    expect(no.reason).toMatch(/60\.00 GiB already in the library \+ 30\.00 GiB in progress \+ 10\.00 GiB for this item/);
    expect(budgetCheck({ budget: 5, used: 6 }).ok).toBe(false);
  });
  it('estimates what an item adds while it runs', () => {
    expect(itemNeed({ kind: 'file', bytes: 10 })).toBe(10);
    expect(itemNeed({ kind: 'file' }, { bytes: 7 })).toBe(7);
    expect(itemNeed({ kind: 'file' }, { bytes: null })).toBe(0);
    expect(itemNeed({ kind: 'archive', bytes: 10, approxUnpackedBytes: 40 })).toBe(50);
    expect(itemNeed({ kind: 'archive', bytes: 10 })).toBe(20);
    expect(itemNeed({ kind: 'npm' }, { bytes: 5, unpackedBytes: 30 })).toBe(35);
    expect(itemNeed({ kind: 'git', approxBytes: 99 })).toBe(99);
  });
});

describe('https only', () => {
  it('the real transport refuses http before opening a connection', async () => {
    await expect(httpsTransport(new URL('http://127.0.0.1:9/x'))).rejects.toThrow(/only https: URLs are fetched/);
  });
  it('a redirect from https to http is refused', async () => {
    const calls: string[] = [];
    const fake: Transport = async (url) => {
      calls.push(url.href);
      return { status: 302, headers: { location: 'http://plain.example/x' }, body: Readable.from([]) } satisfies TransportResponse;
    };
    const net = makeNet({ transport: fake, delayMs: 0 });
    await expect(net.getBuffer('https://secure.example/x')).rejects.toThrow(/only https: URLs are fetched \(got http:\/\/plain.example\)/);
    expect(calls).toEqual(['https://secure.example/x']);
  });
  it('the command line cannot fetch http (the test switch is not an option)', async () => {
    const root = mkRoot(), lines: string[] = [];
    const m = manifest([source('a', [{ id: 'a/f', kind: 'file', url: `${base}/f.bin`, dest: 'visual/f.bin' }])]);
    const r = await run(['--root', root, '--manifest', writeManifest(m)], { log: (s) => lines.push(s) });
    expect(r.code).toBe(2);
    expect(lines.join('\n')).toMatch(/only https: URLs are fetched \(got http:\)/);
    expect(hits).toEqual([]);
    expect(() => parseArgs(['--root', 'r', '--manifest', 'm', '--insecure'])).toThrow(/unknown option/);
  });
});

describe('polite client', () => {
  it('opens at most two requests per host and spaces their starts', async () => {
    let open = 0, peak = 0;
    const starts: number[] = [];
    const fake: Transport = async () => {
      starts.push(performance.now()); open++; peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 90)); // longer than the delay, so the two-per-host limit is what holds requests back
      open--;
      return { status: 200, headers: {}, body: Readable.from([Buffer.from('ok')]) };
    };
    const waits: number[] = [];
    const net = makeNet({ transport: fake, delayMs: 40, perHost: 2, sleep: (ms) => { waits.push(ms); return new Promise((r) => setTimeout(r, ms)); } });
    await Promise.all(Array.from({ length: 6 }, (_, i) => net.getBuffer(`https://one.example/${i}`)));
    expect(peak).toBe(2);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(38); // lower bound only: load can only widen it
    const before = waits.length;
    await net.getBuffer('https://two.example/0'); // another host does not wait for the first one's delay
    expect(waits.length).toBe(before);
  });
  it('sends a generic User-Agent and nothing that identifies or authenticates', async () => {
    let seen: http.IncomingHttpHeaders = {};
    routes['/h'] = (req, res) => { seen = req.headers; res.end('x'); };
    await makeNet({ transport: httpTransport, insecureOk: true, delayMs: 0 }).getBuffer(`${base}/h`);
    expect(seen['user-agent']).toBe('library-fetch/1 (node)');
    expect(seen['accept-encoding']).toBe('identity');
    expect(Object.keys(seen).sort()).toEqual(['accept', 'accept-encoding', 'connection', 'host', 'user-agent']);
  });
  it('does not store bytes a server compressed against the request', async () => {
    routes['/gz'] = (_q, res) => { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end(zlib.gzipSync('hello')); };
    await expect(makeNet({ transport: httpTransport, insecureOk: true, delayMs: 0 }).getBuffer(`${base}/gz`)).rejects.toThrow(/sent "gzip"-encoded bytes although plain bytes were asked for/);
  });
  it('retries server errors with backoff and gives up on a plain 404', async () => {
    let n = 0; const waits: number[] = [];
    routes['/flaky'] = (_q, res) => { if (++n < 3) { res.writeHead(503); res.end(); } else res.end('fine'); };
    const net = makeNet({ transport: httpTransport, insecureOk: true, delayMs: 0, sleep: async (ms) => { waits.push(ms); } });
    expect((await net.getBuffer(`${base}/flaky`)).body.toString()).toBe('fine');
    expect(waits).toEqual([1000, 2000]);
    await expect(net.getBuffer(`${base}/missing`)).rejects.toThrow(/HTTP 404/);
    expect(waits).toEqual([1000, 2000]);
  });
});

describe('resume', () => {
  const meta = { url: 'https://h/x', etag: '"abc"', total: 100 };
  it('asks for a range only with a strong ETag for the same URL', () => {
    expect(resumeHeaders(40, meta, 'https://h/x')).toEqual({ range: 'bytes=40-', 'if-range': '"abc"' });
    expect(resumeHeaders(0, meta, 'https://h/x')).toEqual({});
    expect(resumeHeaders(40, null, 'https://h/x')).toEqual({});
    expect(resumeHeaders(40, meta, 'https://h/other')).toEqual({});
    expect(resumeHeaders(40, { ...meta, etag: 'W/"abc"' }, 'https://h/x')).toEqual({});
    expect(resumeHeaders(40, { ...meta, etag: null }, 'https://h/x')).toEqual({});
  });
  it('decides between append, restart and discard', () => {
    expect(resumeDecision({ have: 40, ranged: true, status: 206, contentRange: 'bytes 40-99/100', etag: '"abc"', meta })).toBe('append');
    expect(resumeDecision({ have: 40, ranged: true, status: 200, meta })).toBe('restart');
    expect(resumeDecision({ have: 0, ranged: false, status: 200 })).toBe('restart');
    expect(resumeDecision({ have: 40, ranged: true, status: 206, contentRange: 'bytes 0-99/100', meta })).toBe('discard');
    expect(resumeDecision({ have: 40, ranged: true, status: 206, contentRange: 'bytes 40-99/100', etag: '"other"', meta })).toBe('discard');
    expect(resumeDecision({ have: 40, ranged: true, status: 416, meta })).toBe('discard');
    expect(resumeDecision({ have: 0, ranged: false, status: 206, contentRange: 'bytes 0-0/100' })).toBe('error');
    expect(resumeDecision({ have: 0, ranged: false, status: 403 })).toBe('error');
  });

  const body = crypto.randomBytes(300_000);
  const net = () => makeNet({ transport: httpTransport, insecureOk: true, delayMs: 0, sleep: noSleep });
  function partial(n: number, etag: string | null): string {
    const part = path.join(tmp(), 'payload.part');
    fs.writeFileSync(part, body.subarray(0, n));
    fs.writeFileSync(part + '.json', JSON.stringify({ url: `${base}/big`, etag, total: body.length }));
    return part;
  }
  it('continues a partial file when the server honours the range', async () => {
    routes['/big'] = serveBytes(body, { etag: '"v1"' });
    const part = partial(100_000, '"v1"');
    expect(await download(net(), `${base}/big`, part)).toEqual({ bytes: body.length });
    expect(hits).toEqual(['GET /big [bytes=100000-]']);
    expect(sha256(fs.readFileSync(part))).toBe(sha256(body));
  });
  it('starts again when the server ignores the range', async () => {
    routes['/big'] = serveBytes(body, { etag: '"v1"', ranges: false });
    const part = partial(100_000, '"v1"');
    await download(net(), `${base}/big`, part);
    expect(fs.statSync(part).size).toBe(body.length);
    expect(sha256(fs.readFileSync(part))).toBe(sha256(body));
  });
  it('starts again when the file changed on the server (If-Range)', async () => {
    routes['/big'] = serveBytes(body, { etag: '"v2"' });
    const part = partial(100_000, '"v1"');
    fs.writeFileSync(part, Buffer.alloc(100_000, 7)); // stale bytes of the old version
    await download(net(), `${base}/big`, part);
    expect(sha256(fs.readFileSync(part))).toBe(sha256(body));
  });
  it('never resumes without a validator', async () => {
    routes['/big'] = serveBytes(body, { etag: null });
    const part = partial(100_000, null);
    await download(net(), `${base}/big`, part);
    expect(hits).toEqual(['GET /big']);
    expect(sha256(fs.readFileSync(part))).toBe(sha256(body));
  });
  it('recovers from a connection cut in the middle', async () => {
    let first = true;
    routes['/big'] = (req, res) => {
      if (!first) return serveBytes(body, { etag: '"v1"' })(req, res);
      first = false;
      res.writeHead(200, { etag: '"v1"', 'content-length': String(body.length) });
      res.write(body.subarray(0, 120_000));
      setTimeout(() => res.destroy(), 100); // after the first part has reached the client's disk
    };
    const part = path.join(tmp(), 'payload.part');
    expect(await download(net(), `${base}/big`, part)).toEqual({ bytes: body.length });
    expect(hits.length).toBe(2);
    expect(hits[1]).toMatch(/^GET \/big \[bytes=\d+-\]$/);
    expect(sha256(fs.readFileSync(part))).toBe(sha256(body));
  });
  it('does not ask again for a partial file that is already complete', async () => {
    routes['/big'] = serveBytes(body, { etag: '"v1"' });
    const part = partial(body.length, '"v1"');
    expect(await download(net(), `${base}/big`, part)).toEqual({ bytes: body.length });
    expect(hits).toEqual([]);
  });
});

describe('archives', () => {
  const png = crypto.randomBytes(5000), text = Buffer.from('hello '.repeat(2000));
  it('unpacks a zip (stored and deflated entries), with strip and keep', async () => {
    const dir = tmp(), z = path.join(dir, 'a.zip'), out = path.join(dir, 'out');
    fs.writeFileSync(z, makeZip([{ name: 'top/' }, { name: 'top/img/a.png', data: png, store: true }, { name: 'top/img/sub/b.txt', data: text }, { name: 'top/docs/readme.txt', data: text }, { name: 'top/img/empty', data: Buffer.alloc(0) }]));
    let ticked = 0;
    const st = await extractZip(z, out, { strip: 1, keep: ['img/'], tick: (n) => { ticked += n; } });
    expect(st).toEqual({ files: 3, skipped: 0, renamed: 0 });
    expect(fs.readFileSync(path.join(out, 'img/a.png')).equals(png)).toBe(true);
    expect(fs.readFileSync(path.join(out, 'img/sub/b.txt')).equals(text)).toBe(true);
    expect(fs.statSync(path.join(out, 'img/empty')).size).toBe(0);
    expect(fs.existsSync(path.join(out, 'docs'))).toBe(false);
    expect(ticked).toBe(png.length + text.length);
  });
  it('refuses a zip with a traversal entry before writing anything', async () => {
    for (const evil of ['../evil.txt', '/abs.txt', 'C:\\evil.txt', 'ok/../../evil.txt']) {
      const dir = tmp(), z = path.join(dir, 'a.zip'), out = path.join(dir, 'out');
      fs.writeFileSync(z, makeZip([{ name: 'good.txt', data: text }, { name: evil, data: text }]));
      await expect(extractZip(z, out), evil).rejects.toThrow(/archive entry refused/);
      expect(fs.existsSync(out), evil).toBe(false);
      expect(fs.readdirSync(dir)).toEqual(['a.zip']);
    }
  });
  it('detects a damaged zip entry', async () => {
    const dir = tmp(), z = path.join(dir, 'a.zip');
    const buf = makeZip([{ name: 'a.bin', data: png, store: true }]);
    buf[40] = buf[40]! ^ 0xff; // inside the stored data
    fs.writeFileSync(z, buf);
    await expect(extractZip(z, path.join(dir, 'out'))).rejects.toThrow(/size or CRC check/);
    fs.writeFileSync(z, Buffer.from('this is not a zip'));
    await expect(extractZip(z, path.join(dir, 'out2'))).rejects.toThrow(/not a zip file/);
  });
  it('unpacks a tar.gz, skips links, and keeps case-colliding names apart', async () => {
    const dir = tmp(), t = path.join(dir, 'a.tgz'), out = path.join(dir, 'out');
    fs.writeFileSync(t, makeTgz([{ name: 'package/', type: '5' }, { name: 'package/a.txt', data: text }, { name: 'package/A.txt', data: png }, { name: 'package/link', type: '2' },
      { name: 'package/deep/dir/c.bin', data: crypto.randomBytes(513) }, { name: 'package/zero', data: Buffer.alloc(0) }]));
    const st = await extractTarGz(t, out, { strip: 1 });
    expect(st).toEqual({ files: 4, skipped: 1, renamed: 1 });
    expect(fs.readdirSync(out).sort()).toEqual(['A~2.txt', 'a.txt', 'deep', 'zero']);
    expect(fs.readFileSync(path.join(out, 'a.txt')).equals(text)).toBe(true);
    expect(fs.readFileSync(path.join(out, 'A~2.txt')).equals(png)).toBe(true);
    expect(fs.statSync(path.join(out, 'deep/dir/c.bin')).size).toBe(513);
  });
  it('refuses a tar.gz with an absolute or parent path, and a cut-off one', async () => {
    for (const evil of ['/etc/x', '../x', 'a/../../x']) {
      const dir = tmp(), t = path.join(dir, 'a.tgz');
      fs.writeFileSync(t, makeTgz([{ name: evil, data: text }]));
      await expect(extractTarGz(t, path.join(dir, 'out')), evil).rejects.toThrow(/archive entry refused/);
      expect(fs.existsSync(path.join(dir, 'out')), evil).toBe(false);
    }
    const dir = tmp(), t = path.join(dir, 'a.tgz');
    const whole = zlib.gunzipSync(makeTgz([{ name: 'a.bin', data: crypto.randomBytes(4000) }]));
    fs.writeFileSync(t, zlib.gzipSync(whole.subarray(0, 2000)));
    await expect(extractTarGz(t, path.join(dir, 'out'))).rejects.toThrow(/ends in the middle/);
  });
  it('hashes a tree the same way regardless of creation order', async () => {
    const a = tmp(), b = tmp();
    fs.mkdirSync(path.join(a, 'd')); fs.writeFileSync(path.join(a, 'd/x'), 'x'); fs.writeFileSync(path.join(a, 'y'), 'y');
    fs.writeFileSync(path.join(b, 'y'), 'y'); fs.mkdirSync(path.join(b, 'd')); fs.writeFileSync(path.join(b, 'd/x'), 'x'); fs.mkdirSync(path.join(b, '.git')); fs.writeFileSync(path.join(b, '.git/HEAD'), 'ref');
    const ha = await hashTree(a), hb = await hashTree(b);
    expect(ha).toEqual(hb);
    expect(ha.files).toBe(2);
    fs.writeFileSync(path.join(b, 'y'), 'z');
    expect((await hashTree(b)).sha256).not.toBe(ha.sha256);
  });
});

describe('fetching into a library', () => {
  const data = crypto.randomBytes(40_000);
  const one = (over: Partial<Item> = {}, srcOver: Partial<Source> = {}) => manifest([source('pics', [{ id: 'pics/one', kind: 'file', url: `${base}/one.bin`, dest: 'visual/pics/one.bin', ...over }], srcOver)]);

  it('verifies, moves into place, and writes ledger, credits and the licence text', async () => {
    routes['/one.bin'] = serveBytes(data);
    const root = mkRoot();
    const r = await go(root, one({ sha256: sha256(data), bytes: data.length }, { credit: 'Pictures by Example', creditInExport: true, repoAllowed: false, diskOnly: true }));
    expect(r.out).toMatch(/SUMMARY test-01: fetched 1 \(40000 B\), already present 0, skipped 0, not selected 0, failed 0/);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(root, 'visual/pics/one.bin')).equals(data)).toBe(true);
    expect(stageLeft(root)).toEqual([]);
    const led = ledgerOf(root);
    expect(led.entries).toHaveLength(1);
    expect(led.entries[0]).toMatchObject({ item: 'pics/one', source: 'pics', manifest: 'test-01', kind: 'file', url: `${base}/one.bin`, path: 'visual/pics/one.bin', bytes: 40000, sha256: sha256(data), pinned: true,
      licence: { spdx: 'MIT', readOn: '2026-11-25', quote: 'MIT License' }, credit: 'Pictures by Example', flags: { diskOnly: true, creditInExport: true, repoAllowed: false } });
    expect(Date.parse(led.entries[0]!.time)).toBeGreaterThan(0);
    const lic = fs.readFileSync(path.join(root, '_manifests/LICENCES/pics.txt'), 'utf8');
    expect(lic).toBe('licence text of pics\n');
    expect(led.licenceTexts).toMatchObject([{ source: 'pics', sha256: sha256(lic), path: '_manifests/LICENCES/pics.txt' }]);
    const credits = fs.readFileSync(path.join(root, '_manifests/CREDITS.txt'), 'utf8');
    expect(credits).toContain('Source pics  [pics]');
    expect(credits).toContain('Credit line: Pictures by Example');
    expect(credits).toContain('DISK ONLY: never in the repository, never inside a shared project archive');
    expect(credits).toContain('credit must appear in every shared video');
    expect(credits).toContain('- visual/pics/one.bin  (file, 40000 B)');
  });
  it('fails on a hash mismatch and moves nothing into place', async () => {
    routes['/one.bin'] = serveBytes(data);
    const root = mkRoot();
    const r = await go(root, one({ sha256: 'f'.repeat(64) }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAILED  pics\/one .*sha256 mismatch: downloaded [0-9a-f]{64}, manifest says f{64}/);
    expect(fs.existsSync(path.join(root, 'visual/pics'))).toBe(false);
    expect(stageLeft(root)).toEqual([]);
    expect(ledgerOf(root).entries).toEqual([]);
    expect(fs.existsSync(path.join(root, '_manifests/LICENCES'))).toBe(false);
  });
  it('fails when the size differs from the manifest', async () => {
    routes['/one.bin'] = serveBytes(data);
    const root = mkRoot();
    const r = await go(root, one({ bytes: data.length + 1 }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/size 40000 differs from the manifest \(40001\)/);
    expect(fs.existsSync(path.join(root, 'visual/pics'))).toBe(false);
  });
  it('records a first-seen hash as not pinned, then treats the file as present without downloading again', async () => {
    routes['/one.bin'] = serveBytes(data);
    const root = mkRoot();
    const r1 = await go(root, one());
    expect(r1.code).toBe(0);
    expect(r1.out).toContain(`hash FIRST SEEN ${sha256(data)}`);
    expect(r1.out).toContain(`PIN     pics/one sha256=${sha256(data)} bytes=40000`);
    expect(ledgerOf(root).entries[0]).toMatchObject({ pinned: false, sha256: sha256(data) });
    expect(fs.readFileSync(path.join(root, '_manifests/CREDITS.txt'), 'utf8')).toContain('hash first seen - not yet pinned');
    hits = [];
    const r2 = await go(root, one());
    expect(r2.code).toBe(0);
    expect(r2.out).toMatch(/present pics\/one/);
    expect(r2.out).toMatch(/fetched 0 \(0 B\), already present 1/);
    expect(hits).toEqual([]);
    expect(ledgerOf(root).entries).toHaveLength(1);
  });
  it('never overwrites a file that is already there with other content', async () => {
    routes['/one.bin'] = serveBytes(data);
    const root = mkRoot(), dest = path.join(root, 'visual/pics/one.bin');
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, 'the owner put this here');
    const r = await go(root, one({ sha256: sha256(data) }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/exists with other content .* it is not overwritten/);
    expect(fs.readFileSync(dest, 'utf8')).toBe('the owner put this here');
    expect(hits).toEqual([]);
    const r2 = await go(root, one());
    expect(r2.out).toMatch(/exists but is not in the ledger .* it is not overwritten/);
    expect(fs.readFileSync(dest, 'utf8')).toBe('the owner put this here');
  });
  it('a dry run prints sizes and writes nothing', async () => {
    routes['/one.bin'] = serveBytes(data);
    routes['/nolen.bin'] = (req, res) => { if (req.headers.range === 'bytes=0-0') { res.writeHead(206, { 'content-range': 'bytes 0-0/777' }); res.end('x'); } else { res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : 'x'.repeat(777)); } };
    const root = mkRoot(), before = fs.readdirSync(root).sort();
    const m = one(); m.sources[0]!.items.push({ id: 'pics/two', kind: 'file', url: `${base}/nolen.bin`, dest: 'visual/pics/two.bin' });
    const r = await go(root, m, ['--dry-run']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/DRY RUN - nothing is downloaded/);
    expect(r.out).toMatch(/would fetch pics\/one \[file, MIT\]: 40000 B -> visual\/pics\/one\.bin/);
    expect(r.out).toMatch(/would fetch pics\/two \[file, MIT\]: 777 B -> visual\/pics\/two\.bin/);
    expect(r.out).toMatch(/would fetch 2 \(about 40777 B while running, about 40777 B kept\)/);
    expect(fs.readdirSync(root).sort()).toEqual(before);
    expect(hits.filter((h) => h.startsWith('GET') && !h.includes('bytes=0-0'))).toEqual([]);
  });
  it('refuses to start an item that would pass the budget, counting what the library already holds', async () => {
    routes['/one.bin'] = serveBytes(data);
    const root = mkRoot();
    fs.writeFileSync(path.join(root, 'music/already.bin'), Buffer.alloc(30_000));
    const tiny = String(60_000 / 2 ** 30); // 60 000 bytes: 30 000 held + 40 000 wanted does not fit
    const r = await go(root, one(), ['--max-gb', tiny]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/byte budget: 30000 B already in the library \+ 0 B in progress \+ 40000 B for this item is more than --max-gb/);
    expect(hits.filter((h) => h.startsWith('GET'))).toEqual([]);
    expect(fs.existsSync(path.join(root, 'visual/pics'))).toBe(false);
    const dry = await go(root, one(), ['--max-gb', tiny, '--dry-run']);
    expect(dry.code).toBe(1);
    expect(dry.out).toMatch(/REFUSED     pics\/one/);
    const fits = await go(root, one(), ['--max-gb', String(80_000 / 2 ** 30)]);
    expect(fits.code).toBe(0);
  });
  it('stops a download of unknown size when it passes the budget', async () => {
    routes['/one.bin'] = (req, res) => { res.writeHead(200); if (req.method === 'HEAD') return void res.end(); res.end(data); }; // no Content-Length, no ranges
    const root = mkRoot();
    const r = await go(root, one(), ['--max-gb', String(20_000 / 2 ** 30)]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/byte budget .* would be exceeded while fetching; stopped/);
    expect(fs.existsSync(path.join(root, 'visual/pics'))).toBe(false);
    expect(stageLeft(root)).toEqual([]);
  });
  it('skips sources that need the owner\'s key, and honours --only and --skip', async () => {
    routes['/one.bin'] = serveBytes(data);
    const root = mkRoot();
    const m = manifest([
      source('pics', [{ id: 'pics/one', kind: 'file', url: `${base}/one.bin`, dest: 'visual/pics/one.bin' }]),
      source('stock', [{ id: 'stock/clip', kind: 'file', url: `${base}/clip.bin`, dest: 'visual/stock/clip.bin' }], { needsOwnerKey: true, diskOnly: true, repoAllowed: false }),
      source('other', [{ id: 'other/x', kind: 'file', url: `${base}/one.bin`, dest: 'visual/other/x.bin' }]),
    ]);
    const r = await go(root, m, ['--skip', 'other']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/skip    stock\/clip .* needs the owner's own key or account/);
    expect(r.out).toMatch(/fetched 1 .* skipped 1, not selected 1, failed 0/);
    expect(hits.some((h) => h.includes('clip.bin'))).toBe(false);
    const r2 = await go(root, m, ['--only', 'other/x']);
    expect(r2.out).toMatch(/fetched 1 .* already present 0, skipped 0, not selected 2/);
    expect((await go(root, m, ['--only', 'nope'])).code).toBe(2);
  });
  it('reads a manifest saved with a byte-order mark and explains a UTF-16 one', async () => {
    routes['/one.bin'] = serveBytes(data);
    const root = mkRoot(), lines: string[] = [];
    const bom = path.join(tmp(), 'bom.json'), wide = path.join(tmp(), 'wide.json');
    fs.writeFileSync(bom, '\uFEFF' + JSON.stringify(one()));
    fs.writeFileSync(wide, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(one()), 'utf16le')]));
    const deps = { transport: httpTransport, insecureOk: true, sleep: noSleep, log: (l: string) => lines.push(l) };
    expect((await run(['--root', root, '--manifest', bom, '--delay-ms', '0'], deps)).code).toBe(0);
    expect((await run(['--root', root, '--manifest', wide, '--delay-ms', '0'], deps)).code).toBe(2);
    expect(lines.join('\n')).toMatch(/the file is UTF-16 .* save it as UTF-8/);
  });
  it('a licence text that cannot be fetched is recorded and is not fatal', async () => {
    routes['/one.bin'] = serveBytes(data);
    routes['/licence/pics'] = (_q, res) => { res.writeHead(404); res.end(); };
    const root = mkRoot();
    const r = await go(root, one());
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/warning: licence text of pics could not be stored \(HTTP 404/);
    expect(ledgerOf(root).licenceTexts).toMatchObject([{ source: 'pics', error: expect.stringContaining('HTTP 404') }]);
    expect(fs.existsSync(path.join(root, 'visual/pics/one.bin'))).toBe(true);
  });
  it('keeps a changed licence text beside the first one and says so', async () => {
    routes['/one.bin'] = serveBytes(data);
    const root = mkRoot();
    await go(root, one());
    routes['/licence/pics'] = serveBytes(Buffer.from('new terms\n'));
    const m = one(); m.sources[0]!.items.push({ id: 'pics/two', kind: 'file', url: `${base}/one.bin`, dest: 'visual/pics/two.bin' });
    const r = await go(root, m);
    expect(r.out).toMatch(/licence text of pics CHANGED/);
    const files = fs.readdirSync(path.join(root, '_manifests/LICENCES')).sort();
    expect(files).toEqual([`pics.${sha256('new terms\n').slice(0, 8)}.txt`, 'pics.txt']);
    expect(fs.readFileSync(path.join(root, '_manifests/LICENCES/pics.txt'), 'utf8')).toBe('licence text of pics\n');
  });
  it('refuses a second run on the same library while one is alive, and a root that does not exist', async () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, '_downloads-in-progress'));
    fs.writeFileSync(path.join(root, '_downloads-in-progress/.lock'), String(process.ppid));
    const r = await go(root, one());
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/another run \(process \d+\) is using this library/);
    fs.writeFileSync(path.join(root, '_downloads-in-progress/.lock'), '2147483646'); // a stale lock of a dead process is taken over
    routes['/one.bin'] = serveBytes(data);
    expect((await go(root, one())).code).toBe(0);
    expect((await go(path.join(root, 'missing'), one())).code).toBe(2);
  });
  it('unpacks an archive item, keeps only the wanted prefixes, and recognises it as present next time', async () => {
    const zip = makeZip([{ name: 'set/img/a.png', data: data }, { name: 'set/img/b.png', data: data.subarray(0, 100) }, { name: 'set/src/huge.psd', data: data }]);
    routes['/set.zip'] = serveBytes(zip);
    const root = mkRoot();
    const m = manifest([source('set', [{ id: 'set/zip', kind: 'archive', url: `${base}/set.zip`, format: 'zip', strip: 1, keep: ['img/'], dest: 'visual/set', sha256: sha256(zip) }])]);
    const r = await go(root, m);
    expect(r.code).toBe(0);
    expect(fs.readdirSync(path.join(root, 'visual/set/img')).sort()).toEqual(['a.png', 'b.png']);
    expect(fs.existsSync(path.join(root, 'visual/set/src'))).toBe(false);
    expect(ledgerOf(root).entries[0]).toMatchObject({ kind: 'archive', files: 2, bytes: 40_100, downloadBytes: zip.length, sha256: sha256(zip), pinned: true, treeSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    hits = [];
    const again = await go(root, m, ['--verify']);
    expect(again.out).toMatch(/present set\/zip/);
    expect(hits).toEqual([]);
    fs.writeFileSync(path.join(root, 'visual/set/img/b.png'), 'tampered');
    const bad = await go(root, m, ['--verify']);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/no longer matches the ledger/);
  });
  it('rejects an archive item with a traversal entry: nothing reaches the library', async () => {
    const zip = makeZip([{ name: 'ok.txt', data: Buffer.from('ok') }, { name: '../../visual/planted.txt', data: Buffer.from('bad') }]);
    routes['/evil.zip'] = serveBytes(zip);
    const root = mkRoot();
    const r = await go(root, manifest([source('evil', [{ id: 'evil/zip', kind: 'archive', url: `${base}/evil.zip`, format: 'zip', dest: 'visual/evil' }])]));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/archive entry refused \("\.\." in path\)/);
    expect(fs.readdirSync(path.join(root, 'visual'))).toEqual([]);
    expect(stageLeft(root)).toEqual([]);
    expect(ledgerOf(root).entries).toEqual([]);
  });

  describe('npm packages', () => {
    const tgz = makeTgz([{ name: 'package/package.json', data: Buffer.from('{"name":"@demo/icons","version":"1.2.3","scripts":{"postinstall":"node evil.js"}}') },
      { name: 'package/icons/a.svg', data: Buffer.from('<svg/>') }, { name: 'package/evil.js', data: Buffer.from('throw new Error("must never run")') }]);
    const integrity = `sha512-${crypto.createHash('sha512').update(tgz).digest('base64')}`;
    const pkg = (over: Partial<Item> = {}) => manifest([source('demo-icons', [{ id: 'demo-icons/pkg', kind: 'npm', name: '@demo/icons', version: '1.2.3', dest: 'visual/icons/demo-1.2.3', ...over }])]);
    const registry = (integ = integrity, body = tgz) => {
      routes['/@demo/icons/1.2.3'] = (_q, res) => res.end(JSON.stringify({ name: '@demo/icons', version: '1.2.3', dist: { tarball: `${base}/@demo/icons/-/icons-1.2.3.tgz`, integrity: integ, unpackedSize: 200 } }));
      routes['/@demo/icons/-/icons-1.2.3.tgz'] = serveBytes(body);
    };
    it('takes the tarball named by the registry, checks its integrity value, and unpacks without running anything', async () => {
      registry();
      const root = mkRoot();
      const r = await go(root, pkg({ integrity }), [], { npmRegistry: base });
      expect(r.code).toBe(0);
      expect(fs.readdirSync(path.join(root, 'visual/icons/demo-1.2.3')).sort()).toEqual(['evil.js', 'icons', 'package.json']);
      expect(ledgerOf(root).entries[0]).toMatchObject({ kind: 'npm', identity: '@demo/icons@1.2.3', integrity, pinned: true, files: 3, version: '1.2.3', url: `${base}/@demo/icons/-/icons-1.2.3.tgz` });
    });
    it('fails when the tarball does not match the registry value', async () => {
      registry(integrity, makeTgz([{ name: 'package/other.txt', data: Buffer.from('swapped') }]));
      const root = mkRoot();
      const r = await go(root, pkg(), [], { npmRegistry: base });
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/integrity mismatch: tarball is sha512-/);
      expect(fs.existsSync(path.join(root, 'visual/icons'))).toBe(false);
    });
    it('fails when the registry value differs from the one pinned in the manifest', async () => {
      registry();
      const root = mkRoot();
      const other = `sha512-${crypto.createHash('sha512').update('x').digest('base64')}`;
      const r = await go(root, pkg({ integrity: other }), [], { npmRegistry: base });
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/differs from the manifest/);
      expect(hits.some((h) => h.includes('.tgz'))).toBe(false);
    });
  });

  describe('git repositories', () => {
    const gitc = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    function repo() {
      const dir = tmp();
      gitc(dir, 'init', '-q');
      for (const [f, c] of [['ofl/alpha/Alpha.ttf', 'font-a'], ['ofl/alpha/OFL.txt', 'licence-a'], ['ofl/beta/Beta.ttf', 'font-b'], ['README.md', 'readme']] as const) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c);
      }
      gitc(dir, 'add', '.'); gitc(dir, 'commit', '-q', '-m', 'first');
      const first = gitc(dir, 'rev-parse', 'HEAD');
      fs.writeFileSync(path.join(dir, 'ofl/alpha/Alpha.ttf'), 'font-a-v2'); gitc(dir, 'commit', '-q', '-am', 'second');
      gitc(dir, 'config', 'uploadpack.allowAnySHA1InWant', 'true'); gitc(dir, 'config', 'uploadpack.allowFilter', 'true');
      return { url: pathToFileURL(dir).href, first };
    }
    it('checks out exactly the pinned commit, only the sparse paths', async () => {
      const { url, first } = repo(), root = mkRoot();
      const m = manifest([source('fonts', [{ id: 'fonts/repo', kind: 'git', repo: url, commit: first, sparse: ['ofl/alpha'], approxBytes: 100_000, dest: 'visual/fonts/repo' }],
        { licence: { spdx: 'OFL-1.1', url: `${base}/licence/fonts`, readOn: '2026-11-25', quote: 'SIL Open Font License' } })]);
      const r = await go(root, m);
      expect(r.out).toMatch(/fetched 1 /);
      expect(r.code).toBe(0);
      const dest = path.join(root, 'visual/fonts/repo');
      expect(fs.readFileSync(path.join(dest, 'ofl/alpha/Alpha.ttf'), 'utf8')).toBe('font-a'); // the pinned commit, not the newer tip
      expect(fs.existsSync(path.join(dest, 'ofl/beta'))).toBe(false);
      expect(gitc(dest, 'rev-parse', 'HEAD')).toBe(first);
      expect(ledgerOf(root).entries[0]).toMatchObject({ kind: 'git', commit: first, pinned: true, identity: `${url}#${first}` });
      expect((await go(root, m)).out).toMatch(/present fonts\/repo/);
    });
    it('fails for a commit the repository does not have', async () => {
      const { url } = repo(), root = mkRoot();
      const r = await go(root, manifest([source('fonts', [{ id: 'fonts/repo', kind: 'git', repo: url, commit: 'd'.repeat(40), approxBytes: 1000, dest: 'visual/fonts/repo' }])]));
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/FAILED  fonts\/repo .*git (fetch|checkout) failed/);
      expect(fs.existsSync(path.join(root, 'visual/fonts'))).toBe(false);
      expect(stageLeft(root)).toEqual([]);
    });
    it('starts git with prompts and stored credentials switched off', async () => {
      const calls: string[][] = []; const envs: (string | undefined)[] = [];
      const root = mkRoot();
      const fake = async (args: string[], opt?: { cwd?: string }) => {
        calls.push(args); envs.push(process.env.GIT_TERMINAL_PROMPT);
        if (args[0] === 'checkout' && opt?.cwd) fs.writeFileSync(path.join(opt.cwd, 'file.txt'), 'x');
        return { code: 0, out: args[0] === 'rev-parse' ? 'c'.repeat(40) : '', err: '' };
      };
      const m = manifest([source('fonts', [{ id: 'fonts/repo', kind: 'git', repo: 'https://example.org/r.git', commit: 'c'.repeat(40), sparse: ['a b', 'c'], approxBytes: 1000, dest: 'visual/fonts/repo' }],
        { licence: { spdx: 'MIT', url: `${base}/licence/fonts`, readOn: '2026-11-25', quote: 'MIT' } })]);
      const r = await go(root, m, [], { git: fake });
      expect(r.code).toBe(0);
      expect(calls.map((c) => c.join(' '))).toEqual(['init -q', 'remote add origin https://example.org/r.git', 'config core.autocrlf false', 'config core.longpaths true', 'config core.symlinks false',
        'config advice.detachedHead false', 'sparse-checkout set --cone a b c', `fetch -q --depth=1 --filter=blob:none --no-tags origin ${'c'.repeat(40)}`, `checkout -q --detach ${'c'.repeat(40)}`, 'rev-parse HEAD']);
    });
  });
});

describe('credits text', () => {
  it('groups by source and states the rules in words', () => {
    const e = (over: Partial<LedgerEntry>): LedgerEntry => ({ item: 'x', source: 's', sourceTitle: 'S', manifest: 'm', manifestSha256: '', kind: 'file', identity: '', url: '', path: 'visual/x', bytes: 5, pinned: true,
      licence: { spdx: 'CC0-1.0', url: 'https://example.org/l', readOn: '2026-11-25', quote: 'q' }, credit: null, flags: {}, time: '', ...over });
    const t = creditsText([e({}), e({ item: 'y', path: 'visual/y', source: 'b', sourceTitle: 'B', credit: 'Photo: B', flags: { people: true, shareAlike: true } })]);
    expect(t.indexOf('B  [b]')).toBeLessThan(t.indexOf('S  [s]'));
    expect(t).toContain('Licence: CC0-1.0 - https://example.org/l (read 2026-11-25)');
    expect(t).toContain('Credit line: none required');
    expect(t).toContain('Credit line: Photo: B');
    expect(t).toContain('Rules: share-alike; shows people');
  });
});
