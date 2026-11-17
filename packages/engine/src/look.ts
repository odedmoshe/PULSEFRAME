/**
 * Canvas2D implementation of the effect, mask, blend and transition registries (packages/core/src/effects.ts).
 * One implementation for preview, stills and export. Lengths are fractions of the output height.
 *
 * Order for a layer with a look:  place (transform, opacity) -> effects in list order -> mask -> transition -> blend onto the frame.
 * Conventions: 8-bit sRGB, non-linear blending as defined by Canvas2D composite operations (no linear-light intermediates).
 */
import type { BeatPosition, BlendMode, Mask } from '@pulseframe/core';
import type { LayerLook } from './evaluate.ts';
import { gpuEffect, isGpuEffect, type LutStrip } from './gpu.ts';
import { boundRadius, overlayParticles, shapeAlpha, speedLines, wedgeCorners, type Particle } from './overlays.ts';
import { STAMP_TEXT, stampPolygons } from './stamp.ts';

type C2D = OffscreenCanvasRenderingContext2D;
export interface Buf { canvas: OffscreenCanvas; ctx: C2D }
/** Geometry of the placed layer, so layer-relative effects and masks follow its transform. */
export interface LayerBox { cx: number; cy: number; w: number; h: number; rotation: number; scale: number }
export interface LookEnv { width: number; height: number; frameIndex: number; /** Timeline time of the frame in seconds. */ seconds: number; /** Clip-local seconds of the frame (bursts at the clip start). */ local?: number; box: LayerBox; /** Where the frame falls in the beats of the music playing there, if any (core beatgrid.ts). */ beat?: BeatPosition | null; /** Colour tables of this frame by asset id (null = could not be supplied; the reason is in `lutReasons`). Filled by drawGraph for color.lut. */ luts?: ReadonlyMap<string, LutStrip | null>; lutReasons?: ReadonlyMap<string, string> }

const pools = new Map<string, Buf[]>();
/** Scratch buffer `slot` of the given size, cleared and reset. Buffers are reused across frames (bounded: a few per size). */
export function scratch(slot: number, width: number, height: number): Buf {
  const key = `${width}x${height}`;
  let pool = pools.get(key);
  if (!pool) { if (pools.size > 12) pools.clear(); pool = []; pools.set(key, pool); }
  let b = pool[slot];
  if (!b) {
    const canvas = new OffscreenCanvas(width, height);
    b = pool[slot] = { canvas, ctx: canvas.getContext('2d')! };
  }
  const x = b.ctx;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.filter = 'none';
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.clearRect(0, 0, width, height);
  return b;
}

export const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', 'soft-light': 'soft-light', 'hard-light': 'hard-light', add: 'lighter',
  difference: 'difference', exclusion: 'exclusion', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn',
  hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
};

const n = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const hexRgba = (hex: unknown, alpha: number) => { const h = typeof hex === 'string' ? hex : '#000000'; return `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${alpha})`; };

/** CSS filter text for filter-class effects, or null for layer-class effects. `blurPx` reports the largest blur so the caller can pad edges. */
function filterOf(type: string, p: Record<string, unknown>, H: number): { css: string; blurPx: number } | null {
  switch (type) {
    case 'color.adjust': return { css: `brightness(${n(p.brightness, 1)}) contrast(${n(p.contrast, 1)}) saturate(${n(p.saturation, 1)}) hue-rotate(${n(p.hue)}deg)`, blurPx: 0 };
    case 'color.grayscale': return { css: `grayscale(${n(p.amount, 1)})`, blurPx: 0 };
    case 'color.sepia': return { css: `sepia(${n(p.amount, 1)})`, blurPx: 0 };
    case 'color.invert': return { css: `invert(${n(p.amount, 1)})`, blurPx: 0 };
    case 'blur.gaussian': { const r = n(p.radius) * H; return { css: `blur(${r.toFixed(3)}px)`, blurPx: r }; }
    case 'stylize.shadow': return { css: `drop-shadow(${(n(p.x) * H).toFixed(3)}px ${(n(p.y) * H).toFixed(3)}px ${(n(p.blur) * H).toFixed(3)}px ${hexRgba(p.color, n(p.opacity, 0.6))})`, blurPx: 0 };
    default: return null;
  }
}

/**
 * Draw `src` through a CSS filter into `dst`. A blur samples beyond the frame; Canvas2D treats that as transparent, which would
 * darken the edges of a full-frame picture. So the frame's edge pixels are extended into a margin first (clamp-to-edge);
 * a floating layer has transparent edges and is unaffected.
 */
function drawFiltered(dst: C2D, src: OffscreenCanvas, css: string, blurPx: number, W: number, H: number) {
  if (blurPx <= 0.01) { dst.filter = css; dst.drawImage(src, 0, 0); dst.filter = 'none'; return; }
  const P = Math.min(Math.ceil(blurPx * 3), Math.ceil(H / 2));
  const pad = scratch(0, W + 2 * P, H + 2 * P);
  const x = pad.ctx;
  x.imageSmoothingEnabled = false;
  x.drawImage(src, P, P);
  x.drawImage(src, 0, 0, W, 1, P, 0, W, P); // top
  x.drawImage(src, 0, H - 1, W, 1, P, P + H, W, P); // bottom
  x.drawImage(src, 0, 0, 1, H, 0, P, P, H); // left
  x.drawImage(src, W - 1, 0, 1, H, P + W, P, P, H); // right
  x.drawImage(src, 0, 0, 1, 1, 0, 0, P, P);
  x.drawImage(src, W - 1, 0, 1, 1, P + W, 0, P, P);
  x.drawImage(src, 0, H - 1, 1, 1, 0, P + H, P, P);
  x.drawImage(src, W - 1, H - 1, 1, 1, P + W, P + H, P, P);
  dst.filter = css;
  dst.drawImage(pad.canvas, -P, -P);
  dst.filter = 'none';
}

// ---- seeded noise (deterministic: the tile depends only on the seed, the offset only on seed + frame index) ----
const mulberry32 = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const TILE = 256;
const tiles = new Map<number, OffscreenCanvas>();
function noiseTile(seed: number): OffscreenCanvas {
  let c = tiles.get(seed);
  if (c) return c;
  if (tiles.size > 8) tiles.clear();
  c = new OffscreenCanvas(TILE, TILE);
  const x = c.getContext('2d')!;
  const img = x.createImageData(TILE, TILE);
  const rnd = mulberry32(seed * 2654435761);
  for (let i = 0; i < TILE * TILE; i++) { const v = Math.floor(rnd() * 256); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  tiles.set(seed, c);
  return c;
}
/** Noise offset for a frame: a pure function of (seed, frameIndex). Exported for tests. */
export function grainOffset(seed: number, frameIndex: number): { x: number; y: number } {
  const r = mulberry32((seed * 73856093) ^ (frameIndex * 19349663));
  return { x: Math.floor(r() * TILE), y: Math.floor(r() * TILE) };
}

/** Keep the alpha shape of `shape` on `dst` (effects must not paint outside the layer). */
const clipTo = (dst: C2D, shape: OffscreenCanvas) => { dst.globalCompositeOperation = 'destination-in'; dst.globalAlpha = 1; dst.drawImage(shape, 0, 0); dst.globalCompositeOperation = 'source-over'; };
const inLayerSpace = (x: C2D, box: LayerBox) => { x.translate(box.cx, box.cy); x.rotate((box.rotation * Math.PI) / 180); x.scale(box.scale, box.scale); };

// ---- overlay sprites (ADR-0011): one small picture per shape, colour and radius bucket, drawn with drawImage ----
/**
 * Sprite pixels are computed here in JavaScript from overlays.ts shapeAlpha (4×4 samples a pixel), never rasterised by the
 * canvas, so every canvas (the editor's, the render worker's) holds the same sprite to the bit; only the bilinear placement
 * at a fractional position is the canvas's own. If preview and stills ever disagree beyond SPEC §8's tolerance on a machine,
 * SNAP_TO_PIXELS places unrotated sprites on whole pixels instead (plan risk 4); the overlays proof measures it.
 */
const SNAP_TO_PIXELS = false;
const SPRITE_BUCKET = 0.25;
const SPRITE_LIMIT = 192;
const sprites = new Map<string, { canvas: OffscreenCanvas; half: number }>();
const rgbOf = (hex: string) => (/^#[0-9a-fA-F]{6}$/.test(hex) ? [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] : [255, 255, 255]);
function spriteOf(shape: Particle['shape'], colour: string, r: number) {
  const rb = Math.max(SPRITE_BUCKET, Math.round(r / SPRITE_BUCKET) * SPRITE_BUCKET);
  const key = `${shape}|${colour}|${rb}`;
  let s = sprites.get(key);
  if (s) return s;
  if (sprites.size >= SPRITE_LIMIT) sprites.clear(); // bounded, like the noise tiles: rebuilt on demand
  const half = Math.ceil(boundRadius({ r: rb, shape }) + 1.5), side = 2 * half;
  const canvas = new OffscreenCanvas(side, side);
  const x = canvas.getContext('2d')!;
  const img = x.createImageData(side, side);
  const [cr, cg, cb] = rgbOf(colour);
  for (let py = 0; py < side; py++) for (let px = 0; px < side; px++) {
    let a = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) a += shapeAlpha(shape, (px + (sx + 0.5) / 4 - half) / rb, (py + (sy + 0.5) / 4 - half) / rb);
    const o = (py * side + px) * 4;
    img.data[o] = cr!; img.data[o + 1] = cg!; img.data[o + 2] = cb!; img.data[o + 3] = Math.round((a / 16) * 255);
  }
  x.putImageData(img, 0, 0);
  s = { canvas, half };
  sprites.set(key, s);
  return s;
}
function drawParticles(x: C2D, parts: readonly Particle[]) {
  x.save();
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'low'; // plain bilinear placement: the same arithmetic on every canvas
  for (const q of parts) {
    if (!(q.alpha > 0) || !(q.r > 0)) continue;
    const s = spriteOf(q.shape, q.colour, q.r);
    x.globalAlpha = Math.min(1, q.alpha);
    if (q.rot) { const c = Math.cos(q.rot), sn = Math.sin(q.rot); x.setTransform(c, sn, -sn, c, q.x, q.y); x.drawImage(s.canvas, -s.half, -s.half); }
    else {
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.drawImage(s.canvas, SNAP_TO_PIXELS ? Math.round(q.x - s.half) : q.x - s.half, SNAP_TO_PIXELS ? Math.round(q.y - s.half) : q.y - s.half);
    }
  }
  x.restore();
}
/** Overlay particles over the layer: over the whole frame buffer (area=frame), or kept to the layer's shape (area=layer). */
function overlay(type: string, p: Record<string, unknown>, src: OffscreenCanvas, dst: C2D, env: LookEnv) {
  const { width: W, height: H } = env;
  dst.drawImage(src, 0, 0);
  const parts = overlayParticles(type, p as Record<string, number | string | boolean>, W, H, env.seconds, env.local ?? 0, env.beat ?? null);
  if (!parts.length) return;
  const op: GlobalCompositeOperation = type === 'overlay.bokeh' ? 'lighter' : 'source-over'; // light adds to what is behind it
  if (p.area === 'layer') {
    const own = scratch(9, W, H);
    own.ctx.globalCompositeOperation = op;
    drawParticles(own.ctx, parts);
    clipTo(own.ctx, src);
    dst.globalCompositeOperation = op;
    dst.drawImage(own.canvas, 0, 0);
    dst.globalCompositeOperation = 'source-over';
    return;
  }
  dst.globalCompositeOperation = op;
  drawParticles(dst, parts);
  dst.globalCompositeOperation = 'source-over';
}

function layerEffect(type: string, p: Record<string, unknown>, src: OffscreenCanvas, dst: C2D, env: LookEnv) {
  const { width: W, height: H } = env;
  switch (type) {
    case 'color.tint':
      dst.drawImage(src, 0, 0);
      dst.globalCompositeOperation = (typeof p.mode === 'string' ? p.mode : 'color') as GlobalCompositeOperation;
      dst.globalAlpha = n(p.amount, 0.35);
      dst.fillStyle = typeof p.color === 'string' ? p.color : '#FF7A00';
      dst.fillRect(0, 0, W, H);
      clipTo(dst, src);
      return;
    case 'light.vignette': {
      dst.drawImage(src, 0, 0);
      dst.save();
      inLayerSpace(dst, env.box);
      const half = Math.hypot(env.box.w, env.box.h) / 2;
      const grad = dst.createRadialGradient(0, 0, half * n(p.size, 0.45), 0, 0, half);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${n(p.amount, 0.5)})`);
      dst.globalCompositeOperation = 'source-atop';
      dst.fillStyle = grad;
      dst.fillRect(-env.box.w / 2, -env.box.h / 2, env.box.w, env.box.h);
      dst.restore();
      return;
    }
    case 'light.diffusion': {
      const glow = scratch(3, W, H);
      const r = n(p.radius, 0.02) * H;
      drawFiltered(glow.ctx, src, `blur(${r.toFixed(3)}px)`, r, W, H);
      dst.drawImage(src, 0, 0);
      dst.globalCompositeOperation = 'screen';
      dst.globalAlpha = n(p.amount, 0.5);
      dst.drawImage(glow.canvas, 0, 0);
      return;
    }
    case 'stylize.pixelate': {
      const block = Math.max(1, n(p.size, 0.02) * H);
      const cols = Math.max(1, Math.ceil(W / block)), rows = Math.max(1, Math.ceil(H / block));
      const small = scratch(0, cols, rows);
      small.ctx.drawImage(src, 0, 0, W, H, 0, 0, W / block, H / block);
      dst.imageSmoothingEnabled = false;
      dst.drawImage(small.canvas, 0, 0, cols, rows, 0, 0, cols * block, rows * block);
      dst.imageSmoothingEnabled = true;
      return;
    }
    case 'stylize.grain': {
      dst.drawImage(src, 0, 0);
      const seed = n(p.seed, 1);
      const off = grainOffset(seed, env.frameIndex);
      const pattern = dst.createPattern(noiseTile(seed), 'repeat')!;
      const k = H / 1080; // one noise cell is 1/1080 of the frame height at every output size
      dst.save();
      dst.globalCompositeOperation = 'overlay';
      dst.globalAlpha = n(p.amount, 0.25);
      dst.scale(k, k);
      dst.translate(-off.x, -off.y);
      dst.fillStyle = pattern;
      dst.fillRect(off.x, off.y, W / k, H / k);
      dst.restore();
      clipTo(dst, src);
      return;
    }
    case 'digital.rgb-split': {
      const d = n(p.amount, 0.006) * H, a = (n(p.angle) * Math.PI) / 180;
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d;
      dst.globalCompositeOperation = 'lighter';
      for (const [color, ox, oy] of [['#ff0000', dx, dy], ['#00ff00', 0, 0], ['#0000ff', -dx, -dy]] as const) {
        const ch = scratch(3, W, H);
        ch.ctx.drawImage(src, 0, 0);
        ch.ctx.globalCompositeOperation = 'multiply';
        ch.ctx.fillStyle = color;
        ch.ctx.fillRect(0, 0, W, H);
        clipTo(ch.ctx, src);
        dst.drawImage(ch.canvas, ox, oy);
      }
      dst.globalCompositeOperation = 'source-over';
      return;
    }
    case 'overlay.snow':
    case 'overlay.confetti':
    case 'overlay.hearts':
    case 'overlay.bokeh':
      overlay(type, p, src, dst, env);
      return;
    case 'overlay.speed-lines': {
      dst.drawImage(src, 0, 0);
      const { cx, cy, lines } = speedLines(p as Record<string, number | string | boolean>, W, H, env.seconds);
      if (!lines.length) return;
      dst.save();
      dst.globalAlpha = Math.min(1, Math.max(0, n(p.amount, 0.7)));
      dst.fillStyle = typeof p.color === 'string' ? p.color : '#FFFFFF';
      dst.beginPath(); // one path: wedges that touch are one shape, never painted twice
      for (const s of lines) { const [t, a, b] = wedgeCorners(cx, cy, s); dst.moveTo(t[0], t[1]); dst.lineTo(a[0], a[1]); dst.lineTo(b[0], b[1]); dst.closePath(); }
      dst.fill();
      dst.restore();
      return;
    }
    case 'stylize.date-stamp': {
      dst.drawImage(src, 0, 0);
      const text = typeof p.text === 'string' ? p.text : '';
      if (!STAMP_TEXT.test(text)) return; // refused by the effect's schema before it can be stored; never drawn as something else
      const sizePx = n(p.size, 0.045) * H;
      const corner = (['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const).find((c) => c === p.corner) ?? 'bottom-right';
      const polys = stampPolygons(text, sizePx, corner, env.box.w, env.box.h);
      if (!polys.length) return;
      dst.save();
      inLayerSpace(dst, env.box); // in the corner of the picture, moving and scaling with it
      dst.translate(-env.box.w / 2, -env.box.h / 2);
      const glow = Math.min(1, Math.max(0, n(p.glow, 0.5)));
      dst.shadowBlur = glow * 0.25 * sizePx; // device pixels: glow·0.25·size·H
      dst.shadowColor = glow > 0 ? hexRgba(p.color, 0.9) : 'rgba(0,0,0,0)';
      dst.fillStyle = typeof p.color === 'string' ? p.color : '#FF9A2E';
      dst.beginPath();
      for (const poly of polys) { poly.forEach((q, i) => (i ? dst.lineTo(q.x, q.y) : dst.moveTo(q.x, q.y))); dst.closePath(); }
      dst.fill();
      dst.restore();
      return;
    }
    default:
      // Unknown effect: validation and export preflight refuse it; drawing it would be a silent substitution, so pass through unchanged.
      dst.drawImage(src, 0, 0);
  }
}

/** Run the effect list. `a` holds the placed layer; returns the buffer holding the result (ping-pong between slots 1 and 2). */
/** True when the list holds an effect that runs as a GPU pass, which makes applying it asynchronous. */
export const hasGpuEffect = (effects: NonNullable<LayerLook['effects']>) => effects.some((e) => isGpuEffect(e.type));
export async function applyEffects(a: Buf, effects: NonNullable<LayerLook['effects']>, env: LookEnv): Promise<Buf> {
  let cur = a;
  let slot = 2;
  for (let i = 0; i < effects.length; ) {
    const next = scratch(slot, env.width, env.height);
    const f = filterOf(effects[i]!.type, effects[i]!.params, env.height);
    if (f) {
      // Merge a run of filter-class effects into one pass (same result as applying them in order).
      let css = f.css, blur = f.blurPx;
      i++;
      for (; i < effects.length; i++) { const g = filterOf(effects[i]!.type, effects[i]!.params, env.height); if (!g) break; css += ` ${g.css}`; blur = Math.max(blur, g.blurPx); }
      drawFiltered(next.ctx, cur.canvas, css, blur, env.width, env.height);
    } else if (isGpuEffect(effects[i]!.type)) {
      // Not available (no adapter, or the reference check failed): the layer goes on unchanged and the effect is recorded as missing.
      if (!(await gpuEffect(effects[i]!.type, effects[i]!.params, cur.canvas, next.ctx, env))) next.ctx.drawImage(cur.canvas, 0, 0);
      i++;
    } else {
      layerEffect(effects[i]!.type, effects[i]!.params, cur.canvas, next.ctx, env);
      i++;
    }
    cur = next;
    slot = slot === 2 ? 1 : 2;
  }
  return cur;
}

/** Keep (or with invert, remove) the masked region of `buf`. The mask is defined in the layer's own space. */
export function applyMask(buf: Buf, mask: Mask, env: LookEnv) {
  const { width: W, height: H, box } = env;
  let m = scratch(4, W, H);
  m.ctx.save();
  inLayerSpace(m.ctx, box);
  m.ctx.fillStyle = '#fff';
  const w = mask.width * box.w, h = mask.height * box.h, cx = mask.x * box.w, cy = mask.y * box.h;
  m.ctx.beginPath();
  if (mask.shape === 'ellipse') m.ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  else m.ctx.roundRect(cx - w / 2, cy - h / 2, w, h, (mask.radius * Math.min(w, h)) / 2);
  m.ctx.fill();
  m.ctx.restore();
  if (mask.feather > 0) {
    const soft = scratch(5, W, H);
    soft.ctx.filter = `blur(${(mask.feather * H).toFixed(3)}px)`;
    soft.ctx.drawImage(m.canvas, 0, 0);
    soft.ctx.filter = 'none';
    m = soft;
  }
  buf.ctx.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in';
  buf.ctx.globalAlpha = 1;
  buf.ctx.drawImage(m.canvas, 0, 0);
  buf.ctx.globalCompositeOperation = 'source-over';
}

const DIR: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
/**
 * Composite a finished layer buffer onto the frame, applying its transition state and blend mode.
 * `outgoing` is the previous clip's finished buffer when this layer is the incoming side of a transition.
 */
export function compositeLayer(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, layer: Buf, look: LayerLook, W: number, H: number, outgoing: Buf | null) {
  const t = look.transition;
  ctx.save();
  ctx.globalCompositeOperation = COMPOSITE[look.blend ?? 'normal'];
  if (!t) { ctx.drawImage(layer.canvas, 0, 0); ctx.restore(); return; }
  const p = t.progress;
  const [kind, dirName] = t.type.split('-') as [string, string | undefined];
  if (kind === 'dissolve' || kind === 'zoom') {
    // Exact cross-fade: out*(1-p) + in*p, mixed additively in a buffer so two opaque pictures never dip toward the background.
    const mix = scratch(6, W, H);
    if (outgoing) { mix.ctx.globalAlpha = 1 - p; mix.ctx.drawImage(outgoing.canvas, 0, 0); mix.ctx.globalCompositeOperation = 'lighter'; }
    mix.ctx.globalAlpha = p;
    if (kind === 'zoom') { const s = 1.3 - 0.3 * p; mix.ctx.translate(W / 2, H / 2); mix.ctx.scale(s, s); mix.ctx.translate(-W / 2, -H / 2); }
    mix.ctx.drawImage(layer.canvas, 0, 0);
    ctx.drawImage(mix.canvas, 0, 0);
  } else if (kind === 'dip') {
    const first = p < 0.5;
    const shown = first ? outgoing : layer;
    if (shown) ctx.drawImage(shown.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = first ? p * 2 : (1 - p) * 2;
    ctx.fillStyle = dirName === 'white' ? '#ffffff' : '#000000';
    ctx.fillRect(0, 0, W, H);
  } else if (kind === 'wipe') {
    if (outgoing) ctx.drawImage(outgoing.canvas, 0, 0);
    const [dx, dy] = DIR[dirName ?? 'left']!;
    ctx.beginPath();
    // The reveal edge travels in the named direction: "wipe-left" starts at the right edge and moves left.
    if (dx !== 0) ctx.rect(dx < 0 ? W * (1 - p) : 0, 0, W * p, H);
    else ctx.rect(0, dy < 0 ? H * (1 - p) : 0, W, H * p);
    ctx.clip();
    ctx.drawImage(layer.canvas, 0, 0);
  } else if (kind === 'push') {
    const [dx, dy] = DIR[dirName ?? 'left']!;
    if (outgoing) ctx.drawImage(outgoing.canvas, dx * W * p, dy * H * p);
    ctx.drawImage(layer.canvas, -dx * W * (1 - p), -dy * H * (1 - p));
  } else ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}

// ---- colour matrix correction for sources read with the wrong YCbCr matrix ----
/**
 * The 3×3 matrix that turns RGB decoded with the BT.709 matrix into the RGB the same YCbCr data gives with the BT.601 matrix.
 * (Both use the same quantisation, so the offsets cancel and the correction is linear in the encoded RGB values.)
 */
export const BT709_AS_BT601: readonly number[] = (() => {
  const toYcc = (kr: number, kb: number) => { const kg = 1 - kr - kb; return [[kr, kg, kb], [-kr / (2 * (1 - kb)), -kg / (2 * (1 - kb)), 0.5], [0.5, -kg / (2 * (1 - kr)), -kb / (2 * (1 - kr))]]; };
  const toRgb = (kr: number, kb: number) => { const kg = 1 - kr - kb; return [[1, 0, 2 * (1 - kr)], [1, (-2 * kb * (1 - kb)) / kg, (-2 * kr * (1 - kr)) / kg], [1, 2 * (1 - kb), 0]]; };
  const a = toRgb(0.299, 0.114), b = toYcc(0.2126, 0.0722);
  const m: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m.push(a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!);
  return m;
})();
/** Apply a 3×3 colour matrix to every pixel of a buffer, in place (alpha untouched). */
export function applyColourMatrix(buf: Buf, m: readonly number[]): void {
  const { width, height } = buf.canvas;
  const img = buf.ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    d[i] = m[0]! * r + m[1]! * g + m[2]! * b; // Uint8ClampedArray rounds and clamps
    d[i + 1] = m[3]! * r + m[4]! * g + m[5]! * b;
    d[i + 2] = m[6]! * r + m[7]! * g + m[8]! * b;
  }
  buf.ctx.putImageData(img, 0, 0);
}

