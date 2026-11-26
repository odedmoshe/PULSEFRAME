/**
 * Zebra «זברה» over the viewer (wave 8 grade; grade-plan §3.7/§4.2 with grade-verify C7): a separate <canvas aria-hidden> with
 * pointer-events none and the preview's box, mounted in App.tsx `.canvas-wrap` beside CanvasHandles. W3 builds it; until
 * ZEBRA_BUILT it renders nothing. Drawn ONLY while paused (hidden while the preview's data-quality is 'draft'; the chip then says
 * grade.zebraPaused), only in the Colour workspace with zebra on (zebraPref.ts). Static 45° stripes where luma ≥ 251 and a dot grid
 * where luma ≤ 4 (scopeMarks.ts thresholds), drawn per pixel into ImageData (no fonts or filters); nothing flickers (ADR-0009). Exposes
 * data-clipped-px, data-crushed-px, data-frame; never read by the scopes (they select the preview by test id), never in a still or an
 * export. The chip (SCOPE_TESTIDS.overlayNote, role=note) says grade.zebraNote and the legend grade.zebraLegend.
 */
/** W3 sets this when the overlay is built and grade-proof.scopes.ts G15/G16 pass. */
export const ZEBRA_BUILT = false;

export function ExposureOverlay() {
  if (!ZEBRA_BUILT) return null;
  return null;
}
