/**
 * The assistant's REST routes end to end through createApp (ADR-0027, plan §7.5): status for any observer and never the
 * key; owner-only setup and requests (agents get 403 owner_required); 409 with no job row while not set up; the key file
 * 0600; a host outside PF_ASSISTANT_HOSTS refused; a request answered by the labelled MOCK adapter becomes an open
 * proposal. No real provider is called and no network adapter exists; nothing here opens a port.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_JOB_TYPE } from '@pulseframe/core';
import { Auth } from '../auth.ts';
import { Capabilities } from '../capabilities.ts';
import { loadConfig, type Config } from '../config.ts';
import { Derivatives } from '../derive.ts';
import { Exporter } from '../export.ts';
import { Governance } from '../governance.ts';
import { createApp } from '../http.ts';
import { createMcp } from '../mcp.ts';
import { Presence } from '../presence.ts';
import { Speech } from '../speech.ts';
import { Store } from '../store.ts';
import { f, PLANTED, PLANTED_PRIVATE, plantedProject } from './assistantFixture.ts';
import { ASSISTANT_KEY_FILE, ASSISTANT_ROUTES } from './contract.ts';
import { createAssistantHandlers } from './routes.ts';
import { mockToolAnswer, TestChatAdapter } from './testAdapter.ts';

const KEY = 'TEST-DOUBLE-NOT-A-KEY-routes-91b2';
const HOST = 'api.example.test';
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, derivatives: Derivatives;
let pid = '', ownerCookie = '', videoClip = '';
const adapter = new TestChatAdapter();
const seen: string[] = []; // every JSON body any route answered in this file
const base = () => `http://127.0.0.1:${cfg.port}`;
const bearer = (token: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const ownerHeaders = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, headers: Record<string, string>, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  seen.push(text);
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
};
const config = (over: Record<string, unknown> = {}) => ({ adapter: adapter.id, host: HOST, model: 'mock-model', pricesCentsPerMTok: { input: 300, output: 1500 }, monthlyLimitCents: 100_000, perRequestCapCents: 10_000, toggles: { titlesAndMarkers: false, peopleNames: false }, ...over });
const jobRows = () => (store.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE type = ?').get(ASSISTANT_JOB_TYPE) as { n: number }).n;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-aroutes-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, backupDir: null, assistantHosts: [HOST] };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  const capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  const speech = new Speech(store, cfg);
  const mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  derivatives = new Derivatives(store);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech, { assistant: { adapters: new Map([[adapter.id, adapter]]), endpoint: () => null } });
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  const fx = plantedProject(store);
  pid = fx.pid;
  const doc = store.getProject(pid).doc;
  videoClip = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.id === 'trk_video')!.clips[0]!.id;
});
afterAll(async () => {
  // no route's JSON, in this whole file, held the key, nor its distinctive part
  const all = seen.join('\n');
  expect(seen.length).toBeGreaterThan(20);
  expect(all).not.toContain(KEY);
  expect(all).not.toContain('routes-91b2');
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a fresh data directory', () => {
  it('status answers any observer with an honest not-ready state and no key field', async () => {
    for (const h of [bearer(auth.tokens.agent), bearer(auth.tokens.observer), ownerHeaders()]) {
      const r = await rest('GET', '/assistant/status', h);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ setup: 'provider_not_configured', keySet: false, keyAddedAt: null, monthlyLimitCents: 0, perRequestCapCents: 0, spentCents: 0, reservedCents: 0, adapters: [adapter.id], toggles: { titlesAndMarkers: false, peopleNames: false } });
      expect(Object.keys(r.body).filter((k) => ['key', 'apikey', 'api_key', 'secret', 'token', 'authorization'].includes(k.toLowerCase()))).toEqual([]);
    }
  });
  it('a request while not set up → 409 assistant_not_connected with the setup state and a hint; no job row', async () => {
    const r = await rest('POST', `/projects/${pid}/assistant/requests`, ownerHeaders(), { text: 'חתוך כאן', selection: [], playheadFrame: 0 });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'assistant_not_connected', details: { setup: 'provider_not_configured' } });
    expect(r.body.error.hint).toBeTruthy();
    expect(jobRows()).toBe(0);
    expect(adapter.calls).toBe(0);
  });
});

describe('owner only', () => {
  it('every owner route refuses an agent or observer token with 403 owner_required', async () => {
    for (const token of [auth.tokens.agent, auth.tokens.observer]) {
      for (const route of ASSISTANT_ROUTES.filter((r) => r.access === 'owner')) {
        const body = route.method === 'POST' ? { text: 'x', selection: [], playheadFrame: 0 } : route.path.endsWith('/config') ? config() : route.method === 'PUT' ? { key: KEY } : undefined;
        const r = await rest(route.method, route.path.replace('/api/v1', '').replace(':id', pid), bearer(token), body);
        expect({ status: r.status, code: r.body?.error?.code }, `${route.method} ${route.path}`).toEqual({ status: 403, code: 'owner_required' });
      }
    }
    expect(fs.existsSync(path.join(dir, ASSISTANT_KEY_FILE))).toBe(false);
    expect(jobRows()).toBe(0);
  });
  it('the handlers check the owner themselves too', () => {
    const h = createAssistantHandlers({ cfg, store, gov, deps: { adapters: new Map(), endpoint: () => null } });
    const agent = { actor: 'agent:local', kind: 'agent' as const, scopes: ['observe', 'edit'] as ('observe' | 'edit')[] };
    for (const call of [() => h.putKey(agent, KEY), () => h.deleteKey(agent), () => h.putConfig(agent, config() as never), () => h.summary(agent, pid, { playheadFrame: 0, selection: [] }), () => h.request(agent, pid, { text: 'x', selection: [], playheadFrame: 0 })])
      expect(call).toThrow(/owner/);
  });
});

describe('the owner sets it up', () => {
  it('a host outside PF_ASSISTANT_HOSTS is refused; zero prices are refused by the schema', async () => {
    const bad = await rest('PUT', '/assistant/config', ownerHeaders(), config({ host: 'evil.example.test' }));
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('host_not_allowed');
    const http = await rest('PUT', '/assistant/config', ownerHeaders(), config({ host: `http://${HOST}` }));
    expect(http.status).toBe(400);
    const zero = await rest('PUT', '/assistant/config', ownerHeaders(), config({ pricesCentsPerMTok: { input: 0, output: 1500 } }));
    expect(zero.status).toBe(400);
    expect(JSON.stringify(zero.body)).toMatch(/more than 0/);
    expect((await rest('GET', '/assistant/status', ownerHeaders())).body.host).toBeNull();
  });
  it('config, then key: the key file is 0600, the status says only keySet, and the setup becomes ready', async () => {
    const c = await rest('PUT', '/assistant/config', ownerHeaders(), config({ host: `https://${HOST}` }));
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ setup: 'provider_not_configured', host: HOST, model: 'mock-model' });
    expect(c.body.detail).toMatch(/no key is stored/);
    const k = await rest('PUT', '/assistant/key', ownerHeaders(), { key: KEY });
    expect(k.status).toBe(200);
    expect(Object.keys(k.body).sort()).toEqual(['keyAddedAt', 'keySet']);
    expect(k.body.keySet).toBe(true);
    expect(fs.statSync(path.join(dir, ASSISTANT_KEY_FILE)).mode & 0o777).toBe(0o600);
    const s = await rest('GET', '/assistant/status', bearer(auth.tokens.agent));
    expect(s.body).toMatchObject({ setup: 'ready', keySet: true, host: HOST });
  });
  it('the summary route answers exactly what a request would send, with none of the planted values', async () => {
    const r = await rest('GET', `/projects/${pid}/assistant/summary?playheadFrame=30&selection=${videoClip}`, ownerHeaders());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ format: 'pulseframe.assistant-summary', playheadFrame: 30, selection: [videoClip], sent: { titlesAndMarkers: false, peopleNames: false } });
    const json = JSON.stringify(r.body);
    for (const v of [...PLANTED_PRIVATE, PLANTED.personName, PLANTED.title]) expect(json, v).not.toContain(v);
  });
  it('a request answered by the MOCK adapter → 202, then an open proposal; the revision is unchanged; the job view holds no key', async () => {
    adapter.queue(mockToolAnswer([{ op: 'split_clip', args: { clipId: videoClip, at: f(60) } }], 'MOCK proposal'));
    const before = store.getProject(pid).revision;
    const r = await rest('POST', `/projects/${pid}/assistant/requests`, ownerHeaders(), { text: 'חתוך בשנייה 2', selection: [videoClip], playheadFrame: 0 });
    expect(r.status).toBe(202);
    const jobId = r.body.jobId as string;
    let job: any;
    for (let i = 0; i < 200; i++) {
      job = (await rest('GET', `/jobs/${jobId}`, ownerHeaders())).body;
      if (['succeeded', 'failed', 'submission-unknown', 'canceled'].includes(job.status)) break;
      await new Promise((res) => setTimeout(res, 10));
    }
    expect(job).toMatchObject({ status: 'succeeded', type: ASSISTANT_JOB_TYPE, output: { opsCount: 1, costBasis: 'reported' } });
    expect(store.getProject(pid).revision).toBe(before);
    const proposals = await rest('GET', `/projects/${pid}/proposals`, ownerHeaders());
    expect(JSON.stringify(proposals.body)).toContain(job.output.proposalId);
    expect(adapter.calls).toBe(1);
    expect(adapter.requests[0]!.keyLength).toBe(KEY.length); // the key reached the adapter's call, and only there
    const status = await rest('GET', '/assistant/status', ownerHeaders());
    expect(status.body.spentCents).toBe(job.output.costCents);
  });
  it('the summary route refuses a playhead that is not a frame number with a hint and the value it was given', async () => {
    for (const bad of ['1.5', '-3', 'abc']) {
      const r = await rest('GET', `/projects/${pid}/assistant/summary?playheadFrame=${bad}`, ownerHeaders());
      expect(r.status, bad).toBe(400);
      expect(r.body.error, bad).toMatchObject({ code: 'invalid_request', details: { playheadFrame: bad }, hint: 'Send the playhead as a frame number, for example playheadFrame=90.' });
    }
  });
  it('POST /jobs/:jobId/cancel reaches an assistant job (AssistantJobs.cancel), not the capability jobs\' 409 cancel_not_supported', async () => {
    let sent!: () => void;
    const sentNow = new Promise<void>((r) => { sent = r; });
    adapter.queue({ wait: (signal) => new Promise((_res, rej) => { sent(); signal.addEventListener('abort', () => rej(new Error('MOCK: aborted'))); }) });
    const r = await rest('POST', `/projects/${pid}/assistant/requests`, ownerHeaders(), { text: 'חתוך בשנייה 2', selection: [videoClip], playheadFrame: 0 });
    expect(r.status).toBe(202);
    const jobId = r.body.jobId as string;
    await sentNow;
    // the request is the owner's: an agent credential is refused before the assistant's handler (mcpCancel.test.ts has the whole rule)
    const agent = await rest('POST', `/jobs/${jobId}/cancel`, bearer(auth.tokens.agent));
    expect(agent.status).toBe(403);
    expect(agent.body.error.code).toBe('owner_required');
    const c = await rest('POST', `/jobs/${jobId}/cancel`, ownerHeaders());
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ jobId, outcome: 'requested' });
    let job: any;
    for (let i = 0; i < 200; i++) {
      job = (await rest('GET', `/jobs/${jobId}`, ownerHeaders())).body;
      if (['succeeded', 'failed', 'submission-unknown', 'canceled'].includes(job.status)) break;
      await new Promise((res) => setTimeout(res, 10));
    }
    expect(job).toMatchObject({ status: 'canceled', attempt: 1 });
    expect(gov.ledgerFor(jobId)!.state).toBe('unknown'); // sent before the cancel: the service may have charged
    const again = await rest('POST', `/jobs/${jobId}/cancel`, ownerHeaders());
    expect(again.body).toMatchObject({ jobId, outcome: 'already-finished' });
  });
  it('the owner can delete the key; the setup is then not ready again', async () => {
    const d = await rest('DELETE', '/assistant/key', ownerHeaders());
    expect(d.body).toEqual({ keySet: false, keyAddedAt: null });
    expect(fs.existsSync(path.join(dir, ASSISTANT_KEY_FILE))).toBe(false);
    expect((await rest('GET', '/assistant/status', ownerHeaders())).body.setup).toBe('provider_not_configured');
  });
});

describe('the reserved actor name', () => {
  it('a stored grant named "assistant" authenticates as nothing; the warning names the grant, never the token', async () => {
    const token = 'pfg_TEST-DOUBLE-reserved-name-grant';
    const sha = createHash('sha256').update(token).digest('hex');
    store.db.prepare('INSERT INTO grants (id, name, token_hash, mode, constraints, budget_cents, created_at, created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run('grt_reservedtest', 'assistant', sha, 'autopilot', JSON.stringify({ projectIds: null, trackIds: null, range: null }), 1000, new Date().toISOString(), 'user:local');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (let i = 0; i < 2; i++) {
        const r = await rest('GET', '/assistant/status', bearer(token));
        expect(r.status).toBe(401);
        expect(r.body.error.code).toBe('invalid_token');
        expect(r.body.error.hint).toBeTruthy();
      }
      expect(warn).toHaveBeenCalledTimes(1); // once per grant
      const line = String(warn.mock.calls[0]![0]);
      expect(line).toContain('grt_reservedtest');
      expect(line).not.toContain(token);
    } finally { warn.mockRestore(); }
  });
});
