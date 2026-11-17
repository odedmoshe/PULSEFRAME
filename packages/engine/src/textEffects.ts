/**
 * Title look fields (ADR-0012): gradient fill, letter spacing (tracking), a second outline, glow, extrusion and long shadow,
 * drawn with Canvas2D only, so every one of them works without a graphics adapter (preview, still and export use this one
 * painter, ADR-0005). compositor2d.ts calls paintTitle only for a title with at least one look field on (core hasTextLook);
 * a title without them is drawn by the code that drew it before, unchanged.
 *
 * The shadow-like looks start from the title's silhouette S: every unit as it is posed, in opaque white, outlined at the
 * total outline width, drawn in device space into scratch slot 10 (slots 10–12 are this painter's, look.ts scratch). They
 * work inside a device bounding box of the posed units, widened by what the looks add.
 * - long shadow: S smeared along the shadow's direction (in the frame, not turning with the title) by drawing it onto itself
 *   at offsets 1, 2, 4, … and a remainder (smearSteps): ⌈log₂ n⌉ + 1 draws for n positions. The smear is taken as the
 *   largest coverage of any copy ('lighten' on a grey picture of S), so overlapping copies never add up to a harder edge or
 *   to more opacity than the letters have while they fade; the result is then given the shadow colour.
 * - extrusion: min(48, ⌈depth px⌉) copies of S toward `angle`, far to near, in min(6, copies) shade buckets; bucket b of K
 *   is the colour darkened by shade·(b + ½)/K, so the side darkens with depth. Its opacity is the largest coverage, as above.
 * - glow: S in the glow colour, blurred three times (radii R/4, R/2 and R, a radius r being a Gaussian of standard
 *   deviation r/2 as for canvas shadowBlur) and added ('lighter') at 0.9, 0.6 and 0.4 × intensity. It has no time input.
 * Then the faces: the second outline (outside the first: its line is 2·px·(strokeFrac + widthFrac) wide), the outline, and
 * the fill, all outlines before all fills. A gradient fill runs through the centre of the block's ink box, with half-length
 * (inkW/2)|cos| + (inkH/2)|sin| and evenly spaced stops; each unit's gradient is the block's shifted by minus the unit's
 * place at rest, so a letter keeps its colours while it moves and equals the still picture at rest.
 */
import type { TextStyle } from '@pulseframe/core';
import { scratch, type Buf } from './look.ts';
import { hasArabicScript, type Stretch, type UnitPose } from './textAnimation.ts';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Scratch slots of the title looks (look.ts scratch): the silhouette and two work buffers. */
export const TEXT_FX_SLOTS = { silhouette: 10, work: 11, work2: 12 } as const;
/** Copies of the silhouette at most in an extrusion, and shade buckets at most. */
export const EXTRUDE_MAX_LAYERS = 48, EXTRUDE_MAX_BUCKETS = 6;

/** One unit of a title: a line (still title) or a letter, word or line of an animated one. Geometry in the block's coordinates, as compositor2d lays it out. */
export interface TitleUnit {
  text: string; left: number; width: number; baseline: number; dir: 'rtl' | 'ltr'; rtl: boolean;
  /** The unit is these stretches of the whole line `text`, whose left edge is at `lineLeft` (compositor2d drawTextUnits). */
  window?: { lineLeft: number; stretches: Stretch[] };
  /** Space between letters in px (0 = none), as set while the unit's paragraph was measured. */
  spacing?: number;
}
export interface Box { x: number; y: number; w: number; h: number }
export interface TitleGeo {
  /** font size in px */ px: number;
  /** size of the frame (and of the canvas drawn into) */ width: number; height: number;
  /** the ink box of the whole block at rest, in block coordinates (gradient) */ ink: Box;
  /** half a device pixel where windows touch (drawTextUnits) */ seam?: number;
}
/** Records a look that this browser cannot draw (drawGraph then reports it as unavailable, so a still or an export refuses). */
export type TextNote = (id: string, why: string) => void;
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }

// ---------------------------------------------------------------- pure geometry (unit-tested)

/** Number of draws needed to cover n positions by doubling: ⌈log₂ n⌉ + 1 (n ≥ 1). */
export const smearDraws = (n: number): number => { let k = 0; while (2 ** k < n) k++; return k + 1; };
/**
 * Offsets of the draws that smear a picture over positions 0 … n−1: the first draw (offset 0) is the picture itself, and
 * each later draw puts everything drawn so far again at `offset` further. Doubling (1, 2, 4, …) and, when n is not a power
 * of two, one remainder step cover exactly the positions 0 … n−1, in ⌈log₂ n⌉ + 1 draws.
 */
export function smearSteps(n: number): number[] {
  const len = Math.max(1, Math.floor(n));
  const out = [0];
  let covered = 1;
  while (covered * 2 <= len) { out.push(covered); covered *= 2; }
  if (covered < len) out.push(len - covered);
  return out;
}
/** Unit direction of an angle in degrees in the frame (0 = right, 90 = down). Exact on the axes. */
export function direction(angle: number): [number, number] {
  const a = ((angle % 360) + 360) % 360;
  if (a === 0) return [1, 0]; if (a === 90) return [0, 1]; if (a === 180) return [-1, 0]; if (a === 270) return [0, -1];
  const r = (a * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}
/**
 * Positions of a smear `length` device px long toward `angle`, counted along the main axis of the direction (one per pixel
 * column, or row when the direction is steeper than 45°), so neighbouring positions never leave a gap.
 */
export function smearCount(length: number, angle: number): number {
  const [x, y] = direction(angle);
  return Math.max(1, Math.round(length * Math.max(Math.abs(x), Math.abs(y))) + 1);
}
/** Whole-pixel offset of smear position `o` toward `angle`: exactly ±o along the main axis, rounded on the other. */
export function smearVector(o: number, angle: number): [number, number] {
  const [x, y] = direction(angle), m = Math.max(Math.abs(x), Math.abs(y));
  const vx = Math.round((o * x) / m), vy = Math.round((o * y) / m);
  return [vx === 0 ? 0 : vx, vy === 0 ? 0 : vy]; // no -0
}
/** Darkening of shade bucket b of K: shade·(b + ½)/K (bucket 0 is next to the letters). */
export const bucketShade = (shade: number, b: number, K: number): number => (shade * (b + 0.5)) / K;
/**
 * The copies of an extrusion `depth` device px toward `angle`: N = min(48, ⌈depth⌉) layers k = 1…N at k/N of the depth
 * (whole pixels), in K = min(6, N) buckets, bucket = ⌊(k−1)·K/N⌋. Listed far to near, the order they are drawn in.
 */
export function extrudeLayers(depth: number, angle: number): { N: number; K: number; layers: { k: number; bucket: number; dx: number; dy: number }[] } {
  const N = Math.min(EXTRUDE_MAX_LAYERS, Math.max(1, Math.ceil(depth - 1e-9)));
  const K = Math.min(EXTRUDE_MAX_BUCKETS, N);
  const [x, y] = direction(angle);
  const layers: { k: number; bucket: number; dx: number; dy: number }[] = [];
  for (let k = N; k >= 1; k--) {
    const dx = Math.round((k / N) * depth * x), dy = Math.round((k / N) * depth * y);
    layers.push({ k, bucket: Math.floor(((k - 1) * K) / N), dx: dx === 0 ? 0 : dx, dy: dy === 0 ? 0 : dy });
  }
  return { N, K, layers };
}
/** The gradient line through the centre of `box` toward `angle` (0° = left to right, 90° = top to bottom), with half-length (w/2)|cos| + (h/2)|sin|. */
export function gradientLine(angle: number, box: Box): { x0: number; y0: number; x1: number; y1: number } {
  const [c, s] = direction(angle);
  const half = (box.w / 2) * Math.abs(c) + (box.h / 2) * Math.abs(s);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return { x0: cx - half * c, y0: cy - half * s, x1: cx + half * c, y1: cy + half * s };
}
/** The same gradient seen from a unit whose place at rest is `origin`: shifted by minus that place. */
export const unitGradientLine = (line: { x0: number; y0: number; x1: number; y1: number }, origin: { x: number; y: number }) =>
  ({ x0: line.x0 - origin.x, y0: line.y0 - origin.y, x1: line.x1 - origin.x, y1: line.y1 - origin.y });
/** Where (0…1, clamped as a canvas gradient pads) point (x, y) falls on a gradient line. */
export function gradientAt(line: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): number {
  const dx = line.x1 - line.x0, dy = line.y1 - line.y0, len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return 0;
  return Math.min(1, Math.max(0, ((x - line.x0) * dx + (y - line.y0) * dy) / len2));
}
/** The place of a unit at rest, in block coordinates: the middle of its advance, a third of the font size above its baseline (compositor2d drawTextUnits). */
export const unitOrigin = (u: Pick<TitleUnit, 'left' | 'width' | 'baseline'>, px: number) => ({ x: u.left + u.width / 2, y: u.baseline - px * 0.34 });
/** Device corners of a posed unit's box (half-height 1.5 font sizes, as the windows), widened by `pad` local px on each side. `m`: block to device. */
export function unitCorners(m: Affine, u: Pick<TitleUnit, 'left' | 'width' | 'baseline'>, p: Pick<UnitPose, 'dx' | 'dy' | 'scale'>, px: number, pad: number): { x: number; y: number }[] {
  const o = unitOrigin(u, px);
  const tx = o.x + p.dx * px, ty = o.y + p.dy * px, s = p.scale;
  const hw = u.width / 2 + pad, hh = px * 1.5 + pad;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => {
    const X = s * lx! + tx, Y = s * ly! + ty;
    return { x: m.a * X + m.c * Y + m.e, y: m.b * X + m.d * Y + m.f };
  });
}
/** The whole-pixel box around `points`, widened by `pad` device px and cut to the W×H frame; null when nothing of it is in the frame. */
export function deviceBox(points: readonly { x: number; y: number }[], pad: number, W: number, H: number): Box | null {
  if (!points.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of points) { if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) continue; x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  if (!Number.isFinite(x0)) return null;
  const L = Math.max(0, Math.floor(x0 - pad)), T = Math.max(0, Math.floor(y0 - pad)), R = Math.min(W, Math.ceil(x1 + pad)), B = Math.min(H, Math.ceil(y1 + pad));
  return R > L && B > T ? { x: L, y: T, w: R - L, h: B - T } : null;
}
/** Space between letters, in px, for a paragraph: tracking × font size, and 0 for a paragraph with Arabic script (its letters join). */
export const paragraphSpacing = (paragraph: string, tracking: number | null | undefined, px: number): number =>
  tracking && !hasArabicScript(paragraph) ? tracking * px : 0;
/** #RRGGBB or #RRGGBBAA as four bytes. */
export function parseColour(c: string): [number, number, number, number] {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(c);
  if (!m) return [0, 0, 0, 255];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}
/** A colour darkened by `f` (0…1): each channel × (1 − f); its opacity kept. */
export function darken(c: string, f: number): string {
  const [r, g, b, a] = parseColour(c), k = 1 - Math.min(1, Math.max(0, f));
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hex(r * k)}${hex(g * k)}${hex(b * k)}${hex(a)}`;
}
/** Line widths: the outline (`stroke`, 2·px·strokeFrac, 0 without a colour) and the second outline outside it; `total` is the outer edge's line width. */
export function outlineWidths(s: Pick<TextStyle, 'stroke' | 'strokeFrac' | 'stroke2'>, px: number): { stroke: number; total: number } {
  const inner = s.stroke && s.strokeFrac > 0 ? s.strokeFrac : 0;
  const stroke = 2 * px * inner;
  return { stroke, total: s.stroke2 ? 2 * px * (inner + s.stroke2.widthFrac) : stroke };
}

// ---------------------------------------------------------------- drawing

const REST_POSE: UnitPose = { alpha: 1, dx: 0, dy: 0, scale: 1 };
/**
 * Places a unit for drawing (the caller has saved the context): its opacity, direction, letter spacing, pose, its windows,
 * the write-on reveal and the blur. Returns the x to draw its text at (y is px·0.34). The calls that the titles before the
 * look fields made are made in the same order, so drawTextUnits uses it too and stays as it was.
 */
export function enterUnit(c: Ctx2D, u: TitleUnit, p: UnitPose, px: number, seam: number, revealPad = px * 0.25): number {
  c.globalAlpha *= p.alpha;
  c.direction = u.dir;
  if (u.spacing) c.letterSpacing = `${u.spacing}px`;
  const middle = u.left + u.width / 2;
  c.translate(middle + p.dx * px, u.baseline + p.dy * px - px * 0.34);
  c.scale(p.scale, p.scale); // about the middle of the unit, a third of the font size above the baseline
  let x = -u.width / 2;
  if (u.window) {
    c.beginPath();
    for (const r of u.window.stretches) c.rect(u.window.lineLeft + r.x - middle - seam, -px * 1.5, r.width + 2 * seam, px * 3);
    c.clip();
    x = u.window.lineLeft - middle;
  }
  if (p.reveal !== undefined && p.reveal < 1) {
    // write-on: a window growing from the side the unit's reading starts on, over its advance and a margin for outlines
    const span = (u.width + 2 * revealPad) * Math.max(0, p.reveal), from = u.dir === 'rtl' ? u.width / 2 + revealPad - span : -u.width / 2 - revealPad;
    c.beginPath();
    c.rect(from, -px * 1.5 - revealPad, span, px * 3 + 2 * revealPad);
    c.clip();
  }
  if (p.blur && p.blur > 0) {
    const t = c.getTransform();
    c.filter = `blur(${(p.blur * px * Math.hypot(t.a, t.b)).toFixed(3)}px)`; // in device px: the filter does not follow the transform
  }
  return x;
}

/** Draws `buf`'s box onto `ctx` in device space, with the context's opacity (the title's). */
function composite(ctx: Ctx2D, buf: Buf, b: Box) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.drawImage(buf.canvas, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
  ctx.restore();
}
/** A grey picture of S in `buf` (opaque black box, S's coverage as grey), ready for 'lighten' smears. */
function greyOfSilhouette(buf: Buf, S: Buf, b: Box) {
  const g = buf.ctx;
  g.fillStyle = '#000000';
  g.fillRect(b.x, b.y, b.w, b.h);
  g.drawImage(S.canvas, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
}
/** Draws `src`'s box onto `dst` at whole-pixel offsets, with `op`, without smoothing, inside the box. */
function stamp(dst: Buf, src: Buf, b: Box, offsets: readonly (readonly [number, number])[], op: GlobalCompositeOperation) {
  const d = dst.ctx;
  d.save();
  d.beginPath(); d.rect(b.x, b.y, b.w, b.h); d.clip();
  d.imageSmoothingEnabled = false;
  d.globalCompositeOperation = op;
  for (const [vx, vy] of offsets) d.drawImage(src.canvas, b.x, b.y, b.w, b.h, b.x + vx, b.y + vy, b.w, b.h);
  d.restore();
}
/** Gives a smeared grey picture its colour: each pixel the colour, with opacity grey × the colour's own (one read-back of the box). */
function tintGrey(buf: Buf, b: Box, colour: string) {
  const [r, g, bl, a] = parseColour(colour);
  const img = buf.ctx.getImageData(b.x, b.y, b.w, b.h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = d[i]!; d[i] = r; d[i + 1] = g; d[i + 2] = bl; d[i + 3] = a === 255 ? v : Math.round((v * a) / 255); }
  buf.ctx.putImageData(img, b.x, b.y);
}

function longShadow(ctx: Ctx2D, S: Buf, b: Box, ls: NonNullable<TextStyle['longShadow']>, lengthPx: number) {
  const G = scratch(TEXT_FX_SLOTS.work, S.canvas.width, S.canvas.height);
  greyOfSilhouette(G, S, b);
  const steps = smearSteps(smearCount(lengthPx, ls.angle)).slice(1);
  // each step puts everything smeared so far again further on; drawn one at a time, since each reads the last
  for (const o of steps) stamp(G, G, b, [smearVector(o, ls.angle)], 'lighten');
  tintGrey(G, b, ls.color);
  composite(ctx, G, b);
}

function extrude(ctx: Ctx2D, S: Buf, b: Box, ex: NonNullable<TextStyle['extrude']>, depthPx: number) {
  const W = S.canvas.width, H = S.canvas.height;
  const { K, layers } = extrudeLayers(depthPx, ex.angle);
  // opacity: the largest coverage of any copy (a grey picture of the layers only, not of S itself)
  const A = scratch(TEXT_FX_SLOTS.work2, W, H);
  A.ctx.fillStyle = '#000000';
  A.ctx.fillRect(b.x, b.y, b.w, b.h);
  stamp(A, S, b, layers.map((l) => [l.dx, l.dy] as const), 'lighten');
  const cover = A.ctx.getImageData(b.x, b.y, b.w, b.h).data;
  // colour: the buckets far to near, each S in its shade
  const C = scratch(TEXT_FX_SLOTS.work, W, H);
  const T = A; // reused for the tinted silhouette
  for (let bucket = K - 1; bucket >= 0; bucket--) {
    const mine = layers.filter((l) => l.bucket === bucket);
    if (!mine.length) continue;
    const t = T.ctx;
    t.save();
    t.setTransform(1, 0, 0, 1, 0, 0); t.globalAlpha = 1; t.globalCompositeOperation = 'source-over';
    t.clearRect(b.x, b.y, b.w, b.h);
    t.drawImage(S.canvas, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = darken(ex.color, bucketShade(ex.shade, bucket, K)).slice(0, 7); // opaque here: the colour's opacity is applied once, below
    t.fillRect(b.x, b.y, b.w, b.h);
    t.restore();
    stamp(C, T, b, mine.map((l) => [l.dx, l.dy] as const), 'source-over');
  }
  const ca = parseColour(ex.color)[3];
  const img = C.ctx.getImageData(b.x, b.y, b.w, b.h), d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i + 3] === 0 ? 0 : ca === 255 ? cover[i]! : Math.round((cover[i]! * ca) / 255);
  C.ctx.putImageData(img, b.x, b.y);
  composite(ctx, C, b);
}

function glow(ctx: Ctx2D, S: Buf, b: Box, gl: NonNullable<TextStyle['glow']>, radiusPx: number) {
  const W = S.canvas.width, H = S.canvas.height;
  const T = scratch(TEXT_FX_SLOTS.work, W, H);
  T.ctx.drawImage(S.canvas, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
  T.ctx.globalCompositeOperation = 'source-in';
  T.ctx.fillStyle = gl.color;
  T.ctx.fillRect(b.x, b.y, b.w, b.h);
  const O = scratch(TEXT_FX_SLOTS.work2, W, H), o = O.ctx;
  o.globalCompositeOperation = 'lighter';
  for (const [k, alpha] of [[0.25, 0.9], [0.5, 0.6], [1, 0.4]] as const) {
    o.filter = `blur(${((radiusPx * k) / 2).toFixed(3)}px)`;
    o.globalAlpha = alpha * gl.intensity;
    o.drawImage(T.canvas, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
  }
  o.filter = 'none'; o.globalAlpha = 1; o.globalCompositeOperation = 'source-over';
  composite(ctx, O, b);
}

/**
 * Paints a title with look fields: `units` with their `poses` (a still title: its lines, at rest), inside the title's
 * transform (compositor2d withTransform: the context's transform maps block coordinates to the frame, its opacity is the
 * title's), after its background box. `note` records a look this browser cannot draw.
 */
export function paintTitle(ctx: Ctx2D, units: readonly TitleUnit[], poses: readonly UnitPose[], style: TextStyle, geo: TitleGeo, note?: TextNote): void {
  const { px } = geo, seam = geo.seam ?? 0;
  const widths = outlineWidths(style, px);
  const canFilter = 'filter' in ctx;
  if (!canFilter && style.glow) note?.('text.glow', "this browser's canvas has no filter, so the glow cannot be drawn");
  if (!canFilter && poses.some((p) => p.blur)) note?.('text.blur', "this browser's canvas has no filter, so the blur cannot be drawn");
  const revealPad = widths.total / 2 + px * 0.25;
  const ls = style.longShadow ?? null, ex = style.extrude ?? null, gl = canFilter ? style.glow ?? null : null;
  if (ls || ex || gl) {
    const m = ctx.getTransform(), scale = Math.hypot(m.a, m.b);
    const lengthPx = ls ? ls.lengthFrac * px * scale : 0, depthPx = ex ? ex.depthFrac * px * scale : 0, glowPx = gl ? gl.radiusFrac * px * scale : 0;
    const points = units.flatMap((u, i) => (poses[i]!.alpha > 0 ? unitCorners(m, u, poses[i]!, px, px * 0.25) : []));
    const blurPad = Math.max(0, ...poses.map((p) => (p.alpha > 0 && p.blur ? 3 * p.blur * px * p.scale : 0))) * scale;
    const box = deviceBox(points, (widths.total / 2) * scale + depthPx + lengthPx + 3 * glowPx + blurPad + 2, geo.width, geo.height);
    if (box) {
      // the silhouette S: every posed unit in opaque white, outlined at the outer edge
      const S = scratch(TEXT_FX_SLOTS.silhouette, geo.width, geo.height), s = S.ctx;
      s.setTransform(m);
      s.font = ctx.font; s.textBaseline = 'alphabetic'; s.textAlign = 'left'; s.lineJoin = 'round';
      s.fillStyle = '#FFFFFF'; s.strokeStyle = '#FFFFFF'; s.lineWidth = widths.total;
      units.forEach((u, i) => {
        const p = poses[i]!;
        if (p.alpha <= 0) return;
        s.save();
        s.letterSpacing = '0px';
        const x = enterUnit(s, u, p, px, seam, revealPad);
        if (widths.total > 0) s.strokeText(u.text, x, px * 0.34);
        s.fillText(u.text, x, px * 0.34);
        s.restore();
      });
      if (ls) longShadow(ctx, S, box, ls, lengthPx);
      if (ex) extrude(ctx, S, box, ex, depthPx);
      if (gl) glow(ctx, S, box, gl, glowPx);
    }
  }
  const gradient = style.gradient ? gradientLine(style.gradient.angle, geo.ink) : null;
  const paint = (outline: boolean) => units.forEach((u, i) => {
    const p = poses[i]!;
    if (p.alpha <= 0) return;
    ctx.save();
    const x = enterUnit(ctx, u, p, px, seam, revealPad);
    if (outline) ctx.strokeText(u.text, x, px * 0.34);
    else {
      if (gradient && style.gradient) {
        const g = unitGradientLine(gradient, unitOrigin(u, px));
        const fill = ctx.createLinearGradient(g.x0, g.y0, g.x1, g.y1);
        const n = style.gradient.colors.length;
        style.gradient.colors.forEach((c, k) => fill.addColorStop(n > 1 ? k / (n - 1) : 0, c));
        ctx.fillStyle = fill;
      }
      ctx.fillText(u.text, x, px * 0.34);
    }
    ctx.restore();
  });
  if (style.stroke2) { ctx.strokeStyle = style.stroke2.color; ctx.lineWidth = widths.total; paint(true); }
  if (style.stroke && style.strokeFrac > 0) { ctx.strokeStyle = style.stroke; ctx.lineWidth = widths.stroke; paint(true); }
  ctx.fillStyle = style.color;
  paint(false);
}

/** The lines of a still title as units at rest (compositor2d drawText's placement). */
export function restPoses(n: number): UnitPose[] { return Array.from({ length: n }, () => ({ ...REST_POSE })); }
