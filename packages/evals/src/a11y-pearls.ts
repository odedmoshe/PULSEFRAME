/**
 * The accessibility audit scenarios of the pearls surfaces (wave 7 pearls track; builder C): the «פנינים» list (empty and with rows),
 * the pearl form open in the source viewer, «מי בקליפ?», and the screen-time table; both languages (a11y-audit.ts runs each scenario in
 * both and in both themes). Each scenario PREPARES the page and says whether the state is shown (and whether it is modal); a11y-audit.ts
 * then runs its full heuristic on it. A state that could not be brought up (the operations of builder A are not merged: no pearl can be
 * made, so no row, no tag, no table) says `shown: false`, which the audit reports as a finding, never as a pass.
 * Synthetic data only: a scratch project of its own with one generated picture (ffmpeg testsrc) and an invented person «אלף».
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { PEARLS_TESTIDS as ID } from '../../../apps/web/src/editor/pearls/pearls.testids.ts';

export interface PearlsA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface PearlsA11yScenario {
  id: string;
  prepare(ctx: PearlsA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: PearlsA11yCtx): Promise<void>;
}

interface Made { id: string; assetId: string; home: string; ranged: boolean }
const made = new WeakMap<Page, Promise<Made>>();
const frame = (n: number) => ({ value: String(n), timescale: 30 });
const settle = (page: Page) => page.waitForTimeout(250);

/** The scratch project of this page, made once: one picture, a person, and (when the operations exist) a pearl and a «מי בקליפ?» tag. */
function project(ctx: PearlsA11yCtx): Promise<Made> {
  const have = made.get(ctx.page);
  if (have) return have;
  const p = (async () => {
    const { page } = ctx;
    const home = page.url();
    const origin = new URL(home).origin;
    const headers = { origin, 'content-type': 'application/json' };
    const post = async (p2: string, data: unknown, soft = false) => { const r = await page.request.post(`${origin}/api/v1${p2}`, { headers, data }); if (!r.ok() && !soft) throw new Error(`${p2} answered ${r.status()}: ${(await r.text()).slice(0, 200)}`); return r.ok() ? ((await r.json()) as any) : null; };
    const id = (await post('/projects', { name: 'pearls-a11y', width: 320, height: 180 })).project.id as string;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pearls-a11y-'));
    const png = path.join(dir, 'p.png');
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180', '-frames:v', '1', png]);
    const up = await page.request.post(`${origin}/api/v1/projects/${id}/assets`, { headers: { origin, 'x-filename': 'p.png' }, data: fs.readFileSync(png) });
    fs.rmSync(dir, { recursive: true, force: true });
    const assetId = ((await up.json()) as { assetId: string }).assetId;
    await post(`/projects/${id}/transactions`, { ops: [{ op: 'add_person', args: { name: 'אלף' } }, { op: 'add_clip', args: { assetId, start: frame(0), duration: frame(60) } }] });
    const doc = (await (await page.request.get(`${origin}/api/v1/projects/${id}`)).json()) as any;
    const personId = Object.keys(doc.project.people ?? {})[0];
    // a pearl and a tag: refused until builder A's operations are merged (soft: the scenarios then say the state is not shown)
    const a = await post(`/projects/${id}/transactions`, { ops: [{ op: 'add_source_range', args: { assetId, kind: 'pearl', label: 'פנינה לבדיקה' } }] }, true);
    const b = personId ? await post(`/projects/${id}/transactions`, { ops: [{ op: 'add_source_range', args: { assetId, kind: 'presence', people: [personId] } }] }, true) : null;
    const u = new URL(home);
    u.searchParams.set('project', id);
    await page.goto(u.toString());
    await page.getByTestId('timecode').waitFor({ timeout: 30000 });
    if ((await page.evaluate(() => document.documentElement.lang)) !== ctx.lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => undefined);
    return { id, assetId, home, ranged: !!a && !!b };
  })();
  made.set(ctx.page, p);
  return p;
}
const openList = async (ctx: PearlsA11yCtx) => {
  await project(ctx);
  await ctx.page.getByTestId('rail-media').click();
  await ctx.page.getByTestId(ID.view).click();
  await ctx.page.waitForFunction((t) => ['list', 'empty', 'not-built', 'refused'].includes(document.querySelector(`[data-testid="${t}"]`)?.getAttribute('data-state') ?? ''), ID.list, { timeout: 15000 }).catch(() => undefined);
};
const goBack = async (ctx: PearlsA11yCtx) => { await ctx.page.keyboard.press('Escape'); await settle(ctx.page); };

export const pearlsA11yScenarios: PearlsA11yScenario[] = [
  {
    id: 'pearls-list-empty',
    async prepare(ctx) {
      const m = await project(ctx);
      if (m.ranged) return { shown: false, modal: false, detail: { why: 'the scratch project already holds pearls' } };
      await openList(ctx);
      const state = await ctx.page.getByTestId(ID.list).getAttribute('data-state').catch(() => null);
      // before A the list says «not built» (501) honestly; with no pearl it says the empty sentence: both are shown states of the list
      return { shown: state === 'empty' || state === 'not-built', modal: false, detail: { state } };
    },
  },
  {
    id: 'pearls-list-rows',
    async prepare(ctx) {
      const m = await project(ctx);
      await openList(ctx);
      const rows = await ctx.page.getByTestId(ID.row).count();
      return { shown: m.ranged && rows > 0, modal: false, detail: { rows, ranged: m.ranged } };
    },
  },
  {
    id: 'pearls-form',
    async prepare(ctx) {
      const m = await project(ctx);
      await ctx.page.getByTestId('rail-media').click();
      await ctx.page.getByTestId(`more-${m.assetId}`).click();
      await ctx.page.getByTestId(`view-${m.assetId}`).click().catch(() => undefined);
      await ctx.page.getByTestId('source-viewer').waitFor({ timeout: 10000 }).catch(() => undefined);
      await ctx.page.getByTestId(ID.save).click().catch(() => undefined);
      await ctx.page.getByTestId(ID.form).waitFor({ timeout: 5000 }).catch(() => undefined);
      await settle(ctx.page);
      return { shown: (await ctx.page.getByTestId(ID.form).count()) === 1, modal: true };
    },
    leave: async (ctx) => { await goBack(ctx); await goBack(ctx); },
  },
  {
    id: 'pearls-who-in-clip',
    async prepare(ctx) {
      const m = await project(ctx);
      await ctx.page.getByTestId('rail-media').click();
      await ctx.page.getByTestId(`more-${m.assetId}`).click();
      await ctx.page.getByTestId(ID.whoInClip).click().catch(() => undefined);
      await ctx.page.getByTestId(ID.whoDialog).waitFor({ timeout: 5000 }).catch(() => undefined);
      await settle(ctx.page);
      return { shown: (await ctx.page.getByTestId(ID.whoDialog).count()) === 1, modal: true };
    },
    leave: async (ctx) => { await goBack(ctx); },
  },
  {
    id: 'pearls-screen-time',
    async prepare(ctx) {
      const m = await project(ctx);
      await ctx.page.getByTestId('rail-deliver').click().catch(() => undefined);
      const tab = ctx.page.locator('[data-testid="workspace-deliver"]');
      await tab.click().catch(() => undefined);
      await ctx.page.getByTestId(ID.screenTime).scrollIntoViewIfNeeded().catch(() => undefined);
      await settle(ctx.page);
      const shown = (await ctx.page.getByTestId(ID.screenTime).count()) === 1 && (await ctx.page.getByTestId(ID.screenTime).getAttribute('data-state')) === 'table';
      return { shown: shown && m.ranged, modal: false };
    },
  },
];
