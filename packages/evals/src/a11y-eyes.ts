/**
 * The accessibility audit scenarios of «הציעו עיניים» in the marking view of «גדלים מול העיניים» (wave 8 picmodels; integration).
 * a11y-audit.ts runs each in both languages and both themes, with its full heuristic, right after the growing scenarios.
 *  - eyes-state: the audit's own server has no picture model (the real registry: yunet not_built), so the marking view shows the
 *    honest state — «הציעו עיניים» disabled, the setup line beside it (described by it) and the privacy sentence. Nothing is faked.
 *  - eyes-proposal, eyes-accept: a proposal needs a ready model, which this machine does not have. The page's own
 *    `GET /api/v1/picture-models` and `POST …/eyes/propose` are answered with a fixed AUDIT FIXTURE through the browser's route hook
 *    (labelled in the answer's `method` and in `detail.fixture`), as a11y-search.ts does: the audit looks at how the interface presents
 *    two proposed faces with nothing chosen (the accept button disabled with its reason) and then with one chosen; it never claims a
 *    model works or where it would put the rings. The route hook is removed by eyes-accept's `leave`.
 * Each scenario PREPARES the page and says whether the state is shown; `shown: false` is reported as a finding, never as a pass.
 */
import type { Page, Route } from 'playwright';
import { EYES_TESTIDS as EID } from '../../../apps/web/src/editor/growing/eyes.testids.ts';
import { GROWING_TESTIDS as ID } from '../../../apps/web/src/editor/growing/growing.testids.ts';
import { closeDialog, openDialog, tickBoth, type GrowingA11yCtx, type GrowingA11yScenario } from './a11y-growing.ts';

const FIXTURE = 'AUDIT FIXTURE (not a model: fixed rings for the accessibility audit)';
const MODELS = { built: true, models: [{ id: 'yunet', output: 'eyes', code: 'ready', module: null, device: 'cpu', missingBytes: 0, detail: FIXTURE }] };
const ANSWER = { outcome: 'faces', method: FIXTURE, faces: [{ eyes: [{ u: 260 / 640, v: 200 / 480 }, { u: 380 / 640, v: 200 / 480 }] }, { eyes: [{ u: 470 / 640, v: 330 / 480 }, { u: 560 / 640, v: 330 / 480 }] }] };
const models = (r: Route) => r.fulfill({ json: MODELS, headers: { 'cache-control': 'no-store' } });
const propose = (r: Route) => (r.request().method() === 'POST' ? r.fulfill({ json: ANSWER, headers: { 'cache-control': 'no-store' } }) : r.continue());
async function unroute(page: Page) {
  await page.unroute('**/api/v1/picture-models', models).catch(() => {});
  await page.unroute('**/api/v1/projects/*/eyes/propose', propose).catch(() => {});
}
/** The dialog on its marking step (the growing scenario's way in: the start hub card of a fresh empty project, both pictures ticked). */
async function markingStep(ctx: GrowingA11yCtx): Promise<boolean> {
  if (!(await openDialog(ctx))) return false;
  await tickBoth(ctx.page);
  await ctx.page.getByTestId(ID.pickNext).click();
  return ctx.page.getByTestId(ID.markView).waitFor({ timeout: 10000 }).then(() => true, () => false);
}

export const eyesA11yScenarios: GrowingA11yScenario[] = [
  {
    id: 'eyes-state',
    async prepare(ctx) {
      const { page } = ctx;
      await unroute(page);
      const at = await markingStep(ctx);
      const line = at && (await page.getByTestId(EID.state).waitFor({ timeout: 10000 }).then(() => true, () => false));
      const btn = page.getByTestId(EID.suggest);
      const code = line ? await page.getByTestId(EID.state).getAttribute('data-code') : null;
      const disabled = line && (await btn.isDisabled().catch(() => false));
      const described = line && (await btn.getAttribute('aria-describedby')) === (await page.getByTestId(EID.state).getAttribute('id'));
      const privacy = (await page.getByTestId(EID.privacy).count()) === 1;
      return { shown: !!(line && disabled && described && privacy), modal: true, detail: { setupCode: code, buttonDisabled: disabled, describedByTheLine: described } };
    },
    async leave(ctx) { await closeDialog(ctx.page); },
  },
  {
    id: 'eyes-proposal',
    async prepare(ctx) {
      const { page } = ctx;
      await page.route('**/api/v1/picture-models', models);
      await page.route('**/api/v1/projects/*/eyes/propose', propose);
      const at = await markingStep(ctx);
      const btn = page.getByTestId(EID.suggest);
      const ready = at && (await btn.waitFor({ timeout: 10000 }).then(() => true, () => false)) && !(await btn.isDisabled());
      if (ready) await btn.click();
      const shown = ready && (await page.getByTestId(EID.proposal).waitFor({ timeout: 10000 }).then(() => true, () => false));
      const accept = page.getByTestId(EID.accept);
      const reason = shown && (await accept.isDisabled()) && !!(await accept.getAttribute('aria-describedby'));
      return { shown: !!(shown && reason && (await page.getByTestId(EID.ring).count()) === 4), modal: true, detail: { fixture: FIXTURE, acceptDisabledWithReason: reason } };
    },
    // no leave: eyes-accept goes on from this proposal
  },
  {
    id: 'eyes-accept',
    async prepare(ctx) {
      const { page } = ctx;
      const has = (await page.getByTestId(EID.proposal).count()) === 1;
      if (has) { await page.getByTestId(ID.markView).locator('.pf-growing-stage').focus(); await page.keyboard.press(']'); }
      const enabled = has && (await page.getByTestId(EID.accept).isEnabled().catch(() => false));
      return { shown: !!(enabled && (await page.locator(`[data-testid="${EID.ring}"][data-chosen="true"]`).count()) === 2), modal: true, detail: { fixture: FIXTURE } };
    },
    async leave(ctx) { await closeDialog(ctx.page); await unroute(ctx.page); },
  },
];
