/**
 * Property test of compound time phrases (ADR-0027, plan §8 W1): for seeded random compounds («2 שעות ו־5 דקות ו־7 שניות
 * ו־3 פריימים», with digits, Hebrew words and «וחצי»), the parsed amount equals the sum computed with BigInt from the
 * parts, and the frame index equals the integer oracle at every rate. Deterministic: a fixed-seed generator, no Math.random.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { tokenizeBar } from './match.ts';
import { parseTime, readAmount } from './time.ts';

/** A small fixed-seed generator (LCG), so every run checks the same phrases. */
function lcg(seed: number) { let s = seed >>> 0; return (n: number) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; }; }
/** Hebrew count words the phrases may use (feminine forms; the masculine forms are read the same). */
const WORDS: Record<number, string> = { 2: 'שתיים', 3: 'שלוש', 4: 'ארבע', 5: 'חמש', 6: 'שש', 7: 'שבע', 8: 'שמונה', 9: 'תשע', 10: 'עשר', 11: 'אחת עשרה', 12: 'שתים עשרה', 20: 'עשרים', 30: 'שלושים', 25: 'עשרים וחמש' };
const UNITS = [
  { word: 'שעות', secs: 3600n, frames: 0n, max: 3 },
  { word: 'דקות', secs: 60n, frames: 0n, max: 59 },
  { word: 'שניות', secs: 1n, frames: 0n, max: 59 },
  { word: 'פריימים', secs: 0n, frames: 1n, max: 23 },
];
const RATES: T.Rate[] = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }];

describe('compound phrases equal the BigInt sum of their parts', () => {
  const rnd = lcg(20261118);
  const cases: { phrase: string; num: bigint; den: bigint; frames: bigint }[] = [];
  for (let n = 0; n < 300; n++) {
    // a decreasing choice of units, at least one
    const chosen = UNITS.filter(() => rnd(2) === 1);
    if (!chosen.length) chosen.push(UNITS[rnd(UNITS.length)]!);
    let num = 0n, den = 2n, frames = 0n;
    const parts: string[] = [];
    chosen.forEach((u, k) => {
      const count = 2 + rnd(u.max - 1);
      const asWord = WORDS[count] !== undefined && rnd(2) === 1;
      const half = u.frames === 0n && k === chosen.length - 1 && rnd(3) === 0; // «… וחצי» on the last unit of seconds or more
      const said = `${asWord ? WORDS[count] : count} ${u.word}${half ? ' וחצי' : ''}`;
      parts.push(k === 0 ? said : asWord ? `ו${said}` : `ו־${said}`);
      num += 2n * BigInt(count) * u.secs + (half ? u.secs : 0n);
      frames += BigInt(count) * u.frames;
    });
    cases.push({ phrase: parts.join(' '), num, den, frames });
  }
  it('300 seeded phrases', () => {
    for (const c of cases) {
      const { tokens } = tokenizeBar(c.phrase);
      const r = readAmount(tokens, 0);
      expect(r?.end, c.phrase).toBe(tokens.length);
      const g = (a: bigint, b: bigint): bigint => (b ? g(b, a % b) : a);
      const k = g(c.num, c.den) || 1n;
      expect(r!.amount.secs, c.phrase).toEqual({ num: c.num / k, den: c.den / k });
      expect(r!.amount.frames, c.phrase).toEqual({ num: c.frames, den: 1n });
      for (const rate of RATES) {
        const a = c.num * BigInt(rate.num), b = c.den * BigInt(rate.den);
        const want = Number((2n * a + b) / (2n * b) + c.frames);
        const got = parseTime(tokens, 0, rate);
        expect(got && 'time' in got ? got.time.frame : null, `${c.phrase} @ ${rate.num}/${rate.den}`).toBe(want);
      }
    }
  });
});
