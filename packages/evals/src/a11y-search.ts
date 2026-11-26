/**
 * The accessibility audit scenarios of «חיפוש בצילומים» (wave 7 search track; builder C): the results with both sections, «לא נמצא דבר»,
 * the picture status line (not installed; scanning with «עצור»), and the forget confirmation; both languages (a11y-audit.ts runs each
 * scenario in both and in both themes). Each scenario PREPARES the page and says whether the state is shown (and whether it is modal);
 * a11y-audit.ts then runs its full heuristic on it. A state that could not be brought up says `shown: false`, which the audit reports
 * as a finding, never as a pass.
 *
 * Synthetic data only: a scratch project of its own with one generated 2-second video (ffmpeg testsrc2) named colours.mp4. The results
 * and «לא נמצא דבר» run against the real server (the part found without a model is computed in the page). The three states of the
 * picture part that need an installed model and a scan (not installed with a reason, scanning, something kept to forget) are brought up
 * by answering the page's own `GET …/search/index` and `GET /jobs/…` with a fixed AUDIT FIXTURE through the browser's route hook,
 * labelled so in `detail.fixture`: the audit looks at how the interface presents the state, it never claims the model works.
 * The route hook is removed by `leave`; the original page is restored by the last scenario's `leave`. A detail never uses the key
 * `state`: the audit spreads the detail over its own record, whose `state` is the scenario id.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page, Route } from 'playwright';
import { SEARCH_TESTIDS as ID } from '../../../apps/web/src/editor/search/search.testids.ts';

export interface SearchA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface SearchA11yScenario {
  id: string;
  prepare(ctx: SearchA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: SearchA11yCtx): Promise<void>;
}

interface Made { id: string; home: string }
const made = new WeakMap<Page, Promise<Made>>();
const settle = (page: Page) => page.waitForTimeout(250);
const FIXTURE_LABEL = 'AUDIT FIXTURE: the index route answered by the audit, not by a server runtime';

/** The scratch project of this page, made once: one 2-second generated video named colours.mp4 on the timeline. */
function project(ctx: SearchA11yCtx): Promise<Made> {
  const have = made.get(ctx.page);
  if (have) return have;
  const p = (async () => {
    const { page } = ctx;
    const home = page.url();
    const origin = new URL(home).origin;
    const headers = { origin, 'content-type': 'application/json' };
    const post = async (p2: string, data: unknown) => { const r = await page.request.post(`${origin}/api/v1${p2}`, { headers, data }); if (!r.ok()) throw new Error(`${p2} answered ${r.status()}: ${(await r.text()).slice(0, 200)}`); return (await r.json()) as any; };
    const id = (await post('/projects', { name: 'search-a11y', width: 320, height: 180 })).project.id as string;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-search-a11y-'));
    const mp4 = path.join(dir, 'colours.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-frames:v', '60', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', mp4]);
    const up = await page.request.post(`${origin}/api/v1/projects/${id}/assets`, { headers: { origin, 'x-filename': 'colours.mp4' }, data: fs.readFileSync(mp4) });
    fs.rmSync(dir, { recursive: true, force: true });
    const assetId = ((await up.json()) as { assetId: string }).assetId;
    await post(`/projects/${id}/transactions`, { ops: [{ op: 'add_clip', args: { assetId, start: { value: '0', timescale: 30 }, duration: { value: '60', timescale: 30 }, withLinkedAudio: false } }] });
    const u = new URL(home);
    u.searchParams.set('project', id);
    await page.goto(u.toString());
    await page.getByTestId('timecode').waitFor({ timeout: 30000 });
    if ((await page.evaluate(() => document.documentElement.lang)) !== ctx.lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => undefined);
    return { id, home };
  })();
  made.set(ctx.page, p);
  return p;
}

/** The media drawer open on the plain view (the rail button toggles it, so it is clicked only when off), the box empty. */
async function drawer(page: Page) {
  if (!/\bis-on\b/.test((await page.getByTestId('rail-media').getAttribute('class')) ?? '')) { await page.getByTestId('rail-media').click(); await settle(page); }
  await page.getByTestId('life-view-all').click().catch(() => undefined);
  await page.getByTestId('media-search').fill('');
  await settle(page);
}
const type = async (page: Page, q: string) => { await page.getByTestId('media-search').fill(q); await settle(page); await page.waitForTimeout(300); };
const clear = async (page: Page) => { await page.getByTestId('media-search').fill('').catch(() => undefined); await settle(page); };

type IndexFixture = { setup: { code: string; detail: string; missingBytes?: number }; files: { scanned: number; stale: number; of: number }; bytes: number; job: { jobId: string; status: string } | null };
const installed: WeakMap<Page, (r: Route) => Promise<void>> = new WeakMap();
async function fixture(page: Page, index: IndexFixture, progress?: { done: number; total: number }) {
  await clean(page);
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET' && /\/projects\/[^/]+\/search\/index$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...index, embedder: null }) });
    if (req.method() === 'GET' && /\/jobs\/job_audit$/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'job_audit', type: 'search-index', status: 'running', stage: null, output: { progress: { unit: 'frames', ...(progress ?? { done: 0, total: 1 }), basis: 'measured' } }, error: null }) });
    return route.fallback();
  };
  installed.set(page, handler);
  await page.route('**/api/v1/**', handler);
}
async function clean(page: Page) { const h = installed.get(page); if (h) { await page.unroute('**/api/v1/**', h).catch(() => undefined); installed.delete(page); } }
const status = (page: Page) => page.getByTestId(ID.status).getAttribute('data-state').catch(() => null);

export const searchA11yScenarios: readonly SearchA11yScenario[] = [
  {
    id: 'search-results',
    async prepare(ctx) {
      await project(ctx);
      await drawer(ctx.page);
      await type(ctx.page, 'colours');
      await ctx.page.getByTestId(ID.row).first().waitFor({ timeout: 8000 }).catch(() => undefined);
      const rows = await ctx.page.getByTestId(ID.row).count();
      const sections = [await ctx.page.getByTestId(ID.sectionExact).count(), await ctx.page.getByTestId(ID.sectionPicture).count()];
      return { shown: rows > 0 && sections[0] === 1 && sections[1] === 1, modal: false, detail: { rows, sections, pictureLine: await status(ctx.page) } };
    },
    leave: async (ctx) => { await clear(ctx.page); },
  },
  {
    id: 'search-nothing-found',
    async prepare(ctx) {
      await project(ctx);
      await drawer(ctx.page);
      await type(ctx.page, 'zzqqxx');
      await ctx.page.getByTestId(ID.empty).first().waitFor({ timeout: 8000 }).catch(() => undefined);
      return { shown: (await ctx.page.locator(`[data-testid="${ID.empty}"][data-section="exact"]`).count()) === 1, modal: false, detail: { rows: await ctx.page.getByTestId(ID.row).count() } };
    },
    leave: async (ctx) => { await clear(ctx.page); },
  },
  {
    id: 'search-picture-not-installed',
    async prepare(ctx) {
      await project(ctx);
      await drawer(ctx.page);
      await fixture(ctx.page, { setup: { code: 'model_missing', detail: 'model files are missing', missingBytes: 1539637736 }, files: { scanned: 0, stale: 0, of: 1 }, bytes: 0, job: null });
      await type(ctx.page, 'colours');
      await ctx.page.getByTestId(ID.status).waitFor({ timeout: 8000 }).catch(() => undefined);
      await ctx.page.waitForFunction((t) => document.querySelector(`[data-testid="${t}"]`)?.getAttribute('data-state') === 'not_installed', ID.status, { timeout: 5000 }).catch(() => undefined);
      const st = await status(ctx.page);
      return { shown: st === 'not_installed' && (await ctx.page.getByTestId(ID.setup).count()) === 1, modal: false, detail: { pictureState: st, fixture: FIXTURE_LABEL } };
    },
    leave: async (ctx) => { await clear(ctx.page); await clean(ctx.page); },
  },
  {
    id: 'search-picture-scanning',
    async prepare(ctx) {
      await project(ctx);
      await drawer(ctx.page);
      await fixture(ctx.page, { setup: { code: 'ready', detail: 'ok' }, files: { scanned: 0, stale: 0, of: 1 }, bytes: 0, job: { jobId: 'job_audit', status: 'running' } }, { done: 12, total: 60 });
      await type(ctx.page, 'colours');
      await ctx.page.waitForFunction((t) => document.querySelector(`[data-testid="${t}"]`)?.getAttribute('data-state') === 'busy', ID.status, { timeout: 5000 }).catch(() => undefined);
      const st = await status(ctx.page);
      return { shown: st === 'busy' && (await ctx.page.getByTestId(ID.scanCancel).count()) === 1, modal: false, detail: { pictureState: st, fixture: FIXTURE_LABEL } };
    },
    leave: async (ctx) => { await clear(ctx.page); await clean(ctx.page); },
  },
  {
    id: 'search-forget-confirm',
    async prepare(ctx) {
      await project(ctx);
      await drawer(ctx.page);
      await fixture(ctx.page, { setup: { code: 'ready', detail: 'ok' }, files: { scanned: 1, stale: 0, of: 1 }, bytes: 2900000, job: null });
      await type(ctx.page, 'colours');
      await ctx.page.getByTestId(ID.forget).waitFor({ timeout: 8000 }).catch(() => undefined);
      await ctx.page.getByTestId(ID.forget).click().catch(() => undefined);
      await ctx.page.getByTestId('footage-forget-dialog').waitFor({ timeout: 5000 }).catch(() => undefined);
      await settle(ctx.page);
      return { shown: (await ctx.page.getByTestId('footage-forget-dialog').count()) === 1, modal: true, detail: { fixture: FIXTURE_LABEL } };
    },
    leave: async (ctx) => {
      await ctx.page.keyboard.press('Escape'); await settle(ctx.page);
      await clear(ctx.page); await clean(ctx.page);
      const m = await project(ctx);
      await ctx.page.goto(m.home); // the page the audit had before this track's scenarios
      await ctx.page.getByTestId('timecode').waitFor({ timeout: 30000 }).catch(() => undefined);
      made.delete(ctx.page);
    },
  },
];
