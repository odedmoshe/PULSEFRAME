/**
 * The accessibility audit scenarios of «חיפוש בצילומים» (wave 7 search track; builder C): the results with both sections, «לא נמצא דבר»,
 * the picture status line not installed / not scanned / scanning, and the forget confirmation; both languages (a11y-audit.ts runs each
 * scenario in both and in both themes). Each scenario PREPARES the page and says whether the state is shown (and whether it is modal);
 * a state that could not be brought up says `shown: false`, which the audit reports as a finding, never as a pass. Synthetic data only.
 * Empty until builder C builds the interface (FOOTAGE_UI_BUILT): nothing to audit yet, and nothing reported as passed.
 */
import type { Page } from 'playwright';

export interface SearchA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface SearchA11yScenario {
  id: string;
  prepare(ctx: SearchA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: SearchA11yCtx): Promise<void>;
}
export const searchA11yScenarios: readonly SearchA11yScenario[] = [];
