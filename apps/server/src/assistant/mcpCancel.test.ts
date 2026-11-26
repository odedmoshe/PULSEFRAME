/**
 * MCP cancel_job and a language-assistant request (ADR-0027 decisions 8 and 10 with the note of 2026-11-24; ADR-0002). The request
 * is the owner's own: the owner's session cancels it through cancel_job exactly as through POST /jobs/:jobId/cancel (one cancel,
 * AssistantJobs.cancel), and every agent credential is refused with the reason and the next step, on both surfaces alike, learning
 * nothing of the request (no text, no people fields, no status) and nothing about the job that get_job does not already tell it.
 * cancel_job used to have no dispatch for these jobs: the owner got the capability canceller's 409 cancel_not_supported and an
 * agent a generic not_your_job naming agent:assistant.
 * The assistant is the labelled MOCK adapter (testAdapter.ts); the key is a labelled test double. No provider, no port, no network.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASSISTANT_ACTOR, ASSISTANT_JOB_TYPE } from '@pulseframe/core';
import { Auth } from '../auth.ts';
import { Capabilities } from '../capabilities.ts';
import { loadConfig, type Config } from '../config.ts';
import { Derivatives } from '../derive.ts';
import { Exporter } from '../export.ts';
import { Governance, type Principal } from '../governance.ts';
import { createApp } from '../http.ts';
import { createMcp } from '../mcp.ts';
import { Presence } from '../presence.ts';
import { Speech } from '../speech.ts';
import { Store } from '../store.ts';
import { PLANTED, PLANTED_PRIVATE, plantedProject } from './assistantFixture.ts';
import { TestChatAdapter } from './testAdapter.ts';

const KEY = 'TEST-DOUBLE-NOT-A-KEY-mcp-cancel-5d17';
const HOST = 'api.example.test';
/** What the owner typed: a child's name and a word found nowhere else, so a leak of the request text is recognised. */
const TYPED = `חתוך את הקליפ של ${PLANTED.personName} אחרי המילה קישקושון`;
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, loneMcp: ReturnType<typeof createMcp>;
let derivatives: Derivatives, capabilities: Capabilities, speech: Speech;
let pid = '', otherPid = '', ownerCookie = '', videoClip = '';
const adapter = new TestChatAdapter();
const said: string[] = []; // every answer any surface gave in this file
const base = () => `http://127.0.0.1:${cfg.port}`;
const bearer = (token: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const ownerHeaders = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, headers: Record<string, string>, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  said.push(text);
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
};
let rpcId = 0;
const tool = async (headers: Record<string, string>, name: string, args: Record<string, unknown>, via = mcp) => {
  const r = await via(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...headers, accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const raw = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : raw);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  const text = msg.result.content[0].text as string;
  said.push(text);
  return { isError: msg.result.isError === true, body: JSON.parse(text) as any, text };
};
const grant = (name: string, mode: string, extra: Record<string, unknown> = {}) => gov.createGrant({ name, mode, ...extra }, OWNER).token;
/** A request the MOCK adapter holds until it is aborted: the job stays running (attempt 1) while the cancels are tried. */
const heldRequest = async () => {
  let sent!: () => void;
  const sentNow = new Promise<void>((r) => { sent = r; });
  adapter.queue({ wait: (signal) => new Promise((_res, rej) => { sent(); signal.addEventListener('abort', () => rej(new Error('MOCK: aborted'))); }) });
  const r = await rest('POST', `/projects/${pid}/assistant/requests`, ownerHeaders(), { text: TYPED, selection: [videoClip], playheadFrame: 0 });
  expect(r.status).toBe(202);
  await sentNow;
  return r.body.jobId as string;
};
const settled = async (jobId: string) => {
  for (let i = 0; i < 300; i++) { const j = store.getJob(jobId); if (['succeeded', 'failed', 'submission-unknown', 'canceled'].includes(j.status)) return j; await new Promise((res) => setTimeout(res, 10)); }
  return store.getJob(jobId);
};
/** A queued assistant row as job.ts writes it (nothing drives it): a cancel is decided by its type and status alone. */
const queuedRow = () => store.createJob(pid, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, { kind: 'assistant.propose', requestedBy: 'user:local', projectRevision: 0 }).id;
const REFUSAL = {
  code: 'owner_required',
  message: 'a language-assistant request belongs to the owner\'s own session, so an agent credential cannot cancel it',
  hint: 'Ask the owner to cancel it in the editor\'s command bar («ביטול הבקשה», Cancel the request); left alone it ends when the service answers, and it only ever makes a proposal the owner accepts or rejects.',
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-amcp-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, backupDir: null, assistantHosts: [HOST] };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  loneMcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech); // never handed to an app: no assistant behind it
  derivatives = new Derivatives(store);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech, { assistant: { adapters: new Map([[adapter.id, adapter]]), endpoint: () => null } });
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  const fx = plantedProject(store);
  pid = fx.pid;
  otherPid = store.createProject({ name: 'other', width: 320, height: 240, frameRate: { num: 30, den: 1 } }).doc.id;
  const doc = store.getProject(pid).doc;
  videoClip = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.id === 'trk_video')!.clips[0]!.id;
  expect((await rest('PUT', '/assistant/config', ownerHeaders(), { adapter: adapter.id, host: HOST, model: 'mock-model', pricesCentsPerMTok: { input: 300, output: 1500 }, monthlyLimitCents: 100_000, perRequestCapCents: 10_000, toggles: { titlesAndMarkers: false, peopleNames: false } })).status).toBe(200);
  expect((await rest('PUT', '/assistant/key', ownerHeaders(), { key: KEY })).status).toBe(200);
});
afterAll(async () => {
  // nothing any surface answered in this file held the request's text, a planted private value, or the test key
  const all = said.join('\n');
  expect(said.length).toBeGreaterThan(20);
  for (const v of [TYPED, 'קישקושון', ...PLANTED_PRIVATE, KEY, 'mcp-cancel-5d17']) expect(all, v).not.toContain(v);
  (app as any).browserExport?.stop();
  await mcp.close();
  await loneMcp.close();
  await speech.stop();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('cancel_job by the owner\'s own session reaches an assistant job as POST /jobs/:jobId/cancel does', () => {
  it('a queued request: both surfaces answer the same and the row ends canceled with nothing sent', async () => {
    const a = queuedRow(), b = queuedRow();
    const viaRest = await rest('POST', `/jobs/${a}/cancel`, ownerHeaders());
    const viaTool = await tool(ownerHeaders(), 'cancel_job', { jobId: b });
    expect(viaRest.status).toBe(200);
    expect(viaTool.isError).toBe(false);
    expect(viaTool.body).toEqual({ ...viaRest.body, jobId: b });
    expect(viaTool.body).toEqual({ jobId: b, status: 'canceled', outcome: 'removed-from-queue' });
    expect(store.getJob(b)).toMatchObject({ status: 'canceled', attempt: 0, error: { code: 'canceled' } });
  });
  it('a request that is with the service: the call is aborted, the job ends canceled and its reservation stays counted; a second cancel says already finished', async () => {
    const jobId = await heldRequest();
    const c = await tool(ownerHeaders(), 'cancel_job', { jobId });
    expect(c.isError).toBe(false);
    expect(c.body).toMatchObject({ jobId, status: 'cancel-requested', outcome: 'requested' });
    expect(c.body.note).toMatch(/reservation stays counted/);
    expect(await settled(jobId)).toMatchObject({ status: 'canceled', attempt: 1 });
    expect(gov.ledgerFor(jobId)!.state).toBe('unknown'); // sent before the cancel: the service may have charged
    expect((await tool(ownerHeaders(), 'cancel_job', { jobId })).body).toEqual({ jobId, status: 'canceled', outcome: 'already-finished' });
    expect((await rest('POST', `/jobs/${jobId}/cancel`, ownerHeaders())).body).toEqual({ jobId, status: 'canceled', outcome: 'already-finished' });
  });
  it('an MCP endpoint with no assistant behind it refuses honestly with the next step, never as another kind of job', async () => {
    const jobId = queuedRow();
    const r = await tool(ownerHeaders(), 'cancel_job', { jobId }, loneMcp);
    expect(r.isError).toBe(true);
    expect(r.body.error).toMatchObject({ code: 'cancel_not_supported', details: { jobId } });
    expect(r.body.error.message).not.toMatch(/not implemented yet/);
    expect(r.body.error.hint).toMatch(/owner's session/);
    expect(store.getJob(jobId).status).toBe('queued');
  });
});

describe('an agent credential cannot cancel an assistant job, and learns nothing of the request by asking', () => {
  it('cancel_job and REST refuse alike with owner_required: the reason, the next step, the job id and nothing else; the job goes on', async () => {
    const jobId = await heldRequest();
    const calls = adapter.calls;
    const edit = grant('editor-agent', 'edit'), auto = grant('autopilot-agent', 'autopilot', { projectIds: [pid] }), full = grant('people-agent', 'edit', { people: 'full' });
    for (const token of [auth.tokens.agent, edit, auto, full]) {
      const viaTool = await tool(bearer(token), 'cancel_job', { jobId });
      const viaRest = await rest('POST', `/jobs/${jobId}/cancel`, bearer(token));
      expect(viaTool.isError).toBe(true);
      expect(viaRest.status).toBe(403);
      expect(viaTool.body).toEqual(viaRest.body);
      // exactly these fields: no status or stage of the job, no actor, nothing of the request (its text, its hash, its size, people)
      expect(viaTool.body).toEqual({ error: { ...REFUSAL, details: { jobId } } });
      for (const v of [TYPED, PLANTED.personName, 'sha256', 'chars', 'running', 'awaiting-provider', ASSISTANT_ACTOR, 'user:local']) expect(viaTool.text, v).not.toContain(v);
    }
    // nothing was cancelled or disturbed: still with the (MOCK) service, not aborted, no second call
    expect(store.getJob(jobId)).toMatchObject({ status: 'running', attempt: 1 });
    expect(adapter.calls).toBe(calls);
    // what that credential can already read about the job says no more of the request either (no input, no text)
    const seen = await tool(bearer(auth.tokens.agent), 'get_job', { jobId });
    expect(seen.body).toMatchObject({ id: jobId, type: ASSISTANT_JOB_TYPE, status: 'running' });
    expect(seen.body.input).toBeUndefined();
    await rest('POST', `/jobs/${jobId}/cancel`, ownerHeaders());
    expect((await settled(jobId)).status).toBe('canceled');
    // a finished job is refused the same way: the refusal does not say how the job ended
    expect((await tool(bearer(auth.tokens.agent), 'cancel_job', { jobId })).body).toEqual({ error: { ...REFUSAL, details: { jobId } } });
  });
  it('scopes: what a credential is refused for before the owner rule is what it is refused for anywhere, and never more than get_job tells it', async () => {
    const jobId = queuedRow();
    const code = async (headers: Record<string, string>, name: string, id: string) => { const r = await tool(headers, name, { jobId: id }); return r.isError ? r.body.error.code as string : 'answered'; };
    // an observer and a propose-only grant hold no edit scope: the same refusal for this job and for a job that does not exist
    const propose = grant('propose-agent', 'propose');
    for (const token of [auth.tokens.observer, propose]) {
      expect(await code(bearer(token), 'cancel_job', jobId)).toBe('insufficient_scope');
      expect(await code(bearer(token), 'cancel_job', 'job_does_not_exist')).toBe('insufficient_scope');
      expect((await rest('POST', `/jobs/${jobId}/cancel`, bearer(token))).body.error.code).toBe('insufficient_scope');
    }
    // a grant for another project: out_of_scope, exactly as get_job answers it (it learns no more than that the id is not its to see)
    const elsewhere = grant('elsewhere-agent', 'edit', { projectIds: [otherPid] });
    expect(await code(bearer(elsewhere), 'get_job', jobId)).toBe('out_of_scope');
    expect(await code(bearer(elsewhere), 'cancel_job', jobId)).toBe('out_of_scope');
    expect((await rest('POST', `/jobs/${jobId}/cancel`, bearer(elsewhere))).body.error.code).toBe('out_of_scope');
    // an unknown id is not found for everyone, as with get_job
    expect(await code(bearer(auth.tokens.agent), 'cancel_job', 'job_does_not_exist')).toBe(await code(bearer(auth.tokens.agent), 'get_job', 'job_does_not_exist'));
    // paused agents are told they are paused (cancelling is an action), as for any job
    gov.setPaused(pid, true, OWNER);
    expect(await code(bearer(auth.tokens.agent), 'cancel_job', jobId)).toBe('agent_paused');
    gov.setPaused(pid, false, OWNER);
    expect(await code(bearer(auth.tokens.agent), 'cancel_job', jobId)).toBe('owner_required');
    // through all of it the row was never touched
    expect(store.getJob(jobId)).toMatchObject({ status: 'queued', attempt: 0 });
    // the other kinds keep their rule: another agent's job is still not_your_job, on both surfaces
    const theirs = store.createJob(pid, 'analysis', 'agent:someone-else', { assetId: 'ast_x', projectRevision: 0 }).id;
    expect(await code(bearer(auth.tokens.agent), 'cancel_job', theirs)).toBe('not_your_job');
  });
});
