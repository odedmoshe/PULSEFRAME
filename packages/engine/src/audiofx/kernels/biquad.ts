/**
 * Runtime of a biquad cascade for the sound-effect kernels (ADR-0010): transposed direct form II, Float64 state per channel,
 * state below 1e-30 flushed to 0 (no denormal slowdowns in long silences). Coefficients come from design.ts.
 */
import type { Biquad } from '../design.ts';

export class Cascade {
  /** [b0, b1, b2, a1, a2] per section. */
  private readonly c: Float64Array;
  /** [s1, s2] per section and channel: section k, channel ch at k·4 + ch·2. */
  private readonly s: Float64Array;
  readonly sections: number;
  constructor(sections: readonly Biquad[]) {
    this.sections = sections.length;
    this.c = new Float64Array(sections.length * 5);
    sections.forEach((q, k) => this.c.set(q, k * 5));
    this.s = new Float64Array(sections.length * 4);
  }
  /** Filter one sample of channel `ch` (0 or 1); allocation-free. */
  tick(x: number, ch: number): number {
    const c = this.c, s = this.s;
    for (let k = 0, ci = 0, si = ch * 2; k < this.sections; k++, ci += 5, si += 4) {
      const y = c[ci]! * x + s[si]!;
      let s1 = c[ci + 1]! * x - c[ci + 3]! * y + s[si + 1]!;
      let s2 = c[ci + 2]! * x - c[ci + 4]! * y;
      if (s1 < 1e-30 && s1 > -1e-30) s1 = 0;
      if (s2 < 1e-30 && s2 > -1e-30) s2 = 0;
      s[si] = s1;
      s[si + 1] = s2;
      x = y;
    }
    return x;
  }
}
