/**
 * Fixed data-testids of «ציור חי» (wave 8 ink, version 1; .artifacts/wave8/ink-verify.md), shared by the mode, its toolbar, the clip
 * panel (W3) and the proof (packages/evals/src/ink-proof.ts). Lead contract: W3 puts exactly these on the elements named here and does
 * not rename them.
 */
export const INK_TESTIDS = {
  /** «ציור» in the stage header (aria-pressed while the mode is on; disabled with the reason while playing) */
  modeToggle: 'ink-mode-toggle',
  /** the capture surface over the stage canvas (touch-action: none); data-state = idle | drawing; data-strokes = session strokes */
  overlay: 'ink-overlay',
  /** the wet-stroke canvas inside the overlay (display size; empty after pen-up, C3/I17) */
  wet: 'ink-wet',
  /** the toolbar (role toolbar) and its controls */
  toolbar: 'ink-toolbar',
  brushMarker: 'ink-brush-marker', brushHighlighter: 'ink-brush-highlighter', brushNeon: 'ink-brush-neon',
  colour: 'ink-colour',
  widthThin: 'ink-width-thin', widthMedium: 'ink-width-medium', widthThick: 'ink-width-thick',
  undoStroke: 'ink-undo-stroke', done: 'ink-done', cancel: 'ink-cancel',
  /** the mode's status line (role status): the hint, «אין קווים לביטול…», «כדי לנגן…», «הציור מופיע בהדרגה…» */
  status: 'ink-status',
  /** the discard confirmation (role alertdialog) and its two buttons */
  discardConfirm: 'ink-discard-confirm', discardYes: 'ink-discard-yes', discardNo: 'ink-discard-no',
  /** the clip panel of a drawing (drawnPanels.tsx registration) */
  panel: 'ink-panel',
  playDrawn: 'ink-play-drawn', playAll: 'ink-play-all', fadeOut: 'ink-fade-out',
  /** «לא נבדק בעין», «הציור לא מסתיים לפני סוף הקליפ», the other-format note, the neon-needs-blur note */
  notLooked: 'ink-not-looked', notEnds: 'ink-not-ends', otherFormat: 'ink-other-format', neonNote: 'ink-neon-note',
} as const;
