/**
 * The command bar's tokenizer (ADR-0027, plan §8 W1 "Tokens" and "Proclitics"): quotes in all six styles, verbatim;
 * gershayim kept as an abbreviation; maqaf; an unclosed quote; niqqud stripped outside quotes only; proclitics stripped only
 * when the rest is known; spans in the original text.
 */
import { describe, expect, it } from 'vitest';
import { normWord, stripProclitics, tokenize } from './normalize.ts';
import { tokenizeBar } from './match.ts';
import { readAmount } from './time.ts';
import { interpret } from './index.ts';
import { context, fixture } from './fixture.testFixture.ts';

const toks = (s: string) => tokenizeBar(s).tokens;
const kinds = (s: string) => toks(s).map((t) => `${t.kind}:${t.prefixes.join('')}${t.prefixes.length ? '+' : ''}${t.norm}`);

describe('quotes first, verbatim', () => {
  const styles: [string, string][] = [['"', '"'], ['״', '״'], ['“', '”'], ['„', '“'], ['«', '»'], ["'", "'"]];
  for (const [open, close] of styles) {
    it(`reads ${open}…${close} as one quote token, exactly as typed`, () => {
      const text = `הוסף כותרת ${open}יום הולדת  5!${close} כאן`;
      const t = toks(text);
      const q = t.find((x) => x.kind === 'quote')!;
      expect(q.norm).toBe('יום הולדת  5!');
      expect(text.slice(q.start, q.end)).toBe(`${open}יום הולדת  5!${close}`);
      expect(t.map((x) => x.kind)).toEqual(['word', 'word', 'quote', 'word']);
    });
  }
  it('keeps niqqud and case inside a quote and strips them outside', () => {
    const t = toks('הוֹסֵף כותרת "שָׁלוֹם ABC"');
    expect(t[0]!.norm).toBe('הוסף');
    expect(t[2]!.norm).toBe('שָׁלוֹם ABC');
  });
  it('a quote after a lone proclitic (ל"גן רימון") gives the quote that prefix', () => {
    const t = toks('שנה את שם הפרויקט ל"גן רימון"');
    const q = t[t.length - 1]!;
    expect(q.kind).toBe('quote');
    expect(q.norm).toBe('גן רימון');
    expect(q.prefixes).toEqual(['ל']);
  });
  it('an unclosed quote is reported, never guessed', () => {
    const r = tokenizeBar('הוסף כותרת "מזל טוב');
    expect(r.unclosedQuote).toBe(11);
    expect(r.tokens[2]).toMatchObject({ kind: 'quote', norm: 'מזל טוב' });
  });
});

describe('gershayim and geresh', () => {
  it('" or ״ between two Hebrew letters is an abbreviation, not a quote', () => {
    expect(kinds('דצ״ב')).toEqual(['unit:db']);
    expect(kinds('דצ"ב')).toEqual(['unit:db']);
    expect(kinds('ש״ח צה"ל')).toEqual(['word:ש״ח', 'word:צה״ל']);
    expect(tokenizeBar('ב"ה שלום').unclosedQuote).toBeNull();
  });
  it("' and ׳ after a Hebrew letter are the geresh of an abbreviation", () => {
    expect(kinds("3 ש'")).toEqual(['number:3', 'unit:s']);
    expect(kinds('3 שנ׳')).toEqual(['number:3', 'unit:s']);
    expect(kinds('2 דק׳')).toEqual(['number:2', 'unit:min']);
    expect(normWord("וינטג'")).toBe('וינטג׳');
  });
});

describe('tokens', () => {
  it('maqaf and a hyphen between letters split the word and remember it', () => {
    const t = toks('שחור־לבן');
    expect(t.map((x) => x.norm)).toEqual(['שחור', 'לבן']);
    expect(t[1]!.maqaf).toBe(true);
    expect(toks('twenty-five').map((x) => x.norm)).toEqual(['twenty', 'five']);
  });
  it('a lone proclitic before a maqaf, number or timecode becomes the next token\'s prefix', () => {
    expect(kinds('ב־3 שניות')).toEqual(['number:ב+3', 'word:שניות']);
    expect(kinds('ב-1:10')).toEqual(['timecode:ב+1:10']);
    expect(kinds('דקה ו־10 שניות')).toEqual(['word:דקה', 'number:ו+10', 'word:שניות']);
    expect(toks('ב־3 שניות')[0]).toMatchObject({ start: 0, end: 3, raw: 'ב־3' });
  });
  it('numbers, timecodes, units and glued units', () => {
    expect(kinds('1.5 0:12 1:02:03 00:00:03:12')).toEqual(['number:1.5', 'timecode:0:12', 'timecode:1:02:03', 'timecode:00:00:03:12']);
    expect(kinds('3s 12f -6db 50% x2 2x')).toEqual(['number:3', 'unit:s', 'number:12', 'unit:f', 'word:-', 'number:6', 'unit:db', 'number:50', 'unit:%', 'unit:x', 'number:2', 'number:2', 'unit:x']);
    expect(kinds('1,5')).toEqual(['number:1,5']);
  });
  it('lower-cases Latin and drops trailing punctuation', () => {
    expect(kinds('Split HERE, please!')).toEqual(['word:split', 'word:here', 'word:please']);
  });
  it('every token keeps its span in the original text', () => {
    const text = '  פצלי  את הקליפ, פה ';
    for (const t of toks(text)) expect(text.slice(t.start, t.end)).toBe(t.raw);
  });
});

describe('proclitics', () => {
  it('strips listed prefixes when the rest is known: «לוואטסאפ», «בשנייה», «והוסף», «שבסמן», «מהקליפ»', () => {
    expect(kinds('לוואטסאפ')).toEqual(['word:ל+וואטסאפ']);
    expect(kinds('בשנייה')).toEqual(['word:ב+שנייה']);
    expect(kinds('והוסף')).toEqual(['word:ו+הוסף']);
    expect(kinds('שבסמן')).toEqual(['word:שב+סמן']);
    expect(kinds('מהקליפ')).toEqual(['word:מה+קליפ']);
    expect(kinds('והקליפ')).toEqual(['word:וה+קליפ']);
  });
  it('looks a word up as written first («שנייה», «הוסף», «וואטסאפ» are not stripped)', () => {
    expect(kinds('שנייה הוסף וואטסאפ')).toEqual(['word:שנייה', 'word:הוסף', 'word:וואטסאפ']);
  });
  it('never strips an unknown word', () => {
    expect(kinds('בננה לחמניה')).toEqual(['word:בננה', 'word:לחמניה']);
    expect(stripProclitics('בננה', () => false)).toBeNull();
    expect(stripProclitics('בננה', (w) => w === 'ננה')?.prefixes).toEqual(['ב']);
  });
  it('strips nothing when no word is known', () => {
    expect(tokenize('בשנייה', () => false).tokens[0]).toMatchObject({ norm: 'בשנייה', prefixes: [] });
  });
});

describe('words that are Object.prototype keys are plain words', () => {
  const PROTO = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'];
  it('every token norm is a string, and none of these words is a unit', () => {
    for (const w of PROTO) {
      for (const text of [w, `3${w}`, `x${w}`, `ב${w}`, `${w} 3 שניות`]) {
        for (const t of toks(text)) {
          expect(typeof t.norm, `${text}: ${t.raw}`).toBe('string');
          expect(t.kind === 'unit' && t.raw.toLowerCase().includes(w.toLowerCase()), `${text}: ${t.raw} is a unit`).toBe(false);
        }
      }
    }
    expect(kinds('constructor __proto__')).toEqual(['word:constructor', 'word:__proto__']);
  });
  it('the time reader does not take them for units, duals or ordinals', () => {
    for (const w of PROTO) {
      for (const text of [w, `3 ${w}`, `בשנייה ה${w}`, `שנייה ו${w}`]) {
        const tokens = toks(text);
        // a hand-made unit token with that norm, as the time reader would see it from any other tokenizer
        const forged = [{ kind: 'unit' as const, raw: w, norm: w, start: 0, end: w.length, prefixes: [], maqaf: false }];
        expect(() => readAmount(tokens, 0), text).not.toThrow();
        expect(readAmount(forged, 0), `${w} as a unit token`).toBeNull();
        // «בשנייה ה<w>» is one second followed by an unread word, never an ordinal
        const ord = readAmount([{ ...toks('בשנייה')[0]! }, { ...forged[0]!, kind: 'word', prefixes: ['ה'] }], 0);
        expect(ord?.alternatives, `בשנייה ה${w}`).toBeUndefined();
        expect(ord?.end, `בשנייה ה${w}`).toBe(1);
      }
    }
  });
  it('interpret keeps them as unread words', () => {
    for (const w of PROTO) {
      const r = interpret(w, context(fixture().doc));
      expect(JSON.parse(JSON.stringify(r.tokens))).toEqual(r.tokens.map((t) => ({ ...t })));
      for (const t of r.tokens) expect(typeof t.norm).toBe('string');
    }
  });
});
