/**
 * The wording of the warn-instead-of-refuse rows (ADR-0036 D1, D5, D6, D8, H1, H2, I9, I11; packages/i18n/src/autonomy.ts
 * `autonomy.warn.*`, filled by apps/server/src/autonomy-mode.ts openWarning): Hebrew and English for every code, served by the
 * dictionaries, the same placeholders in both, plural address with no singular (gendered) imperative, and nothing that asks the
 * owner to approve anything: each one says what was done.
 */
import { describe, expect, it } from 'vitest';
import { dictionaries } from '../../i18n/src/index.ts';
import { AUTONOMY_EN, AUTONOMY_HE } from '../../i18n/src/autonomy.ts';
import { openWarning, OPEN_WARNING_CODES } from '../../../apps/server/src/autonomy-mode.ts';

const heWord = (w: string) => new RegExp(`(^|[^\\u0590-\\u05FF])${w}([^\\u0590-\\u05FF]|$)`);
const GENDERED_HE = ['לחץ', 'לחצי', 'בחר', 'בחרי', 'הקש', 'הקישי', 'סמן', 'סמני', 'נסה', 'נסי', 'בדוק', 'בדקי', 'העתק', 'העתיקי', 'הפעל', 'הפעילי', 'פתח', 'פתחי', 'סגור', 'סגרי', 'חכה', 'חכי', 'אשר', 'אשרי', 'תלחץ', 'תבחר', 'בעל/ת'];
const ASKING = [/אשרו/, /לאשר/, /approve/i, /confirm/i];
const holes = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('autonomy warnings (open mode)', () => {
  it('every code has Hebrew and English with the same placeholders, served by the dictionaries', () => {
    for (const code of OPEN_WARNING_CODES) {
      const k = `autonomy.warn.${code}` as keyof typeof AUTONOMY_HE;
      expect(/[֐-׿]/.test(AUTONOMY_HE[k]), k).toBe(true);
      expect(AUTONOMY_EN[k]?.length, k).toBeGreaterThan(0);
      expect(holes(AUTONOMY_HE[k]), k).toEqual(holes(AUTONOMY_EN[k]));
      expect((dictionaries.he as Record<string, string>)[k]).toBe(AUTONOMY_HE[k]);
      expect((dictionaries.en as Record<string, string>)[k]).toBe(AUTONOMY_EN[k]);
    }
  });
  it('plural address, no gendered form, and nothing asks for an approval', () => {
    for (const code of OPEN_WARNING_CODES) {
      const he = AUTONOMY_HE[`autonomy.warn.${code}` as keyof typeof AUTONOMY_HE], en = AUTONOMY_EN[`autonomy.warn.${code}` as keyof typeof AUTONOMY_EN];
      for (const w of GENDERED_HE) expect({ code, w, hit: heWord(w).test(he) }).toEqual({ code, w, hit: false });
      for (const a of ASKING) expect({ code, a: String(a), hit: a.test(he) || a.test(en) }).toEqual({ code, a: String(a), hit: false });
    }
  });
  it('openWarning fills every placeholder in both languages', () => {
    const w = openWarning('licence', { model: 'm/x.safetensors', licence: 'CC-BY-NC-4.0', evidence: 'card', use: 'prohibited' });
    expect(w.he).toContain('CC-BY-NC-4.0');
    expect(w.en).toBe('Model m/x.safetensors: licence CC-BY-NC-4.0 (as recorded: "card"). Commercial use as recorded: prohibited. The result is marked, and the export shows the warning.');
    for (const t of [w.he, w.en]) expect(t).not.toMatch(/\{\w+\}/);
  });
});
