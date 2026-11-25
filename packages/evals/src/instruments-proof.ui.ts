/**
 * proof:instruments — the browser part (builder W3, wave 7 instruments track): I17 and the page side of I16 of instruments-proof.ts.
 * Imported by the lead's entry point at integration (decisions §5); run alone it prints both results.
 *
 * REAL and STAND-IN, said exactly (nothing here is hidden behind a pass):
 * - REAL: two servers (this process, free 127.0.0.1 ports, data in a temporary folder deleted on exit): one without a library folder, one
 *   with a library folder holding the LABELLED synthetic test kit (packages/fixtures/src/instruments.ts; never a real sample set). The
 *   page reads GET /api/v1/music/kits from them as they are, so the states it shows are the server's own states today: «library_not_set»
 *   and «not_calibrated» (the one real kit of version 1 has no checked file list yet). The ordinary add really adds music; the heard
 *   route and the owner's mark are the real routes, and a non-owner credential (the agent bearer) really gets 403 owner_required.
 * - STAND-IN (labelled, a Playwright route in the browser, never in the server): while the real server cannot yet answer a «ready» kit
 *   or a matched preview (until the sampler W1 and the Config wiring are merged), the kits answer «ready» with the CONTRACT's shape and
 *   the preview answers two synthetic tone WAVs (one second and two seconds, from synthWav) with x-pf-instruments and x-pf-level-scale
 *   headers. Everything the page does with them is real: the order, the volumes, the reveal, the duties, the request bodies. The real
 *   server's answer to a recorded add is passed through (501 today, a 409 refusal after the wiring); both are a refusal in words.
 * What waits for W1 and the wiring: that the real server itself answers «ready» and a real recorded preview with a real level scale.
 * Nobody here can listen: every check is a measurement of the page (states, words, order, volume numbers, request bytes, focus).
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import { startServer, type RunningServer } from '@pulseframe/server';
import { auditionPair } from '../../../apps/web/src/editor/instruments/instruments.logic.ts';
import { instrumentsT } from '../../../apps/web/src/editor/instruments/instruments.strings.ts';
import { INSTRUMENTS_TESTIDS as ID } from '../../../apps/web/src/editor/instruments/instruments.testids.ts';
import { synthWav, writeSyntheticKit } from '../../fixtures/src/instruments.ts';

export interface InstrumentsProofPart { built: boolean; checks: Record<string, () => Promise<true | string>> }

const art = fs.mkdtempSync(path.join(os.tmpdir(), `pf-instruments-ui-${process.pid}-`));
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });
const freePort = async () => { const x = net.createServer(); await new Promise<void>((r) => x.listen(0, '127.0.0.1', r)); const p = (x.address() as net.AddressInfo).port; await new Promise((r) => x.close(r)); return p; };

/** The contract's shape (core MusicKitStatus), written here; two SYNTHETIC sources so every duty is shown. */
const standInKit = (heard: { at: string } | null) => ({
  kitId: 'kit.calm.vsco', version: 1, styleId: 'music.calm', state: 'ready', reason: null,
  parts: [{ part: 'pad', instrument: 'strings', title: { he: 'מיתרים', en: 'Strings' } }, { part: 'arp', instrument: 'piano', title: { he: 'פסנתר', en: 'Piano' } }],
  sources: [
    { sourceId: 'synthetic-by', title: 'SYNTHETIC CC-BY TEST SOURCE', licenceId: 'CC-BY-4.0', credit: true, nonCommercial: false, shareable: true },
    { sourceId: 'synthetic-nc', title: 'SYNTHETIC CC-BY-NC TEST SOURCE', licenceId: 'CC-BY-NC-4.0', credit: true, nonCommercial: true, shareable: false },
    { sourceId: 'synthetic-zero', title: 'SYNTHETIC CC0 TEST SOURCE', licenceId: 'CC0-1.0', credit: false, nonCommercial: false, shareable: true },
  ],
  label: { he: 'כלים מוקלטים — עוד לא הושמעו לאף אחד', en: 'Recorded instruments — nobody has listened yet' }, heard,
});
const tone = (seconds: number) => synthWav({ rate: 8000, channels: 1, bits: 16, frames: Math.round(8000 * seconds), freq: 220, amp: 0.3 });
const WAV = { synth: { bytes: tone(1), scale: '1', ms: 1000 }, recorded: { bytes: tone(2), scale: '0.5', ms: 2000 } } as const;
const ORDINARY_BODY = '{"styleId":"music.calm","bars":16,"seed":1,"start":{"value":"0","timescale":1}}';
const RECORDED_BODY = '{"styleId":"music.calm","bars":16,"seed":1,"start":{"value":"0","timescale":1},"instruments":"recorded"}';

let noLib: RunningServer | null = null, withLib: RunningServer | null = null, browser: Browser | null = null;
let all: Promise<{ I16: string[]; I17: string[] }> | null = null;

async function projectOn(s: RunningServer, name: string): Promise<string> {
  const made = await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: { authorization: `Bearer ${s.auth.tokens.agent}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, width: 640, height: 360, frameRate: { num: 30, den: 1 } }) });
  return ((await made.json()) as { project: { id: string } }).project.id;
}
const assetCount = (s: RunningServer, pid: string) => Object.keys(s.store.getProject(pid).doc.assets).length;
const realKits = async (s: RunningServer) => ((await (await fetch(`${s.url}/api/v1/music/kits`, { headers: { authorization: `Bearer ${s.auth.tokens.agent}` } })).json()) as { kits: { state: string; heard: { at: string } | null }[] }).kits[0]!;

interface Seen { plays: { volume: number; bytes: number | null }[]; posts: string[]; recordedPreviewHits: number; kitsGets: number }
interface Opts { lang: 'he' | 'en'; width: number; /** the heard POST is sent to the real server with this server's AGENT bearer instead of the owner's cookie (the editor itself opens only as owner) */ asAgent?: RunningServer; standIn?: { heard: { at: string } | null; noLevel?: boolean } }
async function open(s: RunningServer, pid: string, o: Opts): Promise<{ page: Page; ctx: BrowserContext; seen: Seen; standIn: Opts['standIn'] }> {
  const ctx = await browser!.newContext({ viewport: { width: o.width, height: 900 }, reducedMotion: 'reduce' });
  await ctx.addInitScript('globalThis.__name = (f) => f');
  await ctx.addInitScript(([l]) => { try { localStorage.setItem('pf.lang', l!); localStorage.setItem('pf.theme', 'dark'); } catch { /* storage unavailable */ } }, [o.lang] as const);
  // records every play(): the volume the page gave the element and the size of the bytes it holds (to tell the versions apart)
  await ctx.addInitScript(() => {
    (window as unknown as { __plays: unknown[] }).__plays = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const rec = { volume: this.volume, bytes: null as number | null }; // bytes = the length in milliseconds of what the element holds (tells the versions apart)
      (window as unknown as { __plays: unknown[] }).__plays.push(rec);
      const el = this;
      const note = () => { rec.bytes = Math.round(el.duration * 1000); };
      if (Number.isFinite(el.duration)) note(); else el.addEventListener('loadedmetadata', note, { once: true });
      return orig.call(this);
    };
  });
  const seen: Seen = { plays: [], posts: [], recordedPreviewHits: 0, kitsGets: 0 };
  const st = o.standIn;
  if (st) {
    await ctx.route('**/api/v1/music/kits', (r) => { seen.kitsGets++; void r.fulfill({ json: { kits: [standInKit(st.heard)] } }); });
    await ctx.route('**/api/v1/music/kits/*/heard', async (r: Route) => {
      const resp = o.asAgent ? await r.fetch({ headers: { ...r.request().headers(), cookie: '', authorization: `Bearer ${o.asAgent.auth.tokens.agent}` } }) : await r.fetch();
      if (resp.status() === 200 && r.request().method() === 'POST') st.heard = ((await resp.json()) as { heard: { at: string } | null }).heard;
      await r.fulfill({ response: resp });
    });
    await ctx.route('**/api/v1/music/music.calm/audio**', (r) => {
      const url = new URL(r.request().url());
      const want = url.searchParams.get('instruments') === 'recorded' ? 'recorded' : 'synth';
      if (want === 'recorded') seen.recordedPreviewHits++;
      const headers: Record<string, string> = { 'x-pf-instruments': want, 'content-type': 'audio/wav' };
      if (url.searchParams.get('match') === '1' && !(st.noLevel && want === 'recorded')) headers['x-pf-level-scale'] = WAV[want].scale;
      void r.fulfill({ status: 200, headers, body: WAV[want].bytes });
    });
  }
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
  return { page, ctx, seen, standIn: st };
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

  // ===== STAND-IN «ready» kit on the real library server (the real server answers every POST)
  {
    const pid = await projectOn(withLib!, `instr-ui-${lang}-c`);
    const { page, ctx, seen, standIn } = await open(withLib!, pid, { lang, width: 1440, standIn: { heard: null } });
    guard(page);
    try {
      await settle(page);
      await opt(page, 'recorded').click();
      step('I17', (await row(page).getByTestId(ID.state).getAttribute('data-state')) === 'ready', 'STAND-IN: a ready kit shows «ready»');
      const body = await row(page).locator('[data-part=duties]').textContent();
      step('I17', !!body && body.includes('SYNTHETIC CC-BY TEST SOURCE') && body.includes(t('nonCommercial')) && body.includes(t('dutiesHeading')), 'the credit and «לשימוש לא מסחרי בלבד» are said before the add');
      step('I17', (await row(page).locator('[data-duty=credit]').count()) === 2 && (await row(page).locator('[data-duty=non-commercial]').count()) === 1 && (await row(page).locator('[data-duty=none]').count()) === 1, 'one credit line per credited source, one non-commercial line, one no-duty line');
      const bad = /\b(better|real|realistic|warm|natural|authentic|rich|lifelike)\b|טוב יותר|אמיתי|חם|טבעי|עשיר|מציאותי/i;
      step('I17', !bad.test((await row(page).locator('.pf-instruments').innerText()).replace(/SYNTHETIC[^\n]*/g, '')), 'no recorded claim in the rendered text');

      // ---- the blind pair
      const open1 = row(page).getByTestId(ID.audition);
      step('I17', (await open1.getAttribute('aria-disabled')) !== 'true', 'the pair is offered for a ready kit');
      await open1.click();
      await row(page).getByTestId(ID.auditionA).waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid=instruments-audition-a]')?.getAttribute('aria-disabled') !== 'true', undefined, { timeout: 8000 }).catch(() => undefined);
      const A = row(page).getByTestId(ID.auditionA), B = row(page).getByTestId(ID.auditionB), R = row(page).getByTestId(ID.reveal);
      step('I17', (await A.textContent())?.trim() === t('auditionA') && (await B.textContent())?.trim() === t('auditionB'), 'the two players are «א» and «ב», unlabelled otherwise');
      const dom = await row(page).locator('.pf-instr-pair').evaluate((el) => [...el.querySelectorAll('*')].flatMap((e) => [...e.attributes].filter((x) => x.name !== 'data-testid' && x.name !== 'class' && x.name !== 'id' && x.name !== 'aria-controls').map((x) => x.value)).join(' ') + ' ' + (el as HTMLElement).innerText);
      step('I17', !/recorded|synth|מוקלט|מסונתז/i.test(dom.replace(t('auditionHelp'), '').replace(t('levelNote'), '')), 'nothing in the page tells which is which before the reveal');
      step('I17', (await R.getAttribute('aria-disabled')) === 'true', 'the reveal waits until both were played');
      await A.click();
      await page.waitForTimeout(250);
      step('I17', (await R.getAttribute('aria-disabled')) === 'true', 'after one it still waits');
      await B.click();
      await page.waitForFunction(() => (window as unknown as { __plays: { bytes: number | null }[] }).__plays.length >= 2 && (window as unknown as { __plays: { bytes: number | null }[] }).__plays.every((x) => x.bytes !== null), undefined, { timeout: 8000 }).catch(() => undefined);
      await page.waitForFunction(() => document.querySelector('[data-testid=instruments-reveal]')?.getAttribute('aria-disabled') !== 'true', undefined, { timeout: 8000 }).catch(() => undefined);
      step('I17', (await R.getAttribute('aria-disabled')) !== 'true', 'after both the reveal is open');
      const plays = await page.evaluate(() => (window as unknown as { __plays: { volume: number; bytes: number }[] }).__plays);
      const pair = auditionPair('music.calm', 16, 1);
      const expectA = WAV[pair.a], expectB = WAV[pair.b];
      step('I16', plays.length === 2 && plays[0]!.bytes === expectA.ms && plays[0]!.volume === Number(expectA.scale), `«א» plays the ${pair.a} version at its header's level (${JSON.stringify(plays[0])}, expected ${expectA.ms} ms, volume ${expectA.scale})`);
      step('I16', plays.length === 2 && plays[1]!.bytes === expectB.ms && plays[1]!.volume === Number(expectB.scale), `«ב» plays the ${pair.b} version at its header's level (${JSON.stringify(plays[1])}, expected ${expectB.ms} ms, volume ${expectB.scale})`);
      step('I16', plays.length === 2 && plays.some((p) => p.volume === 0.5) && plays.some((p) => p.volume === 1), 'the two volumes are the two header values (one version is turned down, none is scaled in the bytes)');
      step('I16', seen.recordedPreviewHits >= 1, 'the recorded preview was asked for with match=1');
      await R.click();
      const rev = await row(page).locator('[data-part=revealed]').textContent();
      step('I17', rev === t('revealed', { a: t(pair.a), b: t(pair.b) }), `the reveal tells the order drawn from the request (${rev})`);
      // the same request gives the same order, nothing was stored
      await open1.click();
      await open1.click();
      await A.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid=instruments-audition-a]')?.getAttribute('aria-disabled') !== 'true', undefined, { timeout: 8000 }).catch(() => undefined);
      await A.click();
      await page.waitForFunction(() => (window as unknown as { __plays: { bytes: number | null }[] }).__plays.length >= 3 && (window as unknown as { __plays: { bytes: number | null }[] }).__plays[2]!.bytes !== null, undefined, { timeout: 8000 }).catch(() => undefined);
      const again = await page.evaluate(() => (window as unknown as { __plays: { volume: number; bytes: number }[] }).__plays[2]);
      step('I17', !!again && again.bytes === expectA.ms, 'reopening the same request gives the same «א»');
      step('I17', (await row(page).locator('[data-part=revealed]').count()) === 0, 'the reveal is forgotten when the pair is reopened');
      const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
      step('I17', !/audition|instrument|recorded|reveal/i.test(stored), 'the page stored no choice');

      // ---- «הוספה» with the recorded kit chosen and ready: the field is sent; the real server's answer is a refusal in words, nothing added
      const before = assetCount(withLib!, pid);
      seen.posts.length = 0;
      const getsBefore = seen.kitsGets;
      await row(page).getByTestId('music-add').click();
      await page.waitForFunction(() => /./.test(document.querySelector('.pf-music-status.is-err,.pf-music-status.is-ok')?.textContent ?? ''), undefined, { timeout: 60000 }).catch(() => undefined);
      const status = ((await page.locator('.pf-music-status').textContent()) ?? '').trim();
      step('I17', seen.posts.length === 1 && seen.posts[0] === RECORDED_BODY, `a recorded add sends the optional field (${seen.posts[0]})`);
      if ((await page.locator('.pf-music-status.is-err').count()) === 1) {
        step('I17', lang === 'he' ? /[א-ת]{3}/.test(status.replace(/^[^:]*:/, '')) : status.length > 20, `the refusal is in words (${status.slice(0, 160)})`);
        step('I17', assetCount(withLib!, pid) === before, 'the refused recorded add added nothing, and nothing was made with the synthesised sound');
        step('I17', seen.kitsGets > getsBefore, 'the kit state was asked for again after the refusal');
      } else {
        step('I17', assetCount(withLib!, pid) === before + 1 && status.includes(t('addedRecorded')), `the recorded add was accepted and says so (${status.slice(0, 120)})`);
      }
      // ---- the level scale missing: refused in words, nothing plays
      standIn!.noLevel = true;
      await open1.click();
      await open1.click();
      await page.waitForSelector('[data-part=audition-status]', { timeout: 8000 }).catch(() => undefined);
      const nl = (await row(page).locator('[data-part=audition-status]').textContent().catch(() => null)) ?? '';
      step('I16', nl.includes(t('auditionNoLevel')), `without x-pf-level-scale the pair is refused in words (${nl.slice(0, 100)})`);
      step('I16', (await A.getAttribute('aria-disabled')) === 'true', 'and its players stay disabled');
      standIn!.noLevel = false;

      // ---- «שמעתי»: the owner's own session
      const H = row(page).getByTestId(ID.heard);
      step('I17', (await H.count()) === 1 && (await H.getAttribute('aria-disabled')) !== 'true', '«שמעתי» is there for the owner');
      await H.click();
      await page.waitForFunction(() => document.querySelector('[data-testid=instruments-unheard]')?.getAttribute('data-heard') === 'true', undefined, { timeout: 8000 }).catch(() => undefined);
      const mark = await realKits(withLib!);
      const date = new Date().toISOString().slice(0, 10);
      step('I16', !!mark.heard && mark.heard.at.slice(0, 10) === date, `the owner's mark is stored by the server (${JSON.stringify(mark.heard)})`);
      const badge = await text(page, ID.unheard);
      step('I17', badge.includes(mark.heard!.at.slice(0, 10)) && !badge.includes(lang === 'he' ? 'עוד לא הושמעו' : 'nobody has listened'), `the badge shows the mark with its date (${badge})`);
      step('I17', ((await H.textContent()) ?? '').trim() === t('notHeard'), 'the button is now the way back');
      await H.click();
      await page.waitForFunction(() => document.querySelector('[data-testid=instruments-unheard]')?.getAttribute('data-heard') === 'false', undefined, { timeout: 8000 }).catch(() => undefined);
      step('I16', (await realKits(withLib!)).heard === null, 'the owner can take the mark back; the server holds no mark');
    } finally { await ctx.close(); }
  }

  // ===== STAND-IN «ready» kit, a NON-owner credential (the real server gets the AGENT bearer for the heard POST, no cookie): the control stays, the server's refusal is shown in words
  {
    const pid = await projectOn(withLib!, `instr-ui-${lang}-d`);
    const { page, ctx } = await open(withLib!, pid, { lang, width: 1440, asAgent: withLib!, standIn: { heard: null } });
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
      step('I16', (await realKits(withLib!)).heard === null, 'the refused mark stored nothing');
      step('I16', (await row(page).getByTestId(ID.unheard).getAttribute('data-heard')) === 'false', 'the kit stays unheard on the page');
    } finally { await ctx.close(); }
  }
  if (errors.length) out.I17.push(`${lang}: page errors: ${errors.slice(0, 3).join(' | ')}`);
  return out;
}

async function runAll() {
  noLib = await startServer({ port: await freePort(), host: '127.0.0.1', dataDir: path.join(art, 'data-a'), backupDir: null, libraryDir: null });
  const lib = writeSyntheticKit(path.join(art, 'lib'));
  withLib = await startServer({ port: await freePort(), host: '127.0.0.1', dataDir: path.join(art, 'data-b'), backupDir: null, libraryDir: lib.root });
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const total = { I16: [] as string[], I17: [] as string[] };
  for (const lang of ['he', 'en'] as const) { const r = await oneLanguage(lang); total.I16.push(...r.I16); total.I17.push(...r.I17); }
  return total;
}
export async function stopInstrumentsProofUi(): Promise<void> {
  await browser?.close().catch(() => undefined); browser = null;
  for (const s of [noLib, withLib]) await s?.close().catch(() => undefined);
  noLib = withLib = null;
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
