/** The growing strings (lead seed): both languages have the same keys, every warning and exclusion is worded, the shared lines come from i18n, nothing forbidden, plural Hebrew. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GROWING_EXCLUSION_CODES, GROWING_WARNING_CODES } from '@pulseframe/core';
import { GROWING_HE } from '@pulseframe/i18n';
import { growingStrings, type GrowingStrings } from './growing.strings.ts';

const flat = (S: GrowingStrings): string[] => Object.values(S).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: number[]) => string)(3, 7))] : Object.values(v as Record<string, string>)));
const shape = (S: GrowingStrings) => Object.fromEntries(Object.entries(S).map(([k, v]) => [k, typeof v === 'object' ? Object.keys(v).sort() : typeof v]));
describe('growing strings (seed)', () => {
  it('he and en have the same keys; every warning and exclusion code is worded', () => {
    expect(shape(growingStrings('en'))).toEqual(shape(growingStrings('he')));
    for (const lang of ['he', 'en'] as const) {
      const S = growingStrings(lang);
      expect(Object.keys(S.warning).sort()).toEqual([...GROWING_WARNING_CODES].sort());
      expect(Object.keys(S.excluded).sort()).toEqual([...GROWING_EXCLUSION_CODES].sort());
      for (const s of flat(S)) expect(s.trim().length, s).toBeGreaterThan(0);
    }
  });
  it('the privacy sentence and the preview label are the shared ones (C7, C13), and the main names are the decided Hebrew', () => {
    const S = growingStrings('he');
    expect(S.privacy).toBe(GROWING_HE['growing.privacy']);
    expect(S.preview).toBe('תצוגה מקדימה — עוד לא נוצר');
    expect([S.name, S.stepPick, S.stepMark, S.stepSettings, S.create]).toEqual(['גדלים מול העיניים', 'בחרו תמונות', 'סמנו עיניים', 'איך זה ייראה', 'צרו']);
  });
  it('the bar\'s «ביטול», when disabled, gives a reason sentence with the next step, not its own label (integration)', () => {
    for (const lang of ['he', 'en'] as const) {
      const S = growingStrings(lang);
      expect(S.undoUnavailable).not.toBe(S.undo);
      expect(S.undoUnavailable).toContain(S.rebuild === 'בנו מחדש' ? 'לבנות מחדש' : 'rebuild');
    }
    const bar = fs.readFileSync(path.join(import.meta.dirname, 'GrowingBar.tsx'), 'utf8');
    expect(bar).toContain('disabledReason={txn ? undefined : S.undoUnavailable}');
  });
  it('nothing is called sharp, perfect, right or AI; the Hebrew is plural', () => {
    for (const lang of ['he', 'en'] as const) for (const s of flat(growingStrings(lang))) {
      expect(/\b(sharp|perfect|perfectly|correct|verified|AI)\b|מושלם|בינה מלאכותית/i.test(s), s).toBe(false);
      expect(/(^|\s)(בחר|בחרי|לחץ|לחצי|סמן|סמני|פתח|פתחי)(\s|$)/.test(s), s).toBe(false);
    }
  });
});
