/**
 * Colour match model and fit (ADR-0014). The pictures here are synthetic point sets made by a seeded generator (test only); the
 * reference statistics are made by gradePixel itself, so a correct fit must find the values that made them.
 */
import { describe, expect, it } from 'vitest';
import { paramRange } from '@pulseframe/core';
import {
  balanceGoal, balanceGrade, colourSpread, fitGrade, GRADE_DEFAULTS, gradePixel, gradeSample, mergeSamples, pictureStats, samplePicture, statsDistance, verdictOf,
  type GradeParams, type PictureSample,
} from './colourMatch.ts';

/** Seeded generator (test only): mulberry32. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const KEYS = ['exposure', 'temperature', 'tint', 'contrast', 'saturation', 'shadows', 'highlights', 'fade'] as const;
const sampleOf = (pts: number[][]): PictureSample => ({ rgb: Float64Array.from(pts.flat()), count: pts.length });
/**
 * A picture whose graded version keeps its detail: grey levels spread over the band of input values that `p` maps into 0.08..0.92
 * (as far as 8-bit input allows), each point with its own colour of up to ±15 % per channel. A picture that the grade would clip
 * to black or white carries no information about the values, so no fit could recover them from it.
 */
function sceneFor(p: GradeParams, seed: number, n = 3000): PictureSample {
  const r = rng(seed), gain = 2 ** p.exposure, wMin = Math.min(1 + 0.2 * p.temperature, 1 - 0.1 * p.tint, 1 - 0.2 * p.temperature), wMax = Math.max(1 + 0.2 * p.temperature, 1 - 0.1 * p.tint, 1 - 0.2 * p.temperature);
  // x = input × gain × white balance; u = (x − 0.5)·contrast + 0.5 must stay inside 0.08..0.92
  let xlo = 0.5 - 0.42 / p.contrast, xhi = 0.5 + 0.42 / p.contrast;
  xlo = Math.max(xlo, 0.01 * gain * wMax); xhi = Math.min(xhi, 0.85 * gain * wMin);
  if (!(xhi > xlo)) throw new Error('no usable band');
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    const g = (xlo + (xhi - xlo) * (r() * 0.5 + (i / n) * 0.5)) / gain;
    pts.push([0, 1, 2].map(() => Math.min(1, Math.max(0, g * (1 + (r() - 0.5) * 0.3)))));
  }
  return sampleOf(pts);
}
/** An everyday picture: grey levels over the whole range, mild colours. */
function everyday(seed: number, n = 4096): PictureSample {
  const r = rng(seed), pts: number[][] = [];
  for (let i = 0; i < n; i++) { const g = 0.05 + 0.9 * ((i + r()) / n); pts.push([0, 1, 2].map(() => Math.min(1, Math.max(0, g * (1 + (r() - 0.5) * 0.4))))); }
  return sampleOf(pts);
}
/**
 * Colour bars as the match samples a still of them (the picture the proof first used): six flat saturated colours side by side
 * with soft edges, 85 × 48 points row by row, stored in 8 bits; each further frame has its edges a little further along. Every
 * channel is 0 or 1 nearly everywhere, so most of what a grade does to it is clipped away: several sets of values give the same
 * statistics, and tint (green is absent from the three bars that make up most of the mid-tones) is hardly seen at all.
 */
function colourBars(frames: number): PictureSample {
  const cols = [[1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1]], w = 85, h = 48, soft = 0.3;
  return mergeSamples(Array.from({ length: frames }, (_, frame) => {
    const rgb = new Float64Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = Math.min(5.999, ((x + 0.5) / w) * 6 + frame * 0.02), i = Math.floor(u), f = u - i;
      let t = i < 5 && f > 1 - soft ? (f - (1 - soft)) / soft : 0;
      t = t * t * (3 - 2 * t);
      for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = Math.round((cols[i]![c]! * (1 - t) + cols[Math.min(5, i + 1)]![c]! * t) * 255) / 255;
    }
    return { rgb, count: w * h };
  }));
}
/** A sample as a still stores it: every value rounded to 8 bits. */
const stored8 = (s: PictureSample): PictureSample => ({ rgb: s.rgb.map((v) => Math.round(v * 255) / 255), count: s.count });
const castOf = (s: PictureSample, k: readonly [number, number, number]): PictureSample => {
  const rgb = new Float64Array(s.count * 3);
  for (let i = 0; i < s.count * 3; i++) rgb[i] = Math.min(1, s.rgb[i]! * k[i % 3]!);
  return { rgb, count: s.count };
};
const inRange = (p: GradeParams) => KEYS.every((k) => { const r = paramRange('color.grade', k)!; return p[k] >= r.min && p[k] <= r.max; });

describe('gradePixel: the color.grade WGSL step for step', () => {
  const p = (q: Partial<GradeParams>): GradeParams => ({ ...GRADE_DEFAULTS, ...q });
  it('the defaults change nothing', () => {
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.9], [0.731, 0.004, 0.42]] as [number, number, number][]) gradePixel(c, GRADE_DEFAULTS).forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 14));
  });
  it('exposure 1 doubles the values up to the clamp', () => {
    expect(gradePixel([0.2, 0.3, 0.6], p({ exposure: 1 }))).toEqual([expect.closeTo(0.4, 14), expect.closeTo(0.6, 14), 1]);
    expect(gradePixel([0.1, 0.25, 0.45], p({ exposure: -1 }))).toEqual([expect.closeTo(0.05, 14), expect.closeTo(0.125, 14), expect.closeTo(0.225, 14)]);
  });
  it('temperature 0.5 gives R×1.1 and B×0.9; tint 1 gives G×0.9', () => {
    expect(gradePixel([0.5, 0.4, 0.5], p({ temperature: 0.5 }))).toEqual([expect.closeTo(0.55, 14), expect.closeTo(0.4, 14), expect.closeTo(0.45, 14)]);
    expect(gradePixel([0.5, 0.4, 0.5], p({ tint: 1 }))).toEqual([expect.closeTo(0.5, 14), expect.closeTo(0.36, 14), expect.closeTo(0.5, 14)]);
  });
  it('contrast scales about 0.5', () => {
    expect(gradePixel([0.3, 0.5, 0.6], p({ contrast: 2 }))).toEqual([expect.closeTo(0.1, 14), expect.closeTo(0.5, 14), expect.closeTo(0.7, 14)]);
  });
  it('saturation 0 gives the BT.709 grey of the value', () => {
    const c: [number, number, number] = [0.8, 0.3, 0.1], l = 0.2126 * 0.8 + 0.7152 * 0.3 + 0.0722 * 0.1;
    gradePixel(c, p({ saturation: 0 })).forEach((v) => expect(v).toBeCloseTo(l, 14));
    // the grey is of the CLAMPED value: exposure pushes red past 1 first
    const e = gradePixel([0.8, 0.3, 0.1], p({ exposure: 1, saturation: 0 })), l2 = 0.2126 * 1 + 0.7152 * 0.6 + 0.0722 * 0.2;
    e.forEach((v) => expect(v).toBeCloseTo(l2, 14));
  });
  it('fade 1 gives 0.75c + 0.12', () => {
    expect(gradePixel([0, 0.5, 1], p({ fade: 1 }))).toEqual([expect.closeTo(0.12, 14), expect.closeTo(0.495, 14), expect.closeTo(0.87, 14)]);
  });
  it('shadows and highlights tint by (1 − l)² and l²', () => {
    const c: [number, number, number] = [0.2, 0.2, 0.2], l = 0.2;
    expect(gradePixel(c, p({ shadows: 1 }))).toEqual([expect.closeTo(0.2 - 0.08 * (1 - l) ** 2, 14), expect.closeTo(0.2 + 0.02 * (1 - l) ** 2, 14), expect.closeTo(0.2 + 0.1 * (1 - l) ** 2, 14)]);
    const h: [number, number, number] = [0.7, 0.7, 0.7];
    expect(gradePixel(h, p({ highlights: -1 }))).toEqual([expect.closeTo(0.7 - 0.1 * 0.49, 14), expect.closeTo(0.7 - 0.04 * 0.49, 14), expect.closeTo(0.7 + 0.08 * 0.49, 14)]);
  });
  it('the result is clamped to 0..1', () => {
    for (const v of gradePixel([1, 0, 1], p({ exposure: 2, contrast: 2, saturation: 2 }))) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});

describe('samples and statistics', () => {
  it('samplePicture: a fixed grid of at most maxSamples real pixels, transparent ones left out', () => {
    const w = 64, h = 36, rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i * 4] = i % 256; rgba[i * 4 + 1] = (i * 7) % 256; rgba[i * 4 + 2] = 200; rgba[i * 4 + 3] = 255; }
    const s = samplePicture(rgba, w, h, 100);
    expect(s.count).toBeLessThanOrEqual(100);
    expect(s.count).toBeGreaterThan(80);
    for (let i = 0; i < s.count; i++) expect(s.rgb[i * 3 + 2]).toBe(200 / 255);
    expect(samplePicture(rgba, w, h)).toEqual(samplePicture(rgba, w, h)); // deterministic
    expect(samplePicture(rgba, w, h).count).toBe(w * h); // smaller than the grid: every pixel once
    const holes = rgba.slice(); for (let i = 0; i < w * h; i += 2) holes[i * 4 + 3] = 0;
    expect(samplePicture(holes, w, h).count).toBe(w * h / 2);
    expect(() => samplePicture(rgba.subarray(0, 10), w, h)).toThrow(/needs/);
  });
  it('mergeSamples concatenates in order', () => {
    const a = sampleOf([[0.1, 0.2, 0.3]]), b = sampleOf([[0.4, 0.5, 0.6], [0.7, 0.8, 0.9]]);
    expect(mergeSamples([a, b])).toEqual(sampleOf([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]]));
  });
  it('pictureStats: CIELAB D65 of known colours', () => {
    const white = pictureStats(sampleOf([[1, 1, 1]]));
    expect(white.lPct.every((l) => Math.abs(l - 100) < 1e-3)).toBe(true);
    const grey = pictureStats(sampleOf(Array.from({ length: 10 }, () => [0.5, 0.5, 0.5])));
    expect(grey.lPct[2]).toBeCloseTo(53.389, 2); // L* of sRGB 50 % grey
    expect(Math.abs(grey.meanA)).toBeLessThan(0.01); expect(Math.abs(grey.meanB)).toBeLessThan(0.01);
    const red = pictureStats(sampleOf([[1, 0, 0]])); // sRGB red: L 53.24, a 80.09, b 67.20; L is a mid-tone
    expect(red.lPct[2]).toBeCloseTo(53.24, 1); expect(red.meanA).toBeCloseTo(80.09, 0); expect(red.meanB).toBeCloseTo(67.2, 0);
    expect(red.meanC).toBeCloseTo(Math.hypot(80.09, 67.2), 0);
    expect(red.rgbMedian).toEqual([1, 0, 0]);
  });
  it('pictureStats: percentiles in order; mid-tone means leave out dark and bright points', () => {
    const s = pictureStats(sampleOf([[0.02, 0.02, 0.0], [0.5, 0.45, 0.5], [0.98, 1, 0.9]]));
    expect([...s.lPct]).toEqual([...s.lPct].sort((x, y) => x - y));
    const mid = pictureStats(sampleOf([[0.5, 0.45, 0.5]]));
    expect(s.meanA).toBeCloseTo(mid.meanA, 12); expect(s.meanB).toBeCloseTo(mid.meanB, 12);
  });
  it('statsDistance: 0 for equal stats, symmetric, and grows with a cast and with lightness', () => {
    const base = everyday(3), sb = pictureStats(base);
    expect(statsDistance(sb, sb)).toBe(0);
    const warm = pictureStats(castOf(base, [1.1, 1, 0.9])), dark = pictureStats(castOf(base, [0.8, 0.8, 0.8]));
    expect(statsDistance(sb, warm)).toBeCloseTo(statsDistance(warm, sb), 12);
    expect(statsDistance(sb, warm)).toBeGreaterThan(2);
    expect(statsDistance(sb, dark)).toBeGreaterThan(2);
    expect(verdictOf(1.9)).toBe('close'); expect(verdictOf(2)).toBe('close'); expect(verdictOf(4.9)).toBe('noticeable'); expect(verdictOf(5.1)).toBe('partial');
  });
});

describe('fitGrade', { timeout: 60_000 }, () => {
  const hold0 = { shadows: 0, highlights: 0, fade: 0 };
  it('recovers 100 seeded basic parameter sets within ±0.03 from pictures graded by the model', () => {
    const r = rng(20261117), worst: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
      const truth: GradeParams = { ...GRADE_DEFAULTS, exposure: (r() * 2 - 1) * 1.5, temperature: (r() * 2 - 1) * 0.8, tint: (r() * 2 - 1) * 0.8, contrast: 0.5 + r(), saturation: 0.5 + r() };
      const target = sceneFor(truth, 1000 + i), reference = pictureStats(gradeSample(target, truth));
      const fit = fitGrade(target, reference, { hold: hold0, amount: 1 });
      for (const k of ['exposure', 'temperature', 'tint', 'contrast', 'saturation'] as const) {
        const err = Math.abs(fit.params[k] - truth[k]);
        worst[k] = Math.max(worst[k] ?? 0, err);
        expect(err, `set ${i} ${k}: truth ${truth[k].toFixed(3)}, fit ${fit.params[k]}`).toBeLessThanOrEqual(0.03);
      }
      expect(fit.params.shadows).toBe(0); expect(fit.params.fade).toBe(0);
      expect(fit.residual).toBeLessThan(1);
      expect(fit.verdict).toBe('close');
    }
    console.log('fitGrade recovery, worst error per value over 100 sets:', worst);
  }, 240_000);
  it('a self-match moves every value by less than 0.01', () => {
    for (const seed of [1, 2, 3]) {
      const s = everyday(seed), fit = fitGrade(s, pictureStats(s), { hold: hold0, amount: 1 });
      for (const k of KEYS) expect(Math.abs(fit.params[k] - GRADE_DEFAULTS[k]), k).toBeLessThan(0.01);
      expect(fit.limitedBy).toEqual([]);
    }
  });
  // The proof's first run: a match of colour bars to a graded copy of themselves came back with tint −0.996 (the grade had −0.2),
  // and parts of the same stills ended with temperature and tint at −1 and a difference of 5.7 where 0.05 was in reach. Two causes:
  // the few points of the coarse stage were an even stride through the picture, which took uneven shares of the bars, and the
  // pull toward no change was weaker than the 8-bit rounding of a still, so rounding chose the values the picture does not show.
  it('colour bars, a picture that hides most of a grade: the fit reaches the statistics and leaves tint, which it cannot see, near no change', () => {
    const known: GradeParams = { exposure: 0.3, temperature: 0.35, tint: -0.2, contrast: 1.15, saturation: 0.85, shadows: 0.2, highlights: 0.1, fade: 0.05 };
    const found: Record<string, unknown> = {};
    for (const frames of [1, 2, 3, 4]) {
      const target = colourBars(frames), reference = pictureStats(stored8(gradeSample(target, known)));
      // the known values themselves: what the 8-bit rounding of the reference alone leaves
      const reachable = statsDistance(pictureStats(gradeSample(target, known)), reference);
      const fit = fitGrade(target, reference, { hold: { shadows: 0.2, highlights: 0.1, fade: 0.05 }, amount: 1 });
      found[`${frames} frame(s), ${target.count} points`] = { ...fit.params, residual: Number(fit.residual.toFixed(3)), reachable: Number(reachable.toFixed(3)) };
      expect(reachable, `${frames} frames`).toBeLessThan(0.1);
      expect(fit.residual, `${frames} frames: residual`).toBeLessThanOrEqual(0.1);
      expect(Math.abs(fit.params.tint), `${frames} frames: tint ${fit.params.tint}`).toBeLessThanOrEqual(0.2);
      expect(fit.limitedBy, `${frames} frames`).toEqual([]);
      expect(inRange(fit.params)).toBe(true);
    }
    console.log('fitGrade on colour bars:', found);
  });
  // The distance a match reports is the mean absolute error of the five L* percentiles plus the mid-tone colour difference; the
  // fit's stages before the last minimise a sum of squares instead, which spreads one percentile it cannot meet over all five. A
  // picture whose middle is lighter than the reference's while its ends are the same: no grade value moves only the median, so the
  // best by the reported distance meets the other four and leaves the median off. The sum-of-squares fit alone ended further from
  // the reference than no change at all (bump 0.06: 1.56 before, 2.03 after, verdict 'noticeable').
  it('a match finishes on the distance it reports: a picture with a lighter middle ends nearer than no change', () => {
    const ramp = (seed: number, bump: number, n = 4096): PictureSample => {
      const r = rng(seed), pts: number[][] = [];
      for (let i = 0; i < n; i++) {
        const u = (i + r()) / n, g = 0.08 + 0.84 * u + (u > 0.3 && u < 0.7 ? bump * Math.sin(((u - 0.3) / 0.4) * Math.PI) : 0);
        pts.push([0, 1, 2].map(() => Math.min(1, Math.max(0, g * (1 + (r() - 0.5) * 0.2)))));
      }
      return sampleOf(pts);
    };
    for (const seed of [1, 2]) {
      const reference = pictureStats(ramp(100 + seed, 0)), target = ramp(seed, 0.06);
      const before = statsDistance(pictureStats(target), reference), fit = fitGrade(target, reference, { hold: hold0, amount: 1 });
      expect(fit.residual, `seed ${seed}: before ${before.toFixed(3)}`).toBeLessThanOrEqual(0.9 * before);
      expect(fit.verdict).toBe('close');
      expect(fit.limitedBy).toEqual([]);
    }
  });
  it('holds shadows, highlights and fade at the given values and fits the rest around them', () => {
    const truth: GradeParams = { ...GRADE_DEFAULTS, exposure: 0.3, temperature: 0.4, contrast: 1.1, shadows: 0.5, highlights: -0.3, fade: 0.2 };
    const target = sceneFor(truth, 77), fit = fitGrade(target, pictureStats(gradeSample(target, truth)), { hold: { shadows: 0.5, highlights: -0.3, fade: 0.2 }, amount: 1 });
    expect(fit.params.shadows).toBe(0.5); expect(fit.params.highlights).toBe(-0.3); expect(fit.params.fade).toBe(0.2);
    for (const k of ['exposure', 'temperature', 'tint', 'contrast', 'saturation'] as const) expect(Math.abs(fit.params[k] - truth[k]), k).toBeLessThanOrEqual(0.03);
  });
  it('balance: a cast beyond tint (G × 0.85): limitedBy names tint', () => {
    const neutral = everyday(12), fit = balanceGrade(castOf(neutral, [1, 0.85, 1]), { amount: 1 });
    expect(fit.limitedBy).toContain('tint');
    expect(fit.params.tint).toBe(-1);
  });
  it('a cast out of reach (R/B 2): limitedBy names temperature, every value stays in range, the residual is reported', () => {
    const neutral = everyday(11), cast = castOf(neutral, [Math.SQRT2, 1, Math.SQRT1_2]);
    const fit = fitGrade(cast, pictureStats(neutral), { hold: hold0, amount: 1 });
    expect(fit.limitedBy).toContain('temperature');
    expect(fit.params.temperature).toBe(-1);
    expect(inRange(fit.params)).toBe(true);
    expect(Number.isFinite(fit.residual)).toBe(true);
    expect(fit.residual).toBeGreaterThan(0);
    expect(fit.verdict).toBe(verdictOf(fit.residual));
    // still better than doing nothing
    expect(fit.residual).toBeLessThan(statsDistance(pictureStats(cast), pictureStats(neutral)));
  });
  it('amount blends toward no change: 0 gives the defaults, 0.5 half of each value', () => {
    const truth: GradeParams = { ...GRADE_DEFAULTS, exposure: 0.6, temperature: -0.4, contrast: 1.2 };
    const target = sceneFor(truth, 5), ref = pictureStats(gradeSample(target, truth));
    const full = fitGrade(target, ref, { hold: { shadows: 0.4, highlights: 0, fade: 0.2 }, amount: 1 });
    const none = fitGrade(target, ref, { hold: { shadows: 0.4, highlights: 0, fade: 0.2 }, amount: 0 });
    const half = fitGrade(target, ref, { hold: { shadows: 0.4, highlights: 0, fade: 0.2 }, amount: 0.5 });
    expect(none.params).toEqual({ ...GRADE_DEFAULTS });
    for (const k of KEYS) expect(Math.abs(half.params[k] - (GRADE_DEFAULTS[k] + (full.params[k] - GRADE_DEFAULTS[k]) / 2))).toBeLessThanOrEqual(0.0011);
    expect(half.residual).toBeGreaterThan(full.residual);
    expect(() => fitGrade(target, ref, { hold: hold0, amount: 1.5 })).toThrow(RangeError);
  });
  it('values are rounded to 0.001', () => {
    const s = everyday(9), fit = fitGrade(castOf(s, [1.05, 0.97, 0.9]), pictureStats(s), { hold: hold0, amount: 0.73 });
    for (const k of KEYS) expect(Math.abs(fit.params[k] * 1000 - Math.round(fit.params[k] * 1000))).toBeLessThan(1e-9);
  });
  it('two runs give identical bits', () => {
    const s = everyday(21), target = castOf(s, [1.08, 1, 0.85]);
    const a = fitGrade(target, pictureStats(s), { hold: hold0, amount: 0.8 }), b = fitGrade(target, pictureStats(s), { hold: hold0, amount: 0.8 });
    expect(Object.is(a.residual, b.residual)).toBe(true);
    expect(a).toEqual(b);
    const ba = balanceGrade(target, { amount: 1 }), bb = balanceGrade(target, { amount: 1 });
    expect(new Float64Array([ba.residual, ...KEYS.map((k) => ba.params[k])])).toEqual(new Float64Array([bb.residual, ...KEYS.map((k) => bb.params[k])]));
  });
  it('a fit over 12k samples takes at most 0.5 s', () => {
    const s = mergeSamples([everyday(31), everyday(32), everyday(33)]);
    expect(s.count).toBe(12288);
    const target = castOf(s, [0.9, 1.02, 1.12]), ref = pictureStats(everyday(34));
    fitGrade(target, ref, { hold: hold0, amount: 1 }); // warm-up (JIT)
    const t0 = performance.now();
    fitGrade(target, ref, { hold: hold0, amount: 1 });
    const ms = performance.now() - t0;
    console.log(`fitGrade over ${s.count} samples: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThanOrEqual(500);
  });
});

describe('balanceGrade', { timeout: 60_000 }, () => {
  // In reach: R/B between 1/1.5 and 1.5 (temperature), G between 1/1.1 and 1/0.9 of the rest (tint).
  it('an in-range cast: mid-tone a* and b* end within 1.5 of 0', () => {
    for (const [seed, cast] of [[41, [1.12, 1, 0.86]], [42, [0.88, 1.05, 1.15]], [43, [1.04, 0.96, 1]], [44, [0.95, 1.04, 0.9]], [45, [1.25, 1, 0.9]]] as const) {
      const target = castOf(everyday(seed), cast), fit = balanceGrade(target, { amount: 1 });
      const after = pictureStats(gradeSample(target, fit.params));
      expect(Math.abs(after.meanA), `seed ${seed} a*`).toBeLessThanOrEqual(1.5);
      expect(Math.abs(after.meanB), `seed ${seed} b*`).toBeLessThanOrEqual(1.5);
      expect(inRange(fit.params)).toBe(true);
      expect(fit.limitedBy, `seed ${seed}: the cast is within reach`).toEqual([]);
      expect(fit.params.saturation).toBe(1); expect(fit.params.shadows).toBe(0); expect(fit.params.fade).toBe(0);
    }
  });
  it('the goal stretches toward 5..95 without compressing and moves the median halfway toward 50', () => {
    const g = balanceGoal({ count: 1, lPct: [15, 25, 40, 70, 85], meanA: 3, meanB: -4, meanC: 9, rgbMedian: [0.4, 0.4, 0.4] });
    expect(g.lPct[0]).toBeCloseTo(5, 12); expect(g.lPct[4]).toBeCloseTo(95, 12);
    expect(g.lPct[2]).toBeCloseTo((5 + (40 - 15) * (90 / 70) + 50) / 2, 12);
    expect(g.meanA).toBe(0); expect(g.meanB).toBe(0);
    expect(g.meanC).toBeCloseTo(Math.sqrt(81 - 9 - 16), 12); // the colour around the cast is kept: with no cast, C̄ is the spread
    expect(colourSpread(g)).toBeCloseTo(colourSpread({ meanA: 3, meanB: -4, meanC: 9 }), 12);
    const wide = balanceGoal({ count: 1, lPct: [1, 20, 50, 80, 99], meanA: 0, meanB: 0, meanC: 0, rgbMedian: [0.5, 0.5, 0.5] });
    expect(wide.lPct).toEqual([1, 20, 50, 80, 99]);
  });
  it('a picture whose mid-tones are already neutral keeps its white balance', () => {
    const r = rng(51), s = sampleOf(Array.from({ length: 2048 }, (_, i) => { const g = 0.04 + 0.92 * ((i + r()) / 2048); return [g, g, g]; }));
    const fit = balanceGrade(s, { amount: 1 });
    expect(Math.abs(fit.params.temperature)).toBeLessThan(0.05);
    expect(Math.abs(fit.params.tint)).toBeLessThan(0.05);
  });
});
