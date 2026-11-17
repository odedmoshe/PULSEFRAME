/**
 * A pack's page (ADR-0022; plan §8): a back button and Tabs תבניות / כותרות / אלמנטים / מראה / כתוביות / צליל (PACK_TABS).
 * Every action is ONE transaction through existing operations and routes: a template opens the template dialog; a title is one
 * add_text (packTitleOp); a look is one add_adjustment (packLookOp); a caption look is one apply_caption_look; an element or a
 * sound goes through the existing element and sound routes (the clip is one undo, the file stays in the library, and the page
 * says so). Test ids: PACK_TESTIDS.page, back, tab(t), panel(t) and the item ids.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W2 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
import type { PackSummary } from '@pulseframe/core';
import type { PackTab } from './packs.testids.ts';
export function PackPage(_props: { pack: PackSummary; projectId: string; lang: 'he' | 'en'; initialTab?: PackTab; onBack: () => void; onOpenTemplate: (templateId: string) => void }): ReactElement | null {
  return null;
}
