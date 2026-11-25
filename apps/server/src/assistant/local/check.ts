/**
 * The check of a LOCAL model answer (wave 7; assistant-decisions.md §4). BUILDER B: the body (it calls builder A's core
 * groundLocalAnswer and localPhrase). LEAD pre-pass: the signature.
 *
 * In order, the FIRST failure wins, as job failed invalid_model_output with the category and a FIXED sentence (nothing of the answer
 * is kept or logged): finish 'length' → cut_off; finish 'other' or no text → empty; not JSON → not_json; not core LocalAnswerSchema →
 * wrong_shape (the schema issue code only). Then groundLocalAnswer (core) drops what the owner did not say, and also a numeric slot
 * outside LOCAL_DECIMAL ('malformed') or a text slot with a quote, control or format character ('malformed'); intent 'none' succeeds
 * with phrase null; otherwise localPhrase(intent, slots, lang) must be non-null and barUnderstands(phrase) true, else not_a_command.
 */
import type { AssistantLocalOutput, LocalInvalidCategory } from '@pulseframe/core';
import type { LocalChatResponse } from '@pulseframe/providers';

export type LocalAnswerCheck =
  | { ok: true; output: Omit<AssistantLocalOutput, 'model' | 'wallMs'> }
  | { ok: false; category: LocalInvalidCategory; reason: string };

export function checkLocalAnswer(res: LocalChatResponse, request: string, lang: 'he' | 'en'): LocalAnswerCheck {
  void res; void request; void lang;
  throw new Error('checkLocalAnswer is not built yet (builder B, wave 7 assistant)');
}
