/**
 * Image building blocks of the model-free tracker (ADR-0015): float planes, a 2×2 box pyramid, Scharr gradients and bilinear
 * sampling. Coordinates are pixel centres: pixel (i, j) of a plane sits at (i, j), so a plane of width W spans [−0.5, W−0.5].
 * Level L+1 of the pyramid averages 2×2 pixels of level L; a level-0 point p sits at (p + 0.5)/2^L − 0.5 on level L.
 * Deterministic: only + − × / and Math.floor|sqrt|abs|round, in a fixed order (vision/types.ts).
 */
import type { GreyFrame } from './types.ts';

export interface Plane { readonly width: number; readonly height: number; readonly data: Float32Array }
/** One pyramid level; its Scharr gradients are computed on first use and kept (into the spare arrays when it has them). */
export interface Level extends Plane { gx: Float32Array | null; gy: Float32Array | null; spareGx?: Float32Array | null; spareGy?: Float32Array | null }
export interface Pyramid { readonly levels: Level[] }

export function planeOf(f: GreyFrame, into?: Float32Array): Plane {
  const data = into && into.length === f.width * f.height ? into : new Float32Array(f.width * f.height);
  for (let i = 0; i < data.length; i++) data[i] = f.data[i]!;
  return { width: f.width, height: f.height, data };
}

/** Next level: each pixel is the mean of a 2×2 block; an odd last row or column is dropped. */
export function downsample(p: Plane, into?: Float32Array): Plane {
  const w = Math.max(1, Math.floor(p.width / 2)), h = Math.max(1, Math.floor(p.height / 2));
  const data = into && into.length === w * h ? into : new Float32Array(w * h);
  const sw = p.width, s = p.data;
  const lastX = p.width - 1, lastY = p.height - 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(2 * y, lastY), y1 = Math.min(2 * y + 1, lastY);
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(2 * x, lastX), x1 = Math.min(2 * x + 1, lastX);
      data[y * w + x] = (s[y0 * sw + x0]! + s[y0 * sw + x1]! + s[y1 * sw + x0]! + s[y1 * sw + x1]!) / 4;
    }
  }
  return { width: w, height: h, data };
}

/**
 * The pyramid of a frame. `reuse` (a pyramid of a frame of the same size that is no longer needed) lends its arrays, so a
 * tracker that keeps two pyramids allocates none per frame; the values are the same either way.
 */
export function buildPyramid(f: GreyFrame, levels: number, reuse?: Pyramid | null): Pyramid {
  const out: Level[] = [];
  const spare = reuse && reuse.levels[0]?.width === f.width && reuse.levels[0]?.height === f.height ? reuse.levels : [];
  let p: Plane = planeOf(f, spare[0]?.data);
  for (let l = 0; l < Math.max(1, levels); l++) {
    out.push({ ...p, gx: null, gy: null, spareGx: spare[l]?.gx ?? spare[l]?.spareGx ?? null, spareGy: spare[l]?.gy ?? spare[l]?.spareGy ?? null });
    if (p.width < 8 || p.height < 8) break; // too small to halve usefully
    p = downsample(p, spare[l + 1]?.data);
  }
  return { levels: out };
}

/** Scharr derivative (intensity per pixel), borders replicated. A ramp of slope 1 gives exactly 1. */
export function gradients(l: Level): { gx: Float32Array; gy: Float32Array } {
  if (l.gx && l.gy) return { gx: l.gx, gy: l.gy };
  const w = l.width, h = l.height, d = l.data;
  const gx = l.spareGx?.length === w * h ? l.spareGx : new Float32Array(w * h), gy = l.spareGy?.length === w * h ? l.spareGy : new Float32Array(w * h);
  l.spareGx = l.spareGy = null;
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
      const a = d[ym * w + xm]!, b = d[ym * w + x]!, c = d[ym * w + xp]!;
      const e = d[y * w + xm]!, f = d[y * w + xp]!;
      const g = d[yp * w + xm]!, k = d[yp * w + x]!, m = d[yp * w + xp]!;
      gx[y * w + x] = (3 * (c - a) + 10 * (f - e) + 3 * (m - g)) / 32;
      gy[y * w + x] = (3 * (g - a) + 10 * (k - b) + 3 * (m - c)) / 32;
    }
  }
  l.gx = gx;
  l.gy = gy;
  return { gx, gy };
}

/** Bilinear sample of `data` (a w×h plane) at (x, y), clamped to the plane. */
export function bilinear(data: Float32Array, w: number, h: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  const cy = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = x0 < w - 1 ? x0 + 1 : x0, y1 = y0 < h - 1 ? y0 + 1 : y0;
  const fx = cx - x0, fy = cy - y0;
  const r0 = y0 * w, r1 = y1 * w;
  const top = data[r0 + x0]! + (data[r0 + x1]! - data[r0 + x0]!) * fx;
  const bot = data[r1 + x0]! + (data[r1 + x1]! - data[r1 + x0]!) * fx;
  return top + (bot - top) * fy;
}

/** Level-0 coordinate → level-L coordinate (box pyramid, pixel centres). */
export const toLevel = (v: number, level: number): number => { let s = 1; for (let i = 0; i < level; i++) s *= 2; return (v + 0.5) / s - 0.5; };
/** Level-L coordinate → level-0 coordinate. */
export const fromLevel = (v: number, level: number): number => { let s = 1; for (let i = 0; i < level; i++) s *= 2; return (v + 0.5) * s - 0.5; };
export const pow2 = (level: number): number => { let s = 1; for (let i = 0; i < level; i++) s *= 2; return s; };

/** Sorted copy, ascending (ties keep their order). */
export const sorted = (v: ArrayLike<number>): number[] => Array.from(v).sort((a, b) => a - b);
/** Median: the mean of the two middle values for an even count. NaN for none. */
export function median(v: ArrayLike<number>): number {
  if (v.length === 0) return NaN;
  const s = sorted(v);
  return (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2;
}
