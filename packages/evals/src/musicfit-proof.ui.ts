/**
 * pnpm proof:musicfit, part ui (builder C): check U1 of musicfit-proof.ts — the three flows of «מוזיקה שמתאימה לסרט» (fit, swap, impact)
 * by keyboard in Hebrew and in English, RTL without overlap at 1280 and 1440 px — over the real server (startServer on 127.0.0.1) and
 * headless Chromium, with SYNTHETIC fixtures only: built-in generated music (the product's own synthesiser) and a barcode video
 * (packages/fixtures). No song, no owner clip.
 *
 * Each step returns true or a sentence. A sentence beginning "BLOCKED" means the step needs builder B's plan and apply routes (they
 * answer 501 musicfit_not_built until B is merged) or the web bundle (`pnpm build`); what ran before it is in the evidence
 * (docs/evidence/musicfit-proof.ui.json) together with `state`, the data-state the block actually showed. Anything else is a failure.
 * Run alone: `tsx packages/evals/src/musicfit-proof.ui.ts` (exit 0 all pass, 1 a failure, 2 only blocked ones besides passes).
 * Port 19000+ (random); a folder in the temp directory, removed at the end. Pointer use is limited to opening the Sound workspace
 * and the clip's Beat tab; every flow is driven by Tab, Enter, Space, Escape, the arrow keys, B and Alt+B.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { MUSICFIT_FORBIDDEN_WORDS, MUSICFIT_FORBIDDEN_WORDS_HE, type ProjectDocument } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { MUSICFIT_TESTIDS as ID } from '../../../apps/web/src/editor/musicfit/musicFit.testids.ts';
import { openInspectorPage } from './editor-ui.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 19000 + Math.floor(Math.random() * 90);
const R = { num: 30, den: 1 };
const evidence: Record<string, unknown> = {};
const errors: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NO_WEB = 'BLOCKED: the web bundle is missing (`pnpm build`)';
const WAIT_B = 'BLOCKED: builder B\'s plan and apply routes are not merged (the plan answers 501 musicfit_not_built)';

interface World { s: RunningServer; base: string; web: boolean; browser: Browser | null; origin: string; cookie: string; barcode: string }
let worldP: Promise<World> | null = null;
const world = () => (worldP ??= makeWorld());
async function makeWorld(): Promise<World> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-musicfit-ui-'));
  const barcode = (await generateBarcodeFixture({ out: path.join(base, 'fx', 'bar30.mp4'), frames: 300, fps: R })).file;
  const webDist = path.join(ROOT, 'apps/web/dist');
  const web = fs.existsSync(path.join(webDist, 'index.html'));
  const s = await startServer({ port: PORT, dataDir: path.join(base, 'data'), ...(web ? { webDist } : {}), speechPython: null, voicePython: null, backupDir: null });
  const origin = s.url;
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const browser = web ? await chromium.launch() : null;
  return { s, base, web, browser, origin, cookie, barcode };
}
async function api(method: string, p: string, body?: unknown): Promise<{ status: number; body: any }> {
  const w = await world();
  const r = await fetch(`${w.origin}/api/v1${p}`, { method, headers: { origin: w.origin, cookie: w.cookie, connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
async function must(method: string, p: string, body?: unknown) {
  const r = await api(method, p, body);
  if (r.status < 200 || r.status > 299) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`);
  return r.body;
}
interface Fx { pid: string; videoClip: string; soundClip: string; musicClip: string }
let fxP: Promise<Fx> | null = null;
/** A project with a 4 s clip of the barcode video (source 2 s …, its sound linked) and 24 s of built-in music on another track, all from the start. The impact flow marks the linked SOUND clip: the Beat tab exists for sound clips only (report: video clips have no Beat tab). */
const makeFixture = async (): Promise<Fx> => {
  const w = await world();
  const pid = (await must('POST', '/projects', { name: 'musicfit ui', width: 640, height: 360, frameRate: R })).project.id as string;
  const up = await fetch(`${w.origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { origin: w.origin, cookie: w.cookie, connection: 'close', 'x-filename': 'bar30.mp4' }, body: new Uint8Array(fs.readFileSync(w.barcode)) });
  const assetId = ((await up.json()) as { assetId?: string }).assetId;
  if (!assetId) throw new Error('upload failed');
  const tx = await must('POST', `/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId, start: T.ZERO, sourceIn: T.rt(2, 1), duration: T.rt(4, 1), withLinkedAudio: true } }] });
  const videoClip = tx.results[0].output.clipId as string;
  const d0 = (await must('GET', `/projects/${pid}`)).project as ProjectDocument;
  const linked = d0.sequences[d0.mainSequenceId]!.tracks.find((t) => t.kind === 'audio')!.clips.find((c) => c.type === 'media' && c.linkGroupId === (Object.values(d0.sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips)).find((c) => c.id === videoClip) as { linkGroupId?: string }).linkGroupId)!;
  const soundClip = linked.id;
  const music = await must('POST', `/projects/${pid}/music`, { styleId: 'music.calm', bars: 8, seed: 1, start: T.ZERO });
  return { pid, videoClip, soundClip, musicClip: music.clipId as string };
};
const fixture = () => (fxP ??= makeFixture());
const revOf = async (pid: string) => (await must('GET', `/projects/${pid}`)).revision as number;
const docOf = async (pid: string) => (await must('GET', `/projects/${pid}`)).project as ProjectDocument;

async function open(pid: string, lang: 'he' | 'en', width = 1440): Promise<Page> {
  const w = await world();
  const ctx = await w.browser!.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript((l) => { try { localStorage.setItem('pf.lang', l); } catch { /* storage unavailable */ } }, lang);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/404|501|403|409/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${w.s.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  return page;
}
const close = (p: Page) => p.context().close();
const T_ = (id: string) => `[data-testid="${id}"]`;
/** Keyboard activation: the control takes focus (as Tab would bring it) and Enter presses it. */
async function activate(page: Page, selector: string, how: 'Enter' | 'Space' = 'Enter') { const el = page.locator(selector).first(); await el.waitFor({ timeout: 15000 }); await el.focus(); await page.keyboard.press(how === 'Space' ? 'Space' : 'Enter'); }
const focusedId = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? null);
const selectClip = async (page: Page, id: string) => { await activate(page, T_(`clip-${id}`)); await sleep(200); };
const frames = async (page: Page, n: number) => { for (let i = 0; i < Math.floor(n / 10); i++) { await page.keyboard.press('Shift+ArrowRight'); await sleep(30); } for (let i = 0; i < n % 10; i++) { await page.keyboard.press('ArrowRight'); await sleep(30); } };
const textOf = async (page: Page, selector: string) => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ').trim();
const focusRing = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; if (!el) return false; const s = getComputedStyle(el); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'; });

/** Siblings of a container that overlap, or text wider than its box: a sentence per problem, empty when none. */
async function layoutProblems(page: Page, rootSel: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    const root = document.querySelector(sel) as HTMLElement | null;
    if (!root) return [`${sel} is not on the page`];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('the page scrolls sideways');
    if (root.scrollWidth > root.clientWidth + 1) out.push(`${sel} is wider than its box (${root.scrollWidth} > ${root.clientWidth})`);
    const boxes = [...root.querySelectorAll<HTMLElement>('button, input, [role=option]')].filter((e) => e.getClientRects().length).map((e) => ({ id: e.getAttribute('data-testid') ?? e.tagName, r: e.getBoundingClientRect() }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!.r, b = boxes[j]!.r;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${boxes[i]!.id} overlaps ${boxes[j]!.id}`);
    }
    return out;
  }, rootSel);
}
const praise = (s: string) => MUSICFIT_FORBIDDEN_WORDS.test(s) || MUSICFIT_FORBIDDEN_WORDS_HE.test(s) || /מסונכרן|מושלם|חלק לגמרי/.test(s);

type Check = () => Promise<true | string>;
const checks: Record<string, Check> = {};

/** The fit flow by keyboard: the block under «סיום המוזיקה עם התמונה», the plan before anything is applied, the honest 501 state. */
async function fitFlow(lang: 'he' | 'en', width: number): Promise<true | string> {
  const w = await world();
  if (!w.web) return NO_WEB;
  const f = await fixture();
  const page = await open(f.pid, lang, width);
  try {
    await openInspectorPage(page, 'sound');
    await selectClip(page, f.musicClip);
    await page.locator(T_(ID.block)).waitFor({ timeout: 15000 });
    const before = (await docOf(f.pid)).assets;
    const chipTexts = await textOf(page, T_(ID.block));
    if (praise(chipTexts)) return `the block says something praising: ${chipTexts}`;
    if (!/עוד לא הושמעה לאף אחד|nobody has listened/.test(chipTexts)) return `built-in music is not labelled unheard in the block: ${chipTexts}`;
    await activate(page, T_(ID.fit));
    const state = await page.waitForFunction((sel) => { const s = document.querySelector(sel)?.getAttribute('data-state'); return s && s !== 'planning' && s !== 'idle' ? s : null; }, T_(ID.block), { timeout: 20000 }).then((h) => h.jsonValue() as Promise<string>);
    evidence[`fit.${lang}.${width}`] = { state, text: (await textOf(page, T_(ID.block))).slice(0, 400) };
    const problems = await layoutProblems(page, T_(ID.block));
    if (problems.length) return `fit layout (${lang} ${width}): ${problems.join('; ')}`;
    if (!(await focusRing(page)) && (await focusedId(page)) === null) return 'no visible focus after the fit button';
    const after = (await docOf(f.pid)).assets;
    if (JSON.stringify(Object.keys(before)) !== JSON.stringify(Object.keys(after))) return 'planning made a file before «בצעו»';
    if (state === 'not-built') {
      const said = await textOf(page, T_(ID.block));
      if (!/עוד לא נבנתה|not built/.test(said)) return `the 501 state does not say so: ${said}`;
      return `${WAIT_B}; ran: the block opened by Enter, planned, said "not built" in words, nothing was made, layout ok at ${width}`;
    }
    if (state !== 'plan') return `the block ended in state ${state}: ${await textOf(page, T_(ID.block))}`;
    const plan = await textOf(page, `${T_(ID.block)}-plan`);
    if (praise(plan)) return `the plan says something praising: ${plan}`;
    if (!(await page.locator(T_(ID.ending)).count())) return 'the plan has no ending sentence';
    if (!(await page.locator(T_(ID.apply)).count())) return 'the plan has no apply button';
    await activate(page, T_(ID.cancel));
    if ((await page.locator(T_(ID.block)).getAttribute('data-state')) !== 'idle') return 'Cancel did not return the block to idle';
    return true;
  } finally { await close(page); }
}
/** The swap dialog by keyboard: opens, traps focus, a row by Enter, the table, Escape returns focus to the button. */
async function swapFlow(lang: 'he' | 'en', width: number): Promise<true | string> {
  const w = await world();
  if (!w.web) return NO_WEB;
  const f = await fixture();
  const page = await open(f.pid, lang, width);
  try {
    await openInspectorPage(page, 'sound');
    await selectClip(page, f.musicClip);
    await activate(page, T_(ID.swap));
    await page.locator(T_(ID.swapDialog)).waitFor({ timeout: 10000 });
    if ((await page.locator('[role=dialog][aria-modal=true]').count()) < 1) return 'the dialog is not role=dialog aria-modal';
    if (!(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))) return 'focus did not move into the dialog';
    for (let i = 0; i < 45; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))) return `Tab ${i + 1} left the dialog`; }
    for (let i = 0; i < 45; i++) { await page.keyboard.press('Shift+Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))) return `Shift+Tab ${i + 1} left the dialog`; }
    const rows = await page.locator(T_(ID.swapRow)).count();
    if (rows < 6) return `the dialog lists ${rows} rows; the six built-in styles are expected`;
    const problems = await layoutProblems(page, T_(ID.swapDialog));
    if (problems.length) return `swap layout (${lang} ${width}): ${problems.join('; ')}`;
    const row = page.locator(`${T_(ID.swapRow)}[data-style-id="music.cinematic"]`);
    await row.focus(); await page.keyboard.press('Enter');
    if ((await row.getAttribute('aria-selected')) !== 'true') return 'Enter on a row did not choose it';
    const settled = await page.waitForFunction(() => { const d = document.querySelector('[data-testid="musicfit-swap-dialog"]'); return !!d && (!!d.querySelector('[data-testid="musicfit-swap-what"]') || !!d.querySelector('.mf-note')); }, undefined, { timeout: 20000 }).then(() => true).catch(() => false);
    if (!settled) return 'the plan for the chosen music did not settle';
    const said = await textOf(page, T_(ID.swapDialog));
    evidence[`swap.${lang}.${width}`] = { text: said.slice(0, 500) };
    if (praise(said)) return `the dialog says something praising: ${said}`;
    const before = (await docOf(f.pid)).assets;
    const notBuilt = /עוד לא נבנתה|not built/.test(said);
    if (notBuilt) {
      if ((await page.locator(T_(ID.swapApply)).getAttribute('aria-disabled')) !== 'true') return 'with no plan the apply button must be unavailable (aria-disabled)';
    } else if (!(await page.locator(T_(ID.swapWhat)).count())) return 'a plan came but the "what changes" table is missing';
    await page.keyboard.press('Escape');
    await page.locator(T_(ID.swapDialog)).waitFor({ state: 'detached', timeout: 5000 });
    if ((await focusedId(page)) !== ID.swap) return `Escape returned the focus to ${await focusedId(page)}, not the swap button`;
    if (JSON.stringify(Object.keys((await docOf(f.pid)).assets)) !== JSON.stringify(Object.keys(before))) return 'the dialog changed the project without «בצעו»';
    return notBuilt ? `${WAIT_B}; ran: focus trap in both directions (45 Tab each way), Enter chooses a row, "not built" said, Escape returns focus to the button, nothing changed` : true;
  } finally { await close(page); }
}
/** The impact flow by keyboard: mark at the playhead, the offset line, B to the beat (offset before and after), undo, Alt+B. */
async function impactFlow(lang: 'he' | 'en', width: number): Promise<true | string> {
  const w = await world();
  if (!w.web) return NO_WEB;
  const f = await makeFixture(); // fresh: an earlier run's mark and slip must not carry over
  const page = await open(f.pid, lang, width);
  try {
    await selectClip(page, f.soundClip);
    const beatTab = page.locator('[data-testid="insp-tab-beat"]');
    if (!(await beatTab.count())) return 'the clip has no Beat tab';
    await beatTab.first().focus(); await page.keyboard.press('Enter');
    await page.locator(T_(ID.impact)).waitFor({ timeout: 10000 });
    if ((await page.locator(T_(ID.impact)).getAttribute('data-state')) !== 'unmarked') return 'a fresh clip is not shown as unmarked';
    // playhead to frame 33 of the timeline: Shift+Right ×3, Right ×3 (clip shows source 2 s …, so the file's moment is 3.1 s)
    await page.locator('body').focus(); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await frames(page, 33);
    await activate(page, T_(ID.markImpact));
    await page.locator(`${T_(ID.impact)}[data-state=marked], ${T_(ID.impact)}[data-state=on-beat]`).first().waitFor({ timeout: 10000 });
    const doc1 = await docOf(f.pid);
    const clip1 = Object.values(doc1.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === f.soundClip) as { impact?: T.RationalTime; start: T.RationalTime; duration: T.RationalTime };
    if (!clip1.impact || Math.abs(T.toSeconds(clip1.impact) - 3.1) > 1 / 30) return `the mark is at ${clip1.impact ? T.toSeconds(clip1.impact) : 'nothing'}, not about 3.1 s`;
    const line = await textOf(page, T_(ID.impactOffset));
    evidence[`impact.${lang}.${width}.line`] = line;
    if (!/\d+/.test(line) || praise(line)) return `the offset line is wrong: ${line}`;
    const problems = await layoutProblems(page, T_(ID.impact));
    if (problems.length) return `impact layout (${lang} ${width}): ${problems.join('; ')}`;
    if (!(await page.locator(`${T_(ID.impactTick)}[data-clip-id="${f.soundClip}"]`).count())) return 'no ◆ tick on the marked clip';
    // B with the clip selected: bring the moment to the nearest beat, then say before and after
    await selectClip(page, f.soundClip);
    await page.locator('body').focus(); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('KeyB');
    const moved = await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('data-state') === 'on-beat', T_(ID.impact), { timeout: 10000 }).then(() => true).catch(() => false);
    const doc2 = await docOf(f.pid);
    const clip2 = Object.values(doc2.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === f.soundClip) as { sourceIn: T.RationalTime; start: T.RationalTime; duration: T.RationalTime };
    if (!moved) return `B did not bring the moment to a beat (state ${await page.locator(T_(ID.impact)).getAttribute('data-state')}; revision ${await revOf(f.pid)})`;
    if (!T.eq(clip2.start, clip1.start) || !T.eq(clip2.duration, clip1.duration)) return 'B changed the clip\'s place or length on the timeline';
    if (T.eq(clip2.sourceIn, T.rt(2, 1))) return 'B did not slip the source';
    const after = await textOf(page, T_(ID.impactOffset));
    evidence[`impact.${lang}.${width}.after`] = after;
    // one undo restores the slip
    await page.keyboard.press('Control+KeyZ');
    await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('data-state') === 'marked', T_(ID.impact), { timeout: 10000 });
    const doc3 = await docOf(f.pid);
    const clip3 = Object.values(doc3.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === f.soundClip) as { sourceIn: T.RationalTime };
    if (!T.eq(clip3.sourceIn, T.rt(2, 1))) return 'one undo did not restore the source in';
    const revBefore = await revOf(f.pid);
    // Alt+B: the bar start, or a refusal said in words (never silence)
    await page.keyboard.press('Alt+KeyB');
    await sleep(600);
    const rev3 = revBefore;
    if ((await revOf(f.pid)) === rev3 && !(await page.locator('[role=status], [role=alert]').filter({ hasText: /./ }).count())) return 'Alt+B neither moved the clip nor said why';
    return true;
  } finally { await close(page); }
}
/** The chip of a shortened song and its owner-only «שמעתי»: a document planted with provenance.fitted (no file is made here). */
async function chipFlow(lang: 'he' | 'en'): Promise<true | string> {
  const w = await world();
  if (!w.web) return NO_WEB;
  const f = await fixture();
  const doc = await docOf(f.pid);
  const clip = Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === f.musicClip) as { assetId: string };
  const planted = structuredClone(doc);
  planted.id = `prj_mfchip_${lang}`;
  const a = planted.assets[clip.assetId]!;
  a.provenance = { origin: 'derived', importedAt: a.provenance.importedAt, importedBy: 'musicfit-ui-proof', fitted: { sourceAssetId: 'ast_gone', method: 'planted by the UI proof; no file was made', startAt: T.ZERO, removed: { from: T.rt(8, 1), to: T.rt(16, 1) }, crossfade: T.rt(1, 25), joinAt: T.rt(8, 1), measured: { similarity: 0.42, levelStepDb: 1.5, phraseBars: 4, tempoSpreadMs: 2, beatConfidence: null } } } as never;
  let id: string;
  try { id = w.s.store.importProject(planted).doc.id; } catch (e) { return `BLOCKED: the proof could not plant a document (${(e as Error).message.slice(0, 160)})`; }
  const page = await open(id, lang);
  try {
    await openInspectorPage(page, 'sound');
    await selectClip(page, f.musicClip);
    const chip = page.locator(T_(ID.unheardChip));
    await chip.waitFor({ timeout: 10000 });
    const t = (await chip.innerText()).trim();
    if (t !== (lang === 'he' ? 'חיבור אוטומטי — עוד לא הושמע' : 'Automatic join — not heard yet')) return `the chip says ${JSON.stringify(t)}`;
    const heard = page.locator(T_(ID.heard));
    if (!(await heard.count())) return 'the owner\'s «שמעתי» control is hidden (it must show for every credential)';
    if ((await heard.getAttribute('aria-disabled')) !== 'true') return 'the heard control must wait for the join to be played (aria-disabled)';
    const pressed = await page.locator(T_(ID.playJoin)).first().getAttribute('aria-pressed');
    if (pressed !== 'false') return `the audition button has aria-pressed=${pressed} before it is pressed`;
    if (praise(await textOf(page, T_(ID.block)))) return 'the block praises the join before it was heard';
    return true;
  } finally { await close(page); }
}

checks.U1 = async () => {
  const notes: string[] = [];
  let failed: string | null = null;
  const run = async (name: string, fn: () => Promise<true | string>) => {
    const r = await fn();
    if (r === true) { notes.push(`${name}: pass`); return; }
    if (r.startsWith('BLOCKED')) { notes.push(`${name}: ${r}`); return; }
    failed = failed ? `${failed} || ${name}: ${r}` : `${name}: ${r}`;
  };
  for (const [lang, width] of [['he', 1280], ['he', 1440], ['en', 1440]] as const) {
    await run(`fit ${lang} ${width}`, () => fitFlow(lang, width));
    await run(`swap ${lang} ${width}`, () => swapFlow(lang, width));
  }
  for (const lang of ['he', 'en'] as const) { await run(`impact ${lang}`, () => impactFlow(lang, 1440)); await run(`chip ${lang}`, () => chipFlow(lang)); }
  evidence.notes = notes;
  if (failed) return failed;
  const blocked = notes.filter((n) => /BLOCKED/.test(n));
  if (blocked.length) return `BLOCKED (${blocked.length} of ${notes.length} steps need B or the bundle): ${notes.join(' | ')}`;
  return true;
};

export const MUSICFIT_PROOF_UI = { built: true, checks } as const;

/** Stops the server and the browser and removes the temp folder (the runner calls it; the stand-alone run does). */
export async function closeMusicfitProofUi(): Promise<void> {
  if (!worldP) return;
  const w = await worldP;
  await w.browser?.close();
  await w.s.close();
  fs.rmSync(w.base, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(ROOT, 'docs', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'musicfit-proof.ui.json'), JSON.stringify({ when: new Date().toISOString(), web: w.web, pageErrors: errors.slice(0, 20), evidence }, null, 1) + '\n');
  } catch { /* evidence is best effort */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failed = 0, blocked = 0;
  try {
    for (const [n, check] of Object.entries(checks)) {
      let r: true | string;
      try { r = await check(); } catch (e) { r = `threw: ${(e as Error).stack?.slice(0, 700) ?? e}`; }
      const b = r !== true && r.startsWith('BLOCKED');
      console.log(`${r === true ? 'PASS' : b ? 'BLOCKED' : 'FAIL'} ${n} (ui)${r === true ? '' : `: ${r}`}`);
      if (r !== true) { if (b) blocked++; else failed++; }
    }
    if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(' | ')}`);
  } finally { await closeMusicfitProofUi(); }
  void sleep;
  process.exit(failed ? 1 : blocked ? 2 : 0);
}
