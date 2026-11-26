/** The teach strings (lead seed): both languages have the same keys, every part, reason and stop is worded, plural Hebrew, nothing forbidden. */
import { describe, expect, it } from 'vitest';
import { teachStrings, type TeachStrings } from './teach.strings.ts';

const flat = (S: TeachStrings): string[] => Object.values(S).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: unknown[]) => string)(3, 'x'))] : Object.values(v as Record<string, string>)));
const shape = (S: TeachStrings) => Object.fromEntries(Object.entries(S).map(([k, v]) => [k, typeof v === 'object' ? Object.keys(v).sort() : typeof v]));
describe('teach strings (seed)', () => {
  it('he and en have the same keys; nothing is left as a bare key', () => {
    expect(shape(teachStrings('en'))).toEqual(shape(teachStrings('he')));
    for (const lang of ['he', 'en'] as const) for (const s of flat(teachStrings(lang))) { expect(s.trim().length, s).toBeGreaterThan(0); expect(/^(part|why|stop|skip)\.|^[a-z][A-Za-z]+$/.test(s), `${lang}: ${s}`).toBe(false); }
  });
  it('the decided Hebrew of the chip, the dialog and «כל הקליפים במסלול»; one and many', () => {
    const S = teachStrings('he');
    expect(S.chip(4)).toBe('למדתי 4 שלבים מהקליפ הזה · החילו גם על…');
    expect(S.chip(1)).toBe('למדתי שלב אחד מהקליפ הזה · החילו גם על…');
    expect([S.dialogTitle, S.allOnTrack, S.apply(7)]).toEqual(['החילו גם על…', 'כל הקליפים במסלול', 'החלה על 7 קליפים']);
    expect(teachStrings('en').chip(2)).toBe('Learned 2 steps from this clip · Apply to…');
  });
  it('nothing is called right, matched or AI; the Hebrew is plural', () => {
    for (const lang of ['he', 'en'] as const) for (const s of flat(teachStrings(lang))) {
      expect(/\b(perfect|correct|verified|matched|AI)\b|מושלם|בינה מלאכותית/i.test(s), s).toBe(false);
      expect(/(^|\s)(בחר|בחרי|לחץ|לחצי|החל|פתח|פתחי|בדוק)(\s|$)/.test(s), s).toBe(false);
    }
  });
});
