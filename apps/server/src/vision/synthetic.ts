/**
 * Synthetic grey sequences with exact truth, for testing the tracker (ADR-0015). Textures are smooth value noise (integer
 * hashing, smoothstep interpolation, three octaves), so a sub-pixel move of the texture is a continuous move of the picture
 * and the truth is known to any precision. Frames are rounded to 8 bits as a decoder would deliver them.
 * Deterministic: integer hashing and + − × / only (no trigonometry), so the pinned golden digest does not depend on the
 * platform's maths library.
 */
import type { GreyFrame } from './types.ts';

const hash = (x: number, y: number, seed: number): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell, gy = y / cell;
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const fx = smooth(gx - ix), fy = smooth(gy - iy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}
/** A smooth texture, about 20…236 grey, defined everywhere on the plane; `cells` are the lattice sizes of its three octaves. */
export const texture = (seed: number, cells: readonly [number, number, number] = [32, 16, 8]) => (x: number, y: number): number =>
  128 + 100 * (valueNoise(x, y, cells[0], seed) - 0.5) + 70 * (valueNoise(x, y, cells[1], seed + 1) - 0.5) + 50 * (valueNoise(x, y, cells[2], seed + 2) - 0.5);

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export function frameOf(width: number, height: number, value: (x: number, y: number) => number): GreyFrame {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = clamp8(value(x, y));
  return { width, height, data };
}

/** A pair of frames: the texture, then the same texture moved by (dx, dy) pixels. */
export function shiftedPair(width: number, height: number, dx: number, dy: number, seed = 7): [GreyFrame, GreyFrame] {
  const t = texture(seed);
  return [frameOf(width, height, t), frameOf(width, height, (x, y) => t(x - dx, y - dy))];
}

/** The whole picture zooms about (cx, cy) by `rate` per frame: frame k shows the texture scaled by rate^k. */
export function zoomSequence(width: number, height: number, frames: number, rate: number, cx: number, cy: number, seed = 11): { frames: GreyFrame[]; scale: number[] } {
  const t = texture(seed);
  const out: GreyFrame[] = [], scale: number[] = [];
  let s = 1;
  for (let k = 0; k < frames; k++) {
    const ks = s;
    out.push(frameOf(width, height, (x, y) => t(cx + (x - cx) / ks, cy + (y - cy) / ks)));
    scale.push(ks);
    s *= rate;
  }
  return { frames: out, scale };
}

/**
 * A textured box moving by (vx, vy) per frame over a static textured background, with an independently moving patch over a
 * share of the box (the left `share` of its width) that moves by (ox, oy) per frame: its points are outliers of the box's motion.
 */
export function outlierSequence(width: number, height: number, frames: number, box: { cx: number; cy: number; w: number; h: number }, v: { x: number; y: number }, o: { x: number; y: number }, share: number): { frames: GreyFrame[]; truth: { cx: number; cy: number }[] } {
  const bg = texture(21), fg = texture(22), patch = texture(23);
  const out: GreyFrame[] = [], truth: { cx: number; cy: number }[] = [];
  for (let k = 0; k < frames; k++) {
    const cx = box.cx + v.x * k, cy = box.cy + v.y * k;
    const left = cx - box.w / 2, top = cy - box.h / 2;
    out.push(frameOf(width, height, (x, y) => {
      const u = x - left, w = y - top;
      if (u < 0 || w < 0 || u >= box.w || w >= box.h) return bg(x, y);
      if (u < share * box.w) return patch(x - o.x * k, y - o.y * k);
      return fg(x - cx, y - cy);
    }));
    truth.push({ cx, cy });
  }
  return { frames: out, truth };
}

export interface DiscScene {
  frames: GreyFrame[];
  /** Disc centre per frame (work px, pixel centres). */
  truth: { cx: number; cy: number }[];
  radius: number;
  /** Frames [from, to) during which the disc is hidden. */
  occluded: { from: number; to: number } | null;
  /** Decoy centre per frame, or null when no decoy is shown. */
  decoy: ({ cx: number; cy: number } | null)[];
}
export interface DiscSceneOptions {
  width?: number; height?: number; frames?: number; radius?: number;
  start?: { x: number; y: number }; velocity?: { x: number; y: number }; curve?: { x: number; y: number };
  /** The disc is covered by a static textured block on these frames. */
  occlude?: { from: number; to: number };
  /** An identical disc at a fixed offset from where the target is when it first appears, shown on frames [from, to). */
  decoy?: { from: number; to: number; offset: { x: number; y: number } };
}
/**
 * A finely textured disc (its texture moves with it) on a coarser textured background, along x(k) = start + v·k + curve·k². Optional
 * occluder and identical decoy (same texture, same size). Coverage at the edge is the exact area within half a pixel.
 */
export function discScene(o: DiscSceneOptions = {}): DiscScene {
  const W = o.width ?? 320, H = o.height ?? 240, n = o.frames ?? 60, R = o.radius ?? 18;
  const start = o.start ?? { x: 80, y: 120 }, v = o.velocity ?? { x: 2.3, y: 0.7 }, c = o.curve ?? { x: 0, y: -0.02 };
  const bg = texture(31), disc = texture(32, [12, 6, 3]), block = texture(33);
  const frames: GreyFrame[] = [], truth: { cx: number; cy: number }[] = [], decoy: ({ cx: number; cy: number } | null)[] = [];
  const at = (k: number) => ({ cx: start.x + v.x * k + c.x * k * k, cy: start.y + v.y * k + c.y * k * k });
  const decoyAt = o.decoy ? { cx: at(o.decoy.from).cx + o.decoy.offset.x, cy: at(o.decoy.from).cy + o.decoy.offset.y } : null;
  // the occluder covers the disc's whole path while it is hidden, plus a margin
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  if (o.occlude) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = o.occlude.from; k < o.occlude.to; k++) { const p = at(k); x0 = Math.min(x0, p.cx); y0 = Math.min(y0, p.cy); x1 = Math.max(x1, p.cx); y1 = Math.max(y1, p.cy); }
    box = { x0: x0 - R - 6, y0: y0 - R - 6, x1: x1 + R + 6, y1: y1 + R + 6 };
  }
  const cover = (x: number, y: number, p: { cx: number; cy: number }) => {
    const dx = x - p.cx, dy = y - p.cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const a = R + 0.5 - d;
    return a <= 0 ? 0 : a >= 1 ? 1 : a;
  };
  for (let k = 0; k < n; k++) {
    const p = at(k);
    const showDecoy = decoyAt && o.decoy && k >= o.decoy.from && k < o.decoy.to ? decoyAt : null;
    const hidden = o.occlude && k >= o.occlude.from && k < o.occlude.to;
    frames.push(frameOf(W, H, (x, y) => {
      if (hidden && box && x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) return block(x, y);
      let v0 = bg(x, y);
      if (showDecoy) { const a = cover(x, y, showDecoy); if (a > 0) v0 = a * disc(x - showDecoy.cx, y - showDecoy.cy) + (1 - a) * v0; }
      const a = cover(x, y, p);
      return a > 0 ? a * disc(x - p.cx, y - p.cy) + (1 - a) * v0 : v0;
    }));
    truth.push(p);
    decoy.push(showDecoy);
  }
  return { frames, truth, radius: R, occluded: o.occlude ?? null, decoy };
}
