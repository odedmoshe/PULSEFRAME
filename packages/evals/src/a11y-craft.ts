/**
 * The accessibility audit scenarios of the craft surfaces (wave 7 craft; W3): the time field open, the paste dialog, the find panel
 * with matches, the versions compare. Each scenario PREPARES the page and says whether the state is shown (and whether it is modal);
 * a11y-audit.ts then runs its full heuristic on it in Hebrew and English, as for the other transient states. A state that could not be
 * brought up says `shown: false` (a finding), never a pass.
 * The surfaces need clips with text, a find with matches and two versions, so a scenario works on a small project of its own (three
 * Hebrew titles, made through the owner's own session in the page, no media) and returns the page to where it was when the last
 * scenario is left.
 */
import type { Page } from 'playwright';

export interface CraftA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface CraftA11yScenario {
  id: string;
  prepare(ctx: CraftA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: CraftA11yCtx): Promise<void>;
}

interface Made { id: string; titles: string[]; home: string }
const made = new WeakMap<Page, Promise<Made>>();
const frame = (n: number) => ({ value: String(n), timescale: 30 });

/** The scratch project of this page, made once: three titles («נעה» in two of them), opened in the editor in the audit's language. */
function project(ctx: CraftA11yCtx): Promise<Made> {
  const have = made.get(ctx.page);
  if (have) return have;
  const p = (async () => {
    const { page } = ctx;
    const home = page.url();
    const origin = new URL(home).origin;
    const headers = { origin, 'content-type': 'application/json' };
    const post = async (path: string, data: unknown) => { const r = await page.request.post(`${origin}/api/v1${path}`, { headers, data }); if (!r.ok()) throw new Error(`${path} answered ${r.status()}: ${(await r.text()).slice(0, 200)}`); return (await r.json()) as any; };
    const id = (await post('/projects', { name: 'craft-a11y', width: 320, height: 180 })).project.id as string;
    const titles: string[] = [];
    for (const [i, text] of ['שלום נעה', 'נעה והילדים', 'סוף'].entries()) titles.push((await post(`/projects/${id}/transactions`, { ops: [{ op: 'add_text', args: { text, start: frame(i * 40), duration: frame(30) } }] })).results[0].output.clipId as string);
    const u = new URL(home);
    u.searchParams.set('project', id);
    await page.goto(u.toString());
    await page.getByTestId('timecode').waitFor({ timeout: 30000 });
    if ((await page.evaluate(() => document.documentElement.lang)) !== ctx.lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => undefined);
    await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 3, undefined, { timeout: 15000 }).catch(() => undefined);
    return { id, titles, home };
  })();
  made.set(ctx.page, p);
  return p;
}
const key = (page: Page, code: string, mods: { ctrl?: boolean; alt?: boolean } = {}) => page.evaluate(({ code, mods }) => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { code, key: code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, bubbles: true, cancelable: true })); }, { code, mods });
const settle = (page: Page) => page.waitForTimeout(200);

const scenarios: CraftA11yScenario[] = [
  {
    id: 'craft-time-field',
    async prepare(ctx) {
      await project(ctx);
      await ctx.page.getByTestId('timecode').click();
      await ctx.page.getByTestId('craft-time-input').waitFor({ timeout: 5000 }).catch(() => undefined);
      await ctx.page.getByTestId('craft-time-input').fill('1:10').catch(() => undefined);
      await settle(ctx.page);
      const shown = (await ctx.page.getByTestId('craft-time-entry').count()) === 1 && (await ctx.page.getByTestId('craft-time-line').getAttribute('data-kind').catch(() => null)) === 'ok';
      return { shown, modal: false };
    },
    async leave(ctx) { await ctx.page.keyboard.press('Escape'); await ctx.page.getByTestId('craft-time-entry').waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined); },
  },
  {
    id: 'craft-paste-dialog',
    async prepare(ctx) {
      const m = await project(ctx);
      const { page } = ctx;
      await page.locator(`.clip[data-clip-id="${m.titles[0]}"]`).click({ position: { x: 4, y: 4 } });
      await key(page, 'KeyC', { ctrl: true });
      await page.locator(`.clip[data-clip-id="${m.titles[1]}"]`).click({ position: { x: 4, y: 4 } });
      await page.locator(`.clip[data-clip-id="${m.titles[2]}"]`).click({ position: { x: 4, y: 4 }, modifiers: ['Shift'] });
      await key(page, 'KeyV', { ctrl: true, alt: true });
      await page.getByTestId('craft-paste-dialog').waitFor({ timeout: 5000 }).catch(() => undefined);
      await settle(page);
      const groups = await page.locator('[data-testid^=craft-paste-group-]').count();
      return { shown: (await page.getByTestId('craft-paste-dialog').count()) === 1 && groups === 6, modal: true, detail: { groups } };
    },
    async leave(ctx) { await ctx.page.keyboard.press('Escape'); await ctx.page.getByTestId('craft-paste-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined); },
  },
  {
    id: 'craft-find-panel',
    async prepare(ctx) {
      await project(ctx);
      const { page } = ctx;
      await key(page, 'KeyF', { ctrl: true });
      await page.getByTestId('craft-find-input').waitFor({ timeout: 5000 }).catch(() => undefined);
      await page.getByTestId('craft-find-input').fill('נעה').catch(() => undefined);
      await page.getByTestId('craft-replace-input').fill('נועה').catch(() => undefined);
      await page.getByTestId('craft-find-row-0').waitFor({ timeout: 8000 }).catch(() => undefined);
      await settle(page);
      const rows = await page.locator('[data-testid^=craft-find-row-]').count();
      return { shown: (await page.getByTestId('craft-find-panel').count()) === 1 && rows >= 2, modal: false, detail: { rows } };
    },
    async leave(ctx) { await ctx.page.keyboard.press('Escape'); await ctx.page.getByTestId('craft-find-panel').waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined); },
  },
  {
    id: 'craft-versions-compare',
    async prepare(ctx) {
      const m = await project(ctx);
      const { page } = ctx;
      const origin = new URL(page.url()).origin;
      const headers = { origin, 'content-type': 'application/json' };
      await page.request.post(`${origin}/api/v1/projects/${m.id}/versions`, { headers, data: { name: ctx.lang === 'he' ? 'לפני' : 'Before' } });
      await page.request.post(`${origin}/api/v1/projects/${m.id}/transactions`, { headers, data: { ops: [{ op: 'update_text', args: { clipId: m.titles[2], text: ctx.lang === 'he' ? 'סוף טוב' : 'The end' } }] } });
      await page.getByTestId('craft-versions-open').click();
      await page.getByTestId('craft-version-row-0').waitFor({ timeout: 8000 }).catch(() => undefined);
      await page.getByTestId('craft-version-row-0').getByTestId('craft-version-compare').click().catch(() => undefined);
      await page.getByTestId('craft-version-diff').waitFor({ timeout: 15000 }).catch(() => undefined);
      await page.getByTestId('craft-version-wipe').waitFor({ timeout: 30000 }).catch(() => undefined);
      await settle(page);
      const diff = await page.getByTestId('craft-version-diff').count(), wipe = await page.getByTestId('craft-version-wipe').count();
      return { shown: diff === 1 && wipe === 1, modal: true, detail: { diff, wipe } };
    },
    async leave(ctx) {
      await ctx.page.keyboard.press('Escape');
      await ctx.page.getByTestId('craft-versions-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
      // back to the page the audit was on, in its language
      const m = await project(ctx);
      await ctx.page.goto(m.home);
      await ctx.page.getByTestId('timecode').waitFor({ timeout: 30000 }).catch(() => undefined);
      if ((await ctx.page.evaluate(() => document.documentElement.lang)) !== ctx.lang) await ctx.page.locator('[data-testid=lang-toggle]').click().catch(() => undefined);
      made.delete(ctx.page);
    },
  },
];
export const craftA11yScenarios: CraftA11yScenario[] = scenarios;
