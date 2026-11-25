/**
 * The accessibility audit scenarios of the craft surfaces (wave 7 craft; W3 BUILDS THEM): the time field open, the paste dialog,
 * the find panel with matches, the versions compare. Each scenario PREPARES the page and says whether the state is shown (and
 * whether it is modal); a11y-audit.ts then runs its full heuristic on it in Hebrew and English, as for the other transient states.
 * Empty until built: the audit then has no craft state to look at (never a pass for a state that was not shown).
 */
import type { Page } from 'playwright';

export interface CraftA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface CraftA11yScenario {
  id: string;
  prepare(ctx: CraftA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: CraftA11yCtx): Promise<void>;
}
export const craftA11yScenarios: CraftA11yScenario[] = [];
