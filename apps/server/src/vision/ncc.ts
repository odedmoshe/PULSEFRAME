/**
 * Normalised cross-correlation (NCC) for the model-free tracker (ADR-0015): patches resampled from a pyramid, the box
 * template the confidence is measured against, and an exhaustive NCC search used to find a lost target again.
 * Deterministic: + − × / and Math.floor|sqrt|abs|round only, fixed order, ties to the lowest (y, x).
 */
import { bilinear, fromLevel, pow2, toLevel, type Plane, type Pyramid } from './image.ts';
import { sampleWindow } from './lk.ts';

/** A zero-mean, unit-length vector of samples (NCC of two such vectors is their dot product). null = flat (no contrast). */
export type Normed = Float64Array | null;

/** `minVariance`: mean squared deviation (grey levels²) below which a patch counts as flat; 0.0625 = a quarter grey level. */
export function normalise(v: Float64Array, minVariance = 0.0625): Normed {
  let mean = 0;
  for (let i = 0; i < v.length; i++) mean += v[i]!;
  mean /= v.length;
  let ss = 0;
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) { const d = v[i]! - mean; out[i] = d; ss += d * d; }
  if (!(ss > 0) || ss < minVariance * v.length) return null;
  const k = 1 / Math.sqrt(ss);
  for (let i = 0; i < v.length; i++) out[i] = out[i]! * k;
  return out;
}
export function dot(a: Normed, b: Normed): number {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** n×n bilinear samples of a plane on a grid of spacing `step`, centred at (cx, cy) (plane pixels). */
export function grid(p: Plane, cx: number, cy: number, n: number, stepX: number, stepY = stepX): Float64Array {
  const out = new Float64Array(n * n);
  if (stepX === 1 && stepY === 1 && n % 2 === 1) { sampleWindow(p.data, p.width, p.height, cx, cy, (n - 1) / 2, out); return out; }
  const o = (n - 1) / 2;
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[k++] = bilinear(p.data, p.width, p.height, cx + (i - o) * stepX, cy + (j - o) * stepY);
  return out;
}

/** NCC of two n×n patches of level 0, one per pyramid (step 1 px). */
export function patchNcc(a: Pyramid, ax: number, ay: number, b: Pyramid, bx: number, by: number, n: number): number {
  return dot(normalise(grid(a.levels[0]!, ax, ay, n, 1)), normalise(grid(b.levels[0]!, bx, by, n, 1)));
}

/** The pyramid level a box of this size is sampled from: the coarsest one on which it still spans at least `min` pixels. */
export function levelFor(pyr: Pyramid, w: number, h: number, min: number, maxLevel = pyr.levels.length - 1): number {
  let l = 0;
  const m = Math.min(w, h);
  while (l + 1 <= Math.min(maxLevel, pyr.levels.length - 1) && m / pow2(l + 1) >= min) l++;
  return l;
}

/**
 * The box (centre cx, cy and size w × h, level-0 pixels) resampled to an n×n grid of grey values. A box is read from the
 * coarsest level on which it is still n pixels wide, so a large box is averaged rather than aliased.
 */
export function boxGrid(pyr: Pyramid, cx: number, cy: number, w: number, h: number, n: number): Float64Array {
  const l = levelFor(pyr, w, h, n);
  const s = pow2(l);
  return grid(pyr.levels[l]!, toLevel(cx, l), toLevel(cy, l), n, w / s / n, h / s / n);
}

const ellipses = new Map<number, Uint32Array>();
/** Indices of an n×n grid that lie inside its inscribed ellipse (the corners of a box are mostly background). */
export function ellipseIndices(n: number): Uint32Array {
  let e = ellipses.get(n);
  if (!e) {
    const idx: number[] = [];
    const o = (n - 1) / 2, r = n / 2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const u = (i - o) / r, v = (j - o) / r; if (u * u + v * v <= 1) idx.push(j * n + i); }
    e = Uint32Array.from(idx);
    ellipses.set(n, e);
  }
  return e;
}
/** The samples of an n×n grid inside its inscribed ellipse, normalised. */
export function ellipseNormal(g: Float64Array, n: number): Normed {
  const idx = ellipseIndices(n);
  const v = new Float64Array(idx.length);
  for (let k = 0; k < idx.length; k++) v[k] = g[idx[k]!]!;
  return normalise(v);
}

/**
 * Resize an n×n grid to tw×th by area averaging (each output cell is the overlap-weighted mean of the grid cells it covers),
 * the same smoothing the box pyramid applies to the picture it is compared with; then normalise.
 */
export function resizeTemplate(t: Float64Array, n: number, tw: number, th: number): Normed {
  const out = new Float64Array(tw * th);
  const fx = n / tw, fy = n / th;
  for (let j = 0; j < th; j++) {
    const y0 = j * fy, y1 = y0 + fy;
    for (let i = 0; i < tw; i++) {
      const x0 = i * fx, x1 = x0 + fx;
      let sum = 0, wsum = 0;
      for (let y = Math.floor(y0); y < y1 && y < n; y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        if (wy <= 0) continue;
        for (let x = Math.floor(x0); x < x1 && x < n; x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          if (wx <= 0) continue;
          sum += wx * wy * t[y * n + x]!; wsum += wx * wy;
        }
      }
      out[j * tw + i] = wsum > 0 ? sum / wsum : 0;
    }
  }
  return normalise(out);
}

/** NCC score map of a normalised tw×th template slid over integer positions of a plane. */
export interface ScoreMap { x0: number; y0: number; w: number; h: number; scores: Float64Array; tw: number; th: number }

/**
 * Slide `t` (normalised, tw×th) over the plane at every integer top-left (x, y) with x0 ≤ x < x0+w, y0 ≤ y < y0+h (clipped to
 * the plane). Local means and energies come from integral images; flat windows score 0.
 */
export function slide(p: Plane, t: Float64Array, tw: number, th: number, cxMin: number, cxMax: number, cyMin: number, cyMax: number): ScoreMap | null {
  const W = p.width, H = p.height, d = p.data;
  // window top-left range whose centre lies within the requested centre range
  const ox = (tw - 1) / 2, oy = (th - 1) / 2;
  const x0 = Math.max(0, Math.floor(cxMin - ox)), x1 = Math.min(W - tw, Math.floor(cxMax - ox) + 1);
  const y0 = Math.max(0, Math.floor(cyMin - oy)), y1 = Math.min(H - th, Math.floor(cyMax - oy) + 1);
  if (x1 < x0 || y1 < y0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  // integral images of the sub-plane that windows touch
  const sw = w + tw - 1, sh = h + th - 1;
  const S = new Float64Array((sw + 1) * (sh + 1)), Q = new Float64Array((sw + 1) * (sh + 1));
  for (let y = 0; y < sh; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < sw; x++) {
      const v = d[(y0 + y) * W + x0 + x]!;
      rs += v; rq += v * v;
      S[(y + 1) * (sw + 1) + x + 1] = S[y * (sw + 1) + x + 1]! + rs;
      Q[(y + 1) * (sw + 1) + x + 1] = Q[y * (sw + 1) + x + 1]! + rq;
    }
  }
  const n = tw * th;
  const scores = new Float64Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = y * (sw + 1) + x, b = a + tw, c = (y + th) * (sw + 1) + x, e = c + tw;
      const sum = S[e]! - S[b]! - S[c]! + S[a]!;
      const sq = Q[e]! - Q[b]! - Q[c]! + Q[a]!;
      const energy = sq - (sum * sum) / n;
      if (energy < 0.0625 * n) { scores[y * w + x] = 0; continue; }
      // Σ t·(v − mean) = Σ t·v because Σ t = 0
      let cross = 0, k = 0;
      for (let j = 0; j < th; j++) {
        const row = (y0 + y + j) * W + x0 + x;
        for (let i = 0; i < tw; i++) cross += t[k++]! * d[row + i]!;
      }
      scores[y * w + x] = cross / Math.sqrt(energy);
    }
  return { x0, y0, w, h, scores, tw, th };
}

/** Centre (plane pixels) of the window at map index i. */
export const centreOf = (m: ScoreMap, i: number): { x: number; y: number } => ({ x: m.x0 + (i % m.w) + (m.tw - 1) / 2, y: m.y0 + Math.floor(i / m.w) + (m.th - 1) / 2 });
export { fromLevel, toLevel };
