/**
 * Fixed data-testids of «שליחה ושמירה» (wave 7, track send), shared by the editor and the proofs (send-*-proof.ts,
 * editor-interactions-proof.ts, a11y-audit.ts). Lead pre-pass: worker C puts exactly these on the elements named here and does
 * not rename them. A repeated element repeats its id and carries the data-* attribute named beside it. The destination tile keeps
 * its id `export-dest` with data-id `whatsapp` (command bar proof).
 */
export const SEND_TESTIDS = {
  /** SendSize: the radiogroup of target sizes (data-mb on each choice), the typed field, the fitted picture size before export, the refusal */
  size: 'send-size', sizeChoice: 'send-size-choice', sizeInput: 'send-size-input', sizeFitted: 'send-size-fitted', sizeRefusal: 'send-size-refusal',
  /** ChecksResult on the file card: the list, one row per finding (data-kind), its jump button */
  checks: 'export-checks', checkItem: 'export-check-item', checkJump: 'export-check-jump',
  /** the fit line on the file card («15.6 מתוך 16 מ״ב · ניסיון 1») */
  fitLine: 'export-fit-line',
  /** LoudnessMatch in the sound panel: the block, its run button, the per-clip result list (data-clip-id, data-limited-by) */
  match: 'loudness-match', matchRun: 'loudness-match-run', matchResult: 'loudness-match-result',
  /** LimiterSwitch in the sound panel's loudness section, and the meter's gain-reduction bar */
  limiter: 'master-limiter', limiterSwitch: 'master-limiter-switch', limiterCeiling: 'master-limiter-ceiling', meterReduction: 'meter-reduction',
  // ---- added by the integration pass: the further ids builder C put on the send UI (each on one element, used by the proofs) ----
  /** SendSize: «choose a size» note before one is chosen; the sheet's quality note on the send tile */
  sizePending: 'send-size-pending', qualityNote: 'send-quality-note',
  /** the export progress line while the fit runs (Hebrew stages) */
  fitStage: 'fit-stage',
  /** the findings in the status bar (StatusBar), ChecksResult's quiet state, the ruler mark of a finding (Timeline) */
  checksStatus: 'export-checks-status', checksQuiet: 'export-checks-quiet', checkMark: 'export-check-mark',
  /** Deliver panel: the send button, the recent export's fit line and findings count */
  deliverSend: 'deliver-send', deliverRecentFit: 'deliver-recent-fit', deliverRecentFound: 'deliver-recent-found',
  /** LoudnessMatch: the plan block, its target field, the per-clip preview, apply, undo, the refusal, the per-track button(s) */
  matchPlan: 'loudness-match-plan', matchTarget: 'loudness-match-target', matchPreview: 'loudness-match-preview', matchApply: 'loudness-match-apply', matchUndo: 'loudness-match-undo', matchError: 'loudness-match-error', matchTracks: 'loudness-match-tracks', matchTrack: 'loudness-match-track',
  /** LimiterSwitch: the honest state when the preview cannot load the limiter; the meter's note «לפני הגברת הייצוא» */
  limiterUnavailable: 'master-limiter-unavailable', beforeExportGain: 'meter-before-export-gain',
} as const;
export type SendTestId = (typeof SEND_TESTIDS)[keyof typeof SEND_TESTIDS];
