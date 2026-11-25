import { describe, expect, it } from 'vitest';
import { PEARL_FORBIDDEN_WORDS, PEARL_FORBIDDEN_WORDS_HE } from '@pulseframe/core';
import { PEARLS_EXTRA, pearlsT } from './pearls.strings.ts';

describe('pearls strings', () => {
  it('the extra sentences exist in both languages, never judge a cut, and Hebrew is Hebrew', () => {
    expect(Object.keys(PEARLS_EXTRA.he).sort()).toEqual(Object.keys(PEARLS_EXTRA.en).sort());
    for (const k of Object.keys(PEARLS_EXTRA.he)) {
      expect(PEARLS_EXTRA.he[k]).toMatch(/[֐-׿]/);
      expect(PEARLS_EXTRA.he[k]).not.toMatch(PEARL_FORBIDDEN_WORDS_HE);
      expect(PEARLS_EXTRA.en[k]).not.toMatch(PEARL_FORBIDDEN_WORDS);
      expect(PEARLS_EXTRA.en[k]).not.toMatch(/[֐-׿]/);
    }
  });
  it('the dictionary wins over the extras, placeholders are filled, an unknown key is itself', () => {
    expect(pearlsT('he')('save')).toBe('שמור כפנינה');
    expect(pearlsT('en')('used', { used: '4', total: '6.2' })).toBe('Used: 4 of 6.2 seconds');
    expect(pearlsT('he')('formSave')).toBe('שמירה');
    expect(pearlsT('he')('nope')).toBe('nope');
  });
});
