/**
 * The accessibility audit scenarios of «מפת טיול» (wave 8 tripmap, integration): the dialog with two stops from the place list
 * (`trip-map-dialog`) and the picker opened by an unlisted name (`trip-map-picker`). Each scenario PREPARES the page from the Text
 * rail's «מפת טיול חדשה» on its own synthetic project (no media) and says whether the state is shown and modal; a11y-audit.ts runs
 * its full heuristic on it. The dialog scenario also records whether focus starts inside and how many of 25 Tab and 6 Shift+Tab
 * steps left it. Nothing here says how the map looks.
 */
import type { Page } from 'playwright';
import { TRIPMAP_TESTIDS as TID } from '../../../apps/web/src/editor/tripMap/tripMap.testids.ts';

export interface TripmapA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface TripmapA11yScenario {
  id: string;
  prepare(ctx: TripmapA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: TripmapA11yCtx): Promise<void>;
}

const made = new Map<string, string>();
async function projectOn(page: Page): Promise<{ origin: string; pid: string }> {
  const origin = new URL(page.url()).origin;
  let pid = made.get(origin);
  if (!pid) {
    const r = await page.context().request.fetch(`${origin}/api/v1/projects`, { method: 'POST', data: { name: 'a11y-tripmap', width: 1280, height: 720 }, headers: { 'content-type': 'application/json' } });
    pid = ((await r.json()) as { project: { id: string } }).project.id;
    made.set(origin, pid);
  }
  return { origin, pid };
}

/** Opens the editor on the scenario's project, the Text rail, «מפת טיול חדשה», and adds two listed places by typing and Enter. */
async function openDialog(ctx: TripmapA11yCtx): Promise<boolean> {
  const { page, lang } = ctx;
  const { origin, pid } = await projectOn(page);
  await page.goto(`${origin}/?project=${pid}`);
  await page.getByTestId('timecode').waitFor();
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
  await page.getByTestId('rail-text').click();
  const entry = page.getByTestId(TID.newButton);
  if (!(await entry.count())) return false;
  await entry.click();
  await page.getByTestId(TID.dialog).waitFor({ timeout: 10000 });
  for (const name of ['ירושלים', 'חיפה']) {
    await page.getByTestId(TID.search).fill(name);
    await page.getByTestId(TID.suggestion).first().waitFor({ timeout: 5000 }).catch(() => {});
    await page.getByTestId(TID.search).press('Enter');
  }
  return (await page.getByTestId(TID.stopRow).count()) === 2;
}
const inside = (page: Page) => page.evaluate((id) => !!document.activeElement && !!document.querySelector(`[data-testid=${id}]`)?.contains(document.activeElement), TID.dialog);
async function closeAll(page: Page): Promise<void> {
  for (let i = 0; i < 3 && (await page.getByTestId(TID.dialog).count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
}

export const tripmapA11yScenarios: readonly TripmapA11yScenario[] = [
  {
    id: 'trip-map-dialog',
    async prepare(ctx) {
      const ok = await openDialog(ctx);
      const { page } = ctx;
      await page.getByTestId(TID.search).focus();
      const startsInside = await inside(page);
      let escaped = 0;
      for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); if (!(await inside(page))) escaped++; }
      for (let i = 0; i < 6; i++) { await page.keyboard.press('Shift+Tab'); if (!(await inside(page))) escaped++; }
      await page.getByTestId(TID.search).focus();
      return { shown: ok && (await page.getByTestId(TID.dialog).count()) === 1, modal: true, detail: { stops: await page.getByTestId(TID.stopRow).count(), startsInside, tabStepsThatLeftTheDialog: escaped } };
    },
    async leave({ page }) { await closeAll(page); },
  },
  {
    id: 'trip-map-picker',
    async prepare(ctx) {
      const ok = await openDialog(ctx);
      const { page } = ctx;
      // an unlisted name: Enter opens the picker, which takes the keyboard focus
      await page.getByTestId(TID.search).fill('פטרה');
      await page.getByTestId(TID.notInList).waitFor({ timeout: 5000 }).catch(() => {});
      await page.getByTestId(TID.search).press('Enter');
      const shown = await page.getByTestId(TID.picker).waitFor({ timeout: 5000 }).then(() => true, () => false);
      await page.waitForTimeout(300); // the picker's map is drawn by drawGraph after the outline chunk loads
      const focused = await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, TID.picker);
      return { shown: ok && shown, modal: true, detail: { pickerHasFocus: focused, note: (await page.getByTestId(`${TID.picker}-note`).allInnerTexts()).join(' | ') || null } };
    },
    async leave({ page }) { await closeAll(page); },
  },
];
