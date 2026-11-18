import { describe, expect, it } from 'vitest';
import { isVerbatim } from './quotes.ts';

const words = (s: string) => s.split(' ').map((text) => ({ text }));
const W = words('אָז כְּמוֹ שֶׁאָמַרְתִּי, צה״ל זה "הבית" שלנו. מה דעתכם? יש 3.5 מיליון בית־ספר');

describe('isVerbatim', () => {
  it('accepts a contiguous run with or without niqqud, gershayim and punctuation', () => {
    expect(isVerbatim('כמו שאמרתי', W)).toBe(true);
    expect(isVerbatim('אָז כְּמוֹ', W)).toBe(true);
    expect(isVerbatim('צה"ל זה הבית שלנו', W)).toBe(true);
    expect(isVerbatim('צהל זה הבית', W)).toBe(true);
    expect(isVerbatim('«צה״ל זה הבית שלנו»', W)).toBe(true);
    expect(isVerbatim('מה דעתכם', W)).toBe(true);
    expect(isVerbatim('מה דעתכם?!', W)).toBe(true);
    expect(isVerbatim('בית ספר', W)).toBe(true); // the maqaf joins two words
    expect(isVerbatim('בית־ספר', W)).toBe(true);
    expect(isVerbatim('יש 3.5 מיליון', W)).toBe(true);
    expect(isVerbatim('יש 3,5 מיליון', W)).toBe(true); // a decimal comma is the same number
  });
  it('refuses reworded, reordered, skipped or added words and other numbers', () => {
    expect(isVerbatim('כמו שאמרנו', W)).toBe(false);
    expect(isVerbatim('שאמרתי כמו', W)).toBe(false);
    expect(isVerbatim('אז שאמרתי', W)).toBe(false); // a word skipped inside the run
    expect(isVerbatim('צה״ל זה הבית שלנו באמת', W)).toBe(false);
    expect(isVerbatim('יש 4 מיליון', W)).toBe(false);
    expect(isVerbatim('יש 35 מיליון', W)).toBe(false); // 3.5 is not 35
    expect(isVerbatim('צה״לי', W)).toBe(false);
  });
  it('refuses an empty quote or one of punctuation only, and a quote over no words', () => {
    expect(isVerbatim('', W)).toBe(false);
    expect(isVerbatim(' ״ — ! ', W)).toBe(false);
    expect(isVerbatim('שלום', [])).toBe(false);
  });
  it('English: case and punctuation do not count', () => {
    const en = words("So, as I said: it's DONE.");
    expect(isVerbatim('as i said', en)).toBe(true);
    expect(isVerbatim('"Its done"', en)).toBe(true);
    expect(isVerbatim('as you said', en)).toBe(false);
  });
});
