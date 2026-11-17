/**
 * Coefficient design for the sound-effect kernels (ADR-0010 D6). Everything here runs once per kernel instance (or once per
 * distinct parameter set, memoised), never per sample; transcendental Math.* is allowed here and in tables.ts only.
 * Reach (warm-up and tail) is derived here from the designed filters, so it always matches what the kernels compute.
 */
import { audioEffectParams, findAudioEffect, type AudioFxParams } from '@pulseframe/core';
import { WARM_EPS, type FxKernel, type FxProcessor } from './kernel.ts';
import { DIFFUSER_BASE, DIFFUSER_GAIN, FDN_BASE, ROOMS, type RoomId } from './tables.ts';

/** Parameters with the registry defaults filled in (core audioEffects.ts); throws on invalid ones, as validation would. */
export interface FxParamReader { num(key: string): number; str(key: string): string; bool(key: string): boolean; identity: boolean; all: AudioFxParams }
export function fxParams(type: string, p: Readonly<AudioFxParams>): FxParamReader {
  const all = audioEffectParams(type, p);
  const get = (key: string) => { const v = all[key]; if (v === undefined) throw new Error(`${type}: no parameter ${key}`); return v; };
  return { all, identity: findAudioEffect(type)?.isIdentity(all) ?? false, num: (k) => Number(get(k)), str: (k) => String(get(k)), bool: (k) => get(k) === true };
}
/** The processor of an instance whose parameters give exactly the dry sound (such instances are also left out of the plan). */
export const DRY: FxProcessor = { process() { /* the dry sound, untouched */ } };
/** A kernel that also states the largest output peak it can give for inputs within [-1, 1] (checked by the contract tests). */
export interface BoundedKernel extends FxKernel { bound(p: Readonly<AudioFxParams>, sampleRate: number): number }

/** One second-order section, normalised to a0 = 1: [b0, b1, b2, a1, a2]. Run as transposed direct form II in Float64. */
export type Biquad = Float64Array;

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
/** Whole milliseconds to samples, rounded once (as ducking does, audio.ts). */
export const msToSamples = (ms: number, sampleRate: number): number => Math.round((ms * sampleRate) / 1000);

const section = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad => Float64Array.of(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);

// RBJ Audio EQ Cookbook (Robert Bristow-Johnson): bilinear transform with the corner prewarped, so f0 is exact at any rate.
export function lowpass(f0: number, q: number, sampleRate: number): Biquad {
  const w = (2 * Math.PI * f0) / sampleRate, c = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  return section((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}
export function highpass(f0: number, q: number, sampleRate: number): Biquad {
  const w = (2 * Math.PI * f0) / sampleRate, c = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  return section((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha);
}
/** Peaking EQ: `db` at f0, bandwidth by Q. */
export function peaking(f0: number, db: number, q: number, sampleRate: number): Biquad {
  const A = Math.pow(10, db / 40), w = (2 * Math.PI * f0) / sampleRate, c = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  return section(1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A);
}
/** Low shelf with slope S = 1: `db` below f0, 0 dB above, half of it at f0. */
export function lowShelf(f0: number, db: number, sampleRate: number): Biquad {
  const A = Math.pow(10, db / 40), w = (2 * Math.PI * f0) / sampleRate, c = Math.cos(w);
  const alpha = (Math.sin(w) / 2) * Math.SQRT2; // S = 1: sqrt((A + 1/A)(1/S - 1) + 2) = sqrt(2)
  const sa = 2 * Math.sqrt(A) * alpha;
  return section(A * (A + 1 - (A - 1) * c + sa), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - sa), A + 1 + (A - 1) * c + sa, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - sa);
}
/** Q of the two sections of a 4th-order Butterworth filter. */
export const BUTTERWORTH4_Q = [1 / (2 * Math.cos(Math.PI / 8)), 1 / (2 * Math.cos((3 * Math.PI) / 8))] as const;
export const butterworth4 = (kind: 'low' | 'high', f0: number, sampleRate: number): Biquad[] => BUTTERWORTH4_Q.map((q) => (kind === 'low' ? lowpass(f0, q, sampleRate) : highpass(f0, q, sampleRate)));

/** Largest pole radius of a section (stable sections: below 1). */
export function poleRadius(s: Biquad): number {
  const a1 = s[3]!, a2 = s[4]!, disc = a1 * a1 - 4 * a2;
  if (disc < 0) return Math.sqrt(a2);
  const r = Math.sqrt(disc);
  return Math.max(Math.abs((-a1 + r) / 2), Math.abs((-a1 - r) / 2));
}

/** Impulse response of a cascade (Float64, the same recursion the kernels run). */
export function impulseResponse(sections: readonly Biquad[], length: number): Float64Array {
  const h = new Float64Array(length);
  const st = new Float64Array(sections.length * 2);
  for (let n = 0; n < length; n++) {
    let x = n === 0 ? 1 : 0;
    for (let k = 0; k < sections.length; k++) {
      const c = sections[k]!, j = k * 2;
      const y = c[0]! * x + st[j]!;
      st[j] = c[1]! * x - c[3]! * y + st[j + 1]!;
      st[j + 1] = c[2]! * x - c[4]! * y;
      x = y;
    }
    h[n] = x;
  }
  return h;
}

/** How many samples of an impulse response to compute so that what lies beyond is negligible (far below WARM_EPS). */
function horizon(sections: readonly Biquad[], lipschitz: number): number {
  let r = 0;
  for (const s of sections) r = Math.max(r, poleRadius(s));
  if (!(r < 1)) throw new Error('unstable filter');
  if (r === 0) return sections.length * 2 + 1;
  return Math.min(1 << 22, Math.ceil(Math.log((WARM_EPS * 1e-9) / Math.max(1, lipschitz)) / Math.log(r)) + 64 * sections.length);
}

/**
 * Warm-up of a cascade followed by memoryless stages with Lipschitz constant `lipschitz` (ADR-0010 D3): the smallest W with
 * lipschitz · Σ_{k≥W} |h[k]| ≤ eps. Computed on the designed impulse response itself.
 */
export function cascadeWarm(sections: readonly Biquad[], lipschitz = 1, eps = WARM_EPS): number {
  const n = horizon(sections, lipschitz);
  const h = impulseResponse(sections, n);
  let sum = 0;
  for (let k = n - 1; k >= 0; k--) {
    sum += Math.abs(h[k]!);
    if (lipschitz * sum > eps) return k + 1;
  }
  return 0;
}
/** Σ h² of a cascade: the power gain for white noise (used to calibrate hiss levels at the output). */
export function noisePowerGain(sections: readonly Biquad[]): number {
  const h = impulseResponse(sections, horizon(sections, 1));
  let e = 0;
  for (let k = 0; k < h.length; k++) e += h[k]! * h[k]!;
  return e;
}

/**
 * Amplitude of unit-variance noise added before `sections` (and a stage of small-signal gain `gain` after them) so that it comes
 * out at `db` dBFS RMS.
 */
export const calibratedNoise = (db: number, sections: readonly Biquad[], gain: number): number => dbToGain(db) / (Math.sqrt(noisePowerGain(sections)) * gain);

/** Padé drive y = P(k·x)/√k: the gain after the shaper, so small signals rise by √k and the output never exceeds 1/√k. */
export const driveMakeup = (k: number): number => 1 / Math.sqrt(k);

/** One-pole low-pass y += c·(x − y): c for a −3 dB corner near fc. */
export const onePoleCoef = (fc: number, sampleRate: number): number => Math.min(1, 1 - Math.exp((-2 * Math.PI * fc) / sampleRate));
/** Samples after which a one-pole low-pass with coefficient c has given all but eps of its (unit) impulse-response sum. */
export const onePoleWarm = (c: number, eps = WARM_EPS): number => (c >= 1 ? 0 : Math.ceil(Math.log(eps) / Math.log(1 - c)));

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}
export function nextPrime(n: number): number {
  let p = Math.max(2, Math.ceil(n));
  while (!isPrime(p)) p++;
  return p;
}

/** Echo: the wet low-pass corner for `tone` (0 = no filter, 1 = dark repeats, about 1 kHz). */
export const echoToneHz = (tone: number): number => 16000 * Math.pow(1 / 16, tone);

/** Radio level wobble: g = (1 + m·s)/(1 − m·s) for s in [-1, 1] spans exactly ±`db` dB. */
export const amDepth = (db: number): number => { const G = dbToGain(db); return (G - 1) / (G + 1); };

export interface ReverbDesign {
  /** Delay-line lengths (primes) and per-line gains g_i = 10^(−3·len_i/(sr·decay)). */
  lines: Int32Array; gains: Float64Array;
  /** One-pole damping pole inside each line (0 = none). */
  damp: number;
  /** All-pass diffuser lengths (primes), gain DIFFUSER_GAIN. */
  diffusers: Int32Array;
  predelay: number;
  /** Early reflections: delays after the predelay and gains. */
  erTaps: Int32Array; erL: Float64Array; erR: Float64Array;
  /** Output gain of the network so that its energy gain is about 1. */
  fdnGain: number;
  /** Per-sample decay of the network's envelope at low frequencies (damping included). */
  rate: number;
  /** Bound C of the network's impulse response: |h[n]| ≤ C·rate^n, n counted from the network input. */
  bound: number;
  tail: number; warm: number;
}
const reverbCache = new Map<string, ReverbDesign>();
/**
 * An 8-line feedback delay network (normalised Hadamard feedback, per-line gains for one decay rate, one-pole damping),
 * after a predelay and four series all-pass diffusers, plus 12 early reflections.
 * Reach: with g_i = r^len_i the network's response is r^n times that of the lossless network (Jot's uniform decay). Its output
 * is taken as bounded by fdnGain·sqrt(Σ_j rate^-2j·d[j]²)·rate^n for the diffused input d (|b| = |c| = 1): the energy (l2)
 * bound, which treats the energy injected at different times as adding up. That is a model, not a proof: the strict l1 bound
 * (Σ_j |d[j]|·rate^-j) is about 20 times larger and would give tails past the registry's 7.6 s. What makes the model safe is
 * measured: at the declared tail the impulse response is about 800 times below 2^-24, and the response sum after `warm` about
 * 1700 times below it, at the extremes of the parameters (kernels.test.ts checks both). Damping adds loss at high frequencies
 * only and moves the low poles out by a factor below 1 + a(1−r)/((1−a)·len_min), which `rate` includes.
 */
export function reverbDesign(room: RoomId, decaySeconds: number, predelayMs: number, damping: number, sampleRate: number): ReverbDesign {
  const key = `${room}|${decaySeconds}|${predelayMs}|${damping}|${sampleRate}`;
  const hit = reverbCache.get(key);
  if (hit) return hit;
  const R = ROOMS[room], scale = (R.size * sampleRate) / 48000;
  const lines = Int32Array.from(FDN_BASE, (b) => nextPrime(Math.round(b * scale)));
  const gains = Float64Array.from(lines, (len) => Math.pow(10, (-3 * len) / (sampleRate * decaySeconds)));
  const diffusers = Int32Array.from(DIFFUSER_BASE, (b) => nextPrime(Math.round(b * scale)));
  const predelay = msToSamples(predelayMs, sampleRate);
  const erTaps = Int32Array.from(R.erMs, (ms) => Math.max(1, msToSamples(ms, sampleRate)));
  const damp = 0.5 * damping;
  const r = Math.pow(10, -3 / (sampleRate * decaySeconds));
  let lenMin = Infinity, lenMax = 0, lenSum = 0;
  for (const len of lines) { lenMin = Math.min(lenMin, len); lenMax = Math.max(lenMax, len); lenSum += len; }
  const rate = Math.min(1 - 1e-12, r * (1 + (damp * (1 - r)) / ((1 - damp) * lenMin)));
  const fdnGain = Math.min(1, Math.sqrt((lenSum / 8) * (1 - r * r)));
  // the diffused impulse d and its energy weighted by r^-2j
  let span = 0;
  for (const m of diffusers) span += m;
  const H = 60 * span;
  const pos = new Int32Array(diffusers.length);
  const apLines = Array.from(diffusers, (m) => new Float64Array(m));
  let weighted = 0, w = 1;
  const inv2 = 1 / (rate * rate);
  for (let n = 0; n < H; n++) {
    let x = n === 0 ? 1 : 0;
    for (let k = 0; k < apLines.length; k++) {
      const line = apLines[k]!, p = pos[k]!;
      const out = line[p]!;
      const v = x + DIFFUSER_GAIN * out;
      x = out - DIFFUSER_GAIN * v;
      line[p] = v;
      pos[k] = p + 1 === line.length ? 0 : p + 1;
    }
    weighted += w * x * x;
    w *= inv2;
  }
  const bound = fdnGain * Math.sqrt(weighted);
  let erMax = 0;
  for (const t of erTaps) erMax = Math.max(erMax, t);
  const lr = Math.log(rate);
  const tail = predelay + Math.max(erMax + 1, lenMax + Math.ceil(Math.log(WARM_EPS / bound) / lr));
  const warm = predelay + Math.max(erMax + 1, lenMax + Math.ceil(Math.log((WARM_EPS * (1 - rate)) / bound) / lr));
  const d: ReverbDesign = { lines, gains, damp, diffusers, predelay, erTaps, erL: R.erL, erR: R.erR, fdnGain, rate, bound, tail, warm };
  if (reverbCache.size > 256) reverbCache.clear();
  reverbCache.set(key, d);
  return d;
}

/** Zeroth-order modified Bessel function of the first kind (power series). */
export function besselI0(x: number): number {
  let sum = 1, term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 64; k++) { term *= q / (k * k); sum += term; if (term < sum * 1e-17) break; }
  return sum;
}
/**
 * Kaiser-windowed sinc interpolation table for a time map (ADR-0010 plan section 2): `phases + 1` rows of `taps` coefficients.
 * Row p is for the fractional position f = p/phases; tap j weighs the source sample at floor(u) + j − (taps/2 − 1), whose
 * distance from u is x = j − (taps/2 − 1) − f. h(x) = 2·cutoff·sinc(2·cutoff·x)·kaiser(x / (taps/2), beta), cutoff in cycles
 * per source sample (0.5 = Nyquist). Rows sum to about 1 (each row is normalised to exactly 1 so DC passes unchanged).
 */
export function kaiserSincTable(taps: number, phases: number, cutoff: number, beta = 9): Float64Array {
  const t = new Float64Array((phases + 1) * taps), half = taps / 2, i0b = besselI0(beta);
  for (let p = 0; p <= phases; p++) {
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const x = j - (half - 1) - p / phases, ax = Math.abs(x) / half;
      const win = ax >= 1 ? 0 : besselI0(beta * Math.sqrt(1 - ax * ax)) / i0b;
      const arg = 2 * cutoff * x;
      const sinc = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
      const v = 2 * cutoff * sinc * win;
      t[p * taps + j] = v;
      sum += v;
    }
    if (sum !== 0) for (let j = 0; j < taps; j++) t[p * taps + j] = t[p * taps + j]! / sum;
  }
  return t;
}
