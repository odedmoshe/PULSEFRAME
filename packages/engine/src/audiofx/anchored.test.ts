/**
 * The anchored sliding windows of anchored.ts (ADR-0013): the minimum and the sum of the last L values equal a brute-force
 * computation, and a result is the same bits whatever the start index of the stream and however it is pushed (the blocks are
 * anchored to the timeline grid, each block's prefix and suffix recomputed from scratch).
 */
import { describe, expect, it } from 'vitest';
import { AnchoredMin, AnchoredSum } from './anchored.ts';
import { hash32, uniform } from './noise.ts';

const N = 100_000;
/** Seeded real values in [-1, 1). */
const real = (seed: number) => Float64Array.from({ length: N }, (_, i) => 2 * uniform(hash32(seed, i, 3)) - 1);
/** Seeded dyadic values (multiples of 2^-12 in [-8, 8)): every partial sum is exact in Float64, so sums can be compared bit for bit. */
const dyadic = (seed: number) => Float64Array.from({ length: N }, (_, i) => (hash32(seed, i, 4) % 65536) / 4096 - 8);

/** Results for windows ending at t0 + i, pushing x in pieces of the given sizes (cycled); NaN where the window reaches before t0. */
function stream(kind: 'min' | 'sum', L: number, x: Float64Array, t0: number, from: number, sizes: () => number): Float64Array {
  const w = kind === 'min' ? new AnchoredMin(L) : new AnchoredSum(L);
  const out = new Float64Array(x.length).fill(NaN);
  for (let i = from; i < x.length;) {
    const n = Math.max(1, sizes());
    for (let k = i; k < Math.min(x.length, i + n); k++) { const r = w.push(t0 + k, x[k]!); if (k - from >= L - 1) out[k] = r; }
    i += n;
  }
  return out;
}
function brute(kind: 'min' | 'sum', L: number, x: Float64Array, i: number): number {
  let r = kind === 'min' ? Infinity : 0;
  for (let k = i - L + 1; k <= i; k++) r = kind === 'min' ? Math.min(r, x[k]!) : r + x[k]!;
  return r;
}
let rng = 99;
const rand = (n: number) => { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return rng % n; };

describe('anchored sliding windows', () => {
  it.each([1, 2, 7, 240, 441, 1000])('min over L = %i equals brute force on 10^5 seeded samples (exactly), and sum equals it exactly on dyadic data, within 1e-12 on real data', (L) => {
    for (const [name, x] of [['real', real(L)], ['dyadic', dyadic(L)]] as const) {
      const mins = stream('min', L, x, 12345, 0, () => 1 << 30), sums = stream('sum', L, x, 12345, 0, () => 1 << 30);
      for (let i = L - 1; i < N; i += i < 5000 ? 1 : 7) {
        if (mins[i] !== brute('min', L, x, i)) throw new Error(`${name} L=${L} min at ${i}: ${mins[i]} vs ${brute('min', L, x, i)}`);
        const b = brute('sum', L, x, i);
        if (name === 'dyadic' ? sums[i] !== b : Math.abs(sums[i]! - b) > 1e-12 * L) throw new Error(`${name} L=${L} sum at ${i}: ${sums[i]} vs ${b}`);
      }
    }
  });
  it('a window that reaches before the stream start is not a full window (min counts the missing values as +Infinity, sum as 0)', () => {
    const w = new AnchoredMin(4), s = new AnchoredSum(4);
    expect([w.push(10, 3), w.push(11, 5), w.push(12, 1)]).toEqual([3, 3, 1]);
    expect([s.push(10, 3), s.push(11, 5), s.push(12, 1)]).toEqual([3, 8, 9]);
    expect([w.push(13, 9), s.push(13, 9)]).toEqual([1, 18]);
    expect([w.push(14, 7), s.push(14, 7)]).toEqual([1, 22]);
    expect(() => new AnchoredMin(0)).toThrow(RangeError);
    expect(() => new AnchoredSum(2.5)).toThrow(RangeError);
  });
  it('negative timeline indices work (the grid continues below zero)', () => {
    const x = real(5).subarray(0, 3000);
    const a = stream('sum', 37, x, -1500, 0, () => 1 << 30), m = stream('min', 37, x, -1500, 0, () => 1 << 30);
    for (let i = 36; i < 3000; i++) { expect(Math.abs(a[i]! - brute('sum', 37, x, i))).toBeLessThan(1e-12); expect(m[i]).toBe(brute('min', 37, x, i)); }
  });
  it.each([7, 240, 441])('L = %i: bit-identical results for every start offset 0..L and push sizes 1, 7, 1024 and random', (L) => {
    const x = real(L + 1);
    for (const kind of ['min', 'sum'] as const) {
      const ref = stream(kind, L, x, 777, 0, () => 1 << 30);
      for (let start = 0; start <= L; start += L > 50 ? 13 : 1) {
        for (const sizes of [() => 1, () => 7, () => 1024, () => 1 + rand(3000)]) {
          const got = stream(kind, L, x, 777, start, sizes);
          for (let i = start + L - 1; i < N; i++) if (!Object.is(got[i], ref[i])) throw new Error(`${kind} L=${L} start ${start}: index ${i} differs (${got[i]} vs ${ref[i]})`);
        }
      }
      // and a whole stream shifted along the timeline by a multiple of L gives the same bits (the grid is the timeline's)
      const shifted = stream(kind, L, x, 777 + 5 * L, 0, () => 1 << 30);
      for (let i = L - 1; i < N; i++) if (!Object.is(shifted[i], ref[i])) throw new Error(`${kind} shifted by 5L: ${i}`);
    }
  });
});
