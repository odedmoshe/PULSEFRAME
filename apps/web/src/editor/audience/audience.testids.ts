/**
 * Fixed data-testids of «גרסה לכל קהל» (wave 8 audiences track), shared by the interface (W3) and the proofs (audiences-proof.ui.ts,
 * the a11y states the lead adds at integration: audience-panel in both themes and languages). Lead contract: W3 puts exactly these on
 * the elements named here and does not rename them.
 */
export const AUDIENCE_TESTIDS = {
  /** the «+» menu items of the format prism (data-profile = calm | grandparents) */
  menuCalm: 'audience-add-calm', menuGrandparents: 'audience-add-grandparents',
  /** the profile glyph on an audience version's chip (data-profile) */
  chipMark: 'audience-chip-mark',
  /** the panel «מה שונה בגרסה הזו» in the Deliver panel; data-state = loading | list | empty | refused | not-built */
  panel: 'audience-panel',
  /** one change row (a button; data-rule, data-clip-id, data-start-frame, data-kept) and its «להשאיר כמו במקור» / «להחזיר את השינוי» */
  change: 'audience-change', keep: 'audience-keep',
  /** a fast-cut row (a button that jumps; data-start-frame) */
  fastCut: 'audience-fast-cut',
  /** a sound track row (data-track-id, data-role, data-why), its role select and the music level control */
  soundRow: 'audience-sound-row', roleSelect: 'audience-role', musicDb: 'audience-music-db',
  /** the fixed sentences of what the version does not do (data-code) */
  notHandled: 'audience-not-handled',
  /** «לשליחה»: opens the export sheet on this version */
  send: 'audience-send',
  /** the note under the viewer while a version is viewed */
  stageNote: 'audience-stage-note',
} as const;
