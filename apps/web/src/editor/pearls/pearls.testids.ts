/**
 * Fixed data-testids of the pearls surfaces «פנינים» (wave 7 pearls track; .artifacts/wave7/pearls-decisions.md §4), shared by the
 * interface (builder C) and the proofs (pearls-proof.ui.ts, a11y-pearls.ts). Lead contract: C puts exactly these on the elements
 * named here and does not rename them.
 */
export const PEARLS_TESTIDS = {
  /** the «פנינים» option of the media drawer's view switch (lifeline LIFE_TESTIDS.viewOption('pearls') is the same element) */
  view: 'pearls-view',
  /** the list (role listbox, roving focus); data-state = empty | list | not-built | refused */
  list: 'pearls-list', search: 'pearls-search', filterAll: 'pearls-filter-all', filterUnused: 'pearls-filter-unused',
  /** a person chip of the filter: data-person-id */
  filterPerson: 'pearls-filter-person',
  /** a row (data-range-id, data-used = 'yes' | 'no'), its usage line and its actions */
  row: 'pearl-row', rowUsage: 'pearl-row-usage', rowShow: 'pearl-show', rowAddEnd: 'pearl-add-end', rowInsert: 'pearl-insert', rowShort: 'pearl-short', rowDelete: 'pearl-delete',
  /** the source viewer: «שמור כפנינה» (P), the inline form (name, people chips, save, cancel) and the strip under the scrubber */
  save: 'pearl-save', form: 'pearl-form', formName: 'pearl-form-name', formPerson: 'pearl-form-person', formSubmit: 'pearl-form-submit', formCancel: 'pearl-form-cancel', strip: 'pearl-strip',
  /** the transcript panel's «שמור כפנינה» on the selected words */
  fromWords: 'pearl-from-words',
  /** «מי בקליפ?» in a library card's ⋯ menu, its dialog and a person box in it (data-person-id) */
  whoInClip: 'pearl-who-in-clip', whoDialog: 'pearl-who-dialog', whoPerson: 'pearl-who-person',
  /** «מי כמה בסרט» under the pacing report: the table, a person row (data-person-id), the untagged row, the label, «פנינים שלא בשימוש של …» */
  screenTime: 'screen-time', screenRow: 'screen-time-row', screenUntagged: 'screen-time-untagged', screenLabel: 'screen-time-label', screenUnused: 'screen-time-unused',
  /** the film dialog's choice «להעדיף פנינים» / «בלי פנינים» */
  filmChoice: 'film-pearls-choice',
} as const;
