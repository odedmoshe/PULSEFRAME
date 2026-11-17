/**
 * The time map of a sound clip with effects (ADR-0010, plan section 2): where in the playing-order source each output sample
 * of the clip is read, and the band-limited interpolation that reads it.
 *
 *   u(i) = phase0 + i·step                     exact rational: integers only after the cursor is opened (BigInt only at open)
 *   step = speed.num·sourceRate / (speed.den·planRate)
 *   x[i] = P[u(i)]                             identity copy when step = 1 and phase0 = 0; otherwise windowed sinc
 *
 * Forward: S = sourceIn·sourceRate, origin = floor(S), phase0 = S − origin, so output 0 reads native position S.
 * Reversed: E = sourceEnd·sourceRate, origin = ceil(E), phase0 = origin − E, so output 0 reads native position E − 1.
 *
 * The interpolation filter (Kaiser-windowed sinc, 32·max(1, ceil(step)) taps, 256 phases with linear interpolation between
 * them, cutoff 0.45·min(1, 1/step) cycles per source sample) is designed once per voice with + − × ÷ only: sine, square root
 * and the Bessel function are evaluated by series here, so the table is the same bit for bit in every JavaScript engine and
 * no transcendental Math call is needed (ADR-0010 D6).
 */

export type Frac = readonly [bigint, bigint]; // numerator, denominator (> 0), reduced

const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const reduce = (n: bigint, d: bigint): Frac => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return [n / g, d / g]; };
export const floorDiv = (a: bigint, b: bigint): bigint => { const q = a / b; return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q; };
const ceilDiv = (a: bigint, b: bigint): bigint => -floorDiv(-a, b);

export interface TimeMapSpec {
  sourceIn: { value: string; timescale: number };
  sourceEnd: { value: string; timescale: number };
  speed: { num: number; den: number };
  reverse: boolean;
  sourceRate: number;
  planRate: number;
}
export interface TimeMapOrigin { origin: number; phase0: Frac; step: Frac }

/** origin, phase0 and step of a clip's time map (plan section 2). */
export function timeMapOrigin(m: TimeMapSpec): TimeMapOrigin {
  const sr = BigInt(m.sourceRate);
  const t = m.reverse ? m.sourceEnd : m.sourceIn;
  const v = BigInt(t.value) * sr, ts = BigInt(t.timescale);
  const origin = m.reverse ? ceilDiv(v, ts) : floorDiv(v, ts);
  const phase0 = m.reverse ? reduce(origin * ts - v, ts) : reduce(v - origin * ts, ts);
  const step = reduce(BigInt(m.speed.num) * sr, BigInt(m.speed.den) * BigInt(m.planRate));
  if (step[0] <= 0n) throw new RangeError('time map: speed must be positive');
  return { origin: Number(origin), phase0, step };
}

/** Closed form of u(i): integer part and fractional numerator over the common denominator `q`. */
export function positionAt(phase0: Frac, step: Frac, i: number | bigint): { ip: bigint; fr: bigint; q: bigint } {
  const q = (phase0[1] / gcd(phase0[1], step[1])) * step[1];
  const total = phase0[0] * (q / phase0[1]) + BigInt(i) * step[0] * (q / step[1]);
  const ip = floorDiv(total, q);
  return { ip, fr: total - ip * q, q };
}

const EXACT = 2 ** 51; // fr + increment stays an exact double below 2^52

/**
 * u(i) advanced one output sample at a time with integer arithmetic only (no accumulated floats, ADR-0003). Exact for any i:
 * with a common denominator up to 2^51 it uses doubles holding integers, beyond that BigInt.
 */
export class PhaseCursor {
  /** Integer part of u(i) (floor). */
  ip: number;
  private fr: number; private q: number; private bInt: number; private bFrac: number;
  private big: { fr: bigint; q: bigint; bInt: bigint; bFrac: bigint } | null = null;
  constructor(phase0: Frac, step: Frac, i: number) {
    const p = positionAt(phase0, step, i);
    const bInt = step[0] * (p.q / step[1]) / p.q, bFrac = (step[0] * (p.q / step[1])) % p.q;
    this.ip = Number(p.ip);
    if (p.q <= BigInt(EXACT)) { this.fr = Number(p.fr); this.q = Number(p.q); this.bInt = Number(bInt); this.bFrac = Number(bFrac); }
    else { this.big = { fr: p.fr, q: p.q, bInt, bFrac }; this.fr = 0; this.q = 1; this.bInt = Number(bInt); this.bFrac = 0; }
  }
  /** Fraction of u(i) in [0, 1) (rounded once from the exact integers, never accumulated). */
  frac(): number { return this.big ? Number(this.big.fr) / Number(this.big.q) : this.fr / this.q; }
  /** Exact fractional numerator and denominator (for tests). */
  exact(): { ip: bigint; fr: bigint; q: bigint } { return this.big ? { ip: BigInt(this.ip), fr: this.big.fr, q: this.big.q } : { ip: BigInt(this.ip), fr: BigInt(this.fr), q: BigInt(this.q) }; }
  next(): void {
    if (this.big) {
      const b = this.big;
      b.fr += b.bFrac; this.ip += this.bInt;
      if (b.fr >= b.q) { b.fr -= b.q; this.ip++; }
      return;
    }
    this.fr += this.bFrac; this.ip += this.bInt;
    if (this.fr >= this.q) { this.fr -= this.q; this.ip++; }
  }
}

// ---- filter design with + − × ÷ only -------------------------------------------------------------------------------
const PI = 3.141592653589793;
/** sin(π·x) by range reduction and a Taylor series (|error| < 1e-16). */
function sinPi(x: number): number {
  let r = x - 2 * Math.round(x / 2); // [-1, 1]
  if (r > 0.5) r = 1 - r; else if (r < -0.5) r = -1 - r; // [-0.5, 0.5]: sin(π(1 − r)) = sin(πr)
  const t = PI * r, t2 = t * t;
  let term = t, sum = t;
  for (let n = 1; n < 14; n++) { term = (-term * t2) / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}
const sinc = (x: number) => (x === 0 ? 1 : sinPi(x) / (PI * x));
/** Square root by Newton's method (x ≥ 0). */
function sqrtN(x: number): number {
  if (x <= 0) return 0;
  let s = x > 1 ? x : 1;
  for (let k = 0; k < 100; k++) { const n = (s + x / s) / 2; if (n >= s) break; s = n; }
  return s;
}
/** Modified Bessel function of the first kind, order 0, by its power series. */
function besselI0(x: number): number {
  const h = (x * x) / 4;
  let term = 1, sum = 1;
  for (let k = 1; k < 500; k++) { term = (term * h) / (k * k); sum += term; if (term < sum * 1e-21) break; }
  return sum;
}

export const SINC_PHASES = 256;
export const KAISER_BETA = 9;
export interface SincTable { taps: number; half: number; cutoff: number; /** (SINC_PHASES + 1) rows of `taps` coefficients; row p is for fraction p/SINC_PHASES; each row sums to 1 */ coef: Float64Array }
const tableCache = new Map<number, SincTable>();
/** The interpolation table for a step (cached by tap count and cutoff). */
export function sincTable(step: number): SincTable {
  const widen = Math.max(1, -Math.floor(-step)); // ceil(step)
  const taps = 32 * widen, half = taps / 2, cutoff = 0.45 * Math.min(1, 1 / step);
  const key = taps * 1e7 + Math.round(cutoff * 1e6);
  const hit = tableCache.get(key);
  if (hit && hit.cutoff === cutoff) return hit;
  const coef = new Float64Array((SINC_PHASES + 1) * taps);
  const i0b = besselI0(KAISER_BETA);
  for (let p = 0; p <= SINC_PHASES; p++) {
    const f = p / SINC_PHASES;
    let sum = 0;
    for (let t = 0; t < taps; t++) {
      const x = t - half + 1 - f; // distance of tap t from the read position, in source samples
      const r = x / half;
      const w = r <= -1 || r >= 1 ? (r === -1 || r === 1 ? 1 / i0b : 0) : besselI0(KAISER_BETA * sqrtN(1 - r * r)) / i0b;
      const h = 2 * cutoff * sinc(2 * cutoff * x) * w;
      coef[p * taps + t] = h;
      sum += h;
    }
    for (let t = 0; t < taps; t++) coef[p * taps + t] = coef[p * taps + t]! / sum;
  }
  const table = { taps, half, cutoff, coef };
  if (tableCache.size > 64) tableCache.clear();
  tableCache.set(key, table);
  return table;
}

/**
 * Reads the playing-order source P at u(i) for consecutive outputs i, starting at `startI`.
 * `firstInput(i)` .. `endInput(i)` (exclusive) is the stretch of P the output sample i reads.
 */
export class SourceTimeMap {
  readonly identity: boolean;
  /** Taps before (half − 1) and after (half) the read position; 0 for the identity copy. */
  readonly half: number;
  private table: SincTable | null;
  private cursor: PhaseCursor;
  private nextI: number;
  constructor(readonly map: TimeMapOrigin, startI: number) {
    this.identity = map.step[0] === map.step[1] && map.phase0[0] === 0n;
    this.table = this.identity ? null : sincTable(Number(map.step[0]) / Number(map.step[1]));
    this.half = this.table?.half ?? 0;
    this.cursor = new PhaseCursor(map.phase0, map.step, startI);
    this.nextI = startI;
  }
  private floorU(i: number): number { return Number(positionAt(this.map.phase0, this.map.step, i).ip); }
  firstInput(i: number): number { return this.identity ? i : this.floorU(i) - this.half + 1; }
  endInput(i: number): number { return this.identity ? i + 1 : this.floorU(i) + this.half + 1; }
  /** The output sample the next `render` starts at. */
  get position(): number { return this.nextI; }
  /**
   * Interleaved stereo outputs for the next `frames` output samples into out[0 .. 2·frames). `src` holds P from index `srcFirst`
   * (src frame 0 = P[srcFirst]) and must cover every input those outputs read.
   */
  render(src: Float32Array, srcFirst: number, out: Float32Array, frames: number): void {
    if (this.identity) {
      const o = (this.nextI - srcFirst) * 2;
      for (let f = 0; f < frames * 2; f++) out[f] = src[o + f]!;
      this.nextI += frames;
      return;
    }
    const tb = this.table!, taps = tb.taps, coef = tb.coef, c = this.cursor;
    for (let f = 0; f < frames; f++) {
      const x = c.frac() * SINC_PHASES;
      const p = Math.floor(x), a = x - p;
      const r0 = p * taps, r1 = r0 + taps;
      let base = (c.ip - this.half + 1 - srcFirst) * 2;
      let l = 0, r = 0;
      for (let t = 0; t < taps; t++, base += 2) {
        const k0 = coef[r0 + t]!;
        const k = k0 + a * (coef[r1 + t]! - k0);
        l += src[base]! * k;
        r += src[base + 1]! * k;
      }
      out[f * 2] = l;
      out[f * 2 + 1] = r;
      c.next();
    }
    this.nextI += frames;
  }
}
