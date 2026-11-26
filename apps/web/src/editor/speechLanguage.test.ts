import { describe, expect, it } from 'vitest';
import { speechLanguageName } from './MediaLibrary.tsx';

describe('the speech language on a media card', () => {
  it('is a word in the interface language, not a code', () => {
    expect(speechLanguageName('he-IL', 'he')).toBe('עברית');
    expect(speechLanguageName('he', 'en')).toBe('Hebrew');
    expect(speechLanguageName('en', 'he')).toBe('אנגלית');
    expect(speechLanguageName(undefined, 'he')).toBeNull();
  });
});
