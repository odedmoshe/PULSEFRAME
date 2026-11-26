/**
 * The accessibility audit scenarios of the stabilisation block (wave 7 stabilise track): the block not measured, measuring (with
 * «עצירה»), on with the slider and the crop line, limited (the clip's zoom is smaller than its frames need), refused; each in the
 * language and theme (dark and light) the audit runs it in. Each scenario PREPARES the page and says whether the state is shown (and whether it is
 * modal); a11y-audit.ts then runs its full heuristic on it.
 *
 * The clip is a SYNTHETIC shaky video made here (packages/fixtures steady.ts, F1, 240 frames at 480×270) in its own project. The
 * states come from the real editor and the real job: «ייצבו את הקליפ» runs the real measurement. Two states are produced by the
 * owner's own operations through the same routes the editor uses (limited: set_clip_stabilise with a zoom of 1000; reset: the
 * measurement removed). The refused state answers the editor's POST …/stabilise with the server's own busy refusal (429), written out
 * here and said so in the scenario's detail: the audit looks at how the block says a refusal, not at the server.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { steadyFixture, writeSteadyFixture } from '../../fixtures/src/steady.ts';

export interface StabiliseA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface StabiliseA11yScenario {
  id: string;
  prepare(ctx: StabiliseA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: StabiliseA11yCtx): Promise<void>;
}

const FRAMES = { num: 30, den: 1 };
const rt = (n: number) => ({ value: String(n), timescale: 30 });
let made: { origin: string; pid: string; clipId: string; assetId: string } | null = null;

async function api(page: Page, method: 'GET' | 'POST', p: string, body?: unknown, raw?: Buffer, filename?: string): Promise<any> {
  const origin = new URL(page.url()).origin;
  const r = await page.context().request.fetch(`${origin}/api/v1${p}`, { method, ...(raw ? { data: raw, headers: { 'x-filename': filename ?? 'f.mp4' } } : body !== undefined ? { data: body, headers: { 'content-type': 'application/json' } } : {}) });
  const text = await r.text();
  try { return { status: r.status(), body: JSON.parse(text) }; } catch { return { status: r.status(), body: text }; }
}
async function ensureClip(page: Page): Promise<{ pid: string; clipId: string; assetId: string }> {
  const origin = new URL(page.url()).origin;
  if (made && made.origin === origin) return made;
  const file = path.join(os.tmpdir(), `pf-a11y-stabilise-${process.pid}.mp4`);
  if (!fs.existsSync(file)) await writeSteadyFixture(steadyFixture({ variant: 'F1', frames: 240 }), file, { width: 480, height: 270 });
  const pid = (await api(page, 'POST', '/projects', { name: 'a11y-stabilise', width: 480, height: 270 })).body.project.id as string;
  const up = await api(page, 'POST', `/projects/${pid}/assets`, undefined, fs.readFileSync(file), 'shaky.mp4');
  const assetId = up.body.assetId as string;
  const tx = await api(page, 'POST', `/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId, start: rt(0), sourceIn: rt(30), duration: rt(150), withLinkedAudio: false } }] });
  made = { origin, pid, clipId: tx.body.results[0].output.clipId as string, assetId };
  void FRAMES;
  return made;
}
/** Open the project, the clip, the motion tab and the block (in this language); returns the panel's state. */
async function openBlock(ctx: StabiliseA11yCtx): Promise<{ pid: string; clipId: string; assetId: string }> {
  const { page, lang } = ctx;
  const m = await ensureClip(page);
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/?project=${m.pid}`);
  await page.getByTestId('timecode').waitFor();
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
  await page.locator(`.clip[data-clip-id="${m.clipId}"]`).click({ position: { x: 4, y: 4 } });
  await page.getByTestId('insp-tab-motion').click({ timeout: 8000 }).catch(() => {});
  const sec = page.getByTestId('section-stabilise');
  await sec.waitFor({ timeout: 8000 });
  if ((await sec.getAttribute('data-open')) !== 'true') await sec.locator('.pf-section-toggle').click();
  await page.getByTestId('stab-panel').waitFor({ timeout: 8000 });
  return m;
}
const state = (page: Page) => page.getByTestId('stab-panel').getAttribute('data-state', { timeout: 3000 }).catch(() => null);
const waitState = (page: Page, states: string[], timeout = 120_000) => page.waitForFunction((want) => want.includes(document.querySelector('[data-testid=stab-panel]')?.getAttribute('data-state') ?? ''), states, { timeout }).then(() => true, () => false);
async function toNotMeasured(ctx: StabiliseA11yCtx, m: { pid: string; assetId: string }) {
  await api(ctx.page, 'POST', `/projects/${m.pid}/transactions`, { ops: [{ op: 'remove_camera_motion', args: { assetId: m.assetId, mode: 'unbind' } }] });
  await waitState(ctx.page, ['not-measured'], 8000);
}
async function toOn(ctx: StabiliseA11yCtx) {
  const { page } = ctx;
  let st = await state(page);
  if (st === 'not-measured') { await page.getByTestId('stab-run').click(); await waitState(page, ['on', 'limited', 'refused']); st = await state(page); }
  if (st === 'off') { await page.getByTestId('stab-toggle').click(); await waitState(page, ['on', 'limited']); }
}

export const stabiliseA11yScenarios: StabiliseA11yScenario[] = [
  {
    id: 'stabilise-not-measured',
    async prepare(ctx) {
      const m = await openBlock(ctx);
      await toNotMeasured(ctx, m);
      const st = await state(ctx.page);
      return { shown: st === 'not-measured' && (await ctx.page.getByTestId('stab-run').count()) === 1, modal: false, detail: { blockState: st } };
    },
  },
  {
    id: 'stabilise-measuring',
    async prepare(ctx) {
      const m = await openBlock(ctx);
      await toNotMeasured(ctx, m);
      await ctx.page.getByTestId('stab-run').click();
      await waitState(ctx.page, ['measuring'], 8000);
      const st = await state(ctx.page);
      return { shown: st === 'measuring' && (await ctx.page.getByTestId('stab-stop').count()) === 1 && (await ctx.page.locator('[data-testid=stab-panel] [role=progressbar]').count()) === 1, modal: false, detail: { blockState: st, job: 'the real measurement of the synthetic clip' } };
    },
    async leave(ctx) {
      if ((await ctx.page.getByTestId('stab-stop').count()) > 0) { await ctx.page.getByTestId('stab-stop').click().catch(() => {}); await waitState(ctx.page, ['not-measured'], 20_000); }
    },
  },
  {
    id: 'stabilise-on',
    async prepare(ctx) {
      await openBlock(ctx);
      await toOn(ctx);
      const st = await state(ctx.page);
      return { shown: st === 'on' && (await ctx.page.getByTestId('stab-strength').count()) === 1 && (await ctx.page.getByTestId('stab-crop').count()) === 1 && (await ctx.page.getByTestId('stab-toggle').getAttribute('aria-checked')) === 'true', modal: false, detail: { blockState: st } };
    },
  },
  {
    id: 'stabilise-limited',
    async prepare(ctx) {
      const m = await openBlock(ctx);
      await toOn(ctx);
      await api(ctx.page, 'POST', `/projects/${m.pid}/transactions`, { ops: [{ op: 'set_clip_stabilise', args: { clipId: m.clipId, stabilise: { strength: 100, zoomPm: 1000 } } }] });
      await waitState(ctx.page, ['limited'], 8000);
      const st = await state(ctx.page);
      return { shown: st === 'limited' && (await ctx.page.getByTestId('stab-recalc').count()) === 1, modal: false, detail: { blockState: st, how: 'set_clip_stabilise with zoomPm 1000 on a clip that needs more' } };
    },
    async leave(ctx) {
      if (made) await api(ctx.page, 'POST', `/projects/${made.pid}/transactions`, { ops: [{ op: 'set_clip_stabilise', args: { clipId: made.clipId, stabilise: { strength: 50 } } }] });
    },
  },
  {
    id: 'stabilise-refused',
    async prepare(ctx) {
      const m = await openBlock(ctx);
      await toNotMeasured(ctx, m);
      await ctx.page.route('**/clips/*/stabilise', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'busy', message: 'too many camera measurements and motion tracks are already running or waiting; try again shortly', hint: 'Try again in half a minute.' } }) }));
      await ctx.page.getByTestId('stab-run').click();
      await waitState(ctx.page, ['refused'], 8000);
      const st = await state(ctx.page);
      const text = ((await ctx.page.getByTestId('stab-status').textContent()) ?? '').trim();
      return { shown: st === 'refused' && text.length > 0 && (await ctx.page.getByTestId('stab-status').getAttribute('role')) === 'alert', modal: false, detail: { blockState: st, answer: 'the server\'s own 429 busy body, written out by the audit', text } };
    },
    async leave(ctx) { await ctx.page.unroute('**/clips/*/stabilise').catch(() => {}); },
  },
];
