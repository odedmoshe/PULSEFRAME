/** The cleanup FFT (fft.ts, ADR-0013): exactness, agreement with a direct DFT, deterministic tables. */
import { describe, expect, it } from 'vitest';
import { cosPi, Fft, fftOf, fftTables, sinPi, sqrtHann, stftSize } from './fft.ts';
import { hash32, uniform } from './noise.ts';

const SIZES = [256, 512, 1024, 2048, 4096] as const;
const signal = (n: number, seed: number) => {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { re[i] = 2 * uniform(hash32(seed, i, 0)) - 1; im[i] = 2 * uniform(hash32(seed, i, 1)) - 1; }
  return { re, im };
};

describe('fft.ts', () => {
  it.each(SIZES)('forward then inverse returns the input within 1e-12 (N = %i)', (n) => {
    const { re, im } = signal(n, n), a = re.slice(), b = im.slice();
    const f = fftOf(n);
    f.forward(a, b);
    f.inverse(a, b);
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(a[i]! - re[i]!), Math.abs(b[i]! - im[i]!));
    expect(worst).toBeLessThanOrEqual(1e-12);
    // backward is the inverse without 1/N
    const c = re.slice(), d = im.slice();
    f.forward(c, d);
    f.backward(c, d);
    for (let i = 0; i < n; i += 37) expect(Math.abs(c[i]! / n - re[i]!)).toBeLessThanOrEqual(1e-12);
  });
  it.each(SIZES)('matches a direct DFT within 1e-9·N (N = %i)', (n) => {
    const { re, im } = signal(n, 7 * n), a = re.slice(), b = im.slice();
    fftOf(n).forward(a, b);
    let worst = 0;
    // a direct DFT of every 17th bin (the full O(N²) sum for every bin at N = 4096 adds nothing)
    for (let k = 0; k < n; k += k < 8 || k > n - 8 ? 1 : 17) {
      let sr = 0, si = 0;
      for (let j = 0; j < n; j++) { const ph = (-2 * Math.PI * ((k * j) % n)) / n, c = Math.cos(ph), s = Math.sin(ph); sr += re[j]! * c - im[j]! * s; si += re[j]! * s + im[j]! * c; }
      worst = Math.max(worst, Math.abs(sr - a[k]!), Math.abs(si - b[k]!));
    }
    expect(worst).toBeLessThanOrEqual(1e-9 * n);
  });
  it('a rebuilt table is byte-identical, and transforms through it are bit-identical', () => {
    for (const n of [...SIZES, 2, 4, 8, 16, 8192]) {
      const t1 = fftTables(n), t2 = fftTables(n);
      expect(Buffer.from(t1.cos.buffer).equals(Buffer.from(t2.cos.buffer)), `cos ${n}`).toBe(true);
      expect(Buffer.from(t1.sin.buffer).equals(Buffer.from(t2.sin.buffer)), `sin ${n}`).toBe(true);
      expect(Buffer.from(t1.rev.buffer).equals(Buffer.from(t2.rev.buffer)), `rev ${n}`).toBe(true);
    }
    const { re, im } = signal(1024, 3), a = re.slice(), b = im.slice(), c = re.slice(), d = im.slice();
    new Fft(1024).forward(a, b);
    new Fft(1024, fftTables(1024)).forward(c, d);
    expect(Buffer.from(a.buffer).equals(Buffer.from(c.buffer)) && Buffer.from(b.buffer).equals(Buffer.from(d.buffer))).toBe(true);
  });
  it.each(SIZES)('twiddles within 4e-16·N of Math.cos and Math.sin (compared here only; N = %i)', (n) => {
    const t = fftTables(n);
    let worst = 0;
    for (let j = 0; j < n / 2; j++) worst = Math.max(worst, Math.abs(t.cos[j]! - Math.cos((2 * Math.PI * j) / n)), Math.abs(t.sin[j]! - Math.sin((2 * Math.PI * j) / n)));
    expect(worst).toBeLessThanOrEqual(4e-16 * n);
    expect([t.cos[0], t.sin[0], t.cos[n / 4], t.sin[n / 4]]).toEqual([1, 0, 0, 1]);
  });
  it('sinPi and cosPi by series agree with Math within 1e-15 on [-1, 1] (Math carries the rounding of π·x, and cosPi that of x + 1/2), and are periodic beyond; the bit-reversal is a permutation', () => {
    let worst = 0;
    for (let i = -2000; i <= 2000; i++) { const x = i / 2000; worst = Math.max(worst, Math.abs(sinPi(x) - Math.sin(Math.PI * x)), Math.abs(cosPi(x) - Math.cos(Math.PI * x))); }
    expect(worst).toBeLessThanOrEqual(1e-15);
    for (const x of [0.3, -0.7, 0.125]) for (const k of [-6, 2, 40]) expect(Math.abs(sinPi(x + k) - sinPi(x))).toBeLessThanOrEqual(1e-14);
    const rev = fftTables(1024).rev, seen = new Set(rev);
    expect(seen.size).toBe(1024);
    expect(rev[1]).toBe(512);
  });
  it('stftSize: 1024 at 44.1 and 48 kHz, 2048 at 88.2 and 96 kHz; the denoise look-ahead N + N/4 − 1 stays within 50 ms from 8 to 192 kHz', () => {
    expect([44100, 48000, 88200, 96000].map(stftSize)).toEqual([1024, 1024, 2048, 2048]);
    for (let sr = 8000; sr <= 192000; sr += 50) { const n = stftSize(sr); expect((n + n / 4 - 1) / sr, String(sr)).toBeLessThanOrEqual(0.05); }
  });
  it('sqrt-Hann at hop N/4 overlap-adds (w²) to exactly 2 within 1e-15', () => {
    const n = 1024, w = sqrtHann(n);
    for (let i = 0; i < n / 4; i++) { let s = 0; for (let k = 0; k < 4; k++) s += w[i + (k * n) / 4]! ** 2; expect(Math.abs(s - 2)).toBeLessThan(1e-15); }
  });
  it('rejects a size that is not a power of two', () => {
    expect(() => fftTables(1000)).toThrow(/power of two/);
  });
});
