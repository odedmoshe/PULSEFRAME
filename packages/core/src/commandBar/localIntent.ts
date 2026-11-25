/**
 * The local language assistant's answer → one bar phrase (wave 7; .artifacts/wave7/assistant-decisions.md §4). Pure, deterministic
 * (no clock, no random source, no DOM, no i18n import), the same in Node and the browser. LEAD pre-pass: the signatures; BUILDER A
 * writes the bodies and flips LOCAL_INTENT_BUILT.
 *
 * groundLocalAnswer keeps only what the owner said: a numeric slot (LOCAL_NUMERIC_SLOTS) stays only when its exact decimal value is
 * read by the grammar's own parseNumber / parseTime at some position of tokenizeBar(request) (so «שש» grounds "6", «וחצי» grounds the
 * .5 of a time, and «הרביעית», which the grammar asks about, grounds nothing); a text slot stays only when it is an exact substring of
 * the NFC request, holds no quote, control or format character and is at most LOCAL_TEXT_SLOT_MAX long; an enum slot stays when the
 * intent takes it; a slot the intent does not take is 'not_for_intent'; a numeric slot outside LOCAL_DECIMAL is 'malformed'. Nothing is
 * ever added or changed: a dropped slot makes the grammar ask (incomplete), it is never filled by a default.
 *
 * localPhrase renders the kept slots in the bar's own words (Hebrew or English templates), or null when no phrase of the grammar fits
 * (e.g. mute with target 'clip', which the grammar does not read). Every non-null phrase must satisfy barUnderstands(phrase) and, read
 * with interpret(phrase, ctxFor(intent)), give that intent (localIntent.test.ts, a table over every intent × slot combination).
 */
import type { LocalAnswer, LocalDropReason, LocalIntent, LocalSlotName, LocalSlots } from '../assistantContract.ts';

/** True once builder A's bodies are in (the server's local branch refuses honestly until then). */
export const LOCAL_INTENT_BUILT = false;

export interface GroundedAnswer { intent: LocalAnswer['intent']; slots: LocalSlots; dropped: { slot: LocalSlotName; why: LocalDropReason }[] }

export function groundLocalAnswer(request: string, answer: LocalAnswer): GroundedAnswer {
  void request; void answer;
  throw new Error('groundLocalAnswer is not built yet (builder A, wave 7 assistant)');
}

export function localPhrase(intent: LocalIntent, slots: LocalSlots, lang: 'he' | 'en'): string | null {
  void intent; void slots; void lang;
  throw new Error('localPhrase is not built yet (builder A, wave 7 assistant)');
}
