/**
 * Canvas2D reference compositor (Phase 0). One implementation draws the editor preview,
 * agent stills and export frames; export runs it in a pinned headless Chromium.
 *
 * Conventions: sRGB 8-bit, straight-alpha canvas source-over compositing, SDR Rec.709 assumed for sources.
 * Text is shaped by the browser engine (HarfBuzz inside Chromium) using a bundled, pinned font file.
 */
import type { Layer, PictureLayer, RenderGraph, TextLayer } from './evaluate.ts';
import { visualOrder, wrapWords, type CaptionLayer } from './captions.ts';
import { applyEffects, applyMask, compositeLayer, scratch, type Buf, type LayerBox } from './look.ts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Something that can paint a decoded source frame into a rectangle. */
export interface FrameImage { draw(ctx: Ctx2D, dx: number, dy: number, dw: number, dh: number): void }
export type FrameProvider = (layer: PictureLayer) => Promise<FrameImage | null>;

/** Text wraps at this fraction of the frame width (before the layer's own scale). */
export const TEXT_MAX_WIDTH_FRAC = 0.9;
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-ࣿיִ-﷿ﹰ-﻿]/;
/** First-strong-character paragraph direction (UAX #9 P2/P3, simplified to the scripts we bundle fonts for). */
export function resolveDirection(text: string, dir: 'auto' | 'rtl' | 'ltr'): 'rtl' | 'ltr' {
  if (dir !== 'auto') return dir;
  const m = STRONG.exec(text);
  return m && RTL.test(m[0]) ? 'rtl' : 'ltr';
}

function withTransform(ctx: Ctx2D, g: RenderGraph, layer: Exclude<Layer, CaptionLayer>, body: () => void) {
  const t = layer.transform;
  ctx.save();
  ctx.globalAlpha = t.opacity;
  ctx.translate(g.width / 2 + t.x * g.width, g.height / 2 + t.y * g.height);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scale, t.scale);
  body();
  ctx.restore();
}

function drawText(ctx: Ctx2D, g: RenderGraph, layer: TextLayer) {
  const s = layer.style;
  const px = s.sizeFrac * g.height;
  ctx.font = `${s.fontWeight} ${px}px "${s.fontFamily}"`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const lineH = px * s.lineHeight;
  // Line breaking happens in logical order, per paragraph, before bidi reordering (UAX #9 L1/UAX #14 order).
  // Every wrapped line keeps its paragraph's base direction. Words are never split; an over-long word overflows.
  const maxWidth = (g.width * TEXT_MAX_WIDTH_FRAC) / layer.transform.scale;
  const measured: { line: string; dir: 'rtl' | 'ltr'; width: number }[] = [];
  for (const paragraph of layer.text.split('\n')) {
    const dir = resolveDirection(paragraph, s.direction);
    ctx.direction = dir;
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        measured.push({ line, dir, width: ctx.measureText(line).width });
        line = word;
      } else line = candidate;
    }
    measured.push({ line, dir, width: ctx.measureText(line).width });
  }
  const lines = measured;
  const blockW = Math.max(1, ...measured.map((m) => m.width));
  const blockH = lineH * lines.length;
  withTransform(ctx, g, layer, () => {
    if (s.background) {
      const pad = px * 0.25;
      ctx.fillStyle = s.background;
      ctx.beginPath();
      ctx.roundRect(-blockW / 2 - pad, -blockH / 2 - pad * 0.6, blockW + pad * 2, blockH + pad * 1.2, px * 0.18);
      ctx.fill();
    }
    measured.forEach((m, i) => {
      ctx.direction = m.dir;
      // "start" is the right edge for RTL lines and the left edge for LTR lines.
      const startIsRight = m.dir === 'rtl';
      const left =
        s.align === 'center' ? -m.width / 2 : (s.align === 'start') === startIsRight ? blockW / 2 - m.width : -blockW / 2;
      // With direction=rtl and textAlign=left the x coordinate is still the left edge of the run.
      const baseline = -blockH / 2 + lineH * i + lineH / 2 + px * 0.34;
      if (s.stroke && s.strokeFrac > 0) {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = px * s.strokeFrac * 2;
        ctx.strokeText(m.line, left, baseline);
      }
      ctx.fillStyle = s.color;
      ctx.fillText(m.line, left, baseline);
    });
  });
}

/** Captions: words are placed one by one (so each can be highlighted) in word-level bidi visual order. */
function drawCaption(ctx: Ctx2D, g: RenderGraph, layer: CaptionLayer) {
  const s = layer.style;
  let words = layer.words;
  if (s.preset === 'word-pop' && words.some((w) => w.state !== 'plain')) {
    // One word at a time: the word being spoken, else the last one spoken (held through pauses).
    const cur = words.find((w) => w.state === 'current') ?? [...words].reverse().find((w) => w.state === 'past');
    words = cur ? [{ text: cur.text, state: 'current' }] : [];
  }
  if (words.length === 0) return;
  const px = s.sizeFrac * g.height * (s.preset === 'word-pop' ? 1.35 : 1);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.font = `${s.fontWeight} ${px}px "${s.fontFamily}"`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const base = resolveDirection(words.map((w) => w.text).join(' '), s.direction);
  ctx.direction = base;
  const widths = words.map((w) => ctx.measureText(w.text).width);
  const space = ctx.measureText(' ').width;
  const lines = wrapWords(widths, space, g.width * TEXT_MAX_WIDTH_FRAC);
  const lineH = px * 1.25;
  const lineW = lines.map((l) => l.reduce((n, i) => n + widths[i]!, 0) + space * (l.length - 1));
  const blockW = Math.max(...lineW), blockH = lineH * lines.length;
  const pad = px * 0.3;
  const margin = s.marginFrac * g.height;
  const top = s.position === 'top' ? margin + pad : s.position === 'center' ? (g.height - blockH) / 2 : g.height - margin - pad - blockH;
  if (s.background) {
    ctx.fillStyle = s.background;
    ctx.beginPath();
    ctx.roundRect(g.width / 2 - blockW / 2 - pad, top - pad * 0.7, blockW + pad * 2, blockH + pad * 1.4, px * 0.2);
    ctx.fill();
  }
  lines.forEach((line, li) => {
    const order = visualOrder(line.map((i) => words[i]!.text), base);
    let x = g.width / 2 - lineW[li]! / 2;
    const baseline = top + lineH * li + lineH / 2 + px * 0.34;
    for (const k of order) {
      const i = line[k]!, w = words[i]!;
      const lit = w.state === 'current' || (s.preset === 'karaoke' && w.state === 'past');
      if (s.preset === 'box-highlight' && w.state === 'current') {
        ctx.fillStyle = s.highlightColor;
        ctx.beginPath();
        ctx.roundRect(x - px * 0.12, baseline - px * 0.92, widths[i]! + px * 0.24, px * 1.22, px * 0.16);
        ctx.fill();
      }
      if (s.stroke && s.strokeFrac > 0) {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = px * s.strokeFrac * 2;
        ctx.strokeText(w.text, x, baseline);
      }
      ctx.fillStyle = lit && s.preset !== 'box-highlight' && s.preset !== 'classic' ? s.highlightColor : s.color;
      ctx.fillText(w.text, x, baseline);
      x += widths[i]! + space;
    }
  });
  ctx.restore();
}

/** Draw one evaluated frame. Awaits source frames; drawing order equals graph.layers order. */
export async function drawGraph(ctx: Ctx2D, g: RenderGraph, frames: FrameProvider): Promise<{ missing: string[] }> {
  const missing: string[] = [];
  const images = await Promise.all(g.layers.map((l) => (l.kind === 'text' || l.kind === 'caption' ? null : frames(l))));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g.background;
  ctx.fillRect(0, 0, g.width, g.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  /** Finished buffer of the outgoing side of a transition, waiting for its incoming layer (the next layer in the graph). */
  let outgoing: Buf | null = null;
  g.layers.forEach((layer, i) => {
    if (layer.kind === 'caption') return drawCaption(ctx, g, layer);
    const img = layer.kind === 'text' ? null : images[i];
    if (layer.kind !== 'text' && !img) { missing.push(layer.clipId); return; }
    // Default placement of pictures: fit (contain) inside the frame, centred.
    const fit = layer.kind === 'text' ? 1 : Math.min(g.width / layer.sourceWidth, g.height / layer.sourceHeight);
    const w = layer.kind === 'text' ? g.width : layer.sourceWidth * fit;
    const h = layer.kind === 'text' ? g.height : layer.sourceHeight * fit;
    const place = (c: Ctx2D) => (layer.kind === 'text' ? drawText(c, g, layer) : withTransform(c, g, layer, () => img!.draw(c, -w / 2, -h / 2, w, h)));
    const hasLook = !!(layer.effects?.length || layer.mask || layer.transition || (layer.blend && layer.blend !== 'normal'));
    if (!hasLook) return place(ctx); // fast path: identical to drawing without the look system
    const t = layer.transform;
    const box: LayerBox = { cx: g.width / 2 + t.x * g.width, cy: g.height / 2 + t.y * g.height, w, h, rotation: t.rotation, scale: t.scale };
    const env = { width: g.width, height: g.height, frameIndex: g.frameIndex, box };
    let buf = scratch(1, g.width, g.height);
    place(buf.ctx);
    if (layer.effects?.length) buf = applyEffects(buf, layer.effects, env);
    if (layer.mask) applyMask(buf, layer.mask, env);
    if (layer.transition?.role === 'out') {
      // Keep the outgoing picture aside; its incoming partner composites both.
      const keep = scratch(7, g.width, g.height);
      keep.ctx.drawImage(buf.canvas, 0, 0);
      outgoing = keep;
      return;
    }
    compositeLayer(ctx, buf, layer, g.width, g.height, layer.transition ? outgoing : null);
    outgoing = null;
  });
  ctx.restore();
  return { missing };
}
