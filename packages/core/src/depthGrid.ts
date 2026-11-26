/**
 * The integer depth rasteriser of «תמונה חיה» (wave 8 living; livingContract.ts). The body is W1's; the SIGNATURE is the contract.
 *
 * depthGrid(depth, shown) → the nearness grid at depthGridSize(shown), one byte per cell, row-major, 255 = near. Integer only, so Node
 * and Chromium give the same bytes (golden SHA-256 test in Node; the proof compares the page's digest with Node's):
 * 1. base: ramp → cell (x, y) at row centre yc = (2y + 1)·1000 / (2·height) (integer, rounded half up): 0 above the horizon h,
 *    round(255·(yc − h) / (1000 − h)) below (round half up); flat → 0 everywhere.
 * 2. strokes in order, each as a value + weight layer on the grid: a soft disc of radius size/1000 of the short side, swept along each
 *    segment (one point = a dab); weight DEPTH_WEIGHT_ONE inside half the radius, DEPTH_FALLOFF beyond it, the larger weight where
 *    discs of one stroke overlap; laid over the grid as out = (base·(256 − w) + v·w + 128) >> 8 with v = DEPTH_LAYER_VALUE[layer].
 * 3. NO widen-then-blur: that is reserved for model maps (DEPTH_MODEL_WIDEN_BLUR) and is not built in version 1.
 * Worst case about 24 M integer steps (64 strokes × 4096 points × the largest brush): the media pool caches by depthKey and never
 * runs it per frame (verifier C14 d).
 *
 * depthKey(depth): canonical JSON of the record plus DEPTH_RASTER_V1, prefixed `depth:` so a texture key can never collide with a
 * colour table's (C14 g). LEAD-BUILT (trivial).
 */
import { DEPTH_FALLOFF, DEPTH_LAYER_VALUE, DEPTH_RASTER_V1, DEPTH_WEIGHT_ONE, depthGridSize, type ClipDepth, type DepthGrid } from './livingContract.ts';

/*
 * The body (W1). Every number below is an integer below 2^52, so each `/` followed by Math.floor is exact in IEEE doubles and Node
 * and Chromium give the same bytes. Units: one cell = 1000 units ("milli-cells"), so a point (px, py) in 1/1000 of the shown picture
 * sits at (px·W, py·H) and the centre of cell (i, j) at ((2i + 1)·500, (2j + 1)·500), both integers. A brush radius is size·S
 * units, S = the grid's short side in cells.
 * The soft edge, read from DEPTH_FALLOFF as STEPS: at a distance d from the stroke, weight 256 while d ≤ R/2, 0 once d ≥ R, and in
 * between entry i for the last mark R/2 + i·R/32 that d has reached (i = 0…15), decided without a square root:
 * 32·d ≥ (16 + i)·R  ⟺  1024·d² ≥ (16 + i)²·R².
 * A segment's nearest point to a cell centre: the projection t = ⌊dot·4096 / |AB|²⌋ clamped to [0, 4096], the point
 * A + ⌊(AB·t + 2048) / 4096⌋; then d² is an integer.
 */
/** a / b rounded half up, a ≥ 0, b > 0. */
const divRound = (a: number, b: number): number => Math.floor((2 * a + b) / (2 * b));
const STEP = 4096;
/** The x interval where the row y = cy meets the disc of radius R swept from A to B (the hull of the two end discs' chords and the band's), or null. */
function rowSpan(ax: number, ay: number, bx: number, by: number, cy: number, R: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (const [px, py] of [[ax, ay], [bx, by]] as const) {
    const h = R * R - (cy - py) * (cy - py);
    if (h >= 0) { const s = Math.sqrt(h); lo = Math.min(lo, px - s); hi = Math.max(hi, px + s); }
  }
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  if (L > 0 && dy !== 0) {
    // the band |cross| ≤ R·L along this row, cut to where the projection lies on the segment
    const xc = ax + (dx * (cy - ay)) / dy, half = (R * L) / Math.abs(dy);
    let b0 = xc - half, b1 = xc + half;
    if (dx !== 0) {
      const p0 = ax - (dy * (cy - ay)) / dx, p1 = ax + (L * L - dy * (cy - ay)) / dx; // dot = 0 and dot = L² on this row
      b0 = Math.max(b0, Math.min(p0, p1)); b1 = Math.min(b1, Math.max(p0, p1));
    } else if (!((cy - ay) * dy >= 0 && (cy - ay) * dy <= L * L)) b1 = b0 - 1;
    if (b0 <= b1) { lo = Math.min(lo, b0); hi = Math.max(hi, b1); }
  } else if (L > 0 && Math.abs(cy - ay) <= R) { lo = Math.min(lo, Math.min(ax, bx)); hi = Math.max(hi, Math.max(ax, bx)); }
  return lo <= hi ? [lo, hi] : null;
}

export function depthGrid(depth: ClipDepth, shown: { width: number; height: number }): DepthGrid {
  const { width: W, height: H } = depthGridSize(shown);
  const S = Math.min(W, H);
  const data = new Uint8Array(W * H);
  // 1. the base
  if (depth.base.kind === 'ramp') {
    const h = depth.base.horizon, span = 1000 - h;
    for (let y = 0; y < H; y++) {
      const yc = divRound((2 * y + 1) * 1000, 2 * H);
      const v = yc <= h ? 0 : Math.min(255, divRound(255 * (yc - h), span));
      if (v) data.fill(v, y * W, (y + 1) * W);
    }
  }
  // 2. the strokes, in order, each as its own weight layer (the larger weight where its discs overlap), then laid over
  const weight = new Uint16Array(W * H);
  for (const stroke of depth.strokes) {
    const R = stroke.size * S, R2 = R * R;
    const marks = DEPTH_FALLOFF.slice(0, 16).map((_, i) => (16 + i) * (16 + i) * R2);
    const v = DEPTH_LAYER_VALUE[stroke.layer];
    let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
    const n = stroke.pts.length >> 1;
    for (let k = 0; k < Math.max(1, n - 1); k++) {
      const a = Math.min(k, n - 1), b = Math.min(k + 1, n - 1);
      const ax = stroke.pts[2 * a]! * W, ay = stroke.pts[2 * a + 1]! * H, ex = stroke.pts[2 * b]! * W, ey = stroke.pts[2 * b + 1]! * H;
      const abx = ex - ax, aby = ey - ay, L2 = abx * abx + aby * aby;
      const i0 = Math.max(0, Math.floor((Math.min(ax, ex) - R - 500) / 1000)), i1 = Math.min(W - 1, Math.floor((Math.max(ax, ex) + R - 500) / 1000) + 1);
      const j0 = Math.max(0, Math.floor((Math.min(ay, ey) - R - 500) / 1000)), j1 = Math.min(H - 1, Math.floor((Math.max(ay, ey) + R - 500) / 1000) + 1);
      if (i0 > i1 || j0 > j1) continue;
      bx0 = Math.min(bx0, i0); bx1 = Math.max(bx1, i1); by0 = Math.min(by0, j0); by1 = Math.max(by1, j1);
      for (let j = j0; j <= j1; j++) {
        const cy = (2 * j + 1) * 500, py = cy - ay, row = j * W;
        // Which cells of this row can be within R: the row's cut through the swept disc (convex, so one interval), found in
        // floating point and widened by two cells. It only bounds the loop; every cell inside is still decided by the integer test,
        // and a cell outside the true cut has weight 0, so the bytes do not depend on this rounding.
        const span = rowSpan(ax, ay, ex, ey, cy, R);
        if (!span) continue;
        const r0 = Math.max(i0, Math.floor((span[0] - 500) / 1000) - 2), r1 = Math.min(i1, Math.ceil((span[1] - 500) / 1000) + 2);
        for (let i = r0; i <= r1; i++) {
          if (weight[row + i] === DEPTH_WEIGHT_ONE) continue; // already full: another disc of this stroke cannot raise it
          const px = (2 * i + 1) * 500 - ax;
          let dx = px, dy = py;
          if (L2 > 0) {
            const dot = px * abx + py * aby;
            if (dot >= L2) { dx = px - abx; dy = py - aby; }
            else if (dot > 0) {
              const t = Math.floor((dot * STEP) / L2);
              dx = px - Math.floor((abx * t + STEP / 2) / STEP);
              dy = py - Math.floor((aby * t + STEP / 2) / STEP);
            }
          }
          const d2 = dx * dx + dy * dy;
          if (d2 >= R2) continue;
          let w: number;
          if (4 * d2 <= R2) w = DEPTH_WEIGHT_ONE;
          else {
            const m = 1024 * d2;
            let s = 0;
            while (s < 15 && m >= marks[s + 1]!) s++;
            w = DEPTH_FALLOFF[s]!;
          }
          if (w > weight[row + i]!) weight[row + i] = w;
        }
      }
    }
    for (let j = by0; j <= by1; j++) for (let i = bx0, at = j * W + bx0; i <= bx1; i++, at++) {
      const w = weight[at]!;
      if (!w) continue;
      data[at] = (data[at]! * (DEPTH_WEIGHT_ONE - w) + v * w + 128) >> 8;
      weight[at] = 0;
    }
  }
  return { width: W, height: H, data };
}

const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);
/** The identity of a drawn depth's grid (the shown aspect is the asset's, covered by its content hash). */
export const depthKey = (depth: ClipDepth): string => `depth:r${DEPTH_RASTER_V1}:${canonical(depth)}`;
