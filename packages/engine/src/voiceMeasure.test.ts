/**
 * Voice measurement (voiceMeasure.ts, ADR-0013) on synthetic recordings with a known answer: white and band-shaped noise, a
 * speech-like signal with pauses, mains hum, a continuous tone. All signals are generated here from seeded hashes.
 */
import { describe, expect, it } from 'vitest';
import { decodeNoiseProfile, NOISE_BAND_EDGES_HZ, NOISE_BANDS } from '@pulseframe/core';
import { recommendedStrength, voiceMeter, type VoiceMeasurement, type VoiceMeasureOptions } from './voiceMeasure.ts';
import { Fft } from './audiofx/fft.ts';
import { hash32, uniform } from './audiofx/noise.ts';

const SR = 48000;
/** Standard normal from two hashed uniforms (Box–Muller). */
const gauss = (seed: number, i: number, lane: number) => { const u = Math.max(1e-12, uniform(hash32(seed, i, lane * 2))), v = uniform(hash32(seed, i, lane * 2 + 1)); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/**
 * Stationary Gaussian noise (independent L and R) whose band level at frequency f is levelDb(f) (core voiceClean.ts definition:
 * 10·log10(24000 × PSD)): frequency-domain synthesis in blocks of 65536 (re = L, im = R), overlap-added with sqrt-Hann windows
 * at half overlap so the power stays stationary.
 */
export function shapedNoise(seconds: number, levelDb: (f: number) => number, seed: number): Float32Array {
  const M = 65536, hop = M / 2, frames = Math.round(seconds * SR), out = new Float64Array((frames + M) * 2);
  const fft = new Fft(M), amp = new Float64Array(M), win = new Float64Array(M);
  for (let k = 0; k < M; k++) { const f = (Math.min(k, M - k) * SR) / M; amp[k] = f === 0 ? 0 : Math.sqrt(M * 10 ** (levelDb(f) / 10)); }
  for (let i = 0; i < M; i++) win[i] = Math.sin((Math.PI * i) / M);
  const re = new Float64Array(M), im = new Float64Array(M);
  for (let b = 0, start = -hop; start < frames; b++, start += hop) {
    // X_k = A_k·(g1 + i·g2): the real and imaginary parts of the inverse transform are independent, each with variance Σ A_k²/M²
    for (let k = 0; k < M; k++) { re[k] = amp[k]! * gauss(seed + b, k, 0); im[k] = amp[k]! * gauss(seed + b, k, 1); }
    fft.inverse(re, im);
    for (let i = 0; i < M; i++) { const n = start + i; if (n < 0 || n >= frames) continue; out[n * 2] = out[n * 2]! + re[i]! * win[i]!; out[n * 2 + 1] = out[n * 2 + 1]! + im[i]! * win[i]!; }
  }
  return Float32Array.from(out.subarray(0, frames * 2));
}
/** Band level of a spectrum given as a function: 10·log10 of the mean of 10^(L/10) over the band (fine log-spaced sampling). */
const bandTruth = (levelDb: (f: number) => number) => Array.from({ length: NOISE_BANDS }, (_, j) => {
  const lo = NOISE_BAND_EDGES_HZ[j]!, hi = NOISE_BAND_EDGES_HZ[j + 1]!;
  let s = 0;
  for (let i = 0; i < 400; i++) s += 10 ** (levelDb(lo + ((i + 0.5) * (hi - lo)) / 400) / 10);
  return 10 * Math.log10(s / 400);
});

export interface SpeechLike { pcm: Float32Array; pauses: { start: number; end: number }[]; speechSeconds: number }
/**
 * A speech-like recording: phrases of syllables (glottal pulses at 110–190 Hz through two formant resonators that move per
 * syllable, raised-cosine envelopes) separated by pauses of 0.45–0.9 s, about 30 % of the time, scaled to `speechDb` dBFS RMS over
 * the phrases. Returns the true pauses (seconds).
 */
export function speechLike(seconds: number, speechDb: number, seed: number): SpeechLike {
  const frames = Math.round(seconds * SR), x = new Float64Array(frames * 2), pauses: { start: number; end: number }[] = [];
  const rnd = (i: number) => uniform(hash32(seed, i, 7));
  let t = Math.round(0.6 * SR), r = 0;
  pauses.push({ start: 0, end: t / SR });
  let speechFrames = 0;
  while (t < frames) {
    const phraseEnd = Math.min(frames, t + Math.round((1.0 + 1.2 * rnd(r++)) * SR));
    while (t < phraseEnd) {
      const len = Math.round((0.14 + 0.2 * rnd(r++)) * SR), f0 = 110 + 80 * rnd(r++), f1 = 450 + 500 * rnd(r++), f2 = 1100 + 1300 * rnd(r++);
      // two resonators y[n] = x[n] + 2r·cos(w)·y[n−1] − r²·y[n−2]
      const res = [f1, f2].map((f) => { const rr = Math.exp((-Math.PI * 90) / SR), w = (2 * Math.PI * f) / SR; return { a1: 2 * rr * Math.cos(w), a2: -rr * rr, y1: 0, y2: 0 }; });
      const period = SR / f0;
      for (let i = 0; i < len && t + i < frames; i++) {
        const pulse = Math.floor(i / period) !== Math.floor((i - 1) / period) || i === 0 ? 1 : 0;
        let v = 0;
        for (const q of res) { const y = pulse + q.a1 * q.y1 + q.a2 * q.y2; q.y2 = q.y1; q.y1 = y; v += y; }
        const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len);
        x[(t + i) * 2] = v * env; x[(t + i) * 2 + 1] = v * env * 0.9;
      }
      t += len + Math.round((0.02 + 0.04 * rnd(r++)) * SR);
      speechFrames += len;
    }
    t = Math.min(frames, t);
    const p = Math.round((0.45 + 0.45 * rnd(r++)) * SR);
    if (t < frames) pauses.push({ start: t / SR, end: Math.min(frames, t + p) / SR });
    t += p;
  }
  // scale to speechDb over the phrases (the whole signal minus the pauses)
  let e = 0, cnt = 0;
  const inPause = (n: number) => pauses.some((p) => n >= p.start * SR && n < p.end * SR);
  for (let n = 0; n < frames; n++) if (!inPause(n)) { e += (x[n * 2]! ** 2 + x[n * 2 + 1]! ** 2) / 2; cnt++; }
  const g = 10 ** (speechDb / 20) / Math.sqrt(e / cnt);
  return { pcm: Float32Array.from(x, (v) => v * g), pauses, speechSeconds: speechFrames / SR };
}
const add = (...xs: Float32Array[]) => { const y = new Float32Array(xs[0]!.length); for (const x of xs) for (let i = 0; i < y.length; i++) y[i] = y[i]! + x[i]!; return y; };
/** Hum lines k·hz (k = 1..k) with the given total level, dBFS RMS. */
function hum(seconds: number, hz: number, lines: number, totalDb: number): Float32Array {
  const frames = Math.round(seconds * SR), x = new Float32Array(frames * 2), a = Math.sqrt(2 * 10 ** (totalDb / 10) / lines);
  for (let n = 0; n < frames; n++) { let v = 0; for (let k = 1; k <= lines; k++) v += a * Math.sin((2 * Math.PI * k * hz * n) / SR + k); x[n * 2] = v; x[n * 2 + 1] = v; }
  return x;
}
function measure(pcm: Float32Array, opts?: VoiceMeasureOptions, chunk = 4800): VoiceMeasurement {
  const m = voiceMeter(opts);
  for (let o = 0; o < pcm.length; o += chunk * 2) m.push(pcm.subarray(o, Math.min(pcm.length, o + chunk * 2)));
  return m.finish();
}
const worstBand = (got: number[], want: number[]) => Math.max(...got.map((g, j) => Math.abs(g - want[j]!)));
/** Fraction of the true pauses covered by the ranges found. */
const coverage = (found: { start: number; end: number }[], truth: { start: number; end: number }[]) => {
  let total = 0, covered = 0;
  for (const p of truth) { total += p.end - p.start; for (const f of found) covered += Math.max(0, Math.min(p.end, f.end) - Math.max(p.start, f.start)); }
  return covered / total;
};

describe('voiceMeter', () => {
  it('white noise at −50 dBFS: every band within ±1 dB, and the profile encodes the bands', () => {
    const m = measure(shapedNoise(20, () => -50, 11));
    console.log(`white −50: bands ${m.noise.bandsDb.join(' ')}; warning ${m.noise.warning}; confidence ${m.noise.confidence}`);
    expect(worstBand(m.noise.bandsDb, Array(24).fill(-50))).toBeLessThanOrEqual(1);
    expect(decodeNoiseProfile(m.noise.profile).every((v, j) => Math.abs(v - m.noise.bandsDb[j]!) <= 0.025)).toBe(true);
    expect(m.analysedSeconds).toBe(20);
    expect(m.hum).toBeNull();
  });
  it('noise with a known band-shaped spectrum: every band within ±1.5 dB', () => {
    const level = (f: number) => -52 + 8 * Math.sin(Math.log2(f / 50) * 1.3) - 3 * Math.log2(f / 1000);
    const truth = bandTruth(level), m = measure(shapedNoise(20, level, 21));
    console.log(`shaped: worst band error ${worstBand(m.noise.bandsDb, truth).toFixed(2)} dB; truth ${truth.map((v) => v.toFixed(1)).join(' ')}`);
    expect(worstBand(m.noise.bandsDb, truth)).toBeLessThanOrEqual(1.5);
  });
  describe('a speech-like recording with 30 % pauses at 20 dB SNR', () => {
    // a noise sloping down 2 dB per octave, its broadband level (0–24 kHz) exactly −40 dBFS RMS: 20 dB below the −20 dBFS speech
    const level = (() => { const shape = (f: number) => -2 * Math.log2(f / 1000); let v = 0; for (let f = 0.5; f < 24000; f++) v += 10 ** (shape(f) / 10) / 24000; const off = -40 - 10 * Math.log10(v); return (f: number) => off + shape(f); })();
    const truth = bandTruth(level);
    const sp = speechLike(30, -20, 5), noise = shapedNoise(30, level, 31);
    it('bands within ±2 dB, the quiet ranges found cover at least 80 % of the true pauses, no hum on a clean file', () => {
      const m = measure(add(sp.pcm, noise));
      const pauseShare = sp.pauses.reduce((s, p) => s + p.end - p.start, 0) / 30;
      const cov = coverage(m.noise.ranges, sp.pauses);
      console.log(`speech-like: pauses ${(100 * pauseShare).toFixed(0)} % of the time; covered ${(100 * cov).toFixed(1)} %; worst band ${worstBand(m.noise.bandsDb, truth).toFixed(2)} dB; speech ${m.speech.levelDb} dB, SNR ${m.speech.snrDb} dB, confidence ${m.noise.confidence}`);
      expect(pauseShare).toBeGreaterThan(0.25);
      expect(pauseShare).toBeLessThan(0.4);
      expect(worstBand(m.noise.bandsDb, truth)).toBeLessThanOrEqual(2);
      expect(cov).toBeGreaterThanOrEqual(0.8);
      expect(m.noise.warning).toBeNull();
      expect(m.noise.mode).toBe('auto');
      expect(m.noise.confidence).toBeGreaterThan(0.5);
      expect(m.hum).toBeNull();
      expect(Math.abs(m.speech.levelDb! - -20)).toBeLessThan(1.5);
      expect(Math.abs(m.speech.snrDb! - 20)).toBeLessThan(1.5);
      expect(recommendedStrength(m)).toBeGreaterThan(0.35);
    });
    it('with 50 Hz hum (k = 1..4) at −40 dBFS: hum found at 50 Hz with its level, and the bands still within ±2 dB', () => {
      const m = measure(add(sp.pcm, noise, hum(30, 50, 4, -40)));
      console.log(`speech-like + hum: ${JSON.stringify(m.hum)}; worst band ${worstBand(m.noise.bandsDb, truth).toFixed(2)} dB`);
      expect(m.hum?.hz).toBe(50);
      expect(m.hum!.harmonics).toBeGreaterThanOrEqual(4);
      expect(Math.abs(m.hum!.levelDb - -40)).toBeLessThan(1.5);
      expect(worstBand(m.noise.bandsDb, truth)).toBeLessThanOrEqual(2);
      const m60 = measure(add(sp.pcm, noise, hum(30, 60, 3, -45)));
      expect(m60.hum?.hz).toBe(60);
    });
    it('ranges mode measures the given stretches; ranges shorter than 0.3 s in total give ranges_too_short and the automatic search', () => {
      const pcm = add(sp.pcm, noise);
      const long = sp.pauses.filter((p) => p.end - p.start > 0.5).slice(0, 3);
      const m = measure(pcm, { noiseRanges: long });
      expect(m.noise.mode).toBe('ranges');
      expect(m.noise.warning).toBeNull();
      expect(worstBand(m.noise.bandsDb, truth)).toBeLessThanOrEqual(2);
      const p = sp.pauses[1]!, short = measure(pcm, { noiseRanges: [{ start: p.start + 0.05, end: p.start + 0.25 }] });
      expect(short.noise.warning).toBe('ranges_too_short');
      expect(short.noise.mode).toBe('auto');
      expect(worstBand(short.noise.bandsDb, truth)).toBeLessThanOrEqual(2);
    });
  });
  it("a continuous tone gives 'no_pause_found' with confidence below 0.03", () => {
    const x = new Float32Array(10 * SR * 2);
    for (let n = 0; n < 10 * SR; n++) { const v = 0.1 * Math.sin((2 * Math.PI * 440 * n) / SR); x[n * 2] = v; x[n * 2 + 1] = v; }
    const m = measure(x);
    expect(m.noise.warning).toBe('no_pause_found');
    expect(m.noise.confidence).toBeLessThan(0.03);
    expect(m.speech.snrDb).toBeNull();
    expect(recommendedStrength(m)).toBe(0.6);
  });
  it('push sizes do not change the result; silence and an empty meter are reported honestly', () => {
    const pcm = add(speechLike(8, -20, 9).pcm, shapedNoise(8, () => -45, 3));
    expect(measure(pcm, undefined, 1)).toEqual(measure(pcm, undefined, 48000));
    const silent = measure(new Float32Array(3 * SR * 2));
    expect(silent.noise.bandsDb.every((v) => v === -140)).toBe(true);
    expect(silent.speech.peakDb).toBe(-200);
    const empty = voiceMeter().finish();
    expect(empty.noise.warning).toBe('no_pause_found');
    expect(empty.analysedSeconds).toBe(0);
  });
  it('recommendedStrength: 0.35 at 30 dB SNR or more, 0.85 at 10 dB or less, linear between, 0.6 unknown', () => {
    const at = (snrDb: number | null) => recommendedStrength({ speech: { snrDb, levelDb: -20, peakDb: -3 } } as VoiceMeasurement);
    expect([at(40), at(30), at(20), at(10), at(0), at(null)]).toEqual([0.35, 0.35, 0.6, 0.85, 0.85, 0.6]);
  });
  it('600 s of input: memory growth at most 64 MB; wall time reported (at most 10 s here)', () => {
    const chunk = new Float32Array(SR * 2), before = process.memoryUsage(), t0 = performance.now();
    const m = voiceMeter();
    let metering = 0;
    for (let s = 0; s < 600; s++) {
      for (let i = 0; i < SR; i++) { const v = (uniform(hash32(s, i, 0)) - 0.5) * 0.01 + (s % 4 === 0 ? 0 : 0.2 * Math.sin(i * 0.131)); chunk[i * 2] = v; chunk[i * 2 + 1] = v; }
      const a = performance.now();
      m.push(chunk);
      metering += performance.now() - a;
    }
    const a = performance.now(), r = m.finish();
    metering += performance.now() - a;
    const wall = metering / 1000, after = process.memoryUsage();
    // typed-array storage is counted in arrayBuffers (the meter's rows); the heap may shrink meanwhile, so both are bounded
    const buffers = (after.arrayBuffers - before.arrayBuffers) / 2 ** 20, growth = (after.heapUsed + after.arrayBuffers - before.heapUsed - before.arrayBuffers) / 2 ** 20;
    console.log(`600 s measured in ${wall.toFixed(2)} s of metering (${((performance.now() - t0) / 1000).toFixed(2)} s with the signal generation); typed arrays +${buffers.toFixed(1)} MB, heap and typed arrays +${growth.toFixed(1)} MB; quiet ${r.noise.quietSeconds} s`);
    expect(buffers).toBeLessThanOrEqual(64);
    expect(r.analysedSeconds).toBe(600);
    expect(growth).toBeLessThanOrEqual(64);
    expect(wall).toBeLessThanOrEqual(10);
  }, 120000);
});
