/**
 * The accessibility audit scenarios of the fast export and the render cache (ADR-0024), for the lead to register in a11y-audit.ts
 * once RenderCacheLane and ExportReuseLine are mounted (Timeline.tsx, ExportSheet.tsx): the sheet line in each of its states, the
 * lane with stale stretches, the lane's popover open. Each scenario PREPARES the page and says whether the state is shown; the
 * audit's own `auditState(id, { shown })` then runs the full heuristic (names, contrast, tab semantics, focus rings) on it in
 * Hebrew and English, exactly as for the other transient states.
 *
 *   for (const sc of renderCacheA11yScenarios) { const r = await sc.prepare(ctx); await auditState(sc.id, { shown: r.shown, ...r.detail }); await sc.leave?.(ctx); }
 *
 * `ctx` comes from makeRenderCacheCtx (REST only: it fills or clears the cache with real exports and edits the title with an op).
 * `runRenderCacheUiChecks` is the proof's own, lighter use (incremental-export-proof.ts I18): it also takes the 1440 px screenshots
 * and counts the findings it can decide alone (unnamed controls inside the two components, one tab stop in the lane, a live
 * region). It reports `mounted: false` with the reason, never a pass, when the components are not in the build.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import type { SegmentPlanView } from '@pulseframe/core';
import { RENDER_CACHE_TESTIDS as TID } from '../../../apps/web/src/editor/renderCache.testids.ts';
import { renderCacheStrings } from '../../../apps/web/src/editor/renderCache.strings.ts';
import type { Api } from './incremental-fixtures.ts';

export type Lang = 'he' | 'en';
export interface RenderCacheCtx {
  page: Page; lang: Lang; api: Api; owner: Api; pid: string; titleClipId: string;
  /** Exports with the fast export so the cache holds the whole project, waiting for the job. */
  fillCache(): Promise<void>;
  clearCache(): Promise<void>;
  /** An op that changes the title's text: its two segments become stale. */
  editTitle(text: string): Promise<void>;
}
export function makeRenderCacheCtx(o: { page: Page; lang: Lang; api: Api; owner: Api; pid: string; titleClipId: string }): RenderCacheCtx {
  return {
    ...o,
    async fillCache() { const r = await o.api.call(`/projects/${o.pid}/exports`, { format: 'mp4-h264-aac', mode: 'incremental' } /* the sheet's first pick (high quality): its line and the lane plan with it */); await o.api.waitJob(r.body.jobId); },
    async clearCache() { await o.owner.call('/storage/render-cache', undefined, 'DELETE'); },
    async editTitle(text) { await o.api.tx(o.pid, [{ op: 'update_text', args: { clipId: o.titleClipId, text } }]); },
  };
}

export interface ScenarioResult { shown: boolean; detail?: Record<string, unknown> }
export interface RenderCacheScenario { id: string; describe: string; prepare(ctx: RenderCacheCtx): Promise<ScenarioResult>; leave?(ctx: RenderCacheCtx): Promise<void> }

const settle = (page: Page, ms = 1800) => page.waitForTimeout(ms); // the lane re-plans 1.5 s after the last change
async function openSheet(page: Page) {
  if (await page.getByTestId('export-sheet').count()) return;
  await page.getByTestId('export').click();
  await page.getByTestId('export-sheet').waitFor({ timeout: 15000 });
}
async function closeSheet(page: Page) { if (await page.getByTestId('export-sheet').count()) { await page.keyboard.press('Escape'); await page.getByTestId('export-sheet').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {}); } }
async function fastOn(page: Page) {
  const sw = page.getByTestId(TID.fastSwitch);
  await sw.waitFor({ timeout: 10000 });
  if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click();
}
const lineState = (page: Page) => page.getByTestId(TID.reuseLine).getAttribute('data-state').catch(() => null);

export const renderCacheA11yScenarios: RenderCacheScenario[] = [
  {
    id: 'cache-sheet-first', describe: 'the export sheet with the fast export on and nothing stored yet: «ייצוא ראשון: כל N המקטעים ירונדרו…»',
    async prepare(c) { await c.clearCache(); await openSheet(c.page); await fastOn(c.page); await c.page.waitForFunction((id) => document.querySelector(`[data-testid=${id}]`)?.getAttribute('data-state') === 'first', TID.reuseLine, { timeout: 20000 }).catch(() => {}); return { shown: (await lineState(c.page)) === 'first' && (await c.page.getByTestId(TID.reuseLine).getAttribute('aria-live')) === 'polite' }; },
    leave: (c) => closeSheet(c.page),
  },
  {
    id: 'cache-sheet-ready', describe: 'the sheet line after a title edit: the reuse line, what is rendered, the honest notes',
    async prepare(c) { await c.fillCache(); await c.editTitle(`כותרת ${c.lang} ${Date.now() % 1000}`); await openSheet(c.page); await fastOn(c.page); await c.page.waitForFunction((id) => document.querySelector(`[data-testid=${id}]`)?.getAttribute('data-state') === 'ready', TID.reuseLine, { timeout: 20000 }).catch(() => {}); return { shown: (await lineState(c.page)) === 'ready' && (await c.page.getByTestId(TID.note).count()) === 2 && (await c.page.getByTestId(TID.renderLine).count()) === 1 }; },
    leave: (c) => closeSheet(c.page),
  },
  {
    id: 'cache-sheet-nothing', describe: 'the sheet line when nothing in the picture changed',
    async prepare(c) { await c.fillCache(); await openSheet(c.page); await fastOn(c.page); await c.page.waitForFunction((id) => document.querySelector(`[data-testid=${id}]`)?.getAttribute('data-state') === 'nothing', TID.reuseLine, { timeout: 20000 }).catch(() => {}); return { shown: (await lineState(c.page)) === 'nothing' }; },
    leave: (c) => closeSheet(c.page),
  },
  {
    id: 'cache-sheet-disabled', describe: 'the switch disabled with its visible reason (a format the fast export cannot make)',
    async prepare(c) { await openSheet(c.page); const fmt = c.page.getByTestId('export-type-webm'); /* the sheet's file type WebM (the export-format cards are the formats of the project, not file types) */ if (await fmt.count()) await fmt.click(); await c.page.getByTestId(TID.fastReason).waitFor({ timeout: 8000 }).catch(() => {}); return { shown: (await c.page.getByTestId(TID.fastReason).count()) === 1, detail: { reason: await c.page.getByTestId(TID.fastReason).textContent().catch(() => null) } }; },
    leave: async (c) => { const mp4 = c.page.getByTestId('export-type-mp4'); if (await mp4.count()) await mp4.click(); await closeSheet(c.page); },
  },
  {
    id: 'cache-lane-stale', describe: 'the timeline lane with a stale stretch (dashed amber) and the one focusable summary',
    async prepare(c) { await closeSheet(c.page); await c.fillCache(); await c.editTitle(`כותרת ${c.lang} ${Date.now() % 1000}`); await settle(c.page, 3500); const lane = c.page.getByTestId(TID.lane); await lane.waitFor({ timeout: 20000 }).catch(() => {}); return { shown: (await lane.count()) === 1 && (await c.page.locator(`[data-testid=${TID.stretch}][data-state=render]`).count()) >= 1 && (await c.page.getByTestId(TID.summary).count()) === 1, detail: { stretches: await c.page.getByTestId(TID.stretch).count() } }; },
  },
  {
    id: 'cache-lane-popover', describe: 'the lane\'s popover open: the stale stretches with «קפיצה»',
    async prepare(c) { await c.page.getByTestId(TID.summary).click(); await c.page.getByTestId(TID.popover).waitFor({ timeout: 5000 }).catch(() => {}); return { shown: (await c.page.getByTestId(TID.popover).count()) === 1 && (await c.page.getByTestId(TID.jump).count()) >= 1 }; },
    leave: async (c) => { await c.page.keyboard.press('Escape'); },
  },
];

/** Runs in the page: what a script can decide about the two components alone. */
function inspectInPage(ids: { lane: string; summary: string; reuseLine: string }) {
  const nameOf = (el: Element): string => {
    const h = el as HTMLElement;
    const lb = h.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (t) return t; }
    return (h.getAttribute('aria-label') ?? h.textContent ?? h.getAttribute('title') ?? '').trim();
  };
  const scope = [document.querySelector(`[data-testid=${ids.lane}]`), document.querySelector(`[data-testid=${ids.reuseLine}]`)?.closest('.rc-export')].filter(Boolean) as Element[];
  const controls = scope.flatMap((r) => [...r.querySelectorAll('button, [role=switch], a[href], input, [tabindex]')]);
  const unnamed = controls.filter((c) => !nameOf(c)).map((c) => (c as HTMLElement).dataset.testid ?? c.tagName.toLowerCase());
  const laneEl = document.querySelector(`[data-testid=${ids.lane}]`);
  const tabStopsInLane = laneEl ? [...laneEl.querySelectorAll('button, [tabindex]:not([tabindex="-1"])')].length : 0;
  const status = document.querySelector(`[data-testid=${ids.reuseLine}]`);
  return { unnamed, tabStopsInLane, statusRole: status?.getAttribute('role') ?? null, statusLive: status?.getAttribute('aria-live') ?? null, laneDir: laneEl?.querySelector('.rc-lane')?.getAttribute('dir') ?? null };
}

export interface UiChecksResult { lang: Lang; mounted: boolean; ok: boolean; reason?: string; [k: string]: unknown }
export async function runRenderCacheUiChecks(o: { browser: Browser; ownerUrl: string; pid: string; lang: Lang; plan: SegmentPlanView; expectedStale: number[]; shotDir: string }): Promise<UiChecksResult> {
  const S = renderCacheStrings(o.lang);
  const ctx = await o.browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pf.fastExport', '1'); } catch { /* storage unavailable */ } });
  await ctx.addInitScript('globalThis.__name = (f) => f'); // tsx/esbuild helper referenced by functions passed to page.evaluate (as a11y-audit.ts does)
  const page = await ctx.newPage();
  try {
    await page.goto(`${o.ownerUrl}&project=${o.pid}`);
    await page.getByTestId('timecode').waitFor({ timeout: 30000 });
    if ((await page.evaluate(() => document.documentElement.lang)) !== o.lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
    const lane = page.getByTestId(TID.lane);
    await lane.waitFor({ timeout: 25000 }).catch(() => {});
    if ((await lane.count()) === 0) return { lang: o.lang, mounted: false, ok: false, reason: `no [data-testid=${TID.lane}] in the editor (RenderCacheLane is not mounted in Timeline.tsx, or the plan never became ready)` };
    // the lane exists (aria-busy, no stretches) while its first plan is asked for: it is read once the summary is there and the
    // lane is no longer busy (run 5: the Hebrew context, the first to ask, was counted while busy; English, served the memoised
    // keys, was ready at once)
    await page.waitForFunction((ids) => { const l = document.querySelector(`[data-testid=${ids.lane}]`); return !!l && !l.getAttribute('aria-busy') && !!l.querySelector(`[data-testid=${ids.summary}]`); }, { lane: TID.lane, summary: TID.summary }, { timeout: 30000 }).catch(() => {});
    const sum = o.plan.segments;
    const stretch = page.locator(`[data-testid=${TID.stretch}][data-state=render]`);
    const staleRuns = o.plan.runs.filter((r) => r.state === 'render');
    // the stale stretch the proof typed (expectedStale: the segment numbers of the edited title), not only what the plan says
    const typedOk = staleRuns.length === 1 && staleRuns[0]!.firstSegment === o.expectedStale[0] && staleRuns[0]!.segments === o.expectedStale.length;
    const laneOk = typedOk && (await stretch.count()) === staleRuns.length && (await stretch.first().getAttribute('data-first-frame')) === String(o.plan.firstFrame + (staleRuns[0]?.firstFrame ?? -1)) && (await stretch.first().getAttribute('data-frames')) === String(staleRuns[0]?.frames);
    const label = await page.getByTestId(TID.summary).getAttribute('aria-label');
    const labelOk = label === S.laneSummary(sum.cached, sum.total);
    fs.mkdirSync(o.shotDir, { recursive: true });
    await lane.screenshot({ path: path.join(o.shotDir, `incremental-export-lane-${o.lang}.png`) });
    await page.getByTestId(TID.summary).click();
    await page.getByTestId(TID.popover).waitFor({ timeout: 5000 }).catch(() => {});
    const stale = await page.getByTestId(TID.stale).count();
    const staleFirst = await page.getByTestId(TID.stale).first().getAttribute('data-first-frame').catch(() => null);
    const popoverOk = stale === staleRuns.length && staleFirst === String(o.plan.firstFrame + (staleRuns[0]?.firstFrame ?? -1)) && (await page.getByTestId(TID.jump).count()) === stale;
    await page.screenshot({ path: path.join(o.shotDir, `incremental-export-lane-popover-${o.lang}.png`), clip: { x: 0, y: 0, width: 1440, height: 900 } });
    await page.keyboard.press('Escape');
    // the sheet line
    await page.getByTestId('export').click();
    await page.getByTestId('export-sheet').waitFor({ timeout: 15000 });
    const line = page.getByTestId(TID.reuseLine);
    await line.waitFor({ timeout: 15000 }).catch(() => {});
    if ((await line.count()) === 0) return { lang: o.lang, mounted: false, ok: false, reason: `no [data-testid=${TID.reuseLine}] in the export sheet (ExportReuseLine is not mounted in ExportSheet.tsx)` };
    await page.waitForFunction((id) => document.querySelector(`[data-testid=${id}]`)?.getAttribute('data-state') === 'ready', TID.reuseLine, { timeout: 20000 }).catch(() => {});
    const text = ((await line.textContent()) ?? '').replace(/\s+/g, ' ');
    const secs = Math.max(1, Math.round((o.plan.framesToRender * 1) / 30));
    const lineOk = (await line.getAttribute('data-state')) === 'ready' && text.includes(S.reuseLine(sum.cached, sum.total)) && text.includes(S.renderLine(sum.render, secs));
    await line.screenshot({ path: path.join(o.shotDir, `incremental-export-sheet-${o.lang}.png`) });
    await page.getByTestId('export-sheet').screenshot({ path: path.join(o.shotDir, `incremental-export-sheet-full-${o.lang}.png`) });
    const found = await page.evaluate(inspectInPage, { lane: TID.lane, summary: TID.summary, reuseLine: TID.reuseLine });
    const a11yOk = found.unnamed.length === 0 && found.tabStopsInLane === 1 && found.statusRole === 'status' && found.statusLive === 'polite' && found.laneDir === 'ltr';
    return { lang: o.lang, mounted: true, ok: laneOk && labelOk && popoverOk && lineOk && a11yOk, laneOk, typedOk, staleRuns, laneDrawn: { renderStretches: await page.locator(`[data-testid=${TID.stretch}][data-state=render]`).count() }, labelOk, label, popoverOk, staleItems: stale, lineOk, lineText: text, a11y: found, viewport: '1440x900', dir: await page.evaluate(() => document.documentElement.dir) };
  } finally { await ctx.close(); }
}

