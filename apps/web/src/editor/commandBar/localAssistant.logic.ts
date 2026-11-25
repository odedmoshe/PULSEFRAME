/**
 * The LOCAL language assistant in the editor (wave 7; .artifacts/wave7/assistant-decisions.md §4): pure logic for the Settings section
 * and the row. LEAD pre-pass: the signatures; BUILDER C writes the bodies (and the components in AssistantSettings.tsx /
 * AssistantRow.tsx, the insertion in useBarResult.ts) and flips LOCAL_UI_BUILT.
 *
 * The row is offered ONLY under a grammar result of kind 'unknown' (the grammar first; the server refuses anything else with 409
 * grammar_understood). «הכנס לשורה» sets the bar's input to the phrase (caret at the end), shows the badge until the first edit, and
 * calls POST /assistant/jobs/:jobId/taken; «התעלם» calls taken too. The phrase goes through the bar's own interpret → preview → Enter →
 * commitExact; nothing is committed from the row itself. The phrase is shown in ONE dir="auto" span, never concatenated.
 */
import type { AssistantLocalConfig, AssistantLocalOutput, BarResultKind } from '@pulseframe/core';

export const LOCAL_UI_BUILT = false;

/** The row's state, from the bar's result and the local job (null = no request yet). */
export type LocalRowState =
  | { kind: 'hidden' } | { kind: 'offer' } | { kind: 'pending'; stage: string | null }
  | { kind: 'suggested'; jobId: string; phrase: string; intent: string; dropped: boolean }
  | { kind: 'none'; jobId: string } | { kind: 'failed'; code: string; message: string } | { kind: 'canceled'; sent: boolean };

export function localRowState(barKind: BarResultKind | null, job: { id: string; status: string; stage: string | null; output: unknown; error: unknown; attempt?: number | null } | null): LocalRowState {
  void barKind; void job;
  throw new Error('localRowState is not built yet (builder C, wave 7 assistant)');
}
/** The Settings fields as typed → the config's `local`, or the reason in words (set.local.invalid). */
export function parseLocalSettings(port: string, timeoutSeconds: string): { ok: true; local: AssistantLocalConfig } | { ok: false } {
  void port; void timeoutSeconds;
  throw new Error('parseLocalSettings is not built yet (builder C, wave 7 assistant)');
}
/** Whether an output is a suggestion the row can put in the bar (not cleared, a phrase present). */
export function canInsert(o: AssistantLocalOutput | null): boolean {
  void o;
  throw new Error('canInsert is not built yet (builder C, wave 7 assistant)');
}
