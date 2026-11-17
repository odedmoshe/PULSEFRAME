/**
 * The section designs the cleanup kernels share (ADR-0013; design.ts notch and highShelf), measured on their exact frequency
 * response at 44.1, 48 and 96 kHz.
 */
import { describe, expect, it } from 'vitest';
import { highShelf, notch, poleRadius, type Biquad } from './design.ts';

/** |H(e^{jω})| of one section at f Hz. */
function gain(s: Biquad, f: number, sr: number): number {
  const w = (2 * Math.PI * f) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = s[0]! + s[1]! * c1 + s[2]! * c2, ni = -(s[1]! * s1 + s[2]! * s2);
  const dr = 1 + s[3]! * c1 + s[4]! * c2, di = -(s[3]! * s1 + s[4]! * s2);
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}
const db = (g: number) => 20 * Math.log10(g);

describe.each([44100, 48000, 96000])('section designs at %i Hz', (sr) => {
  it('notch: zero at f0, unity at DC and Nyquist, within 0.1 dB an octave away at Q 30, stable', () => {
    for (const [f0, q] of [[50, 30], [100, 30], [240, 10], [1000, 4]] as const) {
      const s = notch(f0, q, sr);
      expect(gain(s, f0, sr), `${f0} Hz`).toBeLessThan(1e-9);
      expect(Math.abs(gain(s, 0, sr) - 1)).toBeLessThan(1e-9);
      expect(Math.abs(gain(s, sr / 2, sr) - 1)).toBeLessThan(1e-9);
      if (q >= 30) for (const f of [f0 / 2, f0 * 2]) expect(Math.abs(db(gain(s, f, sr))), `${f0} Hz, Q ${q}, at ${f}`).toBeLessThan(0.1);
      expect(poleRadius(s)).toBeLessThan(1);
    }
  });
  it('high shelf: 0 dB at DC, `db` at Nyquist, half of it at f0, monotone in between, stable', () => {
    for (const [f0, g] of [[10000, 2], [3500, 4], [1000, -6]] as const) {
      if (f0 >= 0.45 * sr) continue;
      const s = highShelf(f0, g, sr);
      expect(Math.abs(db(gain(s, 0, sr)))).toBeLessThan(1e-9);
      expect(Math.abs(db(gain(s, sr / 2, sr)) - g)).toBeLessThan(1e-9);
      expect(Math.abs(db(gain(s, f0, sr)) - g / 2)).toBeLessThan(1e-6);
      let prev = db(gain(s, 20, sr));
      for (let f = 40; f < sr / 2; f *= 1.5) { const v = db(gain(s, f, sr)); expect(g > 0 ? v >= prev - 1e-9 : v <= prev + 1e-9).toBe(true); prev = v; }
      expect(poleRadius(s)).toBeLessThan(1);
    }
    const flat = highShelf(5000, 0, sr); // 0 dB: numerator equals denominator, an exact identity
    expect([flat[0], flat[1], flat[2]]).toEqual([1, flat[3], flat[4]]);
  });
});
