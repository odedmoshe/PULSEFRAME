/**
 * The small-number fast paths of index.ts against the BigInt reference (exact.ts, the arithmetic as it was before them): every
 * function answers exactly as the reference does (same value string, same timescale, same number down to -0, same error) on
 * random times around every boundary the fast paths test (15 digits, Number.MAX_SAFE_INTEGER, products and sums past it),
 * on the frame rates the product supports and on malformed input.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from './index.ts';
import * as X from './exact.ts';

const MAX = Number.MAX_SAFE_INTEGER;
const digits = (n: number) => fc.array(fc.constantFrom(...'0123456789'), { minLength: n, maxLength: n }).map((d) => d.join(''));
const value = fc.oneof(
  fc.integer({ min: -100000, max: 100000 }).map(String),
  fc.integer({ min: -MAX, max: MAX }).map(String),
  fc.tuple(fc.boolean(), fc.integer({ min: 13, max: 22 }).chain(digits)).map(([neg, s]) => `${neg ? '-' : ''}${s}`),
  fc.constantFrom('0', '-0', '007', '-007', '999999999999999', '-999999999999999', '1000000000000000', '9007199254740991', '9007199254740992', '-9007199254740993', '123456789012345678901234567890'),
);
const odd = fc.constantFrom('', '-', '1e3', '1.5', ' 12', '0x10', '-0x10', '+5', 'abc');
const timescale = fc.oneof(
  fc.integer({ min: 1, max: 1000 }),
  fc.constantFrom(1, 24, 25, 30, 48000, 60000, 30000, 24000, 1001, 90000, 1_000_000, 705_600_000, MAX, MAX - 1, 2 ** 40, 2 ** 26 + 1),
  fc.integer({ min: 1, max: MAX }),
);
const oddTimescale = fc.constantFrom(0, -1, -30, 1.5, 2 ** 60, -0, NaN);
const time = fc.record({ value, timescale });
const anyTime = fc.oneof({ arbitrary: time, weight: 8 }, { arbitrary: fc.record({ value: fc.oneof(value, odd), timescale: fc.oneof(timescale, oddTimescale) }), weight: 1 });
const rate = fc.oneof(
  fc.constantFrom({ num: 30, den: 1 }, { num: 25, den: 1 }, { num: 24000, den: 1001 }, { num: 30000, den: 1001 }, { num: 60, den: 1 }, { num: 60000, den: 1001 }, { num: 48000, den: 1 }),
  fc.record({ num: fc.integer({ min: 1, max: MAX }), den: fc.integer({ min: 1, max: 100000 }) }),
  fc.record({ num: fc.oneof(fc.integer({ min: 1, max: 1000 }), oddTimescale), den: fc.oneof(fc.integer({ min: 1, max: 1000 }), oddTimescale) }),
);
const index = fc.oneof(fc.integer({ min: -100000, max: 100000 }), fc.integer({ min: -MAX, max: MAX }), fc.constantFrom(0, -0, 1.5, 2 ** 60, MAX));

/** The outcome of a call, comparable with toEqual: the value (numbers by Object.is, so -0 differs from 0) or the error. */
function outcome(fn: () => unknown): unknown {
  try {
    const v = fn();
    if (typeof v === 'number') return { number: Object.is(v, -0) ? '-0' : String(v) };
    if (v && typeof v === 'object') { const t = v as T.RationalTime; return { value: t.value, timescale: Object.is(t.timescale, -0) ? '-0' : String(t.timescale) }; }
    return { v };
  } catch (e) { return { error: (e as Error).constructor.name, message: (e as Error).message }; }
}
const same = (a: () => unknown, b: () => unknown) => expect(outcome(a)).toEqual(outcome(b));
const RUNS = { numRuns: Number(process.env.PF_TIME_RUNS ?? 4000) };

describe('rational time: fast paths answer exactly as the BigInt reference', () => {
  it('add, sub, cmp, normalize', () => {
    fc.assert(fc.property(anyTime, anyTime, (a, b) => {
      same(() => T.add(a, b), () => X.add(a, b));
      same(() => T.sub(a, b), () => X.sub(a, b));
      same(() => T.cmp(a, b), () => X.cmp(a, b));
      same(() => T.normalize(a), () => X.normalize(a));
    }), RUNS);
  });
  it('the same timescale (the common case) and equal values', () => {
    fc.assert(fc.property(fc.oneof(value, odd), fc.oneof(value, odd), fc.oneof(timescale, oddTimescale), (x, y, ts) => {
      const a = { value: x, timescale: ts }, b = { value: y, timescale: ts };
      same(() => T.add(a, b), () => X.add(a, b));
      same(() => T.sub(a, b), () => X.sub(a, b));
      same(() => T.cmp(a, b), () => X.cmp(a, b));
      same(() => T.cmp(a, a), () => X.cmp(a, a));
    }), RUNS);
  });
  it('isNegative, isZero, toSeconds', () => {
    fc.assert(fc.property(anyTime, (a) => {
      same(() => T.isNegative(a), () => X.isNegative(a));
      same(() => T.isZero(a), () => X.isZero(a));
      same(() => T.toSeconds(a), () => X.toSeconds(a));
    }), RUNS);
  });
  it('frameIndexAt, nearestFrameIndex, isFrameAligned, frameTime', () => {
    fc.assert(fc.property(anyTime, rate, index, (a, r, i) => {
      same(() => T.frameIndexAt(a, r), () => X.frameIndexAt(a, r));
      same(() => T.nearestFrameIndex(a, r), () => X.nearestFrameIndex(a, r));
      same(() => T.isFrameAligned(a, r), () => X.isFrameAligned(a, r));
      same(() => T.frameTime(i, r), () => X.frameTime(i, r));
    }), RUNS);
  });
  it('exhaustively on small times at the product rates', () => {
    for (const r of [{ num: 30, den: 1 }, { num: 24000, den: 1001 }, { num: 30000, den: 1001 }, { num: 25, den: 1 }])
      for (let v = -40; v <= 40; v++) for (const ts of [1, 2, 3, 30, 60, 1001, 24000, 30000, 48000]) {
        const a = { value: String(v), timescale: ts };
        same(() => T.frameIndexAt(a, r), () => X.frameIndexAt(a, r));
        same(() => T.nearestFrameIndex(a, r), () => X.nearestFrameIndex(a, r));
        same(() => T.isFrameAligned(a, r), () => X.isFrameAligned(a, r));
        same(() => T.normalize(a), () => X.normalize(a));
        same(() => T.add(a, { value: '7', timescale: 30 }), () => X.add(a, { value: '7', timescale: 30 }));
        same(() => T.frameTime(v, r), () => X.frameTime(v, r));
      }
  });
});
