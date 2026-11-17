/**
 * The date stamp's source in the look panel (life line, ADR-0021; plan §7): «טקסט · מתאריך הצילום», the switch «שעון» and the
 * date order «'24 12 25 · 25.12.2024». Each change is one update_effect; going back writes source:'text' and clock:false
 * (update_effect merges parameters, so a value is switched back, never removed). The generic parameter loop of the look panel
 * leaves `source`, `clock` and `dateOrder` to this control (STAMP_SOURCE_PARAMS).
 * Test ids: LIFE_TESTIDS.stampSource, stampClock, stampOrder.
 *
 * CONTRACT FILE (lead pre-pass): the exports and their props are fixed; W3 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
/** The parameters of stylize.date-stamp this control owns: the look panel's generic loop skips them. */
export const STAMP_SOURCE_PARAMS: readonly string[] = ['source', 'clock', 'dateOrder'];
export function StampSource(_props: { clipId: string; effectId: string }): ReactElement | null {
  return null;
}
