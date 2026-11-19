/**
 * The strings of the voice cleanup block and the colour match panel (ADR-0013, ADR-0014): both languages cover the same keys,
 * Hebrew is Hebrew, placeholders agree, and the fixed data-testids are unique and namespaced.
 */
import { describe, expect, it } from 'vitest';
import { COLOUR_MATCH_STRINGS, COLOUR_MATCH_TESTIDS } from './colourMatch.strings.ts';
import { VOICE_CLEAN_STRINGS, VOICE_CLEAN_TESTIDS } from './voiceClean.strings.ts';

describe.each([['voice cleanup', VOICE_CLEAN_STRINGS, VOICE_CLEAN_TESTIDS, 'voice-clean'], ['colour match', COLOUR_MATCH_STRINGS, COLOUR_MATCH_TESTIDS, 'colour-match']] as const)('%s strings', (_name, strings, testids, prefix) => {
  it('Hebrew and English have the same keys, non-empty; Hebrew is Hebrew; placeholders agree', () => {
    const he = strings.he as Record<string, string>, en = strings.en as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
    for (const [k, v] of Object.entries(he)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
      expect(/[֐-׿]/.test(v), k).toBe(true);
      expect(en[k]!.trim().length, k).toBeGreaterThan(0);
      expect(en[k]!.match(/\{\w+\}/g) ?? [], k).toEqual(v.match(/\{\w+\}/g) ?? []);
    }
  });
  it('data-testids are unique and start with the block name', () => {
    const ids = Object.values(testids) as string[];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id === prefix || id.startsWith(`${prefix}-`), id).toBe(true);
  });
});
