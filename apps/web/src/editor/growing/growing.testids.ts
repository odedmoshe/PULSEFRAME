/**
 * Fixed data-testids of «גדלים מול העיניים» (wave 8 growing; growing-plan.md §3.7 with growing-verify.md C8, C10, C13), shared by
 * the growing components (W3) and the proofs (growing-proof.ui.ts, the a11y audit). Lead contract: W3 puts exactly these on the
 * elements named here and does not rename or remove one (it may add ids at the end). A repeated element repeats its id and carries
 * a data-* attribute (data-asset-id, data-frame, data-code, data-state, data-variant, data-step).
 */
export const GROWING_TESTIDS = {
  // the entry (GrowingEntry; data-variant = start-hub) and the dialog (data-step = pick | mark | settings)
  open: 'growing-open', dialog: 'growing-dialog', close: 'growing-close',
  // the ask before closing while marks of pictures not made yet exist (C8): the line, keep marking, close anyway
  closeAsk: 'growing-close-ask', closeKeep: 'growing-close-keep', closeConfirm: 'growing-close-confirm',
  // «בחרו תמונות»: the list in capture order, an item (data-asset-id; data-state = dated | undated), its tick, «המשך»
  pickList: 'growing-pick-list', pickItem: 'growing-pick-item', pickTick: 'growing-pick-tick', pickNext: 'growing-pick-next',
  // «סמנו עיניים»: the marking view (dir=ltr; the source viewer's one-clip document), the frame stepper of a video (data-frame),
  // the crosshair, a placed point (data-state = first | second), the prompt, «החליפו» (S, C10), «מחקו סימון», previous / next
  // picture, the live count «סומנו 12 מתוך 40»
  markView: 'growing-mark-view', markFrame: 'growing-mark-frame', markCrosshair: 'growing-mark-crosshair', markPoint: 'growing-mark-point',
  markPrompt: 'growing-mark-prompt', markSwap: 'growing-mark-swap', markClear: 'growing-mark-clear', markPrev: 'growing-mark-prev', markNext: 'growing-mark-next',
  markCount: 'growing-mark-count',
  // the live preview after the second picture (C13): the player and its label «תצוגה מקדימה — עוד לא נוצר»
  preview: 'growing-preview', previewLabel: 'growing-preview-label',
  // «איך זה ייראה»: hold, dissolve (data-variant = none | short | long), face size and its suggestion «בלי פינות ריקות: N%»,
  // the caption choices (age disabled with its reason), the privacy sentence (C7) and the limits, «צרו»
  hold: 'growing-hold', dissolve: 'growing-dissolve', faceSize: 'growing-face-size', faceSuggest: 'growing-face-suggest',
  captionDate: 'growing-caption-date', captionAge: 'growing-caption-age', captionAgeReason: 'growing-caption-age-reason',
  privacy: 'growing-privacy', limits: 'growing-limits', create: 'growing-create',
  // plan notes (data-code) and a refusal beside its control
  warning: 'growing-warning', error: 'growing-error',
  // after apply: the bar beside the film and story bars, and «למה?» (a row per picture: data-asset-id, data-frame)
  bar: 'growing-bar', barUndo: 'growing-bar-undo', barRebuild: 'growing-bar-rebuild', barRestore: 'growing-bar-restore-removed', barWhy: 'growing-bar-why',
  why: 'growing-why', whyRow: 'growing-why-row', needsMarks: 'growing-needs-marks',
} as const;
export type GrowingTestId = (typeof GROWING_TESTIDS)[keyof typeof GROWING_TESTIDS];
