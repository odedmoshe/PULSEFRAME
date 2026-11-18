/**
 * Quote titles (ADR-0018, SPEC.md:678-680): a title given as a quote must be a contiguous run of the excerpt's transcript
 * words, compared as fillers.ts bareWord tokens (niqqud, gershayim and punctuation do not count). W1 builds the body; this
 * pre-pass fixes the signature and refuses honestly (it throws; it never says yes or no without checking).
 */
export function isVerbatim(_text: string, _words: readonly { text: string }[]): boolean {
  throw new Error('isVerbatim is not built yet (shorts W1)');
}
