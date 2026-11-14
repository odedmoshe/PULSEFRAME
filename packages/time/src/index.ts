/**
 * Exact rational time (SPEC §5).
 *
 * A time is `value / timescale` seconds. `value` is a decimal-string integer so the
 * JSON form is exact for any magnitude. Rates are rationals (e.g. 30000/1001).
 * Intervals are half-open: [start, start + duration).
 * Nothing here accumulates rounded durations; frame k starts at exactly k * den / num.
 */
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

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

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

const n = (t: RationalTime) => BigInt(t.value);
const d = (t: RationalTime) => BigInt(t.timescale);

/** Reduce to lowest terms. Canonical form used when comparing documents. */
export function normalize(t: RationalTime): RationalTime {
  const g = gcd(n(t), d(t)) || 1n;
  return { value: (n(t) / g).toString(), timescale: Number(d(t) / g) };
}
function make(num: bigint, den: bigint): RationalTime {
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
export const eq = (a: RationalTime, b: RationalTime) => cmp(a, b) === 0;
export const lt = (a: RationalTime, b: RationalTime) => cmp(a, b) < 0;
export const lte = (a: RationalTime, b: RationalTime) => cmp(a, b) <= 0;
export const min = (a: RationalTime, b: RationalTime) => (lte(a, b) ? a : b);
export const max = (a: RationalTime, b: RationalTime) => (lte(a, b) ? b : a);
export const isNegative = (t: RationalTime) => n(t) < 0n;
export const isZero = (t: RationalTime) => n(t) === 0n;

/** Lossy; for display and for APIs that only take float seconds. */
export const toSeconds = (t: RationalTime) => Number(n(t)) / t.timescale;

const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};
/** Round half away from zero on the absolute value (documented API-boundary rounding). */
const roundDiv = (a: bigint, b: bigint) => {
  const neg = a < 0n !== b < 0n;
  const aa = a < 0n ? -a : a;
  const bb = b < 0n ? -b : b;
  const q = (2n * aa + bb) / (2n * bb);
  return neg ? -q : q;
};

/** Index of the frame whose half-open interval contains `t` (floor). */
export function frameIndexAt(t: RationalTime, rate: Rate): number {
  return Number(floorDiv(n(t) * BigInt(rate.num), d(t) * BigInt(rate.den)));
}
/** Index of the frame boundary nearest to `t` (ties round up). Used for snapping. */
export function nearestFrameIndex(t: RationalTime, rate: Rate): number {
  return Number(roundDiv(n(t) * BigInt(rate.num), d(t) * BigInt(rate.den)));
}
/** Exact start time of frame `index`. */
export function frameTime(index: number, rate: Rate): RationalTime {
  return make(BigInt(index) * BigInt(rate.den), BigInt(rate.num));
}
/** Exact number of whole frames in a duration (floor). */
export const frameCount = (duration: RationalTime, rate: Rate) => frameIndexAt(duration, rate);
export const snapToFrame = (t: RationalTime, rate: Rate) => frameTime(nearestFrameIndex(t, rate), rate);
export function isFrameAligned(t: RationalTime, rate: Rate): boolean {
  return (n(t) * BigInt(rate.num)) % (d(t) * BigInt(rate.den)) === 0n;
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
