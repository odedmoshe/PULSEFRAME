/**
 * cleanup.dehum (ADR-0013): measurements on the kernel through renderFx (the harness the contract suite and the browser self-test
 * use). The contract suite (kernels.test.ts) covers block sizes, warm-up, identity, silence and the bound at the corners.
 */
import { describe, expect, it } from 'vitest';
import { audioEffectParams, type AudioFxParams } from '@pulseframe/core';
import { renderFx } from './index.ts';
import { dehum } from './dehum.ts';
import { dehumDesign } from '../design.ts';

const SR = 48000;
const P = (over: AudioFxParams = {}) => audioEffectParams('cleanup.dehum', over);
const db = (v: number) => 20 * Math.log10(v);
/** Sum of sines (amplitude per line) on both channels. */
function tones(lines: readonly [number, number][], frames: number, sr = SR): Float32Array {
  const x = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { let v = 0; for (const [f, a] of lines) v += a * Math.sin((2 * Math.PI * f * i) / sr); x[i * 2] = v; x[i * 2 + 1] = v; }
  return x;
}
/** Amplitude of the f component of the left channel over [from, from + len) (Hann-windowed Goertzel; a sine of amplitude A gives A). */
function amp(x: Float32Array, f: number, from: number, len: number, sr = SR): number {
  const w = (2 * Math.PI * f) / sr, coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) { const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)); const s0 = x[(from + i) * 2]! * h + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))) / (len * 0.5);
}
const LINE = 0.01 * Math.SQRT2; // −40 dBFS RMS
/** Reduction in dB of each line after the kernel has settled (positive = quieter), measured over 1 s. */
function reduction(p: AudioFxParams, lines: number[], speed = 1, sr = SR): number[] {
  const { warm } = dehum.reach(p, sr, speed), len = sr;
  const x = tones(lines.map((f) => [f, LINE] as [number, number]), warm + 2 * len, sr);
  const y = renderFx('cleanup.dehum', p, x, { sampleRate: sr, speed });
  return lines.map((f) => db(amp(x, f, warm + len, len, sr) / amp(y, f, warm + len, len, sr)));
}

describe('cleanup.dehum', () => {
  it('50 Hz hum lines k = 1..4 at −40 dBFS are reduced by at least 30 dB (defaults: 50 Hz, 4 harmonics, width 0.5)', () => {
    const r = reduction(P(), [50, 100, 150, 200]);
    console.log(`dehum 50 Hz lines: reduction ${r.map((v) => v.toFixed(1)).join(', ')} dB`);
    for (const v of r) expect(v).toBeGreaterThanOrEqual(30);
  });
  it('225 Hz and 1 kHz tones change by at most 0.2 dB (and so does 1 kHz at 44.1 and 96 kHz)', () => {
    const p = P();
    for (const [f, sr] of [[225, SR], [1000, SR], [1000, 44100], [1000, 96000]] as const) {
      const { warm } = dehum.reach(p, sr), len = sr, a = 0.1;
      const x = tones([[f, a]], warm + 2 * len, sr), y = renderFx('cleanup.dehum', p, x, { sampleRate: sr });
      const change = db(amp(y, f, warm + len, len, sr) / amp(x, f, warm + len, len, sr));
      expect(Math.abs(change), `${f} Hz at ${sr}`).toBeLessThanOrEqual(0.2);
    }
  });
  it("mainsHz '60' removes 60, 120, 180 and 240 Hz (at least 30 dB) and leaves 50 Hz", () => {
    const r = reduction(P({ mainsHz: '60' }), [60, 120, 180, 240, 50]);
    for (const v of r.slice(0, 4)) expect(v).toBeGreaterThanOrEqual(30);
    expect(Math.abs(r[4]!)).toBeLessThan(1);
  });
  it('at speed 2 the hum is heard at 100–400 Hz and those lines are reduced by at least 30 dB; 50 Hz is left', () => {
    const r = reduction(P(), [100, 200, 300, 400, 50], 2);
    console.log(`dehum at speed 2: reduction ${r.map((v) => v.toFixed(1)).join(', ')} dB`);
    for (const v of r.slice(0, 4)) expect(v).toBeGreaterThanOrEqual(30);
    expect(Math.abs(r[4]!)).toBeLessThan(1);
    expect(dehumDesign(P(), SR, 2).freqs).toEqual([100, 200, 300, 400]);
  });
  it('notches below 20 Hz and at or above 0.45·sr are left out; with none left the processor is dry', () => {
    expect(dehumDesign(P({ harmonics: 8 }), SR, 0.25).freqs).toEqual([25, 37.5, 50, 62.5, 75, 87.5, 100]);
    expect(dehumDesign(P({ mainsHz: '60', harmonics: 8 }), 8000, 4).freqs.every((f) => f < 0.45 * 8000)).toBe(true);
    const lone = P({ harmonics: 1 });
    expect(dehumDesign(lone, SR, 0.25).identity).toBe(true);
    expect(dehum.reach(lone, SR, 0.25).warm).toBe(0);
    const x = tones([[12.5, 0.5]], 4800);
    expect(Buffer.from(renderFx('cleanup.dehum', lone, x, { speed: 0.25 }).buffer).equals(Buffer.from(x.buffer))).toBe(true);
  });
  it('warm-up at most 3 s at every corner of the parameters, every speed from 0.25 to 4 and 44.1, 48 and 96 kHz', () => {
    let worst = 0;
    for (const sr of [44100, 48000, 96000]) for (const speed of [0.25, 0.5, 1, 1.5, 2, 4]) for (const mainsHz of ['50', '60']) for (const harmonics of [1, 8]) for (const width of [0, 1]) {
      const w = dehum.reach(P({ mainsHz, harmonics, width, amount: 1 }), sr, speed).warm / sr;
      worst = Math.max(worst, w);
      expect(w, `${sr} ${speed} ${mainsHz} ${harmonics} ${width}`).toBeLessThanOrEqual(3);
    }
    console.log(`dehum worst warm-up: ${worst.toFixed(3)} s`);
  });
  it('the bound is the l1 norm of the impulse response, and a worst-case input reaches it', () => {
    const p = P({ width: 1, harmonics: 8, amount: 0.7 }), d = dehumDesign(p, SR), W = d.warm + 1;
    const imp = new Float32Array(W * 2);
    imp[0] = 1; imp[1] = 1;
    const h = renderFx('cleanup.dehum', p, imp);
    // x[n] = sign(h[W − 1 − n]) makes y[W − 1] = Σ|h|
    const x = new Float32Array(W * 2);
    for (let n = 0; n < W; n++) { const s = h[(W - 1 - n) * 2]! >= 0 ? 1 : -1; x[n * 2] = s; x[n * 2 + 1] = s; }
    const y = renderFx('cleanup.dehum', p, x);
    expect(y[(W - 1) * 2]!).toBeLessThanOrEqual(d.bound * (1 + 1e-6));
    expect(y[(W - 1) * 2]!).toBeGreaterThan(d.bound * 0.999);
    expect(dehum.bound(p, SR)).toBe(d.bound);
  });
});
