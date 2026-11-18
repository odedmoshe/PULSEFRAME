/**
 * Fixed data-testids of shorts in the editor (ADR-0018), shared by the editor components and the proofs
 * (editor-interactions-proof.ts, a11y-audit.ts, shorts-proof.ts). Lead contracts commit: W3 puts exactly these on the elements
 * named here and does not rename them. A repeated element repeats its id and carries the data-* attribute named beside it.
 */
export const SHORTS_TESTIDS = {
  // the sequence switcher above the timeline (role=tablist; hidden while the project has one sequence): the list, each tab
  // (data-sequence-id, aria-selected), the main tab, a tab's delete button, the confirmation dialog (aria-modal) and its buttons
  switcher: 'sequence-switcher', tab: 'sequence-tab', tabMain: 'sequence-tab-main', tabDelete: 'sequence-tab-delete',
  deleteDialog: 'sequence-delete-dialog', deleteConfirm: 'sequence-delete-confirm', deleteCancel: 'sequence-delete-cancel',
  // the Shorts panel (inspector tab 'shorts'): the panel, and each of its four steps (data-step = settings | measure | review | plan)
  panel: 'shorts-panel', step: 'shorts-step',
  // step 1, settings: file, length chips (data-seconds = 15 | 30 | 45 | 60 | 90), count, context, include / exclude words,
  // tighten pauses / fillers, caption look (an option needing word timing is disabled with its reason), format profile,
  // reframe source (data-source = auto | track | centre | backdrop), motion track, loudness
  asset: 'shorts-asset', lengthChip: 'shorts-length', count: 'shorts-count', context: 'shorts-context', include: 'shorts-include', exclude: 'shorts-exclude',
  tightenPauses: 'shorts-tighten-pauses', tightenFillers: 'shorts-tighten-fillers', captionLook: 'shorts-caption-look', format: 'shorts-format',
  reframeSource: 'shorts-reframe-source', motionTrack: 'shorts-motion-track', loudness: 'shorts-loudness',
  // step 2, measure: the button, the role=progressbar with its text, the honest states and their actions
  measure: 'shorts-measure', progress: 'shorts-progress', noTranscript: 'shorts-no-transcript', transcribe: 'shorts-transcribe',
  noScenes: 'shorts-no-scenes', findCuts: 'shorts-find-cuts', trackingUnavailable: 'shorts-tracking-unavailable',
  // step 3, the review list (<ol>): a candidate (<article>, data-candidate-id, data-rank), its relative score and the «?»
  // disclosure with the component percentiles, a reason chip (data-code), a warning (data-code), its selection, the excluded
  // windows, and the aria-live region that announces each moved edge
  list: 'shorts-list', candidate: 'shorts-candidate', score: 'shorts-score', scoreDetails: 'shorts-score-details', reason: 'shorts-reason',
  warning: 'shorts-warning', select: 'shorts-select', excluded: 'shorts-excluded', live: 'shorts-live',
  // step 4, the plan dialog: the button that plans, the dialog, its steps, operation count, warnings (data-code), and «צור N קטעים»
  plan: 'shorts-plan', planDialog: 'shorts-plan-dialog', planSteps: 'shorts-plan-steps', planOps: 'shorts-plan-ops', planWarning: 'shorts-plan-warning', create: 'shorts-create',
  // the built shorts (data-sequence-id): the list, a row, open, rebuild, export (data-format = mp4 | png), delete
  built: 'shorts-built', builtRow: 'shorts-built-row', open: 'shorts-open', rebuild: 'shorts-rebuild', export: 'shorts-export', remove: 'shorts-remove',
  // a platform preset field without a dated source («לא אומת»; every field until wave 2)
  unverified: 'shorts-unverified',
  // a placeholder of this pre-pass: the part is not built yet (removed by W3)
  notBuilt: 'shorts-not-built',
} as const;
export type ShortsTestId = (typeof SHORTS_TESTIDS)[keyof typeof SHORTS_TESTIDS];
