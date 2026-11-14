/**
 * Canvas2D reference compositor (Phase 0). One implementation draws the editor preview,
 * agent stills and export frames; export runs it in a pinned headless Chromium.
 *
 * Conventions: sRGB 8-bit, straight-alpha canvas source-over compositing, SDR Rec.709 assumed for sources.
 * Text is shaped by the browser engine (HarfBuzz inside Chromium) using a bundled, pinned font file.
 */
import type { Layer, RenderGraph, TextLayer, VideoLayer } from './evaluate.ts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Something that can paint a decoded source frame into a rectangle. */
export interface FrameImage { draw(ctx: Ctx2D, dx: number, dy: number, dw: number, dh: number): void }
export type FrameProvider = (layer: VideoLayer) => Promise<FrameImage | null>;

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

function withTransform(ctx: Ctx2D, g: RenderGraph, layer: Layer, body: () => void) {
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

/** Draw one evaluated frame. Awaits source frames; drawing order equals graph.layers order. */
export async function drawGraph(ctx: Ctx2D, g: RenderGraph, frames: FrameProvider): Promise<{ missing: string[] }> {
  const missing: string[] = [];
  const images = await Promise.all(g.layers.map((l) => (l.kind === 'video' ? frames(l) : null)));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g.background;
  ctx.fillRect(0, 0, g.width, g.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  g.layers.forEach((layer, i) => {
    if (layer.kind === 'text') return drawText(ctx, g, layer);
    const img = images[i];
    if (!img) { missing.push(layer.clipId); return; }
    // Default placement: fit (contain) inside the frame, centred.
    const fit = Math.min(g.width / layer.sourceWidth, g.height / layer.sourceHeight);
    const w = layer.sourceWidth * fit;
    const h = layer.sourceHeight * fit;
    withTransform(ctx, g, layer, () => img.draw(ctx, -w / 2, -h / 2, w, h));
  });
  ctx.restore();
  return { missing };
}
