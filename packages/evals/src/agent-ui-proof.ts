/**
 * The «סוכן» tab in the editor (wave 8 autonomy Part 2, builder W3): headless Chromium, one sample, Hebrew right to left.
 *
 * LABELLED: until the integrator wires the server's scripted MOCK model, the agent routes (/api/v1/agent/*, .../agent/runs*) are
 * answered by CANNED ANSWERS this script gives through the browser's request interception. They are fixtures of the tab's states,
 * NOT a run of any model and not the server's loop: this proof says what the tab shows for each answer, nothing about an agent.
 *
 * Checks: the tab replaces the empty chat panel; connect card states (not connected, key set, the unencrypted line, the compatible
 * endpoint line, a probe failure worded with its next step, owner-only worded); the one line on what is sent; the plan; live statuses
 * with WHY on the same line; the counter and tokens; an expanded call (arguments and answer); «ביטול הכול» with «לא בוטל: …» under it
 * before pressing, the conflict list and «ביטול מה שאפשר» on a 409; the keyboard path goal -> start; RTL.
 *   pnpm build && tsx packages/evals/src/agent-ui-proof.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, type Page, type Route } from 'playwright';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/agent-ui');
const PORT = Number(process.env.PF_PROOF_PORT ?? 8814);
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 600)}` : ''}`); };
const HEBREW = /[֐-׿]/;

// ---- the canned answers (LABELLED: not a model, not the server's loop) ----
const provider = (id: string, o: Record<string, unknown> = {}) => ({ id, family: id === 'anthropic' ? 'anthropic-messages' : 'openai-chat', baseUrl: `https://api.${id}.example`, model: null, needsKey: true, keySet: false, keyAddedAt: null, unencrypted: false, compatNote: false, local: false, ...o });
let providers = { providers: [provider('anthropic'), provider('gemini', { compatNote: true }), provider('ollama', { baseUrl: 'http://192.168.1.20:11434', needsKey: false, local: true, unencrypted: true })], defaultProviderId: null as string | null };
const models = { rows: [{ providerId: 'anthropic', id: 'canned-model', label: 'Canned model', contextTokens: 1000, maxOutputTokens: 100, priceInPerMTok: 2, priceOutPerMTok: 10, vision: true, readAt: '2026-11-26', source: 'canned' }] };
let probe: { status: number; body: unknown } = { status: 200, body: { ok: false, code: 'unauthorized', model: null } };
const baseRun = { id: 'run_cannedrun01', projectId: 'p', actor: 'agent:run_cannedrun01', startedBy: 'user:local', goal: 'תחתכו את השקטים', providerId: 'anthropic', model: 'canned-model', status: 'running', stopReason: null, stepsUsed: 2, stepLimit: 100, spendLimitCents: null, spentCents: 0, unknownCostCalls: 0, tokens: { input: 1500, output: 400 }, plan: [{ title: 'לחפש שקטים', status: 'done' }, { title: 'לחתוך', status: 'running' }, { title: 'לייצא', status: 'pending' }], startRevision: 1, jobId: 'job_canned', summary: null, createdAt: '2026-11-26T10:00:00Z', endedAt: null, undoneBy: null };
const step = (n: number, kind: string, o: Record<string, unknown>) => ({ runId: baseRun.id, n, kind, status: 'done', model: null, tool: null, note: null, startedAt: '2026-11-26T10:00:00Z', endedAt: null, revisionAfter: null, ...o });
const steps = [
  step(1, 'model', { model: { text: 'אני מחפש שקטים', toolCalls: [{ callId: 'c1', tool: 'find_silences', input: {} }], finish: 'tool', usage: null, cost: { cents: null, unknown: false }, providerId: 'anthropic', model: 'canned-model' } }),
  step(2, 'tool', { tool: { callId: 'c1', tool: 'find_silences', input: { minSeconds: 0.8 }, resultSummary: '3 candidates; looked at {"image": 12, "revision": 4}', isError: false, errorCode: null, transactionIds: [], jobIds: [], idempotencyKey: null } }),
];
let run: Record<string, unknown> = { ...baseRun };
let undoMode: 'ok' | 'conflict' = 'ok';
const undoAnswer = (dry: boolean) => ({ transactionId: dry ? null : 'tx1', revision: 5, sinceRevision: 1, undoes: ['t1'], entities: 3, conflicts: [], notUndone: [{ kind: 'export_file', count: 1 }, { kind: 'money_spent', count: 2, cents: null }, { kind: 'data_sent', count: 2, providerId: 'anthropic' }], canceledJobs: [] });
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function wire(page: Page) {
  await page.route(/\/api\/v1\/agent\/providers$/, (r) => json(r, 200, providers));
  await page.route(/\/api\/v1\/agent\/models$/, (r) => json(r, 200, models));
  await page.route(/\/api\/v1\/agent\/providers\/[^/]+\/probe$/, (r) => json(r, probe.status, probe.body));
  await page.route(/\/api\/v1\/agent\/providers\/[^/]+\/key$/, (r) => { if (r.request().method() === 'PUT') providers = { ...providers, defaultProviderId: 'anthropic', providers: providers.providers.map((p) => (p.id === 'anthropic' ? { ...p, keySet: true } : p)) }; return json(r, 200, { keySet: true, keyAddedAt: 'now' }); });
  await page.route(/\/api\/v1\/projects\/[^/]+\/agent\/runs$/, (r) => (r.request().method() === 'POST' ? json(r, 200, { runId: baseRun.id, jobId: baseRun.jobId, status: 'queued' }) : json(r, 200, { runs: [run] })));
  await page.route(/\/api\/v1\/projects\/[^/]+\/agent\/runs\/[^/]+$/, (r) => json(r, 200, { run, steps }));
  await page.route(/\/api\/v1\/projects\/[^/]+\/agent\/runs\/[^/]+\/continue$/, (r) => { run = { ...run, status: 'running', stopReason: null, stepLimit: 200 }; return json(r, 200, { run, steps }); });
  await page.route(/\/api\/v1\/projects\/[^/]+\/agent\/runs\/[^/]+\/undo-all$/, (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}') as { dryRun?: boolean; partial?: boolean };
    if (body.dryRun) return json(r, 200, undoAnswer(true));
    if (undoMode === 'conflict' && !body.partial) return json(r, 409, { error: { code: 'undo_conflict', message: 'conflict', details: { conflicts: [{ entityId: 'clip_7', changedAtRevision: 6, by: 'user:local' }] } } });
    run = { ...run, undoneBy: 'tx1' }; return json(r, 200, undoAnswer(false));
  });
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data'), denoiseBin: null, toolsPython: null, comfyuiUrl: null });
  try {
    if (!fs.existsSync(path.join(s.cfg.webDist, 'index.html'))) { console.error(`BLOCKED: the editor is not built (${s.cfg.webDist}); run pnpm build`); process.exit(2); }
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, 'content-type': 'application/json', connection: 'close' };
    const pid = ((await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'agent-ui', width: 640, height: 360 }) })).json()) as any).project.id as string;
    // one synthetic clip so the editor leaves its welcome page (made at run time, deleted with the artifacts folder)
    const wav = path.join(art, 'tone.wav');
    try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'pcm_s16le', wav]); } catch { console.error('BLOCKED: ffmpeg is not on PATH'); process.exit(2); }
    const up = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: h.authorization, 'x-filename': 'tone.wav', connection: 'close' }, body: fs.readFileSync(wav) })).json() as any;
    await fetch(`${s.url}/api/v1/projects/${pid}/transactions`, { method: 'POST', headers: h, body: JSON.stringify({ ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: T.frameTime(0, { num: 30, den: 1 }) } }] }) });
    const browser = await chromium.launch();
    try {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
      await page.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
      await wire(page);
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('timecode').waitFor();
      await page.getByTestId('rail-ai').click();
      const tab = page.getByTestId('agent-tab');
      await tab.waitFor({ timeout: 15000 });
      check('the tab replaces the empty chat panel and is a tabpanel with the Copilot\'s panel id', (await tab.getAttribute('role')) === 'tabpanel' && (await tab.getAttribute('id')) === 'pf-cop-panel-chat' && (await page.getByTestId('copilot-not-connected').count()) === 0);
      check('right to left: the tab\'s direction is rtl', (await tab.evaluate((e) => getComputedStyle(e).direction)) === 'rtl');
      // not connected
      const rows = page.locator('[data-testid=agent-provider]');
      await rows.first().waitFor();
      check('not connected: the connect card comes first, one row per preset, the goal box cannot start (reason given)', (await rows.count()) === 3 && (await page.getByTestId('agent-start').getAttribute('aria-disabled')) === 'true' && HEBREW.test((await page.getByTestId('agent-connect').textContent()) ?? ''));
      const sent = (await page.getByTestId('agent-sent-line').textContent()) ?? '';
      check('the one line on what is sent is visible and is information, not a question', ['תמונות', 'התמלולים', 'שמות', 'ההוראות'].every((w) => sent.includes(w)) && !sent.includes('?') && (await page.getByTestId('agent-sent-line').isVisible()));
      const ollama = page.locator('[data-testid=agent-provider][data-provider=ollama]');
      check('a local preset on a plain-http address says the connection is not encrypted and has no key field, plus the small-model line', (await ollama.getByTestId('agent-unencrypted').count()) === 1 && (await ollama.getByTestId('agent-key').count()) === 0 && (await ollama.getByTestId('agent-local-small').count()) === 1);
      check('a compatible-endpoint provider says so', (await page.locator('[data-provider=gemini]').getByTestId('agent-compat').count()) === 1);
      // probe failure worded
      const claude = page.locator('[data-testid=agent-provider][data-provider=anthropic]');
      await claude.getByTestId('agent-probe').click();
      const pr = claude.getByTestId('agent-probe-result');
      await pr.waitFor();
      check('a probe failure is worded with its next step (data-code kept)', (await pr.getAttribute('data-code')) === 'unauthorized' && /הדביקו/.test((await pr.textContent()) ?? ''), await pr.textContent());
      // key set -> connected
      await claude.getByTestId('agent-key').fill('sk-canned-not-a-key');
      await claude.getByRole('button', { name: 'שמירה' }).click();
      await page.getByTestId('agent-goal').waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid=agent-start]')?.getAttribute('aria-disabled') !== 'true' || (document.querySelector<HTMLTextAreaElement>('[data-testid=agent-goal]')?.value ?? '') === '');
      check('after the key is stored the key field is empty again (never shown back)', (await claude.getByTestId('agent-key').inputValue()) === '' && (await claude.getByTestId('agent-forget-key').count()) === 1);
      // keyboard path: goal -> start
      await page.getByTestId('agent-goal').focus();
      await page.keyboard.type('תחתכו את השקטים');
      await page.keyboard.press('Control+Enter');
      const runEl = page.getByTestId('agent-run');
      await runEl.waitFor({ timeout: 8000 });
      const st = page.getByTestId('agent-status');
      check('the run shows its status with WHY on one line, the counter and the tokens (no prices entered)', (await st.getAttribute('data-status')) === 'running' && /צעד 2 מתוך 100/.test((await page.getByTestId('agent-counter').textContent()) ?? '') && /טוקנים/.test((await page.getByTestId('agent-cost').textContent()) ?? ''));
      const items = page.getByTestId('agent-plan-item');
      check('the plan lists its items with their status', (await items.count()) === 3 && (await items.nth(1).getAttribute('data-status')) === 'running');
      const stepRows = page.getByTestId('agent-step');
      check('the steps are listed in order, one row per step', (await stepRows.count()) === 2 && (await stepRows.nth(1).getAttribute('data-kind')) === 'tool');
      await stepRows.nth(1).locator('summary').click();
      const callText = (await stepRows.nth(1).textContent()) ?? '';
      check('an expanded call shows the arguments, the answer and the picture it looked at', /minSeconds/.test(callText) && /3 candidates/.test(callText) && (await stepRows.nth(1).getByTestId('agent-step-image').count()) === 1);
      // live: the poll brings the next state without losing the expanded row or the focus
      await stepRows.nth(1).locator('summary').focus();
      run = { ...baseRun, status: 'stopped_at_limit', stopReason: 'step_limit', stepsUsed: 100, endedAt: '2026-11-26T10:05:00Z' };
      await page.waitForFunction(() => document.querySelector('[data-testid=agent-status]')?.getAttribute('data-status') === 'stopped_at_limit', null, { timeout: 12000 });
      const why = (await st.textContent()) ?? '';
      check('a run stopped at its limit says why on the same line and offers to continue 100 more steps', /נעצר בגבול/.test(why) && /100/.test(why) && /100 צעדים/.test((await page.getByTestId('agent-continue').textContent()) ?? ''), why);
      check('the refresh kept the expanded call open and the focus on its row', (await stepRows.nth(1).locator('details').evaluate((d) => (d as HTMLDetailsElement).open)) && (await page.evaluate(() => document.activeElement?.tagName)) === 'SUMMARY');
      // undo-all: notUndone under the button before pressing
      const nu = page.getByTestId('agent-not-undone');
      await nu.locator('[data-testid=agent-not-undone-item]').first().waitFor();
      const kinds = await nu.locator('[data-testid=agent-not-undone-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
      check('«לא בוטל: …» is shown under «ביטול הכול» BEFORE pressing it, one item per class', kinds.join(',') === 'export_file,money_spent,data_sent' && /לא בוטל/.test((await nu.textContent()) ?? ''), kinds);
      undoMode = 'conflict';
      await page.getByTestId('agent-undo-all').click();
      await page.getByTestId('agent-undo-conflicts').waitFor();
      check('a 409 shows the conflict list and «ביטול מה שאפשר»', /clip_7/.test((await page.getByTestId('agent-undo-conflicts').textContent()) ?? '') && (await page.getByTestId('agent-undo-partial').count()) === 1);
      await page.getByTestId('agent-undo-partial').click();
      await page.getByText('הריצה בוטלה').waitFor();
      check('the partial undo is done and says so', true);
      await page.screenshot({ path: path.join(art, 'agent-tab-he.png') });
    } finally { await browser.close(); }
  } finally { await s.close(); }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed (canned answers: not a model run)`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
