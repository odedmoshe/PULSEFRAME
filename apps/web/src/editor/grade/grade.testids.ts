/**
 * Fixed data-testids of colour curves «עקומות» and the scope additions (wave 8 grade; grade-plan §3.7 with grade-verify C1: the prefix
 * is `grade-curve-*`, because the keyframe curve picker owns `curve-*` and the a11y audit selects `curve-tile-` by prefix). Shared by
 * the curves block (W2), the scopes and zebra (W3) and the proofs (grade-proof.ui.ts, grade-proof.scopes.ts, the a11y audit). Lead
 * contract: builders put exactly these on the elements named here and do not rename or remove one (they may add ids at the end). A
 * repeated element repeats its id and carries a data-* attribute (data-channel, data-index, data-preset).
 */
export const GRADE_TESTIDS = {
  // the block under «כיוון ידני» (data-state = ready | no-gpu), its channel tabs (data-channel = master | r | g | b), the graph (svg, dir=ltr)
  block: 'grade-curve-block', tab: 'grade-curve-tab', graph: 'grade-curve-graph',
  // a point (role=slider; data-index; data-channel), the numbers of the focused point «כניסה» / «יציאה», the visible status line (no aria-live)
  point: 'grade-curve-point', inField: 'grade-curve-in', outField: 'grade-curve-out', status: 'grade-curve-status',
  // refusals in words (the only live region of the block), the ready-made curves (data-preset = soft | faded | film), their line, reset
  refusal: 'grade-curve-refusal', preset: 'grade-curve-preset', presetsUnseen: 'grade-curve-presets-unseen', reset: 'grade-curve-reset',
  // the muted line under the look picker when the clip has curves («העקומות של הקליפ נשארות», lead decision 2)
  lookKeeps: 'grade-curve-look-keeps',
} as const;
/** Scopes and zebra (W3): the parade, the vectorscope's legend and skin-tone line note, the zebra toggle, the overlay and its chip. */
export const SCOPE_TESTIDS = {
  parade: 'scope-parade', paradeStats: 'scope-parade-stats', vecLegend: 'scope-vec-legend', skinNote: 'scope-skin-note',
  zebraToggle: 'scope-zebra-toggle', overlay: 'exposure-overlay', overlayNote: 'exposure-overlay-note',
} as const;
