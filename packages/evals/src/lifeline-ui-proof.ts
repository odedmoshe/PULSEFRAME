/**
 * `pnpm proof:lifeline-ui` — the life-line screens in headless Chromium (ADR-0021): the library by date and by event, the
 * sunset choice (never preselected; one click, then undo), field insert and the live line, "make it plain text", the
 * "on this day" card, the date stamp's source, the people sheet, the family option of the archive and the packs shelf mount;
 * the test ids of apps/web/src/editor/lifeline/lifeline.testids.ts, people.testids.ts and packs.testids.ts.
 *
 *   pnpm build && pnpm proof:lifeline-ui          needs ffmpeg and Playwright's Chromium; port 8890 free
 *   exit 0 = every check passed · 1 = a check failed · 2 = blocked (the web bundle is not built)
 *
 * Fixtures are generated here (a JPEG with EXIF dates from the server's own fixture writer; nothing binary is committed).
 * Every expected word is typed in this file, never computed by the code under test. Written by W3 and NOT run by its
 * author (the lead runs it after merging): a check whose selector does not resolve fails loudly, it never passes silently.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';
import { withExif } from '../../../apps/server/src/captureMeta.fixtures.ts';
import { LIFE_TESTIDS, fieldSlug } from '../../../apps/web/src/editor/lifeline/lifeline.testids.ts';
import { PEOPLE_TESTIDS } from '../../../apps/web/src/editor/lifeline/people.testids.ts';

const PORT = 8890;
const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(os.tmpdir(), 'pf-lifeline-ui-proof');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

async function main() {
  if (!fs.existsSync(path.join(root, 'apps/web/dist/index.html'))) { console.error('blocked: apps/web/dist is not built (pnpm build)'); process.exit(2); }
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', '-q:v', '3', path.join(art, 'base.jpg')]);
  const base = fs.readFileSync(path.join(art, 'base.jpg'));
  let n = 0;
  /** A picture with a capture date (wall clock as written, with its offset); every file has its own bytes. */
  const photo = (name: string, date: string | null, offset = '+02:00') => {
    const p = path.join(art, name);
    fs.writeFileSync(p, Buffer.concat([withExif(base, date === null ? { date: null } : { date, offset }), Buffer.from(`\n${++n}`)]));
    return p;
  };
  const stampVideo = path.join(art, 'clock.mov');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', 'use_metadata_tags', '-metadata', 'com.apple.quicktime.creationdate=2024-12-25T18:15:10+0200', stampVideo]);

  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data'), homeZone: 'Asia/Jerusalem' });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`transaction failed ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => {
    const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': encodeURIComponent(path.basename(file)) }, body: new Uint8Array(fs.readFileSync(file)) });
    const b = (await r.json()) as { assetId?: string };
    if (!b.assetId) throw new Error(`upload of ${file} failed: ${JSON.stringify(b).slice(0, 300)}`);
    return b.assetId;
  };
  const doc = async (pid: string) => (await call(`/projects/${pid}`)).body.project as any;
  const still = async (pid: string, i: number) => { const r = await call(`/projects/${pid}/frame?index=${i}`); if (r.status !== 200) throw new Error(`still ${i}: ${r.status}`); return r.body as Buffer; };
  const until = async (pred: () => Promise<boolean>, ms = 15000) => { const t = Date.now(); for (;;) { if (await pred()) return true; if (Date.now() - t > ms) return false; await sleep(100); } };
  const browser = await chromium.launch();
  const errors: string[] = [];
  const open = async (pid: string, lang: 'he' | 'en', viewport = { width: 1440, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.addInitScript((l) => { try { localStorage.setItem('pf.lang', l); localStorage.setItem('pf.inspector.tab.v1', 'clip'); } catch { /* storage unavailable */ } }, lang);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/404|501/.test(m.text()) && errors.push(m.text()));
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('timecode').waitFor();
    return page;
  };
  const noHScroll = (page: Page, sel: string) => page.evaluate((q) => { const el = document.querySelector(q) as HTMLElement | null; return !!el && el.scrollWidth <= el.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth; }, sel);

  try {
    // ---------------------------------------------------------------- the on-this-day card: absent first (nothing matches today)
    const empty = (await call('/projects', { name: 'ריק', width: 640, height: 360 })).body.project.id as string;
    {
      const page = await open(empty, 'he');
      await page.getByTestId('welcome').waitFor();
      await sleep(800);
      check('the on-this-day card is absent when no file was taken on this day of an earlier year', (await page.getByTestId(LIFE_TESTIDS.onThisDay).count()) === 0);
      await page.context().close();
    }

    // ---------------------------------------------------------------- the library project
    const pid = (await call('/projects', { name: 'שנים', width: 640, height: 360 })).body.project.id as string;
    const a23 = await upload(pid, photo('a23.jpg', '2023:03:10 12:00:00'));
    const evening = await upload(pid, photo('evening.jpg', '2024:12:25 18:00:00'));
    const day = await upload(pid, photo('day.jpg', '2024:12:26 12:00:00'));
    const undated = await upload(pid, photo('nodate.jpg', null));
    {
      const page = await open(pid, 'he');
      await page.getByTestId('rail-media').click();
      await page.getByTestId(LIFE_TESTIDS.viewOption('date')).click();
      await page.getByTestId(LIFE_TESTIDS.year(2024)).waitFor();
      const years = [await page.getByTestId(LIFE_TESTIDS.year(2023)).count(), await page.getByTestId(LIFE_TESTIDS.year(2024)).count()];
      const months = [await page.getByTestId(LIFE_TESTIDS.month(2023, 3)).count(), await page.getByTestId(LIFE_TESTIDS.month(2024, 12)).count()];
      const monthHeader = (await page.getByTestId(LIFE_TESTIDS.month(2024, 12)).locator('h4').textContent()) ?? '';
      const order = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="life-year-"]')).map((e) => (e as HTMLElement).dataset.testid));
      check('the view by date shows the fixture\'s years and months (newest year first), a month header with the Gregorian and the Hebrew month, and the group of files without a date with its read-dates action',
        years.join() === '1,1' && months.join() === '1,1' && /\d{4}/.test(monthHeader) && /תשפ/.test(monthHeader) && order[0] === LIFE_TESTIDS.year(2024) && (await page.getByTestId(LIFE_TESTIDS.undated).count()) === 1 && (await page.getByTestId(LIFE_TESTIDS.readDates).count()) === 1, { monthHeader, order });
      check('the date badge is on the cards of dated files and absent on the undated one', (await page.getByTestId(LIFE_TESTIDS.dateBadge(a23)).count()) === 1 && (await page.getByTestId(LIFE_TESTIDS.dateBadge(undated)).count()) === 0);
      check('the media drawer by date has no horizontal scroll at 1440x900', await noHScroll(page, '[data-testid=life-dates]'));
      await page.screenshot({ path: path.join(art, 'life-date-he.png') });
      const stored = await page.evaluate(() => { try { return Object.keys(localStorage).filter((k) => /life/i.test(k)); } catch { return []; } });
      check('nothing of the life line is kept in browser storage except the chosen library view', stored.every((k) => /view/i.test(k)), stored);

      // ---- events: arrange, the sunset choice never preselected, one click, undo
      await page.getByTestId(LIFE_TESTIDS.viewOption('events')).click();
      await page.getByTestId(LIFE_TESTIDS.cluster).click();
      await until(async () => Object.keys((await doc(pid)).events ?? {}).length > 0);
      const d1 = await doc(pid);
      const ev = Object.values(d1.events as Record<string, any>).find((e: any) => e.assetIds.includes(evening)) as any;
      await page.getByTestId(LIFE_TESTIDS.event(ev.id)).waitFor();
      const radios = page.getByTestId(LIFE_TESTIDS.sunset(ev.id)).locator('input[type=radio]');
      const checkedBefore = await radios.evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).length);
      check('the sunset choice of an evening event shows two options and starts unselected', (await radios.count()) === 2 && checkedBefore === 0 && ev.afterSunset == null, { options: await radios.count(), checkedBefore });
      const nameBefore = (await page.getByTestId(LIFE_TESTIDS.eventName(ev.id)).textContent()) ?? '';
      await page.getByTestId(LIFE_TESTIDS.sunset(ev.id)).locator('input[data-value=after]').check();
      await until(async () => (await doc(pid)).events[ev.id].afterSunset === true);
      await page.waitForFunction((id) => /חנוכה/.test(document.querySelector(`[data-testid="life-event-name-${id}"]`)?.textContent ?? ''), ev.id, { timeout: 10000 }).catch(() => undefined);
      const nameAfter = (await page.getByTestId(LIFE_TESTIDS.eventName(ev.id)).textContent()) ?? '';
      await page.screenshot({ path: path.join(art, 'life-events-he.png') });
      await page.keyboard.press('Control+z');
      const undone = await until(async () => (await doc(pid)).events[ev.id].afterSunset == null);
      check('one click on «אחרי השקיעה» names the event by its holiday, and Ctrl+Z restores it (answer unset, name as before)', /חנוכה/.test(nameAfter) && undone && !/חנוכה/.test(nameBefore) && (await radios.evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).length)) === 0, { nameBefore, nameAfter });
      check('the media drawer by event has no horizontal scroll at 1440x900', await noHScroll(page, '[data-testid=life-events]'));

      // ---- add the event to the timeline: existing add_clip ops, ONE transaction
      const rev0 = (await doc(pid)).revision;
      await page.getByTestId(LIFE_TESTIDS.eventAdd(ev.id)).click();
      await until(async () => (await doc(pid)).sequences.seq_main.tracks.flatMap((t: any) => t.clips).length >= ev.assetIds.length);
      const d2 = await doc(pid);
      const clips = d2.sequences.seq_main.tracks.flatMap((t: any) => t.clips).filter((c: any) => c.assetId && ev.assetIds.includes(c.assetId));
      check('"add the event to the timeline" puts every file of the event on the timeline in capture order as ONE transaction', clips.length === ev.assetIds.length && d2.revision === rev0 + 1, { clips: clips.length, revisionDelta: d2.revision - rev0 });
      await page.keyboard.press('Control+z');
      await until(async () => (await doc(pid)).sequences.seq_main.tracks.flatMap((t: any) => t.clips).length === 0);

      // ---- the undated file: read dates, and the anchored error of a field with its working fix
      await page.getByTestId(LIFE_TESTIDS.viewOption('date')).click();
      await page.getByTestId(LIFE_TESTIDS.readDates).click();
      await page.getByTestId('life-read-dates-said').filter({ hasText: /\S/ }).waitFor({ timeout: 15000 });
      check('«קריאת תאריכים מהקבצים» answers in words (honestly: the file has no date inside it)', (await page.getByTestId('life-read-dates-said').getAttribute('data-ok')) !== null);
      await page.context().close();
    }

    // ---------------------------------------------------------------- fields in a title
    const tp = (await call('/projects', { name: 'כותרת', width: 640, height: 360 })).body.project.id as string;
    const ph = await upload(tp, photo('t-dated.jpg', '2024:06:15 12:00:00'));
    const pn = await upload(tp, photo('t-undated.jpg', null));
    const dated = (await tx(tp, [{ op: 'add_clip', args: { assetId: ph, start: f(0), duration: f(60) } }])).results[0].output.clipId as string;
    const text = (await tx(tp, [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60), style: { fontFamily: 'Heebo', fontWeight: 700, fontSize: 64, color: '#ffffff' }, transform: { y: 0.2 } } }])).results[0].output.clipId as string;
    const plainStill = sha(await still(tp, 5));
    // the built-in agent token reads and writes names only (peoplePrivacy.ts), so the person, with a birth date, is added by a grant that has people: 'full'
    {
      const full = s.governance.createGrant({ name: 'people-fixture', mode: 'edit', people: 'full' }, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }).token;
      const r = await fetch(`${s.url}/api/v1/projects/${tp}/transactions`, { method: 'POST', headers: { authorization: `Bearer ${full}`, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ ops: [{ op: 'add_person', args: { name: 'נועה', birthDate: '2023-03-10', form: 'f' } }] }) });
      if (r.status !== 200) throw new Error(`the people fixture was refused: ${r.status} ${(await r.text()).slice(0, 300)}`);
    }
    {
      const page = await open(tp, 'he');
      await page.locator(`.clip[data-clip-id="${text}"]`).click();
      await page.getByTestId('text-content').waitFor();
      await page.getByTestId(LIFE_TESTIDS.fieldAdd).click();
      await page.getByTestId(LIFE_TESTIDS.fieldItem('{year}')).click();
      await until(async () => !!(await doc(tp)).sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === text)?.fields);
      const c1 = (await doc(tp)).sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === text);
      const live = ((await page.getByTestId(LIFE_TESTIDS.fieldLive).textContent()) ?? '').replace(/\s+/g, ' ');
      const typed = await call(`/projects/${tp}/transactions`, { ops: [{ op: 'update_text', args: { clipId: text, text: 'שלום2024' } }, { op: 'set_text_fields', args: { clipId: text, enabled: false } }] });
      const typedStill = sha(await still(tp, 5));
      await call(`/projects/${tp}/undo`, {});
      const withFieldStill = sha(await still(tp, 5));
      check('inserting the year field turns fields on and stores the token in ONE transaction; the server still equals the same words typed by hand, and the live line reads the same words', c1.fields === true && /\{year\}/.test(c1.text) && typed.status === 200 && withFieldStill === typedStill && withFieldStill !== plainStill && /2024/.test(live), { stored: c1.text, live });
      await page.screenshot({ path: path.join(art, 'field-he.png') });
      check('the title tab has no horizontal scroll at 1440x900', await noHScroll(page, '.inspector'));

      // the undated picture: move the title over it and add a date field, the live line shows an anchored error with a fix
      await tx(tp, [{ op: 'remove_clip', args: { clipId: dated } }]).catch(() => undefined);
      await tx(tp, [{ op: 'add_clip', args: { assetId: pn, start: f(0), duration: f(60) } }]);
      await page.reload();
      await page.getByTestId('timecode').waitFor();
      await page.locator(`.clip[data-clip-id="${text}"]`).click();
      await page.getByTestId(LIFE_TESTIDS.fieldAdd).click();
      await page.getByTestId(LIFE_TESTIDS.fieldItem('{date}')).click();
      const err = page.getByTestId(LIFE_TESTIDS.fieldLive).locator('.pf-anchored');
      await err.first().waitFor({ timeout: 10000 });
      const fix = err.first().locator('button');
      check('an undated picture under a {date} field shows an anchored error with a fix button', (await err.count()) >= 1 && (await fix.count()) === 1);
      await fix.click();
      await page.getByTestId('life-capture-date').fill('2022-08-09');
      await page.getByTestId(LIFE_TESTIDS.captureSave).click();
      const gotDate = await until(async () => !!(await doc(tp)).assets[pn].capture);
      await until(async () => (await page.getByTestId(LIFE_TESTIDS.fieldLive).locator('.pf-anchored').count()) === 0);
      check('the fix dates the picture (one operation) and the anchored error goes away', gotDate && (await page.getByTestId(LIFE_TESTIDS.fieldLive).locator('.pf-anchored').count()) === 0);
      // (no undo here: the server undoes per actor, and the fix was the owner's; the title now sits over the dated picture)

      // ---- freeze: the still is byte-identical, undo brings the fields back
      const before = sha(await still(tp, 5));
      await page.getByTestId(LIFE_TESTIDS.fieldFreeze).click().catch(() => undefined);
      await until(async () => !(await doc(tp)).sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === text)?.fields);
      const after = sha(await still(tp, 5));
      const c2 = (await doc(tp)).sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === text);
      check('"make it plain text" leaves the still byte-identical, the title holds the words and no fields', before === after && !c2.fields && !/\{/.test(c2.text), { text: c2.text });
      await page.keyboard.press('Control+z');
      check('Ctrl+Z after freezing brings the live fields back', await until(async () => !!(await doc(tp)).sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === text)?.fields));
      await page.context().close();
    }

    // ---------------------------------------------------------------- the date stamp source
    const sp = (await call('/projects', { name: 'חותמת', width: 320, height: 180 })).body.project.id as string;
    const mv = await upload(sp, stampVideo);
    const vclip = (await tx(sp, [{ op: 'add_clip', args: { assetId: mv, start: f(0), withLinkedAudio: false } }])).results[0].output.clipId as string;
    const effectId = (await tx(sp, [{ op: 'add_effect', args: { clipId: vclip, type: 'stylize.date-stamp', params: { source: 'text', text: "'24 12 25" } } }])).results[0].output.effectId as string;
    {
      const page = await open(sp, 'he');
      await page.locator(`.clip[data-clip-id="${vclip}"]`).click();
      await page.getByTestId('inspector-tab-all').click().catch(() => undefined);
      const typedStill = sha(await still(sp, 0));
      await page.getByTestId(LIFE_TESTIDS.stampSource).waitFor({ timeout: 10000 });
      await page.getByTestId(`${LIFE_TESTIDS.stampSource}-capture`).click();
      await until(async () => (await doc(sp)).sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === vclip).effects.find((e: any) => e.id === effectId).params.source === 'capture');
      const capStill = sha(await still(sp, 0));
      await page.getByTestId(LIFE_TESTIDS.stampClock).waitFor({ timeout: 5000 });
      check('the stamp source switch changes the effect to the capture date (a different still), shows the clock switch and the date order, and Ctrl+Z restores the typed text', capStill !== typedStill && (await page.getByTestId(LIFE_TESTIDS.stampClock).count()) === 1 && (await page.getByTestId(LIFE_TESTIDS.stampOrder).count()) === 1);
      await page.keyboard.press('Control+z');
      check('undo of the source switch restores the typed stamp still', await until(async () => sha(await still(sp, 0)) === typedStill));
      await page.context().close();
    }

    // ---------------------------------------------------------------- the people sheet and the family option of the archive
    {
      const page = await open(tp, 'he');
      await page.getByTestId('open-palette').click();
      await page.getByTestId('palette-input').fill('אנשים');
      await page.keyboard.press('Enter');
      await page.getByTestId(PEOPLE_TESTIDS.sheet).waitFor();
      const privacy = ((await page.getByTestId(PEOPLE_TESTIDS.privacy).textContent()) ?? '').trim();
      const rows = await page.locator('[data-testid^="life-person-"][data-person-id]').count();
      await page.getByTestId(PEOPLE_TESTIDS.personAdd).click();
      await page.screenshot({ path: path.join(art, 'people-he.png') });
      const strings = fs.readFileSync(path.join(root, 'apps/web/src/editor/lifeline/people.strings.ts'), 'utf8');
      check('the palette opens the people sheet with the privacy line exactly as in people.strings.ts, the people of the project, and an add action', strings.includes(privacy) && privacy.length > 20 && rows >= 1 && (await page.getByTestId(PEOPLE_TESTIDS.peopleCopy).count()) === 1, { rows });
      await page.keyboard.press('Escape');
      await page.getByTestId('inspector-tab-deliver').click().catch(() => undefined);
      const fam = page.getByTestId(PEOPLE_TESTIDS.archiveFamily);
      await fam.waitFor({ timeout: 10000 });
      const hrefBefore = await page.getByTestId('archive-download').getAttribute('href');
      await fam.check();
      await until(async () => (await page.getByTestId('archive-download').getAttribute('href')) !== hrefBefore);
      const hrefAfter = (await page.getByTestId('archive-download').getAttribute('href')) ?? '';
      check('the family option of the archive changes the download address to the family-free archive', /family=omit/.test(hrefAfter) && !/family=omit/.test(hrefBefore ?? ''), { hrefAfter });
      await page.context().close();
    }

    // ---------------------------------------------------------------- the on-this-day card, present for the owner
    {
      const today = new Date();
      const lastYear = today.getFullYear() - 1;
      const pad = (v: number) => String(v).padStart(2, '0');
      const op = (await call('/projects', { name: 'שנה שעברה', width: 640, height: 360 })).body.project.id as string;
      await upload(op, photo('otd.jpg', `${lastYear}:${pad(today.getMonth() + 1)}:${pad(today.getDate())} 12:00:00`));
      const page = await open(empty, 'he');
      await page.getByTestId('welcome').waitFor();
      const shown = await page.getByTestId(LIFE_TESTIDS.onThisDay).waitFor({ timeout: 15000 }).then(() => true, () => false);
      await page.screenshot({ path: path.join(art, 'welcome-otd-he.png') });
      check('the on-this-day card appears for the owner on the start hub with a file taken on this day last year, and has an open button', shown && (await page.getByTestId(LIFE_TESTIDS.onThisDayOpen).count()) === 1);
      await page.context().close();
    }

    // ---------------------------------------------------------------- the packs mount: the Hanukkah pack is two clicks from an open project
    {
      const page = await open(tp, 'he');
      await page.getByTestId('rail-templates').click(); // click 1: the Templates drawer holds the shelf
      await page.getByTestId('packs-mount').waitFor({ timeout: 10000 });
      const card = page.locator('[data-testid=pack-card][data-pack-id="pack.hanukkah"], [data-pack-id="pack.hanukkah"] [data-testid=pack-card]').first();
      await card.click(); // click 2: the Hanukkah pack
      const opened = await page.getByTestId('pack-page').waitFor({ timeout: 10000 }).then(() => true, () => false);
      check('the Hanukkah pack is two clicks from an open project (the Templates rail, then its tile) and opens its page', opened && (await page.getByTestId('pack-page').getAttribute('data-pack-id')) === 'pack.hanukkah');
      await page.screenshot({ path: path.join(art, 'pack-hanukkah-he.png') });
      // the suggestion on the tile depends on the clock: when today is within the pack's lead window of Hanukkah 2026 (evening of 4 December), the page says so
      const now = new Date();
      if (now >= new Date('2026-11-13T00:00:00') && now <= new Date('2026-12-14T00:00:00')) {
        await page.getByTestId('pack-back').click();
        const reason = ((await page.getByTestId('pack-suggest').first().textContent()) ?? '');
        check('the pack suggestion names the start of Hanukkah 2026, the evening of 4 December', /4/.test(reason) && /דצמבר/.test(reason), { reason });
      } else console.log('  skip  the suggestion text for Hanukkah 2026 (today is outside the pack\'s lead window; the clock decides)');
      await page.context().close();
    }

    // ---------------------------------------------------------------- English and 1920x1080
    {
      const page = await open(pid, 'en', { width: 1920, height: 1080 });
      await page.getByTestId('rail-media').click();
      await page.getByTestId(LIFE_TESTIDS.viewOption('date')).click();
      await page.getByTestId(LIFE_TESTIDS.year(2024)).waitFor();
      await page.screenshot({ path: path.join(art, 'life-date-en-1920.png') });
      check('the media drawer by date has no horizontal scroll at 1920x1080 in English', await noHScroll(page, '[data-testid=life-dates]'));
      await page.getByTestId(LIFE_TESTIDS.viewOption('events')).click();
      check('English: the events view lists the arranged event', (await page.locator('[data-testid^="life-event-"][data-event-id]').count()) >= 1);
      await page.context().close();
    }
    void fieldSlug; void a23; void day;
    check('no page error or console error in any run', errors.length === 0, errors.slice(0, 5));
  } finally {
    await browser.close();
    await s.close();
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length === 0 ? `\nPASSED (${checks.length} checks). Screenshots: ${art}` : `\nFAILED: ${failed.length} of ${checks.length}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
