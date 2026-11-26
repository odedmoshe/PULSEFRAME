/**
 * The accessibility audit scenarios of «הפריים הכי חד» and «שמירת התמונה» (wave 8 cover, W3): the block idle, measuring (with «עצירה»),
 * found (tiles with their numbers), refused (the server's own 422 for a stretch over 600 frames, answered through the page), the picture
 * file, and the save dialog (paper chosen, the crop frame and the ppi lines). Each scenario PREPARES the page and says whether the state
 * is shown (and whether it is modal); a11y-audit.ts then runs its full heuristic on it.
 *
 * SYNTHETIC clip made here (ffmpeg testsrc2, 640x360, 30 fps, 150 frames) in its own project. The states come from the real editor and
 * the real routes: this needs W1's and W2's bodies; before they are merged the scenario reports shown:false with the server's own
 * answer in `detail`, never a pass. The refused state answers POST …/stills with the server's own 422 wording, written out here and
 * said so in the detail (the audit looks at how the block says a refusal, not at the server).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';

export interface CoverA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface CoverA11yScenario {
  id: string;
  prepare(ctx: CoverA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: CoverA11yCtx): Promise<void>;
}
const rt = (n: number) => ({ value: String(n), timescale: 30 });
let made: { origin: string; pid: string; clipId: string; assetId: string } | null = null;

async function api(page: Page, method: 'GET' | 'POST', p: string, body?: unknown, raw?: Buffer): Promise<any> {
  const origin = new URL(page.url()).origin;
  const r = await page.context().request.fetch(`${origin}/api/v1${p}`, { method, ...(raw ? { data: raw, headers: { 'x-filename': 'cover.mp4' } } : body !== undefined ? { data: body, headers: { 'content-type': 'application/json' } } : {}) });
  const text = await r.text();
  try { return { status: r.status(), body: JSON.parse(text) }; } catch { return { status: r.status(), body: text }; }
}
async function ensureClip(page: Page) {
  const origin = new URL(page.url()).origin;
  if (made && made.origin === origin) return made;
  const file = path.join(os.tmpdir(), `pf-a11y-cover-${process.pid}.mp4`);
  process.once('exit', () => { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }); // the fixture is deleted when the audit ends
  if (!fs.existsSync(file)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', '-g', '15', '-an', file]);
  const pid = (await api(page, 'POST', '/projects', { name: 'a11y-cover', width: 640, height: 360 })).body.project.id as string;
  const up = await api(page, 'POST', `/projects/${pid}/assets`, undefined, fs.readFileSync(file));
  const assetId = up.body.assetId as string;
  const tx = await api(page, 'POST', `/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId, start: rt(0), sourceIn: rt(0), duration: rt(90), withLinkedAudio: false } }] });
  made = { origin, pid, clipId: tx.body.results[0].output.clipId as string, assetId };
  return made;
}
async function openBlock(ctx: CoverA11yCtx) {
  const { page, lang } = ctx;
  const m = await ensureClip(page);
  await page.goto(`${m.origin}/?project=${m.pid}`);
  await page.getByTestId('timecode').waitFor();
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
  await page.locator(`.clip[data-clip-id="${m.clipId}"]`).click({ position: { x: 4, y: 4 } });
  await page.getByTestId('insp-tab-motion').click({ timeout: 8000 }).catch(() => {});
  const sec = page.getByTestId('section-sharpest');
  await sec.waitFor({ timeout: 8000 });
  if ((await sec.getAttribute('data-open')) !== 'true') await sec.locator('.pf-section-toggle').click();
  await page.getByTestId('sharp-panel').waitFor({ timeout: 8000 });
  return m;
}
const state = (page: Page) => page.getByTestId('sharp-panel').getAttribute('data-state', { timeout: 3000 }).catch(() => null);
const waitState = (page: Page, states: string[], timeout = 120_000) => page.waitForFunction((want) => want.includes(document.querySelector('[data-testid=sharp-panel]')?.getAttribute('data-state') ?? ''), states, { timeout }).then(() => true, () => false);
async function toFound(ctx: CoverA11yCtx): Promise<string | null> {
  if ((await state(ctx.page)) !== 'found') { await ctx.page.getByTestId('sharp-measure').click(); await waitState(ctx.page, ['found', 'refused']); }
  return state(ctx.page);
}
const why = async (page: Page) => ((await page.getByTestId('sharp-status').textContent().catch(() => '')) ?? '').trim();

export const coverA11yScenarios: CoverA11yScenario[] = [
  { id: 'cover-idle', async prepare(ctx) { await openBlock(ctx); const st = await state(ctx.page); return { shown: st === 'idle' && (await ctx.page.getByTestId('sharp-measure').count()) === 1, modal: false, detail: { blockState: st } }; } },
  {
    id: 'cover-measuring',
    async prepare(ctx) {
      await openBlock(ctx);
      await ctx.page.getByTestId('sharp-measure').click();
      await waitState(ctx.page, ['measuring'], 8000);
      const st = await state(ctx.page);
      return { shown: st === 'measuring' && (await ctx.page.getByTestId('sharp-stop').count()) === 1 && (await ctx.page.locator('[data-testid=sharp-panel] [role=progressbar]').count()) === 1, modal: false, detail: { blockState: st, status: await why(ctx.page) } };
    },
    async leave(ctx) { if ((await ctx.page.getByTestId('sharp-stop').count()) > 0) { await ctx.page.getByTestId('sharp-stop').click().catch(() => {}); await waitState(ctx.page, ['idle', 'found'], 20_000); } },
  },
  {
    id: 'cover-found',
    async prepare(ctx) {
      await openBlock(ctx);
      const st = await toFound(ctx);
      const tiles = await ctx.page.getByTestId('sharp-tile').count();
      return { shown: st === 'found' && tiles >= 1 && tiles <= 3 && (await ctx.page.getByTestId('sharp-label').count()) >= 1, modal: false, detail: { blockState: st, tiles, status: await why(ctx.page) } };
    },
  },
  {
    id: 'cover-refused',
    async prepare(ctx) {
      await openBlock(ctx);
      if ((await state(ctx.page)) === 'found') return { shown: false, modal: false, detail: { note: 'a stored answer is shown on open; the refusal state needs an unmeasured stretch' } };
      await ctx.page.route('**/projects/*/stills', (route) => (route.request().method() === 'POST'
        ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'stills_range_too_long', message: 'too long to measure frame by frame: the stretch has 1200 frames, at most 600', hint: 'Trim the clip, or choose a shorter stretch, of at most 600 frames.' } }) })
        : route.continue()));
      await ctx.page.getByTestId('sharp-measure').click();
      await waitState(ctx.page, ['refused'], 8000);
      const st = await state(ctx.page), text = await why(ctx.page);
      return { shown: st === 'refused' && text.length > 0 && (await ctx.page.getByTestId('sharp-status').getAttribute('role')) === 'alert', modal: false, detail: { blockState: st, answer: 'the server\'s own 422 wording, written out by the audit', text } };
    },
    async leave(ctx) { await ctx.page.unroute('**/projects/*/stills').catch(() => {}); },
  },
  {
    id: 'cover-dialog',
    async prepare(ctx) {
      await openBlock(ctx);
      const st = await toFound(ctx);
      if (st !== 'found') return { shown: false, modal: true, detail: { blockState: st, status: await why(ctx.page) } };
      await ctx.page.getByTestId('sharp-tile').first().getByTestId('still-save').click();
      await ctx.page.getByTestId('still-dialog').waitFor({ timeout: 8000 });
      await ctx.page.getByTestId('still-paper-10x15').check();
      await ctx.page.getByTestId('still-crop').waitFor({ timeout: 5000 }).catch(() => {});
      return { shown: (await ctx.page.getByTestId('still-crop').count()) === 1 && (await ctx.page.getByTestId('still-ppi').count()) === 3, modal: true, detail: { paper: '10x15' } };
    },
    async leave(ctx) { if ((await ctx.page.getByTestId('still-dialog').count()) > 0) await ctx.page.keyboard.press('Escape'); },
  },
];
