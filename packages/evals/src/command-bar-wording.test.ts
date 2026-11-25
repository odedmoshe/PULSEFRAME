/**
 * The shared wording of the Hebrew command bar and its assistant (ADR-0027; packages/i18n/src/commandBar.ts): every code of
 * the contract has words in both languages, the Hebrew is Hebrew, numbers sit in an isolate, the decided sentences are exact,
 * and nothing claims the assistant is connected or that a model answered (wave 1 has no network adapter).
 */
import { describe, expect, it } from 'vitest';
import { ASSISTANT_ERROR_CODES, ASSISTANT_NEVER_SENT, ASSISTANT_SETUP_CODES, ASSISTANT_STAGES, BAR_REFUSAL_CODES } from '@pulseframe/core';
import { dictionaries } from '../../i18n/src/index.ts';
import { COMMAND_BAR_EN, COMMAND_BAR_HE } from '../../i18n/src/commandBar.ts';

const he = dictionaries.he as Record<string, string>, en = dictionaries.en as Record<string, string>;
const HEBREW = /[א-ת]/;
describe('command bar wording (ADR-0027)', () => {
  it('every refusal, setup state, stage, never-sent item and error code has words in both languages', () => {
    const keys = [
      ...BAR_REFUSAL_CODES.map((c) => `bar.refusal.${c}`), ...ASSISTANT_SETUP_CODES.map((c) => `assistant.setup.${c}`), ...ASSISTANT_STAGES.map((s) => `assistant.stage.${s}`),
      ...ASSISTANT_NEVER_SENT.map((n) => `assistant.never.${n}`), ...ASSISTANT_ERROR_CODES.map((c) => `error.code.${c}`),
    ];
    for (const k of keys) {
      expect(he[k]?.trim(), k).toBeTruthy();
      expect(en[k]?.trim(), k).toBeTruthy();
      expect(HEBREW.test(he[k]!), k).toBe(true);
      expect(HEBREW.test(en[k]!), k).toBe(false);
    }
  });
  it('the two dictionaries of this module cover the same keys and reach the shared dictionaries', () => {
    expect(Object.keys(COMMAND_BAR_EN).sort()).toEqual(Object.keys(COMMAND_BAR_HE).sort());
    for (const k of Object.keys(COMMAND_BAR_HE)) { expect(he[k], k).toBe((COMMAND_BAR_HE as Record<string, string>)[k]); expect(en[k], k).toBe((COMMAND_BAR_EN as Record<string, string>)[k]); }
  });
  it('keeps the decided sentences exact', () => {
    expect(he['assistant.notConnected']).toBe('עוזר השפה לא מחובר');
    expect(he['assistant.setup.provider_not_configured']).toBe('עוזר השפה לא מחובר');
    expect(he['assistant.howToConnect']).toBe('איך מחברים');
    expect(he['bar.projectChanged']).toBe('הפרויקט השתנה — בדקו שוב');
    expect(he['assistant.toggle.titlesAndMarkers']).toBe('לשלוח נוסח כותרות וסמנים');
    expect(he['assistant.toggle.peopleNames']).toBe('לשלוח שמות אנשים');
    expect(he['bar.refusal.half_frame']!.startsWith('פריים הוא היחידה הקטנה ביותר; ')).toBe(true);
  });
  it('every bar refusal pairs the reason with the next step, in both languages (house rule)', () => {
    for (const c of BAR_REFUSAL_CODES) {
      for (const [lang, d] of [['he', he], ['en', en]] as const) {
        const v = d[`bar.refusal.${c}`]!;
        const [reason, next, ...rest] = v.split('; ');
        expect(rest.length, `${lang} ${c}: one reason, one next step: ${v}`).toBe(0);
        expect(reason?.trim().length, `${lang} ${c}: reason`).toBeGreaterThan(3);
        expect(next?.trim().length ?? 0, `${lang} ${c}: next step missing: ${v}`).toBeGreaterThan(3);
      }
    }
  });
  it('numbers in Hebrew sentences are isolated left to right', () => {
    for (const [k, v] of Object.entries(COMMAND_BAR_HE)) for (const m of v.matchAll(/\d+/g)) expect(v.slice(0, m.index).endsWith('⁦') || /⁦[^⁩]*$/.test(v.slice(0, m.index)), `${k}: ${v}`).toBe(true);
  });
  it('never says the assistant is connected or that a model answered', () => {
    for (const [k, v] of Object.entries(COMMAND_BAR_HE)) expect(/(?<!לא )מחובר/.test(v), `${k}: ${v}`).toBe(false);
    for (const [k, v] of Object.entries(COMMAND_BAR_EN)) expect(/(?<!not )\bconnected\b/i.test(v), `${k}: ${v}`).toBe(false);
  });
});

// ---- the assistant's server refusals, PROVOKED through the server's own code, in Hebrew with the next step ----
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';
import { ASSISTANT_ACTOR, ASSISTANT_JOB_TYPE, AssistantConfigBodySchema } from '@pulseframe/core';
import { ChatProviderError } from '@pulseframe/providers';
import { ASSISTANT_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';
import { ASSISTANT_EXTRA_ERROR_CODES } from '../../i18n/src/commandBar.ts';
import { loadConfig } from '../../../apps/server/src/config.ts';
import { Governance, type Principal } from '../../../apps/server/src/governance.ts';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { plantedProject } from '../../../apps/server/src/assistant/assistantFixture.ts';
import { AssistantFiles, normalizeHost } from '../../../apps/server/src/assistant/credential.ts';
import { AssistantJobs, recoverAssistantJobs } from '../../../apps/server/src/assistant/job.ts';
import { createAssistantHandlers } from '../../../apps/server/src/assistant/routes.ts';
import { TestChatAdapter, type MockStep } from '../../../apps/server/src/assistant/testAdapter.ts';

describe('error headlines of the assistant\'s other codes (lead decision: they mean the right thing)', () => {
  it('each has a headline in both languages; host_not_allowed no longer speaks of model files', () => {
    for (const c of ASSISTANT_EXTRA_ERROR_CODES) {
      const k = `error.code.${c}`;
      expect(he[k]?.trim(), k).toBeTruthy();
      expect(en[k]?.trim(), k).toBeTruthy();
      expect(HEBREW.test(he[k]!), k).toBe(true);
      expect(HEBREW.test(en[k]!), k).toBe(false);
    }
    expect(he['error.code.host_not_allowed']).not.toMatch(/מודל/);
    expect(en['error.code.host_not_allowed']).not.toMatch(/model/i);
    expect(he['error.code.summary_too_large']).toMatch(/ארוך מדי/);
    expect(he['error.code.budget_exceeded']).toMatch(/מגבלת ההוצאה/);
    expect(he['error.code.owner_required']).toMatch(/לבעלים/);
    expect(he['error.code.submission_unknown']).toMatch(/לא ידוע/);
    expect(he['error.code.assistant_not_connected']).toBe('עוזר השפה לא מחובר');
  });
});

describe('every refusal the assistant\'s server code gives is worded in Hebrew, reason then next step (provoked for real)', () => {
  const KEY = 'TEST-DOUBLE-NOT-A-KEY-wording-0c4a';
  const HOST = 'api.example.test';
  const dirs: string[] = [], stores: Store[] = [];
  afterAll(() => { for (const s of stores) s.close(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
  const agent: Principal = { actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] };
  function setup(opts: { configure?: boolean; script?: MockStep[]; bytesBound?: boolean; cap?: number; monthly?: number } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-cbw-'));
    dirs.push(dir);
    const store = new Store(dir);
    stores.push(store);
    const gov = new Governance(store);
    const cfg = { ...loadConfig({}), dataDir: dir, assistantHosts: [HOST] };
    const adapter = new TestChatAdapter({ script: opts.script ?? [], bytesBoundTokens: opts.bytesBound ?? true });
    const files = new AssistantFiles(dir, cfg.assistantHosts);
    if (opts.configure !== false) {
      files.writeConfig({ adapter: adapter.id, host: HOST, model: 'mock-model', pricesCentsPerMTok: { input: 300, output: 1500 }, monthlyLimitCents: opts.monthly ?? 100_000, perRequestCapCents: opts.cap ?? 10_000, toggles: { titlesAndMarkers: false, peopleNames: false } });
      files.writeKey(KEY);
    }
    const fx = plantedProject(store);
    const jobs = new AssistantJobs({ cfg, store, gov, deps: { adapters: new Map([[adapter.id, adapter]]), endpoint: () => null }, files });
    const handlers = createAssistantHandlers({ cfg, store, gov, deps: { adapters: new Map([[adapter.id, adapter]]), endpoint: () => null } });
    const assistant = { actor: ASSISTANT_ACTOR, kind: 'agent', scopes: ['observe'], mode: 'propose', grant: { id: 'assistant', name: 'assistant', mode: 'propose', projectIds: [fx.pid], trackIds: null, range: null, budgetCents: 100, requestsPerMinute: null, exportsPerDay: null, people: 'names', expiresAt: null, revokedAt: null, createdAt: '', createdBy: 'user:local' } } as Principal;
    return { store, gov, jobs, handlers, assistant, pid: fx.pid, body: { text: 'חתוך כאן', selection: [] as string[], playheadFrame: 0 } };
  }
  const thrown = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof ApiError || e instanceof Error) return e.message; } throw new Error('not refused'); };
  const jobError = async (s: ReturnType<typeof setup>, cancel = false): Promise<string> => {
    const { jobId } = s.jobs.start(owner, s.pid, s.body);
    if (cancel) s.jobs.cancel(jobId, 'user:local');
    await s.jobs.done(jobId);
    return (s.store.getJob(jobId).error as { message: string }).message;
  };
  const hang = (onSent: () => void = () => {}): MockStep => ({ wait: (signal) => new Promise((_r, rej) => { onSent(); signal.addEventListener('abort', () => rej(new Error('MOCK: aborted'))); }) });

  it('provokes each one and words it by an assistant pattern, with a next step after «; »', async () => {
    const said: [string, string][] = [];
    // credentials and config (credential.ts, the config schema)
    said.push(['https only', thrown(() => normalizeHost('http://api.example.test', [HOST]))]);
    said.push(['host not listed', thrown(() => normalizeHost('evil.example.test', [HOST]))]);
    const zero = AssistantConfigBodySchema.safeParse({ adapter: null, host: null, model: null, pricesCentsPerMTok: { input: 0, output: 5 }, monthlyLimitCents: 0, perRequestCapCents: 0, toggles: { titlesAndMarkers: false, peopleNames: false } });
    said.push(['price 0', zero.success ? 'accepted' : zero.error.issues.map((i) => i.message).join('; ')]);
    // owner only (routes.ts)
    const s0 = setup();
    said.push(['owner only', thrown(() => s0.handlers.putKey(agent, KEY))]);
    // the ledger (governance.ts reserveAssistant)
    const j = () => s0.store.createJob(s0.pid, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, {}).id;
    // cancelling a request is the owner's too (routes.ts assistantCancelRefusal: what POST /jobs/:jobId/cancel and MCP cancel_job answer an agent)
    said.push(['cancel by an agent', thrown(() => s0.handlers.cancel(agent, j()))]);
    // releasing a held amount is the owner's too (visibility.ts budgetReleaseRefusal; governance.ts releaseUnknown)
    said.push(['release by an agent', thrown(() => s0.gov.releaseUnknown(agent, j()))]);
    said.push(['nothing to release', thrown(() => s0.gov.releaseUnknown(owner, j()))]);
    said.push(['limits missing', thrown(() => s0.gov.reserveAssistant(s0.assistant, s0.pid, j(), 5, { monthlyLimitCents: 0, perRequestCapCents: 0 }))]);
    said.push(['over the cap', thrown(() => s0.gov.reserveAssistant(s0.assistant, s0.pid, j(), 11, { monthlyLimitCents: 100, perRequestCapCents: 10 }))]);
    s0.gov.reserveAssistant(s0.assistant, s0.pid, j(), 10, { monthlyLimitCents: 15, perRequestCapCents: 10 });
    said.push(['over the month', thrown(() => s0.gov.reserveAssistant(s0.assistant, s0.pid, j(), 10, { monthlyLimitCents: 15, perRequestCapCents: 10 }))]);
    // the job's start (job.ts)
    said.push(['not set up', thrown(() => setup({ configure: false }).jobs.start(owner, s0.pid, s0.body))]);
    const sx = setup({ bytesBound: false, cap: 1 });
    said.push(['estimate over the cap', thrown(() => sx.jobs.start(owner, sx.pid, sx.body))]);
    const sp = setup();
    sp.gov.setPaused(sp.pid, true, owner);
    said.push(['paused at start', thrown(() => sp.jobs.start(owner, sp.pid, sp.body))]);
    // the job's run (job.ts): each ends without a proposal
    said.push(['unreachable', await jobError(setup({ script: [{ throw: new ChatProviderError('unreachable_before_send', true, 'MOCK: no route') }] }))]);
    said.push(['refused by the service', await jobError(setup({ script: [{ throw: new ChatProviderError('unauthorized', false, 'MOCK: bad key') }] }))]);
    said.push(['unknown after send', await jobError(setup({ script: [{ throw: new ChatProviderError('unknown_after_send', false, 'MOCK: timeout') }] }))]);
    said.push(['canceled before the send', await jobError(setup({ script: [] }), true)]);
    {
      let sent!: () => void;
      const now = new Promise<void>((r) => { sent = r; });
      const s = setup({ script: [hang(() => sent())] });
      const { jobId } = s.jobs.start(owner, s.pid, s.body);
      await now;
      s.jobs.cancel(jobId, 'user:local');
      await s.jobs.done(jobId);
      said.push(['canceled while with the service', (s.store.getJob(jobId).error as { message: string }).message]);
    }
    // restart recovery (job.ts recoverAssistantJobs): the three outcomes
    {
      const s = setup();
      const queued = s.store.createJob(s.pid, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, {}).id;
      const waiting = s.store.createJob(s.pid, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, {}).id;
      const checking = s.store.createJob(s.pid, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, {}).id;
      for (const id of [queued, waiting, checking]) s.gov.reserveAssistant(s.assistant, s.pid, id, 5, { monthlyLimitCents: 100, perRequestCapCents: 10 });
      s.store.updateJob(waiting, { status: 'running', stage: 'awaiting-provider', attempt: 1 });
      s.gov.settleAssistant(checking, 3);
      s.store.updateJob(checking, { status: 'running', stage: 'checking', attempt: 1 });
      recoverAssistantJobs(s.store, s.gov);
      for (const [name, id] of [['restart before the send', queued], ['restart while waiting', waiting], ['restart while checking', checking]] as const) said.push([name, (s.store.getJob(id).error as { message: string }).message]);
    }

    expect(said.length).toBe(21);
    const used = new Set<number>();
    for (const [name, message] of said) {
      const h = translateRefusal('he', message);
      expect(h, `${name}: «${message}» has no Hebrew wording`).toBeTruthy();
      expect(HEBREW.test(h!), name).toBe(true);
      const idx = ASSISTANT_REFUSAL_PATTERNS.findIndex((re) => re.test(message));
      expect(idx, `${name}: worded by an assistant pattern`).toBeGreaterThanOrEqual(0);
      used.add(idx);
      const [reason, next, ...rest] = h!.split('; ');
      expect(rest.length, `${name}: one reason, one next step: ${h}`).toBe(0);
      expect(reason!.trim().length, name).toBeGreaterThan(3);
      expect(next?.trim().length ?? 0, `${name}: next step missing: ${h}`).toBeGreaterThan(3);
      expect(h, name).not.toContain(KEY);
    }
    // the patterns not provoked here: the summary route's playhead (http.ts; provoked in routes.test.ts), the 32 KB summary,
    // the adapter or key going away mid-job, the canceled-after-answer race, and the answer that came back while paused
    expect(ASSISTANT_REFUSAL_PATTERNS.length - used.size).toBeLessThanOrEqual(6);
  });
  it('the sentences the server builds elsewhere are worded too (their words are copied from the server code it checks)', () => {
    const src = (f: string) => fs.readFileSync(new URL(`../../../apps/server/src/${f}`, import.meta.url), 'utf8');
    const samples: [string, string][] = [
      ['http.ts', 'playheadFrame is a whole, non-negative frame index'],
      ['assistant/job.ts', 'the adapter or the key went away before the request was sent; nothing was sent'],
      ['assistant/job.ts', 'canceled; the answer that arrived was discarded'],
      ['assistant/job.ts', 'canceled; the service was not reached, nothing was sent'],
      ['assistant/job.ts', 'the owner paused agents on this project while the answer was on its way; no proposal was made'],
    ];
    for (const [file, message] of samples) {
      expect(src(file), `${file} still says «${message}»`).toContain(message);
      const h = translateRefusal('he', message);
      expect(h, message).toBeTruthy();
      expect(h!.split('; ').length, h).toBe(2);
    }
    expect(src('assistant/summary.ts')).toContain('the selection and the tracks alone take more than ${SUMMARY_MAX_BYTES} bytes to describe');
    expect(translateRefusal('he', 'the selection and the tracks alone take more than 32768 bytes to describe')).toMatch(/32768/);
  });
});
