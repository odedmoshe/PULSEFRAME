/**
 * An agent stops an export the owner's editor tab renders (the browser route), through the same cancel path as every other job:
 * POST /jobs/:jobId/cancel and MCP cancel_job. The tab learns it from its next heartbeat (with who asked), its completion is
 * refused, its /abandon releases the lease, and nothing is published. An agent may do it only within its grant.
 * Before this, both surfaces refused with not_your_job (the tab's job is the owner's) and MCP sent such a job to the server
 * exporter's canceller, which never told the lease holder.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { Auth, type Principal } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Store } from './store.ts';

const R = { num: 30, den: 1 };
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
let pid = '', otherPid = '', ownerCookie = '', trackId = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
const bearer = (token: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const ownerHeaders = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (p: string, body: unknown, headers: Record<string, string>) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: r.status, body: (await r.json()) as any };
};
const get = async (p: string, headers: Record<string, string>) => (await app.fetch(new Request(`${base()}/api/v1${p}`, { headers }))).json() as Promise<any>;
let rpcId = 0;
const tool = async (token: string, name: string, args: Record<string, unknown>) => {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...bearer(token), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, body: JSON.parse(msg.result.content[0].text) as any };
};
let grantN = 0;
const grant = (input: Record<string, unknown>) => gov.createGrant({ name: `g${grantN++}`, ...input }, OWNER).token;
/** The owner's tab leases an export of the project, as the editor's browser route does. */
const tabStarts = async (sessionId: string, projectId = pid) => {
  const r = await rest(`/projects/${projectId}/exports/browser`, { sessionId }, ownerHeaders());
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.jobId as string;
};
const heartbeat = (jobId: string, sessionId: string, framesDone = 3) => rest(`/jobs/${jobId}/heartbeat`, { sessionId, framesDone }, ownerHeaders());
const complete = (jobId: string, sessionId: string) => rest(`/jobs/${jobId}/complete`, { sessionId, bytes: 1234, sha256: 'a'.repeat(64), videoCodec: 'avc', audioCodec: 'opus', frames: 30, container: 'mp4' }, ownerHeaders());
const abandon = (jobId: string, sessionId: string) => rest(`/jobs/${jobId}/abandon`, { sessionId }, ownerHeaders());

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bx-cancel-'));
  fs.mkdirSync(path.join(dir, 'web/assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'web/assets/heebo-latin-400.woff2'), 'x');
  cfg = { ...loadConfig({}), dataDir: path.join(dir, 'data'), port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(cfg.dataDir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'web'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  for (const name of ['tab', 'other']) {
    const { doc } = store.createProject({ name, width: 320, height: 240, frameRate: R });
    const c = store.commit({ projectId: doc.id, actor: 'user:local', ops: [{ op: 'add_text', args: { text: 'שלום', start: T.frameTime(0, R), duration: T.rt(1, 1) } }] });
    if (name === 'tab') { pid = doc.id; const d = store.getProject(pid).doc; trackId = d.sequences[d.mainSequenceId]!.tracks.find((t) => t.clips.some((k) => k.id === c.results[0]!.output!.clipId))!.id; } else otherPid = doc.id;
  }
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('an agent stops the export the owner\'s tab renders', () => {
  it('REST: the cancel is passed to the tab, which stops; its completion is refused, /abandon releases the lease, nothing is published', async () => {
    const jobId = await tabStarts('session-rest-1');
    expect((await heartbeat(jobId, 'session-rest-1')).body).toEqual({ ok: true, canceled: false });
    const r = await rest(`/jobs/${jobId}/cancel`, {}, bearer(auth.tokens.agent));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ jobId, status: 'cancel-requested', outcome: 'stopping' });
    expect(r.body.note).toMatch(/next heartbeat/);
    expect((await heartbeat(jobId, 'session-rest-1', 9)).body).toEqual({ ok: true, canceled: true, canceledBy: 'agent:local' });
    // a tab that had already finished its last frame may not publish now
    expect((await complete(jobId, 'session-rest-1')).body.error.code).toBe('job_canceled');
    expect((await abandon(jobId, 'session-rest-1')).body).toMatchObject({ ok: true, status: 'canceled' });
    const j = await get(`/jobs/${jobId}`, bearer(auth.tokens.agent));
    expect(j).toMatchObject({ status: 'canceled', output: null, error: { code: 'canceled', canceledBy: 'agent:local', retryable: true } });
    expect(j.error.message).toMatch(/canceled by agent:local; the tab stopped and discarded its partial output/);
    // the lease is gone: the tab cannot heartbeat it back to life or complete it
    expect((await complete(jobId, 'session-rest-1')).body.error.code).toBe('job_canceled');
    expect((await heartbeat(jobId, 'session-rest-1')).body).toMatchObject({ ok: true, canceled: true });
  });

  it('MCP cancel_job takes the same path and answers as REST does', async () => {
    const viaTool = await tool(auth.tokens.agent, 'cancel_job', { jobId: await tabStarts('session-mcp-1') });
    const viaRest = await rest(`/jobs/${await tabStarts('session-mcp-2')}/cancel`, {}, bearer(auth.tokens.agent));
    expect(viaTool.isError, JSON.stringify(viaTool.body)).toBe(false);
    expect({ ...viaTool.body, jobId: null }).toEqual({ ...viaRest.body, jobId: null });
    const jobId = viaTool.body.jobId as string;
    expect(store.getJob(jobId).status).toBe('cancel-requested');
    expect((await heartbeat(jobId, 'session-mcp-1')).body).toMatchObject({ canceled: true, canceledBy: 'agent:local' });
    await abandon(jobId, 'session-mcp-1');
    expect(store.getJob(jobId)).toMatchObject({ status: 'canceled', output: null, error: { canceledBy: 'agent:local' } });
    // a second cancel says the job already finished
    expect((await tool(auth.tokens.agent, 'cancel_job', { jobId })).body).toMatchObject({ status: 'canceled', outcome: 'already-finished' });
  });

  it('a grant that runs jobs on the project may stop it (edit and autopilot)', async () => {
    for (const mode of ['edit', 'autopilot']) {
      const token = grant({ mode, projectIds: [pid] });
      const jobId = await tabStarts(`session-grant-${mode}`);
      const r = await tool(token, 'cancel_job', { jobId });
      expect(r.isError, JSON.stringify(r.body)).toBe(false);
      expect(r.body).toMatchObject({ status: 'cancel-requested', outcome: 'stopping' });
      expect((await heartbeat(jobId, `session-grant-${mode}`)).body.canceledBy).toBe(`agent:g${grantN - 1}`);
      await abandon(jobId, `session-grant-${mode}`);
    }
  });

  it('only within the grant: observe, propose, another project, a track or range limit and a pause are refused, and the tab keeps rendering', async () => {
    const jobId = await tabStarts('session-refused');
    const refusals: [string, string, number, string][] = [
      ['the built-in observer', auth.tokens.observer, 403, 'insufficient_scope'],
      ['an observe grant', grant({ mode: 'observe' }), 403, 'insufficient_scope'],
      ['a propose grant', grant({ mode: 'propose' }), 403, 'insufficient_scope'],
      ['a grant for another project', grant({ mode: 'edit', projectIds: [otherPid] }), 403, 'out_of_scope'],
      ['a grant limited to a track', grant({ mode: 'edit', trackIds: [trackId] }), 403, 'out_of_scope'],
      ['a grant limited to a time range', grant({ mode: 'autopilot', range: { start: T.rt(0, 1), end: T.rt(1, 1) } }), 403, 'out_of_scope'],
    ];
    for (const [who, token, status, code] of refusals) {
      const viaRest = await rest(`/jobs/${jobId}/cancel`, {}, bearer(token));
      expect([who, viaRest.status, viaRest.body.error?.code]).toEqual([who, status, code]);
      const viaTool = await tool(token, 'cancel_job', { jobId });
      expect([who, viaTool.isError, viaTool.body.error?.code]).toEqual([who, true, code]);
    }
    // every refusal names the next step where it is the grant's limit
    expect((await rest(`/jobs/${jobId}/cancel`, {}, bearer(grant({ mode: 'edit', trackIds: [trackId] })))).body.error.hint).toMatch(/Ask the owner/);
    gov.setPaused(pid, true, OWNER);
    try {
      const paused = await tool(auth.tokens.agent, 'cancel_job', { jobId });
      expect([paused.isError, paused.body.error.code]).toEqual([true, 'agent_paused']);
      expect((await rest(`/jobs/${jobId}/cancel`, {}, bearer(auth.tokens.agent))).status).toBe(423);
    } finally { gov.setPaused(pid, false, OWNER); }
    expect(store.getJob(jobId).status).toBe('running');
    expect((await heartbeat(jobId, 'session-refused')).body).toEqual({ ok: true, canceled: false });
    // the owner may always stop their own export
    expect((await rest(`/jobs/${jobId}/cancel`, {}, ownerHeaders())).body).toMatchObject({ status: 'cancel-requested' });
    expect((await heartbeat(jobId, 'session-refused')).body).toEqual({ ok: true, canceled: true, canceledBy: 'user:local' });
    await abandon(jobId, 'session-refused');
  });

  it('the exception is only for the owner\'s tab: another agent\'s jobs and the owner\'s server exports stay not_your_job', async () => {
    const otherAgentsTab = store.createJob(pid, 'export', 'agent:someone', { route: 'browser', lease: { sessionId: 'session-x', expiresAt: 0 } });
    store.updateJob(otherAgentsTab.id, { status: 'running' });
    const ownersServerExport = store.createJob(pid, 'export', 'user:local', { revision: 1 });
    for (const id of [otherAgentsTab.id, ownersServerExport.id]) {
      const r = await rest(`/jobs/${id}/cancel`, {}, bearer(auth.tokens.agent));
      expect([r.status, r.body.error.code]).toEqual([403, 'not_your_job']);
      expect(r.body.error.hint).toMatch(/Ask the owner/);
      expect((await tool(auth.tokens.agent, 'cancel_job', { jobId: id })).body.error.code).toBe('not_your_job');
    }
    expect(store.getJob(ownersServerExport.id).status).toBe('queued');
  });

  it('a cancel the tab never acknowledges ends canceled (not failed) at lease expiry, naming who asked', async () => {
    const jobId = await tabStarts('session-silent');
    await rest(`/jobs/${jobId}/cancel`, {}, bearer(auth.tokens.agent));
    const be = (app as any).browserExport;
    be.sweepLeases(Date.now() + 16_000);
    expect(store.getJob(jobId)).toMatchObject({ status: 'canceled', output: null, error: { code: 'canceled', canceledBy: 'agent:local' } });
    expect(store.getJob(jobId).error.message).toMatch(/nothing was published/);
  });
});
