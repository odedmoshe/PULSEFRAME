/**
 * «חיפוש בצילומים» — the results under the media drawer's search box (wave 7 search track; .artifacts/wave7/search-decisions.md).
 * BUILDER C owns this file (and everything else under editor/search/ but search.testids.ts and search.selftest.ts). Until built it
 * renders nothing, so the drawer behaves exactly as before (the box filters cards by name, MediaLibrary.tsx).
 *
 * What C builds here (decisions §1, §4): two sections under the box while the query is not empty (view 'all' only) — «נמצא בשם,
 * בתאריך ובתמלול» (core searchFootage in the browser, owner reader, debounced 150 ms) and «לפי מה שרואים בתמונה» (POST …/search on
 * Enter); rows with sprite tile, name (dir="auto"), time range in <bdi dir="ltr">, source chips; «הצג» for video only (SourceViewer
 * with initialSpan), «הוסף בסוף» / «הכנס במקום הסמן» through placement.range.ts placementOps as one commit; the model label on every
 * picture row and no number; the status line with setup steps, «סרוק עכשיו», progress with «עצור», «מחק את מפתח החיפוש בתמונה» with
 * confirmation; «לא נמצא דבר» per section; a polite live region; keyboard: ArrowDown from the box into the list, roving focus, Enter =
 * «הצג», Shift+Enter = «הכנס במקום הסמן», Escape back to the box. Ids: SEARCH_TESTIDS. Strings: i18n `footage.*`.
 */
export const FOOTAGE_UI_BUILT = false;

export function FootageResults(props: { query: string; onView: (assetId: string) => void }) {
  void props;
  if (!FOOTAGE_UI_BUILT) return null;
  return null;
}
