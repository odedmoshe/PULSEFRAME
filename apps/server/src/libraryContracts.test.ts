/**
 * The server contract of the content library (wave 7 library track; library/contract.ts), through the real app and the real MCP
 * handler: every route is registered, documented and classified; the owner rule holds before anything else; the archive's library
 * modes are worker B's (below); the backup leaves the library's files out. Worker A's rows (the catalogue,
 * audition, thumbnails, use) run over the SYNTHETIC LIBRARY (packages/evals/src/library-fixtures.ts). While worker B's core
 * licenceDuties is not built in this build, the library service of this data directory is made first with the fixtures' labelled
 * TEST STAND-IN for it; once built, core's own table is used. The it.todo rows name what is still to be made pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Auth } from './auth.ts';
import { backupDataDir, NEVER_BACKED_UP } from './backup.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createHash } from 'node:crypto';
import * as T from '@pulseframe/time';
import { collectCredits, creditsView, LIBRARY_OPS_BUILT } from '@pulseframe/core';
import { coreDutiesBuilt, FIX_COUNTS, FIX_KEYS, fixtureDutiesStandIn, makeLibraryFixture, type LibraryFixture } from '../../../packages/evals/src/library-fixtures.ts';
import { createApp, DATA_CSP } from './http.ts';
import { createImportQueue } from './importQueue.ts';
import { FifoComputeLane } from './lane.ts';
import { LIBRARY_CONFIG_FILE, LIBRARY_INDEX_FILE, LIBRARY_ROUTES, LIBRARY_SERVER_REFUSALS } from './library/contract.ts';
import { closeLibraryService, libraryServiceFor } from './library/index.ts';
import { libraryRasterRuns } from './library/raster.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let ownerCookie = '', proposeGrant = '', pid = '', fx: LibraryFixture, imports: ReturnType<typeof createImportQueue>;
const base = () => `http://127.0.0.1:${cfg.port}`;
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer);
const proposer = bearer(() => proposeGrant);
/** Every library answer's content type, for "never image/svg+xml". */
const libraryTypes: string[] = [];
const raw = async (who: Who, method: string, p: string, body?: unknown, extra: Record<string, string> = {}) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: { ...who(), ...extra }, ...(body === undefined ? {} : { body: typeof body === 'string' || body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body) }) }));
  if (p.includes('/library')) libraryTypes.push(r.headers.get('content-type') ?? '');
  return r;
};
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await raw(who, method, p, body);
  const type = r.headers.get('content-type') ?? '';
  return { status: r.status, body: type.includes('json') ? ((await r.json()) as any) : null };
};
const item = (key: string, tail = '') => `/api/v1/library/items/${encodeURIComponent(key)}${tail}`;
const counts = () => ({
  blobs: (store.db.prepare('SELECT count(*) AS n FROM blobs').get() as { n: number }).n,
  jobs: (store.db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n,
  assets: Object.keys(store.getProject(pid).doc.assets).length,
  revision: store.getProject(pid).revision,
});
async function untilReady() {
  for (let i = 0; i < 400; i++) { const st = await rest(owner, 'GET', '/api/v1/library/status'); if (st.body.state !== 'indexing') return st.body; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('the index did not finish');
}
let rpcId = 0;
async function tool(who: Who, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any }> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  const body = msg.result.content[0].text;
  let data: unknown = body; try { data = JSON.parse(body); } catch { /* a plain message */ }
  return { isError: !!msg.result?.isError, data };
}
const urlOf = (route: string) => route.split(' ')[1]!.replace(':id', pid).replace(':key', encodeURIComponent('none/none'));

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-library-contract-'));
  fx = await makeLibraryFixture(path.join(dir, 'fixture'));
  dir = path.join(dir, 'data');
  fs.mkdirSync(dir);
  cfg = { ...loadConfig({}), dataDir: dir, port: 23, speechPython: null, voicePython: null, backupDir: null, libraryDir: null };
  if (!coreDutiesBuilt()) libraryServiceFor(cfg, { duties: fixtureDutiesStandIn }); // labelled TEST STAND-IN until core's table is built
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  const derivatives = new Derivatives(store);
  imports = createImportQueue({ store, lane: new FifoComputeLane(), derivatives, maxUploadBytes: 1 << 30, reserveBytes: 0, homeZone: 'Asia/Jerusalem' });
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech, { imports });
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  proposeGrant = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
  pid = store.createProject({ name: 'library contract' }).doc.id;
}, 120_000);
afterAll(async () => {
  await imports.stop();
  closeLibraryService(dir);
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

describe('the library routes are registered, documented and classified', () => {
  it('every route of LIBRARY_ROUTES is in OpenAPI and in the people-surface table; the two MCP tools are classified', () => {
    const doc = buildOpenApi() as { paths: Record<string, Record<string, unknown>> };
    for (const route of LIBRARY_ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      const oa = p.replace(/:(\w+)/g, '{$1}');
      expect({ route, documented: !!doc.paths[oa]?.[method.toLowerCase()] }).toEqual({ route, documented: true });
      expect({ route, classified: route in PEOPLE_REST_SURFACES }).toEqual({ route, classified: true });
    }
    expect(PEOPLE_MCP_TOOLS.use_library_item).toEqual(['reader-document', 'write']);
    expect(PEOPLE_MCP_TOOLS.get_credits).toEqual(['reader-document']);
  });
});

describe('before a root is set: owner rule first, honest states', () => {
  it('the owner-only routes refuse an agent with 403 owner_required before anything else', async () => {
    for (const route of ['PUT /api/v1/library/root', 'POST /api/v1/library/reindex', 'DELETE /api/v1/library/reindex']) {
      const r = await rest(agent, route.split(' ')[0]!, urlOf(route), { root: null });
      expect({ route, status: r.status, code: r.body?.error?.code }).toEqual({ route, status: 403, code: 'owner_required' });
    }
  });
  it('before a root is set: the status says not_configured (200, to every credential); the catalogue and use answer 409 library_not_configured', async () => {
    for (const who of [owner, agent, observer]) expect((await rest(who, 'GET', '/api/v1/library/status')).body).toMatchObject({ state: 'not_configured', counts: {} });
    for (const route of LIBRARY_ROUTES.filter((r) => r.startsWith('GET /api/v1/library/items'))) {
      const r = await rest(owner, 'GET', urlOf(route));
      expect({ route, status: r.status, code: r.body?.error?.code, message: r.body?.error?.message }).toEqual({ route, status: 409, code: 'library_not_configured', message: LIBRARY_SERVER_REFUSALS.notConfigured.message() });
    }
    expect((await rest(owner, 'POST', `/api/v1/projects/${pid}/library/use`, { key: 'none/none' })).body?.error?.code).toBe('library_not_configured');
    expect((await rest(owner, 'POST', '/api/v1/library/reindex')).body?.error?.code).toBe('library_not_configured');
  });
  it('an observer cannot use an item (403)', async () => {
    expect((await rest(observer, 'POST', urlOf('POST /api/v1/projects/:id/library/use'), { key: 'none/none' })).status).toBe(403);
  });
  it('the archive: no library parameter is unchanged (200); strip and keep of a project without library files are the same 200; keep is the owner\'s; a bad value is 400', async () => {
    expect((await rest(owner, 'GET', `/api/v1/projects/${pid}/archive`)).status).toBe(200);
    expect((await rest(owner, 'GET', `/api/v1/projects/${pid}/archive?library=strip`)).status).toBe(200);
    expect((await rest(owner, 'GET', `/api/v1/projects/${pid}/archive?library=keep`)).status).toBe(200);
    expect((await rest(agent, 'GET', `/api/v1/projects/${pid}/archive?library=keep`)).body?.error?.code).toBe('owner_required');
    expect((await rest(owner, 'GET', `/api/v1/projects/${pid}/archive?library=all`)).status).toBe(400);
  });
  it('MCP use_library_item answers as REST does before a root is set: library_not_configured', async () => {
    const u = await tool(agent, 'use_library_item', { projectId: pid, key: 'none/none' });
    expect(u.isError).toBe(true);
    expect(JSON.stringify(u.data)).toContain('library_not_configured');
  });
});

describe('the backup leaves the library\'s own files out', () => {
  it('library.json and library-index.sqlite are in NEVER_BACKED_UP and absent from a backup', async () => {
    expect(NEVER_BACKED_UP).toEqual(expect.arrayContaining([LIBRARY_CONFIG_FILE, LIBRARY_INDEX_FILE]));
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-lib-bk-src-')), dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-lib-bk-dest-')), 'copy');
    const s = new Store(src);
    s.createProject({ name: 'p' });
    fs.writeFileSync(path.join(src, LIBRARY_CONFIG_FILE), JSON.stringify({ root: '/nowhere' }), { mode: 0o600 });
    fs.writeFileSync(path.join(src, LIBRARY_INDEX_FILE), 'not an index');
    await backupDataDir(src, dest);
    s.close();
    for (const name of [LIBRARY_CONFIG_FILE, LIBRARY_INDEX_FILE]) expect(fs.existsSync(path.join(dest, name)), name).toBe(false);
    fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(path.dirname(dest), { recursive: true, force: true });
  });
});

/** A project holding a CC BY track and a non-commercial (disk-only) sound on the timeline, committed as the server commits them; the bytes are arbitrary. */
function libraryProject(): string {
  const lp = store.createProject({ name: 'library duties' }).doc.id;
  const ids = [['song', 'CC-BY-4.0', { credit: { text: 'Song by Composer', placement: 'description' } }], ['bird', 'CC-BY-NC-4.0', { credit: { text: 'Bird by Rec', placement: 'either' }, flags: { nonCommercial: true, diskOnly: true } }]].map(([k, id, extra], i) => {
    const bytes = Buffer.from(`library contract ${k} ${'x'.repeat(200)}`);
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const tmp = path.join(store.tmpDir, `lc_${k}`);
    fs.writeFileSync(tmp, bytes);
    store.putBlob(hash, tmp, bytes.length, 'audio/wav');
    const library = { itemId: `s/${k}`, sourceId: 's', kind: 'music', title: k, sourceSha256: hash.slice(7), ledger: { item: 's' }, licence: { id }, flags: {}, ...(extra as object) };
    const asset = { kind: 'audio', name: `${k}.wav`, contentHash: hash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(2, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'upload', importedAt: '2026-11-25T00:00:00Z', importedBy: 'test', library } };
    const assetId = store.commit({ projectId: lp, actor: 'user:local', allowInternal: true, ops: [{ op: 'use_library_item', args: { asset } }] }).results[0]!.output!.assetId as string;
    return { assetId, i };
  });
  store.commit({ projectId: lp, actor: 'user:local', ops: ids.map(({ assetId, i }) => ({ op: 'add_clip', args: { assetId, start: T.rt(i, 1), duration: T.rt(1, 1) } })) });
  return lp;
}

describe('what the workers make pass', () => {
  it('A: the root is set by the owner only; each invalid root is 400 library_root_invalid with its reason; then the catalogue is ready, the folder in the owner\'s status only', async () => {
    expect((await rest(agent, 'PUT', '/api/v1/library/root', { root: fx.root })).body?.error?.code).toBe('owner_required');
    const inData = path.join(dir, 'lib-inside');
    fs.mkdirSync(path.join(inData, '_manifests'), { recursive: true });
    fs.writeFileSync(path.join(inData, '_manifests', 'ledger.json'), '{"ledgerVersion":1,"entries":[]}');
    for (const [root, reason] of [['relative/x', 'it is not an absolute path'], [path.join(dir, 'missing'), 'it does not exist'], [dir, 'it holds no _manifests/ledger.json'], [inData, 'it lies inside the data directory']] as const) {
      const r = await rest(owner, 'PUT', '/api/v1/library/root', { root });
      expect({ status: r.status, code: r.body?.error?.code, reason: r.body?.error?.details?.reason, message: r.body?.error?.message }).toEqual({ status: 400, code: 'library_root_invalid', reason, message: LIBRARY_SERVER_REFUSALS.rootInvalid.message(reason) });
    }
    expect((await rest(owner, 'PUT', '/api/v1/library/root', { root: fx.root, extra: 1 })).status).toBe(400);
    expect((await rest(owner, 'PUT', '/api/v1/library/root', { root: fx.root })).status).toBe(200);
    const st = await untilReady();
    expect(st).toMatchObject({ state: 'ready', root: fx.root, counts: FIX_COUNTS, verifiedAt: null });
    const agentView = (await rest(agent, 'GET', '/api/v1/library/status')).body;
    expect(agentView.root).toBeUndefined();
    expect(agentView.counts).toEqual(FIX_COUNTS);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, LIBRARY_CONFIG_FILE)).mode & 0o777).toBe(0o600);
  });
  it('A: reindex (owner, 202) swaps the index whole; DELETE /reindex keeps the counts; an agent is refused both', async () => {
    expect((await rest(agent, 'POST', '/api/v1/library/reindex')).body?.error?.code).toBe('owner_required');
    expect((await rest(agent, 'DELETE', '/api/v1/library/reindex')).body?.error?.code).toBe('owner_required');
    const r = await rest(owner, 'POST', '/api/v1/library/reindex');
    expect(r.status).toBe(202);
    expect(['indexing', 'ready']).toContain(r.body.state);
    const d = await rest(owner, 'DELETE', '/api/v1/library/reindex');
    expect(d.body).toMatchObject({ state: 'ready', counts: FIX_COUNTS });
    expect(fs.existsSync(path.join(dir, `${LIBRARY_INDEX_FILE}.tmp`))).toBe(false);
    // (the build in a temp file, the old index answering while it runs, and the rebuild after a cut: library/index.test.ts)
  });
  it('A: search (Hebrew forms, filters, pages), one row, 404 for an unknown key, 400 for an unknown query field', async () => {
    const firstOf = async (q: string) => (await rest(observer, 'GET', `/api/v1/library/items?q=${encodeURIComponent(q)}`)).body.rows[0]?.key;
    for (const q of ['חנוכיה', 'החנוכיה', 'חֲנֻכִּיָּה', 'menorah']) expect({ q, first: await firstOf(q) }).toEqual({ q, first: FIX_KEYS.menorah });
    expect((await rest(observer, 'GET', '/api/v1/library/items?bpmMin=100&bpmMax=130')).body.rows.map((x: any) => x.key)).toEqual([FIX_KEYS.track120]);
    expect((await rest(observer, 'GET', '/api/v1/library/items?credit=none&limit=200')).body.rows.some((x: any) => x.duties.credit)).toBe(false);
    expect((await rest(observer, 'GET', '/api/v1/library/items?who=me')).status).toBe(400);
    const one = await rest(observer, 'GET', item(FIX_KEYS.track120));
    expect(one.body).toMatchObject({ key: FIX_KEYS.track120, kind: 'music', meta: { bpm: 120 } });
    expect((await rest(observer, 'GET', item('no/such'))).body?.error?.code).toBe('library_item_missing');
    const lic = await raw(observer, 'GET', item(FIX_KEYS.track120, '/licence'));
    expect([lic.status, lic.headers.get('content-type')]).toEqual([200, 'text/plain; charset=utf-8']);
    expect(await lic.text()).toContain('SYNTHETIC licence text for incompetech');
  });
  it('A: audition answers 206 with exactly the asked bytes (a tree file and a file item); m4a and a picture answer 415', async () => {
    const file = fs.readFileSync(path.join(fx.root, 'sounds', 'fx-cc0', 'tone-a.wav'));
    const r = await raw(observer, 'GET', item(FIX_KEYS.toneA, '/audio'), undefined, { range: 'bytes=100-199' });
    expect([r.status, r.headers.get('content-range'), r.headers.get('content-type')]).toEqual([206, `bytes 100-199/${file.length}`, 'audio/wav']);
    expect(Buffer.from(await r.arrayBuffer()).equals(file.subarray(100, 200))).toBe(true);
    const mp3 = fs.readFileSync(path.join(fx.root, 'music', 'incompetech', 'mp3', 'Tone Track.mp3'));
    const m = await raw(observer, 'GET', item(FIX_KEYS.track120, '/audio'));
    expect([m.status, m.headers.get('content-type')]).toEqual([200, 'audio/mpeg']);
    expect(Buffer.from(await m.arrayBuffer()).equals(mp3)).toBe(true);
    expect((await rest(observer, 'GET', item(FIX_KEYS.m4a, '/audio'))).body?.error?.code).toBe('library_audio_unsupported');
    expect((await rest(observer, 'GET', item(FIX_KEYS.pattern, '/audio'))).status).toBe(415);
    expect((await rest(observer, 'GET', item(FIX_KEYS.tampered, '/audio'))).body?.error?.code).toBe('library_hash_mismatch');
    expect((await rest(observer, 'GET', item(FIX_KEYS.linked, '/audio'))).body?.error?.code).toBe('library_path_escape');
  });
  it('A: thumbnails are PNG made here, under DATA_CSP; an unsafe SVG is 422 before ffmpeg; no library answer is ever SVG', async () => {
    for (const key of [FIX_KEYS.pattern, FIX_KEYS.menorah, FIX_KEYS.heart, FIX_KEYS.iconCircle]) {
      const r = await raw(observer, 'GET', item(key, '/thumb?size=128'));
      const b = Buffer.from(await r.arrayBuffer());
      expect({ key, status: r.status, type: r.headers.get('content-type'), csp: r.headers.get('content-security-policy'), png: b.readUInt32BE(0) === 0x89504e47 }).toEqual({ key, status: 200, type: 'image/png', csp: DATA_CSP, png: true });
    }
    const runs = libraryRasterRuns;
    expect((await rest(observer, 'GET', item(FIX_KEYS.unsafe, '/thumb'))).body?.error?.code).toBe('svg_unsafe');
    expect(libraryRasterRuns).toBe(runs);
    expect((await rest(observer, 'GET', item(FIX_KEYS.pattern, '/thumb?size=999'))).status).toBe(400);
    expect(libraryTypes.length).toBeGreaterThan(10);
    expect(libraryTypes.filter((t) => /svg/i.test(t))).toEqual([]);
  });
  it('A: use — refusals store nothing: propose mode 403, unusable 409 with the reason, a changed file item 409 library_hash_mismatch, a touched tree file 409 library_changed_since_index, a link or `..` 409 library_path_escape, an unsafe SVG 422', async () => {
    const use = (who: Who, key: string, extra: Record<string, unknown> = {}) => rest(who, 'POST', `/api/v1/projects/${pid}/library/use`, { key, ...extra });
    const before = counts();
    expect((await use(proposer, FIX_KEYS.track120)).status).toBe(403);
    expect((await use(observer, FIX_KEYS.track120)).status).toBe(403);
    for (const [key, reason] of [[FIX_KEYS.nd, 'licence_no_derivatives'], [FIX_KEYS.unknownCustom, 'licence_unknown'], [FIX_KEYS.animated, 'animated'], [FIX_KEYS.orphan, 'credit_unresolved'], [FIX_KEYS.ccbyNoAuthor, 'credit_missing']] as const) {
      const r = await use(owner, key);
      expect({ key, status: r.status, code: r.body?.error?.code, reason: r.body?.error?.details?.reason }).toEqual({ key, status: 409, code: 'library_item_unusable', reason });
    }
    expect((await use(owner, FIX_KEYS.tampered)).body?.error?.code).toBe('library_hash_mismatch');
    expect((await use(owner, FIX_KEYS.linked)).body?.error?.code).toBe('library_path_escape');
    fx.touchTreeFile();
    expect((await use(owner, 'fx-cc0-sounds/pack/tone-b.wav')).body?.error?.code).toBe('library_changed_since_index');
    const runs = libraryRasterRuns;
    expect((await use(owner, FIX_KEYS.unsafe)).body?.error?.code).toBe('svg_unsafe');
    expect(libraryRasterRuns).toBe(runs);
    expect((await use(owner, FIX_KEYS.track120, { color: '#ff0000' })).status).toBe(400);
    expect((await use(owner, 'no/such')).body?.error?.code).toBe('library_item_missing');
    expect(counts()).toEqual(before);
    expect(fs.readdirSync(store.tmpDir).filter((f) => f.startsWith('lib_'))).toEqual([]);
  });
  it('A: use — a `..` path in a hand-edited ledger is listed and refused 409 library_path_escape; the outside file is never opened', async () => {
    fx.handLedger();
    try {
      expect((await rest(owner, 'POST', '/api/v1/library/reindex')).status).toBe(202);
      await untilReady();
      const before = counts();
      const opened: string[] = [];
      const real = fs.promises.open;
      fs.promises.open = (async (...a: Parameters<typeof real>) => { opened.push(String(a[0])); return real(...a); }) as typeof real;
      try {
        expect((await rest(owner, 'POST', `/api/v1/projects/${pid}/library/use`, { key: FIX_KEYS.dotdot })).body?.error?.code).toBe('library_path_escape');
        expect((await rest(owner, 'POST', `/api/v1/projects/${pid}/library/use`, { key: FIX_KEYS.linked })).body?.error?.code).toBe('library_path_escape');
      } finally { fs.promises.open = real; }
      expect(opened.filter((f) => f.includes('secret'))).toEqual([]);
      expect(counts()).toEqual(before);
    } finally {
      fx.restoreLedger();
      await rest(owner, 'POST', '/api/v1/library/reindex');
      await untilReady();
    }
  });
  it('A: use — a usable item: 501 library_not_built (nothing stored) until use_library_item is built; then copied by hash with its record, placed at the asked frame, undo keeps the file, a hand upload gets the record', async () => {
    const before = counts();
    const start = { value: '30', timescale: 30 };
    const r = await rest(owner, 'POST', `/api/v1/projects/${pid}/library/use`, { key: FIX_KEYS.track120, start });
    if (!LIBRARY_OPS_BUILT) {
      expect([r.status, r.body?.error?.code]).toEqual([501, 'library_not_built']);
      expect(counts()).toEqual(before);
      return;
    }
    expect(r.status).toBe(201);
    const doc = store.getProject(pid).doc;
    const a = doc.assets[r.body.assetId]!;
    const row = (await rest(observer, 'GET', item(FIX_KEYS.track120))).body;
    const ledger = JSON.parse(fs.readFileSync(fx.ledgerFile, 'utf8')).entries.findLast((e: any) => e.item === 'fx-incompetech/tone-120');
    expect(a.contentHash).toBe(`sha256:${ledger.sha256}`);
    expect(a.provenance.upload).toBeUndefined();
    expect(a.provenance.library).toMatchObject({ itemId: row.key, sourceId: 'incompetech', licence: { id: row.licenceId }, credit: row.credit, sourceSha256: ledger.sha256 });
    expect(r.body.placed?.clipId ?? r.body.placed?.clipIds).toBeTruthy();
    const undo = await rest(owner, 'POST', `/api/v1/projects/${pid}/undo`, {});
    expect(undo.status).toBe(200);
    expect(store.getProject(pid).doc.assets[r.body.assetId]).toBeTruthy();
    // a file uploaded by hand first, then used: no second asset, the record is attached
    const flac = fs.readFileSync(path.join(fx.root, 'music', 'musopen', 'flac', 'Aria.flac'));
    const up = await raw(owner, 'POST', `/api/v1/projects/${pid}/assets`, new Uint8Array(flac), { 'content-type': 'application/octet-stream', 'x-filename': 'Aria.flac' });
    expect(up.status).toBe(201);
    const n = Object.keys(store.getProject(pid).doc.assets).length;
    const used = await rest(owner, 'POST', `/api/v1/projects/${pid}/library/use`, { key: FIX_KEYS.flac });
    expect([used.status, used.body.recordAttached, Object.keys(store.getProject(pid).doc.assets).length]).toEqual([201, true, n]);
    expect(createHash('sha256').update(flac).digest('hex')).toBe(store.getProject(pid).doc.assets[used.body.assetId]!.provenance.library!.sourceSha256);
  });
  it('A: the import queue\'s library branch: received bytes that are not the checked ones are refused 409 before anything is stored; a bad record is 400', async () => {
    const { Readable } = await import('node:stream');
    const before = counts();
    const record = { itemId: 'x/y', sourceId: 'x', kind: 'sound', title: 't', sourceSha256: 'a'.repeat(64), ledger: { item: 'x/y' }, licence: { id: 'CC0-1.0' }, flags: {} } as const;
    const req = (expect: any, rec: any = record) => imports.receive({ projectId: pid, actor: 'user:local', body: Readable.from([Buffer.from('some bytes')]), name: 'y.wav', via: 'browser', declaredBytes: 10, maxBytes: 1 << 20, commitKind: 'edit', library: { record: rec, expect } });
    const code = async (p: Promise<unknown>) => { try { await p; return 'stored'; } catch (e) { return (e as { code?: string }).code; } };
    expect(await code(req({ sha256: 'b'.repeat(64) }))).toBe('library_hash_mismatch');
    expect(await code(req({ bytes: 11, mtimeMs: 1 }))).toBe('library_changed_since_index');
    expect(await code(req({ sha256: 'b'.repeat(64) }, { ...record, licence: {} }))).toBe('invalid_request');
    expect(await code(req({ sha256: 'xyz' }))).toBe('invalid_request');
    expect(counts()).toEqual(before);
    expect(fs.readdirSync(store.tmpDir).filter((f) => f.startsWith('up_'))).toEqual([]);
  });
  it('A: MCP use_library_item = REST (the same refusal for an unknown key)', async () => {
    const r = await rest(agent, 'POST', `/api/v1/projects/${pid}/library/use`, { key: 'none/none' });
    const u = await tool(agent, 'use_library_item', { projectId: pid, key: 'none/none' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(u.isError).toBe(true);
    expect(JSON.stringify(u.data)).toContain(r.body.error.code);
  });
  it('B: GET /credits = MCP get_credits = core collectCredits over the reader document', async () => {
    const lp = libraryProject();
    const doc = store.getProject(lp).doc;
    for (const lang of ['he', 'en'] as const) {
      const r = await rest(agent, 'GET', `/api/v1/projects/${lp}/credits?lang=${lang}`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual(JSON.parse(JSON.stringify(creditsView(collectCredits(doc), lang))));
      const g = await tool(agent, 'get_credits', { projectId: lp, lang });
      expect(g.isError).toBe(false);
      expect(g.data).toEqual(r.body);
    }
    expect((await rest(agent, 'GET', `/api/v1/projects/${lp}/credits`)).body.descriptionText).toBe(collectCredits(doc).descriptionText('he'));
    expect((await rest(agent, 'GET', `/api/v1/projects/${lp}/credits?sequenceId=seq_none`)).status).toBe(404);
  });
  it('B: archive — 409 archive_needs_library_choice with restricted content; strip leaves the restricted blob out; keep is the owner\'s (agent 403) and holds it', async () => {
    const lp = libraryProject();
    const nc = Object.values(store.getProject(lp).doc.assets).find((a) => a.provenance.library?.flags.nonCommercial)!.contentHash;
    const none = await rest(agent, 'GET', `/api/v1/projects/${lp}/archive`);
    expect({ status: none.status, code: none.body?.error?.code }).toEqual({ status: 409, code: 'archive_needs_library_choice' });
    expect((await rest(agent, 'GET', `/api/v1/projects/${lp}/archive?family=omit`)).status).toBe(409);
    const strip = await app.fetch(new Request(`${base()}/api/v1/projects/${lp}/archive?library=strip`, { headers: agent() }));
    expect(strip.status).toBe(200);
    expect(Buffer.from(await strip.arrayBuffer()).includes(Buffer.from(`blobs/${nc.slice(7)}`))).toBe(false);
    expect((await rest(agent, 'GET', `/api/v1/projects/${lp}/archive?library=keep`)).body?.error?.code).toBe('owner_required');
    const keep = await app.fetch(new Request(`${base()}/api/v1/projects/${lp}/archive?library=keep`, { headers: owner() }));
    expect(keep.status).toBe(200);
    expect(Buffer.from(await keep.arrayBuffer()).includes(Buffer.from(`blobs/${nc.slice(7)}`))).toBe(true);
  });
});
