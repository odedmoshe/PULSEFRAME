/**
 * The LOCAL assistant's server contract (wave 7; .artifacts/wave7/assistant-decisions.md §4–§5): owner-only routes answering an honest
 * 501 until builder B, the visibility rules REUSED for local jobs and the local status (no new code: the same job type and the same
 * status function), the production wiring, and builder B's rows.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ASSISTANT_ACTOR, ASSISTANT_JOB_TYPE, ASSISTANT_PUBLIC_STATUS_KEYS, type AssistantLocalOutput, type AssistantStatus } from '@pulseframe/core';
import { loadConfig } from './config.ts';
import { Governance, type Principal } from './governance.ts';
import { ApiError, Store } from './store.ts';
import { ASSISTANT_LOCAL_LANE_LABEL, ASSISTANT_LOCAL_SENTENCES, ASSISTANT_ROUTES } from './assistant/contract.ts';
import { createAssistantHandlers } from './assistant/routes.ts';
import { assistantJobStub, assistantStatusFor } from './assistant/visibility.ts';
import { LLAMA_ADAPTER_BUILT, LLAMA_ADAPTER_ID } from './assistant/local/llamaAdapter.ts';

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
  it('refuse every agent with 403 owner_required, and answer the owner an honest 501 until built', async () => {
    const h = handlers();
    for (const p of agents) {
      expect(await codeOf(() => h.localCheck(p))).toEqual({ status: 403, code: 'owner_required' });
      expect(await codeOf(() => h.taken(p, 'job_x'))).toEqual({ status: 403, code: 'owner_required' });
    }
    expect(await codeOf(() => h.localCheck(owner))).toEqual({ status: 501, code: 'not_built' });
    expect(await codeOf(() => h.taken(owner, 'job_x'))).toEqual({ status: 501, code: 'not_built' });
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
  it('is not built yet', () => { expect(LLAMA_ADAPTER_BUILT).toBe(false); });
  it.todo('start(): with the local adapter chosen no price, host, model or key is read, no summary is built, estimateCents and reserveAssistant are not called; Pause Agent still refuses 423; the intent row has profile local, the text sha and chars, the local digest, the port and no text');
  it.todo('start(): a text barUnderstands reads is refused 409 grammar_understood with no job row and no call of the adapter; a text over ASSISTANT_LOCAL_TEXT_MAX is refused 400');
  it.todo('run(): takes the lane as ASSISTANT_LOCAL_LANE_LABEL (stage waiting-for-compute while another holder runs) and releases it on success, failure, cancel and adapter error (lane.busy().holder null after each)');
  it.todo('run(): the MOCK adapter receives buildLocalRequest(text) exactly (no project data, no key) and a gain_change answer becomes an AssistantLocalOutput with the rendered phrase; intent none succeeds with phrase null');
  it.todo('run(): LocalModelError not_running / loading / timeout / not_loopback / server_error fail with local_* codes and ASSISTANT_LOCAL_SENTENCES; never submission-unknown; no money word; no budget_ledger row at any point');
  it.todo('cancel() and recoverAssistantJobs: a local job uses canceled_unsent / canceled_sent / recovered and touches no ledger');
  it.todo('taken: owner only; clears phrase and slots.text by direct SQL inside Store.erasing (cleared true); 404 unknown job, 409 not a local job; the next request on the project and project delete clear too; the planted text is absent from the database file afterwards');
  it.todo('llamaAdapter: dials only localModelUrl; aborts before writing a byte when isLoopbackRemote(socket.remoteAddress) is false; sends no Authorization or cookie header; caps the reply at 64 KiB; maps ECONNREFUSED, 503, the time limit, other statuses and the signal to the LocalModelError codes; logs nothing');
  it.todo('status: the owner reads local { port, timeoutSeconds, lastCheck }; setup comes from localBlockers when the adapter is local-llama-server (installed = deps.local present)');
  it.todo('wording: each local sentence is PROVOKED from the job and routes (not running, loading, timeout, not loopback, server error, both cancels, recovery, each invalid category, grammar_understood) and equals ASSISTANT_LOCAL_SENTENCES (in local/local.test.ts)');
  it.todo('jobPrivacy.test.ts and statusPrivacy.test.ts walk every REST route, MCP tool, resource and the event stream with a planted local phrase, text slot, port and model name for the seven credentials');
});
