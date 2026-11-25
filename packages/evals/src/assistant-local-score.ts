/**
 * The scorer of the local assistant's fixtures (wave 7; .artifacts/wave7/assistant-decisions.md §5 builder A). Pure. LEAD pre-pass:
 * the fixture shape and the signature; BUILDER A writes the body and the 51 fixtures (A29 B7 C5 D5 E5) in
 * packages/evals/fixtures/assistant-local-fixtures.json. A fixture whose text the grammar already reads (barUnderstands) is expected
 * as 'GRAMMAR': the server refuses it with grammar_understood and it is never sent (e.g. «תחתוך בשנייה הרביעית», which the bar asks
 * about itself).
 */
import type { LocalAnswerIntent, LocalSlots } from '@pulseframe/core';

export const LOCAL_FIXTURE_COUNT = 51;
export interface LocalFixture { id: string; text: string; lang: 'he' | 'en'; expect: { intent: LocalAnswerIntent; slots: LocalSlots } | 'ASK' | 'NONE' | 'GRAMMAR' }
export interface LocalScoreRow { id: string; valid: boolean; intentMatch: boolean; slotsMatch: boolean; wouldChange: boolean; droppedUngrounded: number; wallMs: number | null }

export function scoreLocalAnswer(fixture: LocalFixture, answerText: string | null, wallMs: number | null): LocalScoreRow {
  void fixture; void answerText; void wallMs;
  throw new Error('scoreLocalAnswer is not built yet (builder A, wave 7 assistant)');
}
