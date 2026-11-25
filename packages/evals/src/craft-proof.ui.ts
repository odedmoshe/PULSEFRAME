/**
 * pnpm proof:craft, part ui (W3): checks R8, F7, F8, F10, U1–U3 of craft-proof.ts, in headless Chromium against the REAL server and the
 * BUILT web app (`pnpm build` first), on SYNTHETIC fixtures only: barcode clips by packages/fixtures and typed Hebrew titles. Keys are
 * sent as physical codes with a Hebrew `key` (a Hebrew layout), so what is checked is the code-based binding, not a Latin letter.
 * A synthetic KeyboardEvent is not a real key press: it reaches the same window listener, but a real Hebrew keyboard (and AltGr on
 * Ctrl+Alt+V) is for the owner's laptop. The headless browser shows no "save page" or "find" dialog of its own, so what is checked
 * for Ctrl+S and Ctrl+F is that the editor calls preventDefault on them (the event's defaultPrevented), in every state the decisions
 * file names. Each check returns true, or a sentence. U2 and U3 run the two audits as they are (`PF_A11Y_STRICT=1 pnpm audit:a11y`,
 * `pnpm audit:testids -- --static`).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { canonical, findClip, type ProjectDocument } from '@pulseframe/core';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer, type RunningServer } from '@pulseframe/server';
import { CRAFT_TESTIDS as TID } from '../../../apps/web/src/editor/craft/craft.testids.ts';
import { CRAFT_STRINGS } from '../../../apps/web/src/editor/craft/craft.strings.ts';
import type { CraftProofPart } from './craft-proof.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const PORT = 19900 + Math.floor(Math.random() * 90);
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The Latin letter a Hebrew layout puts on each physical key the proof presses (the `key` of the event). */
const HEBREW_KEY: Record<string, string> = { KeyQ: '/', KeyW: "'", KeyG: 'ע', KeyD: 'ג', KeyV: 'ה', KeyF: 'כ', KeyS: 'ד', KeyZ: 'ז', KeyC: 'ב', KeyA: 'ש', KeyK: 'ל' };

interface Ctx {
  s: RunningServer; browser: Browser; art: string; closed: boolean;
  agent: Record<string, string>;
}
let ctxP: Promise<Ctx> | null = null;
const built = () => fs.existsSync(path.join(ROOT, 'apps/web/dist/index.html')) && fs.existsSync(path.join(ROOT, 'apps/web/dist/selftest.html'));
function setup(): Promise<Ctx> {
  ctxP ??= (async () => {
    if (!built()) throw new Error('the web bundle (apps/web/dist) is not built: run `pnpm build` first');
    const art = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-craft-ui-'));
    const s = await startServer({ port: PORT, dataDir: path.join(art, 'data') });
    await generateBarcodeFixture({ out: path.join(art, 'sea.mp4'), width: 320, height: 180, frames: 90 });
    const browser = await chromium.launch();
    return { s, browser, art, closed: false, agent: { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' } };
  })();
  return ctxP;
}
async function teardown() {
  if (!ctxP) return;
  const c = await ctxP;
  if (c.closed) return;
  c.closed = true;
  await c.browser.close().catch(() => undefined);
  await c.s.close().catch(() => undefined);
}

// ---------------------------------------------------------------- a project and a page
interface Proj { pid: string; a: string; b: string; title: string; title2: string; page: Page; close(): Promise<void> }
const call = async (c: Ctx, method: string, p: string, body?: unknown) => {
  const r = await fetch(`${c.s.url}/api/v1${p}`, { method, headers: { ...c.agent, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (r.headers.get('content-type') ?? '').includes('json');
  return { status: r.status, body: json ? ((await r.json()) as any) : null };
};
const tx = async (c: Ctx, pid: string, ops: unknown[]) => { const r = await call(c, 'POST', `/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`transaction failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const doc = async (c: Ctx, pid: string): Promise<{ doc: ProjectDocument; revision: number }> => { const r = await call(c, 'GET', `/projects/${pid}`); return { doc: r.body.project, revision: r.body.revision }; };
const docHash = async (c: Ctx, pid: string) => sha(canonical((await doc(c, pid)).doc));

/** A project of two 60-frame video clips back to back on the main track, two Hebrew titles and a marker; the editor open on it. */
async function open(c: Ctx, lang: 'he' | 'en', name: string): Promise<Proj> {
  const pid = (await call(c, 'POST', '/projects', { name, width: 320, height: 180, frameRate: R })).body.project.id as string;
  const up = await fetch(`${c.s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...c.agent, 'x-filename': 'sea.mp4' }, body: fs.readFileSync(path.join(c.art, 'sea.mp4')) });
  const asset = ((await up.json()) as any).assetId as string;
  const a = (await tx(c, pid, [{ op: 'add_clip', args: { assetId: asset, start: f(0), duration: f(60), withLinkedAudio: false } }])).results[0].output.clipId as string;
  const trackId = findClip((await doc(c, pid)).doc, a)!.track.id;
  const b = (await tx(c, pid, [{ op: 'add_clip', args: { assetId: asset, trackId, start: f(60), sourceIn: f(0), duration: f(30), withLinkedAudio: false } }])).results[0].output.clipId as string;
  const title = (await tx(c, pid, [{ op: 'add_text', args: { text: 'שלום נעה', start: f(70), duration: f(30) } }])).results[0].output.clipId as string;
  const title2 = (await tx(c, pid, [{ op: 'add_text', args: { text: 'נעה והילדים', start: f(100), duration: f(20) } }, { op: 'add_marker', args: { time: f(110) } }])).results[0].output.clipId as string;
  const ctx = await c.browser.newContext({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(({ lang: l }) => { try { localStorage.setItem('pf.lang', l); localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.removeItem('pf.craft.paste.v1'); } catch { /* storage unavailable */ } (globalThis as { __pfToastProof?: boolean }).__pfToastProof = true; }, { lang });
  await ctx.addInitScript('globalThis.__name = (f) => f');
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 400)));
  await page.goto(`${c.s.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click();
  await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 3, undefined, { timeout: 15000 });
  return { pid, a, b, title, title2, page, close: () => ctx.close() };
}
/** One key, as a Hebrew layout sends it: a physical code, a Hebrew character as `key`. Returns whether the editor prevented the default. */
const key = (page: Page, code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => page.evaluate(({ code, mods, k }) => {
  const t = document.activeElement ?? document.body;
  const ev = new KeyboardEvent('keydown', { code, key: k, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, bubbles: true, cancelable: true });
  return !t.dispatchEvent(ev);
}, { code, mods, k: HEBREW_KEY[code] ?? code });
const timecode = async (page: Page) => (await page.getByTestId('timecode').innerText()).replace(/[^0-9:;]/g, '');
const tcOf = (frame: number) => T.toTimecode(f(frame), R).replace(/[^0-9:;]/g, '');
const seekTo = async (page: Page, frame: number) => { await key(page, 'KeyG'); await page.getByTestId(TID.timeInput).waitFor(); await page.getByTestId(TID.timeInput).fill(String(frame)); await page.keyboard.press('Enter'); await page.getByTestId(TID.timeEntry).waitFor({ state: 'detached' }); };
const selectClip = async (page: Page, id: string) => { await page.locator(`.clip[data-clip-id="${id}"]`).click({ position: { x: 4, y: 4 } }); };
const startOf = (d: ProjectDocument, id: string) => T.frameIndexAt(findClip(d, id)!.clip.start, R);
const lenOf = (d: ProjectDocument, id: string) => T.frameIndexAt(findClip(d, id)!.clip.duration, R);
const until = async (get: () => Promise<boolean>, ms = 8000) => { const t = Date.now(); for (;;) { if (await get()) return true; if (Date.now() - t > ms) return false; await sleep(100); } };

// ---------------------------------------------------------------- R8
async function R8(): Promise<true | string> {
  const c = await setup();
  const p = await open(c, 'he', 'R8');
  try {
    const page = p.page;
    // G under a Hebrew layout opens the time field; the typed time seeks (frame 20), and the playhead says so
    const g = await key(page, 'KeyG');
    if (!(await page.getByTestId(TID.timeEntry).count())) return 'G did not open «מעבר לזמן»';
    await page.getByTestId(TID.timeInput).fill('20');
    if (!/פריים 20/.test(await page.getByTestId(TID.timeLine).innerText())) return `the live line did not say frame 20: ${await page.getByTestId(TID.timeLine).innerText()}`;
    await page.keyboard.press('Enter');
    await page.getByTestId(TID.timeEntry).waitFor({ state: 'detached' });
    if ((await timecode(page)) !== tcOf(20)) return `G 20 Enter left the playhead at ${await timecode(page)}`;
    void g;
    // Q: the picture that was under the playhead (source frame 20) is now the clip's first frame; later main-track clips move by -20; the title and the marker stay
    await selectClip(page, p.a);
    await seekTo(page, 20);
    const before = await doc(c, p.pid);
    await key(page, 'KeyQ');
    if (!(await until(async () => lenOf((await doc(c, p.pid)).doc, p.a) === 40))) return `Q did not shorten the clip to 40 frames (it has ${lenOf((await doc(c, p.pid)).doc, p.a)})`;
    let d = (await doc(c, p.pid)).doc;
    const clipA = findClip(d, p.a)!.clip;
    if (startOf(d, p.a) !== 0 || T.frameIndexAt((clipA as { sourceIn: T.RationalTime }).sourceIn, R) !== 20) return `after Q the clip starts at ${startOf(d, p.a)} with source in ${JSON.stringify((clipA as any).sourceIn)}`;
    if (startOf(d, p.b) !== 40) return `Q left the later clip at ${startOf(d, p.b)}, not 40`;
    if (startOf(d, p.title) !== 70 || startOf(d, p.title2) !== 100) return 'Q moved a title (it must not)';
    if (Object.values(d.markers).some((m) => T.frameIndexAt(m.time, R) !== 110)) return 'Q moved the marker (it must not)';
    if (!(await until(async () => (await timecode(page)) === tcOf(0), 4000))) return `after Q the playhead is at ${JSON.stringify(await timecode(page))}, not ${JSON.stringify(tcOf(0))}`;
    if (!(await page.locator('[role=status], [data-kind=undo], .pf-toast').filter({ hasText: /נחתכו 20 פריימים/ }).count())) return 'the toast did not say «נחתכו 20 פריימים»';
    // the toast names what stayed
    if (!(await page.getByText(/כותרות, מוזיקה וסמנים שאחרי החיתוך נשארו במקומם/).count())) return 'the toast did not say that titles, music and markers stayed';
    await key(page, 'KeyZ', { ctrl: true });
    if (!(await until(async () => canonical((await doc(c, p.pid)).doc) === canonical(before.doc)))) return 'Ctrl+Z after Q did not return the exact document';
    // W: the tail goes to the playhead
    await seekTo(page, 20);
    await selectClip(page, p.a);
    await seekTo(page, 20);
    await key(page, 'KeyW');
    if (!(await until(async () => lenOf((await doc(c, p.pid)).doc, p.a) === 20))) return `W did not shorten the clip to 20 frames (it has ${lenOf((await doc(c, p.pid)).doc, p.a)})`;
    d = (await doc(c, p.pid)).doc;
    if (startOf(d, p.b) !== 20) return `W left the later clip at ${startOf(d, p.b)}, not 20`;
    await key(page, 'KeyZ', { ctrl: true });
    await until(async () => canonical((await doc(c, p.pid)).doc) === canonical(before.doc));
    // D: «משך הקליפ» with the clip selected; a typed 5s is 150 frames at 30
    await selectClip(page, p.a);
    await key(page, 'KeyD');
    if ((await page.getByTestId(TID.timeEntry).getAttribute('data-target')) !== 'duration') return 'D did not open the duration field';
    await page.getByTestId(TID.timeInput).fill('45');
    await page.keyboard.press('Enter');
    if (!(await until(async () => lenOf((await doc(c, p.pid)).doc, p.a) === 45))) return 'D 45 Enter did not set the duration';
    await key(page, 'KeyZ', { ctrl: true });
    await until(async () => canonical((await doc(c, p.pid)).doc) === canonical(before.doc));
    // Ctrl+Alt+V opens the paste dialog; with nothing copied it says so
    await selectClip(page, p.b);
    await key(page, 'KeyV', { ctrl: true, alt: true });
    if (!(await page.getByTestId(TID.pasteDialog).count())) return 'Ctrl+Alt+V did not open «הדבקת מאפיינים»';
    if (!(await page.getByTestId('craft-paste-empty').count())) return 'with nothing copied the dialog did not say so';
    // behind a dialog no editing command fires and nothing is committed
    const frozen = await docHash(c, p.pid);
    for (const code of ['KeyQ', 'KeyW', 'KeyD', 'KeyG']) await key(page, code);
    await sleep(300);
    if ((await docHash(c, p.pid)) !== frozen) return 'a command changed the document behind the paste dialog';
    if (await page.getByTestId(TID.timeEntry).count()) return 'G or D opened a field behind the paste dialog';
    // Ctrl+F and Ctrl+S: the browser's own dialogs are suppressed even with a modal open
    const prevS = await key(page, 'KeyS', { ctrl: true });
    const prevF = await key(page, 'KeyF', { ctrl: true });
    if (!prevS || !prevF) return `with a dialog open the editor did not prevent the browser default (Ctrl+S: ${prevS}, Ctrl+F: ${prevF})`;
    if (await page.getByTestId(TID.saveVersionField).count() || await page.getByTestId(TID.findPanel).count()) return 'Ctrl+S or Ctrl+F opened a surface behind a modal dialog';
    await page.keyboard.press('Escape');
    await page.getByTestId(TID.pasteDialog).waitFor({ state: 'detached' });
    // Ctrl+F opens the find panel with the focus in its field; Ctrl+S the one-line name field
    const f1 = await key(page, 'KeyF', { ctrl: true });
    await page.getByTestId(TID.findPanel).waitFor({ timeout: 5000 });
    if (!f1) return 'Ctrl+F was not prevented at rest';
    if (!(await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, TID.findInput))) return 'the find field did not take the focus';
    // typing in a field: editing commands do nothing; Ctrl+F stays prevented, Ctrl+S still opens the name field
    const h0 = await docHash(c, p.pid), tc0 = await timecode(page);
    for (const code of ['KeyQ', 'KeyW', 'KeyD', 'KeyG']) await key(page, code);
    await sleep(300);
    if ((await docHash(c, p.pid)) !== h0 || (await timecode(page)) !== tc0 || (await page.getByTestId(TID.timeEntry).count())) return 'a command fired while the cursor was in the find field';
    if (!(await key(page, 'KeyF', { ctrl: true }))) return 'Ctrl+F was not prevented with the cursor in a field';
    await page.keyboard.press('Escape');
    // Ctrl+S with the cursor in a title's own text field opens the name field and commits nothing
    await selectClip(page, p.title);
    const target = page.getByTestId('text-content');
    await target.waitFor({ timeout: 8000 });
    await target.focus();
    if (!(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'text-content'))) return 'the cursor is not in the title field';
    const rev0 = (await doc(c, p.pid)).revision;
    const s1 = await key(page, 'KeyS', { ctrl: true });
    await page.getByTestId(TID.saveVersionField).waitFor({ timeout: 5000 }).catch(() => undefined);
    if (!s1) return 'Ctrl+S in a field was not prevented';
    if (!(await page.getByTestId(TID.saveVersionField).count())) return 'Ctrl+S with the cursor in a title field did not open the name field';
    if ((await doc(c, p.pid)).revision !== rev0) return 'opening the name field committed something';
    if (((await call(c, 'GET', `/projects/${p.pid}/versions`)).body?.versions ?? []).length !== 0) return 'a version was saved by opening the field';
    // Enter saves it under the typed name
    const input = page.getByTestId(TID.saveVersionInput);
    if (!/^גרסה 1 · \d\d\.\d\d \d\d:\d\d$/.test(await input.inputValue())) return `the prefilled name was «${await input.inputValue()}»`;
    await input.fill('לפני הקיצור');
    await page.keyboard.press('Enter');
    if (!(await until(async () => (((await call(c, 'GET', `/projects/${p.pid}/versions`)).body?.versions ?? []) as any[]).some((v) => v.name === 'לפני הקיצור')))) return 'Enter in the name field did not save the version';
    if ((await doc(c, p.pid)).revision !== rev0) return 'saving a version changed the project';
    return true;
  } finally { await p.close(); }
}

// ---------------------------------------------------------------- F7
async function F7(): Promise<true | string> {
  const c = await setup();
  const p = await open(c, 'he', 'F7');
  try {
    const page = p.page;
    await key(page, 'KeyF', { ctrl: true });
    await page.getByTestId(TID.findPanel).waitFor();
    await page.getByTestId(TID.findInput).fill('נעה');
    await page.getByTestId(`${TID.findRow}-0`).waitFor({ timeout: 8000 });
    await page.getByTestId(TID.replaceInput).fill('נועה');
    if (!(await until(async () => /\(2\)/.test(await page.getByTestId(TID.replaceAll).innerText())))) return `the button did not count 2: ${await page.getByTestId(TID.replaceAll).innerText()}`;
    const texts = async () => { const d = (await doc(c, p.pid)).doc; return [p.title, p.title2].map((id) => (findClip(d, id)!.clip as { text: string }).text); };
    // an edit between the preview and Enter
    await tx(c, p.pid, [{ op: 'add_marker', args: { time: f(5) } }]);
    const rev = (await doc(c, p.pid)).revision;
    await page.getByTestId(TID.replaceAll).click();
    await page.getByText('הפרויקט השתנה — בדקו שוב').first().waitFor({ timeout: 8000 }).catch(() => undefined);
    if (!(await page.getByText('הפרויקט השתנה — בדקו שוב').count())) return 'the panel did not say «הפרויקט השתנה — בדקו שוב»';
    if ((await doc(c, p.pid)).revision !== rev) return 'the replacement committed although the project had moved';
    if ((await texts()).join('|') !== 'שלום נעה|נעה והילדים') return 'a text changed although nothing should have been committed';
    // searching again and replacing works: one transaction, and one undo returns the exact document
    const h = await docHash(c, p.pid);
    await page.getByTestId(TID.findInput).fill('נעה ');
    await page.getByTestId(TID.findInput).fill('נעה');
    await page.getByTestId(`${TID.findRow}-0`).waitFor({ timeout: 8000 });
    if (!(await until(async () => (await page.getByTestId('craft-find-stale').count()) === 0))) return 'the stale line stayed after searching again';
    await page.getByTestId(TID.replaceAll).click();
    if (!(await until(async () => (await texts()).join('|') === 'שלום נועה|נועה והילדים'))) return `after searching again the texts are ${(await texts()).join('|')}`;
    if ((await doc(c, p.pid)).revision !== rev + 1) return `replacing took ${(await doc(c, p.pid)).revision - rev} revisions, not one transaction`;
    await key(page, 'KeyZ', { ctrl: true });
    if (!(await until(async () => (await docHash(c, p.pid)) === h))) return 'one undo did not return the exact document';
    return true;
  } finally { await p.close(); }
}

// ---------------------------------------------------------------- F8
async function F8(): Promise<true | string> {
  const c = await setup();
  const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/src/findReplace.golden.json'), 'utf8')) as { cases: { text: string; needle: string; flags: Record<string, boolean>; ranges: [number, number][] }[] };
  if (golden.cases.length < 200) return `the golden has ${golden.cases.length} cases, fewer than 200`;
  const ctx = await c.browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(`${c.s.url}/selftest.html`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', undefined, { timeout: 120_000 });
    if (!(await page.evaluate(() => typeof (window as unknown as { __pfCraftMatch?: unknown }).__pfCraftMatch === 'function'))) return 'the self-test page has no __pfCraftMatch';
    const got = await page.evaluate((cases) => (window as unknown as { __pfCraftMatch: (c: unknown) => [number, number][][] }).__pfCraftMatch(cases), golden.cases.map((k) => ({ text: k.text, needle: k.needle, flags: k.flags })));
    const wrong = golden.cases.map((k, i) => ({ i, k, got: got[i] })).filter((x) => JSON.stringify(x.got) !== JSON.stringify(x.k.ranges));
    return wrong.length === 0 ? true : `${wrong.length} of ${golden.cases.length} cases differ in Chromium, the first: ${JSON.stringify({ text: wrong[0]!.k.text, needle: wrong[0]!.k.needle, flags: wrong[0]!.k.flags, node: wrong[0]!.k.ranges, chromium: wrong[0]!.got })}`;
  } finally { await ctx.close(); }
}

// ---------------------------------------------------------------- F10
async function F10(): Promise<true | string> {
  const c = await setup();
  const p = await open(c, 'he', 'F10');
  try {
    const page = p.page;
    await selectClip(page, p.a);
    await seekTo(page, 20);
    await key(page, 'KeyF', { ctrl: true });
    await page.getByTestId(TID.findInput).fill('נעה');
    await page.getByTestId(`${TID.findRow}-0`).waitFor({ timeout: 8000 });
    await page.getByTestId(TID.findList).focus();
    const h = await docHash(c, p.pid), tc = await timecode(page);
    const picked = async () => page.getByTestId(`${TID.findRow}-0`).getAttribute('aria-selected');
    const p0 = await picked();
    // real key presses, Latin layout and Hebrew layout both: Q, D, Delete and Space
    for (const k of ['KeyQ', 'KeyD', 'Delete', 'Space', 'KeyW', 'KeyG', 'Backspace']) { await page.keyboard.press(k); await sleep(80); }
    for (const code of ['KeyQ', 'KeyD', 'KeyW', 'KeyG']) await key(page, code);
    await sleep(400);
    if ((await docHash(c, p.pid)) !== h) return 'a key typed in the result list changed the document';
    if ((await timecode(page)) !== tc) return `a key typed in the result list moved the playhead from ${tc} to ${await timecode(page)}`;
    if (await page.getByTestId(TID.timeEntry).count()) return 'G or D opened the time field from the result list';
    if ((await picked()) === p0) return 'Space did not tick the row (the list is not reading its keys)';
    return true;
  } finally { await p.close(); }
}

// ---------------------------------------------------------------- U1
const S = CRAFT_STRINGS;
async function tools(c: Ctx, lang: 'he' | 'en'): Promise<true | string> {
  const p = await open(c, lang, `U1-${lang}`);
  const dirOf = (id: string) => p.page.getByTestId(id).evaluate((el) => getComputedStyle(el).direction);
  const tabTo = async (id: string, max = 40) => { for (let i = 0; i < max; i++) { if (await p.page.evaluate((x) => document.activeElement?.getAttribute('data-testid')?.startsWith(x) ?? false, id)) return true; await p.page.keyboard.press('Tab'); } return false; };
  try {
    const page = p.page;
    const dir = lang === 'he' ? 'rtl' : 'ltr';
    // 1. the time field: G, type, Enter; the field is left to right in both languages, the dialog follows the language
    await key(page, 'KeyG');
    await page.getByTestId(TID.timeInput).waitFor();
    if ((await dirOf(TID.timeInput)) !== 'ltr') return `${lang}: the time input is not left to right`;
    if ((await dirOf(TID.timeEntry)) !== dir) return `${lang}: the time field's dialog is not ${dir}`;
    await page.keyboard.type('0:02');
    { const t = await page.getByTestId(TID.timeLine).innerText(); if (!t.includes(lang === 'he' ? 'פריים 60' : 'frame 60')) return `${lang}: the live line said «${t}»`; }
    await page.keyboard.press('Enter');
    await page.getByTestId(TID.timeEntry).waitFor({ state: 'detached' });
    if (!(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'timecode'))) return `${lang}: the focus did not return to the timecode`;
    // 2. paste attributes: a copied clip with a blur, pasted by keys only onto the other video clip
    await tx(c, p.pid, [{ op: 'add_effect', args: { clipId: p.a, type: 'blur.gaussian' } }]);
    await page.reload();
    await page.getByTestId('timecode').waitFor();
    await selectClip(page, p.a);
    await key(page, 'KeyC', { ctrl: true });
    await selectClip(page, p.b);
    const before = (await doc(c, p.pid)).revision;
    await key(page, 'KeyV', { ctrl: true, alt: true });
    await page.getByTestId(TID.pasteDialog).waitFor();
    if ((await dirOf(TID.pasteDialog)) !== dir && !(await page.getByTestId(TID.pasteDialog).evaluate((el, d) => !!el.querySelector(`[dir=${d}]`), dir))) return `${lang}: the paste dialog has no ${dir} region`;
    if (!(await page.evaluate(() => !!document.activeElement && !!document.querySelector('[data-testid=craft-paste-dialog]')?.contains(document.activeElement)))) return `${lang}: the focus is not inside the paste dialog`;
    const effects = page.getByTestId(`${TID.pasteGroup}-effects`);
    if (!(await effects.count()) || (await effects.isDisabled())) return `${lang}: the effects group is not offered although the source has a blur`;
    const colour = page.getByTestId(`${TID.pasteGroup}-colour`);
    if (!(await colour.isDisabled())) return `${lang}: the colour group should be disabled (the source has no grade)`;
    await effects.focus();
    await page.keyboard.press('Enter');
    if (!(await until(async () => (await doc(c, p.pid)).revision === before + 1))) return `${lang}: Enter in the paste dialog did not commit one transaction`;
    const fx = (findClip((await doc(c, p.pid)).doc, p.b)!.clip as { effects?: { type: string }[] }).effects ?? [];
    if (!fx.some((e) => e.type === 'blur.gaussian')) return `${lang}: the blur was not pasted`;
    await page.getByTestId(TID.pasteDialog).waitFor({ state: 'detached' });
    // 3. find and replace: type, Tab to the list, Space, Enter jumps, Tab to «החלפת הכול», Enter
    await key(page, 'KeyF', { ctrl: true });
    await page.getByTestId(TID.findPanel).waitFor();
    if ((await dirOf(TID.findPanel)) !== dir) return `${lang}: the find panel is not ${dir}`;
    await page.keyboard.type(lang === 'he' ? 'נעה' : 'נעה');
    await page.getByTestId(`${TID.findRow}-0`).waitFor({ timeout: 8000 });
    await page.keyboard.press('Tab');
    await page.keyboard.type('נועה');
    if (!(await tabTo(TID.findList))) return `${lang}: Tab never reached the result list`;
    await page.keyboard.press('Enter');
    if (!(await page.locator(`.clip.selected[data-clip-id], .clip[aria-selected=true][data-clip-id]`).count()) && (await timecode(page)) === tcOf(0)) return `${lang}: Enter in the list neither selected the clip nor moved the playhead`;
    if (!(await tabTo(TID.replaceAll, 10))) { await page.keyboard.press('Tab'); }
    const rev = (await doc(c, p.pid)).revision;
    await page.getByTestId(TID.replaceAll).focus();
    await page.keyboard.press('Enter');
    if (!(await until(async () => (await doc(c, p.pid)).revision === rev + 1))) return `${lang}: replace all by keyboard did not commit`;
    const where = await page.evaluate(() => `${document.activeElement?.tagName}[${document.activeElement?.getAttribute('data-testid')}] modal=${document.querySelectorAll('[aria-modal="true"]').length}`);
    await page.keyboard.press('Escape');
    await page.getByTestId(TID.findPanel).waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
    if (await page.getByTestId(TID.findPanel).count()) return `${lang}: Escape did not close the find panel (focus on ${where})`;
    // 4. versions: Ctrl+S, type a name, Enter; the dialog from the command palette; compare, restore by keys
    await key(page, 'KeyS', { ctrl: true });
    await page.getByTestId(TID.saveVersionInput).fill(lang === 'he' ? 'לפני' : 'Before');
    await page.keyboard.press('Enter');
    if (!(await until(async () => (((await call(c, 'GET', `/projects/${p.pid}/versions`)).body?.versions ?? []) as any[]).length === 1))) return `${lang}: Ctrl+S, a name and Enter did not save a version`;
    await tx(c, p.pid, [{ op: 'trim_clip', args: { clipId: p.b, edge: 'end', to: f(80) } }]);
    await page.waitForFunction(() => true);
    await key(page, 'KeyK', { ctrl: true });
    await page.keyboard.type(lang === 'he' ? 'גרסאות' : 'Versions');
    await sleep(300);
    await page.keyboard.press('Enter');
    await page.getByTestId(TID.versionsDialog).waitFor({ timeout: 8000 });
    await page.getByTestId(`${TID.versionRow}-0`).waitFor({ timeout: 8000 }).catch(() => undefined);
    if (!(await page.getByTestId(`${TID.versionRow}-0`).count())) return `${lang}: the dialog lists no version`;
    if (!(await page.evaluate(() => !!document.querySelector('[data-testid=craft-versions-dialog]')?.contains(document.activeElement)))) return `${lang}: the focus is not inside the versions dialog`;
    await page.getByTestId(`${TID.versionRow}-0`).getByTestId(TID.versionCompare).focus();
    await page.keyboard.press('Enter');
    await sleep(1500);
    await page.getByTestId(TID.versionDiff).waitFor({ timeout: 15000 }).catch(() => undefined);
    if (!(await page.getByTestId(TID.versionDiff).count())) return `${lang}: the comparison showed no «מה השתנה»; the dialog says: ${(await page.getByTestId(TID.versionsDialog).innerText()).replace(/\s+/g, ' ').slice(0, 600)}`;
    const sentence = await page.getByTestId('craft-version-diff-sentence').innerText();
    if (!sentence.trim()) return `${lang}: «מה השתנה» is empty after an edit`;
    const restore = page.getByTestId(TID.versionRestore);
    await restore.focus();
    const before2 = (await doc(c, p.pid)).revision;
    await page.keyboard.press('Enter');
    if (!(await until(async () => (await doc(c, p.pid)).revision === before2 + 1))) return `${lang}: restore by keyboard did not commit one transaction`;
    await page.getByTestId(TID.versionsDialog).waitFor({ state: 'detached', timeout: 8000 });
    const d = (await doc(c, p.pid)).doc;
    if (lenOf(d, p.b) !== 30) return `${lang}: restore did not bring clip B back to 30 frames (it has ${lenOf(d, p.b)})`;
    return true;
  } finally { await p.close(); }
}
async function U1(): Promise<true | string> {
  const c = await setup();
  const he = await tools(c, 'he');
  if (he !== true) return he;
  return tools(c, 'en');
}

// ---------------------------------------------------------------- U2 and U3
async function U2(): Promise<true | string> {
  await teardown(); // the audit starts its own server and browser
  const r = spawnSync('pnpm', ['audit:a11y'], { cwd: ROOT, env: { ...process.env, PF_A11Y_STRICT: '1' }, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = `${r.stdout}\n${r.stderr}`;
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/evidence/a11y-audit.json'), 'utf8')) as { findings: number; runs: { uiLanguage: string; theme: string; states?: { state: string; shown?: boolean }[] }[] };
  const craft = new Map<string, number>();
  for (const run of report.runs) for (const st of run.states ?? []) if (st.state.startsWith('craft-') && st.shown === true) craft.set(st.state, (craft.get(st.state) ?? 0) + 1);
  if (craft.size < 4) return `the audit looked at ${craft.size} craft states (${[...craft.keys()].join(', ')}), fewer than the four: time field, paste dialog, find panel, versions compare`;
  if (r.status !== 0 || report.findings !== 0) return `the audit exited ${r.status} with ${report.findings} finding(s): ${out.split('\n').filter((l) => /finding|state/.test(l)).slice(-6).join(' | ')}`;
  return true;
}
async function U3(): Promise<true | string> {
  const r = spawnSync('pnpm', ['audit:testids', '--', '--static'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) return `audit:testids exited ${r.status}: ${`${r.stdout}${r.stderr}`.split('\n').slice(-8).join(' | ')}`;
  return true;
}
void execFileSync; void S;

const wrap = (fn: () => Promise<true | string>) => async (): Promise<true | string> => { try { return await fn(); } catch (e) { return `threw: ${String((e as Error)?.stack ?? e).slice(0, 500)}`; } };
export const CRAFT_PROOF_UI: CraftProofPart = {
  built: true,
  checks: { R8: wrap(R8), F7: wrap(F7), F8: wrap(F8), F10: wrap(F10), U1: wrap(U1), U2: wrap(async () => { try { return await U2(); } finally { await teardown(); } }), U3: wrap(U3) },
};
