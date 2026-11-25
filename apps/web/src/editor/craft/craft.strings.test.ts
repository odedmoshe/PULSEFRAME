import { describe, expect, it } from 'vitest';
import { CRAFT_STRINGS } from './craft.strings.ts';

describe('craft strings', () => {
  it('Hebrew and English cover the same keys, none empty; the Hebrew is Hebrew', () => {
    expect(Object.keys(CRAFT_STRINGS.en).sort()).toEqual(Object.keys(CRAFT_STRINGS.he).sort());
    for (const [k, v] of Object.entries(CRAFT_STRINGS.he)) { expect(v, k).not.toBe(''); expect(/[֐-׿]/.test(v), k).toBe(true); }
    for (const [k, v] of Object.entries(CRAFT_STRINGS.en)) expect(v, k).not.toBe('');
  });
});
