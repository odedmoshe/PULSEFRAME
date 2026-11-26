/**
 * The check of a LOCAL model answer (wave 7; assistant-decisions.md §4). BUILDER B: the body (it calls builder A's core
 * groundLocalAnswer and localPhrase). LEAD pre-pass: the signature.
 *
 * In order, the FIRST failure wins, as job failed invalid_model_output with the category and a FIXED sentence (nothing of the answer
 * is kept or logged): finish 'length' → cut_off; finish 'other' or no text → empty; not JSON → not_json; not core LocalAnswerSchema →
 * wrong_shape (the schema issue code only). Then the server's own form rules, for each slot the intent takes: a numeric slot outside
 * LOCAL_DECIMAL, or a text slot with a quote, control, format or line-separator character, is dropped 'malformed' (the schema sent to
 * the model is pattern-free, so these are checked only here). Then groundLocalAnswer (core) drops what the owner did not say and the
 * slots the intent does not take; intent 'none' succeeds with phrase null; otherwise localPhrase(intent, slots, lang) must be non-null
 * and barUnderstands(phrase) true, else not_a_command.
 */
import {
  barUnderstands, groundLocalAnswer, LOCAL_DECIMAL, LOCAL_INTENT_SLOTS, LOCAL_NUMERIC_SLOTS, LocalAnswerSchema, localPhrase,
  type AssistantLocalOutput, type LocalAnswer, type LocalDropReason, type LocalInvalidCategory, type LocalSlotName, type LocalSlots,
} from '@pulseframe/core';
import type { LocalChatResponse } from '@pulseframe/providers';
import { ASSISTANT_LOCAL_SENTENCES } from '../contract.ts';

export type LocalAnswerCheck =
  | { ok: true; output: Omit<AssistantLocalOutput, 'model' | 'wallMs'> }
  | { ok: false; category: LocalInvalidCategory; reason: string; /** wrong_shape only: the first schema issue's code (a word of zod, never the answer's text) */ issue?: string };

/** Quotes of every kind the bar or Hebrew typing uses, control and format characters, and line or paragraph separators. */
const FORBIDDEN_IN_TEXT = /["'`׳״‘’‚‛“”„‟«»‹›\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const NUMERIC = new Set<string>(LOCAL_NUMERIC_SLOTS);

const refuse = (category: LocalInvalidCategory, issue?: string): LocalAnswerCheck => ({ ok: false, category, reason: ASSISTANT_LOCAL_SENTENCES.invalid.message(category), ...(issue ? { issue } : {}) });

/** The slots of the answer the intent takes whose FORM is wrong (the decimal rule, quotes and control characters): dropped 'malformed'. */
export function malformedSlots(answer: LocalAnswer): LocalSlotName[] {
  if (answer.intent === 'none') return [];
  const takes = new Set<string>(LOCAL_INTENT_SLOTS[answer.intent]);
  const out: LocalSlotName[] = [];
  for (const [name, value] of Object.entries(answer.slots) as [LocalSlotName, string | undefined][]) {
    if (value === undefined || !takes.has(name)) continue;
    if (NUMERIC.has(name) && !LOCAL_DECIMAL.test(value)) out.push(name);
    else if (name === 'text' && (FORBIDDEN_IN_TEXT.test(value) || value.trim() === '')) out.push(name);
  }
  return out;
}

export function checkLocalAnswer(res: LocalChatResponse, request: string, lang: 'he' | 'en'): LocalAnswerCheck {
  if (res.finish === 'length') return refuse('cut_off');
  if (res.finish !== 'stop' || res.text === null || res.text.trim() === '') return refuse('empty');
  let raw: unknown;
  try { raw = JSON.parse(res.text); } catch { return refuse('not_json'); }
  const parsed = LocalAnswerSchema.safeParse(raw);
  if (!parsed.success) return refuse('wrong_shape', parsed.error.issues[0]?.code ?? 'invalid');
  const answer = parsed.data;

  const malformed = malformedSlots(answer);
  const kept: LocalSlots = { ...answer.slots };
  for (const name of malformed) delete kept[name];
  const grounded = groundLocalAnswer(request, { intent: answer.intent, slots: kept });
  const dropped: { slot: LocalSlotName; why: LocalDropReason }[] = [...malformed.map((slot) => ({ slot, why: 'malformed' as const })), ...grounded.dropped];

  if (grounded.intent === 'none') return { ok: true, output: { kind: 'local-intent', intent: 'none', slots: {}, dropped, phrase: null } };
  const phrase = localPhrase(grounded.intent, grounded.slots, lang);
  if (phrase === null || !barUnderstands(phrase)) return refuse('not_a_command');
  return { ok: true, output: { kind: 'local-intent', intent: grounded.intent, slots: grounded.slots, dropped, phrase } };
}
