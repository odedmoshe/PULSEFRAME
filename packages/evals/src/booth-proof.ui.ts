/**
 * proof:booth — the browser part (builder W3, wave 8 booth): B12–B14 of booth-proof.ts. Imported by the lead's entry point at integration;
 * export `runBoothUiProof()`. NOT run by its builder (the lead runs it, one browser at a time, after `pnpm build`).
 *
 * REAL and STAND-IN, said exactly:
 * - REAL: one server of this process (free 127.0.0.1 port, data in a temporary folder deleted on exit); the owner's page opens with the owner link;
 *   Chromium under Playwright; every key is a keyboard event (`page.keyboard`), the focus, the live region, the audio element's currentTime and the
 *   clipboard are read from the page; the stored answer is read back from the real server through the page's own cookie.
 * - STAND-IN (labelled in the row's own words): a session that is not the owner's is the same editor with `GET /api/v1/session` answered by a Playwright
 *   route as another actor (the editor itself opens as owner only through a key link); what it proves is that the page draws no entry and asks no booth route.
 * - Headless Chromium here may have no WebGPU adapter: then the picture cards say «booth.needsGpu» and B13 is reported BLOCKED with that reason, never passed.
 *   While the report body (core boothReport) is not merged the box says so and B14 is BLOCKED with that reason.
 * Nobody here can listen or look: every check is a measurement of the page (text, states, focus, currentTime, counts, times, bytes of the clipboard).
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { BOOTH_FIRST_SITTING_CARDS } from '@pulseframe/core';
import { SCREEN_FLASH_GAP } from '@pulseframe/engine';
import { startServer, type RunningServer } from '@pulseframe/server';
import { BOOTH_TESTIDS as ID } from '../../../apps/web/src/editor/booth/booth.testids.ts';
import { makeSay } from '../../../apps/web/src/editor/booth/booth.strings.ts';

export type BoothUiStatus = 'pass' | 'partial' | 'blocked' | 'fail';
export interface BoothUiRow { id: 'B12' | 'B13' | 'B14'; status: BoothUiStatus; detail: string }

const say = makeSay('he');
const START = 'booth-start';
const freePort = async () => { const x = net.createServer(); await new Promise<void>((r) => x.listen(0, '127.0.0.1', r)); const p = (x.address() as net.AddressInfo).port; await new Promise((r) => x.close(r)); return p; };
const sel = (id: string) => `[data-testid="${id}"]`;

interface Opened { page: Page; ctx: BrowserContext; bootRequests: string[] }
async function openEditor(browser: Browser, s: RunningServer, pid: string, o: { reduced?: boolean; asOther?: boolean }): Promise<Opened> {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...(o.reduced ? { reducedMotion: 'reduce' as const } : {}), permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript('globalThis.__name = (f) => f');
  await ctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.theme', 'dark'); } catch { /* storage unavailable */ } });
  const bootRequests: string[] = [];
  await ctx.route('**/api/v1/booth**', (r) => { bootRequests.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`); void r.continue(); });
  // STAND-IN: another session's actor (the real editor opens only as owner)
  if (o.asOther) await ctx.route('**/api/v1/session', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ actor: 'agent:proof' }) }));
  const page = await ctx.newPage();
  await page.goto(`${s.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  return { page, ctx, bootRequests };
}
const focusId = (p: Page) => p.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? `${a.tagName}|${a.dataset.testid ?? ''}|${a.closest('[data-testid="booth-dialog"]') ? 'in' : 'out'}` : 'none'; });
const live = (p: Page) => p.locator('[data-part=live]').first().innerText().catch(() => '');
const bootDialogState = async (p: Page): Promise<'ready' | { failed: string }> => {
  await p.locator(`${sel(ID.dialog)} .pf-booth`).waitFor({ timeout: 10000 });
  await p.waitForFunction(() => !document.querySelector('.pf-booth[data-state=loading]'), undefined, { timeout: 15000 });
  const failed = await p.locator('.pf-booth[data-state=failed]').count();
  return failed ? { failed: ((await p.locator('.pf-booth[data-state=failed]').innerText()) ?? '').replace(/\s+/g, ' ').trim() } : 'ready';
};
const openFromRail = async (p: Page) => { await p.locator(sel(ID.rail)).focus(); await p.keyboard.press('Enter'); await p.locator(sel(ID.dialog)).waitFor({ timeout: 8000 }); };
/** Shift+Tab until the start button has the focus (the check button holds it first), then Enter: the sitting starts from the keyboard. */
async function startFromKeyboard(p: Page, problems: string[]): Promise<void> {
  for (let i = 0; i < 8 && !(await focusId(p)).includes(`|${START}|`); i++) await p.keyboard.press('Shift+Tab');
  if (!(await focusId(p)).includes(`|${START}|`)) { problems.push(`the start button could not be reached with Shift+Tab (focus ${await focusId(p)})`); await p.locator(sel(START)).focus(); }
  await p.keyboard.press('Enter');
  await p.locator(sel(ID.card)).or(p.locator(sel(ID.windowsStep))).first().waitFor({ timeout: 20000 });
}
/** Skips cards with Digit3 until `want` is the current card (a card of the registry); every step must leave the focus inside the dialog. */
async function skipTo(p: Page, want: (kind: string, item: string, light: string) => boolean, problems: string[]): Promise<boolean> {
  for (let i = 0; i < BOOTH_FIRST_SITTING_CARDS + 30; i++) {
    const c = p.locator(sel(ID.card));
    if (await c.count()) {
      const [k, it, l] = await c.first().evaluate((el) => [el.getAttribute('data-kind') ?? '', el.getAttribute('data-item') ?? '', el.getAttribute('data-changes-light') ?? ''] as const);
      if (want(k, it, l)) return true;
      await p.keyboard.press('Digit3');
    } else if (await p.locator(sel(ID.windowsStep)).count()) await p.locator(sel(ID.next)).focus().then(() => p.keyboard.press('Enter'));
    else return false;
    await p.waitForTimeout(150);
    const f = await focusId(p);
    if (!f.endsWith('|in')) problems.push(`the focus left the dialog after a key (${f})`);
  }
  return false;
}

async function b12(browser: Browser, s: RunningServer, pid: string): Promise<BoothUiRow> {
  const problems: string[] = [];
  // not the owner: no entry, no booth request (STAND-IN session, labelled in the header)
  const other = await openEditor(browser, s, pid, { asOther: true });
  try {
    await other.page.waitForTimeout(800);
    if (await other.page.locator(sel(ID.rail)).count()) problems.push('another session still sees the booth button');
    if (other.bootRequests.length) problems.push(`another session asked the server for the booth: ${other.bootRequests.join(', ')}`);
  } finally { await other.ctx.close(); }
  const { page, ctx, bootRequests } = await openEditor(browser, s, pid, {});
  try {
    if (!(await page.locator(sel(ID.rail)).count())) return { id: 'B12', status: 'fail', detail: 'the owner\'s session has no booth button on the rail' };
    if (bootRequests.length) problems.push(`the page asked the booth before it was opened: ${bootRequests.join(', ')}`);
    if ((await page.locator(sel(ID.rail)).getAttribute('aria-haspopup')) !== 'dialog') problems.push('the rail button has no aria-haspopup=dialog');
    await openFromRail(page);
    const st = await bootDialogState(page);
    if (st !== 'ready') return { id: 'B12', status: problems.length ? 'fail' : 'blocked', detail: `the dialog opened from the rail with Enter but could not load the booth: ${st.failed}${problems.length ? ` | ${problems.join('; ')}` : ''}` };
    const progress = ((await page.locator(sel(ID.progress)).innerText()) ?? '').trim();
    const want = say('booth.firstPart', { done: 0, total: BOOTH_FIRST_SITTING_CARDS });
    if (progress !== want) problems.push(`the first screen says «${progress}», expected «${want}»`);
    const body = await page.locator(sel(ID.dialog)).innerText();
    const totals = [...body.matchAll(/מתוך\s+(\d+)/g)].map((m) => Number(m[1]));
    if (totals.some((n) => n !== BOOTH_FIRST_SITTING_CARDS)) problems.push(`a total other than ${BOOTH_FIRST_SITTING_CARDS} on the first screen: ${totals.join(', ')}`);
    if ((await focusId(page)) !== `BUTTON|${ID.checkRun}|in`) problems.push(`the dialog's first focus is ${await focusId(page)}, expected the self-check button`);
    // the self-check from the keyboard
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="booth-check-row"][data-heavy=no]')].some((r) => ['idle', 'running'].includes(r.getAttribute('data-state') ?? '')), undefined, { timeout: 70000 }).catch(() => problems.push('the light rows of the self-check did not all answer in 70 s'));
    const rows = await page.locator(sel(ID.checkRow)).evaluateAll((els) => els.map((e) => `${e.getAttribute('data-check')}=${e.getAttribute('data-state')}`));
    // the cards, by keys only
    await startFromKeyboard(page, problems);
    const reachedAudio = await skipTo(page, (k) => k === 'audio', problems);
    if (!reachedAudio) return { id: 'B12', status: 'fail', detail: `no sound card was reached from the first sitting (self-check rows: ${rows.join(' ')}) ${problems.join('; ')}` };
    const item = (await page.locator(sel(ID.card)).first().getAttribute('data-item')) ?? '';
    if (!(await focusId(page)).includes(`|${ID.play}|`)) problems.push(`the sound card's play button did not take the focus (${await focusId(page)})`);
    if (await page.evaluate(() => [...document.querySelectorAll('audio')].some((a) => !a.paused))) problems.push('a sound was playing before any key');
    await page.keyboard.press('Space');
    const times: number[] = [];
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(400); times.push(await page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement | null)?.currentTime ?? -1)); }
    if (!(times[times.length - 1]! > times[0]! && times[0]! >= 0)) problems.push(`the audio element's currentTime did not advance after Space: ${times.map((t) => t.toFixed(2)).join(' ')}`);
    if ((await page.locator(sel(ID.play)).getAttribute('aria-pressed')) !== 'true') problems.push('the play button is not aria-pressed while playing');
    await page.keyboard.press('Space');
    if ((await page.locator(sel(ID.play)).getAttribute('aria-pressed')) !== 'false') problems.push('Space did not stop the sound');
    // Digit1 answers: the next card takes the focus in the same render and the live region says its title
    await page.keyboard.press('Digit1');
    await page.waitForFunction((cur) => document.querySelector('[data-testid="booth-card"]')?.getAttribute('data-item') !== cur || !document.querySelector('[data-testid="booth-card"]'), item, { timeout: 8000 }).catch(() => problems.push('Digit1 did not move to another card'));
    const f = await focusId(page);
    if (!f.endsWith('|in') || f.startsWith('BODY')) problems.push(`after Digit1 the focus is ${f}`);
    const said = await live(page);
    if (!said.includes('שמר') && !said.includes('Saved')) problems.push(`the live region did not say the answer was saved (${JSON.stringify(said)})`);
    // the server holds the answer
    const stored = await page.evaluate(async (id) => { const r = await fetch('/api/v1/booth', { credentials: 'same-origin' }); const v = (await r.json()) as { items: { item: { id: string }; answer: { verdict: string } | null; state: string }[] }; const x = v.items.find((i) => i.item.id === id); return x ? `${x.state}/${x.answer?.verdict ?? ''}` : 'missing'; }, item);
    if (stored !== 'answered/ok') problems.push(`the server holds ${stored} for ${item}, expected answered/ok`);
    // Escape closes and the focus returns to the rail button
    await page.keyboard.press('Escape');
    await page.locator(sel(ID.dialog)).waitFor({ state: 'detached', timeout: 5000 }).catch(() => problems.push('Escape did not close the dialog'));
    if ((await focusId(page)) !== `BUTTON|${ID.rail}|out`) problems.push(`after Escape the focus is ${await focusId(page)}, expected the rail button`);
    return { id: 'B12', status: problems.length ? 'fail' : 'pass', detail: problems.length ? problems.join('; ') : `button only for the owner (STAND-IN other session: none, 0 booth requests); first screen «${progress}»; self-check rows ${rows.join(' ')}; Space played ${item} (currentTime ${times[0]!.toFixed(2)} to ${times[times.length - 1]!.toFixed(2)}, measured, not heard); Digit1 stored answered/ok; focus stayed in the dialog; Escape returned it to the rail button` };
  } finally { await ctx.close(); }
}

async function b13(browser: Browser, s: RunningServer, pid: string): Promise<BoothUiRow> {
  const problems: string[] = [];
  let found = false, blocked = '';
  for (const reduced of [false, true]) {
    const { page, ctx } = await openEditor(browser, s, pid, { reduced });
    try {
      await openFromRail(page);
      const st = await bootDialogState(page);
      if (st !== 'ready') return { id: 'B13', status: 'blocked', detail: `the booth did not load: ${st.failed}` };
      await startFromKeyboard(page, problems);
      found = await skipTo(page, (k, _i, l) => k === 'picture' && l === 'yes', problems);
      if (!found) return { id: 'B13', status: 'partial', detail: `no picture card in this build's registry changes the light (data-changes-light), so there is nothing to play under the guard; ${problems.join('; ')}` };
      if (await page.locator('[data-part=needs-gpu]').count()) { blocked = `this headless Chromium has no WebGPU adapter: the card says «${say('booth.needsGpu')}» and cannot be drawn here`; return { id: 'B13', status: 'blocked', detail: blocked }; }
      const guard = () => page.evaluate(() => { const g = (document.querySelector('[data-part=guard]') as unknown as { boothGuard?: { riseTimes: number[]; decided: number } } | null)?.boothGuard; return g ? { rises: [...g.riseTimes], decided: g.decided } : null; });
      if (!(await page.locator(sel(ID.pictureCanvas)).count())) problems.push(`${reduced ? 'reduced' : 'normal'}: the picture canvas is missing`);
      if (!(await guard())) { problems.push('the dialog\'s guard is not readable'); continue; }
      const before = (await guard())!;
      if (!reduced) {
        if (before.rises.length) problems.push('a light rise was shown before any play (the card must start as a still)');
        const play = page.locator(`${sel(ID.card)} button`).filter({ hasText: say('booth.play') }).first();
        if (!(await play.count())) { problems.push('no play button on the light-changing card'); continue; }
        await play.focus(); await page.keyboard.press('Enter');
        await page.waitForTimeout(4000);
        const g = (await guard())!;
        if (g.decided <= before.decided) problems.push('playing drew no frame through the guard (guard.decide was not called)');
        const gaps = g.rises.slice(1).map((t, i) => t - g.rises[i]!);
        const tooClose = gaps.filter((x) => x < SCREEN_FLASH_GAP - 1e-6);
        if (tooClose.length) problems.push(`${tooClose.length} rises closer than ${SCREEN_FLASH_GAP.toFixed(3)} s by the guard's own times: ${tooClose.map((x) => x.toFixed(3)).join(', ')}`);
      } else {
        await page.waitForTimeout(1500);
        const after = (await guard())!;
        if (after.decided !== before.decided || after.rises.length !== before.rises.length) problems.push(`under reduced motion the guard drew ${after.decided - before.decided} more frames and showed ${after.rises.length - before.rises.length} more rises over 1.5 s`);
      }
    } finally { await ctx.close(); }
  }
  return { id: 'B13', status: problems.length ? 'fail' : 'pass', detail: problems.length ? problems.join('; ') : `a light-changing picture card starts as a still, plays with every rise at least ${SCREEN_FLASH_GAP.toFixed(3)} s apart by the guard's own times (its count, not the eye), and under reduced motion draws no frame over 1.5 s` };
}

async function b14(browser: Browser, s: RunningServer, pid: string): Promise<BoothUiRow> {
  const { page, ctx } = await openEditor(browser, s, pid, {});
  try {
    await openFromRail(page);
    const st = await bootDialogState(page);
    if (st !== 'ready') return { id: 'B14', status: 'blocked', detail: `the booth did not load: ${st.failed}` };
    const box = page.locator(sel(ID.reportBox));
    await box.waitFor({ timeout: 8000 });
    const built = (await box.getAttribute('data-built')) === 'yes';
    const shown = ((await box.inputValue()) ?? '').replace(/\r\n/g, '\n');
    if (!built) {
      const disabled = (await page.locator(sel(ID.reportCopy)).getAttribute('aria-disabled')) === 'true';
      return { id: 'B14', status: 'blocked', detail: `boothReport is not merged in this build: the box says «${shown.slice(0, 120)}» and the copy button is ${disabled ? 'disabled with a reason' : 'NOT disabled (a defect)'}` };
    }
    await page.locator(sel(ID.reportCopy)).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const clip = ((await page.evaluate(() => navigator.clipboard.readText())) ?? '').replace(/\r\n/g, '\n');
    return clip === shown && shown.length > 0
      ? { id: 'B14', status: 'pass', detail: `«העתקת הדוח» put exactly the box's ${shown.length} characters on the clipboard` }
      : { id: 'B14', status: 'fail', detail: `the clipboard holds ${clip.length} characters, the box ${shown.length}; first difference at ${[...clip].findIndex((c, i) => c !== shown[i])}` };
  } finally { await ctx.close(); }
}

export async function runBoothUiProof(): Promise<BoothUiRow[]> {
  const art = fs.mkdtempSync(path.join(os.tmpdir(), `pf-booth-ui-${process.pid}-`));
  let server: RunningServer | null = null, browser: Browser | null = null;
  try {
    server = await startServer({ port: await freePort(), host: '127.0.0.1', dataDir: path.join(art, 'data'), backupDir: null, libraryDir: null });
    const made = await fetch(`${server.url}/api/v1/projects`, { method: 'POST', headers: { authorization: `Bearer ${server.auth.tokens.agent}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'booth-ui-proof', width: 640, height: 360, frameRate: { num: 30, den: 1 } }) });
    const pid = ((await made.json()) as { project: { id: string } }).project.id;
    browser = await chromium.launch();
    const rows: BoothUiRow[] = [];
    for (const run of [b12, b13, b14]) {
      try { rows.push(await run(browser, server, pid)); }
      catch (e) { rows.push({ id: (run === b12 ? 'B12' : run === b13 ? 'B13' : 'B14'), status: 'fail', detail: `threw: ${String(e).split('\n')[0]}` }); }
    }
    return rows;
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
    try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// run alone: prints the three rows
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void runBoothUiProof().then((rows) => { for (const r of rows) console.log(`${r.status.toUpperCase().padEnd(8)} ${r.id} ${r.detail}`); process.exitCode = rows.every((r) => r.status === 'pass') ? 0 : rows.some((r) => r.status === 'fail') ? 1 : 2; });
}
