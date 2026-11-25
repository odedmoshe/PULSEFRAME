/**
 * The server contract of the craft track (wave 7; craft/contract.ts), through the real app and the real MCP handler, before W2:
 * every route is registered, documented and classified; the owner rule and the propose rule hold before anything else; every
 * route answers the honest 501 craft_not_built; MCP find_text answers the same; storage lists the versions table for project
 * deletion and keeps the files a version names. The it.todo rows name what W2 makes pass (in craft/routes.test.ts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { CRAFT_ROUTES, CRAFT_SERVER_REFUSALS, VERSIONS_TABLE } from './craft/contract.ts';
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
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer), proposer = bearer(() => proposeGrant);
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
const urlOf = (route: string) => route.split(' ')[1]!.replace(':id', pid).replace(':versionId', 'ver_none');

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-craft-contract-'));
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
  pid = store.createProject({ name: 'craft contract' }).doc.id;
});
afterAll(async () => {
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});


describe('the craft routes are registered, documented and classified', () => {
  it('every route of CRAFT_ROUTES is in OpenAPI and in the people-surface table; find_text is classified', () => {
    const doc = buildOpenApi() as { paths: Record<string, Record<string, unknown>> };
    for (const route of CRAFT_ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      const oa = p.replace(/:(\w+)/g, '{$1}');
      expect({ route, documented: !!doc.paths[oa]?.[method.toLowerCase()] }).toEqual({ route, documented: true });
      expect({ route, classified: route in PEOPLE_REST_SURFACES }).toEqual({ route, classified: true });
    }
    expect(PEOPLE_MCP_TOOLS.find_text).toEqual(['reader-document']);
    // no MCP tool for versions this wave (cut by the lead)
    expect(Object.keys(PEOPLE_MCP_TOOLS).filter((t) => /version/.test(t))).toEqual([]);
  });
});

const bodyFor = (route: string) => (route.endsWith('/text/find') ? { text: 'נעה', wholeWord: false, ignoreMarks: true, finalsEqual: true, ignoreCase: false } : route.endsWith('/versions') || route.startsWith('PUT') ? { name: 'לפני הקיצור' } : {});
describe('before W2: honest 501, owner and propose rules first', () => {
  it('rename and delete refuse an agent with 403 owner_required before anything else', async () => {
    for (const route of CRAFT_ROUTES.filter((r) => r.startsWith('PUT') || r.startsWith('DELETE'))) {
      const r = await rest(agent, route.split(' ')[0]!, urlOf(route), bodyFor(route));
      expect({ route, status: r.status, code: r.body?.error?.code }).toEqual({ route, status: 403, code: 'owner_required' });
    }
  });
  it('save and restore refuse a propose-mode credential with 403 insufficient_scope and the craft sentence', async () => {
    for (const route of CRAFT_ROUTES.filter((r) => r.startsWith('POST') && !r.endsWith('/text/find'))) {
      const r = await rest(proposer, 'POST', urlOf(route), bodyFor(route));
      expect({ route, status: r.status, message: r.body?.error?.message }).toEqual({ route, status: 403, message: CRAFT_SERVER_REFUSALS.proposeOnly.message() });
    }
  });
  it('an observer may not save or restore (403) and reads the list, which answers 501', async () => {
    expect((await rest(observer, 'POST', urlOf(`POST /api/v1/projects/:id/versions`), { name: 'x' })).status).toBe(403);
    expect((await rest(observer, 'GET', urlOf(`GET /api/v1/projects/:id/versions`))).status).toBe(501);
  });
  it('every route answers 501 craft_not_built to the owner, with the fixed sentence; an unknown project is 404 first', async () => {
    for (const route of CRAFT_ROUTES) {
      const r = await rest(owner, route.split(' ')[0]!, urlOf(route), route.startsWith('GET') ? undefined : bodyFor(route));
      expect({ route, status: r.status, code: r.body?.error?.code, message: r.body?.error?.message }).toEqual({ route, status: 501, code: 'craft_not_built', message: CRAFT_SERVER_REFUSALS.notBuilt.message() });
      const missing = await rest(owner, route.split(' ')[0]!, urlOf(route).replace(pid, 'prj_none'), route.startsWith('GET') ? undefined : bodyFor(route));
      expect({ route, status: missing.status }).toEqual({ route, status: 404 });
    }
  });
  it('MCP find_text answers craft_not_built', async () => {
    const f = await tool(agent, 'find_text', { projectId: pid, text: 'נעה', wholeWord: false, ignoreMarks: true, finalsEqual: true, ignoreCase: false });
    expect(f.isError).toBe(true);
    expect(JSON.stringify(f.data)).toContain('craft_not_built');
  });
});

describe('storage knows the versions table before it exists', () => {
  it('project deletion and the storage scan name it (storage.ts), so W2 adds no line there', () => {
    const src = fs.readFileSync(new URL('./storage.ts', import.meta.url), 'utf8');
    expect(src).toContain(`'${VERSIONS_TABLE}'`);
    expect(src).toContain(`SELECT doc FROM ${VERSIONS_TABLE}`);
  });
});

describe('what W2 makes pass (craft/routes.test.ts, craft/versions.test.ts)', () => {
  it.todo('save: copy = stored document of that revision (V1), privacy_digest stored, storage room 507, version_limit at 50, version_limit_agents at 10');
  it.todo('list: names, sizes, sameAsCurrent, privacyChanged; never a document; rename and delete owner-only, delete erased from the file');
  it.todo('privacy gate: a version whose digest differs answers 403 version_privacy_changed to agents and observers on diff and frame; the owner sees it');
  it.todo('restore: one restore_entities transaction through governance with the caller\'s guard; undo exact; nothing_to_restore, stale_revision, restore_needs_confirmation, restore_too_large, version_conflict');
  it.todo('people: no birth date in any versions answer to a credential without the people scope (the people walk covers the routes)');
  it.todo('find: REST POST …/text/find = MCP find_text = core findText over the reader document; truncated at CRAFT_LIMITS.findMatches with the total');
  it.todo('deleting the project leaves no project_versions row; storage clean-up keeps a file only a version names (V5, V7)');
});
