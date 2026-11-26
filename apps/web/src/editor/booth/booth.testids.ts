/**
 * Fixed data-testids of «תא הבדיקה» (wave 8 booth pre-pass), shared by the interface (W2, W3) and the proofs (booth-proof.ui.ts, the
 * a11y state the lead adds at integration). Lead contract: the builders put exactly these on the elements named here and do not rename them.
 */
export const BOOTH_TESTIDS = {
  /** the rail button between «קיצורים» and «הגדרות» (owner's own session only; W3, BoothEntry.tsx) */
  rail: 'rail-booth',
  /** the dialog; its progress line («חלק ראשון: 0 מתוך 14», role=status); «דלגו לחלק הבא»; «עוד» */
  dialog: 'booth-dialog', progress: 'booth-progress', skipPart: 'booth-skip-part', more: 'booth-more',
  /** the self-check: run button, one row per check (data-check = id, data-state = BoothCheckState), a heavy row's own button, a next step's copy button */
  checkRun: 'booth-check-run', checkRow: 'booth-check-row', checkHeavyRun: 'booth-check-heavy-run', checkCopy: 'booth-check-copy',
  /** a card (data-item = item id, data-kind, data-state = BoothItemState); play/stop (aria-pressed); answers (data-verdict); «שוב»; prev/next */
  card: 'booth-card', play: 'booth-play', answer: 'booth-answer', again: 'booth-again', prev: 'booth-prev', next: 'booth-next',
  /** «מה לא טוב?» choices (data-problem), the note */
  problem: 'booth-problem', note: 'booth-note',
  /** picture card: the canvas (role=img), the export strip action and the strip */
  pictureCanvas: 'booth-picture-canvas', exportStripRun: 'booth-export-strip-run', exportStrip: 'booth-export-strip',
  /** mic card: record, play back, the measured peak and clipped count */
  micRecord: 'booth-mic-record', micPlay: 'booth-mic-play', micLevels: 'booth-mic-levels',
  /** the Windows graphics step */
  windowsStep: 'booth-windows-step',
  /** the report box (read-only) and «העתקת הדוח» */
  reportBox: 'booth-report-box', reportCopy: 'booth-report-copy',
  /** (integration, append-only) the picture card's own «הפעלה»: the sound card keeps `play` */
  picturePlay: 'booth-picture-play',
} as const;
