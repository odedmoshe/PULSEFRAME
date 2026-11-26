/**
 * pnpm proof:pearls, part ui (builder C): checks P3, P4, P5, P7 and P9 in the editor, P13 and the browser side of P15 of
 * pearls-proof.ts, over the real server (startServer on 127.0.0.1) and headless Chromium, with SYNTHETIC fixtures made here:
 * barcode videos at 30 and 30000/1001 fps (packages/fixtures generateBarcodeFixture), a typed 12-word transcript, invented people
 * «אלף», «בית». No owner clip is used. Expected numbers are typed here by hand from the fixture, never read from the code under
 * test: the barcode of a rendered still names the source frame it shows; the screen-time frames are counted from the timeline.
 *
 * Each check returns true or a sentence. A sentence beginning "BLOCKED" means the check could not run to its end here: builder A's
 * bodies (the three operations, rangeUsage, screenTime, placeRangeArgs) are not merged yet, or the web bundle is missing
 * (`pnpm build`). The part of the check that does not need A has run and is in the evidence (docs/evidence/pearls-proof.ui.json).
 * Anything else is a failure. Run alone: `tsx packages/evals/src/pearls-proof.ui.ts` (exit 0 all pass, 1 a failure, 2 only blocked
 * ones besides passes). Port 18900+ (random); a folder in the temp directory, removed at the end.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, filmWindowOfRange, rangeUsage, SourceRangesNotBuilt, type ProjectDocument, type SourceRange } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { createFuzz } from './ops-fuzz.gen.ts';
import { pearlsDigest } from '../../../apps/web/src/editor/pearls/pearls.selftest.ts';
import { PEARLS_TESTIDS as ID } from '../../../apps/web/src/editor/pearls/pearls.testids.ts';
import { shortBody } from '../../../apps/web/src/editor/pearls/pearls.logic.ts';
import { openInspectorPage } from './editor-ui.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const evidence: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { input, maxBuffer: 1 << 28 });
const canon = (v: unknown) => JSON.stringify(v);

/** True once builder A's bodies are merged: core's functions answer instead of throwing SourceRangesNotBuilt. */
function aBuilt(): boolean {
  try { filmWindowOfRange({ kind: 'image', duration: T.ZERO }, { id: 'r', assetId: 'a', kind: 'pearl', span: null, label: '', createdBy: 'x' }); rangeUsage({ sequences: {}, assets: {}, sourceRanges: {} } as unknown as ProjectDocument); return true; } catch (e) { if (e instanceof SourceRangesNotBuilt) return false; return true; }
}
const WAIT_A = 'BLOCKED: builder A\'s core bodies (the three operations, rangeUsage, screenTime, placeRangeArgs) are not merged in this build';
const NO_WEB = 'BLOCKED: the web bundle is missing (`pnpm build`)';

// ---------- the world ----------
interface World { s: RunningServer; base: string; web: boolean; browser: Browser | null; origin: string; cookie: string; files: { a: string; b: string; c: string } }
let worldP: Promise<World> | null = null;
const world = () => (worldP ??= makeWorld());
async function makeWorld(): Promise<World> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pearls-ui-'));
  const fx = path.join(base, 'fx');
  const a = (await generateBarcodeFixture({ out: path.join(fx, 'a30.mp4'), frames: 300, fps: { num: 30, den: 1 } })).file;
  const b = (await generateBarcodeFixture({ out: path.join(fx, 'b2997.mp4'), frames: 300, fps: { num: 30000, den: 1001 } })).file;
  const c = (await generateBarcodeFixture({ out: path.join(fx, 'c30.mp4'), frames: 290, fps: { num: 30, den: 1 } })).file;
  const webDist = path.join(ROOT, 'apps/web/dist');
  const web = fs.existsSync(path.join(webDist, 'index.html')) && fs.existsSync(path.join(webDist, 'selftest.html'));
  const s = await startServer({ port: 0, dataDir: path.join(base, 'data'), ...(web ? { webDist } : {}), speechPython: null, voicePython: null, backupDir: null });
  const origin = s.url;
  const cookie = (await fetch(`${origin}/api/v1/session`, { headers: { origin, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const browser = web ? await chromium.launch() : null;
  return { s, base, web, browser, origin, cookie, files: { a, b, c } };
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
/** A document planted straight into the store (ranges and people put in as an archive would hold them), so a check does not depend on A's operations. */
async function plant(from: ProjectDocument, id: string, over: Partial<ProjectDocument>): Promise<string> {
  return (await world()).s.store.importProject({ ...structuredClone(from), id, ...over }).doc.id;
}
/** n/5 of a duration, exact. */
const fifths = (d: T.RationalTime, n: number) => T.rt(BigInt(d.value) * BigInt(n), d.timescale * 5);
const pearl = (id: string, assetId: string, start: T.RationalTime, end: T.RationalTime, over: Partial<SourceRange> = {}): SourceRange => ({ id, assetId, kind: 'pearl', span: { start, end }, label: '', createdBy: 'user:local', ...over });
/** The barcode the still at `frame` shows (640×360, the fixture's strip at the top). */
async function barcodeAt(pid: string, frame: number): Promise<number> {
  const png = (await must('GET', `/projects/${pid}/frame?index=${frame}`)) as Buffer;
  const rgb = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
  return readBarcode(new Uint8Array(rgb), 640, 3, { x: 0, y: 0, w: 640, h: 360 });
}
let baseP: Promise<{ pid: string; a: string; b: string; c: string }> | null = null;
/** The base project: files a (30 fps), b (29.97 fps), c (30 fps), uploaded by the owner; no clips. */
const baseProject = () => (baseP ??= (async () => {
  const w = await world();
  const pid = await newProject('pearls ui base');
  return { pid, a: await upload(pid, w.files.a), b: await upload(pid, w.files.b), c: await upload(pid, w.files.c) };
})());

const errors: string[] = [];
async function open(pid: string, lang: 'he' | 'en' = 'he'): Promise<Page> {
  const w = await world();
  const ctx = await w.browser!.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
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
/** Opens a library file in the source viewer (the card's ⋯ menu, «צפייה»). */
async function openViewer(page: Page, assetId: string) {
  await page.getByTestId('rail-media').click();
  await page.getByTestId(`more-${assetId}`).waitFor({ timeout: 20000 });
  await page.getByTestId(`more-${assetId}`).click();
  await page.getByTestId(`view-${assetId}`).click();
  await page.getByTestId('source-viewer').waitFor();
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=source-range]')?.getAttribute('data-out')) > 0, undefined, { timeout: 20000 });
}
const RNG = { rng_a: 'rng_a', rng_c: 'rng_c', rng_long: 'rng_long', rng_short: 'rng_short', rng_whole30: 'rng_whole30', rng_word: 'rng_word' } as const;
/** The list row of a range (the id is data, never a literal selector). */
const rowOf = (page: Page, id: string) => page.getByTestId(ID.row).and(page.locator(`[data-range-id=${JSON.stringify(id)}]`));
const key = async (page: Page, k: string, times = 1) => { for (let i = 0; i < times; i++) { await page.keyboard.press(k); await sleep(40); } };
/** Seeks the viewer to a frame with the keyboard (Shift+arrows by ten, arrows by one) and waits for it. */
async function viewerTo(page: Page, target: number) {
  const now = async () => Number((await page.getByTestId('source-range').getAttribute('data-in')) ?? 0);
  void now;
  const tc = async () => (await page.getByTestId('source-timecode').textContent()) ?? '';
  const frameOf = async () => { const m = /(\d+):(\d+):(\d+)[:;.](\d+)/.exec(await tc()); return m ? (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 30 + Number(m[4]) : -1; };
  let cur = await frameOf();
  while (cur !== target) {
    const d = target - cur;
    if (Math.abs(d) >= 10) await key(page, d > 0 ? 'Shift+ArrowRight' : 'Shift+ArrowLeft'); else await key(page, d > 0 ? 'ArrowRight' : 'ArrowLeft');
    const before = cur;
    for (let i = 0; i < 100 && (cur = await frameOf()) === before; i++) await sleep(30);
    if (cur === before) throw new Error(`the viewer did not move from frame ${before}`);
  }
}

// ---------- the checks ----------
const checks: Record<string, () => Promise<true | string>> = {
  /** P3: marking by keyboard in the viewer; Escape in the form closes the form only. */
  P3: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    const b = await baseProject();
    const pid = await newProject('P3');
    const a = await upload(pid, w.files.a);
    const page = await open(pid);
    const out: Record<string, unknown> = { baseUnused: b.pid.length > 0 };
    try {
      await openViewer(page, a);
      await viewerTo(page, 30); await key(page, 'i');
      await viewerTo(page, 74); await key(page, 'o');
      const marks = { in: await page.getByTestId('source-range').getAttribute('data-in'), out: await page.getByTestId('source-range').getAttribute('data-out') };
      out.marks = marks;
      if (marks.in !== '30' || marks.out !== '75') return `the marks are ${marks.in}–${marks.out}, expected 30–75`;
      const before = await revisionOf(pid);
      // Escape in the form: the form closes, the viewer stays, the focus is on «שמור כפנינה», nothing is committed
      await key(page, 'p');
      await page.getByTestId(ID.form).waitFor();
      await page.getByTestId(ID.formName).type('בדיקה');
      await page.keyboard.press('Escape');
      await sleep(250);
      const esc = { form: await page.getByTestId(ID.form).count(), viewer: await page.getByTestId('source-viewer').count(), focus: await focusedTestId(page), revision: (await revisionOf(pid)) - before };
      out.escape = esc;
      if (esc.form !== 0 || esc.viewer !== 1 || esc.focus !== ID.save || esc.revision !== 0) return `Escape in the form: ${JSON.stringify(esc)}; expected the form closed, the viewer open, the focus on ${ID.save}, no commit`;
      // I, O, P, a name, Enter: one commit
      await key(page, 'p');
      await page.getByTestId(ID.form).waitFor();
      await page.getByTestId(ID.formName).fill('הצעד הראשון');
      await page.keyboard.press('Enter');
      await sleep(1200);
      const doc = await docOf(pid);
      const ranges = Object.values(doc.sourceRanges ?? {});
      const commits = (await revisionOf(pid)) - before;
      out.after = { ranges: ranges.length, commits, formError: (await page.getByTestId('pearl-form-error').count()) ? await page.getByTestId('pearl-form-error').textContent() : null };
      evidence.P3 = out;
      if (!aBuilt()) {
        const said = out.after as { formError: string | null };
        if (ranges.length !== 0 || commits !== 0 || !said.formError || !/[֐-׿]/.test(said.formError)) return `before A the refusal must be said in Hebrew in the form and nothing committed: ${JSON.stringify(out.after)}`;
        return `${WAIT_A}; ran: the marks (30, 75), Escape closes the form only (focus on the save button, no commit), and the refusal shown in Hebrew in the form`;
      }
      const r = ranges[0];
      if (ranges.length !== 1 || commits !== 1 || !r || r.kind !== 'pearl' || !r.span || !T.eq(r.span.start, T.rt(30, 30)) || !T.eq(r.span.end, T.rt(75, 30)) || r.label !== 'הצעד הראשון') return `after Enter: ${JSON.stringify({ ranges: ranges.length, commits, span: r?.span })}, expected one commit and span [30/30, 75/30) s`;
      return true;
    } finally { await close(page); }
  },

  /** P4: transcript words 3–6 → the span is exactly the first word's start to the last word's end. */
  P4: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    const pid = await newProject('P4');
    const a = await upload(pid, w.files.a);
    // 12 typed words, each 0.4 s long with a 0.05 s gap: word i starts at i × 0.45 s (so the times are not frame-aligned: exact, no rounding)
    const words = Array.from({ length: 12 }, (_, i) => ({ start: T.rt(45 * i, 100), duration: T.rt(40, 100), text: ['אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה', 'עשרה', 'אחד־עשר', 'שנים־עשר'][i]! }));
    await tx(pid, [
      { op: 'add_clip', args: { assetId: a, start: f(0), duration: f(150), withLinkedAudio: false } },
      { op: 'set_transcript', args: { assetId: a, language: 'he', segments: [{ start: words[0]!.start, duration: T.rt(540, 100), text: words.map((x) => x.text).join(' '), words }] } },
    ]);
    const page = await open(pid);
    const out: Record<string, unknown> = {};
    try {
      await page.locator('.clip').first().click();
      await openInspectorPage(page, 'speech');
      const els = page.getByTestId('transcript-word');
      await els.nth(2).waitFor({ timeout: 20000 });
      await els.nth(2).click();
      await els.nth(5).click({ modifiers: ['Shift'] });
      const btn = page.getByTestId(ID.fromWords);
      if (!(await btn.isEnabled())) return 'the transcript panel has no enabled «שמור כפנינה» with words 3–6 selected';
      const before = await revisionOf(pid);
      await btn.click();
      await sleep(1200);
      const doc = await docOf(pid);
      const ranges = Object.values(doc.sourceRanges ?? {});
      out.after = { ranges: ranges.length, note: (await page.getByTestId('pearl-from-words-note').count()) ? await page.getByTestId('pearl-from-words-note').textContent() : null, commits: (await revisionOf(pid)) - before };
      evidence.P4 = out;
      if (!aBuilt()) {
        const n = (out.after as { note: string | null }).note;
        if (ranges.length !== 0 || !n || !/[֐-׿]/.test(n)) return `before A the refusal must be said in Hebrew next to the button and nothing committed: ${JSON.stringify(out.after)}`;
        return `${WAIT_A}; ran: words 3–6 selected, the button enabled, the refusal shown in Hebrew next to it, nothing committed`;
      }
      const r = ranges[0];
      // words 3–6 are indexes 2..5: start 0.90 s, last start 2.25 s + 0.40 s = 2.65 s
      if (ranges.length !== 1 || !r?.span || !T.eq(r.span.start, T.rt(90, 100)) || !T.eq(r.span.end, T.rt(265, 100)) || r.label !== 'שלושה ארבעה חמישה שישה') return `words 3–6 gave ${JSON.stringify(r)}, expected [0.90, 2.65) s and the four words`;
      const route = await must('GET', `/projects/${pid}/pearls`);
      const row = route.ranges.find((x: any) => x.id === r.id);
      if (row?.verbatim !== true) return `verbatim is ${row?.verbatim}, expected true`;
      await tx(pid, [{ op: 'update_source_range', args: { rangeId: r.id, label: 'שלושה ארבעה חמישה שישא' } }]);
      const again = (await must('GET', `/projects/${pid}/pearls`)).ranges.find((x: any) => x.id === r.id);
      if (again?.verbatim !== false) return `with one letter changed verbatim is ${again?.verbatim}, expected false`;
      return true;
    } finally { await close(page); }
  },

  /** P5: «הכנס במקום הסמן» is one transaction; the clip's first and last frames show barcodes 30 and 74; one undo restores the document; a word-aligned pearl is placed snapped outward. */
  P5: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    const b = await baseProject();
    const pid = await plant(await docOf(b.pid), 'prj_p5', { sourceRanges: { rng_whole30: pearl('rng_whole30', b.a, f(30), f(75), { label: 'חמישים' }), rng_word: pearl('rng_word', b.a, T.rt(102, 100), T.rt(251, 100), { label: 'מילים' }) } });
    const page = await open(pid);
    const out: Record<string, unknown> = {};
    try {
      await page.getByTestId('rail-media').click();
      await page.getByTestId(ID.view).click();
      const list = page.getByTestId(ID.list);
      await page.waitForFunction((id) => ['list', 'not-built', 'refused', 'empty'].includes(document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-state') ?? ''), ID.list, { timeout: 20000 });
      const state = await list.getAttribute('data-state');
      out.listState = state;
      if (state === 'not-built') {
        evidence.P5 = out;
        const said = await page.getByTestId('pearls-not-built').textContent();
        if (!said || !/[֐-׿]/.test(said)) return 'the route answers 501 and the list does not say so in Hebrew';
        return `${WAIT_A}; ran: the list shows the honest not-built state in Hebrew (the route answers 501 pearls_not_built)`;
      }
      if (state !== 'list') return `the list is in state ${state}`;
      const docBefore = canon(await docOf(pid));
      const revBefore = await revisionOf(pid);
      const row = rowOf(page, RNG.rng_whole30);
      await row.getByTestId(ID.rowInsert).click();
      await sleep(1200);
      const commits = (await revisionOf(pid)) - revBefore;
      const after = await docOf(pid);
      const clips = after.sequences[after.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'media');
      const video = clips.find((c) => c.type === 'media' && after.assets[c.assetId]?.video);
      const total = video ? T.frameIndexAt(video.duration, R) : 0;
      const bars = [await barcodeAt(pid, 0), await barcodeAt(pid, Math.max(0, total - 1))];
      out.insert = { commits, clipFrames: total, bars };
      if (commits !== 1) return `the insert made ${commits} commits, expected 1`;
      if (total !== 45 || bars[0] !== 30 || bars[1] !== 74) return `the placed clip has ${total} frames and its first and last frames read ${bars.join(', ')}; expected 45 and 30, 74`;
      await page.keyboard.press('Control+z');
      await sleep(1000);
      if (canon(await docOf(pid)) !== docBefore) return 'one undo did not restore the document';
      // a word-aligned pearl [1.02, 2.51) s: 30.6–75.3 frames, snapped outward to frames 30–76 (first and last shown frames 30 and 75)
      await row.waitFor();
      await rowOf(page, RNG.rng_word).getByTestId(ID.rowInsert).click();
      await sleep(1200);
      const w2 = await docOf(pid);
      const v2 = w2.sequences[w2.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'media' && w2.assets[c.assetId]?.video);
      const n2 = v2 ? T.frameIndexAt(v2.duration, R) : 0;
      const bars2 = [await barcodeAt(pid, 0), await barcodeAt(pid, Math.max(0, n2 - 1))];
      out.word = { clipFrames: n2, bars: bars2 };
      evidence.P5 = out;
      if (n2 !== 46 || bars2[0] !== 30 || bars2[1] !== 75) return `the word-aligned pearl was placed as ${n2} frames reading ${bars2.join(', ')}; expected 46 frames, 30 … 75 (snapped outward)`;
      return true;
    } finally { await close(page); }
  },

  /** P7 (editor): a trim changes the usage line to the exact new numbers; the other file's pearl reads «לא בשימוש». */
  P7: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    const b = await baseProject();
    const pid = await plant(await docOf(b.pid), 'prj_p7ui', { sourceRanges: { rng_a: pearl('rng_a', b.a, f(30), f(75)), rng_c: pearl('rng_c', b.c, f(30), f(60)) } });
    const clipId = (await tx(pid, [{ op: 'add_clip', args: { assetId: b.a, start: f(0), duration: f(90), withLinkedAudio: false } }])).results[0]!.output!.clipId as string;
    const page = await open(pid);
    const out: Record<string, unknown> = {};
    try {
      await page.getByTestId('rail-media').click();
      await page.getByTestId(ID.view).click();
      await page.waitForFunction((id) => ['list', 'not-built', 'refused', 'empty'].includes(document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-state') ?? ''), ID.list, { timeout: 20000 });
      if ((await page.getByTestId(ID.list).getAttribute('data-state')) === 'not-built') { evidence.P7 = out; return `${WAIT_A}; ran: the list shows the honest not-built state (501)`; }
      const line = (id: string) => rowOf(page, id).getByTestId(ID.rowUsage).textContent();
      const read = async () => ({ a: await line(RNG.rng_a), c: await line(RNG.rng_c), cUsed: await rowOf(page, RNG.rng_c).getAttribute('data-used') });
      const before = await read();
      await tx(pid, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(50) } }]);
      await sleep(1500);
      const after = await read();
      out.before = before; out.after = after;
      evidence.P7 = out;
      // [30, 75) = 1.5 s of source, all used at first; the trim to 50 frames leaves frames 30–50 = 0.7 s of it (project frames 30–50 show source frames 30–50)
      if (!/1\.5/.test(before.a ?? '') || !/0\.7/.test(after.a ?? '') || !/1\.5/.test(after.a ?? '')) return `usage line of the used pearl: «${before.a}» then «${after.a}», expected 1.5 of 1.5 then 0.7 of 1.5 seconds`;
      if (before.cUsed !== 'no' || after.cUsed !== 'no') return `the other file's pearl is data-used=${before.cUsed}/${after.cUsed}, expected no`;
      return true;
    } finally { await close(page); }
  },

  /** P9 (editor): the screen-time table equals the hand-computed frames; the label is present in Hebrew and English. */
  P9: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    if (!aBuilt()) {
      // what runs before A: the table says «not available yet» instead of a number
    }
    const b = await baseProject();
    // as the server part of P9: V1: a 0–90, c 90–150; V2 (a layer over V1): b 60–120; V3 hidden: a 200–260. נועה on a (the whole file), איתי on b's pearl [0, 2) s.
    // Picture 150, נועה 90 (the hidden track is not counted), איתי 60, tagged 0–120, untagged 30.
    const doc0 = await docOf(b.pid);
    const pid = await plant(doc0, 'prj_p9ui', { people: { per_noa: { id: 'per_noa', name: 'נועה', birthDate: '2020-02-29' }, per_itai: { id: 'per_itai', name: 'איתי', birthDate: null } }, sourceRanges: {
      rng_who: { id: 'rng_who', assetId: b.a, kind: 'presence', span: null, label: '', people: ['per_noa'], createdBy: 'user:local' },
      rng_b: pearl('rng_b', b.b, T.ZERO, T.rt(2, 1), { people: ['per_itai'] }),
    } });
    const v1 = (await docOf(pid)).sequences.seq_main!.tracks.find((t) => t.kind === 'video')!.id;
    const t = await tx(pid, [{ op: 'add_track', args: { kind: 'video' } }, { op: 'add_track', args: { kind: 'video' } }]);
    const [v2, v3] = t.results.map((x) => x.output!.trackId as string);
    await tx(pid, [
      { op: 'add_clip', args: { assetId: b.a, trackId: v1, start: f(0), duration: f(90), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: b.c, trackId: v1, start: f(90), duration: f(60), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: b.b, trackId: v2, start: f(60), duration: f(60), withLinkedAudio: false } },
      { op: 'add_clip', args: { assetId: b.a, trackId: v3, start: f(200), duration: f(60), withLinkedAudio: false } },
      { op: 'update_track', args: { trackId: v3, hidden: true } },
    ]);
    const want = { picture: 150, untagged: 30, noa: 90, itai: 60 };
    const seen: Record<string, unknown> = {};
    for (const lang of ['he', 'en'] as const) {
      const page = await open(pid, lang);
      try {
        await openInspectorPage(page, 'deliver');
        const panel = page.getByTestId(ID.screenTime);
        await panel.waitFor({ timeout: 20000 });
        const state = await panel.getAttribute('data-state');
        const label = (await page.getByTestId(ID.screenLabel).textContent()) ?? '';
        seen[lang] = { state, label: label.slice(0, 60) };
        if (!label) return `no label under the screen-time table in ${lang}`;
        if (lang === 'he' && !/[֐-׿]/.test(label)) return 'the label of the table is not Hebrew in Hebrew';
        if (lang === 'en' && /[֐-׿]/.test(label)) return 'the label of the table is Hebrew in English';
        if (state === 'not-built') { evidence.P9 = seen; return `${WAIT_A}; ran: the panel says in words that the measurement is not available yet and shows its label (${lang})`; }
        const frames = {
          noa: Number(await page.locator(`[data-testid="${ID.screenRow}"][data-person-id="per_noa"]`).getAttribute('data-frames')),
          itai: Number(await page.locator(`[data-testid="${ID.screenRow}"][data-person-id="per_itai"]`).getAttribute('data-frames')),
          untagged: Number(await page.getByTestId(ID.screenUntagged).getAttribute('data-frames')),
        };
        (seen[lang] as Record<string, unknown>).frames = frames;
        if (frames.noa !== want.noa || frames.itai !== want.itai || frames.untagged !== want.untagged) return `${lang}: table frames ${JSON.stringify(frames)}, expected ${JSON.stringify({ noa: want.noa, itai: want.itai, untagged: want.untagged })}`;
      } finally { await close(page); }
    }
    evidence.P9 = seen;
    return true;
  },

  /** P13 (editor): «שורט מהפנינה» is disabled for a 2-second pearl with its reason; for a 3-second or longer pearl it makes the short at the pearl's first source frame. */
  P13: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    const b = await baseProject();
    const pid = await plant(await docOf(b.pid), 'prj_p13', { sourceRanges: { rng_short: pearl('rng_short', b.a, f(30), f(60), { label: 'שתי שניות' }), rng_long: pearl('rng_long', b.a, f(60), f(180), { label: 'ארבע שניות' }) } });
    const page = await open(pid);
    const out: Record<string, unknown> = {};
    try {
      await page.getByTestId('rail-media').click();
      await page.getByTestId(ID.view).click();
      await page.waitForFunction((id) => ['list', 'not-built', 'refused', 'empty'].includes(document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-state') ?? ''), ID.list, { timeout: 20000 });
      if ((await page.getByTestId(ID.list).getAttribute('data-state')) === 'not-built') { evidence.P13 = out; return `${WAIT_A}; ran: the list shows the honest not-built state (501)`; }
      const short = rowOf(page, RNG.rng_short).getByTestId(ID.rowShort);
      const disabled = (await short.getAttribute('aria-disabled')) === 'true';
      // the reason is the button's accessible description (ds Tooltip: aria-describedby names the tooltip, or its screen-reader twin
      // while the tooltip is closed); a programmatic focus is not :focus-visible, so the visible tooltip is not what is read here
      const described = await short.getAttribute('aria-describedby');
      const reason = described ? ((await page.locator(`[id=${JSON.stringify(described)}]`).first().textContent()) ?? '').trim() : '';
      out.twoSecond = { disabled, reason };
      if (!disabled || !/3/.test(reason)) return `the 2-second pearl's short action: disabled=${disabled}, reason «${reason}»; expected disabled with the 3-second reason in words`;
      const before = Object.keys((await docOf(pid)).sequences).length;
      await rowOf(page, RNG.rng_long).getByTestId(ID.rowShort).click();
      await sleep(4000);
      const doc = await docOf(pid);
      const seqs = Object.values(doc.sequences);
      const made = seqs.find((s) => s.id !== doc.mainSequenceId && (s as { origin?: { kind?: string } }).origin?.kind === 'short');
      const first = made?.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'media').sort((x, y) => T.cmp(x.start, y.start))[0];
      out.short = { sequences: seqs.length - before, sourceIn: first && first.type === 'media' ? `${first.sourceIn.value}/${first.sourceIn.timescale}` : null };
      evidence.P13 = out;
      // without a transcript the short starts at the pearl's first source frame (frame 60 = 2 s)
      if (!made || !first || first.type !== 'media' || !T.eq(first.sourceIn, T.rt(2, 1))) return `the short's first clip starts at ${JSON.stringify(out.short)}; expected the pearl's first source frame (2 s)`;
      // with a transcript: the same body the button sends (shortBody) is planned; the edges 2 s and 6 s lie inside words, so the
      // plan warns snapped_to_words and the excerpt, widened outward to the word edges 1.9 s and 6.25 s, contains the pearl
      const words = Array.from({ length: 11 }, (_, k) => ({ start: T.rt(190 + 40 * k, 100), duration: T.rt(35, 100), text: `מילה${k}` }));
      await tx(pid, [{ op: 'set_transcript', args: { assetId: b.a, language: 'he', segments: [{ start: words[0]!.start, duration: T.rt(435, 100), text: words.map((x) => x.text).join(' '), words }] } }]);
      const plan = await must('POST', `/projects/${pid}/shorts/plan`, shortBody({ assetId: b.a, label: 'ארבע שניות', span: { start: f(60), end: f(180) } }));
      const snapped = (plan.warnings as { code: string; details: { start?: T.RationalTime; end?: T.RationalTime } }[]).find((x) => x.code === 'snapped_to_words');
      out.withWords = { warnings: (plan.warnings as { code: string }[]).map((x) => x.code), start: snapped?.details.start ? T.toSeconds(snapped.details.start) : null, end: snapped?.details.end ? T.toSeconds(snapped.details.end) : null };
      evidence.P13 = out;
      if (!snapped?.details.start || !snapped.details.end || !T.eq(snapped.details.start, T.rt(19, 10)) || !T.eq(snapped.details.end, T.rt(625, 100))) return `with a transcript: ${JSON.stringify(out.withWords)}; expected snapped_to_words widening [2, 6) s to [1.9, 6.25) s`;
      return true;
    } finally { await close(page); }
  },

  /** P15 (browser side): the digest of usage and screen time over 20 fuzzed documents is equal in Node and in Chromium. */
  P15: async () => {
    const w = await world();
    if (!w.web) return NO_WEB;
    const docs: ProjectDocument[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const fz = createFuzz(seed + 9100);
      let n = 0;
      const ctx = (allowInternal = false) => ({ idSeed: `pu${seed}_${n++}_`, actor: 'fuzz', allowInternal });
      let doc = applyTransaction(createProject({ id: `prj_pu${seed}`, name: 'pu', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
      // names differing only in case sit in different documents (one project holds one of them)
      const gimel = seed % 2 ? 'Gimel' : 'gimel';
      doc = applyTransaction(doc, [...fz.setup(doc), { op: 'add_person', args: { name: 'אלף' } }, { op: 'add_person', args: { name: gimel } }, { op: 'add_person', args: { name: 'בית' } }], ctx()).doc;
      for (let i = 0; i < 25; i++) { try { doc = applyTransaction(doc, [fz.gen(doc)], ctx()).doc; } catch { /* a refusal is fine: the document stays */ } }
      const people = Object.keys(doc.people ?? {});
      const ranges: Record<string, SourceRange> = {};
      let k = 0;
      for (const a of Object.values(doc.assets)) {
        if (a.kind === 'lut') continue;
        const dur = a.duration;
        const whole = a.kind === 'image' || seed % 3 === 0;
        const who = people.filter((_, i) => (i + k + seed) % 2 === 0).sort();
        ranges[`rng${seed}_${k}`] = { id: `rng${seed}_${k}`, assetId: a.id, kind: 'pearl', span: whole ? null : { start: fifths(dur, 1), end: fifths(dur, 3) }, label: seed % 2 ? `פנינה ${k}` : `Pearl ${k}`, ...(who.length ? { people: who } : {}), createdBy: 'user:local' };
        k++;
        if (people.length) ranges[`rng${seed}_p${k}`] = { id: `rng${seed}_p${k}`, assetId: a.id, kind: 'presence', span: null, label: '', people: [people[(k + seed) % people.length]!], createdBy: 'user:local' };
      }
      docs.push({ ...doc, sourceRanges: ranges });
    }
    evidence.P15 = { documents: docs.length, ranges: docs.reduce((n, d) => n + Object.keys(d.sourceRanges ?? {}).length, 0) };
    if (!aBuilt()) {
      // the hook itself must exist and refuse honestly until core is built
      const page = await (await world()).browser!.newPage();
      try {
        await page.goto(`${w.origin}/selftest.html`);
        await page.waitForFunction(() => typeof (window as unknown as { __pfPearlsHash?: unknown }).__pfPearlsHash === 'function', undefined, { timeout: 30000 });
        const said = await page.evaluate((d) => { try { (window as unknown as { __pfPearlsHash: (x: unknown) => unknown }).__pfPearlsHash(d); return 'answered'; } catch (e) { return String((e as Error).message); } }, docs.slice(0, 1));
        evidence.P15 = { ...(evidence.P15 as object), hookRefusal: said };
        if (said === 'answered') return 'before A the browser hook answered, which it cannot do honestly';
      } finally { await page.close(); }
      return `${WAIT_A}; ran: window.__pfPearlsHash exists in the selftest page and refuses while core is not built (${docs.length} fuzzed documents built)`;
    }
    const node = pearlsDigest(docs);
    const page = await (await world()).browser!.newPage();
    try {
      await page.goto(`${w.origin}/selftest.html`);
      await page.waitForFunction(() => typeof (window as unknown as { __pfPearlsHash?: unknown }).__pfPearlsHash === 'function', undefined, { timeout: 30000 });
      const browser = await page.evaluate((d) => (window as unknown as { __pfPearlsHash: (x: unknown) => unknown }).__pfPearlsHash(d), docs) as { hash: string; perDoc: string[] };
      evidence.P15 = { ...(evidence.P15 as object), node: node.hash, browser: browser.hash };
      if (node.hash !== browser.hash) return `the digests differ: Node ${node.hash}, Chromium ${browser.hash} (first differing document ${node.perDoc.findIndex((h, i) => h !== browser.perDoc[i])})`;
      return true;
    } finally { await page.close(); }
  },
};

export const PEARLS_PROOF_UI = { built: true, checks } as const;

/** Stops the server and the browser and removes the temp folders (the runner calls it; the stand-alone run does). */
export async function closePearlsProofUi(): Promise<void> {
  if (!worldP) return;
  const w = await worldP;
  await w.browser?.close();
  await w.s.close();
  fs.rmSync(w.base, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.join(ROOT, 'docs', 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'pearls-proof.ui.json'), JSON.stringify({ when: new Date().toISOString(), aBuilt: aBuilt(), web: w.web, pageErrors: errors.slice(0, 20), evidence }, null, 1) + '\n');
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
    await closePearlsProofUi();
  }
  void sleep;
  process.exit(failed ? 1 : blocked ? 2 : 0);
}
