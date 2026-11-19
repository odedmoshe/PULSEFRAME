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
  // link, its job stage (data-stage, never a percentage), its proposal preview with accept / reject
  assistantRow: 'palette-assistant', assistantConnect: 'bar-assistant-connect', assistantStage: 'bar-assistant-stage',
  assistantProposal: 'bar-assistant-proposal', assistantAccept: 'bar-assistant-accept', assistantReject: 'bar-assistant-reject',
  // Settings: the «עוזר השפה» section (owner session only), its fields, the key (a password field, never shown back), «מה נשלח?»
  settings: 'assistant-settings', settingsAdapter: 'assistant-adapter', settingsHost: 'assistant-host', settingsModel: 'assistant-model',
  settingsKey: 'assistant-key', settingsKeyState: 'assistant-key-state', settingsKeyRemove: 'assistant-key-remove',
  settingsPriceIn: 'assistant-price-in', settingsPriceOut: 'assistant-price-out', settingsMonthly: 'assistant-monthly-limit', settingsCap: 'assistant-request-cap',
  settingsSpent: 'assistant-spent', settingsToggleTitles: 'assistant-send-titles', settingsTogglePeople: 'assistant-send-people',
  settingsWhatIsSent: 'assistant-what-is-sent', settingsSetup: 'assistant-setup',
  // a refusal of a Settings save (owner_required, host_not_allowed, a price of 0…) in words, with its next step
  settingsRefused: 'assistant-refused',
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
