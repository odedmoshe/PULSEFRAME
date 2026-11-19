/**
 * Fixed data-testids of the fast export and the render cache (ADR-0024), shared by the editor components and the proofs
 * (incremental-export-proof.ts, a11y-render-cache.ts, a11y-audit.ts). Lead contracts commit: W3 puts exactly these on the
 * elements named here and does not rename them. A repeated element repeats its id and carries a data-* attribute.
 */
export const RENDER_CACHE_TESTIDS = {
  // the timeline lane under the flash lane: the lane, each drawn stretch (data-state = cached | render | uncacheable,
  // data-first-frame, data-frames), the ONE focusable summary (aria-label «מטמון רינדור: …»), its popover, a stale stretch
  // in it (data-first-frame), the stretch's «קפיצה» button, and «רענון» when the lane does not refresh by itself
  lane: 'cache-lane', stretch: 'cache-stretch', summary: 'cache-summary', popover: 'cache-popover', stale: 'cache-stale', jump: 'cache-jump', refresh: 'cache-refresh',
  // the export sheet: the «ייצוא מהיר» switch, its disabled reason, the role=status line (data-state = checking | ready | first |
  // nothing | error), its second line (what is rendered), the measured ETA, and the honest notes (data-note = ripple | music)
  fastSwitch: 'cache-fast-switch', fastReason: 'cache-fast-reason', reuseLine: 'cache-reuse-line', renderLine: 'cache-render-line', eta: 'cache-eta', note: 'cache-note',
  // progress and result: a stage row (data-stage = core SEGMENTED_STAGES), the done line, the self-check failure text
  stage: 'cache-stage', done: 'cache-done', selfCheckFailed: 'cache-self-check-failed',
  // storage: the status-bar popover row, project manager → storage: the clear button, its confirm button, the result line
  storageRow: 'cache-storage-row', clear: 'cache-clear', clearConfirm: 'cache-clear-confirm', cleared: 'cache-cleared',
} as const;
export type RenderCacheTestId = (typeof RENDER_CACHE_TESTIDS)[keyof typeof RENDER_CACHE_TESTIDS];
