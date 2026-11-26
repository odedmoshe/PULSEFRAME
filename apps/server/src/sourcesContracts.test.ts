/**
 * The server contract of «מאגר» / «ייבוא מקישור» (wave 8 `sources`, part A; sources/contract.ts), through the real app and the real
 * MCP handler: every route is registered, documented and classified; the ONLY owner-only routes store or remove a service's
 * credential; every route answers 501 sources_not_built after its checks until W2 builds the runtime; the MCP tools are listed,
 * classified and answer the same; the descriptors' ids are core's; the import contract carries the source part (C7). The it.todo
 * rows are the plan's proof checks W2 must make pass on labelled doubles (port 0, injected address policy, never a real service).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEARCHABLE_SOURCES, SOURCE_PROVIDERS, SOURCES_API } from '@pulseframe/core';
import { SOURCE_DESCRIPTORS, userAgentFor } from '@pulseframe/providers';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { SOURCES_MCP_TOOLS, SOURCES_ROUTES } from './sources/contract.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

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

describe('what W2 makes pass (proof checks of sources-plan §5 as cut, on labelled doubles only)', () => {
  it.todo('check 1: Openverse search rows carry licence id/name from the answer; the double saw exactly q, filters and the User-Agent, and no project or owner text');
  it.todo('check 1b (C9): anonymous Openverse counts searches locally and answers remaining before the double answers 429; 429 maps to provider_rate_limited with retryAfterSeconds');
  it.todo('check 2: Pixabay without a key answers provider_key_missing; with a key the double saw it; no answer, log line or job row contains it (redactor)');
  it.todo('check 3: a second identical Pixabay search within 24 h is served from memory (the double counted one request); no query on disk');
  it.todo('check 3b: Wikimedia without a contact answers provider_contact_missing; with one the double saw "PULSEFRAME-Studio (<contact>)"');
  it.todo('check 4: a preview handle streams the double\'s bytes with Range; an unknown handle is 404 preview_not_found; a URL in place of a handle is never fetched');
  it.todo('check 5: importing a CC BY item commits one use_source_item; provenance.source validates; sha256 = original hash; credit verbatim; undo removes it exactly');
  it.todo('check 6: a download cut at 50% resumes with Range + If-Range (the double saw bytes=n-); a changed ETag or a 200 restarts at 0; final hash equal');
  it.todo('check 7: restart mid-download, and cancel, and failure: recover continues the .part; no orphan src_* .part, up_ file or .link sidecar is left (C6, verify risk 3)');
  it.todo('check 8: limit 100 KB and a 200 KB file with a low lying Content-Length: download_too_large, nothing stored; the setting never exceeds the upload limit; free space checked before and every 64 MiB (download_disk_full)');
  it.todo('check 9 (C8): links to 127.0.0.1, [::ffff:127.0.0.1], 169.254.169.254, this machine\'s own interface addresses, and a public link redirecting to loopback are link_address_refused; a lookup answering several addresses is refused when ANY is refused; a 192.168.x.x link imports with link_private_network');
  it.todo('check 9b: the DEFAULT address policy (no injection) refuses 127.0.0.1; the injection is reachable only through SourcesDeps.test, never from the environment or a route');
  it.todo('check 10: a link answering text/html is download_not_media (video sites are the engines track)');
  it.todo('check 11: an NC item and an ND item import (no refusal); the export answers non_commercial_content and licence_no_derivatives quoting the licence names and the deed sentence; the export succeeds; a shared archive leaves the NC and Pixabay files out');
  it.todo('check 12: credits of library-only projects stay byte-identical to credits.golden.json (core and server)');
  it.todo('import sites (C7): all seven library sites of importQueue.ts mirrored for .source; ownCommit recognises use_source_item by provider + itemId; a restart between download, receive and commit neither duplicates the asset nor orphans a file');
  it.todo('idempotencyKey: the same key twice returns the first job (store.findJobByKey)');
});
