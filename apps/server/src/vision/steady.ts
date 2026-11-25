/**
 * The camera-motion kernel of stabilisation (wave 7 stabilise track; .artifacts/wave7/stabilise-decisions.md §2.5, plan §4.1–4.2 as
 * corrected). Model-free: a grid of Lucas–Kanade points (vision/lk.ts) and a robust similarity fit. No AI model, no randomness.
 *
 * Per pair of consecutive grey work frames (TRACK_WORK_HEIGHT high at most):
 * 1. Points. A 16 × 12 grid of cells; in each cell the one of four candidates with the largest smallest-eigenvalue of the structure
 *    tensor (lk.ts minEigen), dropped when it is below `minEigen` (flat: a wall, the sky, noise). Each point is tracked forward and
 *    back (window 15, THREE pyramid levels, as measured for the plan) and kept when the forward-backward error is ≤ 0.5 px.
 *    S = points seeded, V = points kept ("survivors").
 * 2. Consensus. 96 two-point hypotheses, the pairs chosen by an integer hash of (source frame, hypothesis number) (Math.imul, as
 *    vision/synthetic.ts hashes); a hypothesis's support is the number of survivors within 0.75 px. The best one's inliers go into a
 *    closed-form weighted least-squares similarity about the picture centre, then two Tukey reweighting rounds on the median absolute
 *    residual. I = survivors within 0.75 px of that fit.
 * 3. Competing motion. The same search on the survivors the fit does not explain. Two motions compete when the second has at least
 *    24 points AND at least 40 % of the first one's support (the corrected rule: F2's block gives about a third, F3's background about
 *    a half; both ratios are reported by the tests).
 * 4. State (the stored SST codes): unknown when S < 24; ok when I ≥ 40, I/V ≥ 0.5, inliers in at least three picture quadrants and
 *    no competing motion; weak when I ≥ 16; start (a cut) when V/S < 0.25 and the mean absolute difference of the two frames'
 *    64 × 36 thumbnails exceeds `cutGrey`; otherwise unknown. `cutGrey` was set from a measurement on fixture F5 (steady.test.ts
 *    prints it): within a shot of the shaky fixtures the thumbnail difference stays far below it, at F5's cut it is far above.
 * 5. ok and weak frames carry the fitted delta; unknown and start carry zeros. A delta outside the stored ranges is unknown.
 * EVERY threshold here is a heuristic («היוריסטיקה») and is named so in the read view and the job's params.
 *
 * Deterministic: + − × / and Math.floor|sqrt|abs|round|atan2|log in a fixed order; the measurement runs on the server only (the
 * frozen maths that must match in Node and Chromium is core steady.ts, which never sees these functions).
 * The measurement is a generator that yields after every 48 tracked points, so the job can give the event loop back.
 */
import { buildPyramid, type Pyramid } from './image.ts';
import { minEigen, trackPoint, type LkOptions } from './lk.ts';
import type { GreyFrame } from './types.ts';

/** The stored state codes (core steadyContract.ts SST). */
export const KST = { unknown: 0, ok: 1, weak: 2, start: 3 } as const;
export type KernelState = (typeof KST)[keyof typeof KST];

export interface CameraKernelParams {
  gridX: number; gridY: number; levels: number; window: number; maxIter: number; epsilon: number;
  /** Smallest eigenvalue of the structure tensor below which a candidate is flat ((grey/px)², Scharr-normalised). */
  minEigen: number;
  maxFb: number; hypotheses: number; inlierPx: number;
  /** A two-point hypothesis needs its points at least this share of the work width apart. */
  minPairShare: number;
  tukeyRounds: number;
  minSeeded: number; okInliers: number; okRatio: number; okQuadrants: number; weakInliers: number;
  competeMin: number; competeShare: number;
  cutSurvive: number; cutGrey: number;
  /** Points tracked between yields. */
  yieldEvery: number;
}
/** Heuristic thresholds of version STEADY_ALGO = 1 (core steadyContract.ts); a change of any value is a new algo number. */
export const CAMERA_KERNEL_PARAMS: Readonly<CameraKernelParams> = Object.freeze({
  gridX: 16, gridY: 12, levels: 3, window: 15, maxIter: 20, epsilon: 0.01,
  minEigen: 1,
  maxFb: 0.5, hypotheses: 96, inlierPx: 0.75, minPairShare: 0.15, tukeyRounds: 2,
  minSeeded: 24, okInliers: 40, okRatio: 0.5, okQuadrants: 3, weakInliers: 16,
  competeMin: 24, competeShare: 0.4,
  cutSurvive: 0.25, cutGrey: 30,
  yieldEvery: 48,
});

/** A similarity about the picture centre in WORK pixels: p' = e^l·R(r)·p + (tx, ty), r radians clockwise (y down). */
export interface WorkSimilarity { r: number; l: number; tx: number; ty: number }
export interface PairMeasure {
  st: KernelState;
  /** The fitted motion of the scene from the previous frame to this one (identity for unknown and start). */
  sim: WorkSimilarity;
  seeded: number; survivors: number; inliers: number; quadrants: number;
  /** Support of the best hypothesis, and of the best hypothesis among what it does not explain (0 when none). */
  support: number; second: number;
  /** Mean absolute difference of the two 64 × 36 thumbnails (grey levels). */
  thumbDiff: number;
}
/** One stored sample (core steadyContract.ts units): dx, dy in 1/100000 of the width; dr micro-radians; dz ln-scale × 1e6. */
export interface CameraSample { dx: number; dy: number; dr: number; dz: number; st: KernelState }

const IDENTITY: WorkSimilarity = { r: 0, l: 0, tx: 0, ty: 0 };
const LIMITS = { t: 200_000, r: 500_000, z: 300_000 };

/** The stored integers of a measure for a work frame `workWidth` wide. Out-of-range deltas are unknown (never clamped into a lie). */
export function toCameraSample(m: PairMeasure, workWidth: number): CameraSample {
  if (m.st !== KST.ok && m.st !== KST.weak) return { dx: 0, dy: 0, dr: 0, dz: 0, st: m.st };
  const dx = Math.round((m.sim.tx / workWidth) * 100_000), dy = Math.round((m.sim.ty / workWidth) * 100_000);
  const dr = Math.round(m.sim.r * 1_000_000), dz = Math.round(m.sim.l * 1_000_000);
  if (!(Math.abs(dx) <= LIMITS.t && Math.abs(dy) <= LIMITS.t && Math.abs(dr) <= LIMITS.r && Math.abs(dz) <= LIMITS.z)) return { dx: 0, dy: 0, dr: 0, dz: 0, st: KST.unknown };
  return { dx, dy, dr, dz, st: m.st };
}

/** 64 × 36 area means of a grey frame. */
export function thumbnail(f: GreyFrame): Float64Array {
  const TW = 64, TH = 36, out = new Float64Array(TW * TH);
  for (let ty = 0; ty < TH; ty++) {
    const y0 = Math.floor((ty * f.height) / TH), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * f.height) / TH));
    for (let tx = 0; tx < TW; tx++) {
      const x0 = Math.floor((tx * f.width) / TW), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * f.width) / TW));
      let s = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += f.data[y * f.width + x]!;
      out[ty * TW + tx] = s / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}
const meanAbsDiff = (a: Float64Array, b: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return s / a.length; };

/** Integer hash of (frame, hypothesis, salt) → [0, 2³²). */
function mix(frame: number, h: number, salt: number): number {
  let x = (Math.imul(frame | 0, 0x9e3779b1) ^ Math.imul(h | 0, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35)) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Point correspondences, centred on the picture (work px). */
interface Pairs { px: Float64Array; py: Float64Array; qx: Float64Array; qy: Float64Array; n: number }
interface Lin { a: number; b: number; tx: number; ty: number } // x' = a·x − b·y + tx; y' = b·x + a·y + ty
const residual = (m: Lin, P: Pairs, i: number) => { const ex = m.a * P.px[i]! - m.b * P.py[i]! + m.tx - P.qx[i]!, ey = m.b * P.px[i]! + m.a * P.py[i]! + m.ty - P.qy[i]!; return Math.sqrt(ex * ex + ey * ey); };

/** Closed-form weighted least squares of a similarity (null when the weights carry no spread). */
export function fitSimilarity(P: Pairs, w: ArrayLike<number>): Lin | null {
  let sw = 0, mx = 0, my = 0, mqx = 0, mqy = 0;
  for (let i = 0; i < P.n; i++) { const k = w[i]!; if (k <= 0) continue; sw += k; mx += k * P.px[i]!; my += k * P.py[i]!; mqx += k * P.qx[i]!; mqy += k * P.qy[i]!; }
  if (sw <= 0) return null;
  mx /= sw; my /= sw; mqx /= sw; mqy /= sw;
  let den = 0, na = 0, nb = 0;
  for (let i = 0; i < P.n; i++) {
    const k = w[i]!; if (k <= 0) continue;
    const X = P.px[i]! - mx, Y = P.py[i]! - my, X2 = P.qx[i]! - mqx, Y2 = P.qy[i]! - mqy;
    den += k * (X * X + Y * Y); na += k * (X * X2 + Y * Y2); nb += k * (X * Y2 - Y * X2);
  }
  if (!(den > 1e-9)) return null;
  const a = na / den, b = nb / den;
  return { a, b, tx: mqx - (a * mx - b * my), ty: mqy - (b * mx + a * my) };
}

/** The best two-point hypothesis among `use` (indices): its model and support (survivors within inlierPx). */
function consensus(P: Pairs, use: number[], frame: number, salt: number, o: CameraKernelParams, minDist: number): { model: Lin | null; support: number } {
  let best: Lin | null = null, bestSupport = 0;
  const m = use.length;
  if (m < 2) return { model: null, support: 0 };
  const lim2 = o.inlierPx * o.inlierPx, min2 = minDist * minDist;
  for (let h = 0; h < o.hypotheses; h++) {
    const i = use[mix(frame, 2 * h, salt) % m]!, j = use[mix(frame, 2 * h + 1, salt) % m]!;
    const dx = P.px[j]! - P.px[i]!, dy = P.py[j]! - P.py[i]!;
    const d2 = dx * dx + dy * dy;
    if (i === j || d2 < min2) continue;
    const ex = P.qx[j]! - P.qx[i]!, ey = P.qy[j]! - P.qy[i]!;
    // (ex + i·ey) / (dx + i·dy) = a + i·b
    const a = (ex * dx + ey * dy) / d2, b = (ey * dx - ex * dy) / d2;
    const model = { a, b, tx: P.qx[i]! - (a * P.px[i]! - b * P.py[i]!), ty: P.qy[i]! - (b * P.px[i]! + a * P.py[i]!) };
    let s = 0;
    for (const k of use) { const rx = model.a * P.px[k]! - model.b * P.py[k]! + model.tx - P.qx[k]!, ry = model.b * P.px[k]! + model.a * P.py[k]! + model.ty - P.qy[k]!; if (rx * rx + ry * ry <= lim2) s++; }
    if (s > bestSupport) { bestSupport = s; best = model; }
  }
  return { model: best, support: bestSupport };
}

const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2; };

/** Robust fit from the best hypothesis: least squares on its inliers, then Tukey reweighting on the median absolute residual. */
export function robustFit(P: Pairs, frame: number, o: CameraKernelParams = CAMERA_KERNEL_PARAMS, workWidth = 640): { model: Lin | null; support: number; inliers: number[]; second: number } {
  const all = Array.from({ length: P.n }, (_, i) => i);
  const minDist = o.minPairShare * workWidth;
  const first = consensus(P, all, frame, 1, o, minDist);
  if (!first.model) return { model: null, support: 0, inliers: [], second: 0 };
  const set = all.filter((i) => residual(first.model!, P, i) <= o.inlierPx);
  const w = new Float64Array(P.n);
  for (const i of set) w[i] = 1;
  let model = fitSimilarity(P, w) ?? first.model;
  for (let round = 0; round < o.tukeyRounds; round++) {
    const res = set.map((i) => residual(model, P, i));
    const c = Math.max(0.05, 4.685 * 1.4826 * median(res));
    w.fill(0);
    set.forEach((i, k) => { const u = res[k]! / c; if (u < 1) w[i] = (1 - u * u) * (1 - u * u); });
    model = fitSimilarity(P, w) ?? model;
  }
  const inliers = all.filter((i) => residual(model, P, i) <= o.inlierPx);
  const rest = all.filter((i) => residual(model, P, i) > o.inlierPx);
  const second = consensus(P, rest, frame, 2, o, minDist).support;
  return { model, support: first.support, inliers, second };
}

/** Measure the scene's motion between two frames (generator: yields every `yieldEvery` tracked points). */
export function* measurePair(prev: Pyramid, next: Pyramid, prevThumb: Float64Array, nextThumb: Float64Array, frame: number, o: CameraKernelParams = CAMERA_KERNEL_PARAMS): Generator<void, PairMeasure, void> {
  const l0 = prev.levels[0]!, W = l0.width, H = l0.height;
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  const thumbDiff = meanAbsDiff(prevThumb, nextThumb);
  // 1. seed: the best of four candidates per cell
  const seeds: { x: number; y: number }[] = [];
  const cw = W / o.gridX, ch = H / o.gridY;
  for (let gy = 0; gy < o.gridY; gy++)
    for (let gx = 0; gx < o.gridX; gx++) {
      let best = -1, bx = 0, by = 0;
      for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
        const x = Math.floor(gx * cw + fx * cw), y = Math.floor(gy * ch + fy * ch);
        const e = minEigen(l0, x, y, o.window);
        if (e > best) { best = e; bx = x; by = y; }
      }
      if (best >= o.minEigen) seeds.push({ x: bx, y: by });
    }
  // 2. track forward and back
  const lk: LkOptions = { window: o.window, levels: o.levels, maxIter: o.maxIter, epsilon: o.epsilon };
  const P: Pairs = { px: new Float64Array(seeds.length), py: new Float64Array(seeds.length), qx: new Float64Array(seeds.length), qy: new Float64Array(seeds.length), n: 0 };
  for (let k = 0; k < seeds.length; k++) {
    const s = seeds[k]!;
    const f = trackPoint(prev, next, s.x, s.y, lk);
    if (f.ok) {
      const b = trackPoint(next, prev, f.x, f.y, lk);
      if (b.ok && Math.sqrt((b.x - s.x) ** 2 + (b.y - s.y) ** 2) <= o.maxFb) {
        P.px[P.n] = s.x - cx; P.py[P.n] = s.y - cy; P.qx[P.n] = f.x - cx; P.qy[P.n] = f.y - cy; P.n++;
      }
    }
    if ((k + 1) % o.yieldEvery === 0) yield;
  }
  const S = seeds.length, V = P.n;
  const out = (st: KernelState, sim: WorkSimilarity, rest: Partial<PairMeasure> = {}): PairMeasure => ({ st, sim, seeded: S, survivors: V, inliers: 0, quadrants: 0, support: 0, second: 0, thumbDiff, ...rest });
  if (S < o.minSeeded) return out(KST.unknown, IDENTITY);
  // 3. robust fit and the competing motion
  const fit = robustFit(P, frame, o, W);
  const I = fit.inliers.length;
  const quads = new Set<number>();
  const perQuad = [0, 0, 0, 0];
  for (const i of fit.inliers) perQuad[(P.px[i]! >= 0 ? 1 : 0) + (P.py[i]! >= 0 ? 2 : 0)]!++;
  perQuad.forEach((c, q) => { if (c >= 2) quads.add(q); });
  const compete = fit.second >= o.competeMin && fit.second >= o.competeShare * fit.support;
  const sim: WorkSimilarity = fit.model ? { r: Math.atan2(fit.model.b, fit.model.a), l: Math.log(Math.sqrt(fit.model.a * fit.model.a + fit.model.b * fit.model.b)), tx: fit.model.tx, ty: fit.model.ty } : IDENTITY;
  const detail = { inliers: I, quadrants: quads.size, support: fit.support, second: fit.second };
  // 4. state
  if (fit.model && I >= o.okInliers && I / V >= o.okRatio && quads.size >= o.okQuadrants && !compete) return out(KST.ok, sim, detail);
  if (fit.model && I >= o.weakInliers) return out(KST.weak, sim, detail);
  if (V / S < o.cutSurvive && thumbDiff > o.cutGrey) return out(KST.start, IDENTITY, detail);
  return out(KST.unknown, IDENTITY, detail);
}

/** Feeds consecutive work frames; the first frame after create() or reset() is `start`. Keeps two pyramids and reuses their arrays. */
export interface CameraKernel {
  push(frame: GreyFrame, index: number): Generator<void, PairMeasure, void>;
  reset(): void;
}
export function createCameraKernel(params: Partial<CameraKernelParams> = {}): CameraKernel {
  const o: CameraKernelParams = { ...CAMERA_KERNEL_PARAMS, ...params };
  let prev: { pyr: Pyramid; thumb: Float64Array } | null = null, spare: Pyramid | null = null;
  return {
    reset() { if (prev) spare = prev.pyr; prev = null; },
    *push(frame, index) {
      const pyr = buildPyramid(frame, o.levels, spare);
      const thumb = thumbnail(frame);
      spare = null;
      if (!prev) { prev = { pyr, thumb }; return { st: KST.start, sim: IDENTITY, seeded: 0, survivors: 0, inliers: 0, quadrants: 0, support: 0, second: 0, thumbDiff: 0 }; }
      const m = yield* measurePair(prev.pyr, pyr, prev.thumb, thumb, index, o);
      spare = prev.pyr;
      prev = { pyr, thumb };
      return m;
    },
  };
}
/** Drive a kernel generator to its end without yielding (tests, small work). */
export function runSync<T>(g: Generator<void, T, void>): T { for (;;) { const r = g.next(); if (r.done) return r.value; } }
