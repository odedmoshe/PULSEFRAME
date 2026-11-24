/**
 * Canvas2D transitions (ADR-0012 kernel dispatch). A transition id is drawn by the kernel its registry row names
 * (packages/core effects.ts TRANSITIONS[].kernel), looked up here: CANVAS_TRANSITIONS gives each non-GPU id its kernel and
 * the numbers that set its variant (a direction, a shape), CANVAS_KERNELS the code. Nothing is chosen by the id's prefix,
 * so an id without a kernel cannot silently become a cut: a test pins that every non-GPU id has one.
 *
 * Every kernel draws inside compositeLayer's save/restore, with the layer's blend mode already set on `ctx`. It may use
 * scratch slot 6 (as dissolve does) and slot 13 (reserved for the trend-pack kernels, wave3 decisions); no other slot.
 * One implementation for preview, stills and export (ADR-0005).
 */
import { switchFrame, transitionDef, transitionProgress } from '@pulseframe/core';
import type { LayerLook } from './evaluate.ts';
import { hash32, unit32 } from './gpu.ts';
import { fadeBuf, scratch, type Buf } from './look.ts';

export interface CanvasTransitionArgs {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  /** The incoming clip's finished layer. */
  incoming: Buf;
  /** The outgoing clip's finished layer, or null when there is no previous clip (the transition reveals over the layers below). */
  outgoing: Buf | null;
  /** The transition state of this frame (progress already eased; options with the registry defaults filled in). */
  t: NonNullable<LayerLook['transition']>;
  /** The variant numbers of the id (CANVAS_TRANSITIONS[id].v). */
  v: readonly [number, number, number];
  W: number;
  H: number;
}
export type CanvasKernel = (a: CanvasTransitionArgs) => void;

/** Scratch slot of the trend-pack Canvas2D kernels (wave3 decisions: 13 is theirs alone). */
export const CANVAS_TRANSITION_SLOT = 13;

/** Non-GPU transition id -> kernel and variant numbers. dip: v0 = 1 for white; wipe and push: v = the direction (x, y). */
export const CANVAS_TRANSITIONS: Record<string, { kernel: string; v: [number, number, number] }> = {
  dissolve: { kernel: 'dissolve', v: [0, 0, 0] },
  'dip-black': { kernel: 'dip', v: [0, 0, 0] }, 'dip-white': { kernel: 'dip', v: [1, 0, 0] },
  'wipe-left': { kernel: 'wipe', v: [-1, 0, 0] }, 'wipe-right': { kernel: 'wipe', v: [1, 0, 0] }, 'wipe-up': { kernel: 'wipe', v: [0, -1, 0] }, 'wipe-down': { kernel: 'wipe', v: [0, 1, 0] },
  'push-left': { kernel: 'push', v: [-1, 0, 0] }, 'push-right': { kernel: 'push', v: [1, 0, 0] }, 'push-up': { kernel: 'push', v: [0, -1, 0] }, 'push-down': { kernel: 'push', v: [0, 1, 0] },
  zoom: { kernel: 'zoom', v: [0, 0, 0] },
  // trend pack (ADR-0012)
  'punch-in': { kernel: 'punch', v: [1, 0, 0] }, 'punch-out': { kernel: 'punch', v: [-1, 0, 0] },
  'blur-dissolve': { kernel: 'blur', v: [0, 0, 0] },
  'split-open-h': { kernel: 'split', v: [0, 0, 0] }, 'split-open-v': { kernel: 'split', v: [1, 0, 0] },
  'shape-heart': { kernel: 'shape', v: [0, 0, 0] }, 'shape-star': { kernel: 'shape', v: [1, 0, 0] },
  'block-left': { kernel: 'block', v: [-1, 0, 0] }, 'block-right': { kernel: 'block', v: [1, 0, 0] },
  'slices-h': { kernel: 'slices', v: [0, 0, 0] }, 'slices-v': { kernel: 'slices', v: [1, 0, 0] },
};

// ---- the five kernels from before ADR-0012, moved verbatim from look.ts compositeLayer ----

/**
 * Cross-fade: out*(1-p) + in*p, mixed additively in a buffer so two opaque pictures never dip toward the background.
 * `zoomed`: the incoming picture settles from 1.3×.
 *
 * The plain dissolve puts each weight into its picture's own alpha (fadeBuf: the outgoing copy in the mix buffer, the incoming
 * layer's finished buffer in place, which nothing reads after this kernel) and adds the two at full alpha. Drawn with globalAlpha
 * instead, Chromium's software canvas truncates: through stills over all 256×256 byte pairs at 20 progress values, the
 * dissolve between two clips had 1604 bytes 2 off the exact mix at the nearest 8-bit alpha, and the dissolve that reveals a
 * clip over the tracks below was on average half a level low with 38096 bytes 2 off; with the weights in the alpha every byte
 * is within 1 (conformance:opacity check 4). The zoom keeps its globalAlpha draws: its incoming picture is resampled anyway.
 */
function crossfade({ ctx, incoming: layer, outgoing, t, W, H }: CanvasTransitionArgs, zoomed: boolean) {
  const p = t.progress;
  const mix = scratch(6, W, H);
  if (!zoomed) {
    // One 8-bit level k for both weights, so the two alphas add up to exactly 255: at p = 0.5, 1 − p and p would both round
    // to 128, and a pixel that is the same in both pictures would come out one level high.
    const k = Math.round(255 * p);
    if (outgoing) {
      mix.ctx.drawImage(outgoing.canvas, 0, 0);
      if (k > 0) fadeBuf(mix, (255 - k) / 255, W, H);
      mix.ctx.globalCompositeOperation = 'lighter';
    }
    if (k < 255) fadeBuf(layer, k / 255, W, H);
    mix.ctx.drawImage(layer.canvas, 0, 0);
    ctx.drawImage(mix.canvas, 0, 0);
    return;
  }
  if (outgoing) { mix.ctx.globalAlpha = 1 - p; mix.ctx.drawImage(outgoing.canvas, 0, 0); mix.ctx.globalCompositeOperation = 'lighter'; }
  mix.ctx.globalAlpha = p;
  const s = 1.3 - 0.3 * p; mix.ctx.translate(W / 2, H / 2); mix.ctx.scale(s, s); mix.ctx.translate(-W / 2, -H / 2);
  mix.ctx.drawImage(layer.canvas, 0, 0);
  ctx.drawImage(mix.canvas, 0, 0);
}
const dip: CanvasKernel = ({ ctx, incoming: layer, outgoing, t, v, W, H }) => {
  const p = t.progress;
  const first = p < 0.5;
  const shown = first ? outgoing : layer;
  if (shown) ctx.drawImage(shown.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = first ? p * 2 : (1 - p) * 2;
  ctx.fillStyle = v[0] === 1 ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, W, H);
};
const wipe: CanvasKernel = ({ ctx, incoming: layer, outgoing, t, v, W, H }) => {
  const p = t.progress;
  if (outgoing) ctx.drawImage(outgoing.canvas, 0, 0);
  const [dx, dy] = v;
  ctx.beginPath();
  // The reveal edge travels in the named direction: "wipe-left" starts at the right edge and moves left.
  if (dx !== 0) ctx.rect(dx < 0 ? W * (1 - p) : 0, 0, W * p, H);
  else ctx.rect(0, dy < 0 ? H * (1 - p) : 0, W, H * p);
  ctx.clip();
  ctx.drawImage(layer.canvas, 0, 0);
};
const push: CanvasKernel = ({ ctx, incoming: layer, outgoing, t, v, W, H }) => {
  const p = t.progress;
  const [dx, dy] = v;
  if (outgoing) ctx.drawImage(outgoing.canvas, dx * W * p, dy * H * p);
  ctx.drawImage(layer.canvas, -dx * W * (1 - p), -dy * H * (1 - p));
};


// ---- the trend-pack kernels (ADR-0012). Each mixes its picture in slot 6, as dissolve does, and draws it once onto the frame;
// slot 13 (CANVAS_TRANSITION_SLOT) is its only other scratch. Every helper that sets their geometry is pure and exported, so
// the unit tests and the proofs check the same numbers the kernels draw with. ----

type C2D = OffscreenCanvasRenderingContext2D;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Draws `src` scaled by s about the frame centre. */
function drawScaled(dst: C2D, src: OffscreenCanvas, s: number, W: number, H: number) {
  dst.setTransform(s, 0, 0, s, (W / 2) * (1 - s), (H / 2) * (1 - s));
  dst.drawImage(src, 0, 0);
  dst.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Zoom punch: the outgoing picture punches in (v0 = +1) or out (v0 = −1) up to the switch, and the incoming one settles back
 * from the opposite overshoot, with a short radial smear. u rises to 1 at the switch and falls back to 0.
 */
export function punchScale(p: number, dir: number): number {
  const first = p < 0.5, u = first ? 2 * p : 2 * (1 - p);
  return dir > 0 ? 1 + (first ? 0.18 : 0.22) * u ** 3 : 1 - (first ? 0.15 : 0.18) * u ** 3;
}
const punch: CanvasKernel = ({ ctx, incoming, outgoing, t, v, W, H }) => {
  const p = t.progress, first = p < 0.5, u = first ? 2 * p : 2 * (1 - p), dir = v[0] < 0 ? -1 : 1;
  const side = first ? outgoing : incoming;
  if (!side) return; // no previous clip: the layers below show until the switch
  const s = punchScale(p, dir);
  // the smear: four quarter-strength copies at slightly growing (in) or shrinking (out) scales, added up
  const smear = scratch(CANVAS_TRANSITION_SLOT, W, H);
  smear.ctx.globalCompositeOperation = 'lighter';
  smear.ctx.globalAlpha = 0.25;
  for (let j = 0; j < 4; j++) drawScaled(smear.ctx, side.canvas, s * (1 + 0.025 * j * u * u * dir), W, H);
  const mix = scratch(6, W, H);
  if (dir < 0) {
    // a picture smaller than the frame: the same side blurred at full size behind it, so the layers below never show through
    // (the sharp copy under the blurred one fills the blur's transparent fringe at the frame's edges)
    const r = 0.02 * H * u;
    if (r >= 0.5) { mix.ctx.filter = `blur(${r.toFixed(3)}px)`; mix.ctx.drawImage(side.canvas, 0, 0); mix.ctx.filter = 'none'; mix.ctx.globalCompositeOperation = 'destination-over'; }
    mix.ctx.drawImage(side.canvas, 0, 0);
    mix.ctx.globalCompositeOperation = 'source-over';
  }
  mix.ctx.drawImage(smear.canvas, 0, 0);
  ctx.drawImage(mix.canvas, 0, 0);
};

/** Blur radius of the blur dissolve in pixels: 3% of the height at the middle, none at the ends. */
export const blurRadius = (p: number, H: number) => 0.03 * H * Math.sin(Math.PI * p);
const blurDissolve: CanvasKernel = ({ ctx, incoming, outgoing, t, W, H }) => {
  const p = t.progress, r = blurRadius(p, H);
  /** The side sharp, then blurred over it (the sharp copy fills the blur's transparent fringe at the frame's edges). */
  const soft = (src: Buf) => {
    const b = scratch(CANVAS_TRANSITION_SLOT, W, H);
    b.ctx.drawImage(src.canvas, 0, 0);
    if (r >= 0.5) { b.ctx.filter = `blur(${r.toFixed(3)}px)`; b.ctx.drawImage(src.canvas, 0, 0); b.ctx.filter = 'none'; }
    return b;
  };
  const mix = scratch(6, W, H);
  if (outgoing) { mix.ctx.globalAlpha = 1 - p; mix.ctx.drawImage(soft(outgoing).canvas, 0, 0); mix.ctx.globalCompositeOperation = 'lighter'; }
  mix.ctx.globalAlpha = p;
  mix.ctx.drawImage(soft(incoming).canvas, 0, 0);
  ctx.drawImage(mix.canvas, 0, 0);
};

/**
 * Split open: the outgoing picture parts in two halves (left/right for v0 = 0, top/bottom for v0 = 1), each sliding out by
 * half the frame times p, over the incoming picture settling from 1.08×. With no previous clip, only the opening between the
 * halves shows the incoming picture over the layers below.
 */
const split: CanvasKernel = ({ ctx, incoming, outgoing, t, v, W, H }) => {
  const p = t.progress, vertical = v[0] === 1;
  const span = vertical ? H : W, half = Math.round(span / 2), shift = (span / 2) * p;
  const mix = scratch(6, W, H), m = mix.ctx;
  if (!outgoing) {
    m.save();
    m.beginPath();
    if (vertical) m.rect(0, half - shift, W, 2 * shift); else m.rect(half - shift, 0, 2 * shift, H);
    m.clip();
  }
  drawScaled(m, incoming.canvas, 1.08 - 0.08 * p, W, H);
  if (!outgoing) m.restore();
  else if (vertical) {
    m.drawImage(outgoing.canvas, 0, 0, W, half, 0, -shift, W, half);
    m.drawImage(outgoing.canvas, 0, half, W, H - half, 0, half + shift, W, H - half);
  } else {
    m.drawImage(outgoing.canvas, 0, 0, half, H, -shift, 0, half, H);
    m.drawImage(outgoing.canvas, half, 0, W - half, H, half + shift, 0, W - half, H);
  }
  ctx.drawImage(mix.canvas, 0, 0);
};

// ---- shapes ----
export type RevealShape = 'heart' | 'star';
/**
 * A closed polygon as x, y pairs, centred on its centroid (the centre of its area). Both shapes are star-shaped about it
 * (tested), so a smaller copy always lies inside a larger one, and the frame's four corners are reached at nearly the same
 * scale in a wide and in a tall frame (at the middle of the transition none of them is inside yet).
 */
export interface ShapeGeometry { readonly points: readonly (readonly [number, number])[]; /** Where the outline's top notch is (heart only), in the same centred units. */ readonly notch: readonly [number, number] | null }
const centred = (pts: [number, number][], notch: [number, number] | null): ShapeGeometry => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[(i + 1) % pts.length]!, c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  cx /= 3 * a; cy /= 3 * a;
  return { points: pts.map(([x, y]) => [x - cx, y - cy] as const), notch: notch ? [notch[0] - cx, notch[1] - cy] : null };
};
export const SHAPES: Readonly<Record<RevealShape, ShapeGeometry>> = {
  // the classic heart curve, 128 samples; y grows downwards (screen coordinates), so the notch is at the top
  heart: centred(Array.from({ length: 128 }, (_, i) => {
    const a = (2 * Math.PI * i) / 128;
    return [16 * Math.sin(a) ** 3, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a))] as [number, number];
  }), [0, -5]),
  // a five-pointed star, upright: 10 vertices alternating between radius 1 and 0.45
  star: centred(Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.45 : 1;
    return [r * Math.cos(a), r * Math.sin(a)] as [number, number];
  }), null),
};
export const shapeOf = (v0: number): RevealShape => (v0 === 1 ? 'star' : 'heart');
/** Even-odd point-in-polygon. */
export function insidePolygon(points: ShapeGeometry['points'], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!, [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const covers = new Map<string, number>();
/**
 * The least scale (pixels per shape unit) at which the shape, centred on the frame, contains all four corners of a W×H frame:
 * bisection on point-in-polygon, which is monotone because the shape is star-shaped about its centre. Cached per shape and size.
 */
export function coverScale(shape: RevealShape, W: number, H: number): number {
  const key = `${shape}:${W}x${H}`;
  const known = covers.get(key);
  if (known !== undefined) return known;
  const pts = SHAPES[shape].points;
  const holds = (s: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sy]) => insidePolygon(pts, (sx! * W) / 2 / s, (sy! * H) / 2 / s));
  let lo = 0, hi = Math.max(W, H);
  while (!holds(hi)) { lo = hi; hi *= 2; }
  for (let i = 0; i < 60 && hi - lo > hi * 1e-12; i++) { const mid = (lo + hi) / 2; if (holds(mid)) hi = mid; else lo = mid; }
  if (covers.size > 64) covers.clear();
  covers.set(key, hi);
  return hi;
}
/** The scale the shape is drawn at on progress p: it grows from nothing and covers the whole frame from p = 1/1.04 on. */
export const shapeScale = (shape: RevealShape, p: number, W: number, H: number) => 1.04 * p * coverScale(shape, W, H);
const shapeReveal: CanvasKernel = ({ ctx, incoming, outgoing, t, v, W, H }) => {
  const name = shapeOf(v[0]), sc = shapeScale(name, t.progress, W, H);
  const path = new Path2D();
  SHAPES[name].points.forEach(([x, y], i) => (i ? path.lineTo(W / 2 + sc * x, H / 2 + sc * y) : path.moveTo(W / 2 + sc * x, H / 2 + sc * y)));
  path.closePath();
  const mix = scratch(6, W, H), m = mix.ctx;
  if (outgoing) m.drawImage(outgoing.canvas, 0, 0);
  m.save();
  m.clip(path);
  m.drawImage(incoming.canvas, 0, 0);
  m.restore();
  if (t.color) { m.lineWidth = 0.004 * H; m.lineJoin = 'round'; m.strokeStyle = t.color; m.stroke(path); }
  ctx.drawImage(mix.canvas, 0, 0);
};

// ---- colour blocks ----
/**
 * Where full coverage of the colour blocks ends after the switch, as a progress value (at least 0.5). The picture switches on
 * the first frame whose progress is at least 0.5, and that frame must be covered whole however coarse the frames are: so the
 * hold lasts to that frame's progress without a beat lock (above 0.5 when the transition has an even number of frames), and
 * on a frame that may be the beat-locked switch frame (its progress is then exactly transitionProgress(l, n, l)) it lasts to
 * that value. Without the render quantities the hold ends at 0.5.
 */
export function blockHold(p: number, frame: number | undefined, frames: number | undefined): number {
  if (frames === undefined || frame === undefined || frames < 1) return 0.5;
  let h = Math.max(0.5, transitionProgress(switchFrame(frames, null), frames, null));
  if (frame >= 1 && frame <= frames - 1) { const beat = transitionProgress(frame, frames, frame); if (p >= 0.5 && p <= beat) h = Math.max(h, beat); }
  return h;
}
/**
 * The three colour blocks on progress p: [trailing edge, leading edge] of bar i along the axis from the side they start at,
 * 0 … 1. The leading edges cross the frame by the switch (bar i delayed by 0.06·i, so bar 0 is in front); after the hold
 * (blockHold) the trailing edges follow, staggered the other way (bar 2 leaves first, bar 0 last), and every bar has left
 * by p = 0.92. Bar 0's span therefore always contains the other two, so the bars are stacked with bar 0 at the bottom and
 * bar 2 on top (BLOCK_ORDER): each colour shows as a band.
 */
export function blockSpans(p: number, frame?: number, frames?: number): [number, number][] {
  const h = blockHold(p, frame, frames), tail = (0.92 - h) / 0.42;
  return [0, 1, 2].map((i) => {
    const lead = clamp01((p - 0.06 * i) / (0.5 - 0.06 * i));
    const d = 0.06 * (2 - i) * tail;
    const trail = p <= h ? 0 : clamp01((p - h - d) / (0.92 - h - d));
    return [trail, lead];
  });
}
/** The colours of the three bars: c, c·0.8 and c·0.6 per channel. */
export function blockColors(color: string): [string, string, string] {
  const n = parseInt(color.slice(1), 16), rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const shade = (k: number) => `rgb(${rgb.map((c) => Math.round(c * k)).join(',')})`;
  return [shade(1), shade(0.8), shade(0.6)];
}
const BLOCK_COLOR = '#3DE0C8';
/**
 * Drawing order of the bars, bottom first. (The plan's "2, 1, 0" puts bar 0 on top; as bar 0's span contains the others at
 * every progress, bars 1 and 2 would never be seen. Bottom-first 0, 1, 2 shows c in front, then c·0.8, then c·0.6.)
 */
export const BLOCK_ORDER = [0, 1, 2] as const;
const block: CanvasKernel = ({ ctx, incoming, outgoing, t, v, W, H }) => {
  const p = t.progress, side = p < 0.5 ? outgoing : incoming;
  const color = /^#[0-9a-fA-F]{6}$/.test(t.color ?? '') ? t.color! : transitionDef(t.type)?.defaults?.color ?? BLOCK_COLOR;
  const colors = blockColors(color), spans = blockSpans(p, t.frame, t.frames);
  const mix = scratch(6, W, H), m = mix.ctx;
  if (side) m.drawImage(side.canvas, 0, 0);
  // v0 = −1 travels from the right edge to the left, v0 = +1 from the left edge to the right
  for (const i of BLOCK_ORDER) {
    const [a, b] = spans[i]!;
    if (b <= a) continue;
    const x0 = v[0] < 0 ? W * (1 - b) : W * a, x1 = v[0] < 0 ? W * (1 - a) : W * b;
    m.fillStyle = colors[i]!;
    m.fillRect(x0, 0, x1 - x0, H);
  }
  ctx.drawImage(mix.canvas, 0, 0);
};

// ---- velocity slices ----
export const SLICE_BANDS = 12;
/**
 * The 12 bands of the slices: `offset` is the band's shift at the middle of the transition as a fraction of the frame's
 * width (slices-h) or height (slices-v), within ±0.175; `at` is the progress from which the band shows the incoming picture,
 * in [0.2, 0.8]. Hashed with the TypeScript twin of the WGSL hash (gpu.ts hash32/unit32), so a seed always gives the same bands.
 */
export function sliceBands(seed: number): { offset: number; at: number }[] {
  const s = Math.max(0, Math.round(seed)) >>> 0;
  return Array.from({ length: SLICE_BANDS }, (_, b) => ({
    offset: (unit32(hash32((Math.imul(b, 7919) + 13 + Math.imul(s, 104729)) >>> 0)) - 0.5) * 0.35,
    at: 0.2 + 0.6 * unit32(hash32((Math.imul(b, 31) + 7 + Math.imul(s, 130363)) >>> 0)),
  }));
}
const slices: CanvasKernel = ({ ctx, incoming, outgoing, t, v, W, H }) => {
  const p = t.progress, vertical = v[0] === 1;
  const across = vertical ? H : W, along = vertical ? W : H, swing = Math.sin(Math.PI * p);
  const mix = scratch(6, W, H), m = mix.ctx;
  sliceBands(t.seed ?? 0).forEach((band, b) => {
    const src = p >= band.at ? incoming : outgoing;
    if (!src) return;
    // whole-pixel bands and shifts: each band is an exact copy of its rows (or columns), wrapped around the frame
    const a0 = Math.round((b * along) / SLICE_BANDS), a1 = Math.round(((b + 1) * along) / SLICE_BANDS), size = a1 - a0;
    const off = Math.round(band.offset * across * swing);
    for (const o of off === 0 ? [0] : [off, off - Math.sign(off) * across]) {
      if (vertical) m.drawImage(src.canvas, a0, 0, size, H, a0, o, size, H);
      else m.drawImage(src.canvas, 0, a0, W, size, o, a0, W, size);
    }
  });
  ctx.drawImage(mix.canvas, 0, 0);
};

/** Kernel name -> code. */
export const CANVAS_KERNELS: Record<string, CanvasKernel> = {
  dissolve: (a) => crossfade(a, false),
  zoom: (a) => crossfade(a, true),
  dip, wipe, push,
  // trend pack (ADR-0012)
  punch,
  blur: blurDissolve,
  split,
  shape: shapeReveal,
  block,
  slices,
};
