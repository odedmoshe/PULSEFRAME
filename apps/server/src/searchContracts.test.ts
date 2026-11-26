/**
 * The server contract of «חיפוש בצילומים» (wave 7 search track; search/contract.ts), through the real app and MCP handler: every route
 * is registered, documented and classified; the owner rule holds BEFORE anything is read (an unknown project gives an agent the same
 * 403); a restricted grant is refused; MCP has exactly one search tool; the asset-gone listener and the purge hooks fire; the model pins
 * equal the manifest; the reviewed worker digest is the digest of the shipped pf_search.py. What builder B built is tested in
 * search/*.test.ts (the seven rows this file once held as to-dos are covered there: see search/runtime.test.ts and workers.test.ts).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { FOOTAGE_REFUSALS } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { SEARCH_INDEX_JOB_TYPE, SEARCH_MCP_TOOLS, SEARCH_OWNER_ROUTES, SEARCH_PICTURE, SEARCH_ROUTES, SEARCH_SERVER_BUILT, SEARCH_WORKER_SHA256, searchLaneLabel, SEARCH_LANE_PREFIX } from './search/contract.ts';
import { Speech } from './speech.ts';
import { collectGarbage, deleteProject, setSearchIndexHooks } from './storage.ts';
import { Store } from './store.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let ownerCookie = '', restrictedGrant = '', fullGrant = '', pid = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer), restricted = bearer(() => restrictedGrant), full = bearer(() => fullGrant);
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const type = r.headers.get('content-type') ?? '';
  const text = await r.text();
  return { status: r.status, text, body: type.includes('json') ? (JSON.parse(text) as any) : null };
};
let rpcId = 0;
async function rpc(who: Who, method: string, params: unknown): Promise<any> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const text = await r.text();
  return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
}
const urlOf = (route: string, project = pid) => route.split(' ')[1]!.replace(':id', project);
const methodOf = (route: string) => route.split(' ')[0]!;
const bodyFor = (route: string) => (route.endsWith('/search') ? { query: 'עוגה עם נרות' } : methodOf(route) === 'POST' ? {} : undefined);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const R = { num: 30, den: 1 };
const videoAsset = (k: number) => ({ kind: 'video' as const, name: `v${k}.mp4`, contentHash: `sha256:${String(k).repeat(64).slice(0, 64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(90, R), video: { width: 64, height: 36, frameRate: R, codec: 'h264', rotation: 0, frameCount: 90 }, provenance: prov });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-search-contract-'));
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
  pid = store.createProject({ name: 'search contract' }).doc.id;
  restrictedGrant = gov.createGrant({ name: 'restricted', mode: 'edit', trackIds: ['trk_none'] }, OWNER).token;
  fullGrant = gov.createGrant({ name: 'full', mode: 'edit', people: 'full' }, OWNER).token;
});
afterAll(async () => {
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the search routes are registered, documented and classified', () => {
  it('every route of SEARCH_ROUTES is in OpenAPI and in the people-surface table, with the classes of the decisions', () => {
    const doc = buildOpenApi() as { paths: Record<string, Record<string, { 'x-required-scope'?: string }>> };
    for (const route of SEARCH_ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      const op = doc.paths[p.replace(/:(\w+)/g, '{$1}')]?.[method.toLowerCase()];
      expect({ route, documented: !!op }).toEqual({ route, documented: true });
      expect({ route, classes: PEOPLE_REST_SURFACES[route] }).toEqual({ route, classes: SEARCH_OWNER_ROUTES.includes(route) ? ['owner-only'] : ['reader-document'] });
      expect({ route, scope: op?.['x-required-scope'] }).toEqual({ route, scope: SEARCH_OWNER_ROUTES.includes(route) ? 'owner' : 'observe' });
    }
    expect(PEOPLE_MCP_TOOLS.find_in_footage).toEqual(['reader-document']);
  });
  it('MCP has exactly one search tool, read-only, taking text only', async () => {
    const tools: { name: string; inputSchema: { properties: Record<string, unknown> }; annotations?: { readOnlyHint?: boolean } }[] = (await rpc(owner, 'tools/list', {})).result.tools;
    // understand_footage (wave 8 understand) starts the describe job: it takes no query, image or frame (understandContracts.test.ts)
    const searchy = tools.filter((t) => /footage|search_index|scan|similar|like_this/.test(t.name) && t.name !== 'understand_footage').map((t) => t.name);
    expect(searchy).toEqual([...SEARCH_MCP_TOOLS]);
    const t = tools.find((x) => x.name === 'find_in_footage')!;
    expect(Object.keys(t.inputSchema.properties).sort()).toEqual(['limit', 'projectId', 'query']);
    expect(t.annotations?.readOnlyHint).toBe(true);
  });
});

describe('checks before anything is read', () => {
  it('every owner route refuses every agent credential and the observer with 403 owner_required, also for a project that does not exist', async () => {
    for (const who of [agent, observer, full])
      for (const route of SEARCH_OWNER_ROUTES)
        for (const project of [pid, 'prj_none']) {
          const r = await rest(who, methodOf(route), urlOf(route, project), bodyFor(route));
          expect({ route, project, status: r.status, code: r.body?.error?.code }).toEqual({ route, project, status: 403, code: 'owner_required' });
          expect(r.body.error.message).toBe(FOOTAGE_REFUSALS.ownerOnly.message());
        }
  });
  it('a grant limited to tracks is refused the search with 403 out_of_scope (REST and MCP), and the query is never echoed', async () => {
    const r = await rest(restricted, 'POST', `/api/v1/projects/${pid}/search`, { query: 'מילהמסומנתxyz' });
    expect({ status: r.status, code: r.body?.error?.code, message: r.body?.error?.message }).toEqual({ status: 403, code: 'out_of_scope', message: FOOTAGE_REFUSALS.restricted.message() });
    expect(r.text).not.toContain('מילהמסומנתxyz');
    const m = await rpc(restricted, 'tools/call', { name: 'find_in_footage', arguments: { projectId: pid, query: 'מילהמסומנתxyz' } });
    expect(m.result.isError).toBe(true);
    expect(JSON.stringify(m)).not.toContain('מילהמסומנתxyz');
  });
  it('a query too long or with extra fields is refused 400 without repeating it', async () => {
    const long = 'סוד'.repeat(80);
    const r = await rest(owner, 'POST', `/api/v1/projects/${pid}/search`, { query: long });
    expect(r.status).toBe(400);
    expect(r.text).not.toContain('סודסוד');
    expect((await rest(owner, 'POST', `/api/v1/projects/${pid}/search`, { query: 'x', assetId: 'a' })).status).toBe(400);
  });
});

describe('the deletion hooks (landed in the pre-pass; builder B registers the index behind them)', () => {
  it('Store.addAssetsGoneListener hears the content hash of a removed file, and again after undo and redo of its import', () => {
    const heard: [string, string[]][] = [];
    const off = store.addAssetsGoneListener((p, h) => heard.push([p, h]));
    const p2 = store.createProject({ name: 'gone' }).doc.id;
    const asset = videoAsset(7);
    const imported = store.commit({ projectId: p2, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
    const assetId = imported.results[0]!.output!.assetId as string;
    expect(heard).toEqual([]);
    store.commit({ projectId: p2, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId } }] });
    expect(heard).toEqual([[p2, [asset.contentHash]]]);
    store.undo(p2, 'user:local', 'undo'); // the file is back: nothing is gone
    expect(heard).toHaveLength(1);
    store.undo(p2, 'user:local', 'redo');
    expect(heard).toEqual([[p2, [asset.contentHash]], [p2, [asset.contentHash]]]);
    off();
    store.undo(p2, 'user:local', 'undo');
    store.commit({ projectId: p2, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId } }] });
    expect(heard).toHaveLength(2);
  });
  it('a listener that throws never fails the commit', () => {
    const off = store.addAssetsGoneListener(() => { throw new Error('boom'); });
    const p3 = store.createProject({ name: 'boom' }).doc.id;
    const id = store.commit({ projectId: p3, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: videoAsset(8) } }] }).results[0]!.output!.assetId as string;
    const err = console.error; console.error = () => {};
    try { expect(store.commit({ projectId: p3, actor: 'user:local', ops: [{ op: 'remove_asset', args: { assetId: id } }] }).committed).toBe(true); } finally { console.error = err; off(); }
  });
  it('deleting a project and storage clean-up tell the search index which hashes may be gone', () => {
    const told: string[][] = [];
    setSearchIndexHooks(store, { hashesMaybeGone: (h) => told.push(h) });
    const p4 = store.createProject({ name: 'to delete' }).doc.id;
    const asset = videoAsset(9);
    store.commit({ projectId: p4, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
    deleteProject(store, OWNER, p4, 'to delete');
    expect(told).toEqual([[asset.contentHash]]);
    collectGarbage(store, OWNER, true); // nothing unreferenced and old enough: nothing told
    expect(told).toHaveLength(1);
    setSearchIndexHooks(store, null);
  });
});

describe('the picture model readiness record', () => {
  it('the seven pins equal the manifest items (bytes and sha256) and sum to 1,539,637,736 bytes; the source is disk only', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../../../tools/library/manifests/models-01.json', import.meta.url), 'utf8')) as { sources: { id: string; diskOnly: boolean; repoAllowed: boolean; items: { dest: string; sha256: string; bytes: number }[] }[] };
    const src = manifest.sources.find((s) => s.id === 'siglip2-base-patch16-256')!;
    expect({ diskOnly: src.diskOnly, repoAllowed: src.repoAllowed }).toEqual({ diskOnly: true, repoAllowed: false });
    for (const pin of SEARCH_PICTURE.pins) {
      const item = src.items.find((i) => i.dest === `${SEARCH_PICTURE.libraryPath}/${pin.path}`);
      expect({ pin: pin.path, sha256: item?.sha256, bytes: item?.bytes }).toEqual({ pin: pin.path, sha256: pin.sha256, bytes: pin.bytes });
    }
    expect(SEARCH_PICTURE.pins.reduce((n, p) => n + p.bytes, 0)).toBe(SEARCH_PICTURE.totalBytes);
    expect(SEARCH_PICTURE.totalBytes).toBe(1_539_637_736);
    expect(SEARCH_PICTURE.pins.map((p) => p.path)).not.toContain('README.md');
  });
  it('the job type and the lane label: the existing ^local\\. hook keeps the scan worker, and the search hook keys on its own prefix', () => {
    expect(SEARCH_INDEX_JOB_TYPE).toBe('search-index');
    expect(searchLaneLabel('prj_x')).toMatch(/^local\./);
    expect(searchLaneLabel('prj_x').startsWith(SEARCH_LANE_PREFIX)).toBe(true);
    expect('local.translate he-en'.startsWith(SEARCH_LANE_PREFIX)).toBe(false);
  });
  it('the server is built and the reviewed worker digest is exactly the lead-approved digest of the shipped pf_search.py', () => {
    expect(SEARCH_SERVER_BUILT).toBe(true);
    // approved by the lead on 2026-11-25 after reading all of the script; a changed byte is engine_unverified until it is read again
    expect(SEARCH_WORKER_SHA256).toBe('3b7d40990385b166b5f42b0a99eab60a717e4741e569c6f4762cf15b3e5141c1');
    expect(createHash('sha256').update(fs.readFileSync(new URL('../tools/pf_search.py', import.meta.url))).digest('hex')).toBe(SEARCH_WORKER_SHA256);
  });
  it('picture search is not a capability: nothing in the capability list names it', async () => {
    const r = await rest(owner, 'GET', '/api/v1/capabilities');
    expect(r.text).not.toContain(SEARCH_PICTURE.id);
  });
  it('the config reads PF_SEARCH_MODEL_DIR and is null without it', () => {
    expect(loadConfig({}).searchModelDir).toBeNull();
    expect(loadConfig({ PF_SEARCH_MODEL_DIR: '/x/m' } as never).searchModelDir).toBe(path.resolve('/x/m'));
  });
});
