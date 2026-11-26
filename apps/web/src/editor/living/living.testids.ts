/**
 * Fixed data-testids of «תמונה חיה» (wave 8 living track), shared by the interface (W3) and the proofs (living-proof.ts, the a11y
 * states the lead adds at integration: living-block and depth-dialog in both themes and languages). Lead contract: W3 puts exactly
 * these on the elements named here and does not rename them. Cut from version 1: orbit, peek, the direction switch, the stroke list.
 */
export const LIVING_TESTIDS = {
  /** the block in the «תנועה» tab; data-state = offer | on | not-offered | refused */
  block: 'living-block',
  /** «הפכו לתמונה חיה»: opens the depth dialog with the ramp pre-filled (C13); nothing is committed before «שמירה» */
  apply: 'living-apply',
  /** the move chips (a radio group): «התקרבות», «גלישה הצידה» */
  movePush: 'living-move-push', moveSlide: 'living-move-slide',
  /** the amount slider (max = livingMaxAmount for the clip) and the «העוצמה הוגבלה» line */
  amount: 'living-amount', amountCapped: 'living-amount-capped',
  /** the depth line («עומק מצויר · {n} משיכות») and «ציירו עומק» */
  depthState: 'living-depth-state', depthOpen: 'living-depth-open',
  /** the owner's-drawing / nobody-has-looked line, the rule-of-thumb line, «דורש כרטיס מסך», «התאימו לאורך», «הסירו תמונה חיה» */
  drawnNote: 'living-drawn-note', ruleOfThumb: 'living-rule-of-thumb', gpuNote: 'living-gpu-note', refit: 'living-refit', remove: 'living-remove',
  /** the gated status line «חישוב עומק» of the picture-model runtime (another track); mounted, reads nothing yet */
  computeState: 'living-compute-state',
  /** the depth dialog (modal; Escape cancels; focus returns to living-depth-open) */
  dialog: 'depth-dialog', canvas: 'depth-canvas',
  toolHorizon: 'depth-tool-horizon', toolNear: 'depth-tool-near', toolFar: 'depth-tool-far', brushSize: 'depth-brush-size',
  undoStroke: 'depth-undo-stroke', clear: 'depth-clear', flat: 'depth-flat', save: 'depth-save', cancel: 'depth-cancel',
} as const;
