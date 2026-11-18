/**
 * Deterministic recordings for the voice-cleanup proof (ADR-0013, pnpm proof:voiceclean) and the measurements it takes on them.
 * Every signal is generated here from seeded hashes (no recorded material, no model) with a known answer:
 *  - speech-like phrases: glottal pulses (110–190 Hz) through two formant resonators that move per syllable, raised-cosine
 *    syllable envelopes, phrases separated by pauses of 0.45–0.9 s (about 30 % of the time), −20 dBFS RMS over the phrases;
 *  - background noise with a known 24-band spectrum (core voiceClean.ts bands), −48 dBFS RMS broadband (0–24 kHz);
 *  - mains hum, 50 Hz and its multiples k = 1..4, −40 dBFS RMS in total;
 *  - for the sync check, bursts with a hard onset: white noise (broadband: where the chain puts it is its latency) and 1 kHz
 *    tones (narrowband: where the chain puts the carrier is its phase at 1 kHz, see cleanupPhaseDelay).
 * Written as 48 kHz stereo float WAV. Nothing here has been listened to: the proof measures, it does not judge the sound.
 */
import fs from 'node:fs';
import { audioEffectParams, NOISE_BAND_EDGES_HZ, NOISE_BANDS, type AudioFxParams } from '@pulseframe/core';
import { dehumDesign, type Biquad } from '@pulseframe/engine/audiofx/design.ts';
import { Fft } from '@pulseframe/engine/audiofx/fft.ts';
import { speechDesign } from '@pulseframe/engine/audiofx/kernels/speech.ts';
import { hash32, uniform } from '@pulseframe/engine/audiofx/noise.ts';

export const VC_SR = 48000;
export interface Span { start: number; end: number }

/** Standard normal from two hashed uniforms (Box–Muller). */
const gauss = (seed: number, i: number, lane: number) => { const u = Math.max(1e-12, uniform(hash32(seed, i, lane * 2))), v = uniform(hash32(seed, i, lane * 2 + 1)); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/** The known noise shape (dB, relative): a ripple of ±4 dB over the octaves, falling 2.5 dB per octave. */
export const NOISE_SHAPE = (f: number): number => 4 * Math.sin(Math.log2(Math.max(f, 1) / 60) * 1.1) - 2.5 * Math.log2(Math.max(f, 1) / 1000);
/** A level function (core band-level units: 10·log10(24000 × PSD)) with the NOISE_SHAPE and the given broadband RMS over 0–24 kHz. */
export function noiseLevel(totalDb: number, shape = NOISE_SHAPE): (f: number) => number {
  let v = 0;
  for (let f = 0.5; f < 24000; f++) v += 10 ** (shape(f) / 10) / 24000;
  const off = totalDb - 10 * Math.log10(v);
  return (f: number) => off + shape(f);
}
/** Band levels of a level function: 10·log10 of the mean of 10^(L/10) over each band. */
export function bandTruth(level: (f: number) => number): number[] {
  return Array.from({ length: NOISE_BANDS }, (_, j) => {
    const lo = NOISE_BAND_EDGES_HZ[j]!, hi = NOISE_BAND_EDGES_HZ[j + 1]!;
    let s = 0;
    for (let i = 0; i < 400; i++) s += 10 ** (level(lo + ((i + 0.5) * (hi - lo)) / 400) / 10);
    return 10 * Math.log10(s / 400);
  });
}
/**
 * Stationary Gaussian noise, independent on L and R, with band level `level(f)`: frequency-domain synthesis in blocks of 65536
 * (real part = L, imaginary part = R), overlap-added with sqrt-Hann windows at half overlap (the power stays stationary).
 */
export function shapedNoise(seconds: number, level: (f: number) => number, seed: number): Float32Array {
  const M = 65536, hop = M / 2, frames = Math.round(seconds * VC_SR), out = new Float64Array(frames * 2);
  const fft = new Fft(M), amp = new Float64Array(M), win = new Float64Array(M), re = new Float64Array(M), im = new Float64Array(M);
  for (let k = 0; k < M; k++) { const f = (Math.min(k, M - k) * VC_SR) / M; amp[k] = f === 0 ? 0 : Math.sqrt(M * 10 ** (level(f) / 10)); }
  for (let i = 0; i < M; i++) win[i] = Math.sin((Math.PI * i) / M);
  for (let b = 0, start = -hop; start < frames; b++, start += hop) {
    for (let k = 0; k < M; k++) { re[k] = amp[k]! * gauss(seed + b, k, 0); im[k] = amp[k]! * gauss(seed + b, k, 1); }
    fft.inverse(re, im);
    for (let i = 0; i < M; i++) { const n = start + i; if (n < 0 || n >= frames) continue; out[n * 2] = out[n * 2]! + re[i]! * win[i]!; out[n * 2 + 1] = out[n * 2 + 1]! + im[i]! * win[i]!; }
  }
  return Float32Array.from(out);
}
/** Speech-like phrases with pauses (see the file comment); returns the true pauses in seconds. */
export function speechLike(seconds: number, speechDb: number, seed: number): { pcm: Float32Array; pauses: Span[] } {
  const frames = Math.round(seconds * VC_SR), x = new Float64Array(frames * 2), pauses: Span[] = [];
  const rnd = (i: number) => uniform(hash32(seed, i, 7));
  let t = Math.round(0.6 * VC_SR), r = 0;
  pauses.push({ start: 0, end: t / VC_SR });
  while (t < frames) {
    const phraseEnd = Math.min(frames, t + Math.round((1.0 + 1.2 * rnd(r++)) * VC_SR));
    while (t < phraseEnd) {
      const len = Math.round((0.14 + 0.2 * rnd(r++)) * VC_SR), f0 = 110 + 80 * rnd(r++), f1 = 450 + 500 * rnd(r++), f2 = 1100 + 1300 * rnd(r++);
      const res = [f1, f2].map((f) => { const rr = Math.exp((-Math.PI * 90) / VC_SR), w = (2 * Math.PI * f) / VC_SR; return { a1: 2 * rr * Math.cos(w), a2: -rr * rr, y1: 0, y2: 0 }; });
      const period = VC_SR / f0;
      for (let i = 0; i < len && t + i < frames; i++) {
        const pulse = i === 0 || Math.floor(i / period) !== Math.floor((i - 1) / period) ? 1 : 0;
        let v = 0;
        for (const q of res) { const y = pulse + q.a1 * q.y1 + q.a2 * q.y2; q.y2 = q.y1; q.y1 = y; v += y; }
        const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len);
        x[(t + i) * 2] = v * env; x[(t + i) * 2 + 1] = v * env * 0.9;
      }
      t += len + Math.round((0.02 + 0.04 * rnd(r++)) * VC_SR);
    }
    t = Math.min(frames, t);
    const p = Math.round((0.45 + 0.45 * rnd(r++)) * VC_SR);
    if (t < frames) pauses.push({ start: t / VC_SR, end: Math.min(frames, t + p) / VC_SR });
    t += p;
  }
  let e = 0, cnt = 0;
  for (let n = 0; n < frames; n++) if (!inSpans(n / VC_SR, pauses)) { e += (x[n * 2]! ** 2 + x[n * 2 + 1]! ** 2) / 2; cnt++; }
  const g = 10 ** (speechDb / 20) / Math.sqrt(e / cnt);
  return { pcm: Float32Array.from(x, (v) => v * g), pauses };
}
/** Hum lines k·hz, k = 1..lines, equal levels, `totalDb` dBFS RMS in total, the same on both channels. */
export function hum(seconds: number, hz: number, lines: number, totalDb: number): Float32Array {
  const frames = Math.round(seconds * VC_SR), x = new Float32Array(frames * 2), a = Math.sqrt((2 * 10 ** (totalDb / 10)) / lines);
  for (let n = 0; n < frames; n++) { let v = 0; for (let k = 1; k <= lines; k++) v += a * Math.sin((2 * Math.PI * k * hz * n) / VC_SR + k); x[n * 2] = v; x[n * 2 + 1] = v; }
  return x;
}
export const add = (...xs: Float32Array[]): Float32Array => { const y = new Float32Array(xs[0]!.length); for (const x of xs) for (let i = 0; i < y.length; i++) y[i] = y[i]! + x[i]!; return y; };
export const inSpans = (t: number, spans: readonly Span[]): boolean => spans.some((p) => t >= p.start && t < p.end);

export interface VoiceRecording {
  pcm: Float32Array; seconds: number; pauses: Span[];
  truth: { bandsDb: number[]; noiseDb: number; speechDb: number; hum: { hz: 50 | 60; lines: number; totalDb: number } | null };
}
/** The C1 recording: speech-like phrases + noise of known bands + hum. */
export function voiceRecording(o: { seconds: number; seed: number; speechDb?: number; noiseDb?: number; hum?: { hz: 50 | 60; lines: number; totalDb: number } | null }): VoiceRecording {
  const speechDb = o.speechDb ?? -20, noiseDb = o.noiseDb ?? -48, h = o.hum === undefined ? { hz: 50 as const, lines: 4, totalDb: -40 } : o.hum;
  const level = noiseLevel(noiseDb), sp = speechLike(o.seconds, speechDb, o.seed);
  const parts = [sp.pcm, shapedNoise(o.seconds, level, o.seed + 1000)];
  if (h) parts.push(hum(o.seconds, h.hz, h.lines, h.totalDb));
  return { pcm: add(...parts), seconds: o.seconds, pauses: sp.pauses, truth: { bandsDb: bandTruth(level), noiseDb, speechDb, hum: h } };
}
/**
 * The C4 recording, over the noise and the hum: every 0.8 s from 0.5 s a 1 kHz burst (60 ms, amplitude 0.3, hard onset, the
 * sine starting at phase 0) and, 0.4 s after each, a white-noise burst (60 ms, uniform in ±0.3, hard onset, seeded). Both the
 * same on L and R. `onsets` are the first samples of the tone bursts, `noiseOnsets` those of the noise bursts.
 */
export function burstRecording(seconds: number, seed: number): { pcm: Float32Array; onsets: number[]; noiseOnsets: number[] } {
  const frames = Math.round(seconds * VC_SR), b = new Float32Array(frames * 2), onsets: number[] = [], noiseOnsets: number[] = [];
  const len = Math.round(0.06 * VC_SR);
  for (let t0 = 0.5; t0 + 0.1 < seconds; t0 += 0.8) {
    const n0 = Math.round(t0 * VC_SR);
    onsets.push(n0);
    for (let i = 0; i < len; i++) { const v = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / VC_SR); b[(n0 + i) * 2] = v; b[(n0 + i) * 2 + 1] = v; }
    const n1 = Math.round((t0 + 0.4) * VC_SR);
    if (n1 + len + Math.round(0.04 * VC_SR) > frames) continue;
    noiseOnsets.push(n1);
    for (let i = 0; i < len; i++) { const v = 0.6 * (uniform(hash32(seed + 7, n1 + i, 5)) - 0.5); b[(n1 + i) * 2] = v; b[(n1 + i) * 2 + 1] = v; }
  }
  return { pcm: add(b, shapedNoise(seconds, noiseLevel(-48), seed), hum(seconds, 50, 4, -40)), onsets, noiseOnsets };
}

/** Frequency response at `hz` of a cascade of biquads [b0, b1, b2, a1, a2] (a0 = 1), as [re, im]. */
export function cascadeResponse(sections: readonly Biquad[], hz: number, sr = VC_SR): [number, number] {
  const w = (2 * Math.PI * hz) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  let re = 1, im = 0;
  for (const s of sections) {
    const nr = s[0]! + s[1]! * c1 + s[2]! * c2, ni = -(s[1]! * s1 + s[2]! * s2), dr = 1 + s[3]! * c1 + s[4]! * c2, di = -(s[3]! * s1 + s[4]! * s2), d = dr * dr + di * di;
    const qr = (nr * dr + ni * di) / d, qi = (ni * dr - nr * di) / d;
    [re, im] = [re * qr - im * qi, re * qi + im * qr];
  }
  return [re, im];
}
/**
 * The phase delay, in samples at `hz`, that the FILTERS of a cleanup chain have by design (negative = the tone is led):
 * −arg H(hz)/ω with H the product of
 *   cleanup.dehum   (1 − amount) + amount·notches                                  (dehumDesign)
 *   cleanup.speech  ((1 − amount) + amount·low cut)·presence                        (speechDesign; its leveller and limiter are gains)
 *   cleanup.denoise 1: one real gain per bin on both channels, no phase.
 * These are minimum-phase filters: they turn the phase of a steady tone and delay nothing (their impulse response starts at once).
 * A cross-correlation of a narrowband burst measures exactly this phase plus any real delay; a broadband burst measures the delay alone.
 */
export function cleanupPhaseDelay(effects: readonly { type: string; params: AudioFxParams }[], hz: number, sr = VC_SR): number {
  let re = 1, im = 0;
  const times = (r: number, i: number) => { [re, im] = [re * r - im * i, re * i + im * r]; };
  for (const e of effects) {
    const p = audioEffectParams(e.type, e.params);
    if (e.type === 'cleanup.dehum') {
      const d = dehumDesign(p, sr);
      if (d.identity) continue;
      const [r, i] = cascadeResponse(d.sections, hz, sr);
      times(1 - d.amount + d.amount * r, d.amount * i);
    } else if (e.type === 'cleanup.speech') {
      const d = speechDesign(p, sr);
      if (d.identity) continue;
      const [r, i] = cascadeResponse(d.lowCut, hz, sr);
      times(1 - d.wet + d.wet * r, d.wet * i);
      times(...cascadeResponse(d.presence, hz, sr));
    } else if (e.type !== 'cleanup.denoise') throw new Error(`cleanupPhaseDelay: ${e.type} is not a cleanup effect`);
  }
  return -Math.atan2(im, re) / ((2 * Math.PI * hz) / sr);
}

/** 32-bit float PCM WAV, interleaved stereo. */
export function writeWavF32(file: string, pcm: Float32Array, sampleRate = VC_SR): void {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

// ---- measurements -------------------------------------------------------------------------------------------------------
/** RBJ section run over one channel (Float64); kind 'hp' or 'lp' at f0 with Q. */
function biquad(x: Float64Array, kind: 'hp' | 'lp', f0: number, q: number, sr = VC_SR): Float64Array {
  const w = (2 * Math.PI * f0) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b = kind === 'hp' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b[0]! * x[i]! + b[1]! * x1 + b[2]! * x2 - (-2 * c) * y1 - (1 - al) * y2) / a0; x2 = x1; x1 = x[i]!; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
const BW4 = [0.5411961001461969, 1.3065629648763766]; // Q of the two sections of a 4th-order Butterworth
/** One channel, filtered by 4th-order Butterworth high-pass at `hp` and/or low-pass at `lp` (Hz). */
export function band(pcm: Float32Array, ch: 0 | 1, hp: number | null, lp: number | null, sr = VC_SR): Float64Array {
  let x: Float64Array = Float64Array.from({ length: pcm.length / 2 }, (_, i) => pcm[i * 2 + ch]!);
  if (hp) for (const q of BW4) x = biquad(x, 'hp', hp, q, sr);
  if (lp) for (const q of BW4) x = biquad(x, 'lp', lp, q, sr);
  return x;
}
/** dBFS RMS of a signal over the given spans (seconds), each shrunk by `margin` seconds at both ends. */
export function rmsDbOver(x: Float64Array, spans: readonly Span[], margin = 0.05, sr = VC_SR): number {
  let e = 0, n = 0;
  for (const s of spans) for (let i = Math.round((s.start + margin) * sr); i < Math.min(x.length, Math.round((s.end - margin) * sr)); i++) { e += x[i]! * x[i]!; n++; }
  return 10 * Math.log10(Math.max(1e-30, e / Math.max(1, n)));
}
/** Amplitude of the `hz` line in one channel over the given spans: Hann-windowed Goertzel per span, power-averaged (a sine of amplitude A gives A). */
export function lineOver(pcm: Float32Array, ch: 0 | 1, hz: number, spans: readonly Span[], margin = 0.05, sr = VC_SR): number {
  let p = 0, k = 0;
  for (const s of spans) {
    const from = Math.round((s.start + margin) * sr), len = Math.round((s.end - s.start - 2 * margin) * sr);
    if (len < 0.2 * sr) continue;
    const w = (2 * Math.PI * hz) / sr, coeff = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < len; i++) { const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)); const s0 = pcm[(from + i) * 2 + ch]! * h + coeff * s1 - s2; s2 = s1; s1 = s0; }
    const a = (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))) / (len * 0.5);
    p += a * a; k++;
  }
  return Math.sqrt(p / Math.max(1, k));
}
/** Fraction of the true spans covered by the found ones. */
export function coverage(found: readonly Span[], truth: readonly Span[]): number {
  let total = 0, covered = 0;
  for (const p of truth) { total += p.end - p.start; for (const f of found) covered += Math.max(0, Math.min(p.end, f.end) - Math.max(p.start, f.start)); }
  return covered / total;
}
/** The complement of `spans` within [0, seconds). */
export function between(spans: readonly Span[], seconds: number): Span[] {
  const out: Span[] = [];
  let t = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) { if (s.start > t) out.push({ start: t, end: s.start }); t = Math.max(t, s.end); }
  if (t < seconds) out.push({ start: t, end: seconds });
  return out;
}
/**
 * Lag (samples, |lag| ≤ maxLag) that best aligns `y` with `x` around frame n0 over `len` frames of the left channel
 * (cross-correlation; positive = y is late). For a broadband x this is where the impulse response of x → y is largest: a delay.
 * For a tone it is the phase of y against x at that frequency, in samples (modulo the period): a delay AND any phase a filter turns.
 */
export function bestLag(x: Float32Array, y: Float32Array, n0: number, len: number, maxLag = 20): number {
  return lagAndMatch(x, y, n0, len, maxLag).lag;
}
/**
 * bestLag with the normalised cross-correlation at that lag (`match`: 1 = the same waveform up to a gain, 0 = nothing in common).
 * A lag means something only where the two sounds match: silence or a broken signal (NaN) correlates with nothing and gives
 * match 0 (and a lag that says nothing: the first one tried for silence, 0 for NaN).
 */
export function lagAndMatch(x: Float32Array, y: Float32Array, n0: number, len: number, maxLag = 20): { lag: number; match: number } {
  let best = -Infinity, lag = 0, ex = 0;
  for (let i = 0; i < len; i++) ex += x[(n0 + i) * 2]! ** 2;
  for (let d = -maxLag; d <= maxLag; d++) {
    let c = 0;
    for (let i = 0; i < len; i++) c += x[(n0 + i) * 2]! * y[(n0 + i + d) * 2]!;
    if (c > best) { best = c; lag = d; }
  }
  let ey = 0;
  for (let i = 0; i < len; i++) ey += y[(n0 + i + lag) * 2]! ** 2;
  const match = best / Math.sqrt(ex * ey);
  return { lag, match: Number.isFinite(match) ? match : 0 };
}
