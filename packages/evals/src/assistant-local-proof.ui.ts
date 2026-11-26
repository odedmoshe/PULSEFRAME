/**
 * proof:assistant-local — the browser part (builder C, wave 7 assistant track): check L13 of assistant-local-proof.ts. One server (this
 * process, a free 127.0.0.1 port, data in .artifacts/assistant-local-proof-ui-<pid>, deleted on exit) with the production local adapter,
 * one labelled STAND-IN of llama.cpp's server (apps/server/src/assistant/local/standIn.ts) on an ephemeral 127.0.0.1 port, one Chromium.
 * NO MODEL RUNS: the check is about the editor's own behaviour from the keyboard (the row, the insertion, the badge, the grammar's own
 * preview, one commit, the honest «not understood»), never about a model's quality. Hebrew and English.
 *
 * L13 needs builder A's core groundLocalAnswer and localPhrase: until they are merged (core LOCAL_INTENT_BUILT false) every local request
 * answers 501 not_built (nothing is sent). The check then runs as far as it can (the row appears under an unknown request, Tab reaches
 * «לשאול את העוזר המקומי», Enter asks, the refusal is shown in words with no phrase and no insert button) and FAILS with a sentence
 * that says exactly that: never a pass, never skipped. It does not name the phrase A renders (A's templates are A's): it checks that the
 * phrase the row shows is the phrase that lands in the input, that the bar's own grammar reads it as gain_change, and that Enter makes
 * ONE transaction labelled «Command bar: gain_change» at the shown revision.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { barUnderstands, LOCAL_INTENT_BUILT } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { createLlamaAdapter } from '@pulseframe/server/assistant/local/llamaAdapter.ts';
import { startStandIn, type StandIn } from '@pulseframe/server/assistant/local/standIn.ts';
import { BEAT_SR } from '../../../apps/server/src/beats.ts';
import { drumLoop } from '../../../apps/server/src/beats.fixtures.ts';
import { COMMAND_BAR_TESTIDS as TID } from '../../../apps/web/src/editor/commandBar/commandBar.testids.ts';
import type { AssistantLocalProofPart } from './assistant-local-proof.server.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, `.artifacts/assistant-local-proof-ui-${process.pid}`);
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GAIN6 = JSON.stringify({ intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' } });
const NONE = '{"intent":"none","slots":{}}';
/** Requests the bar's own grammar does not read (checked at run time with barUnderstands), and what the labelled stand-in answers to each. */
const ASK = {
  he: { loud: 'המוזיקה חזקה מדי, תורידי אותה בשש דציבל', noise: 'תעשה שזה יהיה מרגש' },
  en: { loud: 'the music is way too loud, please bring it down six decibels', noise: 'make it feel more exciting' },
} as const;
const WORDS = {
  he: { ask: 'לשאול את העוזר המקומי', insert: 'הכנס לשורה', ignore: 'התעלם', badge: 'הצעת העוזר — בדקו לפני Enter', none: 'העוזר לא מצא פקודה מתאימה' },
  en: { ask: 'Ask the local assistant', insert: 'Put in the bar', ignore: 'Ignore', badge: 'The assistant\'s suggestion — check before Enter', none: 'The assistant found no matching command' },
} as const;
const MONEY = /חויב|חיוב|שחרור הסכום|charge|reserv|billed/i;

let server: RunningServer | null = null, stand: StandIn | null = null, browser: Browser | null = null;
let once: Promise<true | string> | null = null;


async function fixtureProject(s: RunningServer, name: string): Promise<string> {
  fs.mkdirSync(art, { recursive: true });
  // «המוזיקה» is the audio track whose clip has a beat analysis (core trackRole): a drum loop, analysed below, as proof:command-bar does
  const wav = path.join(art, 'song.wav');
  if (!fs.existsSync(wav)) {
    const loop = drumLoop(() => 120, 16, 0.5, 9); const raw = path.join(art, 'm.f32');
    fs.writeFileSync(raw, Buffer.from(loop.x.buffer, loop.x.byteOffset, loop.x.byteLength));
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'f32le', '-ar', String(BEAT_SR), '-ac', '1', '-i', raw, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', wav], { maxBuffer: 1 << 26 });
  }
  const auth = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const made = await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ name, width: 640, height: 360, frameRate: { num: 30, den: 1 } }) });
  const pid = (await made.json() as { project: { id: string } }).project.id;
  const up = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...auth, 'x-filename': 'song.wav' }, body: fs.readFileSync(wav) });
  const assetId = (await up.json() as { assetId: string }).assetId;
  const tx = await fetch(`${s.url}/api/v1/projects/${pid}/transactions`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ op: 'add_clip', args: { assetId, start: { value: '0', timescale: 30 }, withLinkedAudio: false } }] }) });
  if (tx.status !== 200) throw new Error(`the fixture clip was refused: ${tx.status}`);
  const beats = await fetch(`${s.url}/api/v1/projects/${pid}/assets/${assetId}/analyze`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'beats' }) });
  if (beats.status !== 200) throw new Error(`the fixture's beat analysis was refused: ${beats.status}`);
  return pid;
}

interface Run { trail: string[]; failed: string[] }

async function openPalette(page: Page) {
  if (await page.getByTestId('palette-dialog').count()) return;
  await page.getByTestId('open-palette').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('palette-input').waitFor({ timeout: 8000 });
}
async function typeRequest(page: Page, text: string) {
  await openPalette(page);
  await page.getByTestId('palette-input').press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
  await page.waitForFunction((q) => document.querySelector<HTMLInputElement>('[data-testid=palette-input]')?.value === q && !!document.querySelector<HTMLElement>('[data-testid=bar-result]')?.dataset.kind, text, { timeout: 8000 });
}
const focused = (page: Page) => page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? (a.dataset.testid ?? a.tagName.toLowerCase()) : 'none'; });
/** Tab from where the focus is until `testId` has it (at most `max` presses, none may leave the dialog); the number of presses, or null. */
async function tabTo(page: Page, testId: string, max = 14): Promise<number | null> {
  for (let i = 0; i <= max; i++) {
    if ((await focused(page)) === testId) return i;
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement && !!document.querySelector('[data-testid=palette-dialog]')?.contains(document.activeElement));
    if (!inside) return null;
  }
  return null;
}
const txCount = (s: RunningServer, pid: string) => (s.store.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE project_id = ?').get(pid) as { n: number }).n;
const lastTx = (s: RunningServer, pid: string) => s.store.db.prepare('SELECT id, label, actor, kind, undoes FROM transactions WHERE project_id = ? ORDER BY revision DESC LIMIT 1').get(pid) as { id: string; label: string; actor: string; kind: string; undoes: string | null } | undefined;

async function oneLanguage(s: RunningServer, st: StandIn, br: Browser, lang: 'he' | 'en'): Promise<Run> {
  const run: Run = { trail: [], failed: [] };
  const step = (ok: boolean, say: string) => { run.trail.push(`${ok ? 'ok' : 'FAIL'} ${say}`); if (!ok) run.failed.push(`${lang}: ${say}`); return ok; };
  const W = WORDS[lang], T = ASK[lang];
  for (const t of Object.values(T)) if (barUnderstands(t)) { run.failed.push(`${lang}: the proof's own request «${t}» is read by the bar's grammar, so the row would not be offered`); return run; }
  const pid = await fixtureProject(s, `assistant-local-ui-${lang}`);
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript('globalThis.__name = (f) => f');
  await ctx.addInitScript(([l]) => { try { localStorage.setItem('pf.lang', l!); localStorage.setItem('pf.theme', 'dark'); } catch { /* storage unavailable */ } }, [lang] as const);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('timecode').waitFor({ timeout: 30000 });
    if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.getByTestId('lang-toggle').click();
    // the owner's own session, from the page: the local adapter with the stand-in's port (nothing else is set)
    const put = await page.evaluate(async (port) => { const r = await fetch('/api/v1/assistant/config', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adapter: 'local-llama-server', host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0, toggles: { titlesAndMarkers: false, peopleNames: false }, local: { port, timeoutSeconds: 60 } }) }); return r.status; }, st.port);
    if (!step(put === 200, `the owner saved the local port (answer ${put})`)) return run;
    step(await page.evaluate(() => getComputedStyle(document.documentElement).direction) === (lang === 'he' ? 'rtl' : 'ltr'), `the page direction is ${lang === 'he' ? 'rtl' : 'ltr'}`);

    // ---- an unknown request: the row offers the question, reached with the keyboard
    await typeRequest(page, T.loud);
    step(await page.getByTestId('bar-result').getAttribute('data-kind') === 'unknown', 'the bar reads the request as unknown');
    await page.getByTestId(TID.assistantLocalAsk).waitFor({ timeout: 8000 }).catch(() => {});
    const askButton = page.getByTestId(TID.assistantLocalAsk);
    if (!step((await askButton.count()) === 1 && (await askButton.textContent())?.trim() === W.ask, `«${W.ask}» is offered`)) return run;
    const tabs = await tabTo(page, TID.assistantLocalAsk);
    if (!step(tabs !== null, `Tab from the input reaches the question (${tabs} presses, none left the dialog)`)) return run;
    const before = txCount(s, pid), rev0 = s.store.getProject(pid).revision;
    await page.keyboard.press('Enter');

    // ---- the answer
    if (!LOCAL_INTENT_BUILT) {
      // builder A's core is not merged: the server answers 501 not_built; the row must say so in words and offer no phrase
      await page.locator(`[data-local-state=failed]`).waitFor({ timeout: 10000 }).catch(() => {});
      const failed = await page.locator('[data-local-state=failed]').textContent().catch(() => null);
      step(!!failed && (lang === 'he' ? /[א-ת]/.test(failed) : true), `the refusal is shown in words (${JSON.stringify((failed ?? '').slice(0, 120))})`);
      step((await page.getByTestId(TID.assistantLocalInsert).count()) === 0 && (await page.getByTestId(TID.assistantLocalSuggestion).count()) === 0, 'no phrase and no «הכנס לשורה» after the refusal');
      step(!MONEY.test(failed ?? ''), 'no money word in the refusal');
      step(txCount(s, pid) === before && s.store.getProject(pid).revision === rev0, 'nothing was committed');
      run.failed.push(`${lang}: BLOCKED — core LOCAL_INTENT_BUILT is false (builder A not merged), so the server answered 501 not_built and no phrase exists to insert; the steps after the answer (insert, badge, preview, Enter, one commit, intent none) did not run`);
      return run;
    }
    await page.getByTestId(TID.assistantLocalSuggestion).waitFor({ timeout: 40000 }).catch(() => {});
    if (!step((await page.getByTestId(TID.assistantLocalSuggestion).count()) === 1, 'the suggestion appears')) return run;
    const phrase = (await page.locator(`[data-testid=${TID.assistantLocalSuggestion}] [dir=auto]`).textContent())?.trim() ?? '';
    step(phrase.length > 0 && (await page.locator(`[data-testid=${TID.assistantLocalSuggestion}] [dir=auto]`).count()) === 1, `the phrase is in ONE dir=auto span (${JSON.stringify(phrase)})`);
    step((await page.getByTestId(TID.assistantLocalSuggestion).getAttribute('data-intent')) === 'gain_change', 'the suggestion says it is gain_change');
    step((await focused(page)) === TID.assistantLocalInsert || (await tabTo(page, TID.assistantLocalInsert)) !== null, '«הכנס לשורה» has the keyboard focus (or one Tab reaches it)');
    step(await page.evaluate(() => !!document.querySelector('[data-testid=bar-result]') && document.querySelectorAll('[data-testid=palette-dialog] [role=option][aria-disabled=true]').length === 0), 'no disabled option in the listbox');
    step(st.requests.filter((r) => r.path === '/v1/chat/completions').length >= 1 && s.store.getProject(pid).revision === rev0, 'the answer arrived and nothing changed in the project yet');

    // ---- insert: the phrase is in the input, the badge shows, the bar's own grammar previews it
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => document.querySelector<HTMLInputElement>('[data-testid=palette-input]')?.value === p, phrase, { timeout: 8000 }).catch(() => {});
    const input = await page.evaluate(() => { const i = document.querySelector<HTMLInputElement>('[data-testid=palette-input]')!; return { value: i.value, start: i.selectionStart, end: i.selectionEnd, focused: document.activeElement === i }; });
    step(input.value === phrase, 'the input holds exactly the phrase the row showed');
    step(input.focused && input.start === input.value.length && input.end === input.value.length, 'the focus is in the input with the caret at the end');
    step((await page.getByTestId(TID.assistantLocalBadge).count()) === 1 && (await page.getByTestId(TID.assistantLocalBadge).textContent())?.trim() === W.badge, `the badge «${W.badge}» shows`);
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid=bar-result]')?.dataset.kind === 'plan', undefined, { timeout: 8000 }).catch(() => {});
    const bar = await page.evaluate(() => { const r = document.querySelector<HTMLElement>('[data-testid=bar-result]'); return { kind: r?.dataset.kind ?? null, intent: r?.dataset.intent ?? null, steps: document.querySelectorAll('[data-testid=bar-step]').length }; });
    step(bar.kind === 'plan' && bar.intent === 'gain_change' && bar.steps >= 1, `the bar's own grammar shows its preview (${JSON.stringify(bar)})`);
    await page.waitForFunction(() => { const r = document.querySelector<HTMLElement>('[data-testid=bar-result]'); return r?.dataset.kind === 'plan' && (window as unknown as { __pfBar?: { lastPlan?: { planHash?: string } } }).__pfBar?.lastPlan?.planHash === r.dataset.planHash; }, undefined, { timeout: 8000 }).catch(() => {});
    step(s.store.getProject(pid).revision === rev0 && txCount(s, pid) === before, 'inserting committed nothing');
    // the server forgot the typed text: the job's phrase is cleared once the tab has taken it
    const jobRow = s.store.db.prepare("SELECT output FROM jobs WHERE project_id = ? AND type = 'assistant.propose' ORDER BY rowid DESC LIMIT 1").get(pid) as { output: string } | undefined;
    const out = jobRow ? JSON.parse(jobRow.output) as { cleared?: boolean; phrase: string | null; slots: unknown } : null;
    step(!!out && out.cleared === true && out.phrase === null && JSON.stringify(out.slots) === '{}', 'the server cleared the phrase (taken)');

    // ---- Enter commits exactly one transaction, at the shown revision, labelled with the intent
    await page.keyboard.press('Enter');
    for (const t0 = Date.now(); Date.now() - t0 < 15000 && s.store.getProject(pid).revision === rev0; await sleep(60));
    const tx = lastTx(s, pid);
    step(s.store.getProject(pid).revision === rev0 + 1 && txCount(s, pid) === before + 1, `exactly one transaction was made (revision ${rev0} → ${s.store.getProject(pid).revision})`);
    step(tx?.label === 'Command bar: gain_change' && tx.actor === 'user:local', `its label is «Command bar: gain_change», by the owner (${JSON.stringify(tx)})`);
    await page.getByTestId('palette-dialog').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    step((await page.getByTestId('palette-dialog').count()) === 0, 'the palette closed after the commit');

    // ---- not understood: a request the stand-in answers «none»: its sentence, no phrase, no button, nothing committed
    const rev1 = s.store.getProject(pid).revision, n1 = txCount(s, pid);
    await typeRequest(page, T.noise);
    await page.getByTestId(TID.assistantLocalAsk).waitFor({ timeout: 8000 });
    await tabTo(page, TID.assistantLocalAsk);
    await page.keyboard.press('Enter');
    await page.locator('[data-local-state=none]').waitFor({ timeout: 40000 }).catch(() => {});
    const noneText = await page.locator('[data-local-state=none]').textContent().catch(() => null);
    step(!!noneText && noneText.includes(W.none), `intent none shows its sentence (${JSON.stringify((noneText ?? '').slice(0, 80))})`);
    step((await page.getByTestId(TID.assistantLocalInsert).count()) === 0 && (await page.getByTestId(TID.assistantLocalSuggestion).count()) === 0, 'no phrase and no «הכנס לשורה» for intent none');
    step(s.store.getProject(pid).revision === rev1 && txCount(s, pid) === n1, 'intent none committed nothing');
    await page.keyboard.press('Escape');
    step(errors.length === 0, `no page error (${errors.slice(0, 2).join(' | ')})`);
  } catch (e) {
    run.failed.push(`${lang}: error: ${(e as Error).message}`);
  } finally {
    await ctx.close().catch(() => {});
  }
  return run;
}

async function runL13(): Promise<true | string> {
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) return 'web bundle missing: run `pnpm build` first';
  fs.mkdirSync(art, { recursive: true });
  stand = await startStandIn({ answers: { [ASK.he.loud]: GAIN6, [ASK.he.noise]: NONE, [ASK.en.loud]: GAIN6, [ASK.en.noise]: NONE } });
  server = await startServer({ port: 0, host: '127.0.0.1', dataDir: path.join(art, 'data'), backupDir: null }, { assistant: { adapters: new Map(), endpoint: () => null, local: createLlamaAdapter({}) } });
  browser = await chromium.launch();
  const out: Run[] = [];
  for (const lang of ['he', 'en'] as const) out.push(await oneLanguage(server, stand, browser, lang));
  const failed = out.flatMap((r) => r.failed);
  if (process.env.PF_PROOF_TRAIL === '1') for (const r of out) console.log(r.trail.join('\n'));
  return failed.length === 0 ? true : failed.join('; ');
}

export const ASSISTANT_LOCAL_PROOF_UI: AssistantLocalProofPart = {
  built: true,
  checks: { L13: () => (once ??= runL13().catch((e: unknown) => `error: ${(e as Error)?.message ?? String(e)}`)) },
};
/** Stops the browser, the proof's server and the stand-in, and deletes the data folder (the entry exits the process; a runner that does not can call this). */
export async function stopAssistantLocalProofUi() {
  if (browser) { const b = browser; browser = null; await b.close().catch(() => {}); }
  if (server) { const s = server; server = null; await s.close(); }
  if (stand) { const x = stand; stand = null; await x.close(); }
  try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ }
}

// ---------------------------------------------------------------- accessibility scenarios (hooked in a11y-audit.ts, the end of the wave 7 block)
export interface AssistantLocalA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface AssistantLocalA11yScenario {
  id: string;
  prepare(ctx: AssistantLocalA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: AssistantLocalA11yCtx): Promise<void>;
}
/**
 * The audit's server has no local adapter installed, so each scenario answers the editor's own requests with CONTRACT-SHAPED fixtures
 * through page.route (the status of an owner with the local adapter ready, the check, the job): said so in `detail`. What is audited is
 * how the interface renders and is reached from the keyboard, never an answer of a model.
 */
const FIXTURE_NOTE = 'contract-shaped fixtures answered by page.route (no model, no server answer); audits the rendering only';
const statusFixture = (check: unknown) => ({ setup: 'ready', detail: 'ready', adapter: 'local-llama-server', host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0, month: '2026-11', spentCents: 0, reservedCents: 0, held: [], toggles: { titlesAndMarkers: false, peopleNames: false }, keySet: false, keyAddedAt: null, adapters: [], local: { port: 8791, timeoutSeconds: 60, lastCheck: check } });
const phrases = { he: 'הנמך את המוזיקה ב־6 דציבל', en: 'lower the music by 6 dB' };
type Job = Record<string, unknown>;
async function routes(page: Page, o: { check?: unknown; job?: Job | null }) {
  await page.route('**/api/v1/assistant/status', (r) => r.fulfill({ json: statusFixture(o.check ?? null) }));
  await page.route('**/api/v1/assistant/local/check', (r) => r.fulfill({ json: o.check ?? { state: 'stopped', model: null, checkedAt: '2026-11-25T10:00:00.000Z' } }));
  await page.route('**/api/v1/projects/*/assistant/requests', (r) => r.fulfill({ status: 202, json: { jobId: 'a11y-local-job' } }));
  await page.route('**/api/v1/jobs/a11y-local-job', (r) => r.fulfill({ json: { id: 'a11y-local-job', type: 'assistant.propose', status: 'running', stage: 'awaiting-local-model', output: null, error: null, attempt: 1, ...(o.job ?? {}) } }));
  await page.route('**/api/v1/assistant/jobs/*/taken', (r) => r.fulfill({ status: 204, body: '' }));
}
const open = async (ctx: AssistantLocalA11yCtx) => {
  const origin = new URL(ctx.page.url()).origin;
  await ctx.page.goto(`${origin}/?project=${ctx.pid}`);
  await ctx.page.getByTestId('timecode').waitFor();
  if ((await ctx.page.evaluate(() => document.documentElement.lang)) !== ctx.lang) await ctx.page.locator('[data-testid=lang-toggle]').click().catch(() => {});
};
const close = async (page: Page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(150); await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); };
async function settingsWith(ctx: AssistantLocalA11yCtx, check: unknown) {
  const { page } = ctx;
  await routes(page, { check });
  await open(ctx);
  await page.getByTestId('rail-settings').click();
  await page.getByTestId('assistant-settings').waitFor({ timeout: 8000 }).catch(() => {});
  await page.getByTestId('assistant-adapter').selectOption('local-llama-server').catch(() => {});
  await page.getByTestId(TID.assistantLocalSettings).waitFor({ timeout: 5000 }).catch(() => {});
  if (check) { await page.getByTestId(TID.assistantLocalCheck).click().catch(() => {}); await page.waitForTimeout(300); }
  await page.getByTestId(TID.assistantLocalSettings).scrollIntoViewIfNeeded().catch(() => {});
  return { shown: (await page.getByTestId(TID.assistantLocalSettings).count()) === 1 && (await page.getByTestId('assistant-host').count()) === 0 && (await page.getByTestId('assistant-key').count()) === 0 };
}
async function rowWith(ctx: AssistantLocalA11yCtx, job: Job | null, through: 'offer' | 'asked') {
  const { page, lang } = ctx;
  await routes(page, { job });
  await open(ctx);
  await page.getByTestId('open-palette').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('palette-input').waitFor({ timeout: 8000 });
  await page.keyboard.type(ASK[lang].loud);
  await page.getByTestId(TID.assistantLocalAsk).waitFor({ timeout: 8000 }).catch(() => {});
  if (through === 'asked') { await tabTo(page, TID.assistantLocalAsk); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); }
  return page;
}
const done = { status: 'succeeded', stage: null, error: null };
const out = (over: Record<string, unknown>) => ({ kind: 'local-intent', intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' }, dropped: [], phrase: null, model: 'MODEL-FIXTURE.gguf', wallMs: 900, ...over });
const detail = (extra: Record<string, unknown> = {}) => ({ fixture: FIXTURE_NOTE, ...extra });
export const assistantLocalA11yScenarios: readonly AssistantLocalA11yScenario[] = [
  { id: 'assistant-local-settings-running', async prepare(c) { const r = await settingsWith(c, { state: 'running', model: 'MODEL-FIXTURE.gguf', checkedAt: '2026-11-25T10:00:00.000Z' }); return { ...r, modal: true, detail: detail({ state: 'running' }) }; }, leave: async (c) => close(c.page) },
  { id: 'assistant-local-settings-stopped', async prepare(c) { const r = await settingsWith(c, { state: 'stopped', model: null, checkedAt: '2026-11-25T10:00:00.000Z' }); return { ...r, modal: true, detail: detail({ state: 'stopped' }) }; }, leave: async (c) => close(c.page) },
  { id: 'assistant-local-settings-not-llama', async prepare(c) { const r = await settingsWith(c, { state: 'not_llama', model: null, checkedAt: '2026-11-25T10:00:00.000Z' }); return { ...r, modal: true, detail: detail({ state: 'not_llama' }) }; }, leave: async (c) => close(c.page) },
  { id: 'assistant-local-row-offer', async prepare(c) { const p = await rowWith(c, null, 'offer'); return { shown: (await p.getByTestId(TID.assistantLocalAsk).count()) === 1, modal: true, detail: detail() }; }, leave: async (c) => close(c.page) },
  { id: 'assistant-local-row-thinking', async prepare(c) { const p = await rowWith(c, { status: 'running', stage: 'awaiting-local-model' }, 'asked'); return { shown: (await p.getByTestId(TID.assistantStage).count()) === 1 && (await p.getByTestId(TID.assistantCancel).count()) === 1, modal: true, detail: detail() }; }, leave: async (c) => close(c.page) },
  { id: 'assistant-local-row-suggested', async prepare(c) { const p = await rowWith(c, { ...done, output: out({ phrase: phrases[c.lang] }) }, 'asked'); return { shown: (await p.getByTestId(TID.assistantLocalSuggestion).count()) === 1 && (await p.getByTestId(TID.assistantLocalInsert).count()) === 1, modal: true, detail: detail() }; }, leave: async (c) => close(c.page) },
  { id: 'assistant-local-row-inserted', async prepare(c) { const p = await rowWith(c, { ...done, output: out({ phrase: phrases[c.lang] }) }, 'asked'); await p.getByTestId(TID.assistantLocalInsert).click().catch(() => {}); await p.waitForTimeout(500); return { shown: (await p.getByTestId(TID.assistantLocalBadge).count()) === 1, modal: true, detail: detail() }; }, leave: async (c) => close(c.page) },
  { id: 'assistant-local-row-none', async prepare(c) { const p = await rowWith(c, { ...done, output: out({ intent: 'none', slots: {}, phrase: null }) }, 'asked'); return { shown: (await p.locator('[data-local-state=none]').count()) === 1 && (await p.getByTestId(TID.assistantLocalInsert).count()) === 0, modal: true, detail: detail() }; }, leave: async (c) => close(c.page) },
  { id: 'assistant-local-row-not-running', async prepare(c) { const p = await rowWith(c, { status: 'failed', stage: null, output: null, error: { code: 'local_not_running', message: 'the local assistant is not running on this computer; start it as the guide says, then ask again', hint: 'Start it.' } }, 'asked'); return { shown: (await p.locator('[data-local-state=failed]').count()) === 1 && (await p.getByTestId(TID.assistantLocalInsert).count()) === 0, modal: true, detail: detail() }; }, leave: async (c) => close(c.page) },
];

// run alone: `tsx packages/evals/src/assistant-local-proof.ui.ts` prints L13's result (the entry assistant-local-proof.ts imports the part instead)
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await ASSISTANT_LOCAL_PROOF_UI.checks.L13!();
  await stopAssistantLocalProofUi();
  console.log(r === true ? 'L13 pass' : `L13 FAIL: ${r}`);
  process.exit(r === true ? 0 : 1);
}
