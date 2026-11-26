/**
 * The server contract of «מאגר» / «ייבוא מקישור» (wave 8 `sources`, part A; sources/contract.ts), through the real app and the real
 * MCP handler: every route is registered, documented and classified; the ONLY owner-only routes store or remove a service's
 * credential; every route answers 501 sources_not_built after its checks until W2 builds the runtime; the MCP tools are listed,
 * classified and answer the same; the descriptors' ids are core's; the import contract carries the source part (C7).
 * W2: the last part runs the plan's proof checks against the BUILT runtime through the real server (startServer, port 0) on
 * LABELLED doubles only (packages/evals/src/doubles/sources: 127.0.0.9, port 0, the injected test address policy) and core's own
 * use_source_item (W1). Never a real service, real media or a real key.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archiveLibraryPlan, SEARCHABLE_SOURCES, SOURCE_PROVIDERS, SOURCE_TERMS, SOURCES_API } from '@pulseframe/core';
import { GOLD_DOCS } from '../../../packages/core/src/credits.golden.fixtures.ts';
import { planArchive } from './archive.ts';
import { SOURCE_DESCRIPTORS, userAgentFor } from '@pulseframe/providers';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { exportLicence, Exporter, libraryExportWarnings } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { SOURCES_MCP_TOOLS, SOURCES_ROUTES } from './sources/contract.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

import { SOURCE_JOB_TYPE, validateProject, type Asset } from '@pulseframe/core';
import { DOUBLE_HOST, DOUBLE_PRIVATE_HOST, type LinkHost, type OpenverseDouble, type PixabayDouble, type WikimediaDouble } from '../../../packages/evals/src/doubles/sources/doubles.ts';
import { bootSources, client, CONTACT, OV_BY, OV_NC, OV_ND, filesContaining as filesContainingOf, freeSpace, makeFixtures, PX_KEY, sha, startDoubles, tmpFiles as tmpFilesOf, until, type Doubles, type Fixtures } from '../../../packages/evals/src/doubles/sources/harness.ts';
import type { RunningServer } from './index.ts';
import { createSourcesRuntime } from './sources/runtime.ts';
let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let pid = '', ownerCookie = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = () => Record<string, string>;
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer);
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as any) : null };
};
let rpcId = 0;
async function rpc(who: Who, method: string, params: unknown): Promise<any> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const text = await r.text();
  return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
}
const OWNER_ONLY = new Set(['PUT /api/v1/sources/:provider/credentials', 'DELETE /api/v1/sources/:provider/credentials']);
/** A valid request per route (so the answer is the runtime's, after every check). */
const call = (route: string): [string, string, unknown] => {
  const [method, p] = route.split(' ') as [string, string];
  const url = p.replace(':id', pid).replace(':provider', 'openverse').replace(':handle', 'none') + (p.endsWith('/search') ? '?q=rain' : '');
  const body = route.endsWith('/credentials') && method === 'PUT' ? { key: 'k' } : route.endsWith('/settings') && method === 'PUT' ? { maxDownloadBytes: 1000 }
    : route.endsWith('/import') ? { provider: 'openverse', itemId: 'x' } : route.endsWith('/link') ? { url: 'https://example.invalid/a.mp4' } : undefined;
  return [method, url, body];
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-sources-contract-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 24, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  const gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  pid = store.createProject({ name: 'sources contract' }).doc.id;
});
afterAll(async () => {
  await mcp.close(); await speech.stop(); await capabilities.stop(); store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the sources routes are registered, documented, classified and open', () => {
  it('every route is in OpenAPI and the people-surface table; only the two credential routes are owner-only; the MCP tools are classified', () => {
    const doc = buildOpenApi() as { paths: Record<string, Record<string, Record<string, unknown>>> };
    for (const route of SOURCES_ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      const op = doc.paths[p.replace(/:(\w+)/g, '{$1}')]?.[method.toLowerCase()];
      expect({ route, documented: !!op, ownerOnly: op?.['x-owner-session-only'] ?? false }).toEqual({ route, documented: true, ownerOnly: OWNER_ONLY.has(route) });
      expect({ route, classified: route in PEOPLE_REST_SURFACES, ownerOnly: (PEOPLE_REST_SURFACES[route] ?? []).includes('owner-only') }).toEqual({ route, classified: true, ownerOnly: OWNER_ONLY.has(route) });
    }
    for (const t of SOURCES_MCP_TOOLS) expect(PEOPLE_MCP_TOOLS[t], t).toBeTruthy();
  });
  it('pre-pass: every route answers 501 sources_not_built to the owner; an agent too, except the credential routes (403 owner_required); an observer cannot import', async () => {
    for (const route of SOURCES_ROUTES) {
      const [method, url, body] = call(route);
      const o = await rest(owner, method, url, body);
      expect({ route, status: o.status, code: o.body?.error?.code }).toEqual({ route, status: 501, code: 'sources_not_built' });
      const a = await rest(agent, method, url, body);
      expect({ route, status: a.status, code: a.body?.error?.code }).toEqual({ route, status: OWNER_ONLY.has(route) ? 403 : 501, code: OWNER_ONLY.has(route) ? SOURCES_API.ownerRequired.code : 'sources_not_built' });
    }
    for (const route of SOURCES_ROUTES.filter((r) => r.startsWith('POST'))) { const [m, u, b] = call(route); expect((await rest(observer, m, u, b)).status).toBe(403); }
  });
  it('checks come first: an unknown source is 404, a bad query or body 400, a non-JSON body 400', async () => {
    expect((await rest(owner, 'GET', '/api/v1/sources/flickr/search?q=x')).body.error.code).toBe('source_unknown');
    expect((await rest(owner, 'GET', '/api/v1/sources/openverse/search')).status).toBe(400);
    expect((await rest(owner, 'GET', `/api/v1/sources/openverse/search?q=${'x'.repeat(101)}`)).status).toBe(400);
    expect((await rest(agent, 'POST', `/api/v1/projects/${pid}/sources/link`, { url: 'https://x.invalid/a', extra: 1 })).status).toBe(400);
    expect((await rest(agent, 'POST', `/api/v1/projects/${pid}/sources/import`, { provider: 'link', itemId: 'x' })).status).toBe(400);
  });
  it('pre-pass: the MCP tools are listed and answer sources_not_built', async () => {
    const names = (await rpc(agent, 'tools/list', {})).result.tools.map((t: any) => t.name);
    for (const t of SOURCES_MCP_TOOLS) expect(names).toContain(t);
    const s = await rpc(agent, 'tools/call', { name: 'search_sources', arguments: { provider: 'openverse', q: 'rain' } });
    expect(s.result.isError).toBe(true);
    expect(s.result.content[0].text).toContain('sources_not_built');
    const i = await rpc(agent, 'tools/call', { name: 'import_from_link', arguments: { projectId: pid, url: 'https://example.invalid/a.mp4' } });
    expect(i.result.content[0].text).toContain('sources_not_built');
  });
  it('the search tool asks for plain words and says they are sent, never "names of people or places" (C16)', async () => {
    const tool = (await rpc(agent, 'tools/list', {})).result.tools.find((t: any) => t.name === 'search_sources');
    expect(tool.description).toContain('plain words for the picture or sound wanted');
    expect(tool.description).not.toMatch(/never names|places or the project/);
  });
});

describe('descriptors and the User-Agent', () => {
  it('descriptor ids are core SOURCE_PROVIDERS; every service limit names its source; Openverse lists the hourly 5 (C9); Pixabay keeps 24 h', () => {
    expect(SOURCE_DESCRIPTORS.map((d) => d.id)).toEqual([...SOURCE_PROVIDERS]);
    expect(SOURCE_DESCRIPTORS.filter((d) => d.id !== 'link').map((d) => d.id)).toEqual([...SEARCHABLE_SOURCES]);
    for (const d of SOURCE_DESCRIPTORS) for (const l of d.limits) expect(l.source.length).toBeGreaterThan(10);
    expect(SOURCE_DESCRIPTORS[0]!.limits[0]).toMatchObject({ requests: 5, perSeconds: 3600, who: 'anonymous', confirmed: false });
    expect(SOURCE_DESCRIPTORS.find((d) => d.id === 'pixabay')!.cacheSeconds).toBe(86400);
  });
  it('no version, no machine detail; Wikimedia carries the contact the owner typed, never an invented one', () => {
    expect(userAgentFor('openverse', null)).toBe('PULSEFRAME-Studio');
    expect(userAgentFor('wikimedia', null)).toBe('PULSEFRAME-Studio');
    expect(userAgentFor('wikimedia', 'me@example.invalid')).toBe('PULSEFRAME-Studio (me@example.invalid)');
  });
});


// ---------------------------------------------------------------- W2: the built runtime on labelled doubles (proof checks of sources-plan §5 as cut)
// one harness with proof:sources (packages/evals/src/doubles/sources/harness.ts)
let root = '', ddir = '';
let s: RunningServer;
let ov: OpenverseDouble, px: PixabayDouble, wm: WikimediaDouble, host: LinkHost, nas: LinkHost;
let dbl: Doubles;
let rpid = '';
const free = freeSpace;
let fx: Fixtures;
const { api, finished } = client(() => s);
const tmpFiles = () => tmpFilesOf(ddir);
const assets = () => Object.values(s.store.wholeProject(rpid).doc.assets) as Asset[];
const filesContaining = (needle: string) => filesContainingOf(ddir, needle);
async function boot() { s = await bootSources(ddir, dbl); }

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-sources-rt-'));
  ddir = path.join(root, 'data');
  fx = makeFixtures(root);
  dbl = await startDoubles(fx);
  ({ host, nas, ov, px, wm } = dbl);
  await boot();
  rpid = s.store.createProject({ name: 'Secret project name 9z' }).doc.id;
}, 180_000);
afterAll(async () => {
  await s?.close();
  await dbl?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('search (checks 1, 1b, 2, 3, 3b)', () => {
  it('check 1: Openverse rows carry the licence from the answer; the double saw exactly q, the filters and the User-Agent, nothing of the project', async () => {
    const r = await api('agent', 'GET', '/api/v1/sources/openverse/search?q=red%20cat&kind=photo');
    expect(r.status).toBe(200);
    const row = r.body.rows[0];
    expect(row).toMatchObject({ provider: 'openverse', itemId: 'image:a1b2c3d4-0000-4000-8000-000000000001', kind: 'photo', title: 'Red cat', author: 'Ann Author', licence: { id: 'CC-BY-4.0', name: 'CC BY 4.0', from: 'item' } });
    expect(row.creditPreview).toBe('"Red cat" by Ann Author is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.');
    expect(row.preview).toMatch(/^\/api\/v1\/source-previews\/[0-9a-f]{32}$/);
    expect(r.body).toMatchObject({ cached: false, remaining: { count: 4, perSeconds: 3600 }, attribution: { en: 'Results from Openverse' } });
    const seen = ov.seen.at(-1)!;
    expect([seen.path, seen.query]).toEqual(['/v1/images/', { q: 'red cat', page: '1', page_size: '20', category: 'photograph' }]);
    expect(seen.headers['user-agent']).toBe('PULSEFRAME-Studio');
    expect(JSON.stringify(seen)).not.toMatch(/Secret project|9z|user:local|agent:/);
  });
  it('check 1b (C9): anonymous searches are counted here and refused before the service would answer 429; a 429 of the service maps to provider_rate_limited with retryAfterSeconds', async () => {
    const left: number[] = [];
    for (const q of ['a', 'b', 'c', 'd']) left.push((await api('agent', 'GET', `/api/v1/sources/openverse/search?q=${q}`)).body.remaining.count);
    expect(left).toEqual([3, 2, 1, 0]);
    const n = ov.seen.length;
    const r = await api('agent', 'GET', '/api/v1/sources/openverse/search?q=e');
    expect([r.status, r.body.error.code, r.body.error.details.countedHere]).toEqual([429, 'provider_rate_limited', true]);
    expect(r.body.error.details.retryAfterSeconds).toBeGreaterThan(3000);
    expect(ov.seen.length).toBe(n); // nothing was sent
    expect((await api('agent', 'GET', '/api/v1/sources/openverse/search?q=a')).body.cached).toBe(true); // an answer in memory needs no request
    // the owner's client: a higher limit; the service's own 429 passes through with its Retry-After
    expect((await api('owner', 'PUT', '/api/v1/sources/openverse/credentials', { clientId: ov.client.id, clientSecret: ov.client.secret })).body).toMatchObject({ provider: 'openverse', mode: 'client', keySet: true });
    ov.limitAfter = 0;
    const t = await api('agent', 'GET', '/api/v1/sources/openverse/search?q=f');
    expect([t.status, t.body.error.code, t.body.error.details.retryAfterSeconds]).toEqual([429, 'provider_rate_limited', 1800]);
    expect(ov.seen.at(-1)!.headers.authorization).toBe(`Bearer ${ov.client.token}`);
    ov.limitAfter = null;
  });
  it('check 2: Pixabay without a key is provider_key_missing; an agent cannot store one (403); the owner can; the double saw it; nothing stored or answered holds it', async () => {
    expect((await api('agent', 'GET', '/api/v1/sources/pixabay/search?q=sunrise&kind=video')).body.error.code).toBe('provider_key_missing');
    expect((await api('agent', 'PUT', '/api/v1/sources/pixabay/credentials', { key: PX_KEY })).body.error.code).toBe('owner_required');
    expect((await api('owner', 'PUT', '/api/v1/sources/pixabay/credentials', { contact: 'x@y' })).body.error.code).toBe('invalid_credentials');
    const st = await api('owner', 'PUT', '/api/v1/sources/pixabay/credentials', { key: PX_KEY });
    expect(st.body).toMatchObject({ provider: 'pixabay', state: 'ready', keySet: true });
    expect(st.raw.toString()).not.toContain(PX_KEY);
    const r = await api('agent', 'GET', '/api/v1/sources/pixabay/search?q=sunrise&kind=video');
    expect(r.status).toBe(200);
    expect(r.body.rows[0]).toMatchObject({ provider: 'pixabay', itemId: 'video:4242', kind: 'video', author: 'Monika', licence: { id: 'provider:pixabay', from: 'provider' }, flags: { licenceUnconfirmed: true, notShareable: true }, creditPreview: 'Monika on Pixabay' });
    expect(r.body.terms).toEqual(['pixabay.show_source', 'pixabay.cache_24h', 'pixabay.hotlink', 'pixabay.licence_unread']);
    expect(px.seen.at(-1)!.query).toEqual({ q: 'sunrise', page: '1', per_page: '20', key: PX_KEY });
    expect(r.raw.toString()).not.toContain(PX_KEY);
    px.key = 'another'; // the service now refuses the stored key
    const bad = await api('agent', 'GET', '/api/v1/sources/pixabay/search?q=sea&kind=video');
    expect([bad.status, bad.body.error.code]).toEqual([502, 'provider_key_rejected']);
    expect(bad.raw.toString()).not.toContain(PX_KEY);
    px.key = PX_KEY;
    const list = await api('observer', 'GET', '/api/v1/sources');
    expect(list.body.sources.map((x: any) => [x.provider, x.state])).toEqual([['openverse', 'ready'], ['pixabay', 'ready'], ['wikimedia', 'needs_contact']]);
    expect(list.raw.toString()).not.toContain(PX_KEY);
  });
  it('check 3: an identical Pixabay search within 24 h is answered from memory (one request); no query word on disk', async () => {
    const n = px.seen.length;
    const a = await api('agent', 'GET', '/api/v1/sources/pixabay/search?q=sunrise&kind=video');
    expect(a.body.cached).toBe(true);
    expect(px.seen.length).toBe(n);
    expect(filesContaining('sunrise')).toEqual([]);
    expect(filesContaining(PX_KEY)).toEqual([]);
  });
  it('check 3b: Wikimedia without a contact sends nothing (provider_contact_missing); with one the double saw it in the User-Agent; the Artist HTML is text', async () => {
    const n = wm.seen.length;
    expect((await api('agent', 'GET', '/api/v1/sources/wikimedia/search?q=green')).body.error.code).toBe('provider_contact_missing');
    expect(wm.seen.length).toBe(n);
    expect((await api('owner', 'PUT', '/api/v1/sources/wikimedia/credentials', { contact: CONTACT })).body.state).toBe('ready');
    const r = await api('agent', 'GET', '/api/v1/sources/wikimedia/search?q=green&kind=photo');
    expect(r.body.rows[0]).toMatchObject({ provider: 'wikimedia', itemId: '777', title: 'Green field.png', author: 'Ann', licence: { id: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0' }, flags: { shareAlike: true, licenceUnconfirmed: true, notShareable: true } });
    expect(wm.seen.at(-1)!.headers['user-agent']).toBe(`PULSEFRAME-Studio (${CONTACT})`);
    expect(wm.seen.at(-1)!.query.gsrsearch).toBe('green filetype:bitmap');
    expect(ov.seen.every((x) => !String(x.headers['user-agent']).includes(CONTACT))).toBe(true); // sent to Wikimedia only
  });
});

describe('previews (check 4)', () => {
  it('a handle streams the double\'s bytes with Range; an unknown handle is 404; a URL in place of a handle is never fetched', async () => {
    const row = (await api('agent', 'GET', '/api/v1/sources/openverse/search?q=red%20cat&kind=photo')).body.rows[0];
    const r = await api('observer', 'GET', row.thumb);
    expect([r.status, r.headers.get('content-type'), sha(r.raw)]).toEqual([200, 'image/png', sha(fx['red.png']!)]);
    const h = await fetch(`${s.url}${row.preview}`, { headers: { authorization: `Bearer ${s.auth.tokens.observer}`, range: 'bytes=0-9' } });
    expect([h.status, h.headers.get('content-range')]).toEqual([206, `bytes 0-9/${fx['red.png']!.length}`]);
    expect(Buffer.from(await h.arrayBuffer())).toEqual(fx['red.png']!.subarray(0, 10));
    expect((await api('observer', 'GET', `/api/v1/source-previews/${'ab'.repeat(16)}`)).body.error.code).toBe('preview_not_found');
    const n = host.seen.length;
    expect((await api('observer', 'GET', `/api/v1/source-previews/${encodeURIComponent(`${host.url}/ov/red.png`)}`)).status).toBe(404);
    expect(host.seen.length).toBe(n);
  });
});

describe('import (checks 5, 6, 7, 8, 9, 10, 14)', () => {
  it('check 5: a CC BY item imported as an agent: one use_source_item and one add_clip, both the agent\'s; the record validates; undo removes each exactly', async () => {
    const before = s.store.wholeProject(rpid).revision;
    const a = await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/import`, { provider: 'openverse', itemId: 'image:a1b2c3d4-0000-4000-8000-000000000001', place: { start: { value: '0', timescale: 1 } } });
    expect(a.status).toBe(202);
    expect(a.body).toMatchObject({ route: 'provider', terms: [] });
    const j = await finished(a.body.jobId);
    expect([j.status, j.error]).toEqual(['succeeded', null]);
    const out = j.output as any;
    const asset = s.store.wholeProject(rpid).doc.assets[out.assetId]!;
    expect(asset.provenance).toMatchObject({ origin: 'upload', importedBy: 'agent:local', source: { provider: 'openverse', itemId: 'image:a1b2c3d4-0000-4000-8000-000000000001', kind: 'photo', title: 'Red cat', author: 'Ann Author', sha256: sha(fx['red.png']!), byteSize: fx['red.png']!.length, licence: { id: 'CC-BY-4.0', from: 'item' }, credit: { text: '"Red cat" by Ann Author is licensed under CC BY 4.0. To view a copy of this license, visit https://creativecommons.org/licenses/by/4.0/.', placement: 'description', due: true } } });
    expect(asset.provenance.upload).toBeUndefined();
    expect(Date.parse(asset.provenance.source!.fetchedAt)).toBeGreaterThan(0);
    expect(validateProject(s.store.wholeProject(rpid).doc).filter((i) => i.code === 'source_provenance')).toEqual([]);
    const txs = s.store.db.prepare('SELECT id, actor, ops FROM transactions WHERE project_id = ? AND revision > ? ORDER BY revision').all(rpid, before) as { id: string; actor: string; ops: string }[];
    expect(txs.map((t) => [t.actor, JSON.parse(t.ops).map((o: any) => o.op)])).toEqual([['agent:local', ['use_source_item']], ['agent:local', ['add_clip']]]);
    expect(out.placed).toBeTruthy();
    const docBefore = JSON.stringify(s.store.replay(rpid, before + 1).doc);
    expect((await api('agent', 'POST', `/api/v1/projects/${rpid}/undo`, { transactionId: txs[1]!.id })).status).toBe(200);
    expect(JSON.stringify(s.store.wholeProject(rpid).doc)).toBe(docBefore);
    expect((await api('agent', 'POST', `/api/v1/projects/${rpid}/undo`, { transactionId: txs[0]!.id })).status).toBe(200);
    expect(s.store.wholeProject(rpid).doc.assets[out.assetId]).toBeUndefined();
    expect(tmpFiles()).toEqual([]);
    expect(JSON.stringify(j)).not.toContain(host.url); // the row holds no file URL
  });
  it('a Pixabay video imports with its fixed licence row; no job row, event or answer holds the key', async () => {
    const a = await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/import`, { provider: 'pixabay', itemId: 'video:4242', rendition: 'medium' });
    expect(a.body.terms).toContain('pixabay.licence_unread');
    const j = await finished(a.body.jobId);
    expect(j.status).toBe('succeeded');
    const rec = s.store.wholeProject(rpid).doc.assets[(j.output as any).assetId]!.provenance.source!;
    expect(rec).toMatchObject({ provider: 'pixabay', licence: { id: 'provider:pixabay', name: 'Pixabay Content License', from: 'provider' }, flags: { licenceUnconfirmed: true, notShareable: true }, credit: { text: 'Monika on Pixabay', due: false }, terms: ['pixabay.show_source', 'pixabay.cache_24h', 'pixabay.hotlink', 'pixabay.licence_unread'] });
    expect(filesContaining(PX_KEY)).toEqual([]);
    expect((await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/import`, { provider: 'pixabay', itemId: 'video:4242', rendition: 'huge' })).status).toBe(400);
  });
  it('check 14: the same idempotencyKey twice is one job and one download', async () => {
    const url = host.put('/once.png', { bytes: fx['blue.png']!, contentType: 'image/png' });
    const a = await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url, idempotencyKey: 'k-once' });
    const b = await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url, idempotencyKey: 'k-once' });
    expect(b.body.jobId).toBe(a.body.jobId);
    expect((await finished(a.body.jobId)).status).toBe('succeeded');
    expect(host.seen.filter((x) => x.path === '/once.png').length).toBe(1);
    const row = s.store.getJob(a.body.jobId);
    expect(JSON.stringify(row)).not.toContain(url); // C11: the link is in the sidecar only, never in the row
    expect(row.input).toMatchObject({ route: 'direct', provider: 'link', host: DOUBLE_HOST });
  });
  it('check 6: a download cut at 50% resumes with Range + If-Range; a changed ETag or a 200 to the Range restarts at 0; the final hash is the file\'s', async () => {
    const big = fx['big.mp4']!, half = Math.floor(big.length / 2);
    const url = host.put('/cut.mp4', { bytes: big, contentType: 'video/mp4', etag: '"v1"', cutAfterBytes: half });
    const j = await finished((await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url })).body.jobId);
    expect([j.status, j.error]).toEqual(['succeeded', null]);
    const asks = host.seen.filter((x) => x.path === '/cut.mp4');
    expect(asks.length).toBe(2);
    expect([asks[1]!.headers.range, asks[1]!.headers['if-range']]).toEqual([`bytes=${half}-`, '"v1"']);
    const a1 = s.store.wholeProject(rpid).doc.assets[(j.output as any).assetId]!;
    expect(a1.provenance.source!.sha256).toBe(sha(big));
    // the file changes between the two requests: the double answers 200 (If-Range no longer matches) and the download starts over
    const big2 = fx['big2.mp4']!;
    host.put('/changed.mp4', { bytes: big2, contentType: 'video/mp4', etag: '"v1"', cutAfterBytes: Math.floor(big2.length / 2), onAnswer: (n, f) => { if (n === 1) f.etag = '"v2"'; } });
    const j2 = await finished((await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: `${host.url}/changed.mp4` })).body.jobId);
    expect(j2.status).toBe('succeeded');
    const asks2 = host.seen.filter((x) => x.path === '/changed.mp4');
    expect(asks2[1]!.headers['if-range']).toBe('"v1"');
    expect(s.store.wholeProject(rpid).doc.assets[(j2.output as any).assetId]!.provenance.source!.sha256).toBe(sha(big2));
    // a server that ignores Range answers 200: from the start
    const big3 = fx['big3.mp4']!;
    host.put('/norange.mp4', { bytes: big3, contentType: 'video/mp4', cutAfterBytes: 1000, ignoreRange: true });
    const j3 = await finished((await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: `${host.url}/norange.mp4` })).body.jobId);
    expect(j3.status).toBe('succeeded');
    expect(s.store.wholeProject(rpid).doc.assets[(j3.output as any).assetId]!.provenance.source!.sha256).toBe(sha(big3));
    expect(tmpFiles()).toEqual([]);
  });
  it('check 7: a restart mid-download continues the .part; after cancel and after a failure no src_ .part, .link or up_ file is left', async () => {
    const big = fx['big.mp4']!;
    const f = { bytes: big, contentType: 'video/mp4', etag: '"r1"', stallAfterBytes: 40_000 } as { bytes: Buffer; contentType: string; etag: string; stallAfterBytes?: number };
    const url = host.put('/restart.mp4', f);
    const a = await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url, idempotencyKey: 'k-restart' });
    const part = path.join(ddir, 'tmp', `src_${a.body.jobId}.part`);
    await until(() => fs.existsSync(part) && fs.statSync(part).size >= 40_000);
    await s.close(); // the job stays running; its .part and .link stay
    expect(s.store === undefined || true).toBe(true);
    expect(fs.existsSync(part) && fs.existsSync(part.replace(/\.part$/, '.link'))).toBe(true);
    delete f.stallAfterBytes;
    await boot();
    const j = await finished(a.body.jobId);
    expect(j.status).toBe('succeeded');
    const asks = host.seen.filter((x) => x.path === '/restart.mp4');
    expect(asks.at(-1)!.headers.range).toBe('bytes=40000-');
    expect(s.store.wholeProject(rpid).doc.assets[(j.output as any).assetId]!.provenance.source!.sha256).toBe(sha(big));
    expect(tmpFiles()).toEqual([]);
    // cancel: the starting credential stops it; nothing is left
    const c = await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: host.put('/stall2.mp4', { bytes: fx['big2.mp4']!, contentType: 'video/mp4', stallAfterBytes: 10_000 }) });
    await until(() => tmpFiles().some((x) => x.startsWith(`src_${c.body.jobId}.part`)));
    expect((await api('observer', 'POST', `/api/v1/jobs/${c.body.jobId}/cancel`)).status).toBe(403);
    expect((await api('agent', 'POST', `/api/v1/jobs/${c.body.jobId}/cancel`)).status).toBe(200);
    expect((await finished(c.body.jobId)).status).toBe('canceled');
    expect(tmpFiles()).toEqual([]);
    // a failure: nothing is left either
    const h = await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: host.put('/page.html', { bytes: Buffer.from('<!doctype html><title>x</title>'), contentType: 'text/html; charset=utf-8' }) });
    const fj = await finished(h.body.jobId);
    expect([fj.status, (fj.error as any).code]).toEqual(['failed', 'download_not_media']); // check 10
    expect(tmpFiles()).toEqual([]);
  });
  it('check 8: the limit is any edit credential\'s setting, never above the upload limit; a larger file (no or a high Content-Length) is download_too_large and nothing is stored; the free space is checked (download_disk_full)', async () => {
    const st = await api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: 100_000 });
    expect(st.body).toEqual({ maxDownloadBytes: 100_000, maxUploadBytes: s.cfg.maxUploadBytes, effectiveMaxBytes: 100_000 });
    expect((await api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: s.cfg.maxUploadBytes * 4 })).body.effectiveMaxBytes).toBe(s.cfg.maxUploadBytes);
    await api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: 100_000 });
    const n = assets().length;
    const big = Buffer.concat([fx['big.mp4']!, Buffer.from('never stored')]); // bytes no earlier check imported
    expect(big.length).toBeGreaterThan(200_000);
    for (const file of [{ bytes: big, contentType: 'video/mp4', noContentLength: true }, { bytes: big.subarray(0, 50_000), contentType: 'video/mp4', lieContentLength: 500_000 }]) {
      const j = await finished((await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: host.put(`/large-${file.noContentLength ? 'a' : 'b'}.mp4`, file) })).body.jobId);
      expect([j.status, (j.error as any).code, (j.error as any).details.maxBytes]).toEqual(['failed', 'download_too_large', 100_000]);
      expect((j.error as any).message).toContain('100000 bytes');
    }
    const stored = fs.readdirSync(path.join(ddir, 'blobs'));
    expect([assets().length, stored.includes(sha(big)), stored.includes(sha(big.subarray(0, 50_000))), tmpFiles()]).toEqual([n, false, false, []]);
    await api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: null });
    free.bytes = s.cfg.importReserveBytes + 10; // labelled stand-in: the data drive is almost full
    const d = await finished((await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: `${host.url}/cut.mp4` })).body.jobId);
    expect([d.status, (d.error as any).code]).toEqual(['failed', 'download_disk_full']);
    free.bytes = 100 * 1024 ** 3;
    expect(tmpFiles()).toEqual([]);
  });
  it('check 9 (C8): links to this computer, link-local and its own addresses are refused; a redirect or a name leading there fails the job; a home-network address imports with link_private_network', async () => {
    const port = host.port;
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4')?.address;
    for (const h of ['127.0.0.1', '[::ffff:127.0.0.1]', '[::1]', '169.254.169.254', '0.0.0.0', ...(lan ? [lan] : [])]) {
      const r = await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: `http://${h}:${port}/ov/red.png` });
      expect({ h, status: r.status, code: r.body.error?.code }).toEqual({ h, status: 422, code: 'link_address_refused' });
    }
    host.put('/to-loop', { bytes: Buffer.alloc(0), redirectTo: `http://127.0.0.1:${port}/ov/red.png` });
    for (const url of [`${host.url}/to-loop`, `http://localhost:${port}/ov/red.png`]) {
      const j = await finished((await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url })).body.jobId);
      expect({ url, status: j.status, code: (j.error as any).code }).toEqual({ url, status: 'failed', code: 'link_address_refused' });
      expect(JSON.stringify(j.error)).not.toContain('/ov/red.png');
    }
    const a = await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: nas.put('/nas/clip.mp4', { bytes: fx['small.mp4']!, contentType: 'video/mp4' }) });
    expect(a.body.warnings.map((w: any) => w.code)).toEqual(['link_private_network']);
    const j = await finished(a.body.jobId);
    expect(j.status).toBe('succeeded');
    expect((j.output as any).warnings.map((w: any) => w.code)).toContain('link_private_network');
    const rec = s.store.wholeProject(rpid).doc.assets[(j.output as any).assetId]!.provenance.source!;
    expect(rec).toMatchObject({ provider: 'link', kind: 'video', title: 'clip.mp4', licence: { id: 'unknown', from: 'none' }, flags: { licenceUnconfirmed: true, notShareable: true }, link: { via: 'direct', host: DOUBLE_PRIVATE_HOST } });
    expect((await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: 'ftp://x/a.mp4' })).body.error.code).toBe('link_not_http');
  });
  it('check 9b: the DEFAULT address policy (nothing injected) refuses 127.0.0.1 and the doubles\' own loopback address', async () => {
    const rt = createSourcesRuntime({ cfg: s.cfg, store: s.store, gov: s.governance, imports: s.imports });
    const owner = { actor: 'user:local', kind: 'user' as const, scopes: ['observe' as const, 'edit' as const] };
    for (const url of [`http://127.0.0.1:${host.port}/ov/red.png`, `${host.url}/ov/red.png`]) await expect(rt.importLink(owner, rpid, { url })).rejects.toMatchObject({ status: 422, code: 'link_address_refused' });
    await rt.stop();
  });
  it('an observer cannot import; a source_fetch job is listed as one', async () => {
    expect((await api('observer', 'POST', `/api/v1/projects/${rpid}/sources/link`, { url: `${host.url}/ov/red.png` })).status).toBe(403);
    expect((s.store.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE type = ?').get(SOURCE_JOB_TYPE) as { n: number }).n).toBeGreaterThan(5);
  });
  it('check 11 (W2 part): an ND item imports with no refusal; the record carries noDerivatives (the export warnings are W1\'s)', async () => {
    const a = await api('agent', 'POST', `/api/v1/projects/${rpid}/sources/import`, { provider: 'openverse', itemId: 'image:a1b2c3d4-0000-4000-8000-000000000002' });
    const j = await finished(a.body.jobId);
    expect(j.status).toBe('succeeded');
    expect(s.store.wholeProject(rpid).doc.assets[(j.output as any).assetId]!.provenance.source).toMatchObject({ licence: { id: 'CC-BY-ND-4.0' }, flags: { noDerivatives: true, licenceUnconfirmed: true, notShareable: true }, credit: { due: true } });
  });
  it('MCP: search_sources and import_from_link answer through the same runtime, as the agent (no approval step)', async () => {
    const rpc = async (method: string, params: unknown) => {
      const r = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const t = await r.text();
      return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : t);
    };
    const found = await rpc('tools/call', { name: 'search_sources', arguments: { provider: 'wikimedia', q: 'green', kind: 'photo' } });
    expect(found.result.isError).toBeFalsy();
    expect(found.result.content[0].text).toContain('"itemId":"777"');
    const imp = await rpc('tools/call', { name: 'import_from_link', arguments: { projectId: rpid, url: host.put('/mcp.png', { bytes: fx['green.png']!, contentType: 'image/png' }), place: { start: { value: '0', timescale: 1 } } } });
    const jobId = JSON.parse(imp.result.content[0].text).jobId as string;
    const j = await finished(jobId);
    expect([j.status, j.actor, (j.output as any).placed !== null]).toEqual(['succeeded', 'agent:local', true]);
  });
});

describe('checks 11 and 12 (W1\'s answers through the real server)', () => {
  it('check 11: an NC, an ND and a Pixabay item import with warnings, never refused; preflight names the licences and quotes the ND deed; nothing blocks; a sharing archive leaves the NC and the Pixabay files out (the CC BY one stays); no choice is a 409 asking for one', async () => {
    const pid11 = s.store.createProject({ name: 'check 11' }).doc.id;
    const imp = async (provider: string, itemId: string) => finished((await api('agent', 'POST', `/api/v1/projects/${pid11}/sources/import`, { provider, itemId, place: { start: { value: String(2 * (await Promise.resolve(Object.keys(s.store.wholeProject(pid11).doc.assets).length))), timescale: 1 } } })).body.jobId);
    const nc = await imp('openverse', `image:${OV_NC}`), nd = await imp('openverse', `image:${OV_ND}`), pxj = await imp('pixabay', 'video:4242'), by = await imp('openverse', `image:${OV_BY}`);
    for (const j of [nc, nd, pxj, by]) expect([j.status, j.error]).toEqual(['succeeded', null]);
    // the import job's warnings are core use_source_item's (sourceDuties), carried onto the source_fetch job
    expect((nd.output as any).warnings.map((w: any) => w.code)).toContain('licence_no_derivatives');
    expect((nc.output as any).warnings.map((w: any) => w.code)).toContain('non_commercial_content');
    expect((pxj.output as any).warnings.map((w: any) => w.code)).toEqual(['licence_unconfirmed', 'source_terms']);
    const pf = await api('agent', 'GET', `/api/v1/projects/${pid11}/preflight`);
    const byCode = (c: string) => pf.body.issues.filter((i: any) => i.code === c);
    expect(byCode('non_commercial_content')[0].message).toContain('CC BY-NC 4.0');
    expect(byCode('licence_no_derivatives')[0].message).toContain(SOURCE_TERMS['cc.nd']!.quote);
    expect(byCode('licence_no_derivatives')[0].message).toContain('CC BY-ND 4.0');
    expect(byCode('source_terms').length).toBe(1);
    expect(pf.body.issues.filter((i: any) => ['non_commercial_content', 'licence_no_derivatives', 'licence_unconfirmed', 'source_terms', 'credits_for_description'].includes(i.code)).every((i: any) => i.severity !== 'blocker')).toBe(true);
    expect((await api('owner', 'GET', `/api/v1/projects/${pid11}/archive`)).body.error.code).toBe('archive_needs_library_choice');
    expect(planArchive(s.store, pid11, { family: 'keep', library: 'strip' }).library).toBe('strip');
    const left = new Set(archiveLibraryPlan(s.store.getProject(pid11).doc).omitted.map((o) => o.assetId)); // what planArchive leaves out
    const ids = [nc, nd, pxj, by].map((j) => (j.output as any).assetId as string);
    expect([left.has(ids[0]!), left.has(ids[2]!), left.has(ids[3]!)]).toEqual([true, true, false]);
  });
  it('check 12: the library-only golden documents answer byte-identically in this server process; a project with only a CC BY source credit gets the export reminder and a credits card', async () => {
    const golden = JSON.parse(fs.readFileSync(new URL('./library/credits.golden.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    for (const [name, make] of GOLD_DOCS) { const doc = make(); expect(JSON.stringify({ licence: exportLicence(doc), warnings: libraryExportWarnings(doc) }), name).toBe(JSON.stringify(golden[name])); }
    const pid12 = s.store.createProject({ name: 'check 12' }).doc.id;
    const j = await finished((await api('agent', 'POST', `/api/v1/projects/${pid12}/sources/import`, { provider: 'openverse', itemId: `image:${OV_BY}`, place: { start: { value: '0', timescale: 1 } } })).body.jobId);
    expect(j.status).toBe('succeeded');
    const pf = await api('agent', 'GET', `/api/v1/projects/${pid12}/preflight`);
    expect(pf.body.issues.map((i: any) => i.code)).toContain('credits_for_description');
    const card = await api('agent', 'POST', `/api/v1/projects/${pid12}/transactions`, { ops: [{ op: 'add_credits_card', args: {} }] });
    expect(card.status, JSON.stringify(card.body)).toBe(200);
  });
});
