/**
 * The number-carrying strings of the fast export and the render cache (ADR-0024), Hebrew first; the fixed strings are i18n
 * `cache.*` (packages/i18n/src/renderCache.ts). LEAD STUB, final signatures; W3 owns the wording and renderCache.strings.test.ts
 * (the Hebrew reuse line for (284, 300) reads «נעשה שימוש חוזר ב-284 מתוך 300 מקטעים»; numbers go in <bdi dir="ltr"> where they
 * are rendered; no string promises a speed or says the cache was verified as a whole).
 */
export interface RenderCacheStrings {
  reuseLine(reused: number, total: number): string;
  renderLine(segments: number, seconds: number): string;
  firstExport(total: number): string;
  uncacheableLine(segments: number): string;
  /** Only when SegmentPlanView.estimate.seconds is not null. */
  eta(seconds: number): string;
  laneSummary(cached: number, total: number): string;
  done(o: { reused: number; rendered: number; framesChecked: number; notStored: number }): string;
  storageRow(usedBytes: number, capBytes: number): string;
  cleared(bytes: number, keptPinned: number): string;
}
export function renderCacheStrings(lang: 'he' | 'en'): RenderCacheStrings {
  void lang;
  throw new Error('renderCacheStrings: not built yet (segment cache W3)');
}
