/**
 * «מה יש בקליפ» — validating a describer's reply (wave 8 `understand`; plan §3.4 "Validation", verify C12). LEAD PRE-PASS: the
 * signature; BUILDER W2 (opus) owns this file and writes the body. Pure; nothing is repaired or translated:
 * - the reply parses as ONE JSON object (one ``` fenced block is unwrapped, nothing else); unknown keys → invalid_reply
 *   (DescribeReplySchema is strict); at least one caption;
 * - captionHe / tagsHe are kept only when they hold a Hebrew letter (else dropped, never translated); lengths cut to
 *   UNDERSTAND_LIMITS (a string over a limit is cut at a word boundary, an array to its first items); empty strings dropped;
 * - finish 'length' → reply_cut (no retry in v1: the reply limit is already 800, decision 4); 'refusal' → refused;
 * - the result is a described NoteSpan's fields, or the failure reason. A failed span is stored failed — never filled in.
 */
import { UnderstandNotBuilt, type NoteFailure, type NoteSpan } from './understandContract.ts';

export type DescribeFields = Pick<NoteSpan, 'caption' | 'tags' | 'text' | 'size'>;
export function validateDescribeReply(_raw: string | null, _finish: 'tool' | 'stop' | 'length' | 'refusal' | 'other'): { ok: true; fields: DescribeFields } | { ok: false; why: NoteFailure } {
  throw new UnderstandNotBuilt('validateDescribeReply');
}
