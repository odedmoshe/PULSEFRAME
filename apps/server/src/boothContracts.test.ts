/**
 * The server contract of «תא הבדיקה» (wave 8 booth pre-pass; booth/contract.ts), through the real app and the real MCP handler:
 * every route is registered, documented (x-owner-session-only) and classified owner-only; the owner rule holds on every route,
 * GET included, before the id or the body is read; the owner gets an honest 501 until W1 builds the routes; the answers file is
 * never backed up; the phone drop and MCP have no booth surface. The it.todo rows name what builder W1 must make pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Auth } from './auth.ts';
import { backupDataDir, NEVER_BACKED_UP } from './backup.ts';
import { BOOTH_ROUTES, BOOTH_SERVER_REFUSALS, OWNER_REVIEW_FILE } from './booth/contract.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { DROP_ROUTES } from './importContracts.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
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
const urlOf = (route: string, odd = false) => route.split(' ')[1]!.replace(':id', odd ? 'NOT%20AN%20ID' : encodeURIComponent('music:music.calm')).replace(':which', odd ? 'zz' : 'a').replace(':rowId', odd ? 'nope' : 'ffmpeg');

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-contract-'));
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

describe('the booth routes are registered, documented and classified', () => {
  it('every route of BOOTH_ROUTES is registered, in OpenAPI with x-owner-session-only, and owner-only in the people-surface table', () => {
    const registered = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    const doc = buildOpenApi() as { paths: Record<string, Record<string, Record<string, unknown>>> };
    for (const route of BOOTH_ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      const op = doc.paths[p.replace(/:(\w+)/g, '{$1}')]?.[method.toLowerCase()];
      expect({ route, registered: registered.has(route), documented: !!op, ownerOnly: op?.['x-owner-session-only'], classes: PEOPLE_REST_SURFACES[route] })
        .toEqual({ route, registered: true, documented: true, ownerOnly: true, classes: ['owner-only'] });
    }
    expect([...registered].filter((k) => k.includes('/booth')).sort()).toEqual([...BOOTH_ROUTES].sort());
  });
  it('the phone drop has no booth path and MCP has no booth tool', async () => {
    expect(DROP_ROUTES.filter((r) => /booth/i.test(r))).toEqual([]);
    const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...agent(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }));
    const text = await r.text();
    const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
    const names: string[] = msg.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => /booth|review_item|owner_review/i.test(n))).toEqual([]);
  });
});

describe('the owner rule first, on every route, GET included', () => {
  it('agent, observer and propose credentials get 403 owner_required on every route, also with an invalid body or an unknown id', async () => {
    for (const who of [agent, observer, proposer]) {
      for (const route of BOOTH_ROUTES) {
        const [method] = route.split(' ') as [string];
        for (const p of [urlOf(route), urlOf(route, true)]) {
          const r = await rest(who, method, p, method === 'PUT' ? '{"verdict":"heard","bogus":' : undefined);
          expect({ route, p, status: r.status, code: r.body?.error?.code, message: r.body?.error?.message }).toEqual({ route, p, status: 403, code: 'owner_required', message: BOOTH_SERVER_REFUSALS.ownerOnly.message() });
        }
      }
    }
  });
  it('without any credential: 401, nothing else', async () => {
    for (const route of BOOTH_ROUTES) {
      const r = await rest(() => ({ host: `127.0.0.1:${cfg.port}` }), route.split(' ')[0]!, urlOf(route));
      expect({ route, status: r.status }).toEqual({ route, status: 401 });
    }
  });
  it('the owner\'s own session gets an honest 501 booth_not_built with the next step (pre-pass; W1 replaces it)', async () => {
    for (const route of BOOTH_ROUTES) {
      const r = await rest(owner, route.split(' ')[0]!, urlOf(route), route.startsWith('PUT') ? JSON.stringify({ verdict: 'ok', recipe: `sha256:${'0'.repeat(64)}` }) : undefined);
      expect({ route, status: r.status, code: r.body?.error?.code, hint: !!r.body?.error?.hint }).toEqual({ route, status: 501, code: 'booth_not_built', hint: true });
    }
  });
});

describe('the answers file is never backed up', () => {
  it('owner-review.json is in NEVER_BACKED_UP and a copy left in the destination is removed', async () => {
    expect(NEVER_BACKED_UP).toContain(OWNER_REVIEW_FILE);
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-bk-src-')), dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-bk-dest-')), 'copy');
    const s = new Store(src);
    s.close();
    fs.writeFileSync(path.join(src, OWNER_REVIEW_FILE), JSON.stringify({ version: 1, answers: [] }), { mode: 0o600 });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, OWNER_REVIEW_FILE), '{"stray":true}');
    try {
      await backupDataDir(src, dest);
      expect(fs.existsSync(path.join(dest, OWNER_REVIEW_FILE))).toBe(false);
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
      fs.rmSync(path.dirname(dest), { recursive: true, force: true });
    }
  });
});

describe('builder W1 (server)', () => {
  it.todo('registry: exactly one item per music style (not rejected), SFX id, GPU transition and GPU effect with content on a still, or a BOOTH_LATER row with its reason; ids unique; Canvas2D and voice effects in BOOTH_LATER (plan check 1)');
  it.todo('registry: the 14 first-sitting items are the 7 BOOTH_FIRST_TRANSITIONS (exportStrip true), the 6 BOOTH_FIRST_MUSIC (expected = music.golden.json) and task:mic');
  it.todo('recipes are equal across two server starts; a labelled synthetic registry with one changed SFX graph changes only that item (plan check 2); the SFX recipe holds the ffmpeg -version first line (C7)');
  it.todo('audio: each music item\'s bytes have the golden sha256 and equal GET /api/v1/music/:id/audio?bars=8&seed=1; an SFX item equals GET /api/v1/sfx/:id/audio (plan checks 3, 4)');
  it.todo('test pictures: core RGBA is deterministic, the PNG encoder round-trips through the existing header reader, the recipe hashes the RGBA (C6)');
  it.todo('PUT stores one row per id, 0600, atomically (a kill between write and rename leaves the old file); 409 booth_stale_recipe for an old recipe; DELETE clears (plan checks 7, 9)');
  it.todo('PUT scrubs the note on the server (planted username, home path with a space, C:/ path, OneDrive folder, library root) and answers namesInNote for a people-sheet name without storing the match (C4b, L2)');
  it.todo('GET /booth marks an answer changed on another recipe, another played hash (audio), or another adapter (picture only)');
  it.todo('checks: every server row answers within its timeout with a BoothCheckRowSchema row; no row carries a path, a user, a host or an address (C3)');
  it.todo('checks: export-gpu, speech and search answer skipped (and the export still 409 booth_busy) while an export or another BOOTH_BUSY_JOB_KINDS job is queued or running (C3)');
  it.todo('build: commit from .git/HEAD and its ref file without exec (unknown when absent) and bundleDigest(webDist) (C4)');
});
