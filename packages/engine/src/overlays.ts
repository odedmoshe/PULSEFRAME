/**
 * Overlay effects (snow, confetti, hearts, bokeh, speed lines): a closed-form model of what one frame shows, a pure function
 * of its arguments, drawn by look.ts in Canvas2D (ADR-0011 wave 1; ADR-0008 decision 1: drawing stays in Canvas2D).
 *
 * The particles live on a lattice that scrolls with the timeline time, so any frame is computed on its own (a random seek
 * equals sequential playback) and two neighbouring clips with the same seed continue the same snow across a cut:
 *  - three depth layers l = 0, 1, 2 with depth factors k = 0.5, 0.75, 1 (far ones smaller, slower and fainter);
 *  - square cells of side c = max(H/40, m·s·k·H) (m = 6 for particles, 10 for bokeh; s the size the cells are made for,
 *    the particle size unless it is animated), scrolled by seconds·v·k·H pixels along the kind's direction, where
 *    v = min(speed, the kind's speed limit);
 *  - a cell holds a particle where unit32(hash32(mix(seed, l, i, j, 0))) < density;
 *  - the particle sits at the cell centre plus a seeded jitter (±0.15·c on each axis) plus a sway across the direction of
 *    travel, 0.15·c·sin(2π·f·t + φ) with f = (0.25 + 0.55·u)·(the kind's sway rate);
 *  - its extent (boundRadius) is at most c/6, so it never leaves its own cell (0.15 + 0.15 + 1/6 < 1/2): only the cells
 *    that meet the frame can show anything.
 * The speed limit and the size the cells are made for are one value each for the whole clip (SPEED_LIMIT, LATTICE_SIZE,
 * given by the evaluator from every value the instance's keys reach and the project's frame shape): a keyframed density,
 * opacity or size changes how many particles there are, how strong and how large, never where the lattice is. Keys on the
 * speed or the wind themselves do move it, as the closed form says (the travel is seconds × speed, not its integral).
 * Confetti in burst mode is one burst of 48 pieces from a point at the start of the clip, in closed form at clip-local
 * seconds: p(a) = o + v·(1 − e^(−k·a))/k + g·ŷ·(a − (1 − e^(−k·a))/k)/k, k = 1.6/s, g = 1.4·H/s², fading out over 1.6 s.
 *
 * Flash safety (ADR-0009 decision 3): the bokeh twinkles at most ±15 % on smooth noise that changes direction at most 0.4
 * times a second, and speed lines wander smoothly (rate ≤ 2/s) and are never re-drawn at random. Large bright particles
 * passing a point several times a second would make the analyser cells they cross flash, so snow, confetti and hearts move
 * no faster than the speed at which, on average, one particle able to change a cell by a whole step passes any cell per
 * second (speedLimit). With it they pass the flash analyser at their defaults and at their extremes; the defaults are not
 * slowed in frames from 2:1 to 1:2. What is drawn over the user's own picture is still left to the check of the result.
 * Units: frame pixels, y down; angles in radians, clockwise on screen.
 */
import { NOT_ANIMATABLE, type BeatPosition, type EffectInstance } from '@pulseframe/core';
import { FLASH_GRID } from './flashAnalysis.ts';
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

interface Kind { m: number; dir: [number, number]; size: number; /** the size the lattice cells are made for (at least `size`) */ cell: number; speed: number; density: number; seed: number }
const norm = (x: number, y: number): [number, number] => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const snowDir = (p: Params) => norm(Math.max(-1, Math.min(1, num(p.wind, 0.1))), 1);

/**
 * Render parameters the evaluator adds to every lattice overlay (evaluate.ts, from heldOverlayParams): one value each for the
 * whole clip, so that nothing about the motion changes while the clip plays.
 *  - SPEED_LIMIT: the fastest the particles may move, in frame heights per second (speedLimit, at the worst values the
 *    instance's keys reach, for the project's frame shape);
 *  - LATTICE_SIZE: the particle size the cells are made for (the largest size the keys reach). An animated size then grows
 *    and shrinks the particles in place; a cell side that followed it would move cell (i, j) by (i + ½, j + ½)·Δc.
 * A direct call without them (fixed parameters) works them out from its parameters and the frame's shape: the same values
 * the evaluator gives an instance without keys in a project of that shape.
 */
export const SPEED_LIMIT = '__speedLimit', LATTICE_SIZE = '__latticeSize';

/**
 * The kind's lattice. With the frame size (W, H) the speed is the one drawn: never above the limit (SPEED_LIMIT, or
 * speedLimit of these parameters). Without it (cellSize and speedLimit, which need no speed) the speed is left as given.
 */
function kindOf(type: string, p: Params, W?: number, H?: number): Kind | null {
  const seed = Math.round(num(p.seed, 1)), density = clamp01(num(p.density, 0.4)), asked = Math.max(0, num(p.speed, 0.1));
  let base: Pick<Kind, 'm' | 'dir' | 'size'>;
  switch (type) {
    case 'overlay.snow': base = { m: 6, dir: snowDir(p), size: num(p.size, 0.008) }; break;
    case 'overlay.confetti': base = { m: 6, dir: [0, 1], size: num(p.size, 0.014) }; break;
    case 'overlay.hearts': base = { m: 6, dir: [0, -1], size: num(p.size, 0.035) }; break;
    case 'overlay.bokeh': base = { m: 10, dir: norm(0.25, -1), size: num(p.size, 0.06) }; break;
    default: return null;
  }
  const held = p[SPEED_LIMIT];
  const limit = typeof held === 'number' && held >= 0 ? held : W !== undefined && H !== undefined ? speedLimit(type, p, W / H) : Infinity;
  return { ...base, cell: Math.max(base.size, num(p[LATTICE_SIZE], base.size)), speed: Math.min(asked, limit), density, seed };
}
/** Side of a cell of depth layer `l`, in pixels. */
export function cellSize(type: string, p: Params, H: number, l: 0 | 1 | 2): number {
  const k = kindOf(type, p);
  return k ? Math.max(H / 40, k.m * Math.max(0, k.cell) * DEPTHS[l] * H) : H / 40;
}

/**
 * Flash safety of the falling and rising overlays at every setting (ADR-0009 decision 3, ADR-0011; plan §0: safe at the
 * extremes of an item with a rate). The flash analyser (flashAnalysis.ts) divides the frame into FLASH_GRID × FLASH_GRID cells
 * and counts, per cell, changes of its mean linear luminance by 0.1 or more (or of its red value by 20 where one state is a
 * saturated red); more than six in one second over a quarter of the cells of a window fails. A small particle changes a cell
 * by a fraction of that step and many of them average out; a large bright one changes it by a whole step on its own, so large
 * particles passing a point more than about three times a second flash. Without a limit the analyser flagged snow of size 0.04
 * at speed 1 on black and mid sizes 0.012–0.025 at speeds 0.6–1 (worse on grey); hearts of size 0.012–0.025 at their top
 * speed by the red rule (their own colour, more in pure red); confetti in one colour, white or red, at sizes 0.015–0.03 and
 * speed 1, and the party palette at 0.025 in 9:16. Per depth layer l and per look q of a particle (its size factor and
 * colour, each a share of the particles):
 *  - P, the most one particle can change one cell (a × b = W/24 × H/24 pixels) over any background, in luminance: its light
 *    over the cell's area, min(1, light·r² / (a·b)), times strength(α, colour) with α its opacity;
 *  - F, how many of them pass over a given cell per second on average: density / c² × v·k × (the cell's width across the
 *    direction of motion + the particle's widest extent), with v·k its speed and c its lattice cell;
 *  - a weight min(1, P / step)³: a particle that can change a cell by a whole step counts as one possible flash, a fainter one
 *    steeply less (it takes several at once, which is rarer). The step is the analyser's 0.1 for opaque shapes (confetti,
 *    hearts), whose P is exact, and 0.15 for the soft flake, whose P overstates it (its rim is partly transparent, and a
 *    pixel at opacity a over black gains less than a in linear light).
 * The particles then move no faster than the speed at which Σ F·weight = FLASH_LIMIT.perSecond (one such particle per cell per
 * second on average: about two transitions a second where six are allowed). The constants were set against FlashAnalyser
 * (3 s at 30 fps, the model drawn at 162 pixels on the short side) on grids of sizes, densities, opacities, winds, colours
 * and palettes, in 16:9, 9:16, 1:1, 2:1 and 1:2, on black, greys and white: at the limit every case passed; snow passed at
 * three to four times its limit, confetti and hearts at one and a half to twice theirs (the closest: red hearts of size 0.012
 * in 16:9, at one and a half for one seed in four). overlays.test.ts checks the extremes. At the defaults the limit is
 * at least twice the default speed for every frame shape from 2:1 to 1:2 (snow, confetti in every palette, hearts steady or
 * following the music), so the look there is unchanged; only a frame taller than 1:2 slows the default snow (1:3: 0.12 frame
 * heights a second instead of 0.15). Otherwise it slows large, dense, opaque particles asked to move fast (snow at its
 * largest, densest and most opaque: about 0.11 in 16:9, 0.16 in 9:16). The bokeh needs no limit: at its top speed (0.2) it
 * passes at every size, in red too.
 * Not modelled (as in the analyser's own limits, ADR-0009 decision 5): a light particle over a saturated red picture, which
 * changes the cell's red value faster than its luminance.
 */
export const FLASH_LIMIT = { step: { disc: 0.15, rect: 0.1, heart: 0.1 }, perSecond: 1 } as const;
/** ∫ shapeAlpha('disc') dA in units of r²: the light of a flake at full opacity relative to its radius squared. */
export const DISC_LIGHT = Math.PI * (0.35 * 0.35 + 2 * 0.65 * (0.35 * 0.5 + 0.65 * 0.15));
/** One red step of the analyser (20) weighs as this much luminance: 1.25 general steps (0.1), a margin measured for red pieces, which kept less of one at the limit than white ones. */
export const RED_STEP_AS = 0.125;
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/**
 * The most one pixel covered at opacity α by `colour` can move the analyser's signals, in units of luminance (the general
 * step is 0.1; a red step of 20 weighs RED_STEP_AS):
 *  - brighter: its linear luminance rises by at most α (sRGB → linear is convex), over any background;
 *  - darker: over white it falls to the luminance of the mix, which for a dark colour is more than α below;
 *  - red: a saturated red colour (R / (R + G + B) ≥ 0.8 in linear light) over black raises the red value by α·320·(R − G − B).
 */
export function strength(alpha: number, colour: string): number {
  const ch = /^#[0-9a-fA-F]{6}$/.test(colour) ? [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16) / 255) : [1, 0, 0];
  const [r, g, b] = ch.map(linear) as [number, number, number];
  const darker = 1 - luminance(...(ch.map((c) => linear(1 - alpha + alpha * c)) as [number, number, number]));
  const red = r + g + b > 0 && r / (r + g + b) >= 0.8 ? (alpha * 320 * Math.max(0, r - g - b) * RED_STEP_AS) / 20 : 0;
  return Math.max(alpha, darker, red);
}
/** One look of a kind's particles for the limit: its share of them, radius per size·k·H, light (r² units), widest extent (r units) and colour. */
interface Look { share: number; scale: number; light: number; reach: number; colour: string; step: number }
/** The looks of a kind's particles and their opacity per depth factor before `amount`; null for a kind without a speed limit. */
function looksOf(type: string, p: Params): { looks: Look[]; opacity: (k: number) => number } | null {
  switch (type) {
    case 'overlay.snow': return { looks: [{ share: 1, scale: 1, light: DISC_LIGHT, reach: BOUND.disc, colour: '#FFFFFF', step: FLASH_LIMIT.step.disc }], opacity: (k) => 0.45 + 0.55 * k };
    case 'overlay.confetti': {
      if (p.mode === 'burst') return null;
      const colours = Array.from(new Set(Array.from({ length: 60 }, (_, i) => confettiColour(p, (i + 0.5) / 60)))); // every colour the palette gives
      const looks = [0.75, 1, 1.25].flatMap((sf) => colours.map((colour) => ({ share: 1 / (3 * colours.length), scale: 0.5 * sf, light: SHAPE_LIGHT.rect, reach: BOUND.rect, colour, step: FLASH_LIMIT.step.rect })));
      return { looks, opacity: (k) => 0.55 + 0.45 * k };
    }
    case 'overlay.hearts': {
      const swell = p.follow === 'music' ? 1.25 : 1; // at its largest, on the beat
      return { looks: [{ share: 1, scale: 0.5 * swell, light: SHAPE_LIGHT.heart, reach: BOUND.heart, colour: typeof p.color === 'string' ? p.color : '#FF4D6D', step: FLASH_LIMIT.step.heart }], opacity: (k) => 0.55 + 0.45 * k };
    }
    default: return null;
  }
}
/** The looks of a kind's particles with their strength in each depth layer: all the limit needs of `amount` and the colours. */
function weighed(type: string, p: Params): (Look & { strength: number[] })[] | null {
  const drawn = looksOf(type, p), amount = clamp01(num(p.amount, 0.9));
  if (!drawn || !(amount > 0)) return null;
  const byColour = new Map<string, number[]>();
  for (const q of drawn.looks) if (!byColour.has(q.colour)) byColour.set(q.colour, DEPTHS.map((k) => strength(amount * drawn.opacity(k), q.colour)));
  return drawn.looks.map((q) => ({ ...q, strength: byColour.get(q.colour)! }));
}
/** Σ F·weight over the depth layers and looks at a speed of one frame height per second (F is proportional to the speed). */
function flashesPerUnitSpeed(kind: Kind, looks: readonly (Look & { strength: number[] })[], aspect: number): number {
  // lengths in frame heights: the frame is aspect × 1, an analyser cell a × b
  const [dx, dy] = kind.dir, a = aspect / FLASH_GRID, b = 1 / FLASH_GRID, across = a * Math.abs(dy) + b * Math.abs(dx);
  let sum = 0;
  for (const l of [0, 1, 2] as const) {
    const k = DEPTHS[l], c = Math.max(1 / 40, kind.m * kind.cell * k);
    for (const q of looks) {
      const r = q.scale * kind.size * k;
      const reach = Math.min(1, (q.light * r * r) / (a * b)) * q.strength[l]!;
      const passes = (kind.density / (c * c)) * k * (across + 2 * q.reach * r);
      sum += q.share * passes * Math.min(1, reach / q.step) ** 3;
    }
  }
  return sum;
}
/** The fastest an overlay with these parameters may move in a frame of shape `aspect` = width / height, in frame heights per second (Infinity: no limit). Pure. */
export function speedLimit(type: string, p: Params, aspect: number): number {
  const kind = kindOf(type, p), looks = weighed(type, p);
  if (!kind || !looks || !(kind.density > 0) || !(kind.size > 0) || !(aspect > 0)) return Infinity;
  const per = flashesPerUnitSpeed(kind, looks, aspect);
  return per > 0 ? FLASH_LIMIT.perSecond / per : Infinity;
}

/**
 * The render parameters that hold an overlay instance's motion for its whole clip (SPEED_LIMIT, LATTICE_SIZE), in a frame of
 * shape `aspect` = width / height: the project's, so the preview, stills and exports of any size agree (ADR-0005). {} for
 * effects that are not lattice overlays. Pure.
 * A parameter with keys takes values between its lowest and its highest key only (no easing overshoots, core animation.ts),
 * and keys outside the clip (after a trim) count too, so trimming or splitting a clip never changes its motion. The limit is
 * the lowest over that box of values: the largest density and opacity, and the wind and size that let the most flashes through
 * (the size by a fine search: a mid size flashes most, a larger one fills fewer, larger cells).
 */
export function heldOverlayParams(fx: Pick<EffectInstance, 'type' | 'params' | 'keyframes'>, aspect: number): Params {
  if (!(OVERLAY_TYPES as readonly string[]).includes(fx.type)) return {};
  const range = (name: string): [number, number] | null => {
    const keys = NOT_ANIMATABLE[fx.type]?.includes(name) ? undefined : fx.keyframes?.[name];
    if (keys?.length) return [Math.min(...keys.map((k) => k.value)), Math.max(...keys.map((k) => k.value))];
    const v = fx.params[name];
    return typeof v === 'number' && Number.isFinite(v) ? [v, v] : null;
  };
  const size = range('size'), density = range('density'), amount = range('amount'), wind = range('wind');
  const worst: Params = { ...fx.params, ...(density ? { density: density[1] } : {}), ...(amount ? { amount: amount[1] } : {}), ...(size ? { [LATTICE_SIZE]: size[1] } : {}) };
  const sizes = !size || size[0] === size[1] ? [size?.[0]] : Array.from({ length: 129 }, (_, i) => size[0] + ((size[1] - size[0]) * i) / 128);
  // wind w turns the fall to (w, 1)/|(w, 1)|; the snow crosses the most analyser cells at |w| = 1/aspect (or at an end)
  const winds = !wind || wind[0] === wind[1] ? [wind?.[0]] : [wind[0], wind[1], ...[-1 / aspect, 1 / aspect].filter((w) => w > wind[0] && w < wind[1])];
  let limit = Infinity;
  const looks = weighed(fx.type, worst); // the same at every size and wind: computed once
  if (looks && aspect > 0) for (const s of sizes) for (const w of winds) {
    const kind = kindOf(fx.type, { ...worst, ...(s !== undefined ? { size: s } : {}), ...(w !== undefined ? { wind: w } : {}) })!;
    if (!(kind.density > 0) || !(kind.size > 0)) continue;
    const per = flashesPerUnitSpeed(kind, looks, aspect);
    if (per > 0) limit = Math.min(limit, FLASH_LIMIT.perSecond / per);
  }
  return { [SPEED_LIMIT]: limit, ...(size ? { [LATTICE_SIZE]: size[1] } : {}) };
}

/** One lattice site: the cell it belongs to and, if the cell holds one, its particle. */
export interface LatticeSite { l: 0 | 1 | 2; i: number; j: number; /** cell side */ c: number; /** cell centre at this moment */ cx: number; cy: number; particle: Particle }

/** The particle of cell (i, j) of layer l at timeline `seconds`, or null when the cell is empty. Pure. */
export function latticeSite(type: string, p: Params, W: number, H: number, l: 0 | 1 | 2, i: number, j: number, seconds: number, beat: BeatPosition | null): LatticeSite | null {
  const kind = kindOf(type, p, W, H);
  if (!kind) return null;
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
  const kind = kindOf(type, p, W, H);
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

/** ∫ shapeAlpha dA of each particle shape the speed limit weighs, in units of r² (the heart's by its outline's area). */
export const SHAPE_LIGHT = {
  disc: DISC_LIGHT,
  rect: 2, // 2r long, r wide, opaque
  heart: Math.abs(HEART.reduce((s, [x, y], i) => { const [x2, y2] = HEART[(i + 1) % HEART.length]!; return s + x * y2 - x2 * y; }, 0)) / 2,
} as const;

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
