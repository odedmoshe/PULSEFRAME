/**
 * The accessibility audit scenarios of «ספרו מה היה» (wave 7 story track; integration): the dialog with a narration chosen, the
 * recorder while recording and when the microphone is refused, the «סיפור» tab of the perform workspace (the tap view), and the story
 * bar after a story was applied; a11y-audit.ts runs each in both languages and both themes, with its full heuristic.
 * Each scenario PREPARES the page and says whether the state is shown (and whether it is modal); a state that could not be brought up
 * says `shown: false`, which the audit reports as a finding, never as a pass.
 * Synthetic data only: a scratch project of its own with three solid-colour stills (ffmpeg) and the proof's synthetic narration
 * (story-fixtures.ts: tones in bursts over seeded noise). The microphone is the page's own: for «recording» getUserMedia is answered
 * with a stream from an oscillator in the page (headless Chromium has no microphone; the recorder engine runs for real on it), for
 * «denied» it throws NotAllowedError as a person's «Block» does. Both are said in the scenario's detail.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { STORY_TESTIDS as ID } from '../../../apps/web/src/editor/story/story.testids.ts';
import { storyStrings } from '../../../apps/web/src/editor/story/story.strings.ts';
import { makeStoryFixtures } from './story-fixtures.ts';

export interface StoryA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface StoryA11yScenario {
  id: string;
  prepare(ctx: StoryA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: StoryA11yCtx): Promise<void>;
}

interface Made { origin: string; pid: string; narration: string; stills: string[] }
let made: Made | null = null;
let files: { narration: string; stills: string[]; dir: string } | null = null;
process.once('exit', () => { if (files) try { fs.rmSync(files.dir, { recursive: true, force: true }); } catch { /* best effort */ } });

async function api(page: Page, method: 'GET' | 'POST', p: string, body?: unknown, raw?: Buffer, filename?: string): Promise<any> {
  const origin = new URL(page.url()).origin;
  const r = await page.context().request.fetch(`${origin}/api/v1${p}`, { method, ...(raw ? { data: raw, headers: { 'x-filename': encodeURIComponent(filename ?? 'f.bin') } } : body !== undefined ? { data: body, headers: { 'content-type': 'application/json' } } : {}) });
  const text = await r.text();
  try { return { status: r.status(), body: JSON.parse(text) }; } catch { return { status: r.status(), body: text }; }
}
function makeFiles() {
  if (files) return files;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-a11y-story-'));
  const fx = makeStoryFixtures(dir);
  const stills = ['dc1e1e', '1ec81e', '1e1edc'].map((c, i) => { const out = path.join(dir, `still-${i}.png`); execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x${c}:s=640x360`, '-frames:v', '1', out]); return out; });
  files = { narration: fx['narration.wav'], stills, dir };
  return files;
}
/** The scratch project (once per server): three stills and the narration, its waveform ready (the plan waits for it otherwise). */
async function ensureProject(page: Page): Promise<Made> {
  const origin = new URL(page.url()).origin;
  if (made && made.origin === origin) return made;
  const f = makeFiles();
  const pid = (await api(page, 'POST', '/projects', { name: 'a11y-story', width: 640, height: 360, frameRate: { num: 30, den: 1 } })).body.project.id as string;
  const stills: string[] = [];
  for (const [i, s] of f.stills.entries()) stills.push((await api(page, 'POST', `/projects/${pid}/assets`, undefined, fs.readFileSync(s), `still-${i}.png`)).body.assetId as string);
  const narration = (await api(page, 'POST', `/projects/${pid}/assets`, undefined, fs.readFileSync(f.narration), 'narration.wav')).body.assetId as string;
  for (let i = 0; i < 300; i++) {
    const d = await api(page, 'GET', `/projects/${pid}/assets/${narration}/derivatives`);
    const w = (d.body?.derivatives ?? []).find((x: { kind: string }) => x.kind === 'waveform');
    if (!w || ['ready', 'failed', 'not-applicable'].includes(w.status)) break;
    await page.waitForTimeout(200);
  }
  made = { origin, pid, narration, stills };
  return made;
}
async function openProject(ctx: StoryA11yCtx): Promise<Made> {
  const { page, lang } = ctx;
  const m = await ensureProject(page);
  await page.goto(`${m.origin}/?project=${m.pid}`);
  await page.getByTestId('timecode').waitFor();
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
  return m;
}
/** The palette's «ספרו מה היה» with nothing selected: the library's pictures. */
async function openDialog(ctx: StoryA11yCtx): Promise<boolean> {
  const { page, lang } = ctx;
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill(storyStrings(lang).name).catch(() => {});
  await page.getByTestId('palette-option').first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.keyboard.press('Enter');
  return page.getByTestId(ID.dialog).waitFor({ timeout: 8000 }).then(() => true, () => false);
}
async function chooseNarration(page: Page, m: Made): Promise<boolean> {
  await page.getByTestId(ID.fromLibrary).selectOption(m.narration).catch(() => {});
  return page.getByTestId(ID.narration).waitFor({ timeout: 8000 }).then(() => true, () => false);
}
const recState = (page: Page) => page.getByTestId(ID.recorder).getAttribute('data-state', { timeout: 3000 }).catch(() => null);
const waitRec = (page: Page, want: string) => page.waitForFunction(([id, w]) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-state') === w, [ID.recorder, want] as const, { timeout: 15000 }).then(() => true, () => false);
/** Close the dialog (its close releases the microphone) if it is open. */
async function closeDialog(page: Page) {
  if (await page.getByTestId(ID.dialog).count()) { await page.keyboard.press('Escape'); await page.getByTestId(ID.dialog).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); }
}

export const storyA11yScenarios: StoryA11yScenario[] = [
  {
    id: 'story-dialog',
    async prepare(ctx) {
      const m = await openProject(ctx);
      const open = await openDialog(ctx);
      const chosen = open && (await chooseNarration(ctx.page, m));
      await ctx.page.waitForFunction((id) => !document.querySelector(`[data-testid="${id}"]`)?.closest('[aria-busy="true"]'), ID.tapAlong, { timeout: 8000 }).catch(() => {});
      return { shown: open && chosen && (await ctx.page.getByTestId(ID.item).count()) === 3, modal: true, detail: { recorder: await recState(ctx.page) } };
    },
    async leave(ctx) { await closeDialog(ctx.page); },
  },
  {
    id: 'story-recorder-recording',
    async prepare(ctx) {
      await openProject(ctx);
      const open = await openDialog(ctx);
      // the page's own microphone: an oscillator through a MediaStream destination (real tracks, the real recorder engine)
      await ctx.page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(); const o = c.createOscillator(); const d = c.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream; };
      });
      await ctx.page.getByTestId(ID.recStart).click().catch(() => {});
      const rec = await waitRec(ctx.page, 'recording');
      return { shown: open && rec && (await ctx.page.getByTestId(ID.recStop).count()) === 1 && (await ctx.page.getByTestId(ID.recLevel).count()) === 1, modal: true, detail: { recorder: await recState(ctx.page), microphone: 'an oscillator in the page (headless has no microphone)' } };
    },
    async leave(ctx) { await closeDialog(ctx.page); },
  },
  {
    id: 'story-recorder-denied',
    async prepare(ctx) {
      await openProject(ctx);
      const open = await openDialog(ctx);
      await ctx.page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }; });
      await ctx.page.getByTestId(ID.recStart).click().catch(() => {});
      const denied = await waitRec(ctx.page, 'denied');
      return { shown: open && denied, modal: true, detail: { recorder: await recState(ctx.page), microphone: 'getUserMedia answers NotAllowedError, as a person\'s «Block» does' } };
    },
    async leave(ctx) { await closeDialog(ctx.page); },
  },
  {
    id: 'story-tap-tab',
    async prepare(ctx) {
      const m = await openProject(ctx);
      const open = await openDialog(ctx);
      const chosen = open && (await chooseNarration(ctx.page, m));
      await ctx.page.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('aria-disabled') !== 'true', ID.tapAlong, { timeout: 10000 }).catch(() => {});
      await ctx.page.getByTestId(ID.tapAlong).click().catch(() => {});
      const shown = chosen && (await ctx.page.getByTestId(ID.tapView).waitFor({ timeout: 20000 }).then(() => true, () => false));
      return { shown: shown && (await ctx.page.getByTestId(ID.tapStart).count()) === 1, modal: false, detail: { phase: await ctx.page.getByTestId(ID.tapView).getAttribute('data-phase').catch(() => null) } };
    },
    async leave(ctx) {
      if (await ctx.page.getByTestId(ID.tapDiscard).count()) await ctx.page.getByTestId(ID.tapDiscard).click().catch(() => {});
    },
  },
  {
    id: 'story-bar',
    async prepare(ctx) {
      const m = await ensureProject(ctx.page);
      const runs = (await api(ctx.page, 'GET', `/projects/${m.pid}`)).body?.project?.recipeRuns ?? {};
      const has = Object.values(runs).some((r) => (r as { recipeId?: string }).recipeId === 'template:tpl.story');
      const a = has ? { status: 200 } : await api(ctx.page, 'POST', `/projects/${m.pid}/recipes/story/apply`, { params: { narrationAssetId: m.narration, assetIds: m.stills, cutsMs: [8200, 15000], openingTitle: false } });
      await openProject(ctx);
      const bar = await ctx.page.getByTestId(ID.bar).waitFor({ timeout: 10000 }).then(() => true, () => false);
      return { shown: a.status === 200 && bar && (await ctx.page.getByTestId(ID.barRebuild).count()) === 1, modal: false, detail: { apply: a.status } };
    },
  },
];
