/**
 * Search keys of the library catalogue (wave 7 library track). WORKER A builds the bodies; signatures are the lead's.
 * String operations only, so Node (the index) and Chromium (the editor's highlighting) agree.
 *
 * searchKey(text): NFKD; drop Hebrew points and cantillation (U+0591–U+05C7) and Latin combining marks; final letters to their
 *   base form (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ); lower case; every run of punctuation or space to one space; trimmed.
 * heQueryForms(token): the token, and — a HEURISTIC, labelled as one in the UI — when it has ≥ 4 letters and starts with one of
 *   ה ו ב ל מ ש כ, the token without that first letter. Deterministic, at most two forms.
 * LIBRARY_WORDS_HE: our own Hebrew words for common English tags (genre, mood, instrument, sound category); used at index time
 *   and for chip labels. Unreviewed Hebrew is listed in docs/OWNER_REVIEW.he.md by the worker.
 */
export function searchKey(text: string): string {
  void text;
  throw new Error('searchKey is not built yet (library worker A)');
}
export function heQueryForms(token: string): string[] {
  void token;
  throw new Error('heQueryForms is not built yet (library worker A)');
}
/** English tag (lower case) → Hebrew word. Worker A fills it (about 150 rows). */
export const LIBRARY_WORDS_HE: Readonly<Record<string, string>> = {};
