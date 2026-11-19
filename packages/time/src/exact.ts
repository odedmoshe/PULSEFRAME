/**
 * The BigInt-only arithmetic of rational time, as index.ts had it before its small-number fast paths (2026-11-19). Kept as the
 * reference: index.ts falls back to these whenever a value or product does not fit a safe integer, and time.test.ts checks
 * that every exported function of index.ts answers exactly as these do (same value, same timescale, same error).
 */
import type { Rate, RationalTime } from './index.ts';

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
const n = (t: RationalTime) => BigInt(t.value);
const d = (t: RationalTime) => BigInt(t.timescale);

export function normalize(t: RationalTime): RationalTime {
  const g = gcd(n(t), d(t)) || 1n;
  return { value: (n(t) / g).toString(), timescale: Number(d(t) / g) };
}
export function make(num: bigint, den: bigint): RationalTime {
  const g = gcd(num, den) || 1n;
  const ts = den / g;
  if (ts > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('timescale overflow');
  return { value: (num / g).toString(), timescale: Number(ts) };
}
export const add = (a: RationalTime, b: RationalTime) => make(n(a) * d(b) + n(b) * d(a), d(a) * d(b));
export const sub = (a: RationalTime, b: RationalTime) => make(n(a) * d(b) - n(b) * d(a), d(a) * d(b));
export function cmp(a: RationalTime, b: RationalTime): -1 | 0 | 1 {
  const l = n(a) * d(b);
  const r = n(b) * d(a);
  return l < r ? -1 : l > r ? 1 : 0;
}
export const isNegative = (t: RationalTime) => n(t) < 0n;
export const isZero = (t: RationalTime) => n(t) === 0n;
export const toSeconds = (t: RationalTime) => Number(n(t)) / t.timescale;
export const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};
export const roundDiv = (a: bigint, b: bigint) => {
  const neg = a < 0n !== b < 0n;
  const aa = a < 0n ? -a : a;
  const bb = b < 0n ? -b : b;
  const q = (2n * aa + bb) / (2n * bb);
  return neg ? -q : q;
};
export function frameIndexAt(t: RationalTime, rate: Rate): number {
  return Number(floorDiv(n(t) * BigInt(rate.num), d(t) * BigInt(rate.den)));
}
export function nearestFrameIndex(t: RationalTime, rate: Rate): number {
  return Number(roundDiv(n(t) * BigInt(rate.num), d(t) * BigInt(rate.den)));
}
export function frameTime(index: number, rate: Rate): RationalTime {
  return make(BigInt(index) * BigInt(rate.den), BigInt(rate.num));
}
export function isFrameAligned(t: RationalTime, rate: Rate): boolean {
  return (n(t) * BigInt(rate.num)) % (d(t) * BigInt(rate.den)) === 0n;
}
