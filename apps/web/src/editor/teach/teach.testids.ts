/**
 * Fixed data-testids of «למדו אותי פעם אחת» (wave 8 teach; teach-plan.md §3.8 with teach-verify's cuts), shared by the teach
 * components (W3) and the proofs (proof:editor-interactions rows, audit:a11y states teach-chip, teach-dialog, teach-rows,
 * toast-in-teach). Lead contract: W3 puts exactly these on the elements named here and does not rename or remove one (it may add ids
 * at the end). A repeated element repeats its id and carries a data-* attribute (data-part, data-kind, data-clip-id, data-state, data-code).
 */
export const TEACH_TESTIDS = {
  // the Inspector line «למדתי N שלבים מהקליפ הזה · החילו גם על…» (a plain button; data-count = the number of parts)
  chip: 'teach-chip',
  // the dialog «החילו גם על…» and its close
  dialog: 'teach-dialog', close: 'teach-close',
  // «מה שעשיתם ב־…»: the list, one row per part (data-part = key, data-kind), its tick; the window line; «לא נלמד (N)» and its rows (data-code)
  parts: 'teach-parts', part: 'teach-part', partTick: 'teach-part-tick', window: 'teach-window', notLearned: 'teach-not-learned', notLearnedRow: 'teach-not-learned-row',
  // «על אילו קליפים»: the list, one row per clip (data-clip-id), its tick, «כל הקליפים במסלול»
  targets: 'teach-targets', target: 'teach-target', targetTick: 'teach-target-tick', allOnTrack: 'teach-all-on-track',
  // the per-clip result rows from planApplyLesson (data-clip-id; data-state = applies | partly | skipped), a skip inside one (data-code)
  rows: 'teach-rows', row: 'teach-row', rowSkip: 'teach-row-skip',
  // honest lines: the look is not previewed here (C13), same steps not the same look (with the paste-attributes pointer), the light warning
  lookNoPreview: 'teach-look-no-preview', sameSteps: 'teach-same-steps', lightWarning: 'teach-light-warning',
  // «החלה על N קליפים», a refusal beside it, a stale revision «הפרויקט השתנה — בדקו שוב»
  apply: 'teach-apply', error: 'teach-error', stale: 'teach-stale',
} as const;
export type TeachTestId = (typeof TEACH_TESTIDS)[keyof typeof TEACH_TESTIDS];
