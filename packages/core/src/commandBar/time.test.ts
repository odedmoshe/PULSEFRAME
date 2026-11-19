/**
 * Exact times of the command bar (ADR-0027, plan §4.3, §8 W1 "Time"): a table of time phrases → exact rationals (seconds
 * plus whole frames); the ONE conversion to a frame index at 24, 25, 30000/1001, 30 and 60 fps equals an integer oracle;
 * half a frame is refused; «בשנייה השלישית» asks; and time.ts uses no float helper.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { tokenizeBar } from './match.ts';
import { parseTime, readAmount } from './time.ts';

/** [phrase, seconds num, seconds den, frames] */
export const TIME_TABLE: [string, bigint, bigint, bigint][] = [
  ['שנייה', 1n, 1n, 0n], ['שניה', 1n, 1n, 0n], ['דקה', 60n, 1n, 0n], ['שעה', 3600n, 1n, 0n], ['פריים', 0n, 1n, 1n],
  ['שנייה וחצי', 3n, 2n, 0n], ['דקה ורבע', 75n, 1n, 0n], ['שעה וחצי', 5400n, 1n, 0n], ['דקה ושליש', 80n, 1n, 0n], ['שנייה ושלושה רבעים', 7n, 4n, 0n],
  ['חצי שנייה', 1n, 2n, 0n], ['רבע שעה', 900n, 1n, 0n], ['שליש שנייה', 1n, 3n, 0n], ['3 שניות', 3n, 1n, 0n], ['שלוש שניות', 3n, 1n, 0n], ['שתי דקות', 120n, 1n, 0n],
  ['דקותיים', 120n, 1n, 0n], ['שעתיים', 7200n, 1n, 0n], ['עשר שניות', 10n, 1n, 0n], ['עשרים וחמש שניות', 25n, 1n, 0n], ['שמונה עשרה שניות', 18n, 1n, 0n], ['90 שניות', 90n, 1n, 0n],
  ['1.5 שניות', 3n, 2n, 0n], ['0.04 שניות', 1n, 25n, 0n], ['2.5s', 5n, 2n, 0n], ['3s', 3n, 1n, 0n], ['3 sec', 3n, 1n, 0n], ['3 min', 180n, 1n, 0n], ['2 שעות', 7200n, 1n, 0n],
  ['12 פריימים', 0n, 1n, 12n], ['12f', 0n, 1n, 12n], ['5 frames', 0n, 1n, 5n], ['מאה פריימים', 0n, 1n, 100n],
  ['דקה ו־10 שניות', 70n, 1n, 0n], ['דקה ועשר שניות', 70n, 1n, 0n], ['דקה ועשר', 70n, 1n, 0n], ['2 דקות ו־5 שניות', 125n, 1n, 0n], ['שנייה ו־12 פריימים', 1n, 1n, 12n],
  ['שבע שניות ו־3 פריימים', 7n, 1n, 3n], ['שעה ועשרים', 4800n, 1n, 0n], ['שעה ועשרים דקות', 4800n, 1n, 0n], ['שעה ו־2 דקות ו־3 שניות', 3723n, 1n, 0n], ['ארבע דקות ושלושים שניות', 270n, 1n, 0n],
  ['שלוש וחצי שניות', 7n, 2n, 0n], ['חמש דקות וחצי', 330n, 1n, 0n], ['שנייה אחת', 1n, 1n, 0n], ['דקה אחת', 60n, 1n, 0n],
  ['1:10', 70n, 1n, 0n], ['0:05', 5n, 1n, 0n], ['10:00', 600n, 1n, 0n], ['1:02:03', 3723n, 1n, 0n], ['00:00:03:12', 3n, 1n, 12n], ['00:01:00:00', 60n, 1n, 0n],
  ['בשנייה 3', 3n, 1n, 0n], ['בדקה 2', 120n, 1n, 0n], ['בפריים 30', 0n, 1n, 30n], ['לשנייה וחצי', 3n, 2n, 0n], ['ב־3 שניות', 3n, 1n, 0n], ['ל־4 שניות', 4n, 1n, 0n], ['ב־1:10', 70n, 1n, 0n],
  ['one second', 1n, 1n, 0n], ['two seconds', 2n, 1n, 0n], ['half a second', 1n, 2n, 0n], ['one and a half seconds', 3n, 2n, 0n], ['ten minutes', 600n, 1n, 0n], ['1 minute and 10 seconds', 70n, 1n, 0n],
];

const RATES: T.Rate[] = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }];
/** The integer oracle: round(secs · rate) with ties up, by BigInt only, plus the frames. */
function oracle(num: bigint, den: bigint, frames: bigint, rate: T.Rate): number {
  const a = num * BigInt(rate.num), b = den * BigInt(rate.den);
  return Number((2n * a + b) / (2n * b) + frames);
}

describe('time phrases → exact rationals', () => {
  it('has at least 60 phrases', () => expect(TIME_TABLE.length).toBeGreaterThanOrEqual(60));
  for (const [phrase, num, den, frames] of TIME_TABLE) {
    it(`${phrase} = ${num}/${den} s + ${frames} f`, () => {
      const { tokens } = tokenizeBar(phrase);
      const r = readAmount(tokens, 0);
      expect(r, phrase).not.toBeNull();
      expect(r!.end, `${phrase}: reads every token`).toBe(tokens.length);
      expect(r!.refused).toBeUndefined();
      expect(r!.alternatives).toBeUndefined();
      expect(r!.amount.secs).toEqual({ num, den });
      expect(r!.amount.frames).toEqual({ num: frames, den: 1n });
    });
  }
});

describe('the one conversion to frames', () => {
  for (const rate of RATES) {
    it(`at ${rate.num}/${rate.den} every phrase lands on the integer oracle's frame`, () => {
      for (const [phrase, num, den, frames] of TIME_TABLE) {
        if (phrase.startsWith('00:00:03:12') && Math.ceil(rate.num / rate.den) <= 12) continue;
        const r = parseTime(tokenizeBar(phrase).tokens, 0, rate);
        expect(r && 'time' in r, phrase).toBe(true);
        const t = (r as { time: { frame: number; rounded: boolean } }).time;
        expect(t.frame, `${phrase} @ ${rate.num}/${rate.den}`).toBe(oracle(num, den, frames, rate));
        expect(t.rounded, phrase).toBe((num * BigInt(rate.num)) % (den * BigInt(rate.den)) !== 0n);
      }
    });
  }
  it('«בשנייה 3» at 30000/1001 is frame 90, stored as frameTime(90) = 3.003 s, and says it was rounded', () => {
    const rate = { num: 30000, den: 1001 };
    const r = parseTime(tokenizeBar('בשנייה 3').tokens, 0, rate) as { time: { frame: number; rounded: boolean; seconds: unknown } };
    expect(r.time.frame).toBe(90);
    expect(r.time.rounded).toBe(true);
    expect(T.eq(T.frameTime(90, rate), T.rt(3003, 1000))).toBe(true);
  });
  it('«שליש שנייה» at 25 fps: 8.333 frames → frame 8 (0.32 s), rounded', () => {
    const r = parseTime(tokenizeBar('שליש שנייה').tokens, 0, { num: 25, den: 1 }) as { time: { frame: number; rounded: boolean } };
    expect(r.time).toMatchObject({ frame: 8, rounded: true });
  });
  it('frames said as frames are added after the one rounding, as integers', () => {
    const r = parseTime(tokenizeBar('שנייה ו־12 פריימים').tokens, 0, { num: 30000, den: 1001 }) as { time: { frame: number; seconds: unknown; frames: number } };
    expect(r.time).toMatchObject({ frame: 30 + 12, seconds: { num: 1n, den: 1n }, frames: 12 });
  });
});

describe('never guessed', () => {
  it('«בשנייה השלישית» asks: the start of the third second (0:02) or 0:03', () => {
    const t = tokenizeBar('בשנייה השלישית').tokens;
    expect(parseTime(t, 0, { num: 30, den: 1 })).toEqual({ ambiguous: true, end: 2 });
    expect(readAmount(t, 0)!.alternatives!.map((a) => a.secs.num)).toEqual([2n, 3n]);
  });
  it('«1,5 שניות» asks', () => expect(parseTime(tokenizeBar('1,5 שניות').tokens, 0, { num: 30, den: 1 })).toMatchObject({ ambiguous: true }));
  it('half a frame is refused: a frame is the smallest unit', () => {
    for (const p of ['חצי פריים', 'פריים וחצי', '2.5 פריימים']) expect(parseTime(tokenizeBar(p).tokens, 0, { num: 30, den: 1 }), p).toMatchObject({ refused: 'half_frame' });
  });
  it('out of range: a field of 60 or more, a frame field at the nominal rate, more than 10^6 seconds', () => {
    const r30 = { num: 30, den: 1 };
    expect(parseTime(tokenizeBar('1:70').tokens, 0, r30)).toMatchObject({ refused: 'out_of_range' });
    expect(parseTime(tokenizeBar('00:00:01:30').tokens, 0, r30)).toMatchObject({ refused: 'out_of_range' });
    expect(parseTime(tokenizeBar('00:00:01:29').tokens, 0, r30)).toMatchObject({ time: { frame: 59 } });
    expect(parseTime(tokenizeBar('00:00:01:29').tokens, 0, { num: 30000, den: 1001 })).toMatchObject({ time: { frame: 59 } });
    expect(parseTime(tokenizeBar('2000000 שניות').tokens, 0, r30)).toMatchObject({ refused: 'out_of_range' });
  });
  it('the article makes a unit an object, not a time («הפריים»)', () => expect(parseTime(tokenizeBar('הפריים').tokens, 0, { num: 30, den: 1 })).toBeNull());
  it('«שנייה ועשר» does not invent frames: the bare number after seconds is left unread', () => expect(readAmount(tokenizeBar('שנייה ועשר').tokens, 0)!.end).toBe(1));
});

describe('the float helpers stay out of time.ts', () => {
  it('has no parseFloat, toFixed or Math.round', () => {
    const src = readFileSync(new URL('./time.ts', import.meta.url), 'utf8');
    for (const banned of ['parseFloat', 'toFixed', 'Math.round']) expect(src.includes(banned), banned).toBe(false);
  });
});
