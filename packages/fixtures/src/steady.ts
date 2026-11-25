/**
 * Synthetic shaky videos with an EXACT camera path, for stabilisation (wave 7 stabilise track; .artifacts/wave7/stabilise-decisions.md
 * §4, plan §5). No owner clip is ever used: every picture is made here from an integer-hashed texture of this file's own (copied, not
 * imported: packages/fixtures depends on nothing, and apps/ import fixtures, never the other way round).
 *
 * The world is a still picture in WIDTH UNITS (1 = the fixture's nominal width): a smooth value-noise texture with five ringed discs at
 * known places, rasterised once at one raster pixel per nominal source pixel and read bilinearly, so the world is defined everywhere
 * and the truth is exact to any precision. Frame k shows the world through a camera C_k, a similarity about the picture centre
 * (w = e^L·R(θ)·p + T, p in width units with (0, 0) at the picture centre, y down, θ clockwise): a slow pan plus a band-limited shake
 * (sums of sines between 3 and 9 Hz on x, y, rotation and log-scale, with integer-hashed phases).
 *
 * The truth of frame k is the motion of the static scene from frame k−1 to frame k, in the units of the stored camera motion
 * (core steadyContract.ts): D_k = C_k⁻¹ ∘ C_{k−1} (a scene point at p in frame k−1 is at D_k(p) in frame k). Frame 0 and the frame
 * after a hard cut are `start` (no delta).
 *
 * Variants (decisions §4): F1 plain · F2 a foreground block with its own motion over 25 % of the picture · F3 the block over 65 % ·
 * F4 flat grey with faint per-frame noise · F5 a hard cut at frame 90 to a second world whose mean level is ≥ 40 grey levels lower ·
 * F7 a steady pan with no shake · F8 a portrait picture (720×1280) · F9 another plain world, for a picture-in-picture clip.
 * Default 1280×720 (F8 720×1280), 30 fps, 180 frames. render(k, w, h) draws any frame at any size of the same aspect (a work-size
 * frame samples the same world, so tests can run at 640×360 without FFmpeg). Math.sin/cos/exp only shape the camera path; the
 * truth is computed from the same numbers, so it is exact for the pictures drawn.
 */
import { spawn } from 'node:child_process';

export const STEADY_FIXTURE_VARIANTS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F7', 'F8', 'F9'] as const;
export type SteadyVariant = (typeof STEADY_FIXTURE_VARIANTS)[number];
/** A similarity about the picture centre: p' = e^l·R(r)·p + (tx, ty); r radians clockwise (y down), l = ln(scale), t in width units. */
export interface Similarity { r: number; l: number; tx: number; ty: number }
/** States of the stored camera motion (core steadyContract.ts SST; repeated here because this package imports nothing). */
export const FIXTURE_SST = { unknown: 0, ok: 1, weak: 2, start: 3 } as const;
/** Units of the stored camera motion (core steadyContract.ts STEADY_UNIT, STEADY_ANGLE_UNIT, STEADY_SCALE_UNIT). */
export const FIXTURE_UNITS = { translation: 100_000, angle: 1_000_000, scale: 1_000_000 } as const;

export interface SteadyFixtureOptions { variant: SteadyVariant; frames?: number; fps?: { num: number; den: number }; seed?: number }
export interface SteadyFixture {
  variant: SteadyVariant;
  /** Nominal size in source pixels. */
  width: number; height: number;
  frames: number; fps: { num: number; den: number };
  /** Camera pose per frame: frame point (width units, centred) → world point (width units). */
  camera: Similarity[];
  /** Truth per frame: the scene's motion from frame k−1 to k (identity and `start` at frame 0 and at the cut). */
  truth: Similarity[];
  /** Frames with no delta into them (0, and the cut). */
  starts: number[];
  cutAt: number | null;
  /** F2/F3: the foreground block in frame width units (x0 ≤ x < x1, y0 ≤ y < y1) and its texture's own velocity (source px per frame). */
  block: { x0: number; y0: number; x1: number; y1: number; area: number; velocity: { x: number; y: number } } | null;
  /** The discs' centres in world width units and their radius in width units (world A only). */
  discs: { x: number; y: number }[]; discRadius: number;
  /** Disc i's centre in frame k, in pixels (pixel centres) of a w-wide picture (default the nominal width). Null after a cut. */
  discAt(k: number, i: number, w?: number): { x: number; y: number } | null;
  /** Frame k as 8-bit grey, w×h (default nominal; same aspect). */
  render(k: number, w?: number, h?: number): Uint8Array;
  /** The truth as stored integer columns for frames [from, to): sample 0 and the cut are start. */
  columns(from?: number, to?: number): { from: number; dx: number[]; dy: number[]; dr: number[]; dz: number[]; st: number[] };
}

// ---------- the texture (an integer hash and value noise, as apps/server/src/vision/synthetic.ts draws it, copied) ----------
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
/** About 20…236 grey; cells of 32, 16 and 8 source pixels. */
const texture = (seed: number) => (x: number, y: number): number =>
  128 + 100 * (valueNoise(x, y, 32, seed) - 0.5) + 70 * (valueNoise(x, y, 16, seed + 1) - 0.5) + 50 * (valueNoise(x, y, 8, seed + 2) - 0.5);

// ---------- similarities ----------
export function applySim(s: Similarity, x: number, y: number): { x: number; y: number } {
  const e = Math.exp(s.l), c = Math.cos(s.r) * e, n = Math.sin(s.r) * e;
  return { x: c * x - n * y + s.tx, y: n * x + c * y + s.ty };
}
export function inverseSim(s: Similarity): Similarity {
  const p = applySim({ r: -s.r, l: -s.l, tx: 0, ty: 0 }, s.tx, s.ty);
  return { r: -s.r, l: -s.l, tx: -p.x, ty: -p.y };
}
/** a after b. */
export function composeSim(a: Similarity, b: Similarity): Similarity {
  const p = applySim(a, b.tx, b.ty);
  return { r: a.r + b.r, l: a.l + b.l, tx: p.x, ty: p.y };
}

/** A world raster: one pixel per nominal source pixel; world point (X, Y) in source px sits at raster (X − ox, Y − oy). */
interface Raster { w: number; h: number; ox: number; oy: number; data: Float32Array }
function sample(r: Raster, X: number, Y: number): number {
  let x = X - r.ox, y = Y - r.oy;
  if (x < 0) x = 0; else if (x > r.w - 1) x = r.w - 1;
  if (y < 0) y = 0; else if (y > r.h - 1) y = r.h - 1;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = x0 < r.w - 1 ? x0 + 1 : x0, y1 = y0 < r.h - 1 ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0, d = r.data;
  const a = d[y0 * r.w + x0]!, b = d[y0 * r.w + x1]!, c = d[y1 * r.w + x0]!, e = d[y1 * r.w + x1]!;
  const top = a + (b - a) * fx, bot = c + (e - c) * fx;
  return top + (bot - top) * fy;
}
function raster(x0: number, y0: number, x1: number, y1: number, value: (X: number, Y: number) => number): Raster {
  const ox = Math.floor(x0) - 2, oy = Math.floor(y0) - 2, w = Math.ceil(x1) + 3 - ox, h = Math.ceil(y1) + 3 - oy;
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = value(i + ox, j + oy);
  return { w, h, ox, oy, data };
}
const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Shake per axis: [amplitude, Hz] terms (amplitudes in source px for x and y, radians for r, ln-scale for l). */
const SHAKE = {
  x: [[7, 3.1], [3.5, 5.3], [2, 8.7]],
  y: [[5, 3.4], [2.5, 6.1], [1.5, 8.2]],
  r: [[0.006, 3.7], [0.0025, 6.6]], // 0.34° and 0.14°
  l: [[0.004, 3.3], [0.002, 7.9]],
} as const;

export function steadyFixture(o: SteadyFixtureOptions): SteadyFixture {
  const variant = o.variant;
  const [width, height] = variant === 'F8' ? [720, 1280] : [1280, 720];
  const n = o.frames ?? 180, fps = o.fps ?? { num: 30, den: 1 }, seed = (o.seed ?? 5) + (variant === 'F9' ? 100 : 0);
  const W = width, hh = height / (2 * width);
  const rate = fps.num / fps.den;
  const shake = variant !== 'F7';
  const pan = variant === 'F7' ? { x: 2, y: 0.5 } : { x: 1.2, y: 0.3 }; // source px per frame
  const phase = (axis: number, i: number) => 2 * Math.PI * hash(axis, i, seed + 977);
  const wave = (terms: readonly (readonly [number, number])[], axis: number, k: number) => terms.reduce((s, [a, hz], i) => s + a * Math.sin((2 * Math.PI * hz * k) / rate + phase(axis, i)), 0);
  const camera: Similarity[] = [];
  for (let k = 0; k < n; k++) {
    camera.push({
      tx: (pan.x * k + (shake ? wave(SHAKE.x, 1, k) : 0)) / W,
      ty: (pan.y * k + (shake ? wave(SHAKE.y, 2, k) : 0)) / W,
      r: shake ? wave(SHAKE.r, 3, k) : 0,
      l: shake ? wave(SHAKE.l, 4, k) : 0,
    });
  }
  const cutAt = variant === 'F5' ? Math.min(90, n - 1) : null;
  const starts = cutAt !== null && cutAt > 0 ? [0, cutAt] : [0];
  const truth = camera.map((c, k) => (starts.includes(k) ? { r: 0, l: 0, tx: 0, ty: 0 } : composeSim(inverseSim(c), camera[k - 1]!)));

  // the part of the world any frame shows (source px), plus a margin
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const c of camera) for (const [u, v] of [[-0.5, -hh], [0.5, -hh], [-0.5, hh], [0.5, hh]] as const) {
    const p = applySim(c, u, v);
    bx0 = Math.min(bx0, p.x * W); by0 = Math.min(by0, p.y * W); bx1 = Math.max(bx1, p.x * W); by1 = Math.max(by1, p.y * W);
  }
  bx0 -= 4; by0 -= 4; bx1 += 4; by1 += 4;
  const discRadius = 32 / 1280;
  const discs = [[-0.3, -0.5], [0.3, -0.5], [0, 0], [-0.3, 0.5], [0.3, 0.5]].map(([u, v]) => applySim(camera[0]!, u!, v! * hh));
  const R = discRadius * W;
  const withDiscs = (tex: (X: number, Y: number) => number) => (X: number, Y: number): number => {
    let v = tex(X, Y);
    for (const d of discs) {
      const dx = X - d.x * W, dy = Y - d.y * W, dist = Math.sqrt(dx * dx + dy * dy);
      const a = R + 0.5 - dist;
      if (a <= 0) continue;
      const ring = 128 + 100 * Math.cos((2 * Math.PI * dist) / 16);
      const k = a >= 1 ? 1 : a;
      v = k * ring + (1 - k) * v;
    }
    return v;
  };
  const flat = variant === 'F4';
  const worldA = flat ? null : raster(bx0, by0, bx1, by1, withDiscs(texture(seed)));
  const texB = texture(seed + 50);
  const worldB = cutAt !== null ? raster(bx0, by0, bx1, by1, (X, Y) => 83 + 0.8 * (texB(X, Y) - 128)) : null;

  let block: SteadyFixture['block'] = null, blockTex: Raster | null = null;
  if (variant === 'F2' || variant === 'F3') {
    const [x0, y0, x1, y1] = variant === 'F2' ? [-0.45, -0.02, 0.05, -0.02 + hh] : [-0.403, -0.806 * hh, 0.403, 0.806 * hh];
    const velocity = { x: -18, y: 5 };
    block = { x0, y0, x1, y1, area: ((x1 - x0) * (y1 - y0)) / (2 * hh), velocity };
    // the block shows its texture at frame px (x, y) − velocity·k: allocate what the whole run reads
    const fx0 = (x0 + 0.5) * W, fx1 = (x1 + 0.5) * W, fy0 = (y0 + hh) * W, fy1 = (y1 + hh) * W;
    const t = texture(seed + 200);
    blockTex = raster(Math.min(fx0, fx0 - velocity.x * n), Math.min(fy0, fy0 - velocity.y * n), Math.max(fx1, fx1 - velocity.x * n), Math.max(fy1, fy1 - velocity.y * n), t);
  }

  const render = (k: number, w = width, h = height): Uint8Array => {
    const out = new Uint8Array(w * h);
    const c = camera[k]!, e = Math.exp(c.l), A = Math.cos(c.r) * e, B = Math.sin(c.r) * e;
    const world = cutAt !== null && k >= cutAt ? worldB! : worldA;
    const hw = h / (2 * w);
    for (let j = 0; j < h; j++) {
      const v = (j + 0.5) / w - hw;
      for (let i = 0; i < w; i++) {
        const u = (i + 0.5) / w - 0.5;
        let val: number;
        if (block && u >= block.x0 && u < block.x1 && v >= block.y0 && v < block.y1) {
          val = sample(blockTex!, (u + 0.5) * W - block.velocity.x * k, (v + hh) * W - block.velocity.y * k);
        } else if (!world) {
          val = 120 + 6 * (hash(i, j, k * 7919 + seed) - 0.5); // F4: flat grey, faint noise that changes every frame
        } else {
          val = sample(world, (A * u - B * v + c.tx) * W, (B * u + A * v + c.ty) * W);
        }
        out[j * w + i] = clamp8(val);
      }
    }
    return out;
  };
  const discAt = (k: number, i: number, w = width): { x: number; y: number } | null => {
    if (cutAt !== null && k >= cutAt) return null;
    const p = applySim(inverseSim(camera[k]!), discs[i]!.x, discs[i]!.y);
    return { x: (p.x + 0.5) * w - 0.5, y: (p.y + hh) * w - 0.5 };
  };
  const columns = (from = 0, to = n) => {
    const out = { from, dx: [] as number[], dy: [] as number[], dr: [] as number[], dz: [] as number[], st: [] as number[] };
    for (let k = from; k < to; k++) {
      const start = k === from || starts.includes(k);
      const d = truth[k]!;
      out.dx.push(start ? 0 : Math.round(d.tx * FIXTURE_UNITS.translation));
      out.dy.push(start ? 0 : Math.round(d.ty * FIXTURE_UNITS.translation));
      out.dr.push(start ? 0 : Math.round(d.r * FIXTURE_UNITS.angle));
      out.dz.push(start ? 0 : Math.round(d.l * FIXTURE_UNITS.scale));
      out.st.push(start ? FIXTURE_SST.start : FIXTURE_SST.ok);
    }
    return out;
  };
  return { variant, width, height, frames: n, fps, camera, truth, starts, cutAt, block, discs, discRadius, discAt, render, columns };
}

/**
 * Encode a fixture as H.264 (yuv420p, no sound) with FFmpeg: 2 B-frames, a key frame every second, CRF 12 by default
 * (lossless: true writes x264 at qp 0, still yuv420p). The grey picture is written as it is drawn by render().
 */
export function writeSteadyFixture(fx: SteadyFixture, file: string, o: { width?: number; height?: number; crf?: number; lossless?: boolean } = {}): Promise<{ file: string; frames: number; width: number; height: number }> {
  const w = o.width ?? fx.width, h = o.height ?? fx.height;
  const quality = o.lossless ? ['-qp', '0'] : ['-crf', String(o.crf ?? 12)];
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-video_size', `${w}x${h}`, '-framerate', `${fx.fps.num}/${fx.fps.den}`, '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'veryfast', ...quality, '-bf', '2', '-g', String(Math.round(fx.fps.num / fx.fps.den)), '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ file, frames: fx.frames, width: w, height: h }) : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))));
    p.stdin.on('error', () => {});
    void (async () => {
      for (let k = 0; k < fx.frames; k++) if (!p.stdin.write(fx.render(k, w, h))) await new Promise((r) => p.stdin.once('drain', r));
      p.stdin.end();
    })().catch(reject);
  });
}
