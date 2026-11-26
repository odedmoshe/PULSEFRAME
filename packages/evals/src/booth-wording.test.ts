/**
 * The wording of «תא הבדיקה» (wave 8 booth pre-pass; packages/i18n/src/booth.ts; plan check 15 as corrected by verify C8):
 * every string in Hebrew and English with the same keys; every server refusal worded in Hebrew with a next step and every pattern used;
 * WHOLE-WORD checks (a substring check fails on «בחרו» because «בחר» is its prefix, verify C8): no singular imperative, no word of
 * INSTRUMENTS_FORBIDDEN_WORDS(_HE), no praise word; the first screen says «חלק ראשון: 0 מתוך 14». Builders W2 and W3 add their own
 * page-only strings files to TEXTS below at integration (the lead), never weakening a check to pass.
 */
import { describe, expect, it } from 'vitest';
import { BOOTH_CHECKS, BOOTH_FIRST_SITTING_CARDS, BOOTH_GROUPS, BOOTH_PROBLEM_IDS, INSTRUMENTS_FORBIDDEN_WORDS, INSTRUMENTS_FORBIDDEN_WORDS_HE } from '@pulseframe/core';
import { BOOTH_SERVER_REFUSALS } from '../../../apps/server/src/booth/contract.ts';
import { BOOTH_EN, BOOTH_HE, BOOTH_REFUSAL_PATTERNS, dictionaries, translateRefusal } from '../../i18n/src/index.ts';

const heb = /[֐-׿]/;
const enWord = (w: string) => new RegExp(`\\b${w}\\b`, 'i');
const heWord = (w: string) => new RegExp(`(^|[^\\u0590-\\u05FF])${w}([^\\u0590-\\u05FF]|$)`);
/** Singular (gendered) imperatives and second-person singular forms that must never address the owner. Whole words only. */
const GENDERED_HE = ['לחץ', 'לחצי', 'בחר', 'בחרי', 'שמעת', 'שמעת?', 'בדקת', 'הקש', 'הקישי', 'סמן', 'סמני', 'נסה', 'נסי', 'הקלט', 'הקליטי', 'בדוק', 'בדקי',
  'העתק', 'העתיקי', 'הפעל', 'הפעילי', 'דלג', 'דלגי', 'פתח', 'פתחי', 'סגור', 'סגרי', 'הנמך', 'הנמיכי', 'ענה', 'עני', 'חכה', 'חכי', 'אפשר?', 'תלחץ', 'תבחר'];
const PRAISE_HE = ['מעולה', 'מושלם', 'מושלמת', 'מצוין', 'מצוינת', 'חד', 'חדה', 'בטוח', 'בטוחה', 'מאומת', 'מאומתת', 'איכותי', 'איכותית', 'נכון', 'נכונה'];
const PRAISE_EN = ['good', 'great', 'perfect', 'excellent', 'sharp', 'safe', 'verified', 'correct', 'right', 'high quality'];
const sample = (k: keyof typeof BOOTH_SERVER_REFUSALS) => (BOOTH_SERVER_REFUSALS[k].message as () => string)();

const TEXTS = (): string[] => [...Object.values(BOOTH_HE), ...Object.values(BOOTH_EN), ...Object.values(BOOTH_SERVER_REFUSALS).map((r) => r.hint),
  ...(Object.keys(BOOTH_SERVER_REFUSALS) as (keyof typeof BOOTH_SERVER_REFUSALS)[]).flatMap((k) => [sample(k), translateRefusal('he', sample(k)) ?? ''])];

describe('booth strings', () => {
  it('Hebrew first, English for the same keys, both served by the dictionaries', () => {
    expect(Object.keys(BOOTH_EN).sort()).toEqual(Object.keys(BOOTH_HE).sort());
    for (const k of Object.keys(BOOTH_HE) as (keyof typeof BOOTH_HE)[]) {
      expect({ k, he: heb.test(BOOTH_HE[k]) }).toEqual({ k, he: true });
      expect(BOOTH_EN[k].length, k).toBeGreaterThan(0);
      expect(dictionaries.he[k]).toBe(BOOTH_HE[k]);
      expect(dictionaries.en[k]).toBe(BOOTH_EN[k]);
    }
  });
  it('every group, every problem, every self-check row and every check state has words', () => {
    const he = BOOTH_HE as Record<string, string>;
    for (const g of BOOTH_GROUPS) expect(he[`booth.group.${g}`], g).toBeTruthy();
    for (const p of BOOTH_PROBLEM_IDS) expect(he[`booth.problem.${p}`], p).toBeTruthy();
    for (const c of BOOTH_CHECKS) expect(he[`booth.check.${c.id}`], c.id).toBeTruthy();
    for (const s of ['ok', 'setup', 'off', 'fail', 'unknown', 'skipped']) expect(he[`booth.checkState.${s}`], s).toBeTruthy();
  });
  it('the first screen says «חלק ראשון: 0 מתוך 14», never a larger total', () => {
    const fill = (s: string) => s.replace('{done}', '0').replace('{total}', String(BOOTH_FIRST_SITTING_CARDS));
    expect(fill(BOOTH_HE['booth.firstPart'])).toBe('חלק ראשון: 0 מתוך 14');
    expect(fill(BOOTH_EN['booth.firstPart'])).toBe('First part: 0 of 14');
    expect(Object.values(BOOTH_HE).filter((s) => /196/.test(s))).toEqual([]);
  });
  it('every refusal is worded in Hebrew with its next step, and every pattern is used', () => {
    const used = new Set<number>();
    for (const k of Object.keys(BOOTH_SERVER_REFUSALS) as (keyof typeof BOOTH_SERVER_REFUSALS)[]) {
      const msg = sample(k);
      const i = BOOTH_REFUSAL_PATTERNS.findIndex((re) => re.test(msg));
      expect({ k, matched: i >= 0 }).toEqual({ k, matched: true });
      used.add(i);
      const he = translateRefusal('he', msg) ?? '';
      expect({ k, hebrew: heb.test(he), nextStep: /\.\s*\S/.test(he) }).toEqual({ k, hebrew: true, nextStep: true });
      expect(BOOTH_SERVER_REFUSALS[k].hint.length, k).toBeGreaterThan(10);
    }
    expect(used.size).toBe(BOOTH_REFUSAL_PATTERNS.length);
  });
  it('the whole-word matcher itself: «בחרו» is not «בחר», «לחצו» is not «לחץ»; «בחר» alone is caught', () => {
    expect(heWord('בחר').test('בחרו תיקייה')).toBe(false);
    expect(heWord('לחץ').test('לחצו כאן')).toBe(false);
    expect(heWord('בחר').test('בחר תיקייה')).toBe(true);
    expect(heWord('טבעי').test('נשמע לא טבעי')).toBe(true);
  });
  it('no singular imperative, no forbidden word, no praise word, whole words, in either language', () => {
    for (const s of TEXTS()) {
      for (const w of GENDERED_HE) expect({ s, w, hit: heWord(w.replace('?', '\\?')).test(s) }).toEqual({ s, w, hit: false });
      for (const w of [...INSTRUMENTS_FORBIDDEN_WORDS_HE, ...PRAISE_HE]) expect({ s, w, hit: heWord(w).test(s) }).toEqual({ s, w, hit: false });
      for (const w of [...INSTRUMENTS_FORBIDDEN_WORDS, ...PRAISE_EN]) expect({ s, w, hit: enWord(w).test(s) }).toEqual({ s, w, hit: false });
    }
  });
  it('every command in a next step works unchanged in cmd and PowerShell (no $env:, &&, ; or backticks)', () => {
    for (const [k, s] of Object.entries({ ...BOOTH_HE, ...BOOTH_EN })) if (k.startsWith('booth.next.') && /\b(pnpm|node|git|npx)\b/.test(s)) expect({ k, shellSyntax: /\$env:|&&|;|`/.test(s) }).toEqual({ k, shellSyntax: false });
  });
});
