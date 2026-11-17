/**
 * cleanup.denoise (ADR-0013): exactness of the finite memory and the look-ahead, the measurements of the noise reduction, musical
 * noise against a plain power-subtraction baseline, split and move through the voice runtime (openClipVoice), and its speed.
 * The contract suite (kernels.test.ts) covers block sizes, the impulse, identity, silence and the bound at the corners.
 */
import { describe, expect, it } from 'vitest';
import { audioEffectParams, decodeNoiseProfile, encodeNoiseProfile, type AudioFxParams } from '@pulseframe/core';
import { renderFx } from './index.ts';
import { denoise } from './denoise.ts';
import { DENOISE_BETA, denoiseFraming, noiseBinPower } from '../design.ts';
import { fftOf, sqrtHann } from '../fft.ts';
import { hash32, uniform } from '../noise.ts';
import { chainReach, kernelFor } from '../registry.ts';
import { openClipVoice } from '../voice.ts';
import type { PlannedAudioClip, PlannedFx } from '../../audio.ts';
import { voiceMeter } from '../../voiceMeasure.ts';

const SR = 48000;
const P = (over: AudioFxParams = {}) => audioEffectParams('cleanup.denoise', over);
const dbRms = (x: Float32Array, from: number, to: number) => { let e = 0; for (let i = from * 2; i < to * 2; i++) e += x[i]! * x[i]!; return 10 * Math.log10(e / ((to - from) * 2)); };
const gauss = (seed: number, i: number) => { const u = Math.max(1e-12, uniform(hash32(seed, i, 0))), v = uniform(hash32(seed, i, 1)); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
/** Independent Gaussian white noise on L and R at `db` dBFS RMS per channel. */
function white(frames: number, db: number, seed: number): Float32Array {
  const a = 10 ** (db / 20), x = new Float32Array(frames * 2);
  for (let i = 0; i < frames * 2; i++) x[i] = a * gauss(seed, i);
  return x;
}
const sine = (frames: number, f: number, amp: number, sr = SR) => { const x = new Float32Array(frames * 2); for (let i = 0; i < frames; i++) { const v = amp * Math.sin((2 * Math.PI * f * i) / sr); x[i * 2] = v; x[i * 2 + 1] = v; } return x; };
const add = (a: Float32Array, b: Float32Array) => a.map((v, i) => v + b[i]!);
function goertzel(x: Float32Array, f: number, from: number, len: number, sr = SR): number {
  const w = (2 * Math.PI * f) / sr, coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) { const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)); const s0 = x[(from + i) * 2]! * h + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))) / (len * 0.5);
}
const sameBytes = (a: Float32Array, b: Float32Array) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
/** The noise profile voiceMeter measures on a recording (48 kHz). */
function measuredProfile(x: Float32Array): string {
  const m = voiceMeter();
  m.push(x);
  return m.finish().noise.profile;
}

/**
 * Isolated time-frequency peaks in the left channel over [from, to): cells of a Hann STFT (N = 1024, hop N/4) that are at least
 * 10 dB above all 8 neighbours, the neighbours being the nearest cells that do not share samples or a main lobe with it: one frame
 * length (4 hops) earlier and later, and two bins lower and higher. A gate's "musical noise" (a lone bin let through for one frame
 * among bins held at the floor) is such a cell; plain noise has few.
 */
function isolatedPeaks(x: Float32Array, from: number, to: number): number {
  const N = 1024, H = 256, fft = fftOf(N), re = new Float64Array(N), im = new Float64Array(N), rows: Float64Array[] = [];
  for (let s = from; s + N <= to; s += H) {
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); re[i] = x[(s + i) * 2]! * w; im[i] = 0; }
    fft.forward(re, im);
    rows.push(Float64Array.from({ length: N / 2 }, (_, k) => re[k]! * re[k]! + im[k]! * im[k]!));
  }
  let count = 0;
  for (let t = 4; t + 4 < rows.length; t++) for (let k = 4; k < N / 2 - 2; k++) {
    const v = rows[t]![k]!;
    let max = 0;
    for (const dt of [-4, 0, 4]) for (const dk of [-2, 0, 2]) if (dt || dk) max = Math.max(max, rows[t + dt]![k + dk]!);
    if (v >= 10 * max) count++;
  }
  return count;
}
/** Plain power subtraction (Boll): the same STFT, G = max(floor, sqrt(max(0, 1 − λ/P))) per bin and frame, no smoothing, no hold. */
function plainSubtraction(x: Float32Array, profile: string, reductionDb: number): Float32Array {
  const { n: N, hop: H } = denoiseFraming(SR), half = N / 2, fft = fftOf(N), w = sqrtHann(N);
  const lam = noiseBinPower(decodeNoiseProfile(profile), N, SR), floor = 10 ** (-reductionDb / 20), frames = x.length / 2;
  const y = new Float64Array(frames * 2), re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N <= frames; s += H) {
    for (let i = 0; i < N; i++) { re[i] = x[(s + i) * 2]! * w[i]!; im[i] = x[(s + i) * 2 + 1]! * w[i]!; }
    fft.forward(re, im);
    for (let k = 0; k <= half; k++) {
      const m = (N - k) % N, p = (re[k]! ** 2 + im[k]! ** 2 + re[m]! ** 2 + im[m]! ** 2) / 4;
      const g = Math.max(floor, Math.sqrt(Math.max(0, 1 - lam[k]! / p)));
      re[k] = re[k]! * g; im[k] = im[k]! * g;
      if (k > 0 && k < half) { re[m] = re[m]! * g; im[m] = im[m]! * g; }
    }
    fft.inverse(re, im);
    for (let i = 0; i < N; i++) { y[(s + i) * 2] = y[(s + i) * 2]! + re[i]! * w[i]! * ((2 * H) / N); y[(s + i) * 2 + 1] = y[(s + i) * 2 + 1]! + im[i]! * w[i]! * ((2 * H) / N); }
  }
  return Float32Array.from(y);
}

describe('cleanup.denoise: finite memory and look-ahead', () => {
  it('histories that agree on the last `warm` samples give EXACTLY equal output, at any timeline position', () => {
    const p = P({ profile: encodeNoiseProfile(Array(24).fill(-45)) }), { warm, ahead } = denoise.reach(p, SR);
    expect(warm).toBe(1024 - 1 + 4 * 256);
    const Hh = 3001, M = 6000, total = Hh + warm + M;
    for (const at of [0, 4801, 1_234_567]) {
      const common = add(white(total, -30, 5), sine(total, 700, 0.05));
      const a = common.slice(), b = common.slice();
      a.set(white(Hh, -20, 6)); b.set(white(Hh, -20, 7));
      const ya = renderFx('cleanup.denoise', p, a, { at }), yb = renderFx('cleanup.denoise', p, b, { at });
      expect(sameBytes(ya.subarray((Hh + warm) * 2), yb.subarray((Hh + warm) * 2)), `at ${at}`).toBe(true);
      // and the history mattered just before that point
      let before = 0;
      for (let i = Hh * 2; i < (Hh + warm) * 2; i++) before = Math.max(before, Math.abs(ya[i]! - yb[i]!));
      expect(before, `at ${at}`).toBeGreaterThan(0);
      expect(ahead).toBe(1024 + 256 - 1);
    }
  });
  it('the raw (in-place) output is the input delayed by exactly reach().ahead', () => {
    // a loud signal over the generic quiet profile: every gain is within 1e-5 of 1, so the gate passes the sound through
    const p = P(), { ahead } = denoise.reach(p, SR), frames = SR;
    const x = white(frames, -12, 9), raw = renderFx('cleanup.denoise', p, x, { align: false });
    const err = (d: number) => { let e = 0; for (let n = 4096; n < frames; n++) e = Math.max(e, Math.abs(raw[n * 2]! - x[(n - d) * 2]!), Math.abs(raw[n * 2 + 1]! - x[(n - d) * 2 + 1]!)); return e; };
    expect(err(ahead)).toBeLessThan(1e-4);
    expect(err(ahead - 1)).toBeGreaterThan(0.05);
    expect(err(ahead + 1)).toBeGreaterThan(0.05);
  });
  it('look-ahead at most 50 ms at 44.1, 48 and 96 kHz and speeds 0.25–4; none at amount 0', () => {
    for (const sr of [44100, 48000, 96000]) for (const speed of [0.25, 0.5, 1, 2, 4]) {
      const r = denoise.reach(P(), sr, speed);
      expect(r.ahead! / sr, `${sr} ${speed}`).toBeLessThanOrEqual(0.05);
      expect(r.tail).toBe(0);
    }
    expect(denoise.reach(P({ amount: 0 }), SR)).toEqual({ warm: 0, tail: 0, ahead: 0 });
  });
});

describe('cleanup.denoise: measurements at 48 kHz', () => {
  const frames = 8 * SR, noise = white(frames, -50, 21), profile = measuredProfile(noise);
  const { warm, ahead } = denoiseFraming(SR), from = warm + ahead, to = frames - ahead;
  const p = P({ reductionDb: 12, profile });
  it('white noise at −50 dBFS with its own measured profile, reductionDb 12: output at most −61 dBFS RMS', () => {
    const y = renderFx('cleanup.denoise', p, noise);
    const out = dbRms(y, from, to);
    console.log(`denoise: white −50 dBFS → ${out.toFixed(2)} dBFS (reductionDb 12)`);
    expect(out).toBeLessThanOrEqual(-61);
  });
  it('a 1 kHz sine at −20 dBFS in that noise keeps its level within 0.5 dB', () => {
    const x = add(noise, sine(frames, 1000, 0.1 * Math.SQRT2)), y = renderFx('cleanup.denoise', p, x);
    const change = 20 * Math.log10(goertzel(y, 1000, from, 2 * SR) / goertzel(x, 1000, from, 2 * SR));
    console.log(`denoise: 1 kHz sine level change ${change.toFixed(3)} dB`);
    expect(Math.abs(change)).toBeLessThanOrEqual(0.5);
  });
  it('the reduction is the same within 0.5 dB at 44.1 and 96 kHz, and within 1 dB at speed 2', () => {
    const reduction = (sr: number, speed: number) => {
      // white noise whose heard density matches the profile's: P(f/speed)/speed at rate sr
      const n = 6 * sr, inDb = -50 + 10 * Math.log10(sr / 48000) - 10 * Math.log10(speed), x = white(n, inDb, 31 + sr);
      const f = denoiseFraming(sr), y = renderFx('cleanup.denoise', p, x, { sampleRate: sr, speed });
      return dbRms(y, f.warm + f.ahead, n - f.ahead) - dbRms(x, f.warm + f.ahead, n - f.ahead);
    };
    const r48 = reduction(48000, 1), r44 = reduction(44100, 1), r96 = reduction(96000, 1), r2 = reduction(48000, 2);
    console.log(`denoise reduction: 48 kHz ${r48.toFixed(2)}, 44.1 kHz ${r44.toFixed(2)}, 96 kHz ${r96.toFixed(2)}, speed 2 ${r2.toFixed(2)} dB`);
    expect(Math.abs(r44 - r48)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r96 - r48)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r2 - r48)).toBeLessThanOrEqual(1);
  });
  it('isolated time-frequency peaks in noise-only output: reported, and at most half of a plain power-subtraction baseline', () => {
    const y = renderFx('cleanup.denoise', p, noise), base = plainSubtraction(noise, profile, 12);
    // the baseline is not delayed (offline); compare the same stretch of noise
    const ours = isolatedPeaks(y, from, to), plain = isolatedPeaks(base, from - ahead, to - ahead), input = isolatedPeaks(noise, from - ahead, to - ahead);
    console.log(`denoise musical noise: isolated peaks ${ours} (cleanup.denoise), ${plain} (plain power subtraction), ${input} (the input noise itself), over ${((to - from) / SR).toFixed(1)} s`);
    expect(ours).toBeLessThanOrEqual(0.5 * plain);
    expect(plain).toBeGreaterThan(0);
  });
});

// ---- through the voice runtime ------------------------------------------------------------------------------------------------
const FILE = 48000 * 40;
/** A recording: seeded noise, a tone that comes and goes, 50 Hz hum (sample j of the file at its own rate). */
const native = (j: number, ch: number, rate = SR) => (j < 0 || j >= FILE ? 0 : 0.02 * (uniform(hash32(77, j, ch)) - 0.5) + (Math.floor(j / (0.4 * rate)) % 2 ? 0.2 * Math.sin((2 * Math.PI * 440 * j) / rate + ch) : 0) + 0.01 * Math.sin((2 * Math.PI * 50 * j) / rate));
const fx = (type: string, params: AudioFxParams = {}): PlannedFx => ({ id: `fx_${type}`, type, version: 1, stage: 2, params: audioEffectParams(type, params), seed: 0 });
const CHAIN = [fx('cleanup.dehum'), fx('cleanup.denoise', { profile: encodeNoiseProfile(Array(24).fill(-55)) })];
const rt = (value: number, timescale: number) => ({ value: String(value), timescale });
/** A clip with fades on the outer edges only, no volume keys, no ducking, gain 1, centred: so its output is the window output exactly. */
function clipOf(at: number, length: number, sourceIn: [number, number], chain: PlannedFx[], sourceRate = SR, edges: { fadeIn: boolean; fadeOut: boolean } = { fadeIn: true, fadeOut: true }): PlannedAudioClip {
  const reach = chainReach(chain, SR, 1);
  return {
    clipId: 'c', trackId: 't', assetId: 'a', at, length, source: 0, speed: 1, gain: 1, pan: 0,
    fade: [{ s: 0, g: edges.fadeIn ? 0 : 1 }, ...(edges.fadeIn ? [{ s: 300, g: 1 }] : []), ...(edges.fadeOut ? [{ s: length - 400, g: 1 }] : []), { s: length, g: edges.fadeOut ? 0 : 1 }],
    duck: [{ s: 0, g: 1 }, { s: length, g: 1 }],
    voice: { chain, sourceIn: rt(sourceIn[0], sourceIn[1]), sourceEnd: rt(sourceIn[0] * SR + length * sourceIn[1], sourceIn[1] * SR), speed: { num: 1, den: 1 }, reverse: false, sourceRate, warmWindow: reach.warmWindow, warmRing: reach.warmRing, aheadWindow: reach.aheadWindow, tail: 0 },
  };
}
function render(clip: PlannedAudioClip, chunk = 7919): Float32Array {
  const v = openClipVoice(clip, SR, clip.voice!.sourceRate, 0, Infinity), rate = clip.voice!.sourceRate;
  const { origin, first, last } = v.input, parts: Float32Array[] = [];
  const P = new Float32Array(chunk * 2);
  for (let k = first; k < last; k += chunk) {
    const n = Math.min(chunk, last - k);
    for (let i = 0; i < n; i++) { P[i * 2] = native(origin + k + i, 0, rate); P[i * 2 + 1] = native(origin + k + i, 1, rate); }
    parts.push(v.push(P.subarray(0, n * 2)));
  }
  parts.push(v.finish());
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('cleanup.denoise and cleanup.dehum through the voice runtime (openClipVoice)', () => {
  const L = 30000, c = 13001, at = 4800;
  const split = (chain: PlannedFx[], sourceRate: number) => {
    const whole = render(clipOf(at, L, [12, 10], chain, sourceRate));
    const a = render(clipOf(at, c, [12, 10], chain, sourceRate, { fadeIn: true, fadeOut: false }));
    const b = render(clipOf(at + c, L - c, [12 * SR + 10 * c, 10 * SR], chain, sourceRate, { fadeIn: false, fadeOut: true }));
    const sum = new Float32Array(whole.length);
    sum.set(a); sum.set(b, c * 2);
    let worst = 0, peak = 0;
    for (let i = 0; i < whole.length; i++) { worst = Math.max(worst, Math.abs(sum[i]! - whole[i]!)); peak = Math.max(peak, Math.abs(whole[i]!)); }
    return { worst, peak, exact: sameBytes(sum, whole), lengths: [a.length / 2, b.length / 2] };
  };
  it('a cut at c = 13001 (a non-multiple of the hop) with at = 4800: denoise parts sum to the whole bit-exactly at sourceRate = planRate (and from 44.1 kHz)', () => {
    for (const sourceRate of [SR, 44100]) {
      const r = split([CHAIN[1]!], sourceRate);
      console.log(`split, denoise alone, source ${sourceRate}: exact ${r.exact}, worst ${r.worst}`);
      expect(r.lengths).toEqual([c, L - c]);
      expect(r.exact, `source ${sourceRate}`).toBe(true);
    }
  });
  it('with dehum and denoise: the parts sum to the whole within 2^-22·peak at sourceRate = planRate and within 2^-17·peak from a 44.1 kHz source (dehum is IIR: its history before the warm-up, at most 2^-24 of the peak, is cut by design; then one Float32 rounding)', () => {
    const same = split(CHAIN, SR), from44 = split(CHAIN, 44100);
    console.log(`split, dehum + denoise: same rate worst ${same.worst} (exact ${same.exact}); 44.1 kHz worst ${from44.worst} (exact ${from44.exact}); peak ${same.peak.toFixed(3)}`);
    expect(same.worst).toBeLessThanOrEqual(2 ** -22 * same.peak);
    expect(from44.worst).toBeLessThanOrEqual(2 ** -17 * from44.peak);
  });
  it('a clip moved by 7·H samples gives bit-identical output; a move by a fraction of the hop changes it slightly (frames sit on the timeline grid)', () => {
    const H = denoiseFraming(SR).hop, base = render(clipOf(at, L, [12, 10], CHAIN));
    expect(sameBytes(render(clipOf(at + 7 * H, L, [12, 10], CHAIN)), base)).toBe(true);
    const off = render(clipOf(at + 100, L, [12, 10], CHAIN));
    let worst = 0;
    for (let i = 0; i < base.length; i++) worst = Math.max(worst, Math.abs(off[i]! - base[i]!));
    console.log(`moved by 100 samples (not a multiple of H = ${H}): largest change ${worst.toExponential(2)}`);
    expect(worst).toBeGreaterThan(0);
  });
  it('the whole voice with denoise runs at least 40× real time in Node on 30 s of 48 kHz stereo (reported)', () => {
    const seconds = 30, clip = clipOf(0, seconds * SR, [1, 10], [CHAIN[1]!]), both = clipOf(0, seconds * SR, [1, 10], CHAIN);
    const timeOf = (cl: PlannedAudioClip) => {
      const v = openClipVoice(cl, SR, SR, 0, Infinity), n = v.input.last - v.input.first, P = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { P[i * 2] = native(v.input.origin + v.input.first + i, 0); P[i * 2 + 1] = native(v.input.origin + v.input.first + i, 1); }
      const t0 = performance.now();
      for (let o = 0; o < n; o += 4096) v.push(P.subarray(o * 2, Math.min(n, o + 4096) * 2));
      v.finish();
      return seconds / ((performance.now() - t0) / 1000);
    };
    let best = 0, bestBoth = 0;
    for (let k = 0; k < 3; k++) { best = Math.max(best, timeOf(clip)); bestBoth = Math.max(bestBoth, timeOf(both)); }
    console.log(`voice speed: denoise ${best.toFixed(1)}× real time; dehum + denoise ${bestBoth.toFixed(1)}× (best of 3, 30 s at 48 kHz stereo)`);
    expect(best).toBeGreaterThanOrEqual(40);
  }, 120000);
  it('the plan and the kernels agree on the look-ahead (the voice refuses a mismatch)', () => {
    const r = chainReach(CHAIN, SR);
    expect(r.aheadWindow).toBe(denoiseFraming(SR).ahead);
    expect(r.warmWindow).toBe(kernelFor('cleanup.dehum', 1)!.reach(CHAIN[0]!.params, SR).warm + denoiseFraming(SR).warm + denoiseFraming(SR).ahead);
    expect(DENOISE_BETA).toBe(2);
  });
});
