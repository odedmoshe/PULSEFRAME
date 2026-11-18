/**
 * The family film's own strings (ADR-0026), Hebrew first and right to left; the shared fixed lines are i18n `film.*` and
 * `moments.*` (packages/i18n/src/familyFilm.ts). LEAD STUB, final signatures; W3 owns the wording and familyFilm.strings.test.ts:
 * every core FILM_REASON_CODES, FILM_EXCLUSION_CODES and FILM_WARNING_CODES value has Hebrew and English wording; no string
 * says «ציון», «הכי טוב», best, score, quality or viral, or «בינה מלאכותית» / AI outside the fixed "not AI" disclaimer
 * (core FILM_FORBIDDEN_WORDS, FILM_FORBIDDEN_WORDS_HE). Numbers are formatted here and rendered in <bdi>.
 */
import type { FilmExclusion, FilmReason, FilmWarning } from '@pulseframe/core';

export interface FamilyFilmStrings {
  steps: { what: string; length: string; plan: string };
  reason(r: FilmReason): string;
  exclusion(e: FilmExclusion): string;
  warning(w: FilmWarning): string;
  /** «28 קליפים · 58.4 שנ׳» */
  footer(clips: number, seconds: number): string;
  /** «מודד רגעים 12/31 · היוריסטיקה, בלי בינה מלאכותית» */
  measuring(done: number, total: number): string;
  /** «לא נכנסו (7)» */
  excludedCount(n: number): string;
  /** «יותר מ־60 קבצים: אפשר לבחור עד 60» */
  tooMany(max: number): string;
  /** the 'under' option without music: «הקול המקורי בעוצמה מלאה» */
  underWithoutMusic: string;
}
export function familyFilmStrings(lang: 'he' | 'en'): FamilyFilmStrings {
  void lang;
  throw new Error('familyFilmStrings: not built yet (family film W3)');
}
