/**
 * Fixed data-testids of «בדיקה לפני ייצוא» (wave 8 qc), shared by the editor and the proofs (qc-proof.ts, editor-interactions-proof.ts,
 * a11y-audit.ts). Lead pre-pass: B2 puts exactly these on the elements named here and does not rename them; a repeated element
 * repeats its id and carries the data-* attribute named beside it. Existing ids stay (test-id policy: no id is deleted):
 * `export-preflight`, `export-check` (data-code, data-severity), `export-loudness`, `export-flash-pending`, `export-checks*`.
 */
export const QC_TESTIDS = {
  /** PreflightSummary: the one count line at the top of the sheet's section (blockers · warnings · notes · sound findings) */
  summary: 'export-preflight-summary',
  /** «מעבר לקטע» on every preflight row that has a range (data-frame = range.startFrame); closes the sheet and seeks */
  jump: 'export-preflight-jump',
  /** PreflightSound: the silence and clipped findings of the measurement of the CHOSEN output, before export; one row each (data-kind) and its jump */
  sound: 'export-preflight-sound', soundItem: 'export-preflight-sound-item', soundJump: 'export-preflight-sound-jump',
  /** the quiet state: «לא נמצא דבר לפי הבדיקות האלה» and the rules with their numbers (one line; no <details>, no check icon) */
  quietRules: 'export-preflight-quiet-rules',
  /** ExplainedFindings on the file card: the folded group «יש לזה הסבר בעריכה (n)», one row per explained finding (data-why = the reason) */
  explained: 'export-checks-explained', explainedItem: 'export-checks-explained-item',
} as const;
export type QcTestId = (typeof QC_TESTIDS)[keyof typeof QC_TESTIDS];
