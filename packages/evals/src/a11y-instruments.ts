/**
 * The accessibility audit scenarios of «כלים מוקלטים» (wave 7 instruments, integration): the «צליל» radiogroup of the calm music row
 * in its states — library not set (the audit server's own state: it has no library folder), not calibrated, ready with its duties, the
 * blind pair open, and a recorded add refused in words. Each in the language and theme (dark and light) the audit runs it in; each
 * scenario PREPARES the page and says whether the state is shown; a11y-audit.ts runs its full heuristic on it.
 *
 * STAND-IN, said in each scenario's detail: the audit server has no library folder, so «not calibrated» and «ready» are the kits route
 * answered in the browser with the CONTRACT's shape (core MusicKitStatus), two SYNTHETIC sources (CC BY, CC BY-NC); the pair's previews
 * are a short synthetic tone WAV written by code with the two headers. The refusal is the REAL server's answer to the recorded add
 * (409 instruments_library_not_set): nothing is added. Nobody here can listen; the audit looks at how the page says each state.
 */
import type { Page } from 'playwright';
import { INSTRUMENTS_TESTIDS as ID } from '../../../apps/web/src/editor/instruments/instruments.testids.ts';
import { synthWav } from '../../fixtures/src/instruments.ts';

export interface InstrumentsA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface InstrumentsA11yScenario {
  id: string;
  prepare(ctx: InstrumentsA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: InstrumentsA11yCtx): Promise<void>;
}
const UNHEARD = { he: 'כלים מוקלטים — עוד לא הושמעו לאף אחד', en: 'Recorded instruments — nobody has listened yet' };
const PARTS = [{ part: 'pad', instrument: 'strings', title: { he: 'מיתרים', en: 'Strings' } }, { part: 'arp', instrument: 'piano', title: { he: 'פסנתר', en: 'Piano' } }];
const SOURCES = [
  { sourceId: 'synthetic-by', title: 'Synthetic tones (CC BY test source)', licenceId: 'CC-BY-4.0', credit: true, nonCommercial: false, shareable: true },
  { sourceId: 'synthetic-nc', title: 'Synthetic tones (CC BY-NC test source)', licenceId: 'CC-BY-NC-4.0', credit: true, nonCommercial: true, shareable: false },
];
/** The contract's shape (core MusicKitStatus), written here. */
const kit = (state: 'ready' | 'not_calibrated') => ({
  kitId: 'kit.calm.vsco', version: 1, styleId: 'music.calm', state, reason: state === 'ready' ? null : 'instruments_kit_not_ready',
  parts: PARTS, sources: state === 'ready' ? SOURCES : [], label: UNHEARD, heard: null,
});
const TONE = synthWav({ rate: 8000, channels: 1, bits: 16, frames: 8000, freq: 220, amp: 0.3 });
const row = (p: Page) => p.locator('[data-testid=music-row][data-style-id="music.calm"]');

async function openRow(ctx: InstrumentsA11yCtx, standIn?: 'ready' | 'not_calibrated'): Promise<void> {
  const { page, lang } = ctx;
  if (standIn) await page.route('**/api/v1/music/kits', (r) => r.fulfill({ json: { kits: [kit(standIn)] } }));
  if (standIn === 'ready') {
    await page.route('**/api/v1/music/music.calm/audio**', (r) => {
      const recorded = new URL(r.request().url()).searchParams.get('instruments') === 'recorded';
      return r.fulfill({ status: 200, headers: { 'content-type': 'audio/wav', 'x-pf-instruments': recorded ? 'recorded' : 'synth', 'x-pf-level-scale': recorded ? '0.5' : '1' }, body: TONE });
    });
  }
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/?project=${ctx.pid}`);
  await page.getByTestId('timecode').waitFor();
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
  await page.getByTestId('rail-audio').click();
  await page.getByTestId('music-tab').click({ timeout: 8000 });
  await row(page).getByTestId(ID.state).waitFor({ timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid=instruments-state][data-state=checking]'), undefined, { timeout: 8000 }).catch(() => undefined);
  await row(page).locator(`[data-testid=${ID.choiceOption}][data-choice=recorded]`).click();
}
async function unroute(ctx: InstrumentsA11yCtx) {
  await ctx.page.unroute('**/api/v1/music/kits').catch(() => {});
  await ctx.page.unroute('**/api/v1/music/music.calm/audio**').catch(() => {});
}
const stateOf = (p: Page) => row(p).getByTestId(ID.state).getAttribute('data-state').catch(() => null);
const radiogroup = async (p: Page) => (await row(p).getByTestId(ID.choice).getAttribute('role').catch(() => null)) === 'radiogroup';

export const instrumentsA11yScenarios: InstrumentsA11yScenario[] = [
  {
    id: 'instruments-not-set',
    async prepare(ctx) {
      await openRow(ctx);
      const st = await stateOf(ctx.page);
      return { shown: st === 'library_not_set' && await radiogroup(ctx.page), modal: false, detail: { kitState: st, answer: 'the audit server\'s own state (no library folder)' } };
    },
  },
  {
    id: 'instruments-not-calibrated',
    async prepare(ctx) {
      await openRow(ctx, 'not_calibrated');
      const st = await stateOf(ctx.page);
      return { shown: st === 'not_calibrated' && await radiogroup(ctx.page), modal: false, detail: { kitState: st, answer: 'STAND-IN: the kits route answered in the browser with the contract\'s shape' } };
    },
    leave: unroute,
  },
  {
    id: 'instruments-ready-duties',
    async prepare(ctx) {
      await openRow(ctx, 'ready');
      const st = await stateOf(ctx.page);
      const duties = await row(ctx.page).locator('[data-duty]').count();
      return { shown: st === 'ready' && duties >= 3, modal: false, detail: { kitState: st, duties, answer: 'STAND-IN: a ready kit with two SYNTHETIC sources (CC BY, CC BY-NC), the contract\'s shape' } };
    },
    leave: unroute,
  },
  {
    id: 'instruments-blind-pair',
    async prepare(ctx) {
      await openRow(ctx, 'ready');
      await row(ctx.page).getByTestId(ID.audition).click();
      await row(ctx.page).getByTestId(ID.auditionA).waitFor({ timeout: 8000 }).catch(() => undefined);
      await ctx.page.waitForFunction(() => document.querySelector('[data-testid=instruments-audition-a]')?.getAttribute('aria-disabled') !== 'true', undefined, { timeout: 10000 }).catch(() => undefined);
      const a = row(ctx.page).getByTestId(ID.auditionA), b = row(ctx.page).getByTestId(ID.auditionB);
      const ready = (await a.count()) === 1 && (await b.count()) === 1 && (await a.getAttribute('aria-disabled')) !== 'true';
      return { shown: ready && (await row(ctx.page).getByTestId(ID.reveal).count()) === 1, modal: false, detail: { answer: 'STAND-IN: the two previews are a one-second synthetic tone with x-pf-level-scale 1 and 0.5' } };
    },
    leave: unroute,
  },
  {
    id: 'instruments-add-refused',
    async prepare(ctx) {
      await openRow(ctx, 'ready');
      await row(ctx.page).getByTestId('music-add').click();
      await ctx.page.waitForFunction(() => /./.test(document.querySelector('.pf-music-status.is-err,.pf-music-status.is-ok')?.textContent ?? ''), undefined, { timeout: 30000 }).catch(() => undefined);
      const err = ctx.page.locator('.pf-music-status.is-err');
      const text = (await err.count()) ? ((await err.first().textContent()) ?? '').trim() : '';
      return { shown: text.length > 0, modal: false, detail: { text: text.slice(0, 200), answer: 'the REAL server\'s refusal of the recorded add (409 instruments_library_not_set; the kit list shown is a stand-in «ready»): nothing added' } };
    },
    leave: unroute,
  },
];
