/**
 * Exact rational time (SPEC §5).
 *
 * A time is `value / timescale` seconds. `value` is a decimal-string integer so the
 * JSON form is exact for any magnitude. Rates are rationals (e.g. 30000/1001).
 * Intervals are half-open: [start, start + duration).
 * Nothing here accumulates rounded durations; frame k starts at exactly k * den / num.
 */
import * as X from './exact.ts';
export interface RationalTime {
  /** Integer numerator as a decimal string (may be negative). */
  value: string;
  /** Positive integer ticks per second. */
  timescale: number;
}
export interface Rate {
  num: number;
  den: number;
}

export function isRationalTime(x: unknown): x is RationalTime {
  if (typeof x !== 'object' || x === null) return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.value === 'string' && /^-?\d+$/.test(t.value) &&
    typeof t.timescale === 'number' && Number.isSafeInteger(t.timescale) && t.timescale > 0
  );
}

export function rt(value: bigint | number | string, timescale: number): RationalTime {
  if (!Number.isSafeInteger(timescale) || timescale <= 0) throw new RangeError(`invalid timescale ${timescale}`);
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError(`non-integer time value ${value}`);
  return { value: BigInt(value).toString(), timescale };
}
export const ZERO: RationalTime = rt(0, 1);

/*
 * Fast paths (2026-11-19): when every value involved is an integer of at most 15 digits and every timescale and rate field a
 * safe integer, the products and sums below are computed in JS numbers, exactly: a product or sum of integers whose true
 * value is at most Number.MAX_SAFE_INTEGER is exact in a double, and one whose true value is larger comes out larger than
 * MAX_SAFE_INTEGER, which sends the call to the BigInt reference (exact.ts) instead. Lowest terms with the sign of the
 * denominator are unique, so both paths give the same value and timescale; anything unusual (a longer value, a value that is
 * not plain digits, a fractional or unsafe timescale or rate, a zero divisor) takes the reference path and so also throws as
 * it does. Never floats for times (ADR-0003): these are integer operations.
 */
const MAX = Number.MAX_SAFE_INTEGER;
/** Test hook (packages/evals commit-equivalence.test.ts): true sends every call to the BigInt reference. Never set outside tests. */
export const TIME_REFERENCE = { on: false };
const safe = Number.isSafeInteger;
const fits = (x: number) => x <= MAX && x >= -MAX;
/** The value as an exact number when it is plain decimal digits (optional minus) of at most 15 digits; else undefined. */
function small(v: string): number | undefined {
  if (typeof v !== 'string' || TIME_REFERENCE.on) return undefined;
  const len = v.length;
  let i = len > 0 && v.charCodeAt(0) === 45 ? 1 : 0;
  if (i === len || len - i > 15) return undefined;
  for (; i < len; i++) { const c = v.charCodeAt(i); if (c < 48 || c > 57) return undefined; }
  return Number(v) + 0; // '-0' reads as 0, as BigInt reads it
}
/** num/den in lowest terms, the denominator keeping den's sign (as exact.ts make). Both are exact integers within MAX. */
function makeSmall(num: number, den: number): RationalTime {
  let x = num < 0 ? -num : num, y = den < 0 ? -den : den;
  while (y) { const r = x % y; x = y; y = r; }
  const g = x || 1;
  return { value: String(num / g), timescale: den / g + 0 };
}

/** Reduce to lowest terms. Canonical form used when comparing documents. */
export function normalize(t: RationalTime): RationalTime {
  const v = small(t.value);
  return v !== undefined && safe(t.timescale) ? makeSmall(v, t.timescale) : X.normalize(t);
}
function addSub(a: RationalTime, b: RationalTime, minus: boolean): RationalTime {
  const av = small(a.value), bv = small(b.value), at = a.timescale, bt = b.timescale;
  if (av !== undefined && bv !== undefined && safe(at) && safe(bt)) {
    if (at === bt && at > 0) { const num = minus ? av - bv : av + bv; if (fits(num)) return makeSmall(num, at); }
    else {
      const l = av * bt, r = bv * at, den = at * bt, num = minus ? l - r : l + r;
      if (fits(l) && fits(r) && fits(num) && fits(den)) return makeSmall(num, den);
    }
  }
  return minus ? X.sub(a, b) : X.add(a, b);
}
export const add = (a: RationalTime, b: RationalTime) => addSub(a, b, false);
export const sub = (a: RationalTime, b: RationalTime) => addSub(a, b, true);
export function cmp(a: RationalTime, b: RationalTime): -1 | 0 | 1 {
  const av = small(a.value), bv = small(b.value), at = a.timescale, bt = b.timescale;
  if (av !== undefined && bv !== undefined && safe(at) && safe(bt)) {
    if (at === bt && at > 0) return av < bv ? -1 : av > bv ? 1 : 0;
    const l = av * bt, r = bv * at;
    if (fits(l) && fits(r)) return l < r ? -1 : l > r ? 1 : 0;
  }
  return X.cmp(a, b);
}
export const eq = (a: RationalTime, b: RationalTime) => cmp(a, b) === 0;
export const lt = (a: RationalTime, b: RationalTime) => cmp(a, b) < 0;
export const lte = (a: RationalTime, b: RationalTime) => cmp(a, b) <= 0;
export const min = (a: RationalTime, b: RationalTime) => (lte(a, b) ? a : b);
export const max = (a: RationalTime, b: RationalTime) => (lte(a, b) ? b : a);
export const isNegative = (t: RationalTime) => { const v = small(t.value); return v !== undefined ? v < 0 : X.isNegative(t); };
export const isZero = (t: RationalTime) => { const v = small(t.value); return v !== undefined ? v === 0 : X.isZero(t); };

/** Lossy; for display and for APIs that only take float seconds. */
export const toSeconds = (t: RationalTime) => { const v = small(t.value); return v !== undefined ? v / t.timescale : X.toSeconds(t); };

const n = (t: RationalTime) => BigInt(t.value);
const d = (t: RationalTime) => BigInt(t.timescale);
/** Round half away from zero on the absolute value (documented API-boundary rounding). */
const roundDiv = X.roundDiv;
/** t * rate.num and t.timescale * rate.den as exact numbers, or null when the reference path must answer. */
function scaled(t: RationalTime, rate: Rate): [number, number] | null {
  const v = small(t.value);
  if (v === undefined || !safe(t.timescale) || !safe(rate.num) || !safe(rate.den)) return null;
  const a = v * rate.num, b = t.timescale * rate.den;
  return fits(a) && fits(b) && b !== 0 ? [a, b] : null;
}

/** Index of the frame whose half-open interval contains `t` (floor). */
export function frameIndexAt(t: RationalTime, rate: Rate): number {
  const s = scaled(t, rate);
  if (!s) return X.frameIndexAt(t, rate);
  const [a, b] = s, r = a % b;
  const q = (a - r) / b;
  return (r !== 0 && a < 0 !== b < 0 ? q - 1 : q) + 0;
}
/** Index of the frame boundary nearest to `t` (ties round up). Used for snapping. */
export function nearestFrameIndex(t: RationalTime, rate: Rate): number {
  const s = scaled(t, rate);
  if (s) {
    const [a, b] = s, aa = a < 0 ? -a : a, bb = b < 0 ? -b : b, x = 2 * aa + bb, y = 2 * bb;
    if (fits(x) && fits(y)) { const q = (x - (x % y)) / y; return (a < 0 !== b < 0 ? -q : q) + 0; }
  }
  return X.nearestFrameIndex(t, rate);
}
/** Exact start time of frame `index`. */
export function frameTime(index: number, rate: Rate): RationalTime {
  if (!TIME_REFERENCE.on && safe(index) && safe(rate.num) && safe(rate.den)) { const num = index * rate.den; if (fits(num)) return makeSmall(num, rate.num); }
  return X.frameTime(index, rate);
}
/** Exact number of whole frames in a duration (floor). */
export const frameCount = (duration: RationalTime, rate: Rate) => frameIndexAt(duration, rate);
export const snapToFrame = (t: RationalTime, rate: Rate) => frameTime(nearestFrameIndex(t, rate), rate);
export function isFrameAligned(t: RationalTime, rate: Rate): boolean {
  const s = scaled(t, rate);
  return s ? s[0] % s[1] === 0 : X.isFrameAligned(t, rate);
}
/** Exact sample index containing `t` at `sampleRate` (floor). */
export const sampleIndexAt = (t: RationalTime, sampleRate: number) => frameIndexAt(t, { num: sampleRate, den: 1 });
/** Nearest sample index (absolute-time rounding, never accumulated). */
export const nearestSampleIndex = (t: RationalTime, sampleRate: number) => nearestFrameIndex(t, { num: sampleRate, den: 1 });

/** API-boundary conversion to integer microseconds, rounding half away from zero. */
export const toMicros = (t: RationalTime) => roundDiv(n(t) * 1_000_000n, d(t));
export const fromMicros = (us: bigint | number) => rt(us, 1_000_000);
/** Seconds given as a decimal string or finite number -> exact rational (decimal expansion, not float bits). */
export function fromSeconds(seconds: number | string): RationalTime {
  const s = typeof seconds === 'number' ? seconds.toFixed(6) : seconds.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,9}))?$/.exec(s);
  if (!m) throw new RangeError(`invalid seconds ${seconds}`);
  const frac = m[3] ?? '';
  const scale = 10 ** frac.length;
  return normalize(rt(BigInt(`${m[1] ?? ""}${m[2] ?? ""}${frac}`), scale));
}

/** Non-drop-frame display timecode HH:MM:SS:FF at the nominal (rounded-up) frame base. */
export function toTimecode(t: RationalTime, rate: Rate): string {
  const f = Math.max(0, frameIndexAt(t, rate));
  const base = Math.ceil(rate.num / rate.den);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(Math.floor(f / (base * 3600)))}:${p(Math.floor(f / (base * 60)) % 60)}:${p(Math.floor(f / base) % 60)}:${p(f % base)}`;
}
