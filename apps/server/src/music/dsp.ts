/**
 * Arithmetic building blocks of the built-in music synthesiser (ADR-0022). Everything here is made of + − × ÷, comparisons,
 * Math.floor / round / abs / min / max / imul, integer bit operations and typed arrays, so the same request gives the same bytes
 * on every IEEE-754 machine and every Node version: no Math.sin, exp, pow, log or sqrt, not even once at load (stricter than
 * ADR-0010 D6). Tables are built by polynomials; decays are per-sample multiplications by constants worked out by expNeg;
 * pitches come from a literal table of the twelve semitone ratios and exact doubling. Test M9 scans this folder for that.
 */

export const SR = 48000;
const PI = 3.141592653589793;
/** ln(1000): a decay "to −60 dB" in t seconds multiplies by e^(−ln(1000)/(t·SR)) per sample. */
const LN1000 = 6.907755278982137;

/** sin(x) for x in [0, π/2]: the odd Taylor polynomial of degree 17 in Horner form (error below 1e-13 there). */
function sinQuarter(x: number): number {
  const x2 = x * x;
  return x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - (x2 / 156) * (1 - (x2 / 210) * (1 - x2 / 272))))))));
}
/** sin(2π·i/4096) for i = 0..4096 (one guard entry), built by quarter-wave symmetry from sinQuarter. */
export const SINE_SIZE = 4096;
export const SINE = new Float64Array(SINE_SIZE + 1);
{
  const q = SINE_SIZE / 4;
  for (let i = 0; i <= q; i++) {
    const v = i === q ? 1 : sinQuarter((PI / 2) * (i / q));
    SINE[i] = v; SINE[2 * q - i] = v; SINE[2 * q + i] = -v; SINE[SINE_SIZE - i] = -v;
  }
  SINE[0] = 0; SINE[2 * q] = 0; SINE[SINE_SIZE] = 0;
}
/** sin(2π·phase) for any phase (wrapped into [0, 1)), from the table with linear interpolation. */
export function sin01(phase: number): number {
  const p = phase - Math.floor(phase);
  const x = p * SINE_SIZE;
  const i = Math.floor(x);
  const a = SINE[i]!;
  return a + (x - i) * (SINE[i + 1]! - a);
}
/** sin(x) for x in radians, |x| small or large (through the table). */
export const sinRad = (x: number): number => sin01(x / (2 * PI));

/** e^(−x) for x >= 0: halve x until it is below 1/16, a degree-10 Taylor sum, then square back. Arithmetic only. */
export function expNeg(x: number): number {
  if (!(x > 0)) return 1;
  let k = 0;
  while (x > 0.0625) { x /= 2; k++; }
  let term = 1, sum = 1;
  for (let n = 1; n <= 10; n++) { term = (term * -x) / n; sum += term; }
  for (let j = 0; j < k; j++) sum *= sum;
  return sum;
}
/** The per-sample multiplier of a decay that falls by 60 dB in `seconds`. */
export const decay60 = (seconds: number): number => expNeg(LN1000 / (seconds * SR));
/** The per-sample multiplier of a one-pole smoother with time constant `seconds` (1 − e^(−1/(τ·SR)) is its step). */
export const onePoleStep = (seconds: number): number => 1 - expNeg(1 / (seconds * SR));

/** 2^(k/12) for k = 0..11 as literals (equal temperament). */
export const SEMITONE = [1, 1.0594630943592953, 1.122462048309373, 1.189207115002721, 1.2599210498948732, 1.3348398541700344, 1.4142135623730951, 1.4983070768766815, 1.5874010519681994, 1.6817928305074292, 1.7817974362806788, 1.887748625363387] as const;
/** The frequency of a MIDI note (A4 = 69 = 440 Hz): a semitone ratio and exact octave doubling. */
export function midiHz(midi: number): number {
  const rel = midi - 69;
  const oct = Math.floor(rel / 12);
  let f = 440 * SEMITONE[rel - 12 * oct]!;
  if (oct > 0) for (let j = 0; j < oct; j++) f *= 2;
  else for (let j = 0; j < -oct; j++) f /= 2;
  return f;
}
/** A frequency ratio of `cents` / 100 semitones for small detunes (|cents| <= 50): e^(c·ln2/1200) by its series. */
export function centsRatio(cents: number): number {
  const x = (cents * 0.6931471805599453) / 1200;
  return 1 + x + (x * x) / 2 + (x * x * x) / 6 + (x * x * x * x) / 24;
}

/** mulberry32: the composer's random numbers (a uint32 state; the same seed gives the same sequence everywhere). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** xorshift32 noise in [−1, 1): the synthesiser's only noise source. */
export class Noise {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next(): number {
    let x = this.s;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 2147483648 - 1;
  }
}

/** A value below 1e-20 in magnitude is set to 0 (denormals are exact but slow; this keeps the render fast and still deterministic). */
export const flush = (x: number): number => (x < 1e-20 && x > -1e-20 ? 0 : x);

/** The Chamberlin state-variable filter's frequency coefficient 2·sin(π·fc/SR) (stable for fc up to about SR/6). */
export const svfF = (hz: number): number => 2 * sinQuarter((PI * Math.min(hz, SR / 6)) / SR);

/** polyBLEP correction of a sawtooth at phase p (0..1) with phase step dt. */
export function polyBlep(p: number, dt: number): number {
  if (p < dt) { const t = p / dt; return t + t - t * t - 1; }
  if (p > 1 - dt) { const t = (p - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/**
 * Schroeder reverb with Freeverb-style damping: four parallel feedback combs per side (integer delays, the right side a few
 * samples longer for width), then two series all-passes. Mono in, stereo out. States are flushed below 1e-20.
 */
export class Reverb {
  private combs: { buf: Float64Array; i: number; lp: number }[][];
  private aps: { buf: Float64Array; i: number }[][];
  constructor(private size: number, private feedback: number, private damp: number) {
    const base = [1557, 1617, 1491, 1422], apBase = [556, 441];
    const scale = (n: number) => Math.max(8, Math.round(n * size));
    this.combs = [0, 23].map((spread) => base.map((n) => ({ buf: new Float64Array(scale(n) + spread), i: 0, lp: 0 })));
    this.aps = [0, 23].map((spread) => apBase.map((n) => ({ buf: new Float64Array(scale(n) + spread), i: 0 })));
  }
  /** Add the reverb of frames from..to (stored at index frame & mask of each ring) into outL/outR, scaled by `wet`. */
  process(inp: Float64Array, outL: Float64Array, outR: Float64Array, from: number, to: number, wet: number, mask: number): void {
    const fb = this.feedback, d = this.damp, d1 = 1 - d;
    for (let side = 0; side < 2; side++) {
      const out = side === 0 ? outL : outR;
      const combs = this.combs[side]!, aps = this.aps[side]!;
      for (let n = from; n < to; n++) {
        const k = n & mask;
        const x = inp[k]! * 0.25;
        let acc = 0;
        for (let c = 0; c < 4; c++) {
          const cb = combs[c]!;
          const y = cb.buf[cb.i]!;
          cb.lp = flush(y * d1 + cb.lp * d);
          cb.buf[cb.i] = flush(x + cb.lp * fb);
          if (++cb.i === cb.buf.length) cb.i = 0;
          acc += y;
        }
        for (let a = 0; a < 2; a++) {
          const ap = aps[a]!;
          const b = ap.buf[ap.i]!;
          const y = b - acc;
          ap.buf[ap.i] = flush(acc + b * 0.5);
          if (++ap.i === ap.buf.length) ap.i = 0;
          acc = y;
        }
        out[k] = out[k]! + acc * wet;
      }
    }
  }
}

/** √x for x >= 0 by Newton's iteration from a power-of-two start (for reporting a level; arithmetic only). */
export function sqrtOf(x: number): number {
  if (!(x > 0)) return 0;
  let g = 1;
  while (g * g > x) g /= 2;
  while (g * g * 4 <= x) g *= 2;
  for (let i = 0; i < 8; i++) g = 0.5 * (g + x / g);
  return g;
}
