import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { alignPhrase } from './align.ts';

const h = (text: string, start: number, end: number, confidence = 0.9) => ({ text, start, end, confidence });

describe('alignPhrase', () => {
  it('identical words take the heard times; punctuation and vowel points do not matter', () => {
    const r = alignPhrase(['שָׁלוֹם,', 'עולם!'], [h(' שלום', 100, 500), h(' עולם', 520, 900)], 0, 1000);
    expect(r.words.map((w) => [w.text, w.start, w.end, w.how])).toEqual([['שָׁלוֹם,', 100, 500, 'same'], ['עולם!', 520, 900, 'same']]);
    expect(r.timing).toBe('word');
  });
  it('a word the recogniser heard differently keeps its place and time; the typed text is kept', () => {
    const r = alignPhrase(['אני', 'מאוד', 'מתרגשת'], [h('אני', 0, 200), h('מעוד', 200, 500), h('מתרגשת', 500, 900)], 0, 1000);
    expect(r.words.map((w) => w.how)).toEqual(['same', 'different', 'same']);
    expect(r.words[1]).toMatchObject({ text: 'מאוד', start: 200, end: 500, confidence: null });
    expect(r.timing).toBe('word');
  });
  it('typed words with no heard counterpart share the gap by length, and the phrase is approximate', () => {
    const r = alignPhrase(['a', 'bbb', 'c', 'd'], [h('a', 0, 100), h('d', 500, 600)], 0, 1000);
    expect(r.words.map((w) => [w.start, w.end, w.how])).toEqual([[0, 100, 'same'], [100, 400, 'estimated'], [400, 500, 'estimated'], [500, 600, 'same']]);
    expect(r.timing).toBe('approximate');
  });
  it('extra heard words are ignored; nothing heard means every time is an estimate inside the phrase', () => {
    expect(alignPhrase(['x', 'y'], [h('x', 0, 100), h('uh', 100, 200), h('y', 200, 300)], 0, 400).words.map((w) => w.how)).toEqual(['same', 'same']);
    const none = alignPhrase(['one', 'two'], [], 1000, 2000);
    expect(none.words.map((w) => [w.start, w.end])).toEqual([[1000, 1500], [1500, 2000]]);
    expect(none.timing).toBe('approximate');
  });
  it('mostly different words are not called word-timed', () => {
    expect(alignPhrase(['a', 'b', 'c'], [h('x', 0, 1), h('y', 1, 2), h('c', 2, 3)], 0, 3).timing).toBe('approximate');
  });
  it('words are always in order, non-overlapping and inside the phrase; the text is never changed (property)', () => {
    const word = fc.constantFrom('a', 'b', 'c', 'שלום', 'עולם', 'x,', 'אה');
    fc.assert(fc.property(fc.array(word, { minLength: 1, maxLength: 12 }), fc.array(fc.tuple(word, fc.integer({ min: -50, max: 1100 }), fc.integer({ min: 0, max: 300 })), { maxLength: 12 }), (typed, raw) => {
      const heard = raw.map(([t, s, d]) => h(t, s, s + d)).sort((x, y) => x.start - y.start);
      const r = alignPhrase(typed, heard, 0, 1000);
      expect(r.words.map((w) => w.text)).toEqual(typed);
      let prev = 0;
      for (const w of r.words) { expect(w.start).toBeGreaterThanOrEqual(prev); expect(w.end).toBeGreaterThanOrEqual(w.start); expect(w.end).toBeLessThanOrEqual(1000); prev = w.end; }
      expect(r.same + r.different + r.estimated).toBe(typed.length);
    }));
  });
});
