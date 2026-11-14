import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from './index.ts';

const NTSC = { num: 30000, den: 1001 };
describe('rational time', () => {
  it('keeps 60fps frames and 48k samples exact where microseconds cannot', () => {
    const f1 = T.frameTime(1, { num: 60, den: 1 });
    expect(f1).toEqual({ value: '1', timescale: 60 });
    // 1/60 s is not an integer number of microseconds; the rounded boundary value differs from exact
    expect(T.toMicros(f1)).toBe(16667n);
    expect(T.eq(T.fromMicros(16667n), f1)).toBe(false);
    expect(T.sampleIndexAt(T.frameTime(7, { num: 60, den: 1 }), 48000)).toBe(5600);
  });
  it('never accumulates rounding across NTSC frames', () => {
    let acc = T.ZERO;
    const one = T.frameTime(1, NTSC);
    for (let i = 0; i < 5000; i++) acc = T.add(acc, one);
    expect(T.eq(acc, T.frameTime(5000, NTSC))).toBe(true);
    expect(T.frameIndexAt(acc, NTSC)).toBe(5000);
  });
  it('half-open frame containment', () => {
    const r = { num: 30, den: 1 };
    expect(T.frameIndexAt(T.rt(29, 900), r)).toBe(0);
    expect(T.frameIndexAt(T.rt(30, 900), r)).toBe(1);
    expect(T.frameIndexAt(T.rt(-1, 900), r)).toBe(-1);
  });
  it('rounds microseconds half away from zero', () => {
    expect(T.toMicros(T.rt(1, 2_000_000))).toBe(1n);
    expect(T.toMicros(T.rt(-1, 2_000_000))).toBe(-1n);
    expect(T.toMicros(T.rt(1, 3))).toBe(333333n);
  });
  it('parses decimal seconds exactly', () => {
    expect(T.fromSeconds('1.5')).toEqual({ value: '3', timescale: 2 });
    expect(T.fromSeconds(0.1)).toEqual({ value: '1', timescale: 10 });
  });
  it('timecode', () => {
    expect(T.toTimecode(T.rt(3723, 1), { num: 30, den: 1 })).toBe('01:02:03:00');
    expect(T.toTimecode(T.frameTime(31, { num: 30, den: 1 }), { num: 30, den: 1 })).toBe('00:00:01:01');
  });
  it('rejects malformed values', () => {
    expect(T.isRationalTime({ value: '1.5', timescale: 10 })).toBe(false);
    expect(T.isRationalTime({ value: '5', timescale: 0 })).toBe(false);
    expect(() => T.rt(1, 0)).toThrow();
  });
});

const rate = fc.constantFrom({ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30, den: 1 }, { num: 60, den: 1 }, NTSC, { num: 24000, den: 1001 }, { num: 60000, den: 1001 });
const time = fc.tuple(fc.integer({ min: -1e9, max: 1e9 }), fc.constantFrom(1, 30, 600, 1001, 48000, 60000, 1_000_000)).map(([v, s]) => T.rt(v, s));
describe('rational time properties', () => {
  it('frameTime/frameIndexAt round-trip for every rate', () => {
    fc.assert(fc.property(rate, fc.integer({ min: -1e7, max: 1e7 }), (r, i) => T.frameIndexAt(T.frameTime(i, r), r) === i && T.isFrameAligned(T.frameTime(i, r), r)));
  });
  it('add/sub are exact inverses and ordering is consistent', () => {
    fc.assert(fc.property(time, time, (a, b) => T.eq(T.sub(T.add(a, b), b), a) && T.cmp(a, b) === -T.cmp(b, a) as number));
  });
  it('a time lies inside the frame that contains it', () => {
    fc.assert(fc.property(rate, time, (r, t) => {
      const i = T.frameIndexAt(t, r);
      return T.lte(T.frameTime(i, r), t) && T.lt(t, T.frameTime(i + 1, r));
    }));
  });
  it('snapping is idempotent and within half a frame', () => {
    fc.assert(fc.property(rate, time, (r, t) => {
      const s = T.snapToFrame(t, r);
      const half = T.rt(r.den, 2 * r.num);
      const dist = T.lt(s, t) ? T.sub(t, s) : T.sub(s, t);
      return T.eq(T.snapToFrame(s, r), s) && T.lte(dist, half);
    }));
  });
});
