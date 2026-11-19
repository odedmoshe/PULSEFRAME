/** The family film's wording (ADR-0026): every code has Hebrew and English wording, the numbers are said, and the forbidden words and the AI rule hold. */
import { describe, expect, it } from 'vitest';
import { FAMILY_FILM_DRAFT_LABEL, FILM_EXCLUSION_CODES, FILM_FORBIDDEN_WORDS, FILM_FORBIDDEN_WORDS_HE, FILM_REASON_CODES, FILM_WARNING_CODES, type FilmExclusion, type FilmReason, type FilmWarning } from '@pulseframe/core';
import { familyFilmStrings, num1, type FamilyFilmStrings } from './familyFilm.strings.ts';
import { exclusionText, reasonText, warningText } from './familyFilm.logic.ts';

const HEB = /[֐-׿]/;
const reasons: FilmReason[] = FILM_REASON_CODES.map((code) => ({ code, fromSecond: 4, toSecond: 7.5, value: 9.3 }));
const exclusions: FilmExclusion[] = FILM_EXCLUSION_CODES.map((code) => ({ assetId: 'a', code, details: { seconds: 0.8 } }));
const warnings: FilmWarning[] = FILM_WARNING_CODES.map((code) => ({ code, message: 'x', details: { seconds: 52.5 } }));

/** Every string the table can say: the plain ones, and the functions called with sample values. */
function everything(S: FamilyFilmStrings): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') {
      for (const args of [[1, 2, 3], ['x', 'y', 4], [null, null, 2.5], [60, 1, 2], ['name']]) { try { const r = (v as (...a: unknown[]) => unknown)(...args); if (typeof r === 'string') out.push(r); } catch { /* wrong sample */ } }
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(S);
  reasons.forEach((r) => out.push(S.reason(r))); exclusions.forEach((e) => out.push(S.exclusion(e))); warnings.forEach((w) => out.push(S.warning(w)));
  return out;
}

describe('family film strings', () => {
  it('says every reason, exclusion and warning code in Hebrew and in English', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const r of reasons) { const t = reasonText(r, lang); expect(t.length, `${lang} ${r.code}`).toBeGreaterThan(2); expect(HEB.test(t), `${lang} ${r.code}`).toBe(lang === 'he'); }
      for (const e of exclusions) { const t = exclusionText(e, lang); expect(t.length, `${lang} ${e.code}`).toBeGreaterThan(2); expect(HEB.test(t)).toBe(lang === 'he'); }
      for (const w of warnings) { const t = warningText(w, lang); expect(t.length, `${lang} ${w.code}`).toBeGreaterThan(2); expect(HEB.test(t)).toBe(lang === 'he'); }
    }
  });
  it('renders the seconds and the dB values of a reason', () => {
    expect(reasonText({ code: 'inner_motion', fromSecond: 4, toSecond: 7, value: 40, unit: 'permille' }, 'he')).toBe('תנועה בתוך התמונה בשניות 4–7');
    expect(reasonText({ code: 'sound_burst', fromSecond: 5.2 }, 'he')).toBe('פרץ קול בשנייה 5.2');
    expect(reasonText({ code: 'loud_sound', value: 9, unit: 'db' }, 'he')).toBe('קול חזק מהרגיל בקליפ (+9 dB)');
    expect(reasonText({ code: 'loud_sound', value: 9.3, unit: 'db' }, 'en')).toContain('+9.3 dB');
    expect(reasonText({ code: 'measured_moment', fromSecond: 2, toSecond: 5.5 }, 'en')).toContain('2–5.5');
    expect(reasonText({ code: 'active_throughout', value: 22, unit: 'permille' }, 'he')).toContain('22');
    expect(reasonText({ code: 'sharp', value: 1.3, unit: 'ratio' }, 'he')).toContain('1.3');
    expect(warningText({ code: 'shorter_than_target', message: '', details: { seconds: 52.5 } }, 'he')).toContain('52.5');
    expect(exclusionText({ assetId: 'a', code: 'too_short', details: { seconds: 0.8 } }, 'en')).toContain('0.8');
    expect(num1(4)).toBe('4'); expect(num1(-0.04)).toBe('0');
  });
  it('never says score, best, quality, viral, «ציון» or «הכי טוב»', () => {
    for (const lang of ['he', 'en'] as const) for (const s of everything(familyFilmStrings(lang))) { expect(FILM_FORBIDDEN_WORDS.test(s), s).toBe(false); expect(FILM_FORBIDDEN_WORDS_HE.test(s), s).toBe(false); }
  });
  it('uses «בינה מלאכותית» / AI only in the fixed "not AI" disclaimer', () => {
    const ai = /בינה מלאכותית|\bAI\b/;
    const disclaimer = /(?:בלי|לא) בינה מלאכותית|\b(?:no|not an?) AI\b/;
    let seen = 0;
    for (const lang of ['he', 'en'] as const) for (const s of [...everything(familyFilmStrings(lang)), FAMILY_FILM_DRAFT_LABEL[lang]]) if (ai.test(s)) { seen++; expect(disclaimer.test(s), s).toBe(true); }
    expect(seen).toBeGreaterThan(2);
  });
  it('has the measuring line and the footer of the plan', () => {
    expect(familyFilmStrings('he').measuring(12, 31)).toBe('מודד רגעים 12/31 · היוריסטיקה, בלי בינה מלאכותית');
    expect(familyFilmStrings('he').footer(28, 58.4)).toBe('28 קליפים · 58.4 שנ׳');
    expect(familyFilmStrings('he').tooMany(60)).toBe('יותר מ־60 קבצים: אפשר לבחור עד 60');
    expect(familyFilmStrings('he').excludedCount(7)).toBe('לא נכנסו (7)');
    expect(familyFilmStrings('he').underWithoutMusic).toBe('הקול המקורי בעוצמה מלאה');
  });
  it('has the same shape in both languages', () => {
    const shape = (v: unknown): unknown => (typeof v === 'string' ? 's' : typeof v === 'function' ? 'f' : Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, shape(x)])));
    expect(shape(familyFilmStrings('en'))).toEqual(shape(familyFilmStrings('he')));
  });
});
