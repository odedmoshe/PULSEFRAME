/**
 * The server contract of «שמירת הסרט כתבנית» (wave 8 owntemplate pre-pass; ownTemplates.ts, core OWN_TEMPLATE_ROUTES) through the
 * real app: every route registered, documented with x-owner-session-only and classified owner-only; the owner rule first on every
 * route (agent, observer and propose credentials get 403 owner_required before the id or the body is read); the owner gets an
 * honest 501 own_template_not_built until W2; an own id that is not on this computer answers the C10 404 on plan and apply; no MCP
 * tool exists for it. The it.todo rows name what builder W2 must make pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWN_TEMPLATE_REFUSALS, OWN_TEMPLATE_ROUTES } from '@pulseframe/core';
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
import { Speech } from './speech.ts';
import { Store } from './store.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>;
let speech: Speech, capabilities: Capabilities, derivatives: Derivatives;
let ownerCookie = '', proposeGrant = '';
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer), proposer = bearer(() => proposeGrant);
const rest = async (who: Who, method: string, p: string, body?: string) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body }) }));
  return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as any) : null };
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-owntpl-contract-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 0, speechPython: null, voicePython: null, backupDir: null, libraryDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  derivatives = new Derivatives(store);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  proposeGrant = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
});
afterAll(async () => {
  await derivatives.stop();
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const urlOf = (route: { path: string }, pid: string) => route.path.replace(':id', pid).replace(':templateId', 'tpl.own-0123456789ab');
const bodyOf = JSON.stringify({ lang: 'he', expectedRevision: 0, name: 'x', genre: 'memories' });

describe('the own-template routes are registered, documented and classified', () => {
  it('every route is registered, in OpenAPI with x-owner-session-only, and owner-only in the people-surface table', () => {
    const registered = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    const doc = buildOpenApi() as { paths: Record<string, Record<string, Record<string, unknown>>> };
    for (const route of OWN_TEMPLATE_ROUTES) {
      expect(registered.has(`${route.method} ${route.path}`), route.path).toBe(true);
      const op = doc.paths[route.path.replace(/:(\w+)/g, '{$1}')]?.[route.method.toLowerCase()];
      expect(op, route.path).toBeDefined();
      expect(op!['x-owner-session-only'], route.path).toBe(true);
      expect(PEOPLE_REST_SURFACES[`${route.method} ${route.path}`], route.path).toEqual(['owner-only']);
    }
  });
  it('no MCP tool saves, lists or deletes own templates (agents reach them through the template tools only)', () => {
    const names = Object.keys(PEOPLE_MCP_TOOLS);
    expect(names).toContain('plan_template');
    for (const n of names) expect(n).not.toMatch(/own_?template/i);
  });
});

describe('the owner rule comes first; the owner gets an honest 501', () => {
  it('agent, observer and propose credentials get 403 owner_required on every route, before the id or the body is read', async () => {
    for (const route of OWN_TEMPLATE_ROUTES) for (const who of [agent, observer, proposer]) {
      const r = await rest(who, route.method, urlOf(route, 'prj_none'), route.method === 'DELETE' ? undefined : '{not json');
      expect(r.status, route.path).toBe(403);
      expect(r.body.error.code, route.path).toBe('owner_required');
    }
  });
  it('the owner\'s own session gets 501 own_template_not_built (nothing written)', async () => {
    for (const route of OWN_TEMPLATE_ROUTES) {
      const r = await rest(owner, route.method, urlOf(route, 'prj_none'), route.method === 'DELETE' ? undefined : bodyOf);
      expect(r.status, route.path).toBe(501);
      expect(r.body.error.code, route.path).toBe('own_template_not_built');
    }
    expect(fs.existsSync(path.join(dir, 'own-templates.json'))).toBe(false);
  });
});

describe('a template that is not saved on this computer (C10)', () => {
  it('plan and apply of a tpl.own- id answer 404 with the exact wording, never "does not exist"', async () => {
    const pid = (await rest(owner, 'POST', '/api/v1/projects', JSON.stringify({ name: 'c10' }))).body.project.id as string;
    for (const verb of ['plan', 'apply']) {
      const r = await rest(owner, 'POST', `/api/v1/projects/${pid}/templates/tpl.own-0123456789ab/${verb}`, JSON.stringify({ params: { media: ['x'] } }));
      expect(r.status, verb).toBe(404);
      expect(r.body.error.code).toBe('not_found');
      expect(r.body.error.message).toBe(OWN_TEMPLATE_REFUSALS.notOnThisComputer.message('tpl.own-0123456789ab'));
    }
  });
  it.todo('W2: regenerate of an own run after DELETE answers the same 404 (and music fit through templateOfRun)');
});

describe('builder W2', () => {
  it.todo('W2: preview answers revision, summary (own + schematic), report (every clip once), scan and nameWarnings; nothing is written');
  it.todo('W2: save captures again and answers 409 stale_revision when the project moved since expectedRevision (C6)');
  it.todo('W2: save writes own-templates.json atomically (tmp + rename, 0600), no timestamps; the same content twice is 409 already_saved; the 51st is 409 too_many_templates');
  it.todo('W2: save refuses too_many_operations with the numbers (C8) and privacy_scan_failed with the path only, the value absent from the answer');
  it.todo('W2: GET /api/v1/templates and catalog() list own templates after the built-ins; for the agent and observer tokens and a grant of another project the kept words are the role placeholders, the name stays (C2h)');
  it.todo('W2: an agent in edit mode plans and applies an own template through plan_template / apply_template and never receives its kept words; propose mode is 403');
  it.todo('W2: an entry that fails the re-scan on read is listed unavailable (privacy_scan_failed) and never planned');
  it.todo('W2: DELETE removes it; films made from it do not change; undo of their apply still works');
});
