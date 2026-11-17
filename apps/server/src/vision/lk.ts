/**
 * Pyramidal Lucas–Kanade (Bouguet's formulation) for one point, plus the structure tensor used to pick trackable points
 * (ADR-0015). Pure and deterministic: + − × / and Math.floor|sqrt|abs only, in a fixed order.
 */
import { bilinear, gradients, toLevel, type Level, type Pyramid } from './image.ts';

export interface LkOptions { window: number; levels: number; maxIter: number; epsilon: number }
export interface LkResult { x: number; y: number; ok: boolean }

/** Smallest eigenvalue of the 2×2 structure tensor over a window×window patch centred at (x, y) on a level (gradients per pixel). */
export function minEigen(l: Level, x: number, y: number, window: number): number {
  const { gx, gy } = gradients(l);
  const half = (window - 1) / 2;
  let a = 0, b = 0, c = 0;
  for (let j = -half; j <= half; j++)
    for (let i = -half; i <= half; i++) {
      const ix = bilinear(gx, l.width, l.height, x + i, y + j), iy = bilinear(gy, l.width, l.height, x + i, y + j);
      a += ix * ix; b += ix * iy; c += iy * iy;
    }
  const n = window * window;
  a /= n; b /= n; c /= n;
  const h = (a - c) / 2;
  return (a + c) / 2 - Math.sqrt(h * h + b * b);
}

/**
 * Track (x, y) of `prev` (level-0 pixels) into `next`. The coarsest level starts from `guess` (level-0 pixels, default 0).
 * ok = false when the patch has no usable structure at level 0, a value is not finite, or the result leaves the picture.
 */
export function trackPoint(prev: Pyramid, next: Pyramid, x: number, y: number, o: LkOptions, guess?: { dx: number; dy: number }): LkResult {
  const top = Math.min(o.levels, prev.levels.length, next.levels.length) - 1;
  const half = (o.window - 1) / 2;
  const n = o.window * o.window;
  const iv = new Float64Array(n), ixv = new Float64Array(n), iyv = new Float64Array(n);
  let scale = 1;
  for (let l = 0; l < top; l++) scale *= 2;
  let gxs = guess ? guess.dx / scale : 0, gys = guess ? guess.dy / scale : 0;
  let dx = 0, dy = 0;
  for (let l = top; l >= 0; l--) {
    const I = prev.levels[l]!, J = next.levels[l]!;
    const { gx, gy } = gradients(I);
    const w = I.width, h = I.height;
    const px = toLevel(x, l), py = toLevel(y, l);
    let gxx = 0, gxy = 0, gyy = 0, k = 0;
    for (let j = -half; j <= half; j++)
      for (let i = -half; i <= half; i++) {
        const sx = px + i, sy = py + j;
        const v = bilinear(I.data, w, h, sx, sy), ix = bilinear(gx, w, h, sx, sy), iy = bilinear(gy, w, h, sx, sy);
        iv[k] = v; ixv[k] = ix; iyv[k] = iy; k++;
        gxx += ix * ix; gxy += ix * iy; gyy += iy * iy;
      }
    const det = gxx * gyy - gxy * gxy;
    let vx = 0, vy = 0;
    // A flat patch at a coarse level carries no information there: keep the guess and refine below.
    if (det > 1e-6 * n * n) {
      const jw = J.width, jh = J.height, jd = J.data;
      for (let it = 0; it < o.maxIter; it++) {
        let bx = 0, by = 0;
        k = 0;
        const ox = px + gxs + vx, oy = py + gys + vy;
        for (let j = -half; j <= half; j++)
          for (let i = -half; i <= half; i++) {
            const diff = iv[k]! - bilinear(jd, jw, jh, ox + i, oy + j);
            bx += diff * ixv[k]!; by += diff * iyv[k]!; k++;
          }
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
