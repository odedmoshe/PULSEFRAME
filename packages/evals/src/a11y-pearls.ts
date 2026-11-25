/**
 * The accessibility audit scenarios of the pearls surfaces (wave 7 pearls track; BUILDER C BUILDS THEM): the «פנינים» list (empty and
 * with rows), the pearl form open in the source viewer, «מי בקליפ?», and the screen-time table; both languages and both themes. Each
 * scenario PREPARES the page and says whether the state is shown (and whether it is modal); a11y-audit.ts then runs its full
 * heuristic on it. Empty until built: the audit then has no pearls state to look at (never a pass for a state that was not shown).
 */
import type { Page } from 'playwright';

export interface PearlsA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface PearlsA11yScenario {
  id: string;
  prepare(ctx: PearlsA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: PearlsA11yCtx): Promise<void>;
}
export const pearlsA11yScenarios: PearlsA11yScenario[] = [];
