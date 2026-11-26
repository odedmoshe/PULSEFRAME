/**
 * Fixed data-testids of the in-editor agent «סוכן» (wave 8 autonomy Part 2; autonomy-plan.md §3 and §2.8 UI rows), shared by the tab
 * (W3) and the proofs (proof:editor-interactions rows, audit:a11y states agent-tab, agent-connect, agent-run). Lead contract: W3 puts
 * exactly these on the elements named here and does not rename or remove one (it may add ids at the end). A repeated element repeats
 * its id and carries a data-* attribute (data-n, data-status, data-provider, data-kind, data-code).
 */
export const AGENT_TESTIDS = {
  // the tab panel (replaces the empty «שיחה» panel once built; Copilot.tsx mount line)
  tab: 'agent-tab',
  // the goal box, «התחלה», «עצירה»
  goal: 'agent-goal', start: 'agent-start', cancel: 'agent-cancel',
  // the connect card «חיבור מודל»: one row per preset (data-provider), key field, base URL, model, «בדיקה», its answer (data-code),
  // the one line on what is sent, «החיבור לא מוצפן», «מחובר דרך נקודת הקצה התואמת», the small-local-model line, «מחיקת המפתח»
  connect: 'agent-connect', provider: 'agent-provider', key: 'agent-key', baseUrl: 'agent-base-url', model: 'agent-model', probe: 'agent-probe', probeResult: 'agent-probe-result',
  sentLine: 'agent-sent-line', unencrypted: 'agent-unencrypted', compat: 'agent-compat', localSmall: 'agent-local-small', forgetKey: 'agent-forget-key',
  // the live run: the header line (status + WHY, data-status), «צעד N מתוך M», cost / tokens, the plan and its items (data-status)
  run: 'agent-run', status: 'agent-status', counter: 'agent-counter', cost: 'agent-cost', plan: 'agent-plan', planItem: 'agent-plan-item',
  // one row per step (data-n, data-kind, data-status), its expandable call (arguments and the answer), a picture it looked at
  step: 'agent-step', stepCall: 'agent-step-call', stepImage: 'agent-step-image',
  // «להמשיך עוד 100 צעדים» / «להמשיך», «ביטול הכול», «ביטול מה שאפשר», the conflict list, «לא בוטל: …» (one item per class, data-kind)
  continue: 'agent-continue', undoAll: 'agent-undo-all', undoPartial: 'agent-undo-partial', undoConflicts: 'agent-undo-conflicts', notUndone: 'agent-not-undone', notUndoneItem: 'agent-not-undone-item',
  // a refusal or provider failure line (data-code) and the list of earlier runs
  error: 'agent-error', runs: 'agent-runs',
} as const;
export type AgentTestId = (typeof AGENT_TESTIDS)[keyof typeof AGENT_TESTIDS];
