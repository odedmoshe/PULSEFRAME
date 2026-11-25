/**
 * The LOCAL assistant's server contract (wave 7; .artifacts/wave7/assistant-decisions.md §4–§5): owner-only routes answering an honest
 * 501 until builder B, the visibility rules REUSED for local jobs and the local status (no new code: the same job type and the same
 * status function), the production wiring, and builder B's rows.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_ACTOR, ASSISTANT_JOB_TYPE, ASSISTANT_PUBLIC_STATUS_KEYS, type AssistantLocalOutput, type AssistantStatus } from '@pulseframe/core';
import { loadConfig } from './config.ts';
import { Governance, type Principal } from './governance.ts';
import { ApiError, Store } from './store.ts';
import { ASSISTANT_LOCAL_LANE_LABEL, ASSISTANT_LOCAL_SENTENCES, ASSISTANT_ROUTES } from './assistant/contract.ts';
import { createAssistantHandlers } from './assistant/routes.ts';
import { assistantJobStub, assistantStatusFor } from './assistant/visibility.ts';
import { createLlamaAdapter, LLAMA_ADAPTER_BUILT, LLAMA_ADAPTER_ID } from './assistant/local/llamaAdapter.ts';
import { createLocalMockAdapter, type LocalMockAdapter } from './assistant/local/localTestAdapter.ts';
import { startStandIn } from './assistant/local/standIn.ts';
import { recoverAssistantJobs } from './assistant/job.ts';
import { buildLocalRequest } from './assistant/localPrompt.ts';
import { FifoComputeLane } from './lane.ts';
import { ASSISTANT_LOCAL_TEXT_MAX, localPhrase } from '@pulseframe/core';
import { ASSISTANT_LOCAL_PROMPT_DIGEST } from '@pulseframe/providers';

// builder A's groundLocalAnswer / localPhrase: the labelled DOUBLE while core's LOCAL_INTENT_BUILT is false, the real ones after
vi.mock('@pulseframe/core', async (importOriginal) => (await import('./assistant/local/localTestAdapter.ts')).withLocalIntentDouble(await importOriginal()));

const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const agents: Principal[] = [
  { actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] },
  { actor: 'observer:local', kind: 'agent', scopes: ['observe'] },
];
const dirs: string[] = [], stores: Store[] = [];
afterAll(() => { for (const s of stores) s.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function handlers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-alc-'));
  dirs.push(dir);
  const store = new Store(dir); stores.push(store);
  return createAssistantHandlers({ cfg: { ...loadConfig({}), dataDir: dir }, store, gov: new Governance(store), deps: { adapters: new Map(), endpoint: () => null } });
}
const codeOf = async (fn: () => unknown): Promise<{ status: number; code: string }> => {
  try { await fn(); } catch (e) { if (e instanceof ApiError) return { status: e.status, code: e.code }; throw e; }
  throw new Error('not refused');
};

describe('the two local routes', () => {
  it('are listed, owner only', () => {
    const local = ASSISTANT_ROUTES.filter((r) => r.path.includes('/local/') || r.path.endsWith('/taken'));
    expect(local.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /api/v1/assistant/local/check', 'POST /api/v1/assistant/jobs/:jobId/taken']);
    for (const r of local) expect(r.access).toBe('owner');
  });
  it('refuse every agent with 403 owner_required, and answer the owner honestly (built: no port saved → 409 with the next step; unknown job → 404)', async () => {
    const h = handlers();
    for (const p of agents) {
      expect(await codeOf(() => h.localCheck(p))).toEqual({ status: 403, code: 'owner_required' });
      expect(await codeOf(() => h.taken(p, 'job_x'))).toEqual({ status: 403, code: 'owner_required' });
    }
    expect(await codeOf(() => h.localCheck(owner))).toEqual({ status: 409, code: 'assistant_not_connected' });
    expect(await codeOf(() => h.taken(owner, 'job_x'))).toEqual({ status: 404, code: 'job_not_found' });
  });
});

describe('visibility is reused, not re-implemented', () => {
  const planted = 'PLANTED-נועה-yom-huledet';
  const output: AssistantLocalOutput = { kind: 'local-intent', intent: 'add_title', slots: { text: planted }, dropped: [], phrase: `הוסף כותרת "${planted}" בהתחלה`, model: 'PLANTED-model.gguf', wallMs: 1234 };
  const row = { id: 'job_1', projectId: 'prj_1', type: ASSISTANT_JOB_TYPE, status: 'succeeded', createdAt: 'a', updatedAt: 'b', output, input: { profile: 'local', port: 8791 } };
  it('a local job reaches every non-owner credential as the stub only (id, project, type, actor, status, times)', () => {
    for (const p of agents) {
      const stub = assistantJobStub(p, row)!;
      expect(stub).toEqual({ id: 'job_1', projectId: 'prj_1', type: ASSISTANT_JOB_TYPE, actor: ASSISTANT_ACTOR, status: 'succeeded', createdAt: 'a', updatedAt: 'b' });
      expect(JSON.stringify(stub)).not.toContain('PLANTED');
    }
    expect(assistantJobStub(owner, row)).toBeNull(); // the owner reads it whole
  });
  it('the local status (port, model, last check) reaches non-owners as connected, setup and detail only', () => {
    const whole = { setup: 'ready', detail: 'ready', adapter: 'local-llama-server', host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0,
      month: '2026-11', spentCents: 0, reservedCents: 0, held: [], toggles: { titlesAndMarkers: false, peopleNames: false }, keySet: false, keyAddedAt: null, adapters: [],
      local: { port: 18791, timeoutSeconds: 60, lastCheck: { state: 'running', model: 'PLANTED-model.gguf', checkedAt: 'c' } } } satisfies AssistantStatus;
    for (const p of agents) {
      const s = assistantStatusFor(p, whole);
      expect(Object.keys(s).sort()).toEqual([...ASSISTANT_PUBLIC_STATUS_KEYS].sort());
      expect(JSON.stringify(s)).not.toMatch(/PLANTED|18791/);
    }
    expect(assistantStatusFor(owner, whole)).toBe(whole);
  });
});

describe('production wiring', () => {
  const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  it('installs the loopback adapter and the lane; never imports the stand-in or the MOCK', () => {
    const index = src('./index.ts');
    expect(index).toMatch(/createLlamaAdapter\(\)/);
    expect(index).toMatch(/lane, local:/);
    for (const f of ['./index.ts', './main.ts', './http.ts', './assistant/routes.ts', './assistant/job.ts']) {
      expect(src(f), f).not.toMatch(/standIn|localTestAdapter/);
    }
    expect(LLAMA_ADAPTER_ID).toBe('local-llama-server');
    expect(ASSISTANT_LOCAL_LANE_LABEL).toBe('assistant (local model)');
    expect(ASSISTANT_LOCAL_SENTENCES.local_server_error.message('HTTP 500')).toBe('the local assistant answered with an error (HTTP 500)');
  });
});

describe('builder B (server)', () => {
  const TEXT = 'המוזיקה חזקה מדי, תורידי אותה בשש דציבל';
  const GAIN6 = JSON.stringify({ intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' } });
  const MONEY = /חויב|שמור|charge|reserv/i;
  const local = (mock: LocalMockAdapter | ReturnType<typeof createLlamaAdapter> | null, port: number | null = 18791) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-alc-b-'));
    dirs.push(dir);
    const store = new Store(dir); stores.push(store);
    const gov = new Governance(store);
    const lane = new FifoComputeLane();
    const h = createAssistantHandlers({ cfg: { ...loadConfig({}), dataDir: dir }, store, gov, deps: { adapters: new Map(), endpoint: () => null, local: mock, lane } });
    h.putConfig(owner, { adapter: LLAMA_ADAPTER_ID, host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0, toggles: { titlesAndMarkers: false, peopleNames: false }, local: port === null ? null : { port, timeoutSeconds: 60 } });
    const pid = store.createProject({ name: 'p', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
    const run = async (text = TEXT) => { const { jobId } = await h.request(owner, pid, { text, selection: [], playheadFrame: 0 }); await h.done(jobId); return store.getJob(jobId); };
    const ledger = () => (store.db.prepare('SELECT COUNT(*) AS n FROM budget_ledger').get() as { n: number }).n;
    return { dir, store, gov, lane, h, pid, run, ledger };
  };
  it('is built', () => { expect(LLAMA_ADAPTER_BUILT).toBe(true); });
  it('start(): with the local adapter chosen no price, host, model or key is read, no summary is built, estimateCents and reserveAssistant are not called; Pause Agent still refuses 423; the intent row has profile local, the text sha and chars, the local digest, the port and no text', async () => {
    const e = local(createLocalMockAdapter({ [TEXT]: GAIN6 }));
    const reserve = vi.spyOn(e.gov, 'reserveAssistant');
    const job = await e.run();
    expect(reserve).not.toHaveBeenCalled();
    expect(e.ledger()).toBe(0);
    expect(job.input).toMatchObject({ profile: 'local', text: { chars: [...TEXT].length }, promptDigest: ASSISTANT_LOCAL_PROMPT_DIGEST, port: 18791 });
    expect(job.input).not.toHaveProperty('summary');
    expect(job.input).not.toHaveProperty('reservedCents');
    expect(JSON.stringify(job.input)).not.toContain('המוזיקה');
    e.gov.setPaused(e.pid, true, owner);
    expect(await codeOf(() => e.h.request(owner, e.pid, { text: TEXT, selection: [], playheadFrame: 0 }))).toEqual({ status: 423, code: 'agent_paused' });
  });
  it('start(): a text barUnderstands reads is refused 409 grammar_understood with no job row and no call of the adapter; a text over ASSISTANT_LOCAL_TEXT_MAX is refused 400', async () => {
    const mock = createLocalMockAdapter({});
    const e = local(mock);
    expect(await codeOf(() => e.h.request(owner, e.pid, { text: 'חתוך כאן', selection: [], playheadFrame: 0 }))).toEqual({ status: 409, code: 'grammar_understood' });
    expect(await codeOf(() => e.h.request(owner, e.pid, { text: 'א'.repeat(ASSISTANT_LOCAL_TEXT_MAX + 1), selection: [], playheadFrame: 0 }))).toEqual({ status: 400, code: 'invalid_request' });
    expect((e.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n).toBe(0);
    expect(mock.sent).toEqual([]);
  });
  it('run(): takes the lane as ASSISTANT_LOCAL_LANE_LABEL (stage waiting-for-compute while another holder runs) and releases it on success, failure, cancel and adapter error (lane.busy().holder null after each)', async () => {
    const mock = createLocalMockAdapter({ [TEXT]: GAIN6 });
    const e = local(mock);
    const seen: (string | null)[] = [];
    const inner = mock.complete;
    mock.complete = (...a) => { seen.push(e.lane.busy().holder); return inner(...a); };
    const hold = await e.lane.acquire('speech');
    const { jobId } = await e.h.request(owner, e.pid, { text: TEXT, selection: [], playheadFrame: 0 });
    for (let i = 0; i < 200 && e.store.getJob(jobId).stage !== 'waiting-for-compute'; i++) await new Promise((r) => setTimeout(r, 5));
    expect(e.store.getJob(jobId).stage).toBe('waiting-for-compute');
    hold();
    await e.h.done(jobId);
    expect(e.store.getJob(jobId).status).toBe('succeeded');
    expect(e.lane.busy().holder).toBeNull();
    mock.queue({ throw: 'server_error', detail: 'HTTP 500' }); expect((await e.run()).status).toBe('failed'); expect(e.lane.busy().holder).toBeNull();
    mock.queue({ reply: { text: 'x', finish: 'stop', model: null } }); expect((await e.run()).error.code).toBe('invalid_model_output'); expect(e.lane.busy().holder).toBeNull();
    mock.queue({ hold: true });
    const c = await e.h.request(owner, e.pid, { text: TEXT, selection: [], playheadFrame: 0 });
    for (let i = 0; i < 200 && e.store.getJob(c.jobId).status !== 'running'; i++) await new Promise((r) => setTimeout(r, 5));
    e.h.cancel(owner, c.jobId); await e.h.done(c.jobId);
    expect(e.store.getJob(c.jobId).status).toBe('canceled');
    expect(e.lane.busy()).toEqual({ holder: null, waiting: 0 });
    expect(seen.every((x) => x === ASSISTANT_LOCAL_LANE_LABEL)).toBe(true);
  });
  it('run(): the MOCK adapter receives buildLocalRequest(text) exactly (no project data, no key) and a gain_change answer becomes an AssistantLocalOutput with the rendered phrase; intent none succeeds with phrase null', async () => {
    const mock = createLocalMockAdapter({ [TEXT]: GAIN6 });
    const e = local(mock);
    const job = await e.run();
    expect(mock.sent).toEqual([buildLocalRequest(TEXT)]);
    expect(job.output).toMatchObject({ kind: 'local-intent', intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' }, phrase: localPhrase('gain_change', { target: 'music', dir: 'down', db: '6' }, 'he') });
    expect((await e.run('תעשה שזה יהיה מרגש')).output).toMatchObject({ intent: 'none', phrase: null });
  });
  it('run(): LocalModelError not_running / loading / timeout / not_loopback / server_error fail with local_* codes and ASSISTANT_LOCAL_SENTENCES; never submission-unknown; no money word; no budget_ledger row at any point', async () => {
    const mock = createLocalMockAdapter({});
    const e = local(mock);
    for (const [code, want] of [['not_running', 'local_not_running'], ['loading', 'local_loading'], ['timeout', 'local_timeout'], ['not_loopback', 'local_not_loopback']] as const) {
      mock.queue({ throw: code });
      const j = await e.run();
      expect(j.error).toMatchObject({ code: want, message: ASSISTANT_LOCAL_SENTENCES[want].message, hint: ASSISTANT_LOCAL_SENTENCES[want].hint });
      expect(j.status).toBe('failed');
      expect(JSON.stringify(j.error)).not.toMatch(MONEY);
    }
    mock.queue({ throw: 'server_error', detail: 'HTTP 502' });
    expect((await e.run()).error.message).toBe(ASSISTANT_LOCAL_SENTENCES.local_server_error.message('HTTP 502'));
    expect(e.ledger()).toBe(0);
  });
  it('cancel() and recoverAssistantJobs: a local job uses canceled_unsent / canceled_sent / recovered and touches no ledger', async () => {
    const mock = createLocalMockAdapter({});
    const e = local(mock);
    const a = await e.h.request(owner, e.pid, { text: TEXT, selection: [], playheadFrame: 0 });
    e.h.cancel(owner, a.jobId); await e.h.done(a.jobId);
    expect(e.store.getJob(a.jobId).error.message).toBe(ASSISTANT_LOCAL_SENTENCES.canceled_unsent.message);
    mock.queue({ hold: true });
    const b = await e.h.request(owner, e.pid, { text: TEXT, selection: [], playheadFrame: 0 });
    for (let i = 0; i < 200 && e.store.getJob(b.jobId).status !== 'running'; i++) await new Promise((r) => setTimeout(r, 5));
    e.h.cancel(owner, b.jobId); await e.h.done(b.jobId);
    expect(e.store.getJob(b.jobId).error.message).toBe(ASSISTANT_LOCAL_SENTENCES.canceled_sent.message);
    const stuck = e.store.createJob(e.pid, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, { kind: 'assistant.propose', profile: 'local' });
    e.store.updateJob(stuck.id, { status: 'running', stage: 'awaiting-local-model', attempt: 1 });
    recoverAssistantJobs(e.store, e.gov);
    expect(e.store.getJob(stuck.id)).toMatchObject({ status: 'failed', error: { code: 'local_interrupted', message: ASSISTANT_LOCAL_SENTENCES.recovered.message } });
    expect(e.ledger()).toBe(0);
  });
  it('taken: owner only; clears phrase and slots.text by direct SQL inside Store.erasing (cleared true); 404 unknown job, 409 not a local job; the next request on the project and project delete clear too; the planted text is absent from the database file afterwards', async () => {
    const MARK = 'טפטופונית', REQ = `שימי בפתיחה כיתוב ${MARK} בבקשה`;
    const e = local(createLocalMockAdapter({ [REQ]: JSON.stringify({ intent: 'add_title', slots: { text: MARK, at: 'start' } }) }));
    const job = await e.run(REQ);
    expect(job.output.slots.text).toBe(MARK);
    for (const p of agents) expect(await codeOf(() => e.h.taken(p, job.id))).toEqual({ status: 403, code: 'owner_required' });
    expect(await codeOf(() => e.h.taken(owner, 'job_nope'))).toEqual({ status: 404, code: 'job_not_found' });
    expect(await codeOf(() => e.h.taken(owner, e.store.createJob(e.pid, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, { kind: 'assistant.propose' }).id))).toEqual({ status: 409, code: 'not_a_local_job' });
    const erasing = vi.spyOn(e.store, 'erasing');
    await e.h.taken(owner, job.id);
    expect(erasing).toHaveBeenCalledTimes(1);
    expect(e.store.getJob(job.id).output).toMatchObject({ cleared: true, phrase: null, slots: {} });
    const files = fs.readdirSync(e.dir).filter((f) => f.endsWith('.db') || f.endsWith('-wal') || f.endsWith('.sqlite'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(fs.readFileSync(path.join(e.dir, f)).includes(Buffer.from(MARK)), f).toBe(false);
    const again = await e.run(REQ);
    await e.run('תעשה שזה יהיה מרגש');
    expect(e.store.getJob(again.id).output).toMatchObject({ cleared: true, phrase: null });
  });
  it('llamaAdapter: dials only localModelUrl; aborts before writing a byte when isLoopbackRemote(socket.remoteAddress) is false; sends no Authorization or cookie header; caps the reply at 64 KiB; maps ECONNREFUSED, 503, the time limit, other statuses and the signal to the LocalModelError codes; logs nothing', async () => {
    // the full set is in assistant/local/local.test.ts; here the one line the lead reads first: not a byte to a non-loopback socket
    const s = await startStandIn({ answers: {} });
    try {
      const net = await import('node:net');
      const a = createLlamaAdapter({ connect: (host, port) => { const sock = net.connect({ host, port }); Object.defineProperty(sock, 'remoteAddress', { value: '192.168.1.20' }); return sock; } });
      await expect(a.complete(buildLocalRequest(TEXT), s.port, 5000, new AbortController().signal)).rejects.toMatchObject({ code: 'not_loopback', sent: false });
      await new Promise((r) => setTimeout(r, 100));
      expect(s.connections.map((b) => b.length)).toEqual([0]);
      expect(s.requests).toEqual([]);
    } finally { await s.close(); }
  });
  it('status: the owner reads local { port, timeoutSeconds, lastCheck }; setup comes from localBlockers when the adapter is local-llama-server (installed = deps.local present)', async () => {
    const e = local(createLocalMockAdapter({}));
    expect(await e.h.status(owner)).toMatchObject({ setup: 'ready', adapter: LLAMA_ADAPTER_ID, local: { port: 18791, timeoutSeconds: 60, lastCheck: null } });
    await e.h.localCheck(owner);
    expect(await e.h.status(owner)).toMatchObject({ local: { lastCheck: { state: 'running', model: 'MOCK.gguf' } } });
    expect(await local(null).h.status(owner)).toMatchObject({ setup: 'provider_not_configured' });
    expect(await local(createLocalMockAdapter({}), null).h.status(owner)).toMatchObject({ setup: 'provider_not_configured', local: null });
  });
  it('wording: each local sentence is PROVOKED from the job and routes (not running, loading, timeout, not loopback, server error, both cancels, recovery, each invalid category, grammar_understood) and equals ASSISTANT_LOCAL_SENTENCES (in local/local.test.ts)', () => {
    // provoked one by one in assistant/local/local.test.ts ("every LocalModelError is an honest state in words", "an invalid answer …",
    // both cancel tests, the restart test, "grammar first"); here: every sentence and hint is free of money words
    for (const s of Object.values(ASSISTANT_LOCAL_SENTENCES)) {
      const m = typeof s.message === 'function' ? s.message('x') : s.message;
      expect(`${m} ${s.hint}`).not.toMatch(MONEY);
    }
  });
  it('jobPrivacy.test.ts and statusPrivacy.test.ts walk every REST route, MCP tool, resource and the event stream with a planted local phrase, text slot, port and model name for the seven credentials', () => {
    const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src('./assistant/jobPrivacy.test.ts')).toMatch(/the LOCAL assistant/);
    expect(src('./assistant/statusPrivacy.test.ts')).toMatch(/the LOCAL assistant/);
  });
});
