/**
 * Fixed data-testids of the family film maker (ADR-0026), shared by the film components and the proofs (family-film-proof.ts,
 * a11y-audit.ts). Lead contract: W3 puts exactly these on the elements named here and does not rename them; a repeated element
 * (a plan row, an excluded clip) repeats its id and carries a data-* attribute (data-asset-id, data-key, data-code).
 */
export const FILM_TESTIDS = {
  // the entry (FamilyFilmEntry; data-variant = event-card | start-hub | palette) and the dialog with its three steps
  open: 'film-open', dialog: 'film-dialog', close: 'film-close',
  stepWhat: 'film-step-what', stepLength: 'film-step-length', stepPlan: 'film-step-plan', next: 'film-next', back: 'film-back',
  // step 1 «מה בסרט»: a clip of the grid (data-asset-id) with its checkbox, the count and length line, the over-the-limit message
  clip: 'film-clip', clipCheck: 'film-clip-check', count: 'film-count', tooMany: 'film-too-many',
  // step 2 «אורך ומוזיקה»: length, music (a sound file: data-asset-id), no music, the inline «מדידת קצב», sound mix, order, title
  length30: 'film-length-30', length60: 'film-length-60', length90: 'film-length-90',
  music: 'film-music', musicNone: 'film-music-none', musicMeasureBeats: 'film-music-measure-beats',
  soundUnder: 'film-sound-under', soundLead: 'film-sound-lead', soundMute: 'film-sound-mute',
  orderCapture: 'film-order-capture', orderGiven: 'film-order-given', orderArc: 'film-order-arc',
  titleField: 'film-title-field',
  // step 3 «התוכנית»: the measurement row (role=status) and its cancel, a plan row (data-key, data-asset-id), its reason line,
  // its strip, its three buttons, the «לא נכנסו (n)» disclosure, an excluded clip (data-asset-id, data-code) and its «הכנסה»,
  // a warning (data-code), the footer line with the draft label, the primary button, a refusal next to its control
  measureProgress: 'film-measure-progress', measureCancel: 'film-measure-cancel',
  planRow: 'film-plan-row', reason: 'film-reason', strip: 'film-strip', swapWindow: 'film-swap-window', swapClip: 'film-swap-clip', remove: 'film-remove',
  excludedToggle: 'film-excluded-toggle', excluded: 'film-excluded', include: 'film-include', warning: 'film-warning',
  footer: 'film-footer', apply: 'film-apply', error: 'film-error', retry: 'film-retry',
  // after apply: the film bar and its actions; the inspector section of a film clip and its two swaps
  bar: 'film-bar', barUndo: 'film-bar-undo', barMoments: 'film-bar-moments', barLength: 'film-bar-length', barWhy: 'film-bar-why', barWhyList: 'film-bar-why-list',
  why: 'film-why', whyReason: 'film-why-reason', whyEdited: 'film-why-edited', whyWindow: 'film-why-window', whyClip: 'film-why-clip', whyMeasure: 'film-why-measure',
} as const;
export type FilmTestId = (typeof FILM_TESTIDS)[keyof typeof FILM_TESTIDS];
