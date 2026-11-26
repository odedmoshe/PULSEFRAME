/**
 * The server contract of «קליפ מקוד» (wave 8 motioncode; made/contract.ts), through the real app and the real MCP handler: every route
 * is registered, documented and classified, and no route is owner-only (open semantics); the catalogue answers; every other route
 * answers 501 made_not_built after its scope (an observer cannot render) until W1/W2 build it; the MCP tools are listed and classified;
 * the archive carries a made clip's page; storage keeps a pending render's files and lets go of dismissed, applied and failed ones.
 * The it.todo rows name what the builders make pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { createProject, MADE_JOB_TYPE, type ProjectDocument } from '@pulseframe/core';
import { archiveBlobs } from './archive.ts';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { MADE_MCP_TOOLS, MADE_ROUTES } from './made/contract.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { jobPins } from './storage.ts';
import { Store } from './store.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let pid = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = () => Record<string, string>;
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer);
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
const urlOf = (route: string) => route.split(' ')[1]!.replace(':id', pid).replace(':jobId', 'job_none').replace(':index', '0').replace(':assetId', 'ast_none');

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-made-contract-'));
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
  pid = store.createProject({ name: 'made contract' }).doc.id;
});
afterAll(async () => {
  await mcp.close(); await speech.stop(); await capabilities.stop(); store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the made routes are registered, documented, classified and open', () => {
  it('every route is in OpenAPI and the people-surface table; none is owner-session-only; the two MCP tools are classified', () => {
    const doc = buildOpenApi() as { paths: Record<string, Record<string, Record<string, unknown>>> };
    for (const route of MADE_ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      const op = doc.paths[p.replace(/:(\w+)/g, '{$1}')]?.[method.toLowerCase()];
      expect({ route, documented: !!op, ownerOnly: op?.['x-owner-session-only'] ?? false }).toEqual({ route, documented: true, ownerOnly: false });
      expect({ route, classified: route in PEOPLE_REST_SURFACES }).toEqual({ route, classified: true });
      expect(PEOPLE_REST_SURFACES[route]).not.toContain('owner-only');
    }
    for (const t of MADE_MCP_TOOLS) expect(PEOPLE_MCP_TOOLS[t], t).toBeTruthy();
  });
  it('the catalogue answers any credential: five pages with their sha256 and the limits', async () => {
    const r = await rest(observer, 'GET', '/api/v1/made/templates');
    expect(r.status).toBe(200);
    expect(r.body.templates.map((t: any) => t.id)).toEqual(['rising-title', 'lower-third', 'counter', 'intro-plate', 'end-card']);
    expect(r.body.limits.maxSeconds).toBe(20);
  });
  it('pre-pass: an agent that may edit reaches every other route and gets 501 made_not_built; an observer cannot render', async () => {
    for (const route of MADE_ROUTES.filter((x) => x !== 'GET /api/v1/made/templates')) {
      const r = await rest(agent, route.split(' ')[0]!, urlOf(route), route.startsWith('POST') ? {} : undefined);
      expect({ route, status: r.status, code: r.body?.error?.code }).toEqual({ route, status: 501, code: 'made_not_built' });
    }
    const o = await rest(observer, 'POST', urlOf(`POST /api/v1/projects/:id/made/render`), {});
    expect(o.status).toBe(403);
  });
  it('pre-pass: the MCP tools are listed and answer made_not_built', async () => {
    const list = await rpc(agent, 'tools/list', {});
    const names = list.result.tools.map((t: any) => t.name);
    for (const t of MADE_MCP_TOOLS) expect(names).toContain(t);
    const v = await rpc(agent, 'tools/call', { name: 'view_made_clip', arguments: { projectId: pid, jobId: 'job_none' } });
    expect(v.result.isError).toBe(true);
    expect(v.result.content[0].text).toContain('made_not_built');
  });
});

describe('storage and archive keep what a made clip needs', () => {
  it('the archive carries the page of a made clip', () => {
    const page = `sha256:${'b'.repeat(64)}`;
    const doc: ProjectDocument = createProject({ id: 'p', name: 'p' });
    (doc.assets as Record<string, unknown>).ast_m = { id: 'ast_m', kind: 'video', name: 'm.webm', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'webm', mimeType: 'video/webm', duration: T.rt(1, 1), provenance: { origin: 'generated', importedAt: 'x', importedBy: 'x', made: { pageSha256: page } } };
    expect(archiveBlobs(doc)).toContain(page);
  });
  it('a render pins its blobs while it runs and while its result waits; not once dismissed, applied, 7 days old, failed or canceled', () => {
    const now = Date.parse('2026-11-26T12:00:00Z');
    const row = (status: string, output: unknown, ago = 0) => ({ type: MADE_JOB_TYPE, status, output: JSON.stringify(output), error: null, updated_at: new Date(now - ago).toISOString() });
    expect(jobPins(row('running', null), now)).toBe(true);
    expect(jobPins(row('succeeded', { fileSha256: 'x' }), now)).toBe(true);
    expect(jobPins(row('succeeded', { fileSha256: 'x', dismissed: true }), now)).toBe(false);
    expect(jobPins(row('succeeded', { fileSha256: 'x', appliedAssetId: 'ast_1' }), now)).toBe(false);
    expect(jobPins(row('succeeded', { fileSha256: 'x' }, 8 * 24 * 3600_000), now)).toBe(false);
    expect(jobPins(row('failed', null), now)).toBe(false);
    expect(jobPins(row('canceled', null), now)).toBe(false);
  });
});

describe('what the builders make pass', () => {
  it.todo('W2: render validates the body (MadeRenderRequestSchema), answers 422 made_bad_page only for problems, returns warnings with offsets, 202 { jobId }');
  it.todo('W2: capacity — a second active render of one credential and a fourth in all answer 429 made_busy with Retry-After; agents paused: 403 made_agents_paused');
  it.todo('W2: report, still, file and dismiss answer the owner and the submitting credential; another agent gets 403');
  it.todo('W2: apply commits apply_made_clip as the requesting credential in one transaction; undo removes asset, track and clip; then=… applies on success');
  it.todo('W2: GET …/made/assets/:assetId/page answers page, fields and values from provenance.made and the page blob; 404 made_no_page otherwise');
  it.todo('W1: a render that was running when the server stopped ends failed with made_restarted and imports nothing; cancel_job stops it');
});
