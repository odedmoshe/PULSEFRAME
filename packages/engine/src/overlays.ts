/**
 * Overlay effects (snow, confetti, hearts, bokeh, speed lines): a closed-form model of what one frame shows, a pure function
 * of its arguments, drawn by look.ts in Canvas2D (ADR-0011 wave 1; ADR-0008 decision 1: drawing stays in Canvas2D).
 *
 * The particles live on a lattice that scrolls with the timeline time, so any frame is computed on its own (a random seek
 * equals sequential playback) and two neighbouring clips with the same seed continue the same snow across a cut:
 *  - three depth layers l = 0, 1, 2 with depth factors k = 0.5, 0.75, 1 (far ones smaller, slower and fainter);
 *  - square cells of side c = max(H/40, m·size·k·H) (m = 6 for particles, 10 for bokeh), scrolled by seconds·speed·k·H
 *    pixels along the kind's direction;
 *  - a cell holds a particle where unit32(hash32(mix(seed, l, i, j, 0))) < density;
 *  - the particle sits at the cell centre plus a seeded jitter (±0.15·c on each axis) plus a sway across the direction of
 *    travel, 0.15·c·sin(2π·f·t + φ) with f = (0.25 + 0.55·u)·(the kind's sway rate);
 *  - its extent (boundRadius) is at most c/6, so it never leaves its own cell (0.15 + 0.15 + 1/6 < 1/2): only the cells
 *    that meet the frame can show anything.
 * Confetti in burst mode is one burst of 48 pieces from a point at the start of the clip, in closed form at clip-local
 * seconds: p(a) = o + v·(1 − e^(−k·a))/k + g·ŷ·(a − (1 − e^(−k·a))/k)/k, k = 1.6/s, g = 1.4·H/s², fading out over 1.6 s.
 *
 * Nothing here flashes (ADR-0009 decision 3: safe at the defaults): the bokeh twinkles at most ±15 % on smooth noise that
 * changes direction at most 0.4 times a second, and speed lines wander smoothly (rate ≤ 2/s) and are never re-drawn at random.
 * Units: frame pixels, y down; angles in radians, clockwise on screen.
 */
import type { BeatPosition } from '@pulseframe/core';
import { hash32, musicHit, smoothNoise, unit32 } from './gpu.ts';

/**
 * One drawn particle. `r` is the shape's radius: a disc, ring or hexagon reaches r from its centre; a rect is 2r long and r
 * wide; a heart is 2r tall. `rot` turns the shape about its centre; `alpha` is its opacity (0…1) at its brightest point.
 */
export interface Particle { x: number; y: number; r: number; rot: number; alpha: number; layer: 0 | 1 | 2; colour: string; shape: 'disc' | 'rect' | 'heart' | 'ring' | 'hexagon' }
type Params = Record<string, number | string | boolean>;
type Shape = Particle['shape'];

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

/** Depth factor of each layer, far to near. */
export const DEPTHS = [0.5, 0.75, 1] as const;
/** The overlay kinds drawn from the lattice (speed lines are their own model). */
export const OVERLAY_TYPES = ['overlay.snow', 'overlay.confetti', 'overlay.hearts', 'overlay.bokeh'] as const;
/** Pieces of one confetti burst, the speed it fades at and the constants of its closed form. */
export const BURST = { pieces: 48, fadeSeconds: 1.6, k: 1.6, g: 1.4 } as const;
/** Largest share of the cell a sway or a jitter moves a particle off the cell centre (each). */
export const SWAY = 0.15, JITTER = 0.15;
/** Sway frequency f = (0.25 + 0.55·u)·rate, per kind: the bokeh drifts slowest. */
export const SWAY_RATE: Record<string, number> = { 'overlay.snow': 1, 'overlay.confetti': 1, 'overlay.hearts': 0.6, 'overlay.bokeh': 0.2 };
/** Brightest point of each shape relative to `alpha` (the ring and the hexagon are brighter at the rim than in the middle). */
export const CENTRE_GAIN: Record<Shape, number> = { disc: 1, rect: 1, heart: 1, ring: 0.6, hexagon: 0.6 };
/** Farthest reach of each shape from its centre, in units of r. */
const BOUND: Record<Shape, number> = { disc: 1, ring: 1, hexagon: 1, rect: Math.hypot(1, 0.5), heart: 1.14 };
/** Farthest any pixel of the particle lies from its centre. */
export const boundRadius = (p: Pick<Particle, 'r' | 'shape'>) => p.r * BOUND[p.shape];

/** The seeded hash of one lattice site (or burst piece): mix(seed, l, i, j, n). Negative cell indices are fine. */
export function mix(seed: number, l: number, i: number, j: number, n: number): number {
  let h = hash32((seed >>> 0) ^ 0x5bd1e995);
  h = hash32((h ^ Math.imul(l + 1, 0x27d4eb2d)) >>> 0);
  h = hash32((h ^ (i | 0)) >>> 0);
  h = hash32((h ^ Math.imul(j | 0, 0x165667b1)) >>> 0);
  return hash32((h ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0);
}
const u = (seed: number, l: number, i: number, j: number, n: number) => unit32(mix(seed, l, i, j, n));

const PALETTES: Record<string, readonly string[]> = {
  // every colour's strongest channel is at least 0xB0, so a piece is never much darker than the one it covers
  party: ['#FF4D6D', '#FFD166', '#06D6A0', '#4CC9F0', '#B388FF', '#FFFFFF'],
  gold: ['#FFD166', '#F4C430', '#FFE8A3', '#E6B422'],
  pastel: ['#FFC8DD', '#BDE0FE', '#CDEAC0', '#FFF1A8', '#E2CFEA'],
};
const confettiColour = (p: Params, x: number) => {
  if (p.palette === 'single') return typeof p.color === 'string' ? p.color : '#FFD166';
  const list = PALETTES[typeof p.palette === 'string' ? p.palette : 'party'] ?? PALETTES.party!;
  return list[Math.min(list.length - 1, Math.floor(x * list.length))]!;
};

interface Kind { m: number; dir: [number, number]; size: number; speed: number; density: number; seed: number }
function kindOf(type: string, p: Params): Kind | null {
  const seed = Math.round(num(p.seed, 1)), density = clamp01(num(p.density, 0.4)), speed = Math.max(0, num(p.speed, 0.1));
  const norm = (x: number, y: number): [number, number] => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  switch (type) {
    case 'overlay.snow': return { m: 6, dir: norm(Math.max(-1, Math.min(1, num(p.wind, 0.1))), 1), size: num(p.size, 0.008), speed, density, seed };
    case 'overlay.confetti': return { m: 6, dir: [0, 1], size: num(p.size, 0.014), speed, density, seed };
    case 'overlay.hearts': return { m: 6, dir: [0, -1], size: num(p.size, 0.035), speed, density, seed };
    case 'overlay.bokeh': return { m: 10, dir: norm(0.25, -1), size: num(p.size, 0.06), speed, density, seed };
    default: return null;
  }
}
/** Side of a cell of depth layer `l`, in pixels. */
export function cellSize(type: string, p: Params, H: number, l: 0 | 1 | 2): number {
  const k = kindOf(type, p);
  return k ? Math.max(H / 40, k.m * Math.max(0, k.size) * DEPTHS[l] * H) : H / 40;
}

/** One lattice site: the cell it belongs to and, if the cell holds one, its particle. */
export interface LatticeSite { l: 0 | 1 | 2; i: number; j: number; /** cell side */ c: number; /** cell centre at this moment */ cx: number; cy: number; particle: Particle }

/** The particle of cell (i, j) of layer l at timeline `seconds`, or null when the cell is empty. Pure. */
export function latticeSite(type: string, p: Params, W: number, H: number, l: 0 | 1 | 2, i: number, j: number, seconds: number, beat: BeatPosition | null): LatticeSite | null {
  const kind = kindOf(type, p);
  if (!kind) return null;
  void W;
  const { seed, dir } = kind;
  if (!(u(seed, l, i, j, 0) < kind.density)) return null;
  const k = DEPTHS[l], c = cellSize(type, p, H, l), travel = seconds * kind.speed * k * H;
  const cx = (i + 0.5) * c + dir[0] * travel, cy = (j + 0.5) * c + dir[1] * travel;
  const f = (0.25 + 0.55 * u(seed, l, i, j, 3)) * (SWAY_RATE[type] ?? 1);
  const sway = SWAY * c * Math.sin(TAU * f * seconds + TAU * u(seed, l, i, j, 4));
  const x = cx + (u(seed, l, i, j, 1) - 0.5) * 2 * JITTER * c - dir[1] * sway;
  const y = cy + (u(seed, l, i, j, 2) - 0.5) * 2 * JITTER * c + dir[0] * sway;
  const amount = clamp01(num(p.amount, 0.9));
  let particle: Particle;
  switch (type) {
    case 'overlay.snow':
      particle = { x, y, r: kind.size * k * H, rot: 0, alpha: amount * (0.45 + 0.55 * k), layer: l, colour: '#FFFFFF', shape: 'disc' };
      break;
    case 'overlay.confetti': {
      const sf = [0.75, 1, 1.25][Math.min(2, Math.floor(u(seed, l, i, j, 5) * 3))]!;
      const spin = (1.5 + 2.5 * u(seed, l, i, j, 7)) * (u(seed, l, i, j, 8) < 0.5 ? -1 : 1);
      particle = { x, y, r: 0.5 * kind.size * k * H * sf, rot: wrapAngle(TAU * u(seed, l, i, j, 6) + spin * seconds), alpha: amount * (0.55 + 0.45 * k), layer: l, colour: confettiColour(p, u(seed, l, i, j, 9)), shape: 'rect' };
      break;
    }
    case 'overlay.hearts': {
      // following the music each heart swells a little on the beat (musicHit fast path: the beat grid continues at any tempo)
      const hit = musicHit(p, beat);
      const swell = hit ? 1 + 0.25 * Math.exp(-5 * hit.phase) : 1;
      const wobble = (12 * Math.PI / 180) * Math.sin(TAU * (0.3 + 0.4 * u(seed, l, i, j, 6)) * seconds + TAU * u(seed, l, i, j, 7));
      const fade = smoothstep(0, 0.3 * H, y) * smoothstep(0, 0.1 * H, H - y); // fade out toward the top; fade in at the bottom
      particle = { x, y, r: 0.5 * kind.size * k * H * swell, rot: wobble, alpha: amount * (0.55 + 0.45 * k) * fade, layer: l, colour: typeof p.color === 'string' ? p.color : '#FF4D6D', shape: 'heart' };
      break;
    }
    default: { // bokeh
      const twinkle = 0.85 + 0.15 * smoothNoise(mix(seed, l, i, j, 10), 0.4 * seconds);
      particle = { x, y, r: kind.size * k * H, rot: 0, alpha: amount * (0.4 + 0.6 * k) * twinkle, layer: l, colour: typeof p.color === 'string' ? p.color : '#FFD9A0', shape: p.shape === 'hexagon' ? 'hexagon' : 'ring' };
    }
  }
  return { l, i, j, c, cx, cy, particle };
}
const wrapAngle = (a: number) => a - TAU * Math.floor(a / TAU);

/** Every occupied site of the cells that meet the frame, far layer first. Pure. */
export function latticeSites(type: string, p: Params, W: number, H: number, seconds: number, beat: BeatPosition | null): LatticeSite[] {
  const kind = kindOf(type, p);
  if (!kind || !(kind.density > 0) || !(W > 0) || !(H > 0) || !Number.isFinite(seconds)) return [];
  const out: LatticeSite[] = [];
  for (const l of [0, 1, 2] as const) {
    const c = cellSize(type, p, H, l), travel = seconds * kind.speed * DEPTHS[l] * H;
    const ox = kind.dir[0] * travel, oy = kind.dir[1] * travel;
    // a particle stays inside its cell, so the cells that meet [0, W) × [0, H) are all that can show
    const i0 = Math.floor(-ox / c), i1 = Math.floor((W - ox) / c), j0 = Math.floor(-oy / c), j1 = Math.floor((H - oy) / c);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const s = latticeSite(type, p, W, H, l, i, j, seconds, beat);
      if (s && s.particle.alpha > 0) out.push(s);
    }
  }
  return out;
}

/** The 48 pieces of a confetti burst at clip-local seconds `a` (empty before the clip starts and once they have faded). Pure. */
export function burstParticles(p: Params, W: number, H: number, a: number): Particle[] {
  if (!(a >= 0) || a >= BURST.fadeSeconds) return [];
  const seed = Math.round(num(p.seed, 1)), size = num(p.size, 0.014), amount = clamp01(num(p.amount, 0.9));
  const ox = clamp01(num(p.x, 0.5)) * W, oy = clamp01(num(p.y, 0.85)) * H;
  const { k, g } = BURST, e = (1 - Math.exp(-k * a)) / k, fall = (g * H * (a - e)) / k;
  const out: Particle[] = [];
  for (let n = 0; n < BURST.pieces; n++) {
    const spread = (u(seed, 7, n, 0, 1) - 0.5) * (110 * Math.PI / 180), speed = (1 + 1.2 * u(seed, 7, n, 0, 2)) * H;
    const vx = speed * Math.sin(spread), vy = -speed * Math.cos(spread);
    const sf = [0.75, 1, 1.25][Math.min(2, Math.floor(u(seed, 7, n, 0, 3) * 3))]!;
    const spin = (2 + 4 * u(seed, 7, n, 0, 4)) * (u(seed, 7, n, 0, 5) < 0.5 ? -1 : 1);
    out.push({ x: ox + vx * e, y: oy + vy * e + fall, r: 0.5 * size * H * sf, rot: wrapAngle(TAU * u(seed, 7, n, 0, 6) + spin * a), alpha: amount * (1 - a / BURST.fadeSeconds), layer: (n % 3) as 0 | 1 | 2, colour: confettiColour(p, u(seed, 7, n, 0, 7)), shape: 'rect' });
  }
  return out;
}

/** Every particle of an overlay effect on one frame, in frame pixels: a pure function of its arguments (timeline seconds for motion, clip-local seconds for bursts). */
export function overlayParticles(type: string, params: Params, width: number, height: number, seconds: number, local: number, beat: BeatPosition | null): Particle[] {
  if (type === 'overlay.confetti' && params.mode === 'burst') return burstParticles(params, width, height, local);
  return latticeSites(type, params, width, height, seconds, beat).map((s) => s.particle);
}

/**
 * Opacity of a shape at (x, y) from its centre, in units of r, before rotation: the picture a sprite of the particle holds.
 * Shared by the drawing (look.ts builds its sprites from it) and by the proofs that rasterise the model.
 */
export function shapeAlpha(shape: Shape, x: number, y: number): number {
  switch (shape) {
    case 'disc': return 1 - smoothstep(0.35, 1, Math.hypot(x, y)); // a soft flake
    case 'rect': return Math.abs(x) <= 1 && Math.abs(y) <= 0.5 ? 1 : 0;
    case 'heart': return insideHeart(x, y) ? 1 : 0;
    case 'ring': { const d = Math.hypot(x, y); return (0.6 + 0.4 * smoothstep(0.62, 0.92, d)) * (1 - smoothstep(0.9, 1, d)); } // brighter at the rim, soft edge
    case 'hexagon': { const s = Math.max(Math.abs(y), Math.abs(x) * 0.8660254 + Math.abs(y) * 0.5) / 0.8660254; return (0.6 + 0.4 * smoothstep(0.62, 0.92, s)) * (1 - smoothstep(0.9, 1, s)); }
  }
}

/** The heart outline: four cubic Béziers (point at the bottom), flattened once into a polygon. Units of r, y down. */
const HEART: readonly [number, number][] = (() => {
  const curves: [number, number][][] = [
    [[0, 0.95], [-0.35, 0.65], [-1.1, 0.25], [-1.05, -0.35]],
    [[-1.05, -0.35], [-1.0, -0.85], [-0.35, -1.0], [0, -0.55]],
    [[0, -0.55], [0.35, -1.0], [1.0, -0.85], [1.05, -0.35]],
    [[1.05, -0.35], [1.1, 0.25], [0.35, 0.65], [0, 0.95]],
  ];
  const pts: [number, number][] = [];
  for (const [a, b, c, d] of curves) for (let s = 0; s < 24; s++) {
    const t = s / 24, m = 1 - t;
    pts.push([m * m * m * a![0] + 3 * m * m * t * b![0] + 3 * m * t * t * c![0] + t * t * t * d![0], m * m * m * a![1] + 3 * m * m * t * b![1] + 3 * m * t * t * c![1] + t * t * t * d![1]]);
  }
  return pts;
})();
function insideHeart(x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = HEART.length - 1; i < HEART.length; j = i++) {
    const [xi, yi] = HEART[i]!, [xj, yj] = HEART[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface SpeedLine { a0: number; a1: number; r0: number; r1: number }
/**
 * Speed lines: thin wedges around a centre. Wedge i points at angle (a0 + a1) / 2, its tip at r0 from the centre and its wide
 * end (from a0 to a1) at r1, beyond the farthest corner. r0 = focus·R + reach·R·(0.5 + 0.5·smoothNoise(seed + i, rate·t)),
 * R = the half-diagonal of the frame: the tips wander smoothly, and nothing is ever re-drawn at random. Pure.
 */
export function speedLines(params: Params, width: number, height: number, seconds: number): { cx: number; cy: number; lines: SpeedLine[] } {
  const cx = clamp01(num(params.x, 0.5)) * width, cy = clamp01(num(params.y, 0.5)) * height;
  const R = Math.hypot(width, height) / 2;
  const far = Math.max(Math.hypot(cx, cy), Math.hypot(width - cx, cy), Math.hypot(cx, height - cy), Math.hypot(width - cx, height - cy));
  const r1 = 1.1 * Math.max(far, 1e-6);
  const n = Math.max(16, Math.min(240, Math.round(num(params.lines, 90))));
  const seed = Math.round(num(params.seed, 1)), focus = clamp01(num(params.focus, 0.35)), reach = clamp01(num(params.reach, 0.25));
  const thickness = Math.max(0, num(params.thickness, 1)), rate = Math.max(0, Math.min(2, num(params.rate, 1)));
  const slot = TAU / n, lines: SpeedLine[] = [];
  for (let i = 0; i < n; i++) {
    const mid = slot * (i + 0.5 + (u(seed, 9, i, 0, 1) - 0.5) * 0.5);
    const half = 0.5 * slot * thickness * (0.12 + 0.2 * u(seed, 9, i, 0, 2));
    const r0 = focus * R + reach * R * (0.5 + 0.5 * smoothNoise(seed + i, rate * seconds));
    if (r0 < r1 && half > 0) lines.push({ a0: mid - half, a1: mid + half, r0, r1 });
  }
  return { cx, cy, lines };
}
/** The three corners of a speed-line wedge in frame pixels: tip, then the two ends of its wide side. */
export function wedgeCorners(cx: number, cy: number, s: SpeedLine): [[number, number], [number, number], [number, number]] {
  const m = (s.a0 + s.a1) / 2;
  return [[cx + s.r0 * Math.cos(m), cy + s.r0 * Math.sin(m)], [cx + s.r1 * Math.cos(s.a0), cy + s.r1 * Math.sin(s.a0)], [cx + s.r1 * Math.cos(s.a1), cy + s.r1 * Math.sin(s.a1)]];
}
