/**
 * pnpm proof:search, part ui (builder C): the editor side of S1, the browser side of S3, S10 and U1 of footage-search-proof.ts, over the
 * real server (startServer on 127.0.0.1) and headless Chromium, with SYNTHETIC fixtures made here: a barcode video (packages/fixtures
 * generateBarcodeFixture, named colours.mp4) with a typed 12-word transcript. No owner clip is used. Expected numbers are typed here by
 * hand from the fixture, never read from the code under test.
 *
 * Each check returns true or a sentence. A sentence beginning "BLOCKED" means the check could not run to its end here: the server's picture
 * runtime (builder B) is not merged (the routes answer 501 footage_search_not_built) or the web bundle is missing (`pnpm build`). The part
 * of the check that does not need B has run and is in the evidence (docs/evidence/footage-search-proof.ui.json). Anything else is a failure.
 * Run alone: `tsx packages/evals/src/footage-search-proof.ui.ts` (exit 0 all pass, 1 a failure, 2 only blocked ones besides passes).
 * Port 18700+ (random); a folder in the temp directory, removed at the end.
 *
 * S1  with no picture runtime the editor finds files by name without a model, asking for pictures shows the picture part's honest state
 *     (not installed with its setup, or "not built" while the route answers 501) and NO picture row; no upload or image control exists.
 * S3  window.__pfFootageSearch(footageProofDoc(), q) equals the Node answer of footage-search-proof.core.ts for the 40 baseline queries.
 * S10 «הכנס במקום הסמן» from a transcript row is one commit placing exactly that word span snapped outward to frames; one undo restores
 *     the document.
 * U1  the flows by keyboard only (ArrowDown, Enter, Escape, Shift+Enter) in Hebrew and English, right to left in Hebrew, without overlap
 *     or sideways scrolling at 1280 and 1440 px.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { SEARCH_TESTIDS as ID } from '../../../apps/web/src/editor/search/search.testids.ts';
import { FOOTAGE_BASELINE_QUERIES, footageBaselineDigest, footageBaselineJson, footageProofDoc, type FootageProofPart } from './footage-search-proof.core.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const evidence: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { input, maxBuffer: 1 << 28 });
const canon = (v: unknown) => JSON.stringify(v);
const NO_WEB = 'BLOCKED: the web bundle is missing (`pnpm build`)';
const WAIT_B = 'BLOCKED: builder B\'s server runtime (the picture part of the search routes) is not merged in this build; the routes answer 501 footage_search_not_built';

// ---------- the world ----------
interface World { s: RunningServer; web: boolean; browser: Browser | null; origin: string; cookie: string; file: string; base: string }
let worldP: Promise<World> | null = null;
const world = () => (worldP ??= makeWorld());
async function makeWorld(): Promise<World> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-search-ui-'));
  // the file is called colours.mp4 (the proof's fixture name), 150 frames at 30 fps, every frame carries its own index as a barcode
  const file = (await generateBarcodeFixture({ out: path.join(base, 'fx', 'colours.mp4'), frames: 150, fps: R })).file;
  const webDist = path.join(ROOT, 'apps/web/dist');
  const web = fs.existsSync(path.join(webDist, 'index.html')) && fs.existsSync(path.join(webDist, 'selftest.html'));
  const s = await startServer({ port: 0, dataDir: path.join(base, 'data'), ...(web ? { webDist } : {}), speechPython: null, voicePython: null, backupDir: null });
  const origin = s.url;
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const browser = web ? await chromium.launch() : null;
  return { s, base, web, browser, origin, cookie, file };
}
async function api(method: string, p: string, body?: unknown): Promise<{ status: number; body: any; raw: Buffer }> {
  const w = await world();
  const r = await fetch(`${w.origin}/api/v1${p}`, { method, headers: { origin: w.origin, cookie: w.cookie, connection: 'close', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = Buffer.from(await r.arrayBuffer());
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, body: ct.includes('json') ? JSON.parse(raw.toString('utf8')) : raw, raw };
}
async function must(method: string, p: string, body?: unknown) {
  const r = await api(method, p, body);
  if (r.status < 200 || r.status > 299) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`);
  return r.body;
}
const tx = async (pid: string, ops: unknown[]) => (await must('POST', `/projects/${pid}/transactions`, { ops })) as { revision: number; results: { output?: Record<string, any> }[] };
const docOf = async (pid: string) => (await must('GET', `/projects/${pid}`)).project as ProjectDocument;
const revisionOf = async (pid: string) => (await must('GET', `/projects/${pid}`)).revision as number;
const newProject = async (name: string) => (await must('POST', '/projects', { name, width: 640, height: 360, frameRate: R })).project.id as string;
async function upload(pid: string, file: string): Promise<string> {
  const w = await world();
  const r = await fetch(`${w.origin}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { origin: w.origin, cookie: w.cookie, connection: 'close', 'x-filename': encodeURIComponent(path.basename(file)) }, body: new Uint8Array(fs.readFileSync(file)) });
  const b = (await r.json()) as any;
  if (!b.assetId) throw new Error(`upload of ${file} failed: ${JSON.stringify(b).slice(0, 300)}`);
  return b.assetId as string;
}
/** The barcode the still at `frame` shows (640×360, the fixture's strip at the top). */
async function barcodeAt(pid: string, frame: number): Promise<number> {
  const png = (await must('GET', `/projects/${pid}/frame?index=${frame}`)) as Buffer;
  const rgb = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
  return readBarcode(new Uint8Array(rgb), 640, 3, { x: 0, y: 0, w: 640, h: 360 });
}
/** 12 typed words, each 0.4 s long with a 0.05 s gap: word i starts at i × 0.45 s, so the times are not frame-aligned (exact, no rounding). */
const WORDS = ['אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה', 'עשרה', 'אחד־עשר', 'שנים־עשר'];
const transcriptOps = (assetId: string) => {
  const words = WORDS.map((text, i) => ({ start: T.rt(45 * i, 100), duration: T.rt(40, 100), text }));
  return [
    { op: 'set_transcript', args: { assetId, language: 'he', segments: [{ start: words[0]!.start, duration: T.rt(540, 100), text: WORDS.join(' '), words }] } },
  ];
};
/** A project with colours.mp4 and its transcript and an empty timeline (the rows place the file). */
async function transcriptProject(name: string): Promise<{ pid: string; assetId: string }> {
  const w = await world();
  const pid = await newProject(name);
  const assetId = await upload(pid, w.file);
  await tx(pid, transcriptOps(assetId));
  return { pid, assetId };
}

const errors: string[] = [];
async function open(pid: string, lang: 'he' | 'en' = 'he', viewport = { width: 1440, height: 900 }): Promise<Page> {
  const w = await world();
  const ctx = await w.browser!.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript((l) => { try { localStorage.setItem('pf.lang', l); } catch { /* storage unavailable */ } }, lang);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/404|501|403|409/.test(m.text()) && errors.push(m.text()));
  await page.goto(`${w.s.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  return page;
}
const close = (page: Page) => page.context().close();
const focusedTestId = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? null);
/** The media drawer open on its plain view with the search box focused. */
async function boxOf(page: Page) {
  if (!/\bis-on\b/.test((await page.getByTestId('rail-media').getAttribute('class')) ?? '')) await page.getByTestId('rail-media').click();
  const box = page.getByTestId('media-search');
  await box.waitFor({ timeout: 20000 });
  await box.focus();
  return box;
}
const settled = (page: Page) => page.waitForFunction((t) => { const e = document.querySelector(`[data-testid="${t}"]`); return !!e && ['exact', 'picture', 'empty', 'not-built'].includes(e.getAttribute('data-state') ?? ''); }, ID.results, { timeout: 15000 });
const rowsOf = (page: Page) => page.getByTestId(ID.row);

// ---------- the checks ----------
const checks: Record<string, () => Promise<true | string>> = {
  /** S1 (editor): the exact section by name, the honest picture state on Enter, no picture row, no upload or image control. */
  S1: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    const { pid, assetId } = await transcriptProject('S1');
    const out: Record<string, unknown> = {};
    // what the server says to the owner's own asking, for the record: 501 until B is merged, else the exact section and pictureState not_installed
    const direct = await api('POST', `/projects/${pid}/search`, { query: 'colours', picture: true });
    out.server = { status: direct.status, code: direct.body?.error?.code, pictureState: direct.body?.pictureState, setup: direct.body?.setup?.code, pictureRows: direct.body?.picture?.length };
    const built = direct.status === 200;
    const page = await open(pid, 'he');
    try {
      const box = await boxOf(page);
      await box.fill('colours');
      await settled(page);
      await rowsOf(page).first().waitFor({ timeout: 8000 });
      const found = await rowsOf(page).evaluateAll((els) => els.map((e) => ({ asset: e.getAttribute('data-asset-id'), start: e.getAttribute('data-start'), end: e.getAttribute('data-end'), sources: e.getAttribute('data-sources'), section: e.getAttribute('data-section') })));
      out.found = found;
      if (found.length !== 1 || found[0]!.asset !== assetId || found[0]!.start !== '' || found[0]!.sources !== 'name' || found[0]!.section !== 'exact') return `«colours» did not give exactly the file by its name (no model): ${JSON.stringify(found)}`;
      // no control that takes a picture, a frame or a moment as a query
      const controls = await page.getByTestId(ID.results).evaluate((el) => ({ files: el.querySelectorAll('input[type=file]').length, drop: el.querySelectorAll('[draggable=true], [ondrop]').length, text: (el.textContent ?? '') }));
      out.controls = { files: controls.files, drop: controls.drop };
      if (controls.files || controls.drop) return `the results hold an upload or drop control: ${JSON.stringify(controls)}`;
      if (/similar|more like this|same person|find this person|דומה|דומים|עוד כמו זה|אותו אדם|מי זה/i.test(controls.text)) return 'the results offer a query by example or claim to know a person';
      if (/\d\s?%|score|ציון|אחוז|★/i.test(controls.text)) return 'the results show a score, a percentage or a star';
      // Enter asks the pictures
      await box.press('Enter');
      await page.waitForFunction((t) => { const s = document.querySelector(`[data-testid="${t}"]`)?.getAttribute('data-state'); return !!s && s !== 'loading'; }, ID.status, { timeout: 15000 });
      await sleep(600);
      const state = await page.getByTestId(ID.status).getAttribute('data-state');
      const statusText = (await page.getByTestId(ID.status).textContent()) ?? '';
      const pictureRows = await page.locator(`[data-testid="${ID.row}"][data-section="picture"]`).count();
      const hasSetup = await page.getByTestId(ID.setup).count();
      const notBuiltNote = await page.getByTestId(ID.sectionPicture).textContent();
      out.picture = { state, statusText: statusText.slice(0, 200), pictureRows, hasSetup };
      evidence.S1 = out;
      if (pictureRows !== 0) return `a picture row exists with no picture runtime: ${pictureRows}`;
      if (!/[֐-׿]/.test(statusText)) return `the status line is not in Hebrew: ${statusText}`;
      if (!/[֐-׿]/.test(notBuiltNote ?? '')) return 'the picture part says nothing in Hebrew';
      if (built) {
        if (state !== 'not_installed') return `with no picture runtime the status line is "${state}", expected not_installed`;
        if (!statusText.includes('החיפוש בתמונה לא מותקן')) return `the status line does not say «החיפוש בתמונה לא מותקן»: ${statusText}`;
        if (!hasSetup) return 'the setup steps are not shown beside the not-installed line';
        if (direct.body.pictureState !== 'not_installed' || !direct.body.setup?.code || direct.body.picture?.length !== 0) return `the server's answer is not not_installed with its setup code: ${JSON.stringify(out.server)}`;
        return true;
      }
      if (state !== 'not_built') return `the route answers 501 but the status line is "${state}", expected not_built`;
      return `${WAIT_B}; ran: «colours» finds the file by name without a model, Enter shows «החיפוש בתמונה עוד לא נבנה» in Hebrew with no picture row, and the results hold no upload, drop or image control and no score`;
    } finally { await close(page); }
  },

  /** S3 (browser): the same function in Chromium gives the Node answer, byte for byte, for the 40 baseline queries. */
  S3: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    const node = footageBaselineJson();
    const digest = footageBaselineDigest(node);
    const page = await w.browser!.newPage();
    try {
      await page.goto(`${w.origin}/selftest.html`);
      await page.waitForFunction(() => typeof (window as unknown as { __pfFootageSearch?: unknown }).__pfFootageSearch === 'function', undefined, { timeout: 30000 });
      // the document is built in Node (footageProofDoc) and handed over as JSON, so both sides search the same bytes
      const doc = footageProofDoc();
      const browser = await page.evaluate(({ d, qs }) => {
        const run = (window as unknown as { __pfFootageSearch: (doc: unknown, q: string) => string }).__pfFootageSearch;
        return qs.map((q) => run(d, q));
      }, { d: doc, qs: [...FOOTAGE_BASELINE_QUERIES] });
      const different = browser.map((j, i) => (j === node[i] ? -1 : i)).filter((i) => i >= 0);
      evidence.S3 = { queries: node.length, nodeDigest: digest, browserDigest: footageBaselineDigest(browser), different: different.map((i) => FOOTAGE_BASELINE_QUERIES[i]) };
      if (browser.length !== node.length) return `the browser answered ${browser.length} queries, Node ${node.length}`;
      if (different.length) return `${different.length} of ${node.length} queries differ between Node and Chromium; first: «${FOOTAGE_BASELINE_QUERIES[different[0]!]}»\nNode:     ${node[different[0]!]!.slice(0, 300)}\nChromium: ${browser[different[0]!]!.slice(0, 300)}`;
      return true;
    } finally { await page.close(); }
  },

  /** S10: «הכנס במקום הסמן» from a transcript row is one commit placing exactly that word span (snapped outward); one undo restores the document. */
  S10: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    const { pid, assetId } = await transcriptProject('S10');
    const page = await open(pid, 'he');
    const out: Record<string, unknown> = {};
    try {
      const box = await boxOf(page);
      await box.fill('שלושה');
      await settled(page);
      const row = rowsOf(page).first();
      await row.waitFor({ timeout: 8000 });
      // word 3 (index 2): [0.90 s, 1.30 s) = 9/10 … 13/10 exactly; the file's own time, not frame aligned
      const attrs = { start: await row.getAttribute('data-start'), end: await row.getAttribute('data-end'), sources: await row.getAttribute('data-sources'), asset: await row.getAttribute('data-asset-id') };
      out.row = attrs;
      if (attrs.asset !== assetId || attrs.start !== '9/10' || attrs.end !== '13/10' || attrs.sources !== 'transcript') return `the row of «שלושה» is ${JSON.stringify(attrs)}, expected ${assetId} 9/10 … 13/10 by transcript`;
      const docBefore = canon(await docOf(pid));
      const revBefore = await revisionOf(pid);
      await row.getByTestId(ID.rowInsert).click();
      await sleep(1300);
      const commits = (await revisionOf(pid)) - revBefore;
      const after = await docOf(pid);
      const clips = after.sequences[after.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'media' && c.assetId === assetId);
      const video = clips.find((c) => c.type === 'media' && after.assets[c.assetId]?.video);
      // snapped outward to frames at 30 fps: floor(0.9·30) = 27, ceil(1.3·30) = 39 → [27/30, 39/30), 12 frames
      out.placed = { commits, clips: clips.length, sourceIn: video?.type === 'media' ? video.sourceIn : null, duration: video?.duration ?? null };
      evidence.S10 = out;
      if (commits !== 1) return `the insert made ${commits} commits, expected 1`;
      if (clips.length > 2 || clips.some((c) => c.type !== 'media' || !T.eq(c.sourceIn, T.rt(27, 30)) || !T.eq(c.duration, T.rt(12, 30))) || !video || video.type !== 'media' || !T.eq(video.sourceIn, T.rt(27, 30)) || !T.eq(video.duration, T.rt(12, 30))) return `the placed clip is ${JSON.stringify(out.placed)}, expected source [27/30, 39/30) s (12 frames) on the picture and its linked sound`;
      const bars = [await barcodeAt(pid, 0), await barcodeAt(pid, 11)];
      out.bars = bars;
      if (bars[0] !== 27 || bars[1] !== 38) return `the placed clip's first and last frames read ${bars.join(', ')}, expected 27 and 38`;
      await page.keyboard.press('Control+z');
      await sleep(1100);
      if (canon(await docOf(pid)) !== docBefore) return 'one undo did not restore the document';
      return true;
    } finally { await close(page); }
  },

  /** U1: the whole flow by keyboard only, in Hebrew and in English, RTL without overlap or sideways scrolling at 1280 and 1440 px. */
  U1: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    const { pid, assetId } = await transcriptProject('U1');
    const out: Record<string, unknown> = {};
    for (const [lang, width] of [['he', 1280], ['he', 1440], ['en', 1280], ['en', 1440]] as const) {
      const page = await open(pid, lang, { width, height: 900 });
      const tag = `${lang}${width}`;
      try {
        const dir = await page.evaluate(() => document.documentElement.dir);
        if (dir !== (lang === 'he' ? 'rtl' : 'ltr')) return `${tag}: the page direction is ${dir}`;
        const box = await boxOf(page);
        await page.keyboard.type(lang === 'he' ? 'שלושה' : 'colours');
        await settled(page);
        await page.waitForFunction((want) => { const r = document.querySelectorAll('[data-testid="footage-row"]'); return r.length === 1 && (want === '' || r[0]!.getAttribute('data-start') === want); }, lang === 'he' ? '9/10' : '', { timeout: 8000 });
        // layout: no sideways scroll in the results, the three action buttons of a row do not overlap, nothing leaves the drawer
        const layout = await page.getByTestId(ID.results).evaluate((el) => {
          const rows = Array.from(el.querySelectorAll('[data-testid="footage-row"]'));
          const boxes = rows.flatMap((r) => Array.from(r.querySelectorAll('button')).map((x) => x.getBoundingClientRect()));
          let overlap = false;
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i]!, b = boxes[j]!; if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlap = true; }
          const r = el.getBoundingClientRect();
          const outside = Array.from(el.querySelectorAll('*')).some((e) => { const x = e.getBoundingClientRect(); return x.width > 0 && (x.left < r.left - 1 || x.right > r.right + 1); });
          return { scrollW: (el as HTMLElement).scrollWidth, clientW: (el as HTMLElement).clientWidth, overlap, outside, buttons: boxes.length };
        });
        out[`${tag}.layout`] = layout;
        if (layout.scrollW > layout.clientW + 1 || layout.overlap || layout.outside) return `${tag}: the results overflow or overlap: ${JSON.stringify(layout)}`;
        // ArrowDown from the box → the first row
        await box.focus();
        await page.keyboard.press('ArrowDown');
        if ((await focusedTestId(page)) !== ID.row) return `${tag}: ArrowDown from the box did not reach a row (focus ${await focusedTestId(page)})`;
        if (lang === 'he') {
          // Enter → the source viewer on exactly the span: in point 27, out point 39 (9/10 … 13/10 s snapped outward to frames)
          await page.keyboard.press('Enter');
          await page.getByTestId('source-viewer').waitFor({ timeout: 10000 });
          await page.waitForFunction(() => Number(document.querySelector('[data-testid=source-range]')?.getAttribute('data-out')) > 0, undefined, { timeout: 20000 });
          const marks = { in: await page.getByTestId('source-range').getAttribute('data-in'), out: await page.getByTestId('source-range').getAttribute('data-out') };
          out[`${tag}.viewer`] = marks;
          if (marks.in !== '27' || marks.out !== '39') return `${tag}: «הצג» opened the viewer on ${marks.in}–${marks.out}, expected 27–39`;
          await page.keyboard.press('Escape');
          await page.getByTestId('source-viewer').waitFor({ state: 'detached', timeout: 5000 });
          await sleep(200);
          if ((await focusedTestId(page)) !== ID.rowView) return `${tag}: closing the viewer left the focus on ${await focusedTestId(page)}, expected the row's «הצג»`;
          // Escape on a button of the row → back to the box
          await page.keyboard.press('Escape');
          if ((await focusedTestId(page)) !== 'media-search') return `${tag}: Escape in the list did not return to the box (focus ${await focusedTestId(page)})`;
          await page.keyboard.press('ArrowDown');
        }
        // Shift+Enter → one commit, the clip placed at the playhead
        const before = await revisionOf(pid);
        await page.keyboard.press('Shift+Enter');
        await sleep(1300);
        const commits = (await revisionOf(pid)) - before;
        out[`${tag}.insert`] = commits;
        if (lang === 'he' && commits !== 1) return `${tag}: Shift+Enter made ${commits} commits, expected 1`;
        if (lang === 'en') {
          // the English query is a file name: the row is a whole file; Shift+Enter places the whole file once
          if (commits !== 1) return `${tag}: Shift+Enter made ${commits} commits, expected 1`;
        }
        await page.keyboard.press('Control+z');
        await sleep(900);
        const live = (await page.getByTestId(ID.live).textContent()) ?? '';
        out[`${tag}.live`] = live;
        if (!live.trim()) return `${tag}: the live region is empty`;
        if (lang === 'he' && !/[֐-׿]/.test(live)) return `${tag}: the live region is not in Hebrew: ${live}`;
        if (lang === 'en' && /[֐-׿]/.test(live)) return `${tag}: the live region is not in English: ${live}`;
        // no row shows a pearl's name or a tag unless the moment itself carries it: none exists in this project
        const sources = await rowsOf(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-sources')));
        if (sources.some((s) => /pearl|person/.test(s ?? ''))) return `${tag}: a row names a pearl or a tag in a project that has none: ${sources.join(' | ')}`;
        void assetId;
      } finally { await close(page); }
    }
    evidence.U1 = out;
    return true;
  },
};

export const FOOTAGE_PROOF_UI: FootageProofPart = { built: true, checks, evidence };

/** Stops the server and the browser and removes the temp folders (the runner calls it; the stand-alone run does). */
export async function closeFootageProofUi(): Promise<void> {
  if (!worldP) return;
  const w = await worldP;
  await w.browser?.close();
  await w.s.close();
  fs.rmSync(w.base, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(ROOT, 'docs', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'footage-search-proof.ui.json'), JSON.stringify({ when: new Date().toISOString(), web: w.web, pageErrors: errors.slice(0, 20), evidence }, null, 1) + '\n');
  } catch { /* evidence is best effort */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let failed = 0, blocked = 0;
  try {
    for (const [n, check] of Object.entries(checks)) {
      let r: true | string;
      try { r = await check(); } catch (e) { r = `threw: ${(e as Error).stack?.slice(0, 600) ?? e}`; }
      const b = r !== true && r.startsWith('BLOCKED');
      console.log(`${r === true ? 'PASS' : b ? 'BLOCKED' : 'FAIL'} ${n} (ui)${r === true ? '' : `: ${r}`}`);
      if (r !== true) { if (b) blocked++; else failed++; }
    }
    if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(' | ')}`);
  } finally {
    await closeFootageProofUi();
  }
  process.exit(failed ? 1 : blocked ? 2 : 0);
}
