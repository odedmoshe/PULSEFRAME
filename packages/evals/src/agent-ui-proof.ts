/**
 * The «סוכן» tab in the editor (wave 8 autonomy Part 2; W3's tab, rerun by the integrator against the REAL server): headless
 * Chromium, one sample, Hebrew right to left. Part of `pnpm proof:agent` (agent-proof.ts imports runAgentUiProof); alone:
 *   pnpm build && tsx packages/evals/src/agent-ui-proof.ts
 *
 * LABELLED: the model is the test double `MOCK-scripted-model` (packages/providers agentScripted.ts) placed in BOTH family slots
 * through the startServer `agent.adapters` seam; the server's own loop, routes, key store and event stream do everything else.
 * Nothing here is a claim about any real model. The «בדיקה» (probe) goes to a LABELLED local double (`http.createServer` on port 0,
 * loopback) that answers 401 and echoes the key, as some providers do; no real provider is called and the key is a made-up string.
 * Fixtures (a 2 s tone) are made by ffmpeg here and deleted with the artifacts folder. The server listens on port 0.
 *
 * Rows U1…U14: the tab replaces the empty chat panel; not connected → the connect card only (no start button that cannot work);
 * the one line on what is sent; a LAN http address says «לא מוצפן»; the compatible-endpoint line; a probe failure worded with its
 * next step and the provider's words (key redacted); the key never shown back; the keyboard path goal → start; the live view
 * moved only by the editor store's forwarded agent.run job events (no poll); the plan; the picture the agent looked at as a
 * thumbnail while the project is at that revision; a provider failure with WHY on the same line and «להמשיך»; «לא בוטל: …» under
 * «ביטול הכול» before pressing; a 409 conflict list and «ביטול מה שאפשר».
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { AGENT_PROVIDER_PRESETS, createScriptedModel, lastToolResult, MOCK_SCRIPTED_ID, type AgentModelAdapter, type ScriptedTurn } from '@pulseframe/providers';
import { startServer } from '@pulseframe/server';

export type UiStatus = 'pass' | 'fail' | 'blocked';
type Report = (id: string, status: UiStatus, detail?: unknown) => void;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const art = path.join(root, '.artifacts/agent-ui');
const HEBREW = /[֐-׿]/;
const FAKE_KEY = 'TEST-ONLY-ui-proof-key-91c4-not-real';

/** The MOCK in both family slots; turn 3 waits for the proof's go (so the running state can be looked at). */
function mockModel() {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const script: ScriptedTurn[] = [
    { toolCalls: [{ name: 'update_plan', input: { steps: [{ title: 'לסמן את ההתחלה', status: 'done' }, { title: 'להסתכל על התמונה', status: 'running' }, { title: 'לייצא', status: 'pending' }] } }] },
    { toolCalls: [{ name: 'apply_transaction', input: { ops: [{ op: 'add_marker', args: { time: T.rt(1, 1), label: 'התחלה' } }] } }] },
    { toolCalls: [{ name: 'render_frame', input: { frameIndex: 0 } }] },
    { fail: 'unauthorized' }, // after the gate: the provider refuses the key → provider_unavailable, continuable
    { toolCalls: [{ name: 'export_project', input: { format: 'wav' } }] },
    (req) => ({ toolCalls: [{ name: 'wait_for_job', input: { jobId: (lastToolResult(req, 'export_project') as { jobId: string }).jobId } }] }),
    { toolCalls: [{ name: 'finish', input: { summary: 'סימנתי, הסתכלתי וייצאתי', outcome: 'done' } }] },
  ];
  const model = createScriptedModel(script);
  let turns = 0;
  const adapter: AgentModelAdapter = {
    id: MOCK_SCRIPTED_ID, family: 'mock-scripted',
    async turn(req, ep, key, signal) { if (turns++ === 3) await gate; return model.turn(req, ep, key, signal); },
    probe: model.probe,
  };
  return { adapter, release: () => release(), model };
}

async function count(page: Page, testId: string): Promise<number> { return page.getByTestId(testId).count(); }

export async function runAgentUiProof(report: Report): Promise<void> {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const { adapter, release } = mockModel();
  // the LABELLED local double of a provider for «בדיקה»: 401 and the key echoed back
  const dbl = http.createServer((rq, rs) => { let body = ''; rq.on('data', (d) => { body += d; }); rq.on('end', () => { rs.writeHead(401, { 'content-type': 'application/json' }); rs.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${String(rq.headers['x-api-key'] ?? '')}` } })); }); });
  await new Promise<void>((r) => dbl.listen(0, '127.0.0.1', r));
  const dblBase = `http://127.0.0.1:${(dbl.address() as AddressInfo).port}`;
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data'), denoiseBin: null, toolsPython: null, comfyuiUrl: null }, { agent: { adapters: new Map([['anthropic-messages', adapter], ['openai-chat', adapter]]) } });
  try {
    if (!fs.existsSync(path.join(s.cfg.webDist, 'index.html'))) { report('U the «סוכן» tab in Chromium', 'blocked', `the editor is not built (${s.cfg.webDist}); run pnpm build`); return; }
    const ownerCookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
    const owner = { cookie: ownerCookie, origin: s.url, 'content-type': 'application/json', connection: 'close' };
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, 'content-type': 'application/json', connection: 'close' };
    const pid = ((await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'agent-ui', width: 640, height: 360 }) })).json()) as any).project.id as string;
    const wav = path.join(art, 'tone.wav');
    try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'pcm_s16le', wav]); } catch { report('U the «סוכן» tab in Chromium', 'blocked', 'ffmpeg is not on PATH'); return; }
    const up = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: h.authorization, 'x-filename': 'tone.wav', connection: 'close' }, body: fs.readFileSync(wav) })).json() as any;
    for (let i = 0; i < 100; i++) { const d = await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json() as any; if (d.project.assets[up.assetId]) break; await new Promise((r) => setTimeout(r, 100)); }
    await fetch(`${s.url}/api/v1/projects/${pid}/transactions`, { method: 'POST', headers: h, body: JSON.stringify({ ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: T.frameTime(0, { num: 30, den: 1 }) } }] }) });
    // a LAN address over plain http for llama.cpp (the owner's own setting, through the owner floor)
    await fetch(`${s.url}/api/v1/agent/providers/llamacpp`, { method: 'PUT', headers: owner, body: JSON.stringify({ baseUrl: 'http://192.168.1.20:9931/v1' }) });

    let browser;
    try { browser = await chromium.launch(); } catch (e) { report('U the «סוכן» tab in Chromium', 'blocked', `Chromium did not start: ${String(e).slice(0, 200)}`); return; }
    try {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
      await page.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
      const runReads: number[] = [];
      page.on('request', (r) => { if (/\/agent\/runs\/run_[^/?]+$/.test(new URL(r.url()).pathname) && r.method() === 'GET') runReads.push(Date.now()); });
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('timecode').waitFor();
      await page.getByTestId('rail-ai').click();
      const tab = page.getByTestId('agent-tab');
      await tab.waitFor({ timeout: 15000 });
      const rows = page.locator('[data-testid=agent-provider]');
      await rows.first().waitFor();
      report('U1 the tab replaces the empty chat panel (tabpanel, the Copilot\'s panel id), right to left', (await tab.getAttribute('role')) === 'tabpanel' && (await tab.getAttribute('id')) === 'pf-cop-panel-chat' && (await count(page, 'copilot-not-connected')) === 0 && (await tab.evaluate((e) => getComputedStyle(e).direction)) === 'rtl' ? 'pass' : 'fail');
      report('U2 not connected: the connect card only, one row per preset, and no goal box or start button that cannot work', (await rows.count()) === AGENT_PROVIDER_PRESETS.length && (await count(page, 'agent-goal')) === 0 && (await count(page, 'agent-start')) === 0 && HEBREW.test((await page.getByTestId('agent-connect').textContent()) ?? '') ? 'pass' : 'fail', { rows: await rows.count(), presets: AGENT_PROVIDER_PRESETS.length });
      const sent = (await page.getByTestId('agent-sent-line').textContent()) ?? '';
      report('U3 the one line on what is sent is visible and is information, not a question', ['תמונות', 'התמלולים', 'שמות', 'ההוראות'].every((w) => sent.includes(w)) && !sent.includes('?') && (await page.getByTestId('agent-sent-line').isVisible()) ? 'pass' : 'fail', sent);
      const lan = page.locator('[data-testid=agent-provider][data-provider=llamacpp]');
      report('U4 a local preset on a LAN plain-http address says the connection is not encrypted; no key field; the small-model line', (await lan.getByTestId('agent-unencrypted').count()) === 1 && (await lan.getByTestId('agent-key').count()) === 0 && (await lan.getByTestId('agent-local-small').count()) === 1 ? 'pass' : 'fail');
      report('U5 a compatible-endpoint provider says so', (await page.locator('[data-provider=gemini]').getByTestId('agent-compat').count()) === 1 ? 'pass' : 'fail');
      // «בדיקה» against the labelled local double: address, model and key typed in the card, saved first by the probe
      const claude = page.locator('[data-testid=agent-provider][data-provider=anthropic]');
      await claude.getByTestId('agent-base-url').fill(dblBase);
      await claude.getByTestId('agent-model').fill('claude-opus-5-5');
      await claude.getByTestId('agent-key').fill(FAKE_KEY);
      await claude.getByTestId('agent-probe').click();
      const pr = claude.getByTestId('agent-probe-result');
      await pr.waitFor({ timeout: 15000 });
      const detail = (await claude.getByTestId('agent-probe-detail').textContent().catch(() => null)) ?? '';
      report('U6 a probe failure is worded with its next step, with the provider\'s words under it and the key redacted (lead decision 7)', (await pr.getAttribute('data-code')) === 'unauthorized' && /הדביקו/.test((await pr.textContent()) ?? '') && detail.includes('[redacted]') && !detail.includes(FAKE_KEY) ? 'pass' : 'fail', { result: await pr.textContent(), detail });
      // the key is stored by the probe's save: connected now
      await page.getByTestId('agent-goal').waitFor({ timeout: 15000 });
      report('U7 after the key is stored the key field is empty again and the page holds the key nowhere; the goal box appears only now', (await claude.getByTestId('agent-key').inputValue()) === '' && (await claude.getByTestId('agent-forget-key').count()) === 1 && !(await page.content()).includes(FAKE_KEY) ? 'pass' : 'fail');
      // keyboard path: goal → start (Ctrl+Enter)
      await page.getByTestId('agent-goal').focus();
      await page.keyboard.type('תסמנו את ההתחלה ותייצאו');
      await page.keyboard.press('Control+Enter');
      await page.getByTestId('agent-run').waitFor({ timeout: 15000 });
      const stepRows = page.getByTestId('agent-step');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid=agent-step][data-kind=tool]').length >= 3, null, { timeout: 60000 });
      const st = page.getByTestId('agent-status');
      report('U8 the live run (MOCK model, real loop): status running, «צעד N מתוך 100», a cost line from the table\'s prices', (await st.getAttribute('data-status')) === 'running' && /צעד \d+ מתוך 100/.test((await page.getByTestId('agent-counter').textContent()) ?? '') && HEBREW.test((await page.getByTestId('agent-cost').textContent()) ?? '') ? 'pass' : 'fail', { counter: await page.getByTestId('agent-counter').textContent(), cost: await page.getByTestId('agent-cost').textContent() });
      const items = page.getByTestId('agent-plan-item');
      report('U9 the plan the model wrote (update_plan) lists its items with their status', (await items.count()) === 3 && (await items.nth(1).getAttribute('data-status')) === 'running' ? 'pass' : 'fail');
      // the picture it looked at: the render_frame step, expanded; drawn while the project is at that revision
      const renderRow = page.locator('[data-testid=agent-step][data-kind=tool]').nth(2);
      await renderRow.locator('summary').click();
      const img = renderRow.locator('[data-testid=agent-step-image] img');
      await img.waitFor({ timeout: 15000 });
      await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>('[data-testid=agent-step-image] img'); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
      const callText = (await renderRow.textContent()) ?? '';
      report('U10 an expanded call shows the arguments, the answer and the picture it looked at as a thumbnail drawn by the editor (lead decision 7)', /frameIndex/.test(callText) && /"revision"/.test(callText) && (await renderRow.getByTestId('agent-step-image').getAttribute('data-shown')) === 'true' ? 'pass' : 'fail');
      // no poll: while the model waits, nothing changes and the tab reads nothing; the release moves it through the job events only
      await renderRow.locator('summary').focus();
      const quietFrom = Date.now();
      await page.waitForTimeout(9000);
      const quietReads = runReads.filter((t) => t >= quietFrom).length;
      release();
      await page.waitForFunction(() => document.querySelector('[data-testid=agent-status]')?.getAttribute('data-status') === 'provider_unavailable', null, { timeout: 30000 });
      const why = (await st.textContent()) ?? '';
      report('U11 no poll: 9 s with nothing new read the run 0 times; the store\'s forwarded agent.run event brought the next state (lead decision 7)', quietReads === 0 ? 'pass' : 'fail', { readsWhileQuiet: quietReads });
      report('U12 a provider failure says WHY on the same line and offers «להמשיך»; the refresh kept the expanded call open and the focus on its row', /הספק לא זמין/.test(why) && /המפתח לא התקבל/.test(why) && /להמשיך/.test((await page.getByTestId('agent-continue').textContent()) ?? '')
        && (await renderRow.locator('details').evaluate((d) => (d as HTMLDetailsElement).open)) && (await page.evaluate(() => document.activeElement?.tagName)) === 'SUMMARY' ? 'pass' : 'fail', why);
      // continue → export → finish
      await page.getByTestId('agent-continue').click();
      await page.waitForFunction(() => document.querySelector('[data-testid=agent-status]')?.getAttribute('data-status') === 'succeeded', null, { timeout: 120000 });
      const nu = page.getByTestId('agent-not-undone');
      await nu.locator('[data-testid=agent-not-undone-item]').first().waitFor({ timeout: 15000 });
      const kinds = await nu.locator('[data-testid=agent-not-undone-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
      report('U13 after «להמשיך» the run finished; «לא בוטל: …» is under «ביטול הכול» BEFORE pressing it (an export file, money, data sent)', ['export_file', 'money_spent', 'data_sent'].every((k) => kinds.includes(k)) && /לא בוטל/.test((await nu.textContent()) ?? '') ? 'pass' : 'fail', kinds);
      // the owner changes the run's marker in between: undo-all is refused with the conflict list, then «ביטול מה שאפשר»
      const doc = await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json() as any;
      const markerId = Object.entries(doc.project.markers ?? {}).find(([, m]) => (m as { label: string }).label === 'התחלה')?.[0];
      await fetch(`${s.url}/api/v1/projects/${pid}/transactions`, { method: 'POST', headers: owner, body: JSON.stringify({ ops: [{ op: 'update_marker', args: { markerId, label: 'של הבעלים' } }] }) });
      await page.waitForFunction(() => document.querySelector('[data-testid=agent-step-image]')?.getAttribute('data-shown') === 'false', null, { timeout: 15000 }).catch(() => {});
      const changedShown = await renderRow.getByTestId('agent-step-image').getAttribute('data-shown');
      await page.getByTestId('agent-undo-all').click();
      await page.getByTestId('agent-undo-conflicts').waitFor({ timeout: 15000 });
      const conflictsText = (await page.getByTestId('agent-undo-conflicts').textContent()) ?? '';
      await page.getByTestId('agent-undo-partial').click();
      await page.getByText('הריצה בוטלה').waitFor({ timeout: 15000 });
      const after = await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json() as any;
      report('U14 the owner\'s edit in between: «ביטול הכול» shows the conflict list and «ביטול מה שאפשר», which undoes the rest and keeps the owner\'s marker; the thumbnail is no longer drawn once the project moved on', HEBREW.test(conflictsText) && after.project.markers?.[markerId!]?.label === 'של הבעלים' && changedShown === 'false' ? 'pass' : 'fail', { conflictsText: conflictsText.slice(0, 200), marker: after.project.markers?.[markerId!]?.label, thumbnailAfterChange: changedShown });
      await page.screenshot({ path: path.join(art, 'agent-tab-he.png') });
    } finally { await browser.close(); }
  } finally {
    await s.close();
    await new Promise<void>((r) => dbl.close(() => r()));
    fs.rmSync(path.join(art, 'data'), { recursive: true, force: true });
    fs.rmSync(path.join(art, 'tone.wav'), { force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const rows: UiStatus[] = [];
  await runAgentUiProof((id, status, detail) => { rows.push(status); console.log(`${status === 'pass' ? '  ok   ' : status === 'fail' ? ' FAIL  ' : ' BLOCK '} ${id}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 600)}` : ''}`); });
  const failed = rows.filter((r) => r === 'fail').length;
  console.log(`\n${rows.filter((r) => r === 'pass').length}/${rows.length} rows passed (the MOCK scripted model: not a model run)`);
  process.exit(failed ? 1 : rows.includes('blocked') ? 2 : 0);
}
