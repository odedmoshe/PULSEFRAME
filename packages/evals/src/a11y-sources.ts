/**
 * The accessibility audit scenarios of «מאגר» and Settings › «חיבורים» (wave 8 sources, integration): the tab with its link box and
 * source chips; the results grid with a licence badge and a warning that quotes the licence (a no-derivatives row); the connections
 * section of Settings (modal). a11y-audit.ts runs each in both languages and both themes.
 *
 * No service is contacted: the audit's server has no doubles, so the page's own `GET /api/v1/sources/openverse/search` is answered
 * by a contract-shaped AUDIT FIXTURE through the browser's route hook (labelled in `detail.fixture`): the audit looks at how the
 * interface presents a result, it never claims what a service answers. The hook is removed by `leave`. A detail never uses the key
 * `state`.
 */
import type { Page, Route } from 'playwright';
import { SOURCE_TERMS, type SourcePage } from '@pulseframe/core';
import { SOURCES_TESTIDS as ID } from '../../../apps/web/src/editor/sources/sources.testids.ts';

export interface SourcesA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface SourcesA11yScenario {
  id: string;
  prepare(ctx: SourcesA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: SourcesA11yCtx): Promise<void>;
}
const FIXTURE_LABEL = 'AUDIT FIXTURE: the search answered by the audit through the route hook, not by a service';
const settle = (page: Page) => page.waitForTimeout(250);
const ND_QUOTE = SOURCE_TERMS['cc.nd']!.quote;
const PAGE: SourcePage = {
  provider: 'openverse', page: 1, next: null, total: 1, cached: false, terms: [], remaining: { count: 4, perSeconds: 3600 },
  attribution: { he: 'תוצאות מ־Openverse', en: 'Results from Openverse' },
  rows: [{
    provider: 'openverse', itemId: 'image:audit-1', kind: 'photo', title: 'Audit photo', author: 'Audit author', durationSeconds: null, width: 64, height: 64,
    licence: { id: 'CC-BY-ND-4.0', name: 'CC BY-ND 4.0', url: 'https://creativecommons.org/licenses/by-nd/4.0/', from: 'item' }, flags: { noDerivatives: true, licenceUnconfirmed: true, notShareable: true },
    creditPreview: '"Audit photo" by Audit author is licensed under CC BY-ND 4.0.', pageUrl: null, preview: null, thumb: null, renditions: [],
    warnings: [{ code: 'licence_no_derivatives', title: 'Audit photo', licenceId: 'CC-BY-ND-4.0', licenceName: 'CC BY-ND 4.0', termIds: ['cc.nd'], message: `"Audit photo": the licence says in its own words: "${ND_QUOTE}"` }],
  }],
};
const hooks = new WeakMap<Page, (r: Route) => Promise<void>>();
async function unhook(page: Page) { const h = hooks.get(page); if (h) { await page.unroute('**/api/v1/sources/openverse/search**', h).catch(() => undefined); hooks.delete(page); } }

/** The media drawer open on «מאגר». */
async function sourcesTab(page: Page): Promise<boolean> {
  if (!/\bis-on\b/.test((await page.getByTestId('rail-media').getAttribute('class').catch(() => '')) ?? '')) { await page.getByTestId('rail-media').click().catch(() => undefined); await settle(page); }
  await page.getByTestId(ID.tabSources).click().catch(() => undefined);
  return page.getByTestId(ID.panel).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
}
async function mineTab(page: Page) { await page.getByTestId(ID.tabMine).click().catch(() => undefined); await settle(page); }

export const sourcesA11yScenarios: readonly SourcesA11yScenario[] = [
  {
    id: 'sources-tab',
    async prepare({ page }) {
      const shown = await sourcesTab(page);
      return { shown: shown && (await page.getByTestId(ID.linkInput).count()) === 1 && (await page.getByTestId(ID.chip('openverse')).count()) === 1, modal: false, detail: { chips: await page.locator('[data-testid^="sources-chip-"]').count() } };
    },
    leave: async ({ page }) => { await mineTab(page); },
  },
  {
    id: 'sources-results',
    async prepare({ page }) {
      await unhook(page);
      const handler = async (route: Route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PAGE) });
      hooks.set(page, handler);
      await page.route('**/api/v1/sources/openverse/search**', handler);
      const shown = await sourcesTab(page);
      await page.getByTestId(ID.search).fill('audit');
      await page.getByTestId(ID.search).press('Enter');
      const row = await page.getByTestId(ID.row('openverse', 'image:audit-1')).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      const quoted = (await page.getByTestId(ID.panel).textContent().catch(() => '')) ?? '';
      return { shown: shown && row && (await page.getByTestId(ID.badge('image:audit-1')).count()) === 1, modal: false, detail: { quotesDeed: quoted.includes(ND_QUOTE), fixture: FIXTURE_LABEL } };
    },
    leave: async ({ page }) => { await page.getByTestId(ID.search).fill('').catch(() => undefined); await unhook(page); await mineTab(page); },
  },
  {
    id: 'sources-connections',
    async prepare({ page }) {
      await page.getByTestId('rail-settings').click().catch(() => undefined);
      const shown = await page.getByTestId(ID.connections).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      await page.getByTestId(ID.connections).scrollIntoViewIfNeeded().catch(() => undefined);
      await settle(page);
      return { shown: shown && (await page.getByTestId(ID.card('pixabay')).count()) === 1, modal: true, detail: { cards: await page.locator('[data-testid^="connect-card-"]').count() } };
    },
    leave: async ({ page }) => { await page.keyboard.press('Escape').catch(() => undefined); await settle(page); },
  },
];
