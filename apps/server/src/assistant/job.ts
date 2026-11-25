/**
 * The durable job `assistant.propose` (ADR-0027, plan §7.4): one owner request → at most ONE call of the owner's chosen
 * adapter → at most one open PROPOSAL, which the owner accepts or rejects (Governance.decide). The model never commits.
 *
 * Before any job exists (refusals that leave no row): the setup is not ready → 409 assistant_not_connected with the setup
 * state; agents paused on the project → 423 agent_paused. Then, in this order, each step durable before the next:
 *  1. intent (queued): revision, the summary's and the text's sha256 and sizes (never the text: the job row is readable by
 *     any observer of the project, and the request may name a child), the prompt digest, adapter, host, model,
 *     maxOutputTokens, the byte bound and the reservation in cents;
 *  2. reserve: Governance.reserveAssistant, atomic against the monthly limit and the per-request cap (402 budget_exceeded,
 *     the job is closed as failed, nothing is sent). The amount is the byte-bound estimate
 *     ceil((B·pIn + maxOut·pOut) / 1e6) when the adapter declares bytesBoundTokens, else the whole per-request cap
 *     (and then a request whose estimate is above the cap is refused with 402 before the reservation);
 *  3. submit (running; stage sending, then awaiting-provider) with the cancel's abort signal and the job id as the
 *     idempotency key. `unknown_after_send`, or any failure the adapter does not classify, after the call started →
 *     submission-unknown: the ledger stays unknown (counted) and NOTHING is retried (SPEC §20);
 *  4. check (stage checking): settle at the reported usage at the owner's prices, else at the reservation; then
 *     checkModelAnswer, then Governance.propose as the in-memory assistantPrincipal (it parses every op again, refuses people
 *     details, dry-runs on the names-only document and refuses when paused). Any failure → failed invalid_model_output
 *     with the first reason (its category and a fixed sentence: the answer's own words are not stored), and no proposal;
 *  5. succeeded with AssistantJobOutput. Its explanation, the model's sentence, lives in the row only while the proposal can
 *     still be decided: Governance.decide clears it with the decision (accepted, rejected or stale), in one transaction.
 * Stages are words (never a percentage). Cancel before the send → canceled with attempt 0 → the ledger is released.
 *
 * THE LOCAL BRANCH (wave 7; .artifacts/wave7/assistant-decisions.md §2 V3/V4/P15/P17, §4), taken when the owner chose the adapter
 * `local-llama-server`. No money: no price, host, model or key is read, no summary is built, estimateCents and reserveAssistant are
 * not called, no budget_ledger row is written, and no failure is ever submission-unknown (nothing leaves the machine). Before any job:
 * setup (localBlockers) → 409 assistant_not_connected; a text over ASSISTANT_LOCAL_TEXT_MAX → 400; a text the grammar reads itself
 * (barUnderstands) → 409 grammar_understood, nothing sent; Pause Agent → 423 (assertMayAct as the in-memory assistantPrincipal). The
 * intent row keeps profile 'local', the text's sha256 and length (never the text), the local prompt digest, the adapter, the port, the
 * time limit and the phrase language. Then: the compute lane is taken (stage waiting-for-compute while another holder has it) and
 * released in a `finally`; running, stage sending then awaiting-local-model, one call of the loopback adapter with the owner's time
 * limit; stage checking: local/check.ts (the schema, the decimal rule, quotes and control characters), grounding and one bar phrase;
 * succeeded with AssistantLocalOutput. The server commits nothing and proposes nothing: the owner's tab reads the phrase with the
 * grammar, shows its preview, and Enter commits one transaction (ADR-0027 unchanged). The phrase and the text slot can repeat what the
 * owner typed: they leave the row (direct SQL inside Store.erasing) on `taken`, on the next local request of the project, and with
 * the project. Every failure is a local_* code with its fixed sentence (contract.ts ASSISTANT_LOCAL_SENTENCES), never a stack.
 */
import { createHash } from 'node:crypto';
import {
  ASSISTANT_ACTOR, ASSISTANT_ESTIMATE_OVERHEAD_BYTES, ASSISTANT_JOB_TYPE, ASSISTANT_LOCAL_ADAPTER_ID, ASSISTANT_LOCAL_PROFILE, ASSISTANT_LOCAL_TEXT_MAX,
  ASSISTANT_MAX_OUTPUT_TOKENS, barUnderstands, LOCAL_INTENT_BUILT,
  type AssistantConfigBody, type AssistantJobOutput, type AssistantLocalOutput, type AssistantRequestBody, type AssistantSetup,
} from '@pulseframe/core';
import {
  ASSISTANT_CAPABILITY, ASSISTANT_LOCAL_CAPABILITY, ChatProviderError, chatBlockers, localBlockers, LocalModelError,
  type ChatBlocker, type ChatEndpoint, type ChatResponse, type LocalChatResponse, type LocalErrorCode,
} from '@pulseframe/providers';
import type { Config } from '../config.ts';
import type { Governance, Principal } from '../governance.ts';
import { ApiError, type JobRow, type Store } from '../store.ts';
import { ASSISTANT_LOCAL_LANE_LABEL, ASSISTANT_LOCAL_SENTENCES, assistantPrincipal, type AssistantDeps } from './contract.ts';
import { redact, type AssistantFiles } from './credential.ts';
import { assistantPrompt, buildChatRequest, requestBytes } from './prompt.ts';
import { assistantSummary } from './summary.ts';
import { checkModelAnswer, type InvalidAnswerCategory } from './validate.ts';
import { buildLocalRequest, localPrompt } from './localPrompt.ts';
import { checkLocalAnswer } from './local/check.ts';

export interface AssistantRuntime { cfg: Config; store: Store; gov: Governance; deps: AssistantDeps; files: AssistantFiles }
/** The label of every assistant proposal: fixed words, never the owner's typed text. */
export const ASSISTANT_PROPOSAL_LABEL = 'Language assistant proposal';

const sha = (s: string) => `sha256:${createHash('sha256').update(s, 'utf8').digest('hex')}`;
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

// ---------- money: exact integer arithmetic, rounded against the owner (up) ----------
/** A price in cents per million tokens as an integer of micro-cents, rounded UP. */
const micro = (price: number) => BigInt(Math.ceil(price * 1_000_000));
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
/** ceil((tokensIn·pIn + tokensOut·pOut) / 1e6) cents, exactly (prices rounded up to a micro-cent first). */
export function centsFor(tokensIn: number, tokensOut: number, prices: { input: number; output: number }): number {
  return Number(ceilDiv(BigInt(tokensIn) * micro(prices.input) + BigInt(tokensOut) * micro(prices.output), 1_000_000_000_000n));
}
/** The byte-bound estimate of plan §7.4 step 2: B = the request's UTF-8 bytes + ASSISTANT_ESTIMATE_OVERHEAD_BYTES tokens in, maxOut out. */
export const estimateCents = (requestByteLength: number, maxOut: number, prices: { input: number; output: number }) => centsFor(requestByteLength + ASSISTANT_ESTIMATE_OVERHEAD_BYTES, maxOut, prices);

// ---------- the setup state ----------
export interface AssistantSetupState { config: AssistantConfigBody; problem: string | null; keySet: boolean; keyAddedAt: string | null; blockers: ChatBlocker[]; setup: AssistantSetup; detail: string; /** the owner chose the local adapter (wave 7) */ local: boolean }
/** Whether the owner's config chooses the local assistant (wave 7). */
export const isLocalConfig = (c: AssistantConfigBody): boolean => c.adapter === ASSISTANT_LOCAL_ADAPTER_ID;
export function assistantSetup(rt: AssistantRuntime): AssistantSetupState {
  const { config, problem } = rt.files.readConfig();
  const ks = rt.files.keyState();
  if (isLocalConfig(config)) {
    // wave 7: the local setup reads no price, limit, host, model or key; installed = whether this build has a local adapter (deps.local)
    const blockers = localBlockers(ASSISTANT_LOCAL_CAPABILITY, { adapter: config.adapter, installed: rt.deps.local ? ASSISTANT_LOCAL_ADAPTER_ID : null, local: config.local, promptDigest: localPrompt().digest });
    const setup = blockers[0]?.code ?? 'ready';
    return { config, problem, ...ks, blockers, setup, detail: [problem, ...blockers.map((b) => b.message)].filter(Boolean).join('; ') || 'ready', local: true };
  }
  const blockers = chatBlockers(ASSISTANT_CAPABILITY, {
    adapter: config.adapter, host: config.host, model: config.model, keySet: ks.keySet, pricesCentsPerMTok: config.pricesCentsPerMTok,
    monthlyLimitCents: config.monthlyLimitCents, perRequestCapCents: config.perRequestCapCents,
    adapters: [...rt.deps.adapters.keys()], allowedHosts: rt.cfg.assistantHosts, promptDigest: assistantPrompt().digest,
  });
  const setup = blockers[0]?.code ?? 'ready';
  return { config, problem, ...ks, blockers, setup, detail: [problem, ...blockers.map((b) => b.message)].filter(Boolean).join('; ') || 'ready', local: false };
}
/** The next step for each setup state (the house rule: a refusal says what to do). */
export const SETUP_HINT: Record<AssistantSetup, string> = {
  ready: 'The language assistant is set up.',
  provider_not_configured: 'This build has no network adapter, so the language assistant cannot be connected yet; the command bar works without it.',
  prices_missing: 'Type in the prices per million input and output tokens in Settings, under the language assistant.',
  limit_missing: 'Set both the monthly limit and the per-request cap in Settings, under the language assistant.',
  host_not_allowed: 'Add the service host to PF_ASSISTANT_HOSTS and restart the server, or choose a listed host.',
  prompt_digest_mismatch: 'The assistant\'s instructions changed since they were reviewed; nothing is sent until the new ones are reviewed.',
};

/** The next step for a local setup state (no money words: a local request costs nothing). */
export const LOCAL_SETUP_HINT: Partial<Record<AssistantSetup, string>> = {
  ready: 'The local language assistant is set up.',
  provider_not_configured: 'In Settings, under the language assistant, choose the model on this computer and save its port (8791 in the guide «עוזר שפה מקומי»).',
  prompt_digest_mismatch: 'The local assistant\'s instructions changed since they were reviewed; nothing is sent until the new ones are reviewed.',
};
const setupHint = (s: AssistantSetupState) => (s.local ? LOCAL_SETUP_HINT[s.setup] : undefined) ?? SETUP_HINT[s.setup];

/** A local job's row (its input holds profile 'local'). */
export const isLocalJob = (j: Pick<JobRow, 'type' | 'input'>): boolean => j.type === ASSISTANT_JOB_TYPE && (j.input as { profile?: unknown } | null)?.profile === ASSISTANT_LOCAL_PROFILE;
/** A local job's error: the code, the fixed sentence and its next step; never a stack, never the model's words, never money. */
const localError = (code: string, s: { message: string; hint: string }, extra: Record<string, unknown> = {}) => ({ code, message: s.message, hint: s.hint, retryable: false, ...extra });
const LOCAL_CODE: Record<Exclude<LocalErrorCode, 'canceled'>, 'local_not_running' | 'local_loading' | 'local_timeout' | 'local_not_loopback' | 'local_server_error'> = {
  not_running: 'local_not_running', loading: 'local_loading', timeout: 'local_timeout', not_loopback: 'local_not_loopback', server_error: 'local_server_error',
};
/** The words a LocalModelError's detail may carry into local_server_error: a status code or a code word of the adapter, nothing else. */
const safeDetail = (d: string) => (/^(HTTP \d{3}|[A-Za-z_. ]{1,40})$/.test(d) ? d : 'unexpected reply');

/**
 * Clears the phrase and the text slot of succeeded local jobs (all of `where`), by direct SQL inside Store.erasing (secure delete,
 * then a WAL checkpoint), as Governance.decide clears the cloud explanation. Only rows whose output is a local answer not yet cleared
 * are touched; `cleared` becomes true, `phrase` null and `slots` {}. Returns the ids it cleared.
 */
export function clearLocalPhrases(store: Store, where: { jobId: string } | { projectId: string }): string[] {
  const sel = `SELECT id FROM jobs WHERE type = ? AND json_extract(input, '$.profile') = ? AND json_extract(output, '$.kind') = 'local-intent' AND json_extract(output, '$.cleared') IS NULL AND ${'jobId' in where ? 'id = ?' : 'project_id = ?'}`;
  const arg = 'jobId' in where ? where.jobId : where.projectId;
  const ids = (store.db.prepare(sel).all(ASSISTANT_JOB_TYPE, ASSISTANT_LOCAL_PROFILE, arg) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return [];
  store.erasing(() => {
    const upd = store.db.prepare("UPDATE jobs SET output = json_set(output, '$.phrase', json('null'), '$.slots', json('{}'), '$.cleared', json('true')) WHERE id = ?");
    for (const jid of ids) upd.run(jid);
  });
  for (const jid of ids) store.events.emit('job', store.getJob(jid)); // the owner's tab hears it; anyone else gets the stub (visibility.ts)
  return ids;
}

/** Job ids this process started and is still driving: restart recovery leaves them alone. */
const LIVE = new Set<string>();

type Live = { ctl: AbortController; done: Promise<void> };

export class AssistantJobs {
  private live = new Map<string, Live>();
  constructor(private rt: AssistantRuntime) {}

  /** Refuse or create the job, synchronously (no await between the checks, the reservation and the job row); the call runs after. */
  start(p: Principal, projectId: string, body: AssistantRequestBody): { jobId: string } {
    const { store, gov, deps } = this.rt;
    const s = assistantSetup(this.rt);
    if (s.setup !== 'ready') throw new ApiError(409, 'assistant_not_connected', `the language assistant is not set up (${s.setup}): ${s.detail}`, { setup: s.setup, blockers: s.blockers.map((b) => b.code) }, setupHint(s));
    if (s.local) return this.startLocal(p, projectId, body, s);
    const c = s.config;
    const adapter = deps.adapters.get(c.adapter!)!;
    const prices = c.pricesCentsPerMTok!;
    const principal = assistantPrincipal(projectId, c.monthlyLimitCents, new Date().toISOString());
    gov.assertMayAct(principal, projectId, 'propose'); // paused (423) or out of scope: no job, nothing sent
    const { doc, revision } = store.getProject(projectId);
    const summary = assistantSummary(doc, { playheadFrame: body.playheadFrame, selection: body.selection, ...(body.sequenceId !== undefined ? { sequenceId: body.sequenceId } : {}) }, c.toggles);
    const summaryJson = JSON.stringify(summary);
    const maxOutputTokens = ASSISTANT_MAX_OUTPUT_TOKENS;
    // the bound is taken with a job id of the longest form a job id can have, so the real request is never longer
    const bound = requestBytes(buildChatRequest({ model: c.model!, summary, text: body.text, jobId: 'x'.repeat(64), maxOutputTokens }));
    const estimate = estimateCents(bound, maxOutputTokens, prices);
    const reserveCents = adapter.bytesBoundTokens ? estimate : c.perRequestCapCents;
    const job = store.createJob(projectId, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, {
      kind: 'assistant.propose', requestedBy: p.actor, projectRevision: revision, sequenceId: summary.sequenceId,
      text: { sha256: sha(body.text), chars: [...body.text].length },
      summary: { sha256: sha(summaryJson), bytes: Buffer.byteLength(summaryJson, 'utf8'), sent: summary.sent, folded: summary.folded !== null },
      promptDigest: assistantPrompt().digest, adapter: adapter.id, host: c.host, model: c.model, maxOutputTokens,
      estimate: { requestBytes: bound, overheadBytes: ASSISTANT_ESTIMATE_OVERHEAD_BYTES, cents: estimate, bytesBoundTokens: adapter.bytesBoundTokens },
      reservedCents: reserveCents, reservationBasis: adapter.bytesBoundTokens ? 'byte-bound estimate' : 'per-request cap',
    });
    try {
      // plan §7.4 step 2: tokens not bounded by bytes → the reservation is the whole cap, so the cap check inside
      // reserveAssistant cannot see the estimate; refuse here when the estimate itself is above the cap (nothing is sent)
      if (!adapter.bytesBoundTokens && estimate > c.perRequestCapCents)
        throw new ApiError(402, 'budget_exceeded', 'this request is estimated to cost more than the per-request cap', { perRequestCapCents: c.perRequestCapCents, estimateCents: estimate, bytesBoundTokens: false }, 'Shorten the request, or raise the per-request cap in Settings.');
      gov.reserveAssistant(principal, projectId, job.id, reserveCents, { monthlyLimitCents: c.monthlyLimitCents, perRequestCapCents: c.perRequestCapCents });
    } catch (e) {
      store.updateJob(job.id, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'budget_error', message: String(e) } });
      throw e;
    }
    const ctl = new AbortController();
    LIVE.add(job.id);
    const endpoint: ChatEndpoint = { adapter: adapter.id, host: c.host!, model: c.model! };
    const done = this.run(job.id, projectId, principal, { summary, text: body.text, endpoint, prices, reserveCents, maxOutputTokens }, ctl)
      .catch((e) => {
        const cur = store.getJob(job.id);
        if (!['succeeded', 'failed', 'canceled', 'submission-unknown'].includes(cur.status))
          store.updateJob(job.id, { status: 'failed', stage: null, error: { code: 'internal_error', message: String((e as Error)?.message ?? e).slice(0, 500) } });
      })
      .finally(() => { this.live.delete(job.id); LIVE.delete(job.id); });
    this.live.set(job.id, { ctl, done });
    return { jobId: job.id };
  }

  /** The local branch of start() (see the header): synchronous checks, then the job row; nothing of money, nothing of the project. */
  private startLocal(p: Principal, projectId: string, body: AssistantRequestBody, s: AssistantSetupState): { jobId: string } {
    const { store, gov } = this.rt;
    const local = s.config.local!;
    const chars = [...body.text].length;
    if (chars > ASSISTANT_LOCAL_TEXT_MAX) throw new ApiError(400, 'invalid_request', `a request to the local assistant is at most ${ASSISTANT_LOCAL_TEXT_MAX} characters (this one has ${chars})`, { max: ASSISTANT_LOCAL_TEXT_MAX, chars }, 'Shorten the request, or say it as one of the bar\'s commands.');
    if (barUnderstands(body.text)) throw new ApiError(409, 'grammar_understood', ASSISTANT_LOCAL_SENTENCES.grammar_understood.message, undefined, ASSISTANT_LOCAL_SENTENCES.grammar_understood.hint);
    // builder A's grounding and phrase (core localIntent.ts) not in this build: refused honestly before any job, nothing sent
    if (!LOCAL_INTENT_BUILT) throw new ApiError(501, 'not_built', 'the check of a local assistant\'s answer is not built in this server yet, so nothing is sent', undefined, 'The command bar works without the local assistant; it comes in a later build.');
    // budget 0: the in-memory principal only needs its project and Propose mode here (no reservation is ever made for it)
    const principal = assistantPrincipal(projectId, 0, new Date().toISOString());
    gov.assertMayAct(principal, projectId, 'propose'); // paused (423) or out of scope: no job, nothing sent
    store.getProject(projectId); // 404 for a project that does not exist, before any row
    clearLocalPhrases(store, { projectId }); // the next request on the project clears the earlier phrase (decisions §3)
    const lang = body.lang ?? 'he';
    const job = store.createJob(projectId, ASSISTANT_JOB_TYPE, ASSISTANT_ACTOR, {
      kind: 'assistant.propose', profile: ASSISTANT_LOCAL_PROFILE, requestedBy: p.actor,
      text: { sha256: sha(body.text), chars },
      promptDigest: localPrompt().digest, adapter: ASSISTANT_LOCAL_ADAPTER_ID, port: local.port, timeoutSeconds: local.timeoutSeconds, lang,
    });
    const ctl = new AbortController();
    LIVE.add(job.id);
    const done = this.runLocal(job.id, projectId, { text: body.text, lang, port: local.port, timeoutMs: local.timeoutSeconds * 1000 }, ctl)
      .catch(() => {
        // never the error's text (it could hold anything): a fixed sentence
        const cur = store.getJob(job.id);
        if (!['succeeded', 'failed', 'canceled'].includes(cur.status))
          store.updateJob(job.id, { status: 'failed', stage: null, error: localError('local_server_error', { message: ASSISTANT_LOCAL_SENTENCES.local_server_error.message('internal'), hint: ASSISTANT_LOCAL_SENTENCES.local_server_error.hint }) });
      })
      .finally(() => { this.live.delete(job.id); LIVE.delete(job.id); });
    this.live.set(job.id, { ctl, done });
    return { jobId: job.id };
  }

  /** Resolves when the job's run has ended (tests and the proof). */
  done(jobId: string): Promise<void> { return this.live.get(jobId)?.done ?? Promise.resolve(); }

  /** Cancel. Before the send: canceled, nothing was sent, the reservation is released. After: requested; the reservation stays counted (the provider may have charged). */
  cancel(jobId: string, actor: string) {
    const { store } = this.rt;
    const j = store.getJob(jobId);
    if (j.type !== ASSISTANT_JOB_TYPE) throw new ApiError(409, 'cancel_not_supported', `job ${jobId} is not a language-assistant job`, { jobId, type: j.type });
    if (['succeeded', 'failed', 'canceled', 'submission-unknown'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' as const };
    const l = this.live.get(jobId);
    if (isLocalJob(j)) {
      // a local request: no money either way; queued (also while it waits for the lane) = nothing was sent
      if (j.status === 'queued') {
        store.updateJob(jobId, { status: 'canceled', stage: null, error: localError('canceled', ASSISTANT_LOCAL_SENTENCES.canceled_unsent) });
        l?.ctl.abort(new Error('canceled'));
        return { jobId, status: 'canceled', outcome: 'removed-from-queue' as const };
      }
      if (j.status !== 'cancel-requested') store.updateJob(jobId, { status: 'cancel-requested' });
      l?.ctl.abort(new Error('canceled'));
      return { jobId, status: 'cancel-requested', outcome: 'requested' as const, note: 'the local assistant is told to stop; nothing left this computer' };
    }
    if (j.status === 'queued') {
      store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor} before anything was sent` } });
      l?.ctl.abort(new Error('canceled'));
      return { jobId, status: 'canceled', outcome: 'removed-from-queue' as const };
    }
    if (j.status !== 'cancel-requested') store.updateJob(jobId, { status: 'cancel-requested' });
    l?.ctl.abort(new Error('canceled'));
    return { jobId, status: 'cancel-requested', outcome: 'requested' as const, note: 'the request may already have reached the service; its reservation stays counted until you release it' };
  }

  /** The local run: the lane (released in `finally`), one loopback call, the check; no money anywhere. */
  private async runLocal(jobId: string, projectId: string, a: { text: string; lang: 'he' | 'en'; port: number; timeoutMs: number }, ctl: AbortController) {
    const { store, gov, deps } = this.rt;
    const fail = (code: string, s: { message: string; hint: string }, extra: Record<string, unknown> = {}) => store.updateJob(jobId, { status: 'failed', stage: null, error: localError(code, s, extra) });
    const canceled = (sent: boolean) => store.updateJob(jobId, { status: 'canceled', stage: null, error: localError('canceled', sent ? ASSISTANT_LOCAL_SENTENCES.canceled_sent : ASSISTANT_LOCAL_SENTENCES.canceled_unsent) });
    await new Promise<void>((r) => setImmediate(r)); // let the request that started the job answer first (and a cancel land)
    if (store.getJob(jobId).status !== 'queued' || ctl.signal.aborted) return; // canceled before the send (cancel() wrote it)
    const adapter = deps.local;
    if (!adapter) return fail('assistant_not_connected', { message: 'the local adapter went away before the request was sent; nothing was sent', hint: LOCAL_SETUP_HINT.provider_not_configured! });
    let release: (() => void) | null = null;
    try {
      if (deps.lane) {
        if (deps.lane.busy().holder !== null) store.updateJob(jobId, { stage: 'waiting-for-compute' });
        try { release = await deps.lane.acquire(ASSISTANT_LOCAL_LANE_LABEL, ctl.signal); }
        catch { if (store.getJob(jobId).status === 'queued') canceled(false); return; } // only an abort rejects: the cancel wrote canceled
        if (store.getJob(jobId).status !== 'queued' || ctl.signal.aborted) return;
      }
      if (gov.isPaused(projectId)) return fail('agent_paused', { message: 'the owner paused agents on this project before the request was sent; nothing was sent', hint: 'Resume agents on this project, then ask again.' });
      const req = buildLocalRequest(a.text); // the reviewed prompt and the owner's words; nothing of the project, no key
      store.updateJob(jobId, { status: 'running', stage: 'sending', attempt: 1 });
      const t0 = Date.now();
      let res: LocalChatResponse;
      try {
        const pending = adapter.complete(req, a.port, a.timeoutMs, ctl.signal);
        if (store.getJob(jobId).status === 'running') store.updateJob(jobId, { stage: 'awaiting-local-model' });
        res = await pending;
      } catch (e) {
        const cur = store.getJob(jobId);
        const sent = e instanceof LocalModelError ? e.sent : true;
        if (cur.status === 'cancel-requested' || (e instanceof LocalModelError && e.code === 'canceled')) return canceled(sent);
        if (!(e instanceof LocalModelError)) return fail('local_server_error', { message: ASSISTANT_LOCAL_SENTENCES.local_server_error.message('unexpected error'), hint: ASSISTANT_LOCAL_SENTENCES.local_server_error.hint });
        const code = LOCAL_CODE[e.code as Exclude<LocalErrorCode, 'canceled'>];
        if (code === 'local_server_error') return fail(code, { message: ASSISTANT_LOCAL_SENTENCES.local_server_error.message(safeDetail(e.message)), hint: ASSISTANT_LOCAL_SENTENCES.local_server_error.hint });
        return fail(code, ASSISTANT_LOCAL_SENTENCES[code]);
      }
      const wallMs = Date.now() - t0;
      if (store.getJob(jobId).status === 'cancel-requested') return canceled(true); // the answer that arrived is discarded
      store.updateJob(jobId, { stage: 'checking' });
      const check = checkLocalAnswer(res, a.text, a.lang);
      // an answer that is not a command: its category and a fixed sentence, never its words (nothing of it is stored or logged)
      if (!check.ok) return fail('invalid_model_output', { message: check.reason, hint: ASSISTANT_LOCAL_SENTENCES.invalid.hint }, { category: check.category });
      if (store.getJob(jobId).status === 'cancel-requested') return canceled(true);
      const output: AssistantLocalOutput = { ...check.output, model: res.model, wallMs };
      store.updateJob(jobId, { status: 'succeeded', stage: null, output });
    } finally {
      release?.();
    }
  }

  private async run(jobId: string, projectId: string, principal: Principal, a: { summary: ReturnType<typeof assistantSummary>; text: string; endpoint: ChatEndpoint; prices: { input: number; output: number }; reserveCents: number; maxOutputTokens: number }, ctl: AbortController) {
    const { store, gov, deps, files } = this.rt;
    const fail = (code: string, message: string, extra: Record<string, unknown> = {}) => store.updateJob(jobId, { status: 'failed', stage: null, error: { code, message, retryable: false, ...extra } });
    /** Failed before anything was sent: nothing can have been charged. */
    const failUnsent = (code: string, message: string) => { gov.resolve(jobId, 'released'); fail(code, message); };
    await new Promise<void>((r) => setImmediate(r)); // let the request that started the job answer first (and a cancel land)
    if (store.getJob(jobId).status !== 'queued' || ctl.signal.aborted) return; // canceled before the send (settleFor released it)
    if (gov.isPaused(projectId)) return failUnsent('agent_paused', 'the owner paused agents on this project before the request was sent; nothing was sent');
    const adapter = deps.adapters.get(a.endpoint.adapter);
    const key = files.readKey();
    if (!adapter || !key) return failUnsent('assistant_not_connected', 'the adapter or the key went away before the request was sent; nothing was sent');
    const red = redact(key);
    const req = buildChatRequest({ model: a.endpoint.model, summary: a.summary, text: a.text, jobId, maxOutputTokens: a.maxOutputTokens });

    store.updateJob(jobId, { status: 'running', stage: 'sending', attempt: 1 });
    let res: ChatResponse;
    try {
      const pending = adapter.complete(req, a.endpoint, key, ctl.signal);
      if (store.getJob(jobId).status === 'running') store.updateJob(jobId, { stage: 'awaiting-provider' });
      res = await pending;
    } catch (e) {
      const message = red(String((e as Error)?.message ?? e)).slice(0, 500);
      const cur = store.getJob(jobId);
      if (e instanceof ChatProviderError && e.code === 'unreachable_before_send') {
        gov.resolve(jobId, 'released');
        if (cur.status === 'cancel-requested') store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; the service was not reached, nothing was sent' } });
        else fail('provider_error', `the service could not be reached; nothing was sent: ${message}`, { providerCode: e.code });
        return;
      }
      if (cur.status === 'cancel-requested') {
        // canceled after the call started (attempt 1): settleFor keeps the reservation counted as unknown
        store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled while the request was with the service; it may have been charged' } });
        return;
      }
      if (e instanceof ChatProviderError && e.code !== 'unknown_after_send') { fail('provider_error', `the service refused the request (${e.code}): ${message}`, { providerCode: e.code }); return; }
      store.updateJob(jobId, { status: 'submission-unknown', stage: null, error: { code: 'submission_unknown', message: `it is not known whether the service received the request; it may have been charged and it is not sent again: ${message}`, retryable: false } });
      return;
    }

    // an answer came back: the money is known (reported usage) or bounded (the reservation)
    const usage = res.usage && isCount(res.usage.inputTokens) && isCount(res.usage.outputTokens) ? res.usage : null;
    const costCents = usage ? centsFor(usage.inputTokens, usage.outputTokens, a.prices) : a.reserveCents;
    gov.settleAssistant(jobId, costCents);
    if (store.getJob(jobId).status === 'cancel-requested') { store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; the answer that arrived was discarded' } }); return; }
    store.updateJob(jobId, { stage: 'checking' });
    const check = checkModelAnswer(res);
    // an answer that is not valid: its category and a fixed sentence, never its own words (validate.ts; ADR-0027 note of 2026-11-25)
    if (!check.ok) { fail('invalid_model_output', check.reason, { category: check.category }); return; }
    let proposalId: string;
    try {
      proposalId = gov.propose(principal, projectId, check.ops, ASSISTANT_PROPOSAL_LABEL).proposalId;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'agent_paused') { fail('agent_paused', 'the owner paused agents on this project while the answer was on its way; no proposal was made'); return; }
      // the refusal's code is a word of this build; its message can quote the proposed arguments, so it is not kept
      if (e instanceof ApiError) { fail('invalid_model_output', `the project refused the proposed operations (${e.code})`, { category: 'refused_by_project' satisfies InvalidAnswerCategory }); return; }
      throw e;
    }
    const output: AssistantJobOutput = { proposalId, explanation: check.explanation === null ? null : red(check.explanation), opsCount: check.ops.length, costCents, costBasis: usage ? 'reported' : 'reserved' };
    store.updateJob(jobId, { status: 'succeeded', stage: null, output });
  }
}

/**
 * Restart recovery (lead decision after the contracts review), called once at start-up beside the other recoveries: an
 * assistant.propose job still queued, running or cancel-requested from an earlier process becomes failed
 * `submission_unknown` and is never retried. Its reservation is released when nothing was sent (still queued, attempt 0),
 * and kept, counted as unknown, when the send had started (the provider may have charged; the owner can release it).
 */
export function recoverAssistantJobs(store: Store, gov: Governance): JobRow[] {
  const out: JobRow[] = [];
  for (const job of store.openJobs(ASSISTANT_JOB_TYPE)) {
    if (LIVE.has(job.id)) continue; // this process is driving it
    if (isLocalJob(job)) {
      // a local request: nothing left the machine and nothing is held; ended honestly, never resumed, never "unknown", no ledger
      store.updateJob(job.id, { status: 'failed', stage: null, error: localError('local_interrupted', ASSISTANT_LOCAL_SENTENCES.recovered) });
      out.push(store.getJob(job.id));
      continue;
    }
    const sent = job.status !== 'queued' || job.attempt > 0 || job.stage !== null;
    if (!sent && gov.ledgerFor(job.id)?.state === 'reserved') gov.resolve(job.id, 'released');
    // a job that stopped while its answer was being checked has already settled its cost (settleAssistant runs before the
    // check): there is nothing to release, so the owner is not told to release it (POST …/budget/release would answer 409)
    const settled = sent && gov.ledgerFor(job.id)?.state === 'settled';
    const words = !sent
      ? { message: 'the server stopped before the request was sent; nothing was sent and the reservation was released', hint: 'Ask again.' }
      : settled
        ? { message: 'the server stopped after the service answered and before its answer was checked; the cost is recorded as spent and nothing is left to release; no proposal was made', hint: 'Ask again if you still want the change.' }
        : { message: 'the server stopped while the request was with the service; it may have been charged and it is not sent again (its reservation stays counted until the owner releases it)', hint: 'Check the service\'s billing; if nothing was charged, release the reservation of this job.' };
    store.updateJob(job.id, { status: 'failed', stage: null, error: { code: 'submission_unknown', retryable: false, ...words } });
    out.push(store.getJob(job.id));
  }
  return out;
}
