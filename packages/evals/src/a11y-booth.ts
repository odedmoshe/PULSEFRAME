/**
 * The accessibility audit scenarios of «תא הבדיקה» (wave 8 booth, integration): the first screen («חלק ראשון: n מתוך 14»), the
 * self-check after its light rows answered, a music card, a picture card (drawn, or its «דורש כרטיס מסך» state when this Chromium has
 * no graphics adapter), and the report with its copy button. Each in the language and theme (dark and light) the audit runs it in; each
 * scenario PREPARES the page and says whether the state is shown; a11y-audit.ts runs its full heuristic on it (modal: the dialog).
 *
 * REAL, said exactly: the audit's own server and the owner's own session; the booth's real routes. The cards are reached with «הבא»
 * (no answer is stored, so every run sees the same first screen). Here there is no hardware GPU and no microphone: the picture card is
 * whichever state this browser gives (detail.pictureState says which) and the self-check rows say what this container has. Nobody here
 * can listen or look: the audit looks at how the page says each state.
 */
import type { Page } from 'playwright';
import { BOOTH_TESTIDS as ID } from '../../../apps/web/src/editor/booth/booth.testids.ts';
import { makeSay } from '../../../apps/web/src/editor/booth/booth.strings.ts';

export interface BoothA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface BoothA11yScenario {
  id: string;
  prepare(ctx: BoothA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: BoothA11yCtx): Promise<void>;
}
const sel = (id: string) => `[data-testid="${id}"]`;
const inDialog = (p: Page) => p.evaluate((d) => !!document.activeElement && !!document.querySelector(d)?.contains(document.activeElement), sel(ID.dialog));

async function ensureOpen(ctx: BoothA11yCtx): Promise<void> {
  const { page } = ctx;
  if (await page.locator(sel(ID.dialog)).count()) return;
  await page.locator(sel(ID.rail)).click({ timeout: 8000 });
  await page.locator(sel(ID.dialog)).waitFor({ timeout: 8000 });
  await page.waitForFunction(() => !!document.querySelector('.pf-booth') && !document.querySelector('.pf-booth[data-state=loading]'), undefined, { timeout: 20000 }).catch(() => undefined);
}
async function home(ctx: BoothA11yCtx): Promise<void> {
  await ensureOpen(ctx);
  const back = ctx.page.locator('.pf-booth[data-mode=cards] .pf-booth-bar button').first();
  if (await back.count()) await back.click();
  await ctx.page.locator('.pf-booth[data-mode=home]').waitFor({ timeout: 8000 });
}
/** «התחלה», then «הבא» until a card of `kind` is shown (no answer is stored). */
async function cardOf(ctx: BoothA11yCtx, kind: 'audio' | 'picture'): Promise<string | null> {
  const { page } = ctx;
  await home(ctx);
  await page.locator(sel('booth-start')).click();
  await page.locator(`${sel(ID.card)}, ${sel(ID.windowsStep)}`).first().waitFor({ timeout: 20000 });
  for (let i = 0; i < 20; i++) {
    const c = page.locator(sel(ID.card));
    if ((await c.count()) && (await c.first().getAttribute('data-kind')) === kind) return c.first().getAttribute('data-item');
    await page.locator(sel(ID.next)).click();
    await page.waitForTimeout(120);
    if (await page.locator('.pf-booth[data-mode=home]').count()) return null;
  }
  return null;
}
/** Tab and Shift+Tab inside the open dialog: how many steps left it (a finding when more than 0). */
async function containment(p: Page): Promise<{ startsInside: boolean; tabStepsThatLeftTheDialog: number }> {
  const startsInside = await inDialog(p);
  let left = 0;
  for (let i = 0; i < 20; i++) { await p.keyboard.press('Tab'); if (!(await inDialog(p))) left++; }
  for (let i = 0; i < 6; i++) { await p.keyboard.press('Shift+Tab'); if (!(await inDialog(p))) left++; }
  return { startsInside, tabStepsThatLeftTheDialog: left };
}

export const boothA11yScenarios: BoothA11yScenario[] = [
  {
    id: 'booth-first-screen',
    async prepare(ctx) {
      await home(ctx);
      const say = makeSay(ctx.lang);
      const progress = ((await ctx.page.locator(`.pf-booth[data-mode=home] ${sel(ID.progress)}`).innerText().catch(() => '')) ?? '').trim();
      // the pattern, not 0: an earlier proof run may have stored answers in the audit's data folder (this audit stores none)
      const want = new RegExp(`^${say('booth.firstPart', { done: 999, total: 14 }).replace('999', '\\d+')}$`);
      return { shown: want.test(progress), modal: true, detail: { progress, ...(await containment(ctx.page)) } };
    },
  },
  {
    id: 'booth-self-check',
    async prepare(ctx) {
      await home(ctx);
      const { page } = ctx;
      await page.locator(sel(ID.checkRun)).click();
      await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="booth-check-row"][data-heavy=no]')].some((r) => ['idle', 'running'].includes(r.getAttribute('data-state') ?? '')), undefined, { timeout: 90000 }).catch(() => undefined);
      const rows = await page.locator(sel(ID.checkRow)).evaluateAll((els) => els.map((e) => `${e.getAttribute('data-check')}=${e.getAttribute('data-state')}`));
      const light = rows.filter((r) => !/^(export-gpu|speech|search)=/.test(r));
      return { shown: light.length === 10 && light.every((r) => !/=(idle|running)$/.test(r)), modal: true, detail: { rows: rows.join(' ') } };
    },
  },
  {
    id: 'booth-music-card',
    async prepare(ctx) {
      const item = await cardOf(ctx, 'audio');
      const play = ctx.page.locator(`${sel(ID.card)} ${sel(ID.play)}`);
      const named = item ? ((await play.getAttribute('aria-label').catch(() => '')) ?? '') : '';
      return { shown: !!item && item.startsWith('music:') && named.length > 0, modal: true, detail: { item, playName: named, ...(await containment(ctx.page)) } };
    },
  },
  {
    id: 'booth-picture-card',
    async prepare(ctx) {
      const { page } = ctx;
      const item = await cardOf(ctx, 'picture');
      await page.waitForFunction(() => !document.querySelector('.pf-booth-picture[data-state=loading]'), undefined, { timeout: 20000 }).catch(() => undefined);
      const needsGpu = (await page.locator(`${sel(ID.card)} [data-part=needs-gpu]`).count()) > 0;
      const canvas = page.locator(`${sel(ID.card)} ${sel(ID.pictureCanvas)}`);
      const canvasShown = (await canvas.count()) > 0 && await canvas.first().isVisible().catch(() => false);
      const description = canvasShown ? await canvas.first().evaluate((c) => (c.getAttribute('role') === 'img' ? c.getAttribute('aria-label') ?? '' : '')) : '';
      const pictureState = needsGpu ? 'needs-gpu («דורש כרטיס מסך»)' : ((await page.locator(`${sel(ID.card)} .pf-booth-picture`).getAttribute('data-state').catch(() => null)) ?? 'none');
      // «בסדר» and «לא טוב» are disabled with a reason when only «דלגו» is offered
      const okDisabled = (await page.locator(`${sel(ID.card)} ${sel(ID.answer)}[data-verdict=ok]`).getAttribute('aria-disabled').catch(() => null)) === 'true';
      return { shown: !!item && (needsGpu ? okDisabled : description.length > 0), modal: true, detail: { item, pictureState, canvasDescription: description || null, okDisabledWhenNoGpu: needsGpu ? okDisabled : null, ...(await containment(page)) } };
    },
  },
  {
    id: 'booth-report',
    async prepare(ctx) {
      await home(ctx);
      const { page } = ctx;
      const box = page.locator(sel(ID.reportBox));
      await box.scrollIntoViewIfNeeded().catch(() => undefined);
      const built = (await box.getAttribute('data-built').catch(() => null)) === 'yes';
      const advice = (await page.locator('.pf-booth-report [data-part=note-advice]').count()) === 1;
      await page.locator(sel(ID.reportCopy)).focus();
      return { shown: built && advice, modal: true, detail: { built, adviceAboveCopy: advice, chars: ((await box.inputValue().catch(() => '')) ?? '').length } };
    },
    async leave(ctx) {
      await ctx.page.keyboard.press('Escape');
      await ctx.page.locator(sel(ID.dialog)).waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
      await ctx.page.waitForTimeout(150);
    },
  },
];
