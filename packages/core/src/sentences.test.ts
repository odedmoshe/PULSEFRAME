import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { splitSentences } from './sentences.ts';

describe('splitSentences', () => {
  it('splits at sentence ends and line breaks, keeping the punctuation', () => {
    expect(splitSentences('שלום לכולם, ברוכים הבאים. היום נדבר על עריכה! מוכנים להתחיל?\nיוצאים לדרך עכשיו')).toEqual(['שלום לכולם, ברוכים הבאים.', 'היום נדבר על עריכה!', 'מוכנים להתחיל?', 'יוצאים לדרך עכשיו']);
  });
  it('does not split inside numbers or abbreviations without a following space', () => {
    expect(splitSentences('המחיר הוא 3.5 שקלים בלבד היום. תודה רבה לכם על הכול.')).toEqual(['המחיר הוא 3.5 שקלים בלבד היום.', 'תודה רבה לכם על הכול.']);
  });
  it('joins a very short piece to its neighbour', () => {
    expect(splitSentences('כן. זה בדיוק מה שרציתי לומר לכם. טוב.')).toEqual(['כן. זה בדיוק מה שרציתי לומר לכם. טוב.']);
  });
  it('breaks an overlong sentence at a comma, else at a space, and never exceeds the limit', () => {
    const long = `${'מילה '.repeat(30).trim()}, ${'עוד '.repeat(40).trim()}.`;
    const parts = splitSentences(long, 120);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(120);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });
  it('never loses or changes text and never exceeds the limit (property)', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom('שלום', 'עולם', 'a', 'word', 'ארוך־מאוד־מאוד', '3.5', 'כן.', 'מה?', 'די!', 'x,', '\n'), { maxLength: 200 }), fc.integer({ min: 20, max: 300 }), (words, max) => {
      const text = words.join(' ');
      const parts = splitSentences(text, max);
      expect(parts.every((p) => p.length <= max && p.length > 0)).toBe(true);
      expect(parts.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
    }));
  });
});
