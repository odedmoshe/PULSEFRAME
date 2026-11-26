import { describe, expect, it } from 'vitest';
import { PitchStretcher, RampResampler, rampSourceFrames, stretchKeepingPitch } from './stretch.ts';

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

describe('ramp resampler (continuous speed change)', () => {
  const run = (src: Float32Array, v0: number, v1: number, total: number, size = src.length, start = 0, offset = 0) => {
    const r = new RampResampler({ v0, v1, total, offset: 0, length: total }, start);
    const parts: Float32Array[] = [];
    for (let i = offset * 2; i < src.length; i += size * 2) parts.push(r.push(src.subarray(i, Math.min(src.length, i + size * 2))));
    parts.push(r.finish());
    const o = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { o.set(p, at); at += p.length; }
    return o;
  };
  it('a 440 Hz tone ramped 1× → 2× over three seconds glides from 440 to 880 Hz; the level stays; the length is exact', () => {
    const total = 3 * SR;
    const src = tone(440, 5);
    const out = run(src, 1, 2, total);
    expect(out.length).toBe(total * 2);
    expect(Math.abs(hzOf(out, 0, 0.1) - 440 * 1.017)).toBeLessThan(12);   // average speed over the first 0.1 s is 1.017
    expect(Math.abs(hzOf(out, 1.45, 1.55) - 660)).toBeLessThan(12);       // half way: 1.5×
    expect(Math.abs(hzOf(out, 2.9, 3) - 440 * 1.983)).toBeLessThan(12);
    expect(Math.abs(rms(out, 0.1, 2.9) / rms(src, 0.1, 4) - 1)).toBeLessThan(0.02);
    expect(rampSourceFrames(1, 2, total, total)).toBe(1.5 * total); // source used = average speed × length
  });
  it('at one speed it is a plain resampler; the same output whatever sizes the source arrives in, and when started part-way', () => {
    const src = tone(300, 3);
    for (let i = 0; i < src.length; i++) src[i] = src[i]! + 0.2 * Math.sin(i * 0.37) * Math.sin(i * 0.011);
    const same = run(src, 1, 1, 2 * SR);
    expect(same.every((v, i) => Math.abs(v - src[i]!) < 1e-6)).toBe(true);
    const total = Math.round(2.2 * SR);
    const whole = run(src, 0.5, 1.5, total);
    for (const size of [1, 777, 4096]) expect(run(src, 0.5, 1.5, total, size).every((v, i) => v === whole[i]), `chunks of ${size}`).toBe(true);
    // started at output frame 30000: the source handed over begins at floor(position of that frame)
    const start = 30000, first = Math.floor(rampSourceFrames(0.5, 1.5, total, start));
    const tail = run(src, 0.5, 1.5, total, 4096, start, first);
    expect(tail.length).toBe((total - start) * 2);
    // the very first frames lack the one source frame before the start (taken as silence); after that it is the same sound
    let worst = 0;
    for (let i = 8; i < tail.length; i++) worst = Math.max(worst, Math.abs(tail[i]! - whole[start * 2 + i]!));
    expect(worst).toBeLessThan(1e-6);
  }, 30_000); // 2.2 s alone; slower when the whole suite runs in parallel
  it('a part of a ramp plays exactly what the whole ramp plays there, and the eased curve glides more slowly at first', () => {
    const src = tone(300, 6);
    for (let i = 0; i < src.length; i++) src[i] = src[i]! + 0.2 * Math.sin(i * 0.37) * Math.sin(i * 0.011);
    const total = 3 * SR;
    const collect = (span: ConstructorParameters<typeof RampResampler>[0], input: Float32Array) => { const r = new RampResampler(span); const a = r.push(input), b = r.finish(); const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
    const whole = collect({ v0: 0.5, v1: 2, total, offset: 0, length: total }, src);
    // the second half as its own clip: it is handed the source from where that half begins
    const off = total / 2, first = Math.floor(rampSourceFrames(0.5, 2, total, off));
    const part = collect({ v0: 0.5, v1: 2, total, offset: off, length: total - off }, src.subarray(first * 2));
    expect(part.length).toBe((total - off) * 2);
    let worst = 0;
    for (let i = 8; i < part.length; i++) worst = Math.max(worst, Math.abs(part[i]! - whole[off * 2 + i]!));
    expect(worst).toBeLessThan(0.02); // the part's source starts on a whole frame, the whole ramp's position there is fractional: a sub-sample shift, nothing more
    // eased: same source over the same time; a quarter of the way it has played less than the even ramp
    expect(rampSourceFrames(1, 3, 400, 400, 'smooth')).toBeCloseTo(rampSourceFrames(1, 3, 400, 400), 9);
    expect(rampSourceFrames(1, 3, 400, 100, 'smooth')).toBeLessThan(rampSourceFrames(1, 3, 400, 100));
    const eased = collect({ v0: 1, v1: 2, total, offset: 0, length: total, curve: 'smooth' }, tone(440, 6));
    expect(Math.abs(hzOf(eased, 0.05, 0.25) - 440)).toBeLessThan(12);   // still close to the first speed (an even ramp is at 462 Hz here)
    expect(Math.abs(hzOf(eased, 2.75, 2.95) - 880)).toBeLessThan(12);   // and already close to the last
  });
});
