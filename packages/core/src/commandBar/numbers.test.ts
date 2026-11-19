/**
 * Exact numbers of the command bar (ADR-0027, plan §4.2, §8 W1 "Numbers"): a table of number phrases → exact reduced
 * {num, den}, covering masculine, feminine and construct forms, the teens, the tens with ו, hundreds, thousands, fractions,
 * «וחצי», minus and digits, in Hebrew and English. «1,5» is ambiguous.
 */
import { describe, expect, it } from 'vitest';
import { ex, exText, inNumberRange, parseNumber, readNumber } from './numbers.ts';
import { tokenizeBar } from './match.ts';

/** [phrase, num, den] */
const TABLE: [string, bigint, bigint][] = [
  // 1–10, both genders and construct
  ['אחת', 1n, 1n], ['אחד', 1n, 1n], ['שתיים', 2n, 1n], ['שתים', 2n, 1n], ['שניים', 2n, 1n], ['שתי', 2n, 1n], ['שני', 2n, 1n],
  ['שלוש', 3n, 1n], ['שלושה', 3n, 1n], ['שלושת', 3n, 1n], ['ארבע', 4n, 1n], ['ארבעה', 4n, 1n], ['ארבעת', 4n, 1n], ['חמש', 5n, 1n], ['חמישה', 5n, 1n], ['חמשת', 5n, 1n],
  ['שש', 6n, 1n], ['שישה', 6n, 1n], ['ששת', 6n, 1n], ['שבע', 7n, 1n], ['שבעה', 7n, 1n], ['שמונה', 8n, 1n], ['תשע', 9n, 1n], ['תשעה', 9n, 1n], ['עשר', 10n, 1n], ['עשרה', 10n, 1n],
  // the teens, both genders
  ['אחת עשרה', 11n, 1n], ['אחד עשר', 11n, 1n], ['שתים עשרה', 12n, 1n], ['שתיים עשרה', 12n, 1n], ['שנים עשר', 12n, 1n], ['שלוש עשרה', 13n, 1n], ['שלושה עשר', 13n, 1n],
  ['ארבע עשרה', 14n, 1n], ['חמש עשרה', 15n, 1n], ['חמישה עשר', 15n, 1n], ['שש עשרה', 16n, 1n], ['שבע עשרה', 17n, 1n], ['שמונה עשרה', 18n, 1n], ['תשע עשרה', 19n, 1n], ['תשעה עשר', 19n, 1n],
  // the tens, and joined by ו
  ['עשרים', 20n, 1n], ['שלושים', 30n, 1n], ['ארבעים', 40n, 1n], ['חמישים', 50n, 1n], ['שישים', 60n, 1n], ['שבעים', 70n, 1n], ['שמונים', 80n, 1n], ['תשעים', 90n, 1n],
  ['עשרים וחמש', 25n, 1n], ['עשרים ואחת', 21n, 1n], ['שלושים ושתיים', 32n, 1n], ['ארבעים ושלושה', 43n, 1n], ['תשעים ותשע', 99n, 1n],
  // hundreds, thousands
  ['מאה', 100n, 1n], ['מאתיים', 200n, 1n], ['מאה ועשרים', 120n, 1n], ['מאה עשרים וחמש', 125n, 1n], ['מאה וחמש', 105n, 1n], ['שלוש מאות', 300n, 1n], ['שלוש מאות וחמישים', 350n, 1n],
  ['אלף', 1000n, 1n], ['אלפיים', 2000n, 1n], ['שלושת אלפים', 3000n, 1n], ['עשרים אלף', 20000n, 1n], ['מיליון', 1000000n, 1n],
  // fractions, alone and after a whole
  ['חצי', 1n, 2n], ['רבע', 1n, 4n], ['שליש', 1n, 3n], ['שני שלישים', 2n, 3n], ['שלושה רבעים', 3n, 4n], ['שלושת רבעי', 3n, 4n],
  ['אחת וחצי', 3n, 2n], ['שתיים ורבע', 9n, 4n], ['שלוש ושליש', 10n, 3n], ['עשר וחצי', 21n, 2n], ['שתיים ושלושה רבעים', 11n, 4n], ['3 וחצי', 7n, 2n],
  // signs
  ['מינוס שלוש', -3n, 1n], ['פחות חמש', -5n, 1n], ['-6', -6n, 1n], ['+3', 3n, 1n], ['מינוס 2.5', -5n, 2n], ['minus three', -3n, 1n],
  // digits, exact from the decimal string
  ['0', 0n, 1n], ['3', 3n, 1n], ['12', 12n, 1n], ['1.5', 3n, 2n], ['0.25', 1n, 4n], ['2.75', 11n, 4n], ['0.001', 1n, 1000n], ['10.000001', 10000001n, 1000000n], ['0.1', 1n, 10n],
  // English
  ['one', 1n, 1n], ['two', 2n, 1n], ['twelve', 12n, 1n], ['twenty', 20n, 1n], ['twenty five', 25n, 1n], ['twenty-five', 25n, 1n], ['ninety nine', 99n, 1n],
  ['one hundred', 100n, 1n], ['a hundred', 100n, 1n], ['two hundred', 200n, 1n], ['one hundred and twenty', 120n, 1n], ['five thousand', 5000n, 1n],
  ['half', 1n, 2n], ['a half', 1n, 2n], ['a quarter', 1n, 4n], ['a third', 1n, 3n], ['two thirds', 2n, 3n], ['three quarters', 3n, 4n], ['one and a half', 3n, 2n],
];

describe('number phrases → exact rationals', () => {
  it('has at least 80 phrases', () => expect(TABLE.length).toBeGreaterThanOrEqual(80));
  for (const [phrase, num, den] of TABLE) {
    it(`${phrase} = ${num}/${den}`, () => {
      const { tokens } = tokenizeBar(phrase);
      const r = readNumber(tokens, 0);
      expect(r, phrase).not.toBeNull();
      expect(r!.end, `${phrase}: reads every token`).toBe(tokens.length);
      expect(r!.value).toEqual({ num, den });
      expect(r!.alternatives).toBeUndefined();
      expect(parseNumber(tokens, 0)).toEqual({ value: { num, den }, end: tokens.length });
    });
  }
});

describe('what is not one number', () => {
  it('«1,5» is ambiguous (decimal comma or not) and asks; «1,500» allows 1.5 and 1500', () => {
    const t = tokenizeBar('1,5').tokens;
    expect(parseNumber(t, 0)).toEqual({ ambiguous: true, end: 1 });
    expect(readNumber(t, 0)!.alternatives).toEqual([ex(3n, 2n)]);
    expect(readNumber(tokenizeBar('1,500').tokens, 0)!.alternatives).toEqual([ex(3n, 2n), ex(1500n)]);
  });
  it('a unit, an ordinal or an unknown word is not a number', () => {
    for (const p of ['שנייה', 'השלישית', 'בננה', 'second']) expect(parseNumber(tokenizeBar(p).tokens, 0), p).toBeNull();
  });
  it('«עשרים חמש» (no ו) reads only the twenty', () => expect(readNumber(tokenizeBar('עשרים חמש').tokens, 0)).toMatchObject({ value: ex(20n), end: 1 }));
  it('more than six decimals is not read as a number', () => expect(parseNumber(tokenizeBar('1.1234567').tokens, 0)).toBeNull());
  it('reports the proclitic and the joining ו of the first token', () => {
    expect(readNumber(tokenizeBar('ב־3').tokens, 0)).toMatchObject({ prefixes: ['ב'], conj: false });
    expect(readNumber(tokenizeBar('ועשר').tokens, 0)).toMatchObject({ value: ex(10n), prefixes: [], conj: true });
  });
  it('the range check: 0 ≤ |value| ≤ 10^6', () => {
    expect(inNumberRange(ex(1000000n))).toBe(true);
    expect(inNumberRange(ex(-1000000n))).toBe(true);
    expect(inNumberRange(ex(1000001n))).toBe(false);
  });
  it('exact text of a value', () => {
    expect([exText(ex(3n, 2n)), exText(ex(-1n, 4n)), exText(ex(1n, 3n)), exText(ex(7n)), exText(ex(1n, 1000000n))]).toEqual(['1.5', '-0.25', '1/3', '7', '0.000001']);
  });
});

describe('Object.prototype keys are not number words', () => {
  it('«constructor», «__proto__», «toString» and «valueOf» read as no number, alone and in a phrase', () => {
    for (const w of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      for (const text of [w, `${w} ${w}`, `מינוס ${w}`, `3 ${w}`, `שלוש ו${w}`]) {
        const tokens = tokenizeBar(text).tokens;
        const at = tokens.findIndex((t) => t.raw.includes(w));
        expect(readNumber(tokens, at), text).toBeNull();
      }
      // a hand-made word token with that exact norm (the tokenizer lower-cases; other callers may not)
      expect(readNumber([{ kind: 'word', raw: w, norm: w, start: 0, end: w.length, prefixes: [], maqaf: false }], 0), w).toBeNull();
    }
    expect(readNumber(tokenizeBar('שלוש constructor').tokens, 0)).toMatchObject({ value: { num: 3n, den: 1n }, end: 1 });
  });
});
