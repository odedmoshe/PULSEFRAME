/**
 * Synthetic material for the multicam sync tests (ADR-0020): NON-periodic, speech-like sound. Syllable bursts at random times
 * with a gliding pitch, a few harmonics and a "fricative" of random high partials, all seeded, and evaluable at ANY time (so a
 * shifted, stretched or inverted copy is exact, not resampled). Pink noise for a given SNR. A WAV writer. Test material only.
 */
export interface Burst { t0: number; dur: number; f0: number; glide: number; amps: number[]; phases: number[]; hiF: number[]; hiP: number[]; hiAmp: number }
export function rng(seed: number) { let r = seed >>> 0 || 1; return () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; }; }

/** Syllables of 60–300 ms with gaps of 30–400 ms and a pause of 0.3–1 s now and then, over [0, seconds). */
export function speechBursts(seed: number, seconds: number, pitch = 1): Burst[] {
  const rnd = rng(seed), out: Burst[] = [];
  let t = 0.2 + rnd() * 0.3;
  while (t < seconds) {
    const dur = 0.06 + rnd() * 0.24;
    const f0 = (95 + rnd() * 150) * pitch;
    out.push({ t0: t, dur, f0, glide: (rnd() - 0.5) * 120, amps: Array.from({ length: 8 }, (_, h) => (0.35 + rnd() * 0.65) / (h + 1)), phases: Array.from({ length: 8 }, () => rnd() * 2 * Math.PI), hiF: Array.from({ length: 24 }, () => 2000 + rnd() * 5500), hiP: Array.from({ length: 24 }, () => rnd() * 2 * Math.PI), hiAmp: rnd() < 0.4 ? 0.02 + rnd() * 0.05 : 0.004 });
    t += dur + 0.03 + rnd() * 0.37 + (rnd() < 0.12 ? 0.3 + rnd() * 0.7 : 0);
  }
  return out;
}
/** The burst train's value at time t (seconds); 0 outside every burst. */
export function speechAt(bursts: Burst[], t: number, gain = 0.25): number {
  let lo = 0, hi = bursts.length - 1;
  if (hi < 0 || t < bursts[0]!.t0) return 0;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bursts[m]!.t0 <= t) lo = m; else hi = m - 1; }
  const b = bursts[lo]!, u = t - b.t0;
  if (u < 0 || u >= b.dur) return 0;
  const env = Math.sin((Math.PI * u) / b.dur) ** 2;
  const ph = 2 * Math.PI * (b.f0 * u + 0.5 * b.glide * u * u);
  let v = 0;
  for (let h = 0; h < b.amps.length; h++) v += b.amps[h]! * Math.sin((h + 1) * ph + b.phases[h]!);
  let w = 0;
  for (let k = 0; k < b.hiF.length; k++) w += Math.sin(2 * Math.PI * b.hiF[k]! * u + b.hiP[k]!);
  return gain * env * (v + (b.hiAmp * w) / 2);
}
/** Pink noise (Paul Kellet's filter of seeded white noise), n samples, RMS 1. */
export function pinkNoise(seed: number, n: number): Float32Array {
  const rnd = rng(seed), out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    out[i] = v; ss += v * v;
  }
  const rms = Math.sqrt(ss / n) || 1;
  for (let i = 0; i < n; i++) out[i] = out[i]! / rms;
  return out;
}
export const rmsOf = (x: Float32Array) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!; return Math.sqrt(s / Math.max(1, x.length)); };
/** Add noise to x at the given SNR (dB, signal RMS over noise RMS). */
export function addNoise(x: Float32Array, snrDb: number, seed: number): Float32Array {
  const n = pinkNoise(seed, x.length), k = rmsOf(x) / 10 ** (snrDb / 20);
  return x.map((v, i) => v + k * n[i]!);
}
/** 16-bit PCM WAV of mono or interleaved samples. */
export function wav(x: Float32Array, sampleRate: number, channels = 1): Buffer {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2 * channels, 28); b.writeUInt16LE(2 * channels, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i]! * 32767))), 44 + i * 2);
  return b;
}
/** A periodic music loop (a 2 s pattern of four notes), at time t; the same every period, so it has equal peaks every 2 s. */
export function loopAt(t: number): number {
  const u = ((t % 2) + 2) % 2, k = Math.floor(u / 0.5), v = u - k * 0.5;
  const f = [220, 277.18, 329.63, 440][k]!;
  return 0.2 * Math.exp(-6 * v) * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t)) + (v < 0.02 ? 0.15 * Math.sin(2 * Math.PI * 3000 * t) : 0);
}
