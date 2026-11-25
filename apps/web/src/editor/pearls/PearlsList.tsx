/**
 * The «פנינים» view of the media drawer (wave 7 pearls track). BUILDER C builds it against the settled contracts: core
 * sourceRangesContract.ts (ops, PearlsView, PEARL_SHORT_LIMITS), pearls.logic.ts usageOf, api.pearls, the strings (pearl.*) and the
 * ids (pearls.testids.ts). Library.tsx mounts it, and lifeline LifeViewSwitch offers the view, only while PEARLS_UI_BUILT is true,
 * so the editor shows nothing new until it is built.
 * Rules: search, «הכול» / «לא בשימוש» / a chip per person; rows by capture time, then source time; a row = thumbnail at the span
 * start, label (dir="auto", F2 renames), time range and length in <bdi dir="ltr">, people chips, usage line «בשימוש: 4.0 מתוך 6.2
 * שניות» or «לא בשימוש», «סומן על ידי סוכן» for an `agent:` createdBy; roving focus with arrows, Enter opens the viewer on the range,
 * Shift+Enter inserts at the playhead, Delete removes; insert through the pure builder placement.range.ts (one transaction);
 * «שורט מהפנינה» disabled with its reason outside PEARL_SHORT_LIMITS; empty state pearl.empty; labelsHidden said in words.
 */
/** True once builder C has built the pearls surfaces (every mount point checks it). */
export const PEARLS_UI_BUILT = false;

export function PearlsList({ onView }: { onView?: (assetId: string) => void }) {
  void onView;
  return null;
}
