/**
 * Colour match «התאמת צבע» and automatic colour balance «איזון צבע אוטומטי» (ADR-0014): a model of the color.grade effect, picture
 * statistics in CIELAB and the fit of grade values. gradePixel is used to fit and to prove, never to render (ADR-0008 decision 2;
 * the digicamTone precedent, gpu.ts): the picture is always drawn by the WGSL pass. Deterministic: no randomness, fixed order.
 *
 * What a match can and cannot do (stated wherever it is offered): it matches STATISTICS of two pictures (lightness percentiles and
 * the mean colour of the mid-tones), not what they show. A red wall or green grass pushes it the wrong way; the user picks the
 * reference, `amount` can be below 1, and the residual is always reported. color.grade has limited reach (white balance R/B
 * 0.67–1.5, no curves): a cast beyond it is reported as `partial`, with the values that hit their limit in `limitedBy`.
 */
import { paramRange } from '@pulseframe/core';

export interface GradeParams { exposure: number; temperature: number; tint: number; contrast: number; saturation: number; shadows: number; highlights: number; fade: number }
/** The color.grade defaults (core effects.ts): no change. */
export const GRADE_DEFAULTS: GradeParams = Object.freeze({ exposure: 0, temperature: 0, tint: 0, contrast: 1, saturation: 1, shadows: 0, highlights: 0, fade: 0 });
const GRADE_KEYS = ['exposure', 'temperature', 'tint', 'contrast', 'saturation', 'shadows', 'highlights', 'fade'] as const satisfies readonly (keyof GradeParams)[];

// ---------------------------------------------------------------------------------------------------------------------------
// The model of the pass
// ---------------------------------------------------------------------------------------------------------------------------

/** The per-frame constants of one parameter set, in the order the shader uses them. */
interface GradeK { gain: number; wr: number; wg: number; wb: number; c: number; s: number; sh: number; hi: number; f: number }
const constantsOf = (p: Readonly<GradeParams>): GradeK => ({
  gain: Math.pow(2, p.exposure), wr: 1 + 0.2 * p.temperature, wg: 1 - 0.1 * p.tint, wb: 1 - 0.2 * p.temperature,
  c: p.contrast, s: p.saturation, sh: p.shadows, hi: p.highlights, f: p.fade,
});
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/**
 * The WGSL body of color.grade (gpu.ts) step for step, on one straight colour; writes out[o..o+2]. The shader runs in f32 and its
 * result is stored in 8 bits, so a still agrees with this to within quantisation (pnpm proof:gpu M1: 2/255).
 */
function gradeInto(r: number, g: number, b: number, k: GradeK, out: Float64Array | number[], o: number): void {
  // c = c * pow(2.0, exposure); c = c * vec3f(1 + 0.2T, 1 - 0.1t, 1 - 0.2T)
  let cr = r * k.gain * k.wr, cg = g * k.gain * k.wg, cb = b * k.gain * k.wb;
  // c = (c - 0.5) * contrast + 0.5
  cr = (cr - 0.5) * k.c + 0.5; cg = (cg - 0.5) * k.c + 0.5; cb = (cb - 0.5) * k.c + 0.5;
  // l = luma(clamp(c, 0, 1)), BT.709 weights (gpu.ts `luma`)
  const l = 0.2126 * clamp01(cr) + 0.7152 * clamp01(cg) + 0.0722 * clamp01(cb);
  // c = mix(vec3f(l), c, saturation)
  cr = l * (1 - k.s) + cr * k.s; cg = l * (1 - k.s) + cg * k.s; cb = l * (1 - k.s) + cb * k.s;
  // c = c + (1 - l)^2 * shadows * (-0.08, 0.02, 0.10) + l^2 * highlights * (0.10, 0.04, -0.08)
  const ws = (1 - l) * (1 - l) * k.sh, wh = l * l * k.hi;
  cr = cr + ws * -0.08 + wh * 0.1; cg = cg + ws * 0.02 + wh * 0.04; cb = cb + ws * 0.1 + wh * -0.08;
  // c = c * (1 - 0.25 fade) + 0.12 fade; clamp
  out[o] = clamp01(cr * (1 - 0.25 * k.f) + 0.12 * k.f);
  out[o + 1] = clamp01(cg * (1 - 0.25 * k.f) + 0.12 * k.f);
  out[o + 2] = clamp01(cb * (1 - 0.25 * k.f) + 0.12 * k.f);
}
/** color.grade on one straight non-linear RGB value 0..1, step for step as gpu.ts (the 'color.grade' WGSL). A proof/fit model only, never rendered. */
export function gradePixel(rgb: readonly [number, number, number], p: Readonly<GradeParams>): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  gradeInto(rgb[0], rgb[1], rgb[2], constantsOf(p), out, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Samples and statistics
// ---------------------------------------------------------------------------------------------------------------------------

/** Straight non-linear RGB 0..1 of `count` picture points, interleaved (rgb.length ≥ 3·count). */
export interface PictureSample { rgb: Float64Array; count: number }
/**
 * At most `maxSamples` points of an RGBA picture (8 bits, straight colour as a decoded PNG holds it) on a fixed grid, one pixel at
 * the centre of each grid cell, row by row (the regular sampling of flashCells, flashAnalysis.ts). Each point is a real pixel, so the
 * model can grade it exactly as the pass would. Fully transparent pixels are left out.
 */
export function samplePicture(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, maxSamples = 4096): PictureSample {
  if (!(width >= 1 && height >= 1) || rgba.length < width * height * 4) throw new RangeError(`samplePicture: ${width}×${height} needs ${width * height * 4} bytes, got ${rgba.length}`);
  const max = Math.max(1, Math.floor(maxSamples));
  const nx = Math.min(width, Math.max(1, Math.floor(Math.sqrt((max * width) / height))));
  const ny = Math.min(height, Math.max(1, Math.floor(max / nx)));
  const rgb = new Float64Array(nx * ny * 3);
  let count = 0;
  for (let j = 0; j < ny; j++) {
    const y = Math.floor(((j + 0.5) * height) / ny);
    for (let i = 0; i < nx; i++) {
      const x = Math.floor(((i + 0.5) * width) / nx), at = (y * width + x) * 4;
      if (rgba[at + 3] === 0) continue;
      rgb[count * 3] = rgba[at]! / 255; rgb[count * 3 + 1] = rgba[at + 1]! / 255; rgb[count * 3 + 2] = rgba[at + 2]! / 255;
      count++;
    }
  }
  return { rgb: rgb.slice(0, count * 3), count };
}
/** The points of several pictures as one sample, in the order given. */
export function mergeSamples(parts: readonly PictureSample[]): PictureSample {
  const count = parts.reduce((s, p) => s + p.count, 0), rgb = new Float64Array(count * 3);
  let at = 0;
  for (const p of parts) { rgb.set(p.rgb.subarray(0, p.count * 3), at); at += p.count * 3; }
  return { rgb, count };
}

export interface PictureStats { count: number; lPct: [number, number, number, number, number]; meanA: number; meanB: number; meanC: number; rgbMedian: [number, number, number] }
/** The percentiles of L* in lPct. */
export const L_PERCENTILES = [0.02, 0.1, 0.5, 0.9, 0.98] as const;
/**
 * Mid-tones, where a*, b* and C* are averaged: 20 ≤ L* ≤ 85 (the colour of very dark and very bright areas is unreliable), with soft
 * edges. A point's weight is 1 from L* 25 to 80 and falls linearly to 0 at 15 and at 90 (½ at 20 and 85), so a flat area whose
 * lightness sits at an edge does not make the means jump when a grade moves it slightly.
 */
export const MID_TONES = { lo: 20, hi: 85, soft: 5 } as const;
const midWeight = (l: number) => Math.min(1, Math.max(0, (l - MID_TONES.lo + MID_TONES.soft) / (2 * MID_TONES.soft))) * Math.min(1, Math.max(0, (MID_TONES.hi + MID_TONES.soft - l) / (2 * MID_TONES.soft)));

// sRGB decoding through a table with linear interpolation (4096 steps: error below 1e-7, far under one 8-bit step), so a fit can
// evaluate many thousands of points per trial. The same function serves pictureStats and the fit, so they agree exactly.
const LIN_STEPS = 4096;
const LIN = Float64Array.from({ length: LIN_STEPS + 2 }, (_, i) => { const v = Math.min(1, i / LIN_STEPS); return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
const linear = (v: number) => { const x = clamp01(v) * LIN_STEPS, i = Math.floor(x), f = x - i; return LIN[i]! + (LIN[i + 1]! - LIN[i]!) * f; };
// CIELAB with the D65 white of sRGB
const XN = 0.95047, ZN = 1.08883, EPS = 216 / 24389, KAPPA = 24389 / 27;
const labF = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);

/** Buckets of the order-statistic selection (L* 0..101). */
const NB = 1024, BUCKET = NB / 101;
/** Work buffers of one measurement, reused across the trials of a fit. */
class Meter {
  readonly L: Float64Array;
  readonly graded = new Float64Array(3);
  private readonly counts = new Int32Array(NB + 1);
  private readonly slot = new Int32Array(NB);
  private readonly cursor = new Int32Array(NB);
  private readonly picked: Float64Array;
  private readonly ranks: number[];
  constructor(readonly n: number) {
    this.L = new Float64Array(n); this.picked = new Float64Array(n);
    // the two ranks around each percentile position q·(n − 1)
    this.ranks = [...new Set(L_PERCENTILES.flatMap((q) => { const i = Math.floor(q * (n - 1)); return [i, Math.min(n - 1, i + 1)]; }))].sort((x, y) => x - y);
  }
  /** L* percentiles into lPct and the mid-tone means; `k` grades each point first (null = as sampled). */
  measure(rgb: Float64Array, k: GradeK | null, lPct: number[]): { a: number; b: number; c: number } {
    const n = this.n, L = this.L, g = this.graded;
    let sa = 0, sb = 0, sc = 0, m = 0, ta = 0, tb = 0, tc = 0;
    for (let i = 0; i < n; i++) {
      let r = rgb[i * 3]!, gg = rgb[i * 3 + 1]!, b = rgb[i * 3 + 2]!;
      if (k) { gradeInto(r, gg, b, k, g, 0); r = g[0]!; gg = g[1]!; b = g[2]!; }
      const R = linear(r), G = linear(gg), B = linear(b);
      const fx = labF((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN);
      const fy = labF(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
      const fz = labF((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / ZN);
      const l = 116 * fy - 16, a = 500 * (fx - fy), bb = 200 * (fy - fz), c = Math.sqrt(a * a + bb * bb);
      L[i] = l;
      ta += a; tb += bb; tc += c;
      const w = midWeight(l);
      if (w > 0) { sa += w * a; sb += w * bb; sc += w * c; m += w; }
    }
    const at = this.orderStats();
    for (let j = 0; j < L_PERCENTILES.length; j++) {
      if (n === 0) { lPct[j] = 0; continue; }
      const x = L_PERCENTILES[j]! * (n - 1), i = Math.floor(x), f = x - i, lo = at.get(i)!;
      lPct[j] = i + 1 < n ? lo + (at.get(i + 1)! - lo) * f : lo;
    }
    // A picture without mid-tones (all dark or all bright): the means of every point, so the numbers stay defined.
    return m > 0 ? { a: sa / m, b: sb / m, c: sc / m } : n > 0 ? { a: ta / n, b: tb / n, c: tc / n } : { a: 0, b: 0, c: 0 };
  }
  /**
   * The values of L at the needed ranks, exactly as a full sort would give them: the values are counted into buckets of L*, and
   * only the buckets that hold a needed rank are sorted (a fit measures hundreds of trials; this is several times faster).
   */
  private orderStats(): Map<number, number> {
    const n = this.n, L = this.L, counts = this.counts, slot = this.slot, cursor = this.cursor, picked = this.picked, out = new Map<number, number>();
    if (n === 0) return out;
    const bucket = (v: number) => { const b = Math.floor(v * BUCKET); return b < 0 ? 0 : b >= NB ? NB - 1 : b; };
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[bucket(L[i]!) + 1]!++;
    for (let b = 0; b < NB; b++) counts[b + 1]! += counts[b]!; // counts[b] = points in buckets below b
    // the buckets holding a needed rank, each with its place in `picked`
    slot.fill(-1);
    const wanted: number[] = [];
    let b = 0, fill = 0;
    for (const r of this.ranks) { while (counts[b + 1]! <= r) b++; if (slot[b] === -1) { slot[b] = fill; fill += counts[b + 1]! - counts[b]!; wanted.push(b); } }
    for (const w of wanted) cursor[w] = slot[w]!;
    for (let i = 0; i < n; i++) { const v = L[i]!, w = bucket(v); if (slot[w]! >= 0) picked[cursor[w]!++] = v; }
    for (const w of wanted) {
      const from = slot[w]!, size = counts[w + 1]! - counts[w]!, part = picked.subarray(from, from + size);
      part.sort();
      for (const r of this.ranks) if (r >= counts[w]! && r < counts[w + 1]!) out.set(r, part[r - counts[w]!]!);
    }
    return out;
  }
}
/** Linear interpolation between the closest ranks (position q·(n−1)) of sorted values. */
function percentileSorted(v: Float64Array, q: number): number {
  if (v.length === 0) return 0;
  const x = q * (v.length - 1), i = Math.floor(x), f = x - i;
  return i + 1 < v.length ? v[i]! + (v[i + 1]! - v[i]!) * f : v[i]!;
}
const medianOf = (s: PictureSample, ch: number) => { const v = new Float64Array(s.count); for (let i = 0; i < s.count; i++) v[i] = s.rgb[i * 3 + ch]!; v.sort(); return percentileSorted(v, 0.5); };

/** CIELAB D65 from linearised sRGB. lPct = L* at 2/10/50/90/98 %; a*, b*, C* means over mid-tones (20 ≤ L* ≤ 85 with soft edges, MID_TONES; every point when there are none). rgbMedian: the median of each stored (non-linear) channel. */
export function pictureStats(s: PictureSample): PictureStats {
  const lPct = [0, 0, 0, 0, 0];
  const m = new Meter(s.count).measure(s.rgb, null, lPct);
  return { count: s.count, lPct: lPct as PictureStats['lPct'], meanA: m.a, meanB: m.b, meanC: m.c, rgbMedian: [medianOf(s, 0), medianOf(s, 1), medianOf(s, 2)] };
}
/**
 * How colourful a picture is around its mean colour: the mid-tone chroma with the cast taken out, sqrt(C̄² − ā² − b̄²) (never
 * negative, since C̄ ≥ |(ā, b̄)|). A cast moves ā, b̄; saturation moves this. Keeping the two apart stops a fit from hiding a cast it
 * cannot remove by draining the colour out of the picture.
 */
export const colourSpread = (s: Pick<PictureStats, 'meanA' | 'meanB' | 'meanC'>) => Math.sqrt(Math.max(0, s.meanC * s.meanC - s.meanA * s.meanA - s.meanB * s.meanB));
/**
 * The residual shown to users, in CIELAB units: the mid-tone colour difference (ΔE76 of the mean a*, b*, together with the
 * difference in colourSpread, so a picture that is as neutral on average but more or less colourful also counts) plus the mean
 * L* percentile error. About 2 is the smallest difference most people notice side by side.
 */
export function statsDistance(a: PictureStats, b: PictureStats): number {
  const da = a.meanA - b.meanA, db = a.meanB - b.meanB, ds = colourSpread(a) - colourSpread(b);
  let dl = 0;
  for (let j = 0; j < 5; j++) dl += Math.abs(a.lPct[j]! - b.lPct[j]!);
  return Math.sqrt(da * da + db * db + ds * ds) + dl / 5;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The fit
// ---------------------------------------------------------------------------------------------------------------------------

/** close: residual ≤ 2, noticeable: ≤ 5, else partial. */
export interface GradeFit { params: GradeParams; residual: number; verdict: 'close' | 'noticeable' | 'partial'; limitedBy: (keyof GradeParams)[] }
export const verdictOf = (residual: number): GradeFit['verdict'] => (residual <= 2 ? 'close' : residual <= 5 ? 'noticeable' : 'partial');

type FitKey = 'exposure' | 'temperature' | 'tint' | 'contrast' | 'saturation';
/** The values a match moves, in its fixed order. */
const FIT_KEYS: readonly FitKey[] = ['exposure', 'temperature', 'tint', 'contrast', 'saturation'];
/** The range of each grade value: the effect's own schema (core effects.ts), so a fitted value is always one set_colour_grade accepts. */
const RANGE: Readonly<Record<keyof GradeParams, { min: number; max: number }>> = Object.fromEntries(GRADE_KEYS.map((k) => {
  const r = paramRange('color.grade', k);
  if (!r) throw new Error(`color.grade has no range for ${k}`);
  return [k, r];
})) as Record<keyof GradeParams, { min: number; max: number }>;
/** Weight of the pull toward the defaults, per ((value − default)/range)²: small, it only settles values the picture cannot decide. */
const PULL = 0.01;
/** Halvings of the search step after the first (¼ of each range). */
const HALVINGS = 8;
/** Halvings of the first, saturation-free stage of the coordinate search: it only has to point temperature and tint the right way. */
const ORIENT_HALVINGS = 4;
/** Sweeps over the values at one step size, at most. */
const MAX_SWEEPS = 6;
/**
 * Forward-difference step of the refinement's Jacobian, per range. Large enough that a point crossing into or out of the mid-tones
 * (which moves ā, b̄ by a step) does not swamp the slope.
 */
const DIFF_STEP = 2e-3;
/** Iterations of the refinement, at most. */
const MAX_REFINE = 40;
/** The search and refinement measure at most this many points (an even stride of the sample); a larger sample then gets FINAL_REFINE iterations on every point. */
const FIT_POINTS = 4096;
const FINAL_REFINE = 3;

/** What a fit aims for: L* percentiles, mid-tone ā, b̄ (weighted by `weightAB`, default 1), and (when `useSpread`) the colourSpread. */
interface Goal { lPct: readonly number[]; a: number; b: number; spread: number; useSpread: boolean; weightAB?: number }
/** Points of the coarse stage (the start grid and the coordinate search), and the exposure and contrast values the start grid tries (every combination). */
const COARSE_POINTS = 512;
const GRID_EXPOSURE = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
const GRID_CONTRAST = [0.4, 0.7, 1, 1.3, 1.6, 2];
const strided = (s: PictureSample, max: number): PictureSample => {
  if (s.count <= max) return s;
  const rgb = new Float64Array(max * 3);
  for (let i = 0; i < max; i++) { const j = Math.floor((i * s.count) / max); rgb[i * 3] = s.rgb[j * 3]!; rgb[i * 3 + 1] = s.rgb[j * 3 + 1]!; rgb[i * 3 + 2] = s.rgb[j * 3 + 2]!; }
  return { rgb, count: max };
};
const round3 = (v: number) => { const r = Math.round(v * 1000) / 1000; return r === 0 ? 0 : r; };
const inRange = (k: keyof GradeParams, v: number) => Math.min(RANGE[k].max, Math.max(RANGE[k].min, v));
const luma709 = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const span = (k: keyof GradeParams) => RANGE[k].max - RANGE[k].min;

/**
 * Solve (A + μ·diag(A)) x = −g for the free values by Gaussian elimination with partial pivoting (n ≤ 5, fixed order). Null when
 * the system is singular.
 */
function dampedStep(A: number[][], g: number[], mu: number): number[] | null {
  const n = g.length, M = A.map((row, i) => [...row.map((v, j) => (i === j ? v + mu * Math.max(v, 1e-12) : v)), -g[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    if (!(Math.abs(M[piv]![c]!) > 1e-300)) return null;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    for (let r = c + 1; r < n; r++) { const f = M[r]![c]! / M[c]![c]!; for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!; }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r]![n]!; for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!; x[r] = s / M[r]![r]!; }
  return x.every(Number.isFinite) ? x : null;
}

function search(target: PictureSample, goal: Goal, keys: readonly FitKey[], start: GradeParams, amount: number): GradeFit {
  if (!(amount >= 0 && amount <= 1)) throw new RangeError(`amount must be within 0..1, got ${amount}`);
  if (target.count === 0) throw new RangeError('the picture has no points to measure');
  const lp = [0, 0, 0, 0, 0], pull = Math.sqrt(PULL), ab = goal.weightAB ?? 1;
  /** The residual vector over a set of points; the loss is its squared length: Σ(ΔL* percentiles)² + Δā² + Δb̄² + Δspread², plus the pull toward the defaults. */
  const residualsOver = (pts: PictureSample) => {
    const meter = new Meter(pts.count);
    return (p: GradeParams): number[] => {
      const m = meter.measure(pts.rgb, constantsOf(p), lp), r = lp.map((l, j) => l - goal.lPct[j]!);
      r.push(ab * (m.a - goal.a), ab * (m.b - goal.b));
      if (goal.useSpread) r.push(colourSpread({ meanA: m.a, meanB: m.b, meanC: m.c }) - goal.spread);
      for (const k of keys) r.push((pull * (p[k] - GRADE_DEFAULTS[k])) / span(k));
      return r;
    };
  };
  const sq = (r: readonly number[]) => r.reduce((s, v) => s + v * v, 0);
  const residuals = residualsOver(strided(target, FIT_POINTS));
  const coarse = residualsOver(strided(target, COARSE_POINTS)), coarseLoss = (p: GradeParams) => sq(coarse(p));

  /** Coordinate search in a fixed order over `over`: each value in turn tries one step up, then one down, keeping a move that lowers the loss; steps start at ¼ of each range and halve. */
  const coordinate = (from: GradeParams, over: readonly FitKey[], measure: (p: GradeParams) => number, halvings = HALVINGS): GradeParams => {
    let p = from, f = measure(p);
    const step = Object.fromEntries(over.map((k) => [k, span(k) / 4])) as Record<FitKey, number>;
    for (let level = 0; level <= halvings; level++) {
      for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
        let moved = false;
        for (const k of over) {
          for (const dir of [1, -1]) {
            const v = inRange(k, p[k] + dir * step[k]);
            if (v === p[k]) continue;
            const q = { ...p, [k]: v }, fq = measure(q);
            if (fq < f) { p = q; f = fq; moved = true; break; }
          }
        }
        if (!moved) break;
      }
      for (const k of over) step[k] /= 2;
    }
    return p;
  };
  /**
   * Damped Gauss–Newton (Levenberg–Marquardt) on the residual vector with a forward-difference Jacobian, values kept in range (a
   * value at an edge whose gradient points outward is held there). The values are coupled (temperature, tint and saturation all
   * move the mean colour), which a search along one value at a time crosses only slowly.
   */
  const refine = (from: GradeParams, residuals: (p: GradeParams) => number[], iterations = MAX_REFINE): { p: GradeParams; f: number } => {
    let p = from, r = residuals(p), f = sq(r), mu = 1e-3;
    for (let it = 0; it < iterations && mu < 1e8; it++) {
      const J = keys.map((k) => { const h = span(k) * DIFF_STEP, up = p[k] + h <= RANGE[k].max, q = { ...p, [k]: up ? p[k] + h : p[k] - h }; const rq = residuals(q); return rq.map((v, i) => (up ? v - r[i]! : r[i]! - v) / h); });
      const g = J.map((col) => col.reduce((s, v, i) => s + v * r[i]!, 0));
      const free = keys.map((k, i) => !((p[k] <= RANGE[k].min && g[i]! > 0) || (p[k] >= RANGE[k].max && g[i]! < 0))).flatMap((ok, i) => (ok ? [i] : []));
      if (free.length === 0) break;
      const A = free.map((i) => free.map((j) => J[i]!.reduce((s, v, n) => s + v * J[j]![n]!, 0)));
      let accepted = false;
      while (!accepted && mu < 1e8) {
        const x = dampedStep(A, free.map((i) => g[i]!), mu);
        if (!x) { mu *= 4; continue; }
        const q = { ...p };
        free.forEach((i, n) => { const k = keys[i]!; q[k] = inRange(k, p[k] + x[n]!); });
        const rq = residuals(q), fq = sq(rq);
        if (fq < f) { const gain = f - fq; p = q; r = rq; f = fq; mu = Math.max(1e-9, mu / 3); accepted = true; if (gain <= 1e-12 * (1 + f)) it = iterations; }
        else mu *= 4;
      }
    }
    return { p, f };
  };

  // Starts: the closed-form estimate, no change at all (both with the held values), and the best of a coarse grid of exposure and
  // contrast around the estimate. Exposure and contrast trade off on a picture with a narrow range of lightness, and saturation near
  // 0 hides which way temperature and tint should go, so a single start can settle in the wrong valley. From each start: the
  // coordinate search on a few points, first without saturation (held at its start), then with every value, and the refinement on
  // the same points. The lowest loss there wins (ties: the earlier start) and is refined on the fit's points.
  const plain = { ...start, ...Object.fromEntries(keys.map((k) => [k, GRADE_DEFAULTS[k]])) } as GradeParams;
  let grid = { ...start }, fg = coarseLoss(grid);
  for (const e of GRID_EXPOSURE) for (const c of GRID_CONTRAST) { const q = { ...start, exposure: e, contrast: c }, fq = coarseLoss(q); if (fq < fg) { grid = q; fg = fq; } }
  const colourFirst = keys.filter((k) => k !== 'saturation');
  let best: { p: GradeParams; f: number } | null = null;
  for (const s0 of [start, plain, grid]) {
    const found = refine(coordinate(coordinate(s0, colourFirst, coarseLoss, ORIENT_HALVINGS), keys, coarseLoss), coarse);
    if (!best || found.f < best.f) best = found;
  }
  let { p, f } = refine(best!.p, residuals);
  // A larger sample: a few more iterations on every point, so the result fits the same points the reference statistics describe
  // (a stride of a picture with large flat areas can sit a little off them).
  let full = residuals;
  if (target.count > FIT_POINTS) { full = residualsOver(target); ({ p, f } = refine(p, full, FINAL_REFINE)); }
  const loss = (q: GradeParams) => sq(full(q));
  // A value at the edge of its range while the loss still falls beyond it: the grade cannot reach the goal (reported as limitedBy).
  const limitedBy: (keyof GradeParams)[] = [];
  for (const k of keys) {
    const edge = p[k] >= RANGE[k].max ? 1 : p[k] <= RANGE[k].min ? -1 : 0;
    if (edge && loss({ ...p, [k]: p[k] + (edge * span(k)) / 100 }) < f) limitedBy.push(k);
  }
  // Blend toward no change by `amount`, then round to 0.001 (inside the range, because both ends are).
  const params = Object.fromEntries(GRADE_KEYS.map((k) => [k, round3(inRange(k, GRADE_DEFAULTS[k] + amount * (p[k] - GRADE_DEFAULTS[k])))])) as unknown as GradeParams;
  const residual = distanceToGoal(pictureStats(gradeSample(target, params)), goal);
  return { params, residual, verdict: verdictOf(residual), limitedBy };
}
/** statsDistance to a goal; without `useSpread` the picture's own colourSpread counts as reached. */
function distanceToGoal(s: PictureStats, g: Goal): number {
  const spread = g.useSpread ? g.spread : colourSpread(s);
  return statsDistance(s, { count: s.count, lPct: g.lPct as PictureStats['lPct'], meanA: g.a, meanB: g.b, meanC: Math.sqrt(spread * spread + g.a * g.a + g.b * g.b), rgbMedian: s.rgbMedian });
}

/** The sample as the grade would leave it (model). */
export function gradeSample(s: PictureSample, p: Readonly<GradeParams>): PictureSample {
  const k = constantsOf(p), rgb = new Float64Array(s.count * 3);
  for (let i = 0; i < s.count; i++) gradeInto(s.rgb[i * 3]!, s.rgb[i * 3 + 1]!, s.rgb[i * 3 + 2]!, k, rgb, i * 3);
  return { rgb, count: s.count };
}

/**
 * The grade that makes `target` (the picture the grade acts on: the clip with its own grade off) look like `reference` (stats of
 * the reference clip as it is shown). Exposure, temperature, tint, contrast and saturation are fitted; shadows, highlights and fade
 * are held at `opts.hold` (the reference grade's, so its tinted shadows and faded blacks carry over). `amount` 0..1 blends the
 * result toward no change. residual: statsDistance of the model's graded target to the reference (at that amount).
 */
export function fitGrade(target: PictureSample, reference: PictureStats, opts: { hold: Pick<GradeParams, 'shadows' | 'highlights' | 'fade'>; amount: number }): GradeFit {
  if (target.count === 0) throw new RangeError('the picture has no points to measure');
  const hold = { shadows: inRange('shadows', opts.hold.shadows), highlights: inRange('highlights', opts.hold.highlights), fade: inRange('fade', opts.hold.fade) };
  // Closed-form start from the channel medians: exposure from the luma ratio, temperature from R/B, tint from G against (R+B)/2.
  const t = [medianOf(target, 0), medianOf(target, 1), medianOf(target, 2)], r = reference.rgbMedian, tiny = 1 / 1024;
  const ratio = (x: number, y: number) => Math.max(tiny, x) / Math.max(tiny, y);
  const q = ratio(r[0], r[2]) / ratio(t[0]!, t[2]!), m = ratio(2 * r[1], r[0] + r[2]) / ratio(2 * t[1]!, t[0]! + t[2]!);
  const start: GradeParams = {
    ...GRADE_DEFAULTS, ...hold,
    exposure: inRange('exposure', Math.log2(ratio(luma709(r), luma709(t)))),
    temperature: inRange('temperature', (5 * (q - 1)) / (q + 1)),
    tint: inRange('tint', 10 * (1 - m)),
  };
  return search(target, { lPct: reference.lPct, a: reference.meanA, b: reference.meanB, spread: colourSpread(reference), useSpread: true }, FIT_KEYS, start, opts.amount);
}

/**
 * What automatic balance aims for, from the picture's own statistics: neutral mid-tones (a* = b* = 0), the L* range p2..p98
 * stretched toward 5..95 (never compressed, and black that is already deep is not lifted; at most twice the contrast), and the
 * median halfway toward 50. Saturation is kept: the goal's meanC is the picture's own colourSpread (with no cast, C̄ is the spread).
 */
export function balanceGoal(s: PictureStats): PictureStats {
  const [p2, p10, p50, p90, p98] = s.lPct, lo = Math.min(p2, 5), hi = Math.max(p98, 95), width = p98 - p2;
  const k = width > 1e-6 ? Math.min(2, (hi - lo) / width) : 1, st = (v: number) => lo + (v - p2) * k;
  const g10 = st(p10), g90 = st(p90);
  const g50 = Math.min(g90, Math.max(g10, (st(p50) + 50) / 2));
  return { count: s.count, lPct: [st(p2), g10, g50, g90, st(p98)], meanA: 0, meanB: 0, meanC: colourSpread(s), rgbMedian: s.rgbMedian };
}
/**
 * Automatic colour balance: no reference. Exposure, temperature, tint and contrast are fitted toward balanceGoal of the picture
 * itself; saturation, shadows, highlights and fade stay at their defaults. residual: distance of the model's result to that goal
 * (the picture's own colourSpread after the grade counts as reached).
 */
/**
 * Weight of the mid-tone ā, b̄ in balance (the lightness goal is only a direction): neutral grey comes first, so tint is not spent on
 * brightness, which it also moves (green carries most of the luma).
 */
const BALANCE_AB_WEIGHT = 3;
export function balanceGrade(target: PictureSample, opts: { amount: number }): GradeFit {
  if (target.count === 0) throw new RangeError('the picture has no points to measure');
  const g = balanceGoal(pictureStats(target));
  return search(target, { lPct: g.lPct, a: 0, b: 0, spread: g.meanC, useSpread: false, weightAB: BALANCE_AB_WEIGHT }, ['exposure', 'temperature', 'tint', 'contrast'], { ...GRADE_DEFAULTS }, opts.amount);
}
