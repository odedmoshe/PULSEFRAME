/**
 * «שמור כפנינה» on the selected transcript words (wave 7 pearls track). BUILDER C builds it: a button beside «מחק» in the
 * transcript panel, enabled with a selection; span = first word's start to last word's end on the transcript's own asset (exact,
 * no rounding), label = the words joined by spaces, cut to MAX_RANGE_LABEL; one add_source_range. TranscriptPanel.tsx mounts it
 * while PEARLS_UI_BUILT.
 */
import type { Word } from '@pulseframe/core';

export function SavePearlFromWords({ assetId, words }: { assetId: string | null; words: readonly Word[] }) {
  void assetId; void words;
  return null;
}
