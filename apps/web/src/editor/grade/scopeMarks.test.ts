/** The scope additions' numbers (grade-verify C9) and, as todo rows, W3's parade, zebra and throttle. */
import { describe, expect, it } from 'vitest';
import { skinLineDeg, SKIN_LINE_DEG, VEC_TARGETS, vecPolar, ZEBRA_CLIPPED_LUMA, ZEBRA_CRUSHED_LUMA } from './scopeMarks.ts';

describe('scope marks', () => {
  it('the skin-tone line is the I axis at 130.5° on these BT.709 Cb/Cr axes, and the targets sit at the computed angles', () => {
    expect(Math.abs(skinLineDeg() - SKIN_LINE_DEG)).toBeLessThan(0.05);
    const want: Record<string, [number, number]> = { R: [102.9, 0.768], Yl: [174.8, 0.752], G: [-130.3, 0.892], Cy: [-77.1, 0.768], B: [-5.2, 0.752], Mg: [49.7, 0.892] };
    for (const t of VEC_TARGETS) {
      const p = vecPolar(t.rgb[0], t.rgb[1], t.rgb[2]);
      expect(Math.abs(p.deg - want[t.letter]![0]), t.letter).toBeLessThan(0.06);
      expect(Math.abs(p.radius - want[t.letter]![1]), t.letter).toBeLessThan(0.001);
    }
  });
  it('zebra uses the scopes\' own thresholds', () => { expect([ZEBRA_CLIPPED_LUMA, ZEBRA_CRUSHED_LUMA]).toEqual([251, 4]); });
  it.todo('W3 paradeOf: on a left-red / right-blue picture the red panel\'s left columns count only 255, green only 0, blue\'s right columns only 255 (G14)');
  it.todo('W3 zebraCounts: 255 and 252 counted clipped, 0 and 4 crushed, 250 and 6 neither (G15)');
  it.todo('W3 scopeThrottle: while draft, 60 frame changes give 10 analyses; batches with an unchanged frame do not count; full quality always analyses (C8, G17)');
  it.todo('W3 Scopes: the parade, the targets with their letters, the skin line with grade.skinNote, legends in words in both languages; no number about the skin line (G18)');
  it.todo('W3 zebra: drawn only while paused (hidden while data-quality is draft, chip «זברה מוצגת כשהניגון עוצר»); never read by the scopes, never in a still or an export (C7, G16)');
});
