/**
 * The server contract of the content library (wave 7 library track; library/contract.ts), through the real app and the real MCP
 * handler, before the workers: every route is registered, documented and classified; the owner rule holds before anything else;
 * every route answers the honest 501 library_not_built and reads nothing; the archive's library modes answer 501 while a plain
 * archive is unchanged; the backup leaves the library's files out. The it.todo rows name what workers A and B must make pass.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { collectCredits, creditsView } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { backupDataDir, NEVER_BACKED_UP } from './backup.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { LIBRARY_CONFIG_FILE, LIBRARY_INDEX_FILE, LIBRARY_ROUTES, LIBRARY_SERVER_REFUSALS } from './library/contract.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let ownerCookie = '', proposeGrant = '', pid = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer);
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const type = r.headers.get('content-type') ?? '';
  return { status: r.status, body: type.includes('json') ? ((await r.json()) as any) : null };
};
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

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-library-contract-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 23, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  proposeGrant = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
  pid = store.createProject({ name: 'library contract' }).doc.id;
});
afterAll(async () => {
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
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

describe('before the workers: honest 501, owner rule first', () => {
  it('the owner-only routes refuse an agent with 403 owner_required before anything else', async () => {
    for (const route of ['PUT /api/v1/library/root', 'POST /api/v1/library/reindex', 'DELETE /api/v1/library/reindex']) {
      const r = await rest(agent, route.split(' ')[0]!, urlOf(route), { root: null });
      expect({ route, status: r.status, code: r.body?.error?.code }).toEqual({ route, status: 403, code: 'owner_required' });
    }
  });
  it('every route answers 501 library_not_built to the owner, with the fixed sentence', async () => {
    // GET …/credits is built (worker B, library/credits.ts): it answers below
    for (const route of LIBRARY_ROUTES.filter((x) => x !== 'GET /api/v1/projects/:id/credits')) {
      const r = await rest(owner, route.split(' ')[0]!, urlOf(route), route.startsWith('POST') || route.startsWith('PUT') ? { key: 'none/none', root: null } : undefined);
      expect({ route, status: r.status, code: r.body?.error?.code, message: r.body?.error?.message }).toEqual({ route, status: 501, code: 'library_not_built', message: LIBRARY_SERVER_REFUSALS.notBuilt.message() });
    }
  });
  it('an observer cannot use an item (403), and may read the status route (which answers 501)', async () => {
    expect((await rest(observer, 'POST', urlOf('POST /api/v1/projects/:id/library/use'), { key: 'none/none' })).status).toBe(403);
    expect((await rest(observer, 'GET', '/api/v1/library/status')).status).toBe(501);
  });
  it('the archive: no library parameter is unchanged (200); strip and keep of a project without library files are the same 200; keep is the owner\'s; a bad value is 400', async () => {
    expect((await rest(owner, 'GET', `/api/v1/projects/${pid}/archive`)).status).toBe(200);
    expect((await rest(owner, 'GET', `/api/v1/projects/${pid}/archive?library=strip`)).status).toBe(200);
    expect((await rest(owner, 'GET', `/api/v1/projects/${pid}/archive?library=keep`)).status).toBe(200);
    expect((await rest(agent, 'GET', `/api/v1/projects/${pid}/archive?library=keep`)).body?.error?.code).toBe('owner_required');
    expect((await rest(owner, 'GET', `/api/v1/projects/${pid}/archive?library=all`)).status).toBe(400);
  });
  it('MCP use_library_item answers library_not_built', async () => {
    const u = await tool(agent, 'use_library_item', { projectId: pid, key: 'none/none' });
    expect(u.isError).toBe(true);
    expect(JSON.stringify(u.data)).toContain('library_not_built');
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
  it.todo('A: status without a root is not_configured (200); root set by the owner, agent 403; each invalid root 400 library_root_invalid with its reason; PF_LIBRARY_DIR wins over library.json');
  it.todo('A: the index is built in a temp file and swapped whole; the old index answers while indexing; DELETE /reindex keeps the old counts; a restart mid-build rebuilds');
  it.todo('A: search, audition (206 exact bytes; 415 for m4a), thumbnails PNG under DATA_CSP, never image/svg+xml');
  it.todo('A: use — dry-run before receive and before placement; hash/size+mtime/path checks store nothing on failure; propose mode 403; MCP use_library_item = REST');
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
