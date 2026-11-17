/**
 * The font picker (ADR-0022; plan §8): replaces the plain font selects of the title and caption inspectors (the lead mounts it
 * after the redesign's inspector split). A listbox with type-ahead and arrow keys; each option drawn in its own face with
 * «אבג שָׁלוֹם»; category chips (סנס / סריף / כותרת / כתב יד, i18n font.category.*); the badge «ניקוד נבדק» for a row whose
 * nikud is 'positioned'; «מתאים עם…» from FONT_PAIRS. Families and weights come from FONT_CATALOG only.
 * Test ids: FONT_TESTIDS (packs.testids.ts).
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W2 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
export interface FontChoice { family: string; weight: number }
export function FontPicker(_props: { value: FontChoice; onChange: (next: FontChoice) => void; lang: 'he' | 'en'; label: string; disabled?: boolean }): ReactElement | null {
  return null;
}
