import { describe, expect, it } from 'vitest';
import { pearlsT } from './pearls.strings.ts';

describe('pearls strings', () => {
  it('the interface reads every word from the dictionary (pearl.*), fills placeholders, and an unknown key is itself', () => {
    expect(pearlsT('he')('save')).toBe('שמור כפנינה');
    expect(pearlsT('en')('used', { used: '4', total: '6.2' })).toBe('Used: 4 of 6.2 seconds');
    expect(pearlsT('he')('formSave')).toBe('שמירה');
    expect(pearlsT('en')('screenSeconds', { seconds: '1.5' })).toBe('1.5 s');
    expect(pearlsT('he')('nope')).toBe('nope');
  });
  it('a file name is put in as it is, never read as a placeholder', () => {
    expect(pearlsT('en')('removedOne', { files: '{restore} $& x' })).toContain('in {restore} $& x was deleted');
  });
});
