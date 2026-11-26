/**
 * The server contract of «קליפ מקוד» (wave 8 motioncode; made/contract.ts), through the real app and the real MCP handler: every route
 * is registered, documented and classified, and no route is owner-only (open semantics); the catalogue answers; every other route
 * answers 501 made_not_built after its scope (an observer cannot render) until W1/W2 build it; the MCP tools are listed and classified;
 * the archive carries a made clip's page; storage keeps a pending render's files and lets go of dismissed, applied and failed ones.
 * W2's rows run against a LABELLED FAKE runner (job rows in the real store, a synthetic made asset; nothing is drawn); W1's row stays todo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { createHash } from 'node:crypto';
import { createProject, creativeProjection, MADE_JOB_TYPE, type ApplyMadeClipOutput, type MadeJobReport, type MadeRenderRequest, type ProjectDocument } from '@pulseframe/core';
import { archiveBlobs } from './archive.ts';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { MADE_MCP_TOOLS, MADE_ROUTES, madeError, type MadeRunner } from './made/contract.ts';
import { MADE_TEMPLATES } from './made/templates/index.ts';
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
  it('without a runner (W1 not wired): valid requests from an agent that may edit pass every check and answer 501 made_not_built; an observer cannot render', async () => {
    const bodies: Record<string, unknown> = { [`POST /api/v1/projects/:id/made/render`]: { page: { templateId: 'rising-title' }, seconds: 1, name: 'x' }, [`POST /api/v1/projects/:id/made/jobs/:jobId/apply`]: {}, [`POST /api/v1/projects/:id/made/jobs/:jobId/dismiss`]: {} };
    for (const route of MADE_ROUTES.filter((x) => x !== 'GET /api/v1/made/templates' && x !== 'GET /api/v1/projects/:id/made/assets/:assetId/page')) {
      const r = await rest(agent, route.split(' ')[0]!, urlOf(route), route.startsWith('POST') ? bodies[route] : undefined);
      expect({ route, status: r.status, code: r.body?.error?.code }).toEqual({ route, status: 501, code: 'made_not_built' });
    }
    const page = await rest(agent, 'GET', urlOf('GET /api/v1/projects/:id/made/assets/:assetId/page'));
    expect({ status: page.status, code: page.body?.error?.code }).toEqual({ status: 404, code: 'made_no_page' });
    const o = await rest(observer, 'POST', urlOf(`POST /api/v1/projects/:id/made/render`), {});
    expect(o.status).toBe(403);
  });
  it('the MCP tools are listed and, without a runner, answer made_not_built', async () => {
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

describe('what the builders make pass (W2, against a LABELLED FAKE runner: no browser, no file is drawn)', () => {
  it('render validates the body, answers 422 made_bad_page only for problems, returns warnings with offsets, 202 { jobId }', async () => {
    const h = await harness();
    expect((await h.rest(h.agentA, 'POST', h.url('render'), { page: 'x', seconds: 0, name: 'x' })).status).toBe(400);
    const nul = await h.rest(h.agentA, 'POST', h.url('render'), { page: '<p>a\u0000</p><script>fetch(1)</script>', seconds: 1, name: 'x' });
    expect(nul.status).toBe(422);
    expect(nul.body.error.code).toBe('made_bad_page');
    expect(nul.body.error.details.problems).toEqual([{ what: 'nul', at: 4 }]);
    const html = '<canvas></canvas><script>PF.render = (f) => Date.now();</script>';
    const ok = await h.rest(h.agentA, 'POST', h.url('render'), { page: html, seconds: 1, name: 'x' });
    expect(ok.status).toBe(202);
    expect(ok.body.jobId).toMatch(/^job_/);
    expect(ok.body.warnings).toEqual([{ why: 'staticHit', what: 'Date', at: html.indexOf('Date'), message: `the page uses Date (at character ${html.indexOf('Date')})` }]);
    h.close();
  });
  it('capacity: a second active render of one credential and a fourth in all answer 429 made_busy with Retry-After; agents paused: 403 made_agents_paused', async () => {
    const h = await harness();
    const body = { page: { templateId: 'counter' }, seconds: 1, name: 'n' };
    expect((await h.rest(h.agentA, 'POST', h.url('render'), body)).status).toBe(202);
    const again = await h.rest(h.agentA, 'POST', h.url('render'), body);
    expect({ status: again.status, code: again.body.error.code, retry: again.retryAfter }).toEqual({ status: 429, code: 'made_busy', retry: '15' });
    expect((await h.rest(h.agentB, 'POST', h.url('render'), body)).status).toBe(202);
    expect((await h.rest(h.owner, 'POST', h.url('render'), body)).status).toBe(202);
    expect((await h.rest(h.agentC, 'POST', h.url('render'), body)).body.error.code).toBe('made_busy');
    h.gov.setPaused(h.pid, true, OWNER);
    const paused = await h.rest(h.agentC, 'POST', h.url('render'), body);
    expect({ status: paused.status, code: paused.body.error.code }).toEqual({ status: 403, code: 'made_agents_paused' });
    h.gov.setPaused(h.pid, false, OWNER);
    h.close();
  });
  it('report, still, file and dismiss answer the owner and the submitting credential; another agent gets 403', async () => {
    const h = await harness();
    const { body: { jobId } } = await h.rest(h.agentA, 'POST', h.url('render'), { page: { templateId: 'end-card' }, seconds: 1, name: 'e' });
    h.fake.finish(jobId);
    for (const who of [h.agentA, h.owner]) {
      expect((await h.rest(who, 'GET', h.url(`jobs/${jobId}`))).body.submittedBy).toBe('agent:a');
      expect((await h.rest(who, 'GET', h.url(`jobs/${jobId}/still/1`))).status).toBe(200);
      expect((await h.rest(who, 'GET', h.url(`jobs/${jobId}/file`))).status).toBe(200);
    }
    for (const [m, sub] of [['GET', ''], ['GET', '/still/0'], ['GET', '/file'], ['POST', '/dismiss'], ['POST', '/apply']] as const) {
      const r = await h.rest(h.agentB, m, h.url(`jobs/${jobId}${sub}`), m === 'POST' ? {} : undefined);
      expect({ sub, status: r.status, code: r.body?.error?.code }).toEqual({ sub, status: 403, code: 'made_not_yours' });
    }
    expect((await h.rest(h.agentA, 'POST', h.url(`jobs/${jobId}/dismiss`), {})).body).toEqual({ dismissed: true });
    h.close();
  });
  it('apply commits apply_made_clip as the requesting credential in one transaction; undo removes asset, track and clip; then=… applies on success', async () => {
    const h = await harness();
    const before = creativeProjection(h.store.getProject(h.pid).doc);
    const { body: { jobId } } = await h.rest(h.agentA, 'POST', h.url('render'), { page: { templateId: 'rising-title' }, seconds: 1, name: 't' });
    h.fake.finish(jobId);
    const a = await h.rest(h.agentA, 'POST', h.url(`jobs/${jobId}/apply`), { place: { start: T.frameTime(30, R) } });
    expect(a.status).toBe(200);
    const tx = h.store.db.prepare('SELECT actor, ops FROM transactions WHERE project_id = ? AND revision = ?').get(h.pid, a.body.revision) as { actor: string; ops: string };
    expect({ actor: tx.actor, ops: JSON.parse(tx.ops).map((o: { op: string }) => o.op) }).toEqual({ actor: 'agent:a', ops: ['apply_made_clip'] });
    expect(a.body.output.clipId).toBeTruthy();
    h.store.undo(h.pid, 'agent:a', 'undo');
    expect(creativeProjection(h.store.getProject(h.pid).doc)).toBe(before);
    const r2 = await h.rest(h.agentB, 'POST', h.url('render'), { page: { templateId: 'rising-title' }, seconds: 1, name: 't', then: { place: { start: T.frameTime(0, R) } } });
    h.fake.finish(r2.body.jobId);
    await new Promise((ok) => setTimeout(ok, 20));
    const rep = await h.rest(h.agentB, 'GET', h.url(`jobs/${r2.body.jobId}`));
    expect(rep.body.autoApply.status).toBe('applied');
    expect(rep.body.autoApply.output.clipId).toBeTruthy();
    const last = h.store.db.prepare('SELECT actor FROM transactions WHERE project_id = ? ORDER BY revision DESC LIMIT 1').get(h.pid) as { actor: string };
    expect(last.actor).toBe('agent:b');
    h.close();
  });
  it('GET …/made/assets/:assetId/page answers page, fields and values from provenance.made and the page blob; 404 made_no_page otherwise', async () => {
    const h = await harness();
    const { body: { jobId } } = await h.rest(h.agentA, 'POST', h.url('render'), { page: { templateId: 'lower-third' }, seconds: 1, name: 'l', values: { name: 'נועה' } });
    h.fake.finish(jobId);
    const { body: { output } } = await h.rest(h.agentA, 'POST', h.url(`jobs/${jobId}/apply`), { library: true });
    const p = await h.rest(h.observerH, 'GET', h.url(`assets/${output.assetId}/page`));
    expect(p.status).toBe(200);
    expect(p.body.page).toBe(MADE_TEMPLATES.find((t) => t.id === 'lower-third')!.page);
    expect(p.body.record.values).toEqual({ name: 'נועה' });
    expect((await h.rest(h.observerH, 'GET', h.url('assets/ast_none/page'))).body.error.code).toBe('made_no_page');
    h.close();
  });
  it.todo('W1: a render that was running when the server stopped ends failed with made_restarted and imports nothing; cancel_job stops it (W1 owns the job; not W2)');
});

// ---------------------------------------------------------------- a LABELLED FAKE runner (test only): job rows in the real store, a synthetic made asset, no browser
const R = { num: 30, den: 1 };
const OWNER = { actor: 'user:local', kind: 'user' as const, scopes: ['observe', 'edit'] as ('observe' | 'edit')[] };
function fakeRunner(store: Store, gov: Governance, dir: string) {
  const pages = new Map<string, { sha256: string; req: MadeRenderRequest }>();
  const row = (projectId: string, jobId: string) => { let j; try { j = store.getJob(jobId); } catch { throw madeError('jobNotFound', { jobId }); } if (j.projectId !== projectId || j.type !== MADE_JOB_TYPE) throw madeError('jobNotFound', { jobId }); return j; };
  const runner: MadeRunner = {
    async start(p, projectId, req, page) { const j = store.createJob(projectId, MADE_JOB_TYPE, p.actor, { FAKE: true }); store.updateJob(j.id, { status: 'running' }); pages.set(j.id, { sha256: page.sha256, req }); return { jobId: j.id }; },
    report(_p, projectId, jobId) { const j = row(projectId, jobId); return { jobId, status: j.status, stage: j.status === 'succeeded' ? 'done' : 'drawing', progress: null, submittedBy: j.actor, warnings: [], ...(j.output?.appliedAssetId ? { appliedAssetId: j.output.appliedAssetId } : {}) } as MadeJobReport; },
    still(_p, projectId, jobId) { row(projectId, jobId); return { png: Buffer.from('FAKE-PNG') }; },
    file(_p, projectId, jobId) { row(projectId, jobId); const f = path.join(dir, `${jobId}.webm`); fs.writeFileSync(f, 'FAKE-WEBM'); return { path: f, bytes: 9 }; },
    async apply(p, projectId, jobId, req) {
      const j = row(projectId, jobId);
      if (j.status !== 'succeeded') throw madeError('jobNotDone', { jobId });
      if (j.output?.appliedAssetId) throw madeError('alreadyApplied', { jobId });
      const pg = pages.get(jobId)!;
      const fields = pg.req.fields ?? [];
      const record = { v: 1, pageSha256: pg.sha256, pageBytes: 10, fields, values: pg.req.values ?? {}, frames: 30, width: 640, height: 360, browser: 'FAKE', sandbox: 'none', checks: { determinism: { frames: [0] }, flash: { black: { general: 0, red: 0 }, white: { general: 0, red: 0 } }, alpha: true } };
      const asset = { kind: 'video', name: 'fake.webm', contentHash: `sha256:${createHash('sha256').update(jobId).digest('hex')}`, byteSize: 9, container: 'webm', mimeType: 'video/webm', duration: T.frameTime(30, R), video: { width: 640, height: 360, frameRate: R, codec: 'vp9', rotation: 0, frameCount: 30, hasAlpha: true }, provenance: { origin: 'generated', importedAt: '2026-11-26T00:00:00Z', importedBy: p.actor, made: record } };
      const r = gov.commitAs(p, { projectId, allowInternal: true, ops: [{ op: 'apply_made_clip', args: { asset, ...(req.place ? { place: req.place } : {}), ...(req.sequenceId ? { sequenceId: req.sequenceId } : {}), ...(req.replaceAssetId ? { replaceAssetId: req.replaceAssetId } : {}) } }] }) as { revision: number; results: { output?: Record<string, unknown> }[] };
      const output = r.results[0]!.output as unknown as ApplyMadeClipOutput;
      store.updateJob(jobId, { output: { ...j.output, appliedAssetId: output.assetId } });
      return { revision: r.revision, output };
    },
    dismiss(_p, projectId, jobId) { const j = row(projectId, jobId); store.updateJob(jobId, { output: { ...j.output, dismissed: true } }); },
  };
  return { runner, finish: (jobId: string) => store.updateJob(jobId, { status: 'succeeded', output: { fileSha256: 'FAKE', pageSha256: pages.get(jobId)!.sha256 } }) };
}
/** A server of its own per test: the real app with the fake runner, an owner session, the bootstrap agent and three grants. */
async function harness() {
  const hdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-made-w2-'));
  const hcfg: Config = { ...loadConfig({}), dataDir: hdir, port: 23, speechPython: null, voicePython: null, backupDir: null };
  const hstore = new Store(hdir);
  const hauth = new Auth(hcfg);
  const hgov = new Governance(hstore);
  hauth.resolveGrant = (token) => hgov.principalForToken(token);
  const fake = fakeRunner(hstore, hgov, hdir);
  const hcap = new Capabilities(hstore, hcfg);
  const hmcp = createMcp(hstore, hauth, new Exporter(hstore, null as never, () => '', path.join(hdir, 'no-web-dist')), hcap, new Presence(), hgov);
  const happ = createApp(hcfg, hstore, hauth, new Exporter(hstore, null as never, () => '', path.join(hdir, 'no-web-dist')), hcap, new Derivatives(hstore), new Presence(), hmcp, hgov, undefined, undefined, { made: fake.runner });
  const hb = `http://127.0.0.1:${hcfg.port}`;
  const cookie = hauth.issueSession(new Request(`${hb}/api/v1/session`, { headers: { origin: hb, 'x-pf-owner-key': hauth.tokens.owner } })).split(';')[0]!;
  const grant = (name: string) => hgov.createGrant({ name, mode: 'edit' }, OWNER).token;
  const tok = (t: string) => () => ({ host: `127.0.0.1:${hcfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
  const hpid = hstore.createProject({ name: 'made w2', frameRate: R }).doc.id;
  return {
    store: hstore, gov: hgov, fake, pid: hpid,
    owner: () => ({ host: `127.0.0.1:${hcfg.port}`, origin: hb, cookie, 'content-type': 'application/json' }),
    agentA: tok(grant('a')), agentB: tok(grant('b')), agentC: tok(grant('c')), observerH: tok(hauth.tokens.observer),
    url: (rest: string) => `/api/v1/projects/${hpid}/made/${rest}`,
    rest: async (who: Who, method: string, p: string, body?: unknown) => {
      const r = await happ.fetch(new Request(`${hb}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      return { status: r.status, retryAfter: r.headers.get('retry-after'), body: (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as any) : null };
    },
    close: () => { void hmcp.close(); void hcap.stop(); hstore.close(); fs.rmSync(hdir, { recursive: true, force: true }); },
  };
}
