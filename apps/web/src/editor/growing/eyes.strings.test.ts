/** The eyes strings (lead seed): both languages have the same keys; C9, C11 and C16 wording; plural Hebrew; nothing claims to know who or to be right; no drag (cut). */
import { describe, expect, it } from 'vitest';
import { PICTURE_MODEL_SETUP_CODES } from '@pulseframe/core';
import { GROWING_HE } from '@pulseframe/i18n';
import { eyesStrings, type EyesStrings } from './eyes.strings.ts';

const flat = (S: EyesStrings): string[] => Object.entries(S).flatMap(([k, v]) => (typeof v === 'string' ? [v] : k === 'setup' ? PICTURE_MODEL_SETUP_CODES.map((c) => S.setup(c, { module: 'onnxruntime', bytes: 232589 })) : [String((v as (n: number) => string)(2))]));
describe('eyes strings (seed)', () => {
  it('he and en have the same keys and every string has words', () => {
    expect(Object.keys(eyesStrings('en')).sort()).toEqual(Object.keys(eyesStrings('he')).sort());
    for (const lang of ['he', 'en'] as const) for (const s of flat(eyesStrings(lang))) expect(s.trim().length, s).toBeGreaterThan(0);
  });
  it('the decided Hebrew: the button, the states and the corrected sentences', () => {
    const S = eyesStrings('he');
    expect(S.suggest).toBe('הציעו עיניים');
    expect(S.many(2)).toBe('נמצאו 2 פנים: לחצו ליד הפנים הרצויות, או בחרו ב־[ ו־] ולחצו Enter');
    expect(S.closer).toBe('לחצו קרוב יותר לפנים הרצויות');
    expect(S.none.startsWith('לא נמצאו פנים')).toBe(true);
    expect(S.none).toContain('סמנו את העיניים ביד');
    expect(S.tooMany).toBe('יש בתמונה יותר מדי פנים: סמנו את העיניים ביד');
    expect(S.privacy).toBe('ההצעה מחושבת רק במחשב הזה ואינה נשמרת. אחרי שתאשרו ותבנו, אפשר לחשב את מקום העיניים ממיקום התמונות בסרט, כמו בסימון ביד. המודל מוצא מקום של עיניים ולא מזהה מי בתמונה.');
    // consistent with growing's own privacy sentence (C11): positions can be worked out from the film; marks are not stored
    expect(GROWING_HE['growing.privacy']).toContain('אפשר לחשב');
    expect(S.setup('engine_not_working', { module: 'onnxruntime' })).toContain('onnxruntime');
    expect(S.setup('model_missing', { bytes: 232589 })).toContain('232589');
  });
  it('plural ungendered Hebrew; nothing is called right or sharp; no one is identified; no drag', () => {
    for (const lang of ['he', 'en'] as const) for (const s of flat(eyesStrings(lang))) {
      expect(/\b(sharp|perfect|perfectly|correct|accurate|verified|AI|drag)\b|מושלם|מדויק|בינה מלאכותית|גררו|שאתם רוצים|בשבילכם/i.test(s), s).toBe(false);
      expect(/(^|\s)(בחר|בחרי|לחץ|לחצי|סמן|סמני|אשר|אשרי|עצור|עצרי)(\s|$)/.test(s), s).toBe(false);
      expect(/same person|who is this|recogni[sz]e/i.test(s) || /אותו אדם|מי זה/.test(s), s).toBe(false);
    }
  });
});
