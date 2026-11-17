/**
 * Shared ways for the browser proofs and audits to reach editor controls that moved in the UI redesign (UX_REDESIGN §8,
 * wave A). Each helper changes only HOW a proof reaches a control: the control, the op it commits and what the proof
 * asserts about it are the proof's own.
 *
 *   setWorkspace   the header's workspace <select> became the mode bar (workspace-<mode> radios); the modes quick, motion
 *                  and custom are no longer on the bar, so they are chosen the way the editor itself keeps a mode
 *                  (localStorage pf.workspace.v1) and the page is reloaded.
 *   chooseFormat   the header's format <select> became the stage header's FormatPrism radiogroup (format-switch, one
 *                  [data-value] chip per linked format, '' for the master).
 *   formatValue    the select's inputValue(): the radiogroup's data-value.
 *   startExport    Export always opens the export sheet (owner decision 2026-11-17); its export-start button starts it.
 *   openInspectorPage  the inspector's panel tabs now live in the mode that hosts them (§8): captions and speech in
 *                  Captions, sound in Sound, deliver, review and recipes in Deliver; the selection's page is the only page
 *                  in Edit; "all tools" is the icon button at the inspector's head.
 *   pauseAgent     pause-agent moved into the agent avatar's menu (agent-menu).
 *   openCardMenu   a media card's view-/remove-/notes-/colour-read- items moved into its ⋯ popover (more-<asset id>).
 */
import type { Page } from 'playwright';

export type Mode = 'pro' | 'color' | 'sound' | 'captions' | 'deliver' | 'quick' | 'motion' | 'custom';

/** Chooses a workspace. The five on the mode bar are clicked; quick, motion and custom are set as the editor keeps them and the page reloads. */
export async function setWorkspace(page: Page, ws: Mode): Promise<void> {
  const bar: Record<string, () => ReturnType<Page['getByTestId']>> = {
    pro: () => page.getByTestId('workspace-pro'), color: () => page.getByTestId('workspace-color'), sound: () => page.getByTestId('workspace-sound'),
    captions: () => page.getByTestId('workspace-captions'), deliver: () => page.getByTestId('workspace-deliver'),
  };
  const b = bar[ws];
  if (b) { await b().click(); await page.waitForFunction((w) => document.querySelector(`[data-testid="workspace-${w}"]`)?.getAttribute('aria-checked') === 'true', ws, { timeout: 10000 }); return; }
  // as the bar does, the mode change leaves the all-tools view: the inspector then opens the mode's first panel
  await page.evaluate((w) => { localStorage.setItem('pf.workspace.v1', w); if (localStorage.getItem('pf.inspector.tab.v1') === 'all') localStorage.setItem('pf.inspector.tab.v1', 'clip'); }, ws);
  await page.reload();
  await page.getByTestId('project-name').waitFor();
  await page.waitForFunction((w) => document.querySelector('.inspector')?.getAttribute('data-mode') === w, ws, { timeout: 15000 });
}
/** The workspace the editor shows (the inspector's data-mode; the mode bar shows only five of the eight). */
export async function workspaceValue(page: Page): Promise<string> {
  return (await page.locator('aside.inspector').first().getAttribute('data-mode')) ?? '';
}

/** Views a linked format ('' for the master) through the stage header's FormatPrism. */
export async function chooseFormat(page: Page, variantId: string): Promise<void> {
  await page.locator(`[data-testid=format-switch] [data-value="${variantId}"]`).click();
  await page.waitForFunction((v) => document.querySelector('[data-testid=format-switch]')?.getAttribute('data-value') === v, variantId, { timeout: 10000 });
}
/** The viewed format's id ('' for the master), as the select's inputValue() was. */
export async function formatValue(page: Page): Promise<string> {
  return (await page.getByTestId('format-switch').getAttribute('data-value')) ?? '';
}
/** The ids of the linked formats on offer (the select's options without the master). */
export async function formatOptions(page: Page): Promise<string[]> {
  return page.locator('[data-testid=format-switch] [role=radio]').evaluateAll((els) => els.map((e) => e.getAttribute('data-value') ?? '').filter((v) => v));
}

/** Opens the export sheet from the top bar's Export button and presses its start button (the sheet's defaults are what the old button sent). */
export async function startExport(page: Page, opts: { timeout?: number } = {}): Promise<void> {
  await page.getByTestId('export').click();
  await page.getByTestId('export-sheet').waitFor({ timeout: opts.timeout ?? 15000 });
  await page.getByTestId('export-start').click({ timeout: opts.timeout ?? 15000 });
  await page.getByTestId('export-progress').or(page.getByTestId('export-done')).first().waitFor({ timeout: opts.timeout ?? 30000 });
}

/** Shows an inspector page: in the mode that hosts it (§8), then its tab when the mode offers more than one page. 'all' is the all-tools view. */
export async function openInspectorPage(page: Page, id: 'clip' | 'speech' | 'captions' | 'sound' | 'review' | 'deliver' | 'recipes' | 'all'): Promise<void> {
  if (id === 'all') {
    if ((await page.locator('aside.inspector[data-view=all]').count()) === 0) {
      // the button sits at the head of the selection's page; a mode without that page (Deliver) shows it in Edit
      if (!(await page.getByTestId('inspector-tab-all').first().isVisible())) await setWorkspace(page, 'pro');
      await page.getByTestId('inspector-tab-all').first().click();
    }
    await page.locator('aside.inspector[data-view=all]').waitFor();
    return;
  }
  const host: Record<string, Mode> = { clip: 'pro', speech: 'captions', captions: 'captions', sound: 'sound', review: 'deliver', deliver: 'deliver', recipes: 'deliver' };
  if ((await workspaceValue(page)) !== host[id]) await setWorkspace(page, host[id]!);
  const tab = page.locator(`button[role=tab][data-testid="inspector-tab-${id}"]`);
  if (id !== 'clip' && await tab.count()) await tab.first().click();
  await page.locator(`[data-testid="inspector-panel-${id}"]:not([hidden])`).waitFor();
}

/** Pauses (or resumes) the agents: the agent avatar's menu, then its pause item. */
export async function pauseAgent(page: Page): Promise<void> {
  await page.getByTestId('agent-menu').click();
  await page.getByTestId('pause-agent').click();
}

/** Opens a media card's ⋯ popover, where view-/remove-/notes-/colour-read- now live. */
export async function openCardMenu(page: Page, assetId: string): Promise<void> {
  const more = page.locator(`[data-testid="more-${assetId}"]`);
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
}
