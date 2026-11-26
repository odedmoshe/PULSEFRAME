/**
 * Fixed data-testids of «חיפוש בצילומים» (wave 7 search track; .artifacts/wave7/search-decisions.md §4), shared by the interface
 * (builder C) and the proofs (footage-search-proof.ui.ts, a11y-search.ts). Lead contract: C puts exactly these on the elements named
 * here and does not rename them. The search box itself stays `media-search` (Library.tsx).
 */
export const SEARCH_TESTIDS = {
  /** the results under the box (shown while the query is not empty); data-state = exact | picture | empty | not-built */
  results: 'footage-results',
  /** the two sections: found by name/date/transcript, and by what is in the picture (owner only) */
  sectionExact: 'footage-section-exact', sectionPicture: 'footage-section-picture',
  /** a row (data-asset-id, data-start, data-end as "value/timescale" or "", data-sources comma-separated) and its actions; «הצג» only for video */
  row: 'footage-row', rowView: 'footage-row-view', rowAppend: 'footage-row-append', rowInsert: 'footage-row-insert',
  /** «לא נמצא דבר» in a section (data-section = exact | picture) */
  empty: 'footage-empty',
  /** the picture status line (data-state = a PICTURE_STATES value), its setup steps, «סרוק עכשיו», «עצור», «מחק את מפתח החיפוש בתמונה» */
  status: 'footage-status', setup: 'footage-setup', scan: 'footage-scan', scanCancel: 'footage-scan-cancel', forget: 'footage-forget',
  /** the polite live region («נמצאו 7 רגעים») */
  live: 'footage-live',
} as const;
