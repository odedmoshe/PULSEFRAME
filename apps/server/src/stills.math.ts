/**
 * The per-frame numbers of «הפריים הכי חד» (wave 8 cover, core stillsContract.ts "WHAT IS MEASURED"; verify C3/C4). Node only,
 * integer sums in a fixed order (exact in a double), one square root and one rounding per number: the same bytes give the same
 * integers on every run on one machine. A heuristic: it compares frames of one range of one file, nothing else.
 */
import { noiseCorrected, STILLS_HI, STILLS_LO, STILLS_NOISE_KERNEL, type StillMeasure } from '@pulseframe/core';
import { sharpness } from './moments.math.ts';
import type { GreyFrame } from './vision/types.ts';

/** Raw Sobel energy: moments' sharpness() (mean(gx² + gy²) / 16 over the interior, rounded, capped at 65535), reused as it is. */
export const sobelEnergy = (f: GreyFrame): number => sharpness(f);

const SQRT_HALF_PI = Math.sqrt(Math.PI / 2);
/** Σ|I ∗ N| over the interior with Immerkær's kernel N (STILLS_NOISE_KERNEL), an exact integer. */
export function noiseKernelSum(f: GreyFrame): number {
  const W = f.width, H = f.height, p = f.data, k = STILLS_NOISE_KERNEL;
  if (W < 3 || H < 3) return 0;
  let sum = 0;
  for (let y = 1; y < H - 1; y++) {
    const a = (y - 1) * W, b = y * W, c = (y + 1) * W;
    let row = 0;
    for (let x = 1; x < W - 1; x++) {
      const v = k[0] * p[a + x - 1]! + k[1] * p[a + x]! + k[2] * p[a + x + 1]!
        + k[3] * p[b + x - 1]! + k[4] * p[b + x]! + k[5] * p[b + x + 1]!
        + k[6] * p[c + x - 1]! + k[7] * p[c + x]! + k[8] * p[c + x + 1]!;
      row += v < 0 ? -v : v;
    }
    sum += row; // at most 4080 per pixel: exact in a double for any frame this reads
  }
  return sum;
}
/** Immerkær's σ × 100, rounded: σ = √(π/2) · Σ|I∗N| / (6 (W−2)(H−2)). */
export function noiseSigma100(f: GreyFrame): number {
  if (f.width < 3 || f.height < 3) return 0;
  return Math.round((100 * SQRT_HALF_PI * noiseKernelSum(f)) / (6 * (f.width - 2) * (f.height - 2)));
}
/** round(1000 · mean|g_k − g_{k−1}| / 255): permille of full scale. */
export function motionPermille(prev: GreyFrame, cur: GreyFrame): number {
  if (prev.width !== cur.width || prev.height !== cur.height) throw new Error('motionPermille: frames of different sizes');
  const a = prev.data, b = cur.data, n = a.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { const d = a[i]! - b[i]!; sum += d < 0 ? -d : d; }
  return Math.round((1000 * sum) / (255 * n));
}
/** Permille of grey pixels >= STILLS_HI (hi) and <= STILLS_LO (lo). */
export function clippedPermille(f: GreyFrame): { hi: number; lo: number } {
  const p = f.data, n = p.length;
  if (!n) return { hi: 0, lo: 0 };
  let hi = 0, lo = 0;
  for (let i = 0; i < n; i++) { const v = p[i]!; if (v >= STILLS_HI) hi++; else if (v <= STILLS_LO) lo++; }
  return { hi: Math.round((1000 * hi) / n), lo: Math.round((1000 * lo) / n) };
}
/**
 * One frame's record. `prev` is the file's previous frame (frame − 1), or null only for frame 0 of the file: motion is to the
 * previous frame only, so the record does not depend on which range it was read in (C4).
 */
export function measureFrame(frame: number, prev: GreyFrame | null, cur: GreyFrame): StillMeasure {
  if (prev === null && frame !== 0) throw new Error(`measureFrame: frame ${frame} needs the previous frame of the file`);
  const sobel = sobelEnergy(cur), sigma100 = noiseSigma100(cur);
  const { hi, lo } = clippedPermille(cur);
  return { frame, sobel, sigma100, sharp: noiseCorrected(sobel, sigma100), motion: prev ? motionPermille(prev, cur) : null, hi, lo };
}
