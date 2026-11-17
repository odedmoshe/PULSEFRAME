/**
 * The first section «חבילות» of the templates drawer (ADR-0022; plan §8): one Tile per pack, its cover three real element
 * pictures on the pack palette and a mono count («4 תבניות · 25 אלמנטים»). A pack suggested for `today` (suggestPacks, with the
 * client's own local date) sorts first with a gold Badge from PackSuggestion.reason; dismissing it is a per-viewer preference in
 * localStorage (inside try/catch), never project state. Test ids: PACK_TESTIDS.shelf, card, suggest, suggestDismiss.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W2 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
import type { GDate, LifeEventHint, PackSummary } from '@pulseframe/core';
export function PacksShelf(_props: { packs: readonly PackSummary[]; today: GDate; hints?: readonly LifeEventHint[]; lang: 'he' | 'en'; onOpen: (packId: string) => void }): ReactElement | null {
  return null;
}
