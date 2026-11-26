/**
 * The accessibility audit scenarios of the in-editor agent «סוכן» (wave 8 autonomy Part 2, integration): agent-tab (the tab with no
 * provider connected: the connect card only, a LAN plain-http address saying «לא מוצפן»), agent-connect (the card after a failed
 * «בדיקה», its worded answer and the provider's words), agent-run (a run with its plan, steps, one call expanded, «לא בוטל: …» under
 * «ביטול הכול»). a11y-audit.ts runs each in both languages and both themes. Each scenario PREPARES the page and says whether the
 * state is shown; a state that could not be brought up says `shown: false`, which the audit reports as a finding, never as a pass.
 *
 * agent-tab runs against the real server (its own provider settings, written through the owner's session and restored by `leave`).
 * agent-connect and agent-run answer the page's own agent routes with a fixed AUDIT FIXTURE through the browser's route hook (no
 * provider is called and no model runs here; the real loop with the labelled scripted model is proof:agent's UI rows); each says so
 * in `detail.fixture`. The hook is removed and the page restored by `leave`.
 */
import type { Page } from 'playwright';
import { AGENT_TESTIDS as ID } from '../../../apps/web/src/editor/agent/agent.testids.ts';

export interface AgentA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface AgentA11yScenario {
  id: string;
  prepare(ctx: AgentA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: AgentA11yCtx): Promise<void>;
}

const FIXTURE = 'AUDIT FIXTURE: the agent routes answered by the audit, not by a provider or the server\'s loop';
const homes = new WeakMap<Page, string>();
const settle = (page: Page) => page.waitForTimeout(250);
const LAN = 'http://192.168.1.20:9931/v1';
const LLAMA_DEFAULT = 'http://127.0.0.1:9931/v1';

async function putLlama(page: Page, baseUrl: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  await page.request.put(`${origin}/api/v1/agent/providers/llamacpp`, { headers: { origin, 'content-type': 'application/json' }, data: { baseUrl } });
}
async function openTab(page: Page): Promise<boolean> {
  if (!(await page.getByTestId(ID.tab).count())) await page.getByTestId('rail-ai').click().catch(() => undefined);
  await page.getByTestId(ID.tab).waitFor({ timeout: 15000 }).catch(() => undefined);
  await settle(page);
  return (await page.getByTestId(ID.tab).count()) === 1;
}
async function reopen(page: Page): Promise<void> {
  const home = homes.get(page) ?? page.url();
  homes.set(page, home);
  await page.goto(home);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 }).catch(() => undefined);
}
async function restore(ctx: AgentA11yCtx): Promise<void> {
  await ctx.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
  await putLlama(ctx.page, LLAMA_DEFAULT).catch(() => undefined);
  const home = homes.get(ctx.page);
  homes.delete(ctx.page);
  if (home) { await ctx.page.goto(home); await ctx.page.getByTestId('timecode').waitFor({ timeout: 30000 }).catch(() => undefined); }
}
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

export const agentA11yScenarios: AgentA11yScenario[] = [
  {
    id: 'agent-tab',
    async prepare(ctx) {
      const { page } = ctx;
      homes.set(page, page.url());
      await putLlama(page, LAN);
      await reopen(page);
      const ok = await openTab(page);
      const rows = await page.getByTestId(ID.provider).count();
      const start = await page.getByTestId(ID.start).count();
      const lan = await page.locator(`[data-testid=${ID.provider}][data-provider=llamacpp]`).getByTestId(ID.unencrypted).count();
      return { shown: ok && rows > 0 && start === 0 && lan === 1, modal: false, detail: { rows, startButtons: start, unencryptedLine: lan, fixture: 'none: the real server with no provider connected' } };
    },
    leave: restore,
  },
  {
    id: 'agent-connect',
    async prepare(ctx) {
      const { page } = ctx;
      homes.set(page, page.url());
      await page.route(/\/api\/v1\/agent\/providers\/[^/]+\/probe$/, (r) => r.fulfill(json({ ok: false, code: 'unauthorized', model: 'claude-opus-5-5', detail: `${FIXTURE}: invalid x-api-key [redacted]` })));
      await reopen(page);
      if (!(await openTab(page))) return { shown: false, modal: false, detail: { fixture: FIXTURE } };
      const row = page.locator(`[data-testid=${ID.provider}][data-provider=anthropic]`);
      await row.getByTestId(ID.probe).click();
      await row.getByTestId(ID.probeResult).waitFor({ timeout: 10000 }).catch(() => undefined);
      await settle(page);
      const answered = await row.getByTestId(ID.probeResult).count();
      const words = await row.getByTestId(ID.probeDetail).count();
      return { shown: answered === 1 && words === 1, modal: false, detail: { probeAnswer: answered, providerWords: words, fixture: FIXTURE } };
    },
    leave: restore,
  },
  {
    id: 'agent-run',
    async prepare(ctx) {
      const { page, pid } = ctx;
      homes.set(page, page.url());
      const p = (id: string, o: Record<string, unknown> = {}) => ({ id, family: id === 'anthropic' ? 'anthropic-messages' : 'openai-chat', baseUrl: 'https://provider.invalid', model: null, needsKey: true, keySet: false, keyAddedAt: null, unencrypted: false, compatNote: false, local: false, ...o });
      const run = { id: 'run_auditfixture1', projectId: pid, actor: 'agent:run_auditfixture1', startedBy: 'user:local', goal: 'תחתכו את השקטים ותייצאו', providerId: 'anthropic', model: 'claude-opus-5-5', status: 'provider_unavailable', stopReason: 'provider_unauthorized', stepsUsed: 2, stepLimit: 100, spendLimitCents: null, spentCents: 0.48, unknownCostCalls: 0, tokens: { input: 2000, output: 200 }, plan: [{ title: 'לחפש שקטים', status: 'done' }, { title: 'לחתוך', status: 'running' }, { title: 'לייצא', status: 'pending' }], startRevision: 1, jobId: 'job_auditfixture', summary: null, createdAt: '2026-11-26T10:00:00Z', endedAt: '2026-11-26T10:01:00Z', undoneBy: null };
      const step = (n: number, kind: string, o: Record<string, unknown>) => ({ runId: run.id, n, kind, status: 'done', model: null, tool: null, note: null, startedAt: '2026-11-26T10:00:00Z', endedAt: '2026-11-26T10:00:01Z', revisionAfter: null, ...o });
      const steps = [
        step(1, 'model', { model: { text: FIXTURE, toolCalls: [{ callId: 'c1', tool: 'find_silences', input: {} }], finish: 'tool', usage: { inputTokens: 1000, outputTokens: 100 }, cost: { cents: 0.24, unknown: false }, providerId: 'anthropic', model: 'claude-opus-5-5' } }),
        step(2, 'tool', { tool: { callId: 'c1', tool: 'find_silences', input: { assetId: 'a1' }, resultSummary: '{"removableSeconds":6}', isError: false, errorCode: null, transactionIds: [], jobIds: [], idempotencyKey: null } }),
      ];
      await page.route(/\/api\/v1\/agent\/providers$/, (r) => r.fulfill(json({ providers: [p('anthropic', { model: 'claude-opus-5-5', keySet: true, keyAddedAt: '2026-11-26T09:00:00Z' }), p('openai', { compatNote: true })], defaultProviderId: 'anthropic' })));
      await page.route(/\/api\/v1\/projects\/[^/]+\/agent\/runs$/, (r) => r.fulfill(json({ runs: [run] })));
      await page.route(/\/api\/v1\/projects\/[^/]+\/agent\/runs\/[^/]+$/, (r) => r.fulfill(json({ run, steps })));
      await page.route(/\/api\/v1\/projects\/[^/]+\/agent\/runs\/[^/]+\/undo-all$/, (r) => r.fulfill(json({ transactionId: null, revision: 3, sinceRevision: 1, undoes: ['t1'], entities: 2, conflicts: [], notUndone: [{ kind: 'money_spent', count: 2, cents: 0.48 }, { kind: 'data_sent', count: 2, providerId: 'anthropic' }], canceledJobs: [] })));
      await reopen(page);
      if (!(await openTab(page))) return { shown: false, modal: false, detail: { fixture: FIXTURE } };
      await page.getByTestId(ID.run).waitFor({ timeout: 10000 }).catch(() => undefined);
      await page.getByTestId(ID.step).nth(1).locator('summary').click().catch(() => undefined);
      await page.getByTestId(ID.notUndoneItem).first().waitFor({ timeout: 10000 }).catch(() => undefined);
      await settle(page);
      const shownRun = await page.getByTestId(ID.run).count();
      const items = await page.getByTestId(ID.notUndoneItem).count();
      return { shown: shownRun === 1 && items === 2 && (await page.getByTestId(ID.continue).count()) === 1, modal: false, detail: { run: shownRun, notUndoneItems: items, fixture: FIXTURE } };
    },
    leave: restore,
  },
];
