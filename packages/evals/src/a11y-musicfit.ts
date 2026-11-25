/**
 * The accessibility audit scenarios of «מוזיקה שמתאימה לסרט» (wave 7 musicfit, integration): the fit block idle, with its plan,
 * refused, and not available; the swap dialog with its "what changes" table (modal); the impact controls in a video clip's Beat tab
 * with a marked moment. Each in the language and theme (dark and light) the audit runs it in. Each scenario PREPARES the page and
 * says whether the state is shown (and whether it is modal); a11y-audit.ts runs its full heuristic on it.
 *
 * Fixtures: a 14 s picture made of the audit's barcode video (two clips) and built-in music made by the product (POST …/music); a
 * second project with a 4 s picture, where the real plan route refuses too_short. The plans are the real plan route's. The
 * not-available state answers the editor's plan request with the server's own 501 musicfit_not_built body, written out here and
 * said so in the scenario's detail (the routes are built, so that state cannot be reached otherwise): the audit looks at how the
 * block says it.
 */
import type { Page } from 'playwright';
import { MUSICFIT_TESTIDS as ID } from '../../../apps/web/src/editor/musicfit/musicFit.testids.ts';
import { openInspectorPage } from './editor-ui.ts';

export interface MusicfitA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface MusicfitA11yScenario {
  id: string;
  prepare(ctx: MusicfitA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: MusicfitA11yCtx): Promise<void>;
}
const rt = (n: number) => ({ value: String(n), timescale: 30 });
interface Made { origin: string; pid: string; video: string; music: string; shortPid: string; shortMusic: string }
let made: Made | null = null;

async function api(page: Page, method: 'GET' | 'POST', p: string, body?: unknown, raw?: Buffer, filename?: string): Promise<any> {
  const origin = new URL(page.url()).origin;
  const r = await page.context().request.fetch(`${origin}/api/v1${p}`, { method, ...(raw ? { data: raw, headers: { 'x-filename': filename ?? 'f.mp4' } } : body !== undefined ? { data: body, headers: { 'content-type': 'application/json' } } : {}) });
  const text = await r.text();
  try { return { status: r.status(), body: JSON.parse(text) }; } catch { return { status: r.status(), body: text }; }
}
/** The audit project's video asset (its first media clip's file), reused for the two musicfit projects. */
async function videoBytes(page: Page, pid: string): Promise<{ assetId: string; bytes: Buffer }> {
  const d = (await api(page, 'GET', `/projects/${pid}`)).body.project;
  const a = Object.values(d.assets as Record<string, { id: string; kind: string }>).find((x) => x.kind === 'video')!;
  const origin = new URL(page.url()).origin;
  const r = await page.context().request.fetch(`${origin}/api/v1/projects/${pid}/assets/${a.id}/content`);
  return { assetId: a.id, bytes: Buffer.from(await r.body()) };
}
async function ensure(ctx: MusicfitA11yCtx): Promise<Made> {
  const { page } = ctx;
  const origin = new URL(page.url()).origin;
  if (made && made.origin === origin) return made;
  const v = await videoBytes(page, ctx.pid);
  const project = async (name: string, seconds: number) => {
    const pid = (await api(page, 'POST', '/projects', { name, width: 640, height: 360 })).body.project.id as string;
    const up = await api(page, 'POST', `/projects/${pid}/assets`, undefined, v.bytes, 'barcode.mp4');
    // clips of at most 4 s (the audit's barcode video is 120 frames), one after the other
    const ops: unknown[] = [];
    for (let at = 0; at < seconds * 30; at += 120) ops.push({ op: 'add_clip', args: { assetId: up.body.assetId, start: rt(at), duration: rt(Math.min(120, seconds * 30 - at)), withLinkedAudio: false } });
    const tx = await api(page, 'POST', `/projects/${pid}/transactions`, { ops });
    const music = await api(page, 'POST', `/projects/${pid}/music`, { styleId: 'music.calm', bars: 8, seed: 1, start: rt(0) });
    return { pid, video: tx.body.results[0].output.clipId as string, music: music.body.clipId as string };
  };
  const a = await project('a11y-musicfit', 14), b = await project('a11y-musicfit-short', 4);
  made = { origin, pid: a.pid, video: a.video, music: a.music, shortPid: b.pid, shortMusic: b.music };
  return made;
}
async function openProject(ctx: MusicfitA11yCtx, pid: string) {
  const { page, lang } = ctx;
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/?project=${pid}`);
  await page.getByTestId('timecode').waitFor();
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
}
async function openBlock(ctx: MusicfitA11yCtx, pid: string, clipId: string) {
  await openProject(ctx, pid);
  await openInspectorPage(ctx.page, 'sound');
  await ctx.page.locator(`.clip[data-clip-id="${clipId}"]`).click({ position: { x: 4, y: 4 } });
  await ctx.page.getByTestId(ID.block).waitFor({ timeout: 10000 });
}
const blockState = (page: Page) => page.getByTestId(ID.block).getAttribute('data-state', { timeout: 3000 }).catch(() => null);
const waitBlock = (page: Page, states: string[], timeout = 30000) => page.waitForFunction(([sel, want]) => (want as string[]).includes(document.querySelector(sel as string)?.getAttribute('data-state') ?? ''), [`[data-testid="${ID.block}"]`, states] as const, { timeout }).then(() => true, () => false);

export const musicfitA11yScenarios: MusicfitA11yScenario[] = [
  {
    id: 'musicfit-block-idle',
    async prepare(ctx) {
      const m = await ensure(ctx);
      await openBlock(ctx, m.pid, m.music);
      const st = await blockState(ctx.page);
      return { shown: st === 'idle' && (await ctx.page.getByTestId(ID.fit).count()) === 1 && (await ctx.page.getByTestId(ID.swap).count()) >= 1, modal: false, detail: { blockState: st } };
    },
  },
  {
    id: 'musicfit-block-plan',
    async prepare(ctx) {
      const m = await ensure(ctx);
      await openBlock(ctx, m.pid, m.music);
      await ctx.page.getByTestId(ID.fit).click();
      await waitBlock(ctx.page, ['plan', 'refused', 'not-built']);
      const st = await blockState(ctx.page);
      return { shown: st === 'plan' && (await ctx.page.getByTestId(ID.apply).count()) === 1 && (await ctx.page.getByTestId(ID.ending).count()) === 1, modal: false, detail: { blockState: st, plan: 'the real plan route' } };
    },
    async leave(ctx) { await ctx.page.getByTestId(ID.cancel).click().catch(() => {}); },
  },
  {
    id: 'musicfit-block-refused',
    async prepare(ctx) {
      const m = await ensure(ctx);
      await openBlock(ctx, m.shortPid, m.shortMusic);
      await ctx.page.getByTestId(ID.fit).click();
      await waitBlock(ctx.page, ['refused', 'plan', 'not-built']);
      const st = await blockState(ctx.page);
      const alert = ctx.page.locator(`[data-testid="${ID.block}"] [role=alert]`);
      const text = (await alert.count()) ? ((await alert.first().textContent()) ?? '').trim() : '';
      return { shown: st === 'refused' && text.length > 0, modal: false, detail: { blockState: st, answer: 'the real plan route: a 4 s picture is too short for the style (400 too_short)', text } };
    },
  },
  {
    id: 'musicfit-block-not-available',
    async prepare(ctx) {
      const m = await ensure(ctx);
      await openBlock(ctx, m.pid, m.music);
      await ctx.page.route('**/music-fit/plan', (route) => route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: { code: 'musicfit_not_built', message: 'music that fits the film is not built in this build yet', hint: 'Update the editor and try again.' } }) }));
      await ctx.page.getByTestId(ID.fit).click();
      await waitBlock(ctx.page, ['not-built', 'refused', 'plan']);
      const st = await blockState(ctx.page);
      return { shown: st === 'not-built' && (await ctx.page.getByTestId(`${ID.block}-notbuilt`).count()) === 1, modal: false, detail: { blockState: st, answer: 'the server\'s own 501 musicfit_not_built body, written out by the audit (the routes are built here)' } };
    },
    async leave(ctx) { await ctx.page.unroute('**/music-fit/plan').catch(() => {}); },
  },
  {
    id: 'musicfit-swap-dialog',
    async prepare(ctx) {
      const m = await ensure(ctx);
      await openBlock(ctx, m.pid, m.music);
      await ctx.page.getByTestId(ID.swap).first().click();
      await ctx.page.getByTestId(ID.swapDialog).waitFor({ timeout: 10000 });
      await ctx.page.locator(`[data-testid="${ID.swapRow}"][data-style-id="music.pop"]`).click();
      const table = await ctx.page.getByTestId(ID.swapWhat).waitFor({ timeout: 30000 }).then(() => true, () => false);
      return { shown: table && (await ctx.page.locator('[role=dialog][aria-modal=true]').count()) >= 1, modal: true, detail: { table, plan: 'the real plan route (music.pop, fit to the length)' } };
    },
    async leave(ctx) {
      if (await ctx.page.getByTestId(ID.swapDialog).count()) await ctx.page.keyboard.press('Escape');
      await ctx.page.getByTestId(ID.swapDialog).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    },
  },
  {
    id: 'musicfit-impact-controls',
    async prepare(ctx) {
      const m = await ensure(ctx);
      // a moment marked on the picture (the owner's own operation, through the route the editor uses)
      await api(ctx.page, 'POST', `/projects/${m.pid}/transactions`, { ops: [{ op: 'set_clip_impact', args: { clipId: m.video, moment: { value: '37', timescale: 30 } } }] });
      await openProject(ctx, m.pid);
      await ctx.page.locator(`.clip[data-clip-id="${m.video}"]`).click({ position: { x: 4, y: 4 } });
      await ctx.page.getByTestId('insp-tab-beat').first().click({ timeout: 8000 }).catch(() => {});
      const shown = await ctx.page.getByTestId(ID.impact).waitFor({ timeout: 10000 }).then(() => true, () => false);
      const st = shown ? await ctx.page.getByTestId(ID.impact).getAttribute('data-state') : null;
      return { shown: shown && (st === 'marked' || st === 'on-beat') && (await ctx.page.getByTestId(ID.toBeat).count()) === 1, modal: false, detail: { impactState: st, clip: 'a video clip (its Beat tab)' } };
    },
    async leave(ctx) {
      if (made) await api(ctx.page, 'POST', `/projects/${made.pid}/transactions`, { ops: [{ op: 'set_clip_impact', args: { clipId: made.video, moment: null } }] });
    },
  },
];
