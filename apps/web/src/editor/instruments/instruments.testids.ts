/**
 * Fixed data-testids of «כלים מוקלטים» (wave 7 instruments track; .artifacts/wave7/instruments-decisions.md §4.9), shared by the
 * interface (builder W3) and the proofs (instruments-proof.ui.ts, the a11y rows the lead adds at integration). Lead contract: W3 puts
 * exactly these on the elements named here and does not rename them.
 */
export const INSTRUMENTS_TESTIDS = {
  /** «צליל» in a music row: the radiogroup, an option (data-choice = synth | recorded), the state line (data-state = a KitState) */
  choice: 'instruments-choice', choiceOption: 'instruments-choice-option', state: 'instruments-state',
  /** the badge «כלים מוקלטים — עוד לא הושמעו לאף אחד» (or the owner's mark with its date) */
  unheard: 'instruments-unheard',
  /** «השוואה עיוורת»: the toggle, «א» and «ב» (aria-pressed), «מה היה מה?», the level note */
  audition: 'instruments-audition', auditionA: 'instruments-audition-a', auditionB: 'instruments-audition-b', reveal: 'instruments-reveal', levelNote: 'instruments-level-note',
  /** the owner's «שמעתי» (rendered for every session; only the owner's mark is accepted by the server) */
  heard: 'instruments-heard',
} as const;
