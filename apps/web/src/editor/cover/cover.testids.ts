/**
 * Fixed data-testids of «הפריים הכי חד» and «שמירת התמונה» (wave 8 cover, version 1; .artifacts/wave8/cover-verify.md), shared by
 * the block (W3) and the proof (packages/evals/src/stills-proof.ts). Lead contract: W3 puts exactly these on the elements named
 * here and does not rename them. The inspector section itself is `section-sharpest` (Section.tsx, id "sharpest").
 */
export const COVER_TESTIDS = {
  /** the block's body; data-state = idle | measuring | found | refused | picture */
  panel: 'sharp-panel',
  /** «מצאו את הפריים הכי חד בקטע», «עצירה» while the job runs, the status line (role status: stage, «נמצאו {n}», a refusal) */
  measure: 'sharp-measure', stop: 'sharp-stop', status: 'sharp-status',
  /** one per candidate (up to three); data-frame = the source frame shown now, data-candidate = its rank (1..3) */
  tile: 'sharp-tile',
  /** inside a tile: the number lines (data-frame, data-sharp, data-sigma100, data-motion, data-hi, data-lo; «לא נמדד» when absent) */
  numbers: 'sharp-numbers',
  /** the heuristic label (STILLS_LABEL), the «איך זה נמדד» disclosure, the key hint, the rate note («הקובץ ב־60 פריימים…») */
  label: 'sharp-label', method: 'sharp-method', keyHint: 'sharp-keyhint', rateNote: 'sharp-rate-note',
  /** «שמירת התמונה» on a tile (or on the block for a picture file): opens the dialog */
  save: 'still-save',
  /** the dialog (role dialog, focus trapped, Escape closes and returns focus to `save`) */
  dialog: 'still-dialog', close: 'still-close',
  /** paper choice radios: the whole frame or one paper */
  paperWhole: 'still-paper-whole', paper10x15: 'still-paper-10x15', paper13x18: 'still-paper-13x18', paperA4: 'still-paper-a4',
  /** orientation radios */
  portrait: 'still-orientation-portrait', landscape: 'still-orientation-landscape',
  /** the crop frame over the picture (focusable; data-x, data-y, data-w, data-h in source pixels) and the picture under it */
  crop: 'still-crop', picture: 'still-picture',
  /** one ppi line per paper for the current crop (data-paper, data-ppi, data-tier) and the rule-of-thumb line */
  ppi: 'still-ppi', rule: 'still-rule',
  /** format radios */
  png: 'still-format-png', jpeg: 'still-format-jpeg',
  /** the standing notes: file size, the browser's reading, conformed copy, own colours, no date, untried size */
  note: 'still-note',
  /** «שמרו את התמונה», the job line, and the download link of the finished file */
  run: 'still-run', job: 'still-job', download: 'still-download',
} as const;
