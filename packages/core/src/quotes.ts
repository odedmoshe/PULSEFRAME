/**
 * Quote titles (ADR-0018, SPEC.md:678-680): a title given as a quote must be a contiguous run of the excerpt's transcript
 * words. Both sides are split into words at spaces and at the Hebrew maqaf and dashes, and each word is compared as a
 * fillers.ts bareWord token, except that a decimal point between two digits is kept: vowel points (niqqud), gershayim and
 * geresh (צה״ל = צה"ל = צהל), quotation marks and other punctuation do not count; letters, digits and decimals do. Nothing
 * is reworded, reordered, added or left out inside the run.
 */
import { bareWord } from './fillers.ts';

const DIGIT = /\p{N}/u;
/** One word as bareWord compares it, with a decimal point or comma between two digits kept as '.' ("3.5" is not "35"). */
function token(word: string): string {
  const s = word.normalize('NFKC');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if ((c === '.' || c === ',') && DIGIT.test(s[i - 1] ?? '') && DIGIT.test(s[i + 1] ?? '')) out += '.';
    else out += bareWord(c);
  }
  return out;
}
/** Splits at whitespace, the maqaf (U+05BE), the hyphen and the dashes U+2010–U+2015. */
const WORD_BREAK = /[\s־‐-―-]+/u;
/** Words of a text as comparison tokens; tokens that are punctuation only are dropped. */
export const verbatimTokens = (text: string): string[] => text.split(WORD_BREAK).map(token).filter((w) => w.length > 0);

/** True when `text` is a contiguous run of `words` (compared as verbatimTokens); an empty quote is never verbatim. */
export function isVerbatim(text: string, words: readonly { text: string }[]): boolean {
  const want = verbatimTokens(text);
  if (!want.length) return false;
  const have = words.flatMap((w) => verbatimTokens(w.text));
  outer: for (let i = 0; i + want.length <= have.length; i++) {
    for (let j = 0; j < want.length; j++) if (have[i + j] !== want[j]) continue outer;
    return true;
  }
  return false;
}
