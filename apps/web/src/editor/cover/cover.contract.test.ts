/** Lead contract of the cover block's ids and words (wave 8 pre-pass): ids are unique; every word the block reads exists in both languages. */
import { describe, expect, it } from 'vitest';
import { COVER_HE } from '@pulseframe/i18n';
import { COVER_TESTIDS } from './cover.testids.ts';
import { coverT } from './cover.strings.ts';

describe('cover block contract', () => {
  it('test ids are unique and kebab-case', () => {
    const ids = Object.values(COVER_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(sharp|still)-[a-z0-9-]+$/);
  });
  it('coverT reads every cover.* word in both languages and fills placeholders', () => {
    for (const key of Object.keys(COVER_HE).filter((k) => k.startsWith('cover.')).map((k) => k.slice(6))) for (const lang of ['he', 'en'] as const) expect(coverT(lang)(key), `${lang} ${key}`).not.toBe(key);
    expect(coverT('he')('found', { n: 2 })).toBe('נמצאו 2');
    expect(coverT('en')('ppi', { ppi: 270, paper: '10×15 cm' })).toBe('270 pixels per inch at 10×15 cm');
  });
});
