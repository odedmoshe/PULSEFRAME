import { describe, expect, it } from 'vitest';
import { PitchStretcher, stretchKeepingPitch } from './stretch.ts';

const SR = 48000;
const tone = (hz: number, seconds: number, amp = 0.5) => { const n = Math.round(seconds * SR), x = new Float32Array(n * 2); for (let i = 0; i < n; i++) { const v = amp * Math.sin((2 * Math.PI * hz * i) / SR); x[i * 2] = v; x[i * 2 + 1] = v; } return x; };
/** Frequency from the zero crossings of the left channel between two times. */
const hzOf = (x: Float32Array, from: number, to: number) => { let c = 0; const a = Math.round(from * SR), b = Math.round(to * SR); for (let i = a + 1; i < b; i++) if (x[(i - 1) * 2]! < 0 && x[i * 2]! >= 0) c++; return c / (to - from); };
const rms = (x: Float32Array, from: number, to: number) => { let e = 0; const a = Math.round(from * SR), b = Math.round(to * SR); for (let i = a; i < b; i++) e += x[i * 2]! ** 2; return Math.sqrt(e / (b - a)); };

describe('pitch-keeping time stretch', () => {
  it.each([[0.5], [0.75], [1.25], [2]])('a 440 Hz tone at %s× keeps its pitch and level and gets the right length', (speed) => {
    const src = tone(440, 4);
    const frames = Math.round((4 * SR) / speed);
    const out = stretchKeepingPitch(src, speed, SR, frames);
    const len = frames / SR;
    expect(Math.abs(hzOf(out, 0.2, len - 0.2) - 440)).toBeLessThan(3); // varispeed would give 440 × speed
    expect(rms(out, 0.2, len - 0.2) / rms(src, 0.2, 3.8)).toBeGreaterThan(0.9);
    expect(rms(out, 0.2, len - 0.2) / rms(src, 0.2, 3.8)).toBeLessThan(1.1);
    // no clicks: a pure tone has no sample-to-sample jump larger than its own steepest slope allows (with some room)
    let jump = 0;
    for (let i = 1; i < frames; i++) jump = Math.max(jump, Math.abs(out[i * 2]! - out[(i - 1) * 2]!));
    expect(jump).toBeLessThan(0.5 * 2 * Math.PI * 440 / SR * 2.5);
  });
  it('events keep their place in time: a click two seconds into the source is heard at 2 s ÷ speed (within 15 ms)', () => {
    for (const speed of [0.5, 1.5, 2]) {
      const src = new Float32Array(4 * SR * 2);
      for (let i = 0; i < 480; i++) { const v = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / SR); src[(2 * SR + i) * 2] = v; src[(2 * SR + i) * 2 + 1] = v; }
      const frames = Math.round((4 * SR) / speed);
      const out = stretchKeepingPitch(src, speed, SR, frames);
      let first = -1;
      for (let i = 0; i < frames && first < 0; i++) if (Math.abs(out[i * 2]!) > 0.2) first = i;
      expect(Math.abs(first / SR - 2 / speed), `${speed}×`).toBeLessThan(0.015);
    }
  });
  it('gives the same output whatever sizes the source arrives in', () => {
    const src = tone(300, 2);
    for (let i = 0; i < src.length; i++) src[i] = src[i]! + 0.2 * Math.sin(i * 0.37) * Math.sin(i * 0.011); // not a pure tone
    const whole = (() => { const s = new PitchStretcher(1.3, SR); const a = s.push(src), b = s.finish(); const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; })();
    for (const size of [2, 962, 4096, 48000]) {
      const s = new PitchStretcher(1.3, SR);
      const parts: Float32Array[] = [];
      for (let i = 0; i < src.length; i += size * 2) parts.push(s.push(src.subarray(i, Math.min(src.length, i + size * 2))));
      parts.push(s.finish());
      const o = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { o.set(p, at); at += p.length; }
      expect(o.length, `chunks of ${size}`).toBe(whole.length);
      expect(o.every((v, i) => v === whole[i]), `chunks of ${size}`).toBe(true);
    }
  });
  it('left and right stay separate; silence in gives silence out; memory stays bounded on a long stream', () => {
    const src = tone(440, 2);
    for (let i = 0; i < src.length / 2; i++) src[i * 2 + 1] = 0; // right channel silent
    const out = stretchKeepingPitch(src, 0.8, SR, Math.round((2 * SR) / 0.8));
    let right = 0;
    for (let i = 0; i < out.length / 2; i++) right = Math.max(right, Math.abs(out[i * 2 + 1]!));
    expect(right).toBe(0);
    expect(stretchKeepingPitch(new Float32Array(SR * 2), 2, SR, SR / 2).every((v) => v === 0)).toBe(true);
    const s = new PitchStretcher(2, SR);
    const chunk = tone(220, 1);
    let produced = 0;
    for (let i = 0; i < 60; i++) produced += s.push(chunk).length / 2;
    expect((s as unknown as { input: Float32Array }).input.length / 2).toBeLessThan(3 * SR); // a minute went through; at most a few seconds are held
    expect(Math.abs(produced / SR - 30)).toBeLessThan(0.2);
  });
});
