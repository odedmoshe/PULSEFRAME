/**
 * Fixed data-testids of «מה יש בקליפ» (wave 8 understand), shared by the interface (W3) and the proofs (understand-proof.ts check 17 and
 * the a11y states the lead adds at integration). Lead contract: W3 puts exactly these on the elements named here.
 */
export const UNDERSTAND_TESTIDS = {
  /** the list in the source viewer (SourceViewer.tsx, mounted only once UNDERSTAND_UI_BUILT): the panel, its state line (the only aria-live) and buttons */
  panel: 'understand-panel', state: 'understand-state', describe: 'understand-describe', stop: 'understand-stop', redescribe: 'understand-redescribe', undo: 'understand-undo',
  /** the list (role listbox; ArrowUp/Down, Home/End, Enter = the viewer there, Shift+Enter = insert at the playhead), a shot group and a span row (`understand-row-<i>`) */
  list: 'understand-list', shot: (i: number | string) => `understand-shot-${i}`, row: (i: number | string) => `understand-row-${i}`,
  /** inside a row: the time (<bdi dir="ltr">), the caption, the «באנגלית» chip, the on-screen text, the shot size, the model chip «תיאור של … · לא נבדק», the failure line */
  rowTime: 'understand-row-time', caption: 'understand-caption', otherLang: 'understand-other-lang', onScreen: 'understand-onscreen', size: 'understand-size', by: 'understand-by', failed: 'understand-failed',
  /** the line without a describing model (with the next step) and the shot detector's method line */
  setup: 'understand-setup', method: 'understand-method',
  /** the notes section of «חיפוש בצילומים» (search/FootageResults.tsx) */
  sectionNotes: 'footage-section-notes', notesState: 'footage-notes-state',
  /** Settings › «מה יש בקליפ» (SettingsDialog.tsx, mounted only once UNDERSTAND_UI_BUILT) */
  settings: 'settings-understand', auto: 'understand-auto', density: 'understand-density', describer: 'understand-describer', seeing: 'understand-seeing', frames: 'understand-frames', sends: 'understand-sends',
} as const;
