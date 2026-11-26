/**
 * Fixed data-testids of «קליפ מקוד» (wave 8 motioncode), shared by the interface (W3) and the proofs (made-proof.ts, the a11y states
 * made-dialog and made-result the lead adds at integration). Lead contract: W3 puts exactly these on the elements named here.
 */
export const MADE_TESTIDS = {
  /** «קליפ מקוד» in the Text pane of the browser drawer (Library.tsx), after «הוספת טקסט»; mounted only once MADE_UI_BUILT */
  entry: 'made-entry',
  /** the dialog (role dialog); data-mode = new | edit */
  dialog: 'made-dialog',
  /** a built-in page tile (radio; `made-tile-<templateId>`) */
  tile: (id: string) => `made-tile-${id}`,
  /** a field input (`made-field-<key>`) and the length select */
  field: (key: string) => `made-field-${key}`, length: 'made-length',
  /** «הדבקת דף (מתקדם)»: the disclosure, its textarea, its warning list */
  paste: 'made-paste', pasteText: 'made-paste-text', pasteWarnings: 'made-paste-warnings',
  /** «יצירה», the progress line (aria-live polite, at most every 2 s) */
  render: 'made-render', progress: 'made-progress',
  /** the result region: three stills, the paused <video> with its play button (never autoplays), the check lines, the honest line */
  result: 'made-result', still: (k: number) => `made-still-${k}`, video: 'made-video', play: 'made-play', checks: 'made-checks', unseen: 'made-unseen',
  /** «הוספה לציר», «לספרייה בלבד», «עדכון בכל המקומות (N)», «ביטול» */
  place: 'made-place', library: 'made-library', replace: 'made-replace', cancel: 'made-cancel',
  /** the Inspector line of a made clip and its «עריכה ויצירה מחדש» */
  inspector: 'made-inspector', edit: 'made-edit',
} as const;
