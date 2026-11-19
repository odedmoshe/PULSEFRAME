/**
 * The durable job assistant.propose (ADR-0027, plan §7.4), driven with the labelled MOCK adapter (testAdapter.ts). No real
 * provider is called and no network adapter exists: these are contract tests of the job, the ledger and the proposal.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ASSISTANT_ACTOR, ASSISTANT_JOB_TYPE, type AssistantRequestBody } from '@pulseframe/core';
import { ChatProviderError } from '@pulseframe/providers';
import { loadConfig } from '../config.ts';
import { Governance, type Principal } from '../governance.ts';
import { ApiError, Store } from '../store.ts';
import { f, PLANTED, PLANTED_PRIVATE, plantedProject } from './assistantFixture.ts';
import { AssistantFiles } from './credential.ts';
import { AssistantJobs, assistantSetup, centsFor, estimateCents, recoverAssistantJobs, type AssistantRuntime } from './job.ts';
import { invalidMockAnswers, mockToolAnswer, TestChatAdapter, type MockStep } from './testAdapter.ts';

const KEY = 'TEST-DOUBLE-NOT-A-KEY-5d1e';
const HOST = 'api.example.test';
const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const dirs: string[] = [];
const stores: Store[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function setup(opts: { script?: MockStep[]; bytesBoundTokens?: boolean; cap?: number; monthly?: number; configure?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ajob-'));
  dirs.push(dir);
  const store = new Store(dir);
  stores.push(store);
  const gov = new Governance(store);
  const cfg = { ...loadConfig({}), dataDir: dir, assistantHosts: [HOST] };
  const adapter = new TestChatAdapter({ script: opts.script ?? [], bytesBoundTokens: opts.bytesBoundTokens ?? true });
  const files = new AssistantFiles(dir, cfg.assistantHosts);
  const rt: AssistantRuntime = { cfg, store, gov, deps: { adapters: new Map([[adapter.id, adapter]]), endpoint: () => null }, files };
  if (opts.configure !== false) {
    files.writeConfig({ adapter: adapter.id, host: HOST, model: 'mock-model', pricesCentsPerMTok: { input: 300, output: 1500 }, monthlyLimitCents: opts.monthly ?? 100_000, perRequestCapCents: opts.cap ?? 10_000, toggles: { titlesAndMarkers: false, peopleNames: false } });
    files.writeKey(KEY);
  }
  const fx = plantedProject(store);
  const doc = store.getProject(fx.pid).doc;
  const videoClip = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.id === 'trk_video')!.clips[0]!.id;
  const jobs = new AssistantJobs(rt);
  const body: AssistantRequestBody = { text: 'חתוך את הקליפ בשנייה 2', selection: [videoClip], playheadFrame: 0 };
  const proposals = () => (store.db.prepare('SELECT COUNT(*) AS n FROM proposals').get() as { n: number }).n;
  const jobRows = () => (store.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE type = ?').get(ASSISTANT_JOB_TYPE) as { n: number }).n;
  return { dir, store, gov, adapter, files, rt, jobs, body, videoClip, proposals, jobRows, ...fx };
}
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof ApiError) return { status: e.status, code: e.code, details: e.details, hint: e.hint }; throw e; } throw new Error('not refused'); };
const split = (clipId: string) => ({ op: 'split_clip', args: { clipId, at: f(60) } });

describe('before any job: honest refusals that create nothing', () => {
  it('not configured → 409 assistant_not_connected with the setup state; no job row; nothing sent', () => {
    const s = setup({ configure: false });
    expect(assistantSetup(s.rt).setup).toBe('provider_not_configured');
    const r = refusal(() => s.jobs.start(owner, s.pid, s.body));
    expect(r).toMatchObject({ status: 409, code: 'assistant_not_connected', details: { setup: 'provider_not_configured' } });
    expect(r.hint).toBeTruthy();
    expect(s.jobRows()).toBe(0);
    expect(s.adapter.calls).toBe(0);
  });
  it('agents paused → 423; no job row; nothing sent', () => {
    const s = setup();
    s.gov.setPaused(s.pid, true, owner);
    expect(refusal(() => s.jobs.start(owner, s.pid, s.body))).toMatchObject({ status: 423, code: 'agent_paused' });
    expect(s.jobRows()).toBe(0);
    expect(s.adapter.calls).toBe(0);
  });
});

describe('the reservation', () => {
  it('budget exceeded (per-request cap) → 402 before anything is sent; the adapter was called 0 times', async () => {
    const s = setup({ cap: 10, script: [mockToolAnswer([split('x')])] });
    expect(refusal(() => s.jobs.start(owner, s.pid, s.body))).toMatchObject({ status: 402, code: 'budget_exceeded' });
    const job = s.store.db.prepare('SELECT id, status FROM jobs WHERE type = ?').get(ASSISTANT_JOB_TYPE) as { id: string; status: string };
    expect(job.status).toBe('failed');
    expect(s.gov.ledgerFor(job.id)).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(s.adapter.calls).toBe(0);
  });
  it('budget exceeded (monthly limit) → 402; nothing sent', () => {
    const s = setup({ monthly: 20, cap: 10_000 });
    expect(refusal(() => s.jobs.start(owner, s.pid, s.body))).toMatchObject({ status: 402, code: 'budget_exceeded' });
    expect(s.adapter.calls).toBe(0);
  });
  it('reserves the byte-bound estimate, or the whole per-request cap when the adapter\'s tokens are not bounded by bytes', async () => {
    const a = setup({ script: [mockToolAnswer([split('x')])] });
    const { jobId } = a.jobs.start(owner, a.pid, a.body);
    const input = a.store.getJob(jobId).input;
    expect(input.reservedCents).toBe(estimateCents(input.estimate.requestBytes, 2000, { input: 300, output: 1500 }));
    expect(input.reservationBasis).toBe('byte-bound estimate');
    expect(a.gov.ledgerFor(jobId)).toMatchObject({ reservedCents: input.reservedCents, state: 'reserved' });
    await a.jobs.done(jobId);
    const b = setup({ bytesBoundTokens: false, cap: 777, script: [mockToolAnswer([split('x')])] });
    const j2 = b.jobs.start(owner, b.pid, b.body).jobId;
    expect(b.gov.ledgerFor(j2)).toMatchObject({ reservedCents: 777 });
    await b.jobs.done(j2);
  });
  it('money is integer cents rounded up, never down', () => {
    expect(centsFor(1, 0, { input: 1, output: 1 })).toBe(1);
    expect(centsFor(1_000_000, 0, { input: 300, output: 1 })).toBe(300);
    expect(centsFor(1_000_001, 0, { input: 300, output: 1 })).toBe(301);
    expect(centsFor(0, 333_334, { input: 1, output: 3 })).toBe(2);
    expect(centsFor(0, 0, { input: 1, output: 1 })).toBe(0);
  });
});

describe('the call', () => {
  it('a valid answer → succeeded, one open proposal by agent:assistant, the revision unchanged, settled at the reported usage', async () => {
    const s = setup();
    s.adapter.queue(mockToolAnswer([split(s.videoClip)], 'MOCK: split at 2 s', { inputTokens: 40_000, outputTokens: 120 }));
    const before = s.store.getProject(s.pid).revision;
    const { jobId } = s.jobs.start(owner, s.pid, s.body);
    expect(s.store.getJob(jobId)).toMatchObject({ status: 'queued', actor: ASSISTANT_ACTOR, attempt: 0 });
    await s.jobs.done(jobId);
    const job = s.store.getJob(jobId);
    expect(job.status).toBe('succeeded');
    const cost = centsFor(40_000, 120, { input: 300, output: 1500 });
    expect(job.output).toMatchObject({ explanation: 'MOCK: split at 2 s', opsCount: 1, costCents: cost, costBasis: 'reported' });
    const pr = s.gov.getProposal(job.output.proposalId);
    expect(pr).toMatchObject({ status: 'open', actor: ASSISTANT_ACTOR, baseRevision: before, label: 'Language assistant proposal' });
    expect(pr.ops).toEqual([split(s.videoClip)]);
    expect(s.store.getProject(s.pid).revision).toBe(before);
    expect(s.gov.ledgerFor(jobId)).toMatchObject({ state: 'settled', actualCents: cost });
    expect(s.adapter.calls).toBe(1);
    // what was handed to the adapter: the job id as idempotency key, temperature 0, and none of the planted private values
    const sent = s.adapter.requests[0]!;
    expect(sent.req).toMatchObject({ idempotencyKey: jobId, temperature: 0, model: 'mock-model' });
    expect(sent.cfg).toEqual({ adapter: s.adapter.id, host: HOST, model: 'mock-model' });
    // (the fixed system text and tool schema are the reviewed prompt; the word «בת» occurs inside ordinary Hebrew words there,
    // so the word choice is searched for in what carries project data: the user turn)
    const bytes = JSON.stringify(sent.req), userTurn = sent.req.messages.map((m) => m.content).join('\n');
    for (const v of [...PLANTED_PRIVATE.filter((x) => x !== PLANTED.formWord), PLANTED.personName, PLANTED.title, PLANTED.markerLabel, PLANTED.trackName, KEY]) expect(bytes, v).not.toContain(v);
    expect(userTurn).not.toContain(PLANTED.formWord);
    expect(userTurn).not.toMatch(/"(form|birthDate)":/);
    expect(userTurn).toContain(s.body.text);
    // the job row keeps no request text
    expect(JSON.stringify(job)).not.toContain(s.body.text);
    // the owner's accept is one owner transaction
    const accepted = s.gov.decide(pr.id, 'accept', owner);
    expect(accepted.commit!.revision).toBe(before + 1);
  });
  it('no usage reported → settled at the reservation', async () => {
    const s = setup();
    s.adapter.queue(mockToolAnswer([split(s.videoClip)], 'x', null));
    const { jobId } = s.jobs.start(owner, s.pid, s.body);
    await s.jobs.done(jobId);
    const job = s.store.getJob(jobId);
    expect(job.output).toMatchObject({ costBasis: 'reserved', costCents: job.input.reservedCents });
    expect(s.gov.ledgerFor(jobId)).toMatchObject({ state: 'settled', actualCents: job.input.reservedCents });
  });
  it('unknown_after_send → submission-unknown, the ledger stays unknown, one call only (no retry)', async () => {
    const s = setup({ script: [{ throw: new ChatProviderError('unknown_after_send', false, `timeout after send (key ${KEY})`) }, mockToolAnswer([split('x')])] });
    const { jobId } = s.jobs.start(owner, s.pid, s.body);
    await s.jobs.done(jobId);
    await new Promise((r) => setTimeout(r, 30));
    const job = s.store.getJob(jobId);
    expect(job.status).toBe('submission-unknown');
    expect(job.error).toMatchObject({ code: 'submission_unknown', retryable: false });
    expect(JSON.stringify(job)).not.toContain(KEY);
    expect(JSON.stringify(job)).toContain('[redacted]');
    expect(s.gov.ledgerFor(jobId)!.state).toBe('unknown');
    expect(s.adapter.calls).toBe(1);
    expect(s.proposals()).toBe(0);
  });
  it('a failure the adapter does not classify is treated as unknown too; unreachable_before_send releases the money', async () => {
    const a = setup({ script: [{ throw: new Error('socket hang up') }] });
    const j1 = a.jobs.start(owner, a.pid, a.body).jobId;
    await a.jobs.done(j1);
    expect(a.store.getJob(j1).status).toBe('submission-unknown');
    const b = setup({ script: [{ throw: new ChatProviderError('unreachable_before_send', true, 'dns') }] });
    const j2 = b.jobs.start(owner, b.pid, b.body).jobId;
    await b.jobs.done(j2);
    expect(b.store.getJob(j2)).toMatchObject({ status: 'failed', error: { code: 'provider_error' } });
    expect(b.gov.ledgerFor(j2)!.state).toBe('released');
    const c = setup({ script: [{ throw: new ChatProviderError('unauthorized', false, `401 for ${KEY}`) }] });
    const j3 = c.jobs.start(owner, c.pid, c.body).jobId;
    await c.jobs.done(j3);
    expect(c.store.getJob(j3)).toMatchObject({ status: 'failed', error: { code: 'provider_error', providerCode: 'unauthorized' } });
    expect(JSON.stringify(c.store.getJob(j3))).not.toContain(KEY);
  });
  it('cancel before the send → canceled, the reservation released, nothing sent', async () => {
    const s = setup({ script: [mockToolAnswer([split('x')])] });
    const { jobId } = s.jobs.start(owner, s.pid, s.body);
    expect(s.jobs.cancel(jobId, 'user:local')).toMatchObject({ status: 'canceled', outcome: 'removed-from-queue' });
    await s.jobs.done(jobId);
    expect(s.store.getJob(jobId)).toMatchObject({ status: 'canceled', attempt: 0 });
    expect(s.gov.ledgerFor(jobId)!.state).toBe('released');
    expect(s.adapter.calls).toBe(0);
  });
  it('cancel while waiting for the service → canceled after the send; the reservation stays counted as unknown', async () => {
    let started!: () => void;
    const sentNow = new Promise<void>((r) => { started = r; });
    const s = setup({ script: [{ wait: (signal) => new Promise((_res, rej) => { started(); signal.addEventListener('abort', () => rej(new Error('aborted'))); }) }] });
    const { jobId } = s.jobs.start(owner, s.pid, s.body);
    await sentNow;
    expect(s.store.getJob(jobId)).toMatchObject({ status: 'running', stage: 'awaiting-provider' });
    expect(s.jobs.cancel(jobId, 'user:local')).toMatchObject({ outcome: 'requested' });
    await s.jobs.done(jobId);
    expect(s.store.getJob(jobId)).toMatchObject({ status: 'canceled', attempt: 1 });
    expect(s.gov.ledgerFor(jobId)!.state).toBe('unknown');
  });
  it('each of the nine invalid answers → invalid_model_output and no proposal row', async () => {
    for (const c of invalidMockAnswers('clp_x')) {
      const s = setup({ script: [c.step] });
      const { jobId } = s.jobs.start(owner, s.pid, s.body);
      await s.jobs.done(jobId);
      const job = s.store.getJob(jobId);
      expect(job.status, c.name).toBe('failed');
      expect(job.error.code, c.name).toBe('invalid_model_output');
      expect(job.error.message, c.name).toMatch(c.reason);
      expect(s.proposals(), c.name).toBe(0);
      expect(s.gov.ledgerFor(jobId)!.state, c.name).toBe('settled'); // the service answered: the cost is known
    }
  });
  it('an answer Governance.propose refuses (an op on a clip that does not exist) → invalid_model_output, no proposal', async () => {
    const s = setup({ script: [mockToolAnswer([split('clp_does_not_exist')])] });
    const { jobId } = s.jobs.start(owner, s.pid, s.body);
    await s.jobs.done(jobId);
    expect(s.store.getJob(jobId)).toMatchObject({ status: 'failed', error: { code: 'invalid_model_output' } });
    expect(s.proposals()).toBe(0);
  });
  it('agents paused while the answer was on its way → refused (agent_paused), no proposal', async () => {
    let s!: ReturnType<typeof setup>;
    s = setup({ script: [{ wait: async () => { s.gov.setPaused(s.pid, true, owner); return { toolInput: { ops: [split(s.videoClip)] }, text: null, finish: 'tool', usage: null }; } }] });
    const { jobId } = s.jobs.start(owner, s.pid, s.body);
    await s.jobs.done(jobId);
    expect(s.store.getJob(jobId)).toMatchObject({ status: 'failed', error: { code: 'agent_paused' } });
    expect(s.proposals()).toBe(0);
  });
});

describe('restart recovery', () => {
  it('a job left queued is failed submission_unknown with its reservation released; one left after the send keeps it as unknown; nothing is retried', () => {
    const s = setup();
    const p = { actor: ASSISTANT_ACTOR, kind: 'agent', scopes: ['observe'], mode: 'propose', grant: { id: 'assistant', name: 'assistant', mode: 'propose', projectIds: [s.pid], trackIds: null, range: null, budgetCents: 100, requestsPerMinute: null, exportsPerDay: null, people: 'names', expiresAt: null, revokedAt: null, createdAt: '', createdBy: 'user:local' } } as Principal;
    const queued = s.store.createJob(s.pid, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, {}).id;
    const sent = s.store.createJob(s.pid, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, {}).id;
    for (const j of [queued, sent]) s.gov.reserveAssistant(p, s.pid, j, 5, { monthlyLimitCents: 100, perRequestCapCents: 10 });
    s.store.updateJob(sent, { status: 'running', stage: 'awaiting-provider', attempt: 1 });
    const out = recoverAssistantJobs(s.store, s.gov);
    expect(out.map((j) => j.id).sort()).toEqual([queued, sent].sort());
    expect(s.store.getJob(queued)).toMatchObject({ status: 'failed', error: { code: 'submission_unknown', retryable: false } });
    expect(s.gov.ledgerFor(queued)!.state).toBe('released');
    expect(s.store.getJob(sent)).toMatchObject({ status: 'failed', error: { code: 'submission_unknown', retryable: false } });
    expect(s.gov.ledgerFor(sent)!.state).toBe('unknown');
    expect(s.adapter.calls).toBe(0);
    expect(recoverAssistantJobs(s.store, s.gov)).toEqual([]);
  });
  it('leaves alone a job this process is still driving', async () => {
    let release!: () => void;
    const s = setup({ script: [{ wait: () => new Promise((r) => { release = () => r({ toolInput: { ops: [split(s.videoClip)] }, text: null, finish: 'tool', usage: null }); }) }] });
    const { jobId } = s.jobs.start(owner, s.pid, s.body);
    expect(recoverAssistantJobs(s.store, s.gov)).toEqual([]);
    await new Promise((r) => setTimeout(r, 20));
    release();
    await s.jobs.done(jobId);
    expect(s.store.getJob(jobId).status).toBe('succeeded');
  });
});

describe('the ledger refusals say what to do next', () => {
  it('reserveAssistant and settleAssistant refusals carry a hint', () => {
    const s = setup();
    const j = s.store.createJob(s.pid, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, {}).id;
    const limits = { monthlyLimitCents: 100, perRequestCapCents: 10 };
    const p = { actor: ASSISTANT_ACTOR, kind: 'agent', scopes: ['observe'], mode: 'propose', grant: { id: 'assistant', name: 'assistant', mode: 'propose', projectIds: [s.pid], trackIds: null, range: null, budgetCents: 100, requestsPerMinute: null, exportsPerDay: null, people: 'names', expiresAt: null, revokedAt: null, createdAt: '', createdBy: 'user:local' } } as Principal;
    for (const r of [refusal(() => s.gov.reserveAssistant(owner, s.pid, j, 5, limits)), refusal(() => s.gov.reserveAssistant(p, s.pid, j, 0, limits)), refusal(() => s.gov.reserveAssistant(p, s.pid, j, 11, limits)), refusal(() => s.gov.settleAssistant(j, -1))])
      expect(r.hint, r.code).toBeTruthy();
  });
});
