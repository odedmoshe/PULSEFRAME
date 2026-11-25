/**
 * Find and replace (wave 7 craft; craft-plan.md §4.3 and "Corrected" C4). W1 BUILDS THIS. Pure, integer code points only, so
 * Node and Chromium agree (findReplace.golden.json, run in both: proof F8).
 * - Marks: commandBar/normalize.ts HEBREW_MARKS (the one fold table; no second one). Direction and joiner characters
 *   (BIDI_CONTROLS) are ALWAYS ignored in matching; on replace, isolates and embeddings inside the run are kept, in order,
 *   after the new text (a title's isolates stay paired). Presentation forms U+FB1D–U+FB4F are not folded.
 * - finalsEqual: ך ם ן ף ץ = כ מ נ פ צ. Always ״ = ", ׳ = ', ־ = -. ignoreCase folds A–Z only. No stemming, no prefixes.
 * - wholeWord: the characters before and after are not a Hebrew letter, a Latin letter or a digit (׳ and ״ between letters
 *   are part of the word). Text inside {…} field tokens (fields.ts parseFields) is masked.
 * - Carriers: title text, manual cue text, transcript phrases, and per format overrides[clipId].text and phraseText — what
 *   variants.ts projectVariant substitutes — in every sequence; matches grouped by sequence, kind, format.
 * - The one labelled check (a rule, not a correction): a final-form letter directly followed by a Hebrew letter (final_mid_word).
 */
import type { ProjectDocument } from './schema.ts';
import { CraftNotBuilt, type FindQuery, type ReplacePlan, type TextMatch } from './craftContract.ts';

export type MatchFlags = Pick<FindQuery, 'wholeWord' | 'ignoreMarks' | 'finalsEqual' | 'ignoreCase'>;
/** The [start, end) code-unit ranges of `needle` in `text`, left to right, not overlapping. */
export function matchText(text: string, needle: string, flags: MatchFlags): [number, number][] {
  void text; void needle; void flags;
  throw new CraftNotBuilt('matchText');
}
/** Every match in the document under the query (at most CRAFT_LIMITS.findMatches; the server reports the total). */
export function findText(doc: ProjectDocument, query: FindQuery): TextMatch[] {
  void doc; void query;
  throw new CraftNotBuilt('findText');
}
/** The replace_text edits for the matches (all, or the picked indices of findText's list), with the notes said before the commit. */
export function planReplace(doc: ProjectDocument, query: FindQuery, replacement: string, picked?: readonly number[]): ReplacePlan {
  void doc; void query; void replacement; void picked;
  throw new CraftNotBuilt('planReplace');
}
