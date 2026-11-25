/**
 * The accessibility audit scenarios of the stabilisation block (wave 7 stabilise track; W3 BUILDS THEM): the block not measured,
 * measuring (with «עצירה»), on with the slider and the crop line, limited, refused; both languages and both themes. Each scenario
 * PREPARES the page and says whether the state is shown (and whether it is modal); a11y-audit.ts then runs its full heuristic on it.
 * Empty until built: the audit then has no stabilise state to look at (never a pass for a state that was not shown).
 */
import type { Page } from 'playwright';

export interface StabiliseA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface StabiliseA11yScenario {
  id: string;
  prepare(ctx: StabiliseA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: StabiliseA11yCtx): Promise<void>;
}
export const stabiliseA11yScenarios: StabiliseA11yScenario[] = [];
