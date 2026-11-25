/** The story's strings (lead seed; W3 owns and extends): both languages have the same keys, every warning and held reason is worded, nothing forbidden is said. */
import { describe, expect, it } from 'vitest';
import { STORY_BLOCKING_CODES, STORY_FORBIDDEN_WORDS, STORY_FORBIDDEN_WORDS_HE, STORY_HELD_REASONS, STORY_WARNING_CODES } from '@pulseframe/core';
import { storyStrings, type StoryStrings } from './story.strings.ts';

const flat = (S: StoryStrings): string[] => Object.values(S).flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: number[]) => string)(3, 7))] : Object.values(v as Record<string, string>)));
const shape = (S: StoryStrings) => Object.fromEntries(Object.entries(S).map(([k, v]) => [k, typeof v === 'object' ? Object.keys(v).sort() : typeof v]));
describe('story strings (seed)', () => {
  it('he and en have the same keys; every warning, blocking code and held reason is worded', () => {
    expect(shape(storyStrings('en'))).toEqual(shape(storyStrings('he')));
    for (const lang of ['he', 'en'] as const) {
      const S = storyStrings(lang);
      expect(Object.keys(S.warning).sort()).toEqual([...STORY_WARNING_CODES, ...STORY_BLOCKING_CODES].sort());
      expect(Object.keys(S.held).sort()).toEqual([...STORY_HELD_REASONS].sort());
    }
  });
  it('nothing is called synced, perfect, best or AI', () => {
    for (const lang of ['he', 'en'] as const) for (const s of flat(storyStrings(lang))) { expect(STORY_FORBIDDEN_WORDS.test(s), s).toBe(false); expect(STORY_FORBIDDEN_WORDS_HE.test(s), s).toBe(false); expect(/\bAI\b|בינה מלאכותית/.test(s), s).toBe(false); }
  });
  it('the main names are the decided Hebrew', () => {
    const S = storyStrings('he');
    expect([S.name, S.tapAlong, S.next, S.buildNoTaps, S.accept]).toEqual(['ספרו מה היה', 'הקישו את המעברים', 'התמונה הבאה', 'בנו בלי הקשות', 'אישור']);
    expect(S.recording(42, 600)).toBe('מקליט… 0:42 מתוך 10:00');
  });
});
