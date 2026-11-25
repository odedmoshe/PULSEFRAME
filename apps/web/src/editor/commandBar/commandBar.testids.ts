/**
 * Fixed data-testids and DOM ids of the command bar (ADR-0027), shared by the bar and the proofs (command-bar-proof.ts,
 * a11y-audit.ts). Lead contracts commit: W3 puts exactly these on the elements named here and does not rename them. A
 * repeated element repeats its id and carries the data-* attribute named beside it.
 */
export const COMMAND_BAR_TESTIDS = {
  // the grammar's answer: the FIRST role=option of the palette's listbox, DOM id BAR_DOM_IDS.result, active by default;
  // data-kind = plan | action | ambiguous | incomplete | refused | unknown, data-intent, data-plan-hash (plans only)
  result: 'bar-result',
  // the preview panel the input's aria-describedby names (DOM id BAR_DOM_IDS.preview): «הבנתי:» with the understood words,
  // one step per op (data-op, data-detail = the StepDetail kind), one note per rule (data-code), the footer
  preview: 'bar-preview', understood: 'bar-understood', unread: 'bar-unread', step: 'bar-step', note: 'bar-note', footer: 'bar-footer',
  // an ambiguous request: each reading its own role=option (data-index, DOM id BAR_DOM_IDS.choice(i)) with its own preview
  choice: 'bar-choice',
  // incomplete (data-missing), refused (data-code; data-op-code for an op's own refusal) and unknown
  incomplete: 'bar-incomplete', refused: 'bar-refused', unknown: 'bar-unknown',
  // a nearest command offered under an unknown request (role=option, data-command-id or data-intent), at most 5
  nearest: 'bar-nearest',
  // the server's English words beside a refusal that has no Hebrew wording, marked «בלשון השרת, לא תורגם» (lang=en)
  untranslated: 'bar-untranslated',
  // «הפרויקט השתנה — בדקו שוב» after a 409 (the plan was made again)
  stale: 'bar-stale',
  // the one polite live region of the dialog (role=status aria-live=polite)
  live: 'bar-live',
  // the assistant's row in the palette (kept from before the bar: «עוזר השפה לא מחובר» until it is set up), its «איך מחברים»
  // link, its job stage (data-stage, never a percentage), its proposal preview with accept / reject; while a request is pending,
  // «ביטול הבקשה» (a button of the owner's session), and after it the canceled state in words (data-sent = true when the
  // request had already been handed to the service)
  assistantRow: 'palette-assistant', assistantConnect: 'bar-assistant-connect', assistantStage: 'bar-assistant-stage',
  assistantCancel: 'bar-assistant-cancel', assistantCanceled: 'bar-assistant-canceled',
  assistantProposal: 'bar-assistant-proposal', assistantAccept: 'bar-assistant-accept', assistantReject: 'bar-assistant-reject',
  // releasing an amount held for a request whose cost is not known (owner's session; ReleaseHeld.tsx): the button (data-job, on the
  // canceled or failed row and on each held amount in Settings), its confirmation dialog with «להשאיר בספירה» (the first focus) and
  // «שחרור הסכום», a refusal inside it, and the sentence that says what the release did (role=status; data-job)
  releaseHeld: 'assistant-release', releaseDialog: 'assistant-release-dialog', releaseKeep: 'assistant-release-keep', releaseConfirm: 'assistant-release-confirm',
  releaseRefused: 'assistant-release-refused', released: 'assistant-released',
  // Settings: the held amounts of the month, one row each (data-job, data-how)
  settingsHeld: 'assistant-held', settingsHeldRow: 'assistant-held-row',
  // Settings: the «עוזר השפה» section (owner session only), its fields, the key (a password field, never shown back), «מה נשלח?»
  settings: 'assistant-settings', settingsAdapter: 'assistant-adapter', settingsHost: 'assistant-host', settingsModel: 'assistant-model',
  settingsKey: 'assistant-key', settingsKeyState: 'assistant-key-state', settingsKeyRemove: 'assistant-key-remove',
  settingsPriceIn: 'assistant-price-in', settingsPriceOut: 'assistant-price-out', settingsMonthly: 'assistant-monthly-limit', settingsCap: 'assistant-request-cap',
  settingsSpent: 'assistant-spent', settingsToggleTitles: 'assistant-send-titles', settingsTogglePeople: 'assistant-send-people',
  settingsWhatIsSent: 'assistant-what-is-sent', settingsSetup: 'assistant-setup',
  // a refusal of a Settings save (owner_required, host_not_allowed, a price of 0…) in words, with its next step
  settingsRefused: 'assistant-refused',
  // ---- the LOCAL language assistant (wave 7; .artifacts/wave7/assistant-decisions.md §4) ----
  // Settings (shown when the adapter is «מודל מקומי על המחשב הזה»): the port, the time limit, «בדיקת חיבור», its result (data-state =
  // core LOCAL_RUNTIME_STATES), the model name it reported, the fixed «לא נמדדו» note, the link to the guide
  assistantLocalSettings: 'assistant-local-settings', assistantLocalPort: 'assistant-local-port', assistantLocalTimeout: 'assistant-local-timeout',
  assistantLocalCheck: 'assistant-local-check', assistantLocalState: 'assistant-local-state', assistantLocalModel: 'assistant-local-model',
  assistantLocalUnmeasured: 'assistant-local-unmeasured', assistantLocalGuide: 'assistant-local-guide',
  // the row under an 'unknown' result: «לשאול את העוזר המקומי» (role=option), the suggestion «העוזר הציע: …» (data-intent; the phrase
  // in one dir=auto span), «הכנס לשורה» and «התעלם»; and the badge «הצעת העוזר — בדקו לפני Enter» beside the input until the first edit
  assistantLocalAsk: 'bar-assistant-local-ask', assistantLocalSuggestion: 'bar-assistant-local-suggestion',
  assistantLocalInsert: 'bar-assistant-local-insert', assistantLocalIgnore: 'bar-assistant-local-ignore', assistantLocalBadge: 'bar-assistant-suggested',
} as const;
export type CommandBarTestId = (typeof COMMAND_BAR_TESTIDS)[keyof typeof COMMAND_BAR_TESTIDS];
/** DOM ids: the result row is an option of the palette (CommandPalette.tsx optionDomId('bar')), the preview is what the input's aria-describedby names. */
export const BAR_DOM_IDS = {
  result: 'pf-palette-opt-bar',
  preview: 'pf-bar-preview',
  choice: (i: number) => `pf-palette-opt-bar-choice-${i}`,
  nearest: (i: number) => `pf-palette-opt-bar-near-${i}`,
} as const;
/** The palette's option keys of the bar (CommandPalette.tsx: optionDomId(key) gives the DOM ids above). */
export const BAR_KEYS = { result: 'bar', choice: (i: number) => `bar-choice-${i}`, nearest: (i: number) => `bar-near-${i}` } as const;
/** The test hook the proof reads (window.__pfBar.lastPlan: the plan the preview shows, as JSON-safe data). */
export const BAR_TEST_HOOK = '__pfBar' as const;
