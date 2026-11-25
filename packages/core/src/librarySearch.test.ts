import { describe, expect, it } from 'vitest';
import { heQueryForms, heSkeleton, LIBRARY_WORDS_HE, searchKey } from './librarySearch.ts';

describe('searchKey', () => {
  it('drops points and cantillation, folds final letters, lower-cases and joins punctuation runs', () => {
    expect(searchKey('חֲנֻכִּיָּה')).toBe('חנכיה');
    expect(searchKey('  Menorah, (Hanukkah)!! ')).toBe('menorah hanukkah');
    expect(searchKey('שָׁלוֹם')).toBe('שלומ');
    expect(searchKey('ךםןףץ')).toBe('כמנפצ');
    expect(searchKey('Café Crème')).toBe('cafe creme');
    expect(searchKey('בֵּית־סֵפֶר')).toBe('בית ספר'); // maqaf separates
    expect(searchKey('צה"ל צ׳יפס')).toBe('צהל ציפס'); // gershayim and geresh are dropped inside a word
    expect(searchKey('ＡＢＣ１２')).toBe('abc12'); // NFKD folds full-width forms
    expect(searchKey('')).toBe('');
  });
  it('is idempotent', () => {
    for (const s of ['חֲנֻכִּיָּה', 'Grinning Face', 'emoji_u1f600', 'a—b–c']) expect(searchKey(searchKey(s))).toBe(searchKey(s));
  });
});

describe('heQueryForms (a heuristic)', () => {
  it('adds the form without a leading prefix letter for Hebrew tokens of four letters or more', () => {
    expect(heQueryForms('החנוכיה')).toEqual(['החנוכיה', 'חנוכיה']);
    expect(heQueryForms('בבית')).toEqual(['בבית', 'בית']);
    expect(heQueryForms('בית')).toEqual(['בית']); // three letters
    expect(heQueryForms('חנוכיה')).toEqual(['חנוכיה']);
    expect(heQueryForms('menorah')).toEqual(['menorah']);
    expect(heQueryForms('ה1234')).toEqual(['ה1234']);
  });
});

describe('heSkeleton (a heuristic)', () => {
  it('lets pointed and full spellings meet', () => {
    expect(heSkeleton(searchKey('חֲנֻכִּיָּה'))).toBe(heSkeleton(searchKey('חנוכייה')));
    expect(heSkeleton(searchKey('חנוכיה'))).toBe('חנכה');
    expect(heSkeleton('ורד menorah')).toBe('ורד menorah'); // first letter kept, Latin unchanged
  });
});

describe('LIBRARY_WORDS_HE', () => {
  it('has about 150 rows, lower-case English keys, Hebrew values', () => {
    const rows = Object.entries(LIBRARY_WORDS_HE);
    expect(rows.length).toBeGreaterThanOrEqual(140);
    for (const [en, he] of rows) {
      expect(en).toBe(en.toLowerCase());
      expect(he).toMatch(/[א-ת]/);
    }
  });
});
