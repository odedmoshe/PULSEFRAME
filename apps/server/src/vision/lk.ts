/**
 * Pyramidal Lucas–Kanade (Bouguet's formulation) for one point, plus the structure tensor used to pick trackable points
 * (ADR-0015). Pure and deterministic: + − × / and Math.floor|sqrt|abs only, in a fixed order.
 *
 * Every sample of a window at (x + i, y + j) shares the fractional part of (x, y), so the bilinear weights are worked out once
 * per window and rows are read directly; a window that touches the border is sampled with clamping instead.
 */
import { bilinear, gradients, toLevel, type Level, type Pyramid } from './image.ts';

export interface LkOptions { window: number; levels: number; maxIter: number; epsilon: number }
export interface LkResult { x: number; y: number; ok: boolean }

/** Bilinear samples of `data` (w×h) on the (2·half+1)² grid of unit spacing centred at (x, y), row by row, into `out`. */
export function sampleWindow(data: Float32Array, w: number, h: number, x: number, y: number, half: number, out: Float64Array): void {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 - half >= 0 && y0 - half >= 0 && x0 + half + 1 <= w - 1 && y0 + half + 1 <= h - 1) {
    const fx = x - x0, fy = y - y0;
    let k = 0;
    for (let j = -half; j <= half; j++) {
      let r0 = (y0 + j) * w + x0 - half, r1 = r0 + w;
      for (let i = -half; i <= half; i++, r0++, r1++) {
        const a = data[r0]!, b = data[r0 + 1]!, c = data[r1]!, d = data[r1 + 1]!;
        const top = a + (b - a) * fx, bot = c + (d - c) * fx;
        out[k++] = top + (bot - top) * fy;
      }
    }
    return;
  }
  let k = 0;
  for (let j = -half; j <= half; j++) for (let i = -half; i <= half; i++) out[k++] = bilinear(data, w, h, x + i, y + j);
}

const scratch = new Map<number, { v: Float64Array; gx: Float64Array; gy: Float64Array; j: Float64Array }>();
const buffers = (n: number) => { let b = scratch.get(n); if (!b) scratch.set(n, (b = { v: new Float64Array(n), gx: new Float64Array(n), gy: new Float64Array(n), j: new Float64Array(n) })); return b; };

/** Smallest eigenvalue of the 2×2 structure tensor over a window×window patch centred at (x, y) on a level (gradients per pixel). */
export function minEigen(l: Level, x: number, y: number, window: number): number {
  const { gx, gy } = gradients(l);
  const half = (window - 1) / 2, n = window * window;
  const b = buffers(n);
  sampleWindow(gx, l.width, l.height, x, y, half, b.gx);
  sampleWindow(gy, l.width, l.height, x, y, half, b.gy);
  let a = 0, c2 = 0, c = 0;
  for (let k = 0; k < n; k++) { const ix = b.gx[k]!, iy = b.gy[k]!; a += ix * ix; c2 += ix * iy; c += iy * iy; }
  a /= n; c2 /= n; c /= n;
  const hh = (a - c) / 2;
  return (a + c) / 2 - Math.sqrt(hh * hh + c2 * c2);
}

/**
 * Track (x, y) of `prev` (level-0 pixels) into `next`. The coarsest level starts from `guess` (level-0 pixels, default 0).
 * ok = false when the patch has no usable structure at level 0, a value is not finite, or the result leaves the picture.
 */
export function trackPoint(prev: Pyramid, next: Pyramid, x: number, y: number, o: LkOptions, guess?: { dx: number; dy: number }): LkResult {
  const top = Math.min(o.levels, prev.levels.length, next.levels.length) - 1;
  const half = (o.window - 1) / 2;
  const n = o.window * o.window;
  const { v: iv, gx: ixv, gy: iyv, j: jv } = buffers(n);
  let scale = 1;
  for (let l = 0; l < top; l++) scale *= 2;
  let gxs = guess ? guess.dx / scale : 0, gys = guess ? guess.dy / scale : 0;
  let dx = 0, dy = 0;
  for (let l = top; l >= 0; l--) {
    const I = prev.levels[l]!, J = next.levels[l]!;
    const { gx, gy } = gradients(I);
    const w = I.width, h = I.height;
    const px = toLevel(x, l), py = toLevel(y, l);
    sampleWindow(I.data, w, h, px, py, half, iv);
    sampleWindow(gx, w, h, px, py, half, ixv);
    sampleWindow(gy, w, h, px, py, half, iyv);
    let gxx = 0, gxy = 0, gyy = 0;
    for (let k = 0; k < n; k++) { const ix = ixv[k]!, iy = iyv[k]!; gxx += ix * ix; gxy += ix * iy; gyy += iy * iy; }
    const det = gxx * gyy - gxy * gxy;
    let vx = 0, vy = 0;
    // A flat patch at a coarse level carries no information there: keep the guess and refine below.
    if (det > 1e-6 * n * n) {
      for (let it = 0; it < o.maxIter; it++) {
        sampleWindow(J.data, J.width, J.height, px + gxs + vx, py + gys + vy, half, jv);
        let bx = 0, by = 0;
        for (let k = 0; k < n; k++) { const diff = iv[k]! - jv[k]!; bx += diff * ixv[k]!; by += diff * iyv[k]!; }
        const ex = (gyy * bx - gxy * by) / det, ey = (gxx * by - gxy * bx) / det;
        vx += ex; vy += ey;
        if (!(Math.abs(vx) < 1e6 && Math.abs(vy) < 1e6)) return { x, y, ok: false };
        if (ex * ex + ey * ey < o.epsilon * o.epsilon) break;
      }
    } else if (l === 0) return { x, y, ok: false };
    if (l > 0) { gxs = 2 * (gxs + vx); gys = 2 * (gys + vy); }
    else { dx = gxs + vx; dy = gys + vy; }
  }
  const nx = x + dx, ny = y + dy;
  const l0 = next.levels[0]!;
  const ok = Number.isFinite(nx) && Number.isFinite(ny) && nx >= 0 && ny >= 0 && nx <= l0.width - 1 && ny <= l0.height - 1;
  return { x: nx, y: ny, ok };
}
