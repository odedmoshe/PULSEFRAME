/**
 * Fixed data-testids of multicam in the editor (ADR-0020), shared by the editor components and the proofs
 * (multicam-ui-proof.ts, a11y-audit.ts, editor-interactions-proof.ts). Lead contracts commit: W3 puts exactly these on the
 * elements named here and does not rename them. A repeated element repeats its id and carries the data-* attribute named
 * beside it.
 */
export const MULTICAM_TESTIDS = {
  // the docked, NON-modal panel beside the viewer (Transport.tsx stage-side slot; aria-modal never set, so digits pass the
  // shortcut gate): the panel, the angle viewer canvas, the tile radiogroup and each tile (data-angle-id, data-tile = 1..9,
  // aria-pressed, aria-keyshortcuts), the «בשידור» badge, a tile's level meter, a thumbnail tile («תמונה ממוזערת, לא חי»)
  panel: 'multicam-panel', viewer: 'multicam-viewer', tiles: 'multicam-tiles', tile: 'multicam-tile', onAir: 'multicam-on-air',
  meter: 'multicam-meter', thumbnail: 'multicam-thumbnail',
  // live switching: the «הקלטת החלפות» toggle (aria-pressed), the reaction offset, the polite live region (start, stop,
  // «N חתכים נשמרו» only), the group chooser
  record: 'multicam-record', reaction: 'multicam-reaction', live: 'multicam-live', group: 'multicam-group',
  // the note shown when angle prefetch is off on a low-memory device (media.ts prefetchBudget)
  prefetchOff: 'multicam-prefetch-off',
  // the speakers table: a row (data-speaker-id), its mic, channel and shot choosers
  speakers: 'multicam-speakers', speaker: 'multicam-speaker', speakerMic: 'multicam-speaker-mic', speakerChannel: 'multicam-speaker-channel', speakerShot: 'multicam-speaker-shot',
  // the auto-switch sheet: open, the heuristic disclaimer, the basis lines, apply, regenerate; the diarisation setup state
  auto: 'multicam-auto', autoDisclaimer: 'multicam-auto-disclaimer', autoBasis: 'multicam-auto-basis', autoApply: 'multicam-auto-apply', autoRegenerate: 'multicam-auto-regenerate',
  diarisation: 'multicam-diarisation',
  // the sync dialog (aria-modal): the dialog, a file row (data-angle-id, data-piece), its verdict chip in words (data-verdict),
  // offset, drift, peak ratio and residual, the ±1 frame and ±1 ms spinbuttons, a candidate (data-index) and «בחירה», the
  // capture-time hand choice, re-sync, and the would_discard_edits prompt
  syncDialog: 'multicam-sync-dialog', syncRow: 'multicam-sync-row', verdict: 'multicam-verdict', offset: 'multicam-offset', drift: 'multicam-drift',
  peakRatio: 'multicam-peak-ratio', residual: 'multicam-residual', nudgeFrame: 'multicam-nudge-frame', nudgeMs: 'multicam-nudge-ms',
  candidate: 'multicam-candidate', choose: 'multicam-choose', capturePrior: 'multicam-capture-prior', resync: 'multicam-resync', discardPrompt: 'multicam-discard-prompt',
  // dual-mono suggestion (one click to centre; never applied by itself)
  dualMono: 'multicam-dual-mono', dualMonoApply: 'multicam-dual-mono-apply',
  // the library entry «סנכרון וחיתוך» (MulticamLibraryEntry.tsx) and its review stop when any file is not 'confident'
  syncAndCut: 'multicam-sync-and-cut', reviewStop: 'multicam-review-stop',
  // the timeline badge «N · label» on a tagged segment (data-angle-id), and the inspector block of a tagged clip
  // (MulticamClipBlock.tsx): the angle radio list and «החל מראה זה על כל הזווית»
  badge: 'multicam-badge', clipBlock: 'multicam-clip-block', angleRadio: 'multicam-angle-radio', applyLook: 'multicam-apply-look',
} as const;
export type MulticamTestId = (typeof MULTICAM_TESTIDS)[keyof typeof MULTICAM_TESTIDS];
