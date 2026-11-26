/**
 * proof:instruments — the browser part (builder W3, wave 7 instruments track): I17 and the page side of I16 of instruments-proof.ts.
 * Imported by the lead's entry point at integration (decisions §5); run alone it prints both results.
 *
 * REAL and STAND-IN, said exactly (nothing here is hidden behind a pass):
 * - REAL: three servers (this process, free 127.0.0.1 ports, data in a temporary folder deleted on exit): one without a library folder
 *   (state «library_not_set»), one with a library folder holding the LABELLED synthetic test kit and the shipped kit list (state
 *   «not_calibrated»: the one real kit of version 1 has no checked file list), and one with the same folder and the synthetic kit
 *   injected as its kit list (startServer's TEST-only musicKits; never from the environment): its «ready» state, its recorded preview
 *   with its real x-pf-level-scale, its recorded add, its heard route are the real server's. The blind pair is checked by the SHA-256 of
 *   the bytes each player holds against the bytes this process fetched from the same server, and by the volume against the header.
 * - STAND-IN (labelled in the check's own words): only the missing level header, which the real server never omits — a Playwright route
 *   passes the real preview through with x-pf-level-scale removed. The non-owner step sends the heard POST to the real server with the
 *   agent bearer instead of the owner's cookie (a real other credential; the editor itself opens only as owner).
 * Nobody here can listen: every check is a measurement of the page (states, words, order, volume numbers, request bytes, focus).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import { MUSIC_RECORDED_GENERATOR } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { auditionPair } from '../../../apps/web/src/editor/instruments/instruments.logic.ts';
import { instrumentsT } from '../../../apps/web/src/editor/instruments/instruments.strings.ts';
import { INSTRUMENTS_TESTIDS as ID } from '../../../apps/web/src/editor/instruments/instruments.testids.ts';
import { SYNTHETIC_SOURCES, writeSyntheticKit } from '../../fixtures/src/instruments.ts';

export interface InstrumentsProofPart { built: boolean; checks: Record<string, () => Promise<true | string>> }

const art = fs.mkdtempSync(path.join(os.tmpdir(), `pf-instruments-ui-${process.pid}-`));
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });
const freePort = async () => { const x = net.createServer(); await new Promise<void>((r) => x.listen(0, '127.0.0.1', r)); const p = (x.address() as net.AddressInfo).port; await new Promise((r) => x.close(r)); return p; };

const ORDINARY_BODY = '{"styleId":"music.calm","bars":16,"seed":1,"start":{"value":"0","timescale":1}}';
const RECORDED_BODY = '{"styleId":"music.calm","bars":16,"seed":1,"start":{"value":"0","timescale":1},"instruments":"recorded"}';

let noLib: RunningServer | null = null, withLib: RunningServer | null = null, withKit: RunningServer | null = null, browser: Browser | null = null;
/** What the real synthetic-kit server answers for the pair (fetched by this process): sha256 of the bytes and the level header. */
let PAIR: Record<'synth' | 'recorded', { sha: string; scale: string }> | null = null;
let all: Promise<{ I16: string[]; I17: string[] }> | null = null;

async function projectOn(s: RunningServer, name: string): Promise<string> {
  const made = await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, width: 640, height: 360, frameRate: { num: 30, den: 1 } }) });
  return ((await made.json()) as { project: { id: string } }).project.id;
}
const assetCount = (s: RunningServer, pid: string) => Object.keys(s.store.getProject(pid).doc.assets).length;
const realKits = async (s: RunningServer) => ((await (await fetch(`${s.url}/api/v1/music/kits`, { headers: { authorization: `Bearer ${s.auth.tokens.agent}` } })).json()) as { kits: { state: string; heard: { at: string } | null }[] }).kits[0]!;

interface Seen { plays: { volume: number; sha: string | null }[]; posts: string[]; recordedPreviewHits: number; kitsGets: number }
interface Opts { lang: 'he' | 'en'; width: number; /** the heard POST is sent to the real server with this server's AGENT bearer instead of the owner's cookie (the editor itself opens only as owner) */ asAgent?: RunningServer; /** STAND-IN switch: the real recorded preview passed through with x-pf-level-scale removed while noLevel is true */ strip?: { noLevel: boolean } }
async function open(s: RunningServer, pid: string, o: Opts): Promise<{ page: Page; ctx: BrowserContext; seen: Seen }> {
  const ctx = await browser!.newContext({ viewport: { width: o.width, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript('globalThis.__name = (f) => f');
  await ctx.addInitScript(([l]) => { try { localStorage.setItem('pf.lang', l!); localStorage.setItem('pf.theme', 'dark'); } catch { /* storage unavailable */ } }, [o.lang] as const);
  // records every play(): the volume the page gave the element and the SHA-256 of the bytes it holds (to tell the versions apart)
  await ctx.addInitScript(() => {
    (window as unknown as { __plays: unknown[] }).__plays = [];
    // the page plays blob: URLs (the page's own fetch of the preview); the blob behind each URL is kept to hash what an element holds
    const blobs = new Map<string, Blob>();
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource) => { const u = make(o); if (o instanceof Blob) blobs.set(u, o); return u; };
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const rec = { volume: this.volume, sha: null as string | null };
      (window as unknown as { __plays: unknown[] }).__plays.push(rec);
      const held = blobs.get(this.currentSrc || this.src);
      void (held ? held.arrayBuffer() : fetch(this.currentSrc || this.src).then((r) => r.arrayBuffer())).then((b) => crypto.subtle.digest('SHA-256', b)).then((h) => { rec.sha = [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join(''); }).catch(() => { rec.sha = 'unreadable'; });
      return orig.call(this);
    };
  });
  const seen: Seen = { plays: [], posts: [], recordedPreviewHits: 0, kitsGets: 0 };
  await ctx.route('**/api/v1/music/kits', (r) => { seen.kitsGets++; void r.continue(); });
  if (o.asAgent) {
    const agent = o.asAgent;
    await ctx.route('**/api/v1/music/kits/*/heard', async (r: Route) => {
      const resp = await r.fetch({ headers: { ...r.request().headers(), cookie: '', authorization: `Bearer ${agent.auth.tokens.agent}` } });
      await r.fulfill({ response: resp });
    });
  }
  const strip = o.strip;
  await ctx.route('**/api/v1/music/music.calm/audio**', async (r) => {
    const url = new URL(r.request().url());
    const recordedAsk = url.searchParams.get('instruments') === 'recorded';
    if (recordedAsk) seen.recordedPreviewHits++;
    if (!(strip?.noLevel && recordedAsk)) { await r.continue(); return; }
    // STAND-IN: the real server's answer with its level header removed (the real server never omits it)
    const resp = await r.fetch();
    const headers = { ...resp.headers() };
    delete headers['x-pf-level-scale'];
    await r.fulfill({ status: resp.status(), headers, body: await resp.body() });
  });
  await ctx.route('**/api/v1/projects/*/music', (r) => { if (r.request().method() === 'POST') seen.posts.push(r.request().postData() ?? ''); void r.continue(); });
  const page = await ctx.newPage();
  await page.goto(`${s.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  if ((await page.evaluate(() => document.documentElement.lang)) !== o.lang) await page.getByTestId('lang-toggle').click();
  await page.getByTestId('rail-audio').click();
  await page.getByTestId('music-tab').click({ timeout: 8000 });
  await page.locator('[data-testid=music-row][data-style-id="music.calm"] [data-testid=instruments-state]').waitFor({ timeout: 10000 }).catch(async (e) => {
    throw new Error(`the music row did not show «${'צליל'}»: ${String(e).split('\n')[0]}; page: ${JSON.stringify(((await page.locator('body').innerText().catch(() => '')) as string).slice(0, 300))}`);
  });
  return { page, ctx, seen };
}
const row = (p: Page) => p.locator('[data-testid=music-row][data-style-id="music.calm"]');
const opt = (p: Page, c: 'synth' | 'recorded') => row(p).locator(`[data-testid=${ID.choiceOption}][data-choice=${c}]`);
const text = async (p: Page, id: string) => ((await row(p).getByTestId(id).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
const settle = async (p: Page) => { await p.waitForFunction(() => !document.querySelector('[data-testid=instruments-state][data-state=checking]'), undefined, { timeout: 8000 }).catch(() => undefined); };

async function oneLanguage(lang: 'he' | 'en'): Promise<{ I16: string[]; I17: string[] }> {
  const out = { I16: [] as string[], I17: [] as string[] };
  const t = instrumentsT(lang);
  const step = (id: 'I16' | 'I17', ok: boolean, say: string) => { if (!ok) out[id].push(`${lang}: ${say}`); return ok; };
  const dirOf = lang === 'he' ? 'rtl' : 'ltr';
  const errors: string[] = [];
  const guard = (p: Page) => p.on('pageerror', (e) => errors.push(String(e)));

  // ===== REAL server, no library folder: the state is «library_not_set»; the keyboard, focus, direction, widths
  {
    const pid = await projectOn(noLib!, `instr-ui-${lang}-a`);
    const real = (await realKits(noLib!)).state;
    for (const width of [1440, 1280]) {
      const { page, ctx, seen } = await open(noLib!, pid, { lang, width });
      guard(page);
      try {
        await settle(page);
        step('I17', (await page.evaluate(() => getComputedStyle(document.documentElement).direction)) === dirOf, `${width}: the page direction is ${dirOf}`);
        const state = await row(page).getByTestId(ID.state).getAttribute('data-state');
        step('I17', state === real && real === 'library_not_set', `${width}: the page shows the server's own state «${real}» (page: ${state})`);
        step('I17', (await text(page, ID.state)).includes(t('state.library_not_set')), `${width}: the state line says it in words`);
        step('I17', (await row(page).getByTestId(ID.choice).getAttribute('role')) === 'radiogroup', `${width}: «${t('sound')}» is a radiogroup`);
        step('I17', (await opt(page, 'synth').getAttribute('aria-checked')) === 'true', `${width}: «${t('synth')}» is chosen first`);
        // reached by Tab from the length chips, then the arrows move AND select (right-to-left aware)
        await row(page).locator(`[data-testid=music-bars]`).last().focus();
        await page.keyboard.press('Tab');
        const landed = await page.evaluate(() => { const a = document.activeElement as HTMLElement; return `${a.dataset.testid}/${a.dataset.choice}/${a.getAttribute('aria-checked')}`; });
        step('I17', landed === `${ID.choiceOption}/synth/true`, `${width}: Tab from the length chips lands on the chosen radio (${landed})`);
        const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement as HTMLElement); return `${s.outlineStyle} ${s.outlineWidth}`; });
        step('I17', !outline.startsWith('none') && !outline.endsWith(' 0px'), `${width}: the focus ring is visible (${outline})`);
        const next = lang === 'he' ? 'ArrowLeft' : 'ArrowRight', back = lang === 'he' ? 'ArrowRight' : 'ArrowLeft';
        await page.keyboard.press(next);
        step('I17', (await opt(page, 'recorded').getAttribute('aria-checked')) === 'true' && (await page.evaluate(() => (document.activeElement as HTMLElement).dataset.choice)) === 'recorded', `${width}: ${next} chooses «${t('recorded')}» and moves the focus`);
        step('I17', (await text(page, ID.state)).includes(t('next.library_not_set')), `${width}: the next step is said once recorded is chosen`);
        await page.keyboard.press(back);
        step('I17', (await opt(page, 'synth').getAttribute('aria-checked')) === 'true', `${width}: ${back} goes back to «${t('synth')}»`);
        await opt(page, 'recorded').click();
        const over = await row(page).evaluate((el) => el.scrollWidth - el.clientWidth);
        step('I17', over <= 0, `${width}: the row does not overflow sideways (${over}px)`);
        // recorded chosen, kit not available: «הוספה» is refused in words, NO request is made, nothing is added, no quiet synth
        const before = assetCount(noLib!, pid);
        const addBtn = row(page).getByTestId('music-add');
        step('I17', (await addBtn.getAttribute('aria-disabled')) === 'true', `${width}: «${t('sound')}» recorded but unavailable: the add button is disabled with its reason`);
        await addBtn.click({ force: true });
        await page.waitForTimeout(300);
        step('I17', seen.posts.length === 0 && assetCount(noLib!, pid) === before, `${width}: no request was sent and nothing was added`);
        if (width === 1440) {
          // synth chosen again: the ordinary request, byte for byte, really adds
          await opt(page, 'synth').click();
          await addBtn.click();
          await page.waitForFunction(() => /./.test(document.querySelector('.pf-music-status.is-ok')?.textContent ?? ''), undefined, { timeout: 60000 }).catch(() => undefined);
          step('I17', seen.posts.length === 1 && seen.posts[0] === ORDINARY_BODY, `the ordinary add sends exactly ${ORDINARY_BODY} (sent: ${seen.posts[0]})`);
          step('I17', assetCount(noLib!, pid) === before + 1, 'the ordinary add added one asset');
        }
      } finally { await ctx.close(); }
    }
  }

  // ===== REAL server with the synthetic library: the state is «not_calibrated», said plainly
  {
    const pid = await projectOn(withLib!, `instr-ui-${lang}-b`);
    const real = (await realKits(withLib!)).state;
    const { page, ctx } = await open(withLib!, pid, { lang, width: 1440 });
    guard(page);
    try {
      await settle(page);
      await opt(page, 'recorded').click();
      const state = await row(page).getByTestId(ID.state).getAttribute('data-state');
      const words = await text(page, ID.state);
      step('I17', state === real && real === 'not_calibrated', `with a library folder the server's state is «${real}», the page shows «${state}»`);
      step('I17', words.includes(lang === 'he' ? 'לא הורדה ולא נבדקה' : 'not been downloaded and checked'), `«not calibrated» says plainly that the set was not downloaded and checked (${words.slice(0, 140)})`);
      step('I17', words.includes(t('next.not_calibrated')), 'its next step is said');
      step('I17', (await text(page, ID.unheard)).includes(lang === 'he' ? 'עוד לא הושמעו לאף אחד' : 'nobody has listened yet'), 'the kit is unheard');
    } finally { await ctx.close(); }
  }

  // ===== REAL «ready» kit: the server with the synthetic kit as its kit list (its preview, level header, add and heard route are real)
  {
    const pid = await projectOn(withKit!, `instr-ui-${lang}-c`);
    const strip = { noLevel: false };
    const { page, ctx, seen } = await open(withKit!, pid, { lang, width: 1440, strip });
    guard(page);
    try {
      await settle(page);
      await opt(page, 'recorded').click();
      step('I17', (await row(page).getByTestId(ID.state).getAttribute('data-state')) === 'ready' && (await realKits(withKit!)).state === 'ready', 'the real server\'s «ready» kit shows «ready»');
      const body = await row(page).locator('[data-part=duties]').textContent();
      step('I17', !!body && body.includes(SYNTHETIC_SOURCES.ccBy.title) && body.includes(SYNTHETIC_SOURCES.ccByNc.title) && body.includes(t('nonCommercial')) && body.includes(t('dutiesHeading')), 'the credit and «לשימוש לא מסחרי בלבד» are said before the add');
      step('I17', (await row(page).locator('[data-duty=credit]').count()) === 2 && (await row(page).locator('[data-duty=non-commercial]').count()) === 1 && (await row(page).locator('[data-duty=none]').count()) === 0, 'one credit line per credited source (CC BY, CC BY-NC), one non-commercial line, no no-duty line');
      const bad = /\b(better|real|realistic|warm|natural|authentic|rich|lifelike)\b|טוב יותר|אמיתי|חם|טבעי|עשיר|מציאותי/i;
      step('I17', !bad.test((await row(page).locator('.pf-instruments').innerText()).replace(/Synthetic tones[^)\n]*\)/gi, '').replace(/Synthetic test tones[^\n]*/gi, '')), 'no recorded claim in the rendered text');

      // ---- the blind pair
      const open1 = row(page).getByTestId(ID.audition);
      step('I17', (await open1.getAttribute('aria-disabled')) !== 'true', 'the pair is offered for a ready kit');
      await open1.click();
      await row(page).getByTestId(ID.auditionA).waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid=instruments-audition-a]')?.getAttribute('aria-disabled') !== 'true', undefined, { timeout: 120000 }).catch(() => undefined);
      const A = row(page).getByTestId(ID.auditionA), B = row(page).getByTestId(ID.auditionB), R = row(page).getByTestId(ID.reveal);
      step('I17', (await A.textContent())?.trim() === t('auditionA') && (await B.textContent())?.trim() === t('auditionB'), 'the two players are «א» and «ב», unlabelled otherwise');
      const dom = await row(page).locator('.pf-instr-pair').evaluate((el) => [...el.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((x) => x.name !== 'data-testid' && x.name !== 'class' && x.name !== 'id' && x.name !== 'aria-controls').map((x) => x.value)).join(' ') + ' ' + (el as HTMLElement).innerText);
      step('I17', !/recorded|synth|מוקלט|מסונתז/i.test(dom.replace(t('auditionHelp'), '').replace(t('levelNote'), '')), 'nothing in the page tells which is which before the reveal');
      step('I17', (await R.getAttribute('aria-disabled')) === 'true', 'the reveal waits until both were played');
      await A.click();
      await page.waitForTimeout(250);
      step('I17', (await R.getAttribute('aria-disabled')) === 'true', 'after one it still waits');
      await B.click();
      await page.waitForFunction(() => (window as unknown as { __plays: { sha: string | null }[] }).__plays.length >= 2 && (window as unknown as { __plays: { sha: string | null }[] }).__plays.every((x) => x.sha !== null), undefined, { timeout: 30000 }).catch(() => undefined);
      await page.waitForFunction(() => document.querySelector('[data-testid=instruments-reveal]')?.getAttribute('aria-disabled') !== 'true', undefined, { timeout: 8000 }).catch(() => undefined);
      step('I17', (await R.getAttribute('aria-disabled')) !== 'true', 'after both the reveal is open');
      const plays = await page.evaluate(() => (window as unknown as { __plays: { volume: number; sha: string }[] }).__plays);
      const pair = auditionPair('music.calm', 16, 1);
      const expectA = PAIR![pair.a], expectB = PAIR![pair.b];
      const short = (p: { volume: number; sha: string } | undefined) => p ? JSON.stringify({ volume: p.volume, sha: p.sha.slice(0, 12) }) : 'none';
      step('I16', plays.length === 2 && plays[0]!.sha === expectA.sha && plays[0]!.volume === Number(expectA.scale), `«א» plays the real server's ${pair.a} version at its header's level (${short(plays[0])}, expected ${expectA.sha.slice(0, 12)}, volume ${expectA.scale})`);
      step('I16', plays.length === 2 && plays[1]!.sha === expectB.sha && plays[1]!.volume === Number(expectB.scale), `«ב» plays the real server's ${pair.b} version at its header's level (${short(plays[1])}, expected ${expectB.sha.slice(0, 12)}, volume ${expectB.scale})`);
      step('I16', plays.length === 2 && expectA.sha !== expectB.sha && plays.some((p) => p.volume === 1) && plays.every((p) => p.volume > 0 && p.volume <= 1), `the two volumes are the two header values ${expectA.scale} / ${expectB.scale} (one version at 1, the other turned down; nothing scaled in the bytes)`);
      step('I16', seen.recordedPreviewHits >= 1, 'the recorded preview was asked for with match=1');
      await R.click();
      const rev = await row(page).locator('[data-part=revealed]').textContent();
      step('I17', rev === t('revealed', { a: t(pair.a), b: t(pair.b) }), `the reveal tells the order drawn from the request (${rev})`);
      // the same request gives the same order, nothing was stored
      await open1.click();
      await open1.click();
      await A.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid=instruments-audition-a]')?.getAttribute('aria-disabled') !== 'true', undefined, { timeout: 120000 }).catch(() => undefined);
      await A.click();
      await page.waitForFunction(() => (window as unknown as { __plays: { sha: string | null }[] }).__plays.length >= 3 && (window as unknown as { __plays: { sha: string | null }[] }).__plays[2]!.sha !== null, undefined, { timeout: 30000 }).catch(() => undefined);
      const again = await page.evaluate(() => (window as unknown as { __plays: { volume: number; sha: string }[] }).__plays[2]);
      step('I17', !!again && again.sha === expectA.sha, 'reopening the same request gives the same «א»');
      step('I17', (await row(page).locator('[data-part=revealed]').count()) === 0, 'the reveal is forgotten when the pair is reopened');
      const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
      step('I17', !/audition|instrument|recorded|reveal/i.test(stored), 'the page stored no choice');

      // ---- «הוספה» with the recorded kit chosen and ready: the field is sent and the REAL server makes the recorded track
      const before = assetCount(withKit!, pid);
      seen.posts.length = 0;
      const getsBefore = seen.kitsGets;
      await row(page).getByTestId('music-add').click();
      await page.waitForFunction(() => /./.test(document.querySelector('.pf-music-status.is-err,.pf-music-status.is-ok')?.textContent ?? ''), undefined, { timeout: 60000 }).catch(() => undefined);
      const status = ((await page.locator('.pf-music-status').textContent()) ?? '').trim();
      step('I17', seen.posts.length === 1 && seen.posts[0] === RECORDED_BODY, `a recorded add sends the optional field (${seen.posts[0]})`);
      void getsBefore;
      step('I17', (await page.locator('.pf-music-status.is-ok').count()) === 1 && assetCount(withKit!, pid) === before + 1 && status.includes(t('addedRecorded')), `the real recorded add succeeded and says so (${status.slice(0, 160)})`);
      const made = Object.values(withKit!.store.getProject(pid).doc.assets);
      step('I17', made.length === 1 && made[0]!.provenance.procedural?.generator === MUSIC_RECORDED_GENERATOR && made[0]!.name.endsWith(' · recorded instruments.wav') && made[0]!.provenance.instruments?.kitId === 'kit.calm.synthetic', `the made asset is the recorded track (${made.map((a) => `${a.name} / ${a.provenance.procedural?.generator}`).join(', ')})`);
      // ---- the level scale missing: refused in words, nothing plays
      // STAND-IN (the real server always sends x-pf-level-scale): its recorded answer passed through with the header removed
      strip.noLevel = true;
      await open1.click();
      await open1.click();
      await page.waitForSelector('[data-part=audition-status]', { timeout: 8000 }).catch(() => undefined);
      const nl = (await row(page).locator('[data-part=audition-status]').textContent().catch(() => null)) ?? '';
      step('I16', nl.includes(t('auditionNoLevel')), `STAND-IN (header removed from the real answer): without x-pf-level-scale the pair is refused in words (${nl.slice(0, 100)})`);
      step('I16', (await A.getAttribute('aria-disabled')) === 'true', 'and its players stay disabled');
      strip.noLevel = false;

      // ---- «שמעתי»: the owner's own session
      const H = row(page).getByTestId(ID.heard);
      step('I17', (await H.count()) === 1 && (await H.getAttribute('aria-disabled')) !== 'true', '«שמעתי» is there for the owner');
      await H.click();
      await page.waitForFunction(() => document.querySelector('[data-testid=instruments-unheard]')?.getAttribute('data-heard') === 'true', undefined, { timeout: 8000 }).catch(() => undefined);
      const mark = await realKits(withKit!);
      const date = new Date().toISOString().slice(0, 10);
      step('I16', !!mark.heard && mark.heard.at.slice(0, 10) === date, `the owner's mark is stored by the server (${JSON.stringify(mark.heard)})`);
      const badge = await text(page, ID.unheard);
      step('I17', badge.includes(mark.heard!.at.slice(0, 10)) && !badge.includes(lang === 'he' ? 'עוד לא הושמעו' : 'nobody has listened'), `the badge shows the mark with its date (${badge})`);
      step('I17', ((await H.textContent()) ?? '').trim() === t('notHeard'), 'the button is now the way back');
      await H.click();
      await page.waitForFunction(() => document.querySelector('[data-testid=instruments-unheard]')?.getAttribute('data-heard') === 'false', undefined, { timeout: 8000 }).catch(() => undefined);
      step('I16', (await realKits(withKit!)).heard === null, 'the owner can take the mark back; the server holds no mark');
    } finally { await ctx.close(); }
  }

  // ===== REAL «ready» kit, a NON-owner credential (the real server gets the AGENT bearer for the heard POST, no cookie): the control stays, the server's refusal is shown in words
  {
    const pid = await projectOn(withKit!, `instr-ui-${lang}-d`);
    const { page, ctx } = await open(withKit!, pid, { lang, width: 1440, asAgent: withKit! });
    guard(page);
    try {
      await settle(page);
      await opt(page, 'recorded').click();
      const H = row(page).getByTestId(ID.heard);
      step('I16', (await H.count()) === 1, 'for another credential «שמעתי» is still there (never hidden silently)');
      await H.click();
      await page.waitForSelector('[data-part=heard-status].is-err', { timeout: 8000 }).catch(() => undefined);
      const msg = (await row(page).locator('[data-part=heard-status]').textContent().catch(() => null)) ?? '';
      step('I16', lang === 'he' ? msg.includes('רק בעל הפרויקט') : /only the owner/i.test(msg), `the server's 403 is shown in words (${msg.slice(0, 140)})`);
      step('I16', (await realKits(withKit!)).heard === null, 'the refused mark stored nothing');
      step('I16', (await row(page).getByTestId(ID.unheard).getAttribute('data-heard')) === 'false', 'the kit stays unheard on the page');
    } finally { await ctx.close(); }
  }
  if (errors.length) out.I17.push(`${lang}: page errors: ${errors.slice(0, 3).join(' | ')}`);
  return out;
}

async function runAll() {
  noLib = await startServer({ port: 0, host: '127.0.0.1', dataDir: path.join(art, 'data-a'), backupDir: null, libraryDir: null });
  // the LABELLED synthetic test kit: strings under a synthetic CC BY source, piano under a synthetic CC BY-NC source (every duty shown)
  const lib = writeSyntheticKit(path.join(art, 'lib'), { strings: SYNTHETIC_SOURCES.ccBy, piano: SYNTHETIC_SOURCES.ccByNc });
  withLib = await startServer({ port: 0, host: '127.0.0.1', dataDir: path.join(art, 'data-b'), backupDir: null, libraryDir: lib.root });
  withKit = await startServer({ port: 0, host: '127.0.0.1', dataDir: path.join(art, 'data-c'), backupDir: null, libraryDir: lib.root }, { musicKits: [lib.kit] });
  // what the real server answers for the pair the page will ask for (bars 16, seed 1: the row's defaults)
  const ask = async (want: 'synth' | 'recorded') => {
    const r = await fetch(`${withKit!.url}/api/v1/music/music.calm/audio?bars=16&seed=1${want === 'recorded' ? '&instruments=recorded' : ''}&match=1`, { headers: { authorization: `Bearer ${withKit!.auth.tokens.agent}` } });
    if (r.status !== 200) throw new Error(`the real ${want} preview answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const b = Buffer.from(await r.arrayBuffer());
    return { sha: createHash('sha256').update(b).digest('hex'), scale: r.headers.get('x-pf-level-scale') ?? 'missing' };
  };
  PAIR = { synth: await ask('synth'), recorded: await ask('recorded') };
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const total = { I16: [] as string[], I17: [] as string[] };
  for (const lang of ['he', 'en'] as const) { const r = await oneLanguage(lang); total.I16.push(...r.I16); total.I17.push(...r.I17); }
  return total;
}
export async function stopInstrumentsProofUi(): Promise<void> {
  await browser?.close().catch(() => undefined); browser = null;
  for (const s of [noLib, withLib, withKit]) await s?.close().catch(() => undefined);
  noLib = withLib = withKit = null;
}
const verdict = (fails: string[]): true | string => (fails.length === 0 ? true : fails.join('; '));
export const INSTRUMENTS_PROOF_UI: InstrumentsProofPart = {
  built: true,
  checks: {
    // the page side of I16 (the server side is the loader part's I16; the entry point reports both under one id)
    'I16-page': async () => verdict((await (all ??= runAll())).I16),
    I17: async () => verdict((await (all ??= runAll())).I17),
  },
};

// run alone: prints both results
if (import.meta.url === `file://${process.argv[1]}`) {
  let code = 0;
  try {
    for (const [id, run] of Object.entries(INSTRUMENTS_PROOF_UI.checks)) { const r = await run(); console.log(r === true ? `${id} pass` : `${id} FAIL: ${r}`); if (r !== true) code = 1; }
  } finally { await stopInstrumentsProofUi(); }
  process.exit(code);
}
