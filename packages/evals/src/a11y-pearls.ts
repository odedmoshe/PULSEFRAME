/**
 * The accessibility audit scenarios of the pearls surfaces (wave 7 pearls track; builder C): the «פנינים» list (empty and with rows),
 * the pearl form open in the source viewer, «מי בקליפ?», and the screen-time table; both languages (a11y-audit.ts runs each scenario in
 * both and in both themes). Each scenario PREPARES the page and says whether the state is shown (and whether it is modal); a11y-audit.ts
 * then runs its full heuristic on it. A state that could not be brought up (a pearl or a tag refused, so no row and no table) says
 * `shown: false`, which the audit reports as a finding, never as a pass. The empty list is audited first, then the pearl and the tag are made.
 * Synthetic data only: a scratch project of its own with one generated 2-second video (ffmpeg testsrc2) and an invented person «אלף».
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

interface Made { id: string; assetId: string; home: string; personId: string | undefined; post: (p: string, data: unknown, soft?: boolean) => Promise<any> }
const made = new WeakMap<Page, Promise<Made>>();
const rangedOf = new WeakMap<Page, Promise<boolean>>();
const frame = (n: number) => ({ value: String(n), timescale: 30 });
const settle = (page: Page) => page.waitForTimeout(250);

/** The scratch project of this page, made once: one picture and a person, no pearl yet (the empty list is audited first; `ranged` adds them). */
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
    // a 2-second video (the source viewer, where the pearl form lives, opens on a timed file; a photo has no «צפייה»)
    const mp4 = path.join(dir, 'p.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-frames:v', '60', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', mp4]);
    const up = await page.request.post(`${origin}/api/v1/projects/${id}/assets`, { headers: { origin, 'x-filename': 'p.mp4' }, data: fs.readFileSync(mp4) });
    fs.rmSync(dir, { recursive: true, force: true });
    const assetId = ((await up.json()) as { assetId: string }).assetId;
    await post(`/projects/${id}/transactions`, { ops: [{ op: 'add_person', args: { name: 'אלף' } }, { op: 'add_clip', args: { assetId, start: frame(0), duration: frame(60), withLinkedAudio: false } }] });
    const doc = (await (await page.request.get(`${origin}/api/v1/projects/${id}`)).json()) as any;
    const personId = Object.keys(doc.project.people ?? {})[0];
    const u = new URL(home);
    u.searchParams.set('project', id);
    await page.goto(u.toString());
    await page.getByTestId('timecode').waitFor({ timeout: 30000 });
    if ((await page.evaluate(() => document.documentElement.lang)) !== ctx.lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => undefined);
    return { id, assetId, home, personId, post };
  })();
  made.set(ctx.page, p);
  return p;
}
/** A pearl and a «מי בקליפ?» tag in the scratch project, made once by the owner's session (soft: a refusal says the state is not shown). */
function ranged(ctx: PearlsA11yCtx): Promise<boolean> {
  const have = rangedOf.get(ctx.page);
  if (have) return have;
  const p = (async () => {
    const m = await project(ctx);
    const a = await m.post(`/projects/${m.id}/transactions`, { ops: [{ op: 'add_source_range', args: { assetId: m.assetId, kind: 'pearl', label: 'פנינה לבדיקה' } }] }, true);
    const b = m.personId ? await m.post(`/projects/${m.id}/transactions`, { ops: [{ op: 'add_source_range', args: { assetId: m.assetId, kind: 'presence', people: [m.personId] } }] }, true) : null;
    return !!a && !!b;
  })();
  rangedOf.set(ctx.page, p);
  return p;
}
/** The media drawer open (the rail button toggles it, so it is clicked only when off) on a view: the cards ('all') or the pearls list. */
const mediaOn = async (page: Page, view: 'all' | 'pearls') => {
  if (!/\bis-on\b/.test((await page.getByTestId('rail-media').getAttribute('class')) ?? '')) { await page.getByTestId('rail-media').click(); await settle(page); }
  await page.getByTestId(view === 'pearls' ? ID.view : 'life-view-all').click();
  await settle(page);
};
const openList = async (ctx: PearlsA11yCtx) => {
  await project(ctx);
  await mediaOn(ctx.page, 'pearls');
  await ctx.page.waitForFunction((t) => ['list', 'empty', 'not-built', 'refused'].includes(document.querySelector(`[data-testid="${t}"]`)?.getAttribute('data-state') ?? ''), ID.list, { timeout: 15000 }).catch(() => undefined);
};
const goBack = async (ctx: PearlsA11yCtx) => { await ctx.page.keyboard.press('Escape'); await settle(ctx.page); };

export const pearlsA11yScenarios: PearlsA11yScenario[] = [
  {
    id: 'pearls-list-empty',
    async prepare(ctx) {
      if (rangedOf.has(ctx.page)) return { shown: false, modal: false, detail: { why: 'the scratch project already holds pearls' } };
      await openList(ctx);
      const state = await ctx.page.getByTestId(ID.list).getAttribute('data-state').catch(() => null);
      return { shown: state === 'empty', modal: false, detail: { listState: state } };
    },
  },
  {
    id: 'pearls-list-rows',
    async prepare(ctx) {
      const made2 = await ranged(ctx);
      await openList(ctx);
      await ctx.page.getByTestId(ID.row).first().waitFor({ timeout: 10000 }).catch(() => undefined);
      const rows = await ctx.page.getByTestId(ID.row).count();
      return { shown: made2 && rows > 0, modal: false, detail: { rows, ranged: made2 } };
    },
  },
  {
    id: 'pearls-form',
    async prepare(ctx) {
      const m = await project(ctx);
      await mediaOn(ctx.page, 'all');
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
      await mediaOn(ctx.page, 'all');
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
      const m = await ranged(ctx);
      await ctx.page.getByTestId('rail-deliver').click().catch(() => undefined);
      const tab = ctx.page.locator('[data-testid="workspace-deliver"]');
      await tab.click().catch(() => undefined);
      await ctx.page.getByTestId(ID.screenTime).scrollIntoViewIfNeeded().catch(() => undefined);
      await settle(ctx.page);
      const shown = (await ctx.page.getByTestId(ID.screenTime).count()) === 1 && (await ctx.page.getByTestId(ID.screenTime).getAttribute('data-state')) === 'table';
      return { shown: shown && m, modal: false };
    },
  },
];
