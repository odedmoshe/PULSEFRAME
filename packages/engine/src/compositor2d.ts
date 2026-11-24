/**
 * Canvas2D reference compositor (Phase 0). One implementation draws the editor preview,
 * agent stills and export frames; export runs it in a pinned headless Chromium.
 *
 * Conventions: sRGB 8-bit, straight-alpha canvas source-over compositing, SDR Rec.709 assumed for sources.
 * Text is shaped by the browser engine (HarfBuzz inside Chromium) using a bundled, pinned font file.
 */
import * as T from '@pulseframe/time';
import { hasTextLook } from '@pulseframe/core';
import { gpuTransition, isGpuTransition, lutIdOf, takeUnavailable, type LutStrip } from './gpu.ts';
import { ADJUST_PASS_SLOT, type AdjustLayer, type ImageLayer, type PictureLayer, type RenderGraph, type TextLayer, type VideoLayer } from './evaluate.ts';
import { visualOrder, wordDir, wrapWords, type CaptionLayer } from './captions.ts';
import { textAtRest, unitPose } from './textAnimation.ts';
import { applyColourMatrix, applyEffects, hasGpuEffect, applyMask, applyRegions, BT709_AS_BT601, COMPOSITE, compositeLayer, scratch, type Buf, type LayerBox, type LookEnv } from './look.ts';
import { fitScale } from '@pulseframe/core';
import { TAP_PLACE_SLOT, tapMerger } from './taps.ts';
import { enterUnit, INK_METRICS_MAX_PX, paintTitle, paragraphSpacing, restPoses, type Box, type TextNote, type TitleUnit } from './textEffects.ts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Something that can paint a decoded source frame into a rectangle. */
export interface FrameImage { draw(ctx: Ctx2D, dx: number, dy: number, dw: number, dh: number): void }
/**
 * What a view hands the compositor: the decoded source frame of a picture layer and, optionally, the colour tables that
 * color.lut effects name (by asset id). A view without `lut` cannot show such an effect: it is then reported as unavailable.
 */
export interface FrameProvider {
  (layer: PictureLayer): Promise<FrameImage | null>;
  /** The strip of a colour table asset (core `lutStrip` of the file text, with a key unique per content), or null when there is none. May reject. */
  lut?(assetId: string): Promise<LutStrip | null>;
  /**
   * Called once at the start of every drawGraph, before any frame is asked for. The frames this drawing asks for (all
   * synchronously after begin) are pinned to the token it returns, and stay pinned until `end(token)`: several drawings may
   * share a provider at once (the editor's player and the source viewer's), and one must never release another's pictures.
   */
  begin?(): unknown;
  /** Called once when that drawGraph is done (also when it throws): releases what `begin` pinned. */
  end?(token: unknown): void;
  /** Why the last request for this layer resolved null (e.g. `decode_budget: …`, see decodeBudgetReason), or null when unknown. Never throws. */
  refusal?(layer: PictureLayer): string | null;
}
/**
 * The refusal a pool gives for a picture it did not decode because the frame needs more video decoders than it opens
 * (ADR-0011). Nothing failed to load, and asking for the same frame again cannot help: only fewer pictures in the frame can
 * (preflight's decode_budget lists those frames). A view tells it apart from a load failure with isDecodeBudgetReason.
 */
export const decodeBudgetReason = (maxDecoders: number) => `decode_budget: this frame needs more than ${maxDecoders} video decoders`;
export const isDecodeBudgetReason = (reason: string | null | undefined) => !!reason && reason.startsWith('decode_budget:');

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

function withTransform(ctx: Ctx2D, g: RenderGraph, layer: VideoLayer | ImageLayer | TextLayer, body: () => void) {
  const t = layer.transform;
  ctx.save();
  ctx.globalAlpha = t.opacity;
  ctx.translate(g.width / 2 + t.x * g.width, g.height / 2 + t.y * g.height);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scale, t.scale);
  body();
  ctx.restore();
}

/** A laid-out line of a title. `spacing` (px between letters) is set only for a title with tracking (ADR-0012); `ink` only for one with look fields. */
interface MeasuredLine { line: string; dir: 'rtl' | 'ltr'; width: number; spacing?: number; ink?: [number, number, number, number] }
/** Space between letters is 'letterSpacing' on the canvas context; without it tracking cannot be drawn (reported, so a still or an export refuses). */
const TRACKING_UNAVAILABLE = "this browser's canvas has no letterSpacing, so the space between letters cannot be drawn";

function drawText(ctx: Ctx2D, g: RenderGraph, layer: TextLayer, note?: TextNote) {
  const s = layer.style;
  const px = s.sizeFrac * g.height;
  const fontAt = (size: number) => `${s.fontWeight} ${size}px "${s.fontFamily}"`;
  ctx.font = fontAt(px);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const lineH = px * s.lineHeight;
  // Look fields (ADR-0012): a title with none of them is measured and drawn exactly as before.
  const look = hasTextLook(s);
  const tracking = look && s.tracking ? s.tracking : 0;
  if (tracking && !('letterSpacing' in ctx)) note?.('text.tracking', TRACKING_UNAVAILABLE);
  const spaced = tracking !== 0 && 'letterSpacing' in ctx;
  const spacingBefore = spaced ? ctx.letterSpacing : '';
  // Line breaking happens in logical order, per paragraph, before bidi reordering (UAX #9 L1/UAX #14 order).
  // Every wrapped line keeps its paragraph's base direction. Words are never split; an over-long word overflows.
  const maxWidth = (g.width * TEXT_MAX_WIDTH_FRAC) / layer.transform.scale;
  const measured: MeasuredLine[] = [];
  /**
   * The ink box of a line (of a title with look fields), from its origin. Above INK_METRICS_MAX_PX of font size the browser
   * gives it only in steps of 1/64 of the font size, so the line is measured again at that size and the box scaled up: it is
   * then at most px/256 outside the ink, and a gradient's first and last colour fall on the ink's edges.
   */
  const inkOf = (line: string, m: TextMetrics, spacing: number): [number, number, number, number] => {
    if (!(px > INK_METRICS_MAX_PX)) return [m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent];
    const k = px / INK_METRICS_MAX_PX;
    ctx.font = fontAt(INK_METRICS_MAX_PX);
    if (spaced) ctx.letterSpacing = `${spacing / k}px`;
    const r = ctx.measureText(line);
    ctx.font = fontAt(px);
    if (spaced) ctx.letterSpacing = `${spacing}px`;
    return [r.actualBoundingBoxLeft * k, r.actualBoundingBoxRight * k, r.actualBoundingBoxAscent * k, r.actualBoundingBoxDescent * k];
  };
  const done = (line: string, dir: 'rtl' | 'ltr', spacing: number): MeasuredLine => {
    const m = ctx.measureText(line);
    return { line, dir, width: m.width, ...(spaced ? { spacing } : {}), ...(look ? { ink: inkOf(line, m, spacing) } : {}) };
  };
  for (const paragraph of layer.text.split('\n')) {
    const dir = resolveDirection(paragraph, s.direction);
    ctx.direction = dir;
    // tracking: set before measuring and wrapping; none in a paragraph with Arabic script (its letters join)
    const spacing = spaced ? paragraphSpacing(paragraph, tracking, px) : 0;
    if (spaced) ctx.letterSpacing = `${spacing}px`;
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        measured.push(done(line, dir, spacing));
        line = word;
      } else line = candidate;
    }
    measured.push(done(line, dir, spacing));
  }
  if (spaced) ctx.letterSpacing = spacingBefore;
  const lines = measured;
  const blockW = Math.max(1, ...measured.map((m) => m.width));
  const blockH = lineH * lines.length;
  const lineLeft = (m: MeasuredLine) => (s.align === 'center' ? -m.width / 2 : (s.align === 'start') === (m.dir === 'rtl') ? blockW / 2 - m.width : -blockW / 2);
  const lineBaseline = (i: number) => -blockH / 2 + lineH * i + lineH / 2 + px * 0.34;
  /** The ink box of the block at rest (the gradient runs across it); the line boxes where the browser gives no ink metrics. */
  const ink = (): Box => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    measured.forEach((m, i) => {
      if (!m.ink || !m.line.trim() || !m.ink.every(Number.isFinite)) return;
      const left = lineLeft(m), base = lineBaseline(i);
      x0 = Math.min(x0, left - m.ink[0]); x1 = Math.max(x1, left + m.ink[1]); y0 = Math.min(y0, base - m.ink[2]); y1 = Math.max(y1, base + m.ink[3]);
    });
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: -blockW / 2, y: -blockH / 2, w: blockW, h: blockH };
  };
  withTransform(ctx, g, layer, () => {
    if (s.background) {
      const pad = px * 0.25;
      ctx.fillStyle = s.background;
      ctx.beginPath();
      ctx.roundRect(-blockW / 2 - pad, -blockH / 2 - pad * 0.6, blockW + pad * 2, blockH + pad * 1.2, px * 0.18);
      ctx.fill();
    }
    if (layer.animation && !textAtRest(layer.animation)) { drawTextUnits(ctx, layer, measured, { px, lineH, blockW, blockH, width: g.width, height: g.height, ink: look ? ink() : null }, note); return; }
    if (look) {
      // ADR-0012: the lines as units at rest, through the title painter (textEffects.ts)
      const units: TitleUnit[] = measured.map((m, i) => ({ text: m.line, left: lineLeft(m), width: m.width, baseline: lineBaseline(i), dir: m.dir, rtl: m.dir === 'rtl', ...(m.spacing !== undefined ? { spacing: m.spacing } : {}) }));
      paintTitle(ctx, units, restPoses(units.length), s, { px, width: g.width, height: g.height, ink: ink(), still: true }, note);
      return;
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

import { needsLineLayout, pieceRects, unitRanges, widenStretches } from './textAnimation.ts';
const GRAPHEMES = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
/** User-perceived characters: a letter stays with its vowel points and other combining marks. */
const graphemes = (w: string): string[] => (GRAPHEMES ? Array.from(GRAPHEMES.segment(w), (x) => x.segment) : Array.from(w));
/**
 * A title whose letters, words or lines are animating: each unit is placed where the whole line puts it and drawn with
 * the pose textAnimation.ts computes for it. All outlines are drawn before all fills, so a thick outline never covers a neighbour.
 *
 * Only a plain line (textAnimation.ts needsLineLayout: one direction, laid out in that direction, nothing in it that the
 * browser would reorder) is placed here word by word: the words side by side in the line's direction, each drawn in that
 * direction, letters by the measured width of the text before them. For every other line the units are the places the
 * browser reports for them in the whole line (pieceRects), and each is drawn as the whole line seen through a window on
 * those places: nothing can be in another place than at rest. Where the browser cannot report them, the line animates as one unit.
 */
function drawTextUnits(ctx: Ctx2D, layer: TextLayer, lines: MeasuredLine[], geo: { px: number; lineH: number; blockW: number; blockH: number; width: number; height: number; /** for a title with look fields */ ink: Box | null }, note?: TextNote) {
  const s = layer.style, a = layer.animation!, { px, lineH, blockW, blockH } = geo;
  const units: TitleUnit[] = [];
  lines.forEach((m, li) => {
    const rtl = m.dir === 'rtl';
    // tracking (ADR-0012): the line is measured with its paragraph's space between letters, and each unit is drawn with it
    const sp = m.spacing !== undefined ? { spacing: m.spacing } : {};
    if (m.spacing !== undefined) ctx.letterSpacing = `${m.spacing}px`;
    const left = s.align === 'center' ? -m.width / 2 : (s.align === 'start') === rtl ? blockW / 2 - m.width : -blockW / 2;
    const baseline = -blockH / 2 + lineH * li + lineH / 2 + px * 0.34;
    const whole = () => { if (m.line.trim()) units.push({ text: m.line, left, width: m.width, baseline, dir: m.dir, rtl, ...sp }); };
    if (a.by === 'line') { whole(); return; }
    ctx.direction = m.dir;
    if (needsLineLayout(m.line, m.dir, a.by)) {
      const places = pieceRects(ctx.measureText(m.line), m.line, unitRanges(m.line, a.by, graphemes), m.width);
      if (!places) { whole(); return; }
      widenStretches(places, px * 0.25).forEach((stretches, k) => {
        const from = Math.min(...places[k]!.map((r) => r.x)), to = Math.max(...places[k]!.map((r) => r.x + r.width));
        units.push({ text: m.line, left: left + from, width: to - from, baseline, dir: m.dir, rtl, window: { lineLeft: left, stretches }, ...sp });
      });
      return;
    }
    const words = m.line.split(' ');
    const widths = words.map((w) => ctx.measureText(w).width), space = ctx.measureText(' ').width;
    const lefts: number[] = [];
    let x = left;
    for (const wi of visualOrder(words, m.dir)) { lefts[wi] = x; x += widths[wi]! + space; }
    words.forEach((w, wi) => {
      if (!w) return;
      const wdir = wordDir(w) ?? m.dir; // the line's own direction: a plain line has no word of the other one
      if (a.by === 'word') { units.push({ text: w, left: lefts[wi]!, width: widths[wi]!, baseline, dir: wdir, rtl, ...sp }); return; }
      // letters: by the width of the text before each letter, from the side the word starts on
      ctx.direction = wdir;
      let before = 0, prefix = '';
      for (const g of graphemes(w)) {
        prefix += g;
        const upTo = ctx.measureText(prefix).width;
        units.push({ text: g, left: wdir === 'rtl' ? lefts[wi]! + widths[wi]! - upTo : lefts[wi]! + before, width: upTo - before, baseline, dir: wdir, rtl, ...sp });
        before = upTo;
      }
    });
  });
  const unitWidths = units.map((u) => u.width);
  const poses = units.map((_, i) => unitPose(a, i, units.length, units[i]!.rtl, unitWidths));
  // half a device pixel: windows that touch overlap by it, so no hairline shows between them
  const seam = units.some((u) => u.window) ? 0.5 / Math.max(1e-6, Math.hypot(ctx.getTransform().a, ctx.getTransform().b)) : 0;
  if (geo.ink) { paintTitle(ctx, units, poses, s, { px, width: geo.width, height: geo.height, ink: geo.ink, seam }, note); return; } // ADR-0012 look fields
  if (!('filter' in ctx) && poses.some((p) => p.blur)) note?.('text.blur', "this browser's canvas has no filter, so the blur cannot be drawn");
  const revealPad = px * ((s.stroke && s.strokeFrac > 0 ? s.strokeFrac : 0) + 0.25);
  const paint = (outline: boolean) => units.forEach((u, i) => {
    const p = poses[i]!;
    if (p.alpha <= 0) return;
    ctx.save();
    const { x, y } = enterUnit(ctx, u, p, px, seam, revealPad);
    if (outline) ctx.strokeText(u.text, x, y); else ctx.fillText(u.text, x, y);
    ctx.restore();
  });
  if (s.stroke && s.strokeFrac > 0) { ctx.strokeStyle = s.stroke; ctx.lineWidth = px * s.strokeFrac * 2; paint(true); }
  ctx.fillStyle = s.color;
  paint(false);
}

/** Captions: words are placed one by one (so each can be highlighted) in word-level bidi visual order. */
function drawCaption(ctx: Ctx2D, g: RenderGraph, layer: CaptionLayer) {
  const s = layer.style;
  let words = layer.words;
  if (s.preset === 'word-pop' && words.some((w) => w.state !== 'plain')) {
    // One word at a time: the word being spoken, else the last one spoken (held through pauses).
    const cur = words.find((w) => w.state === 'current') ?? [...words].reverse().find((w) => w.state === 'past');
    words = cur ? [{ text: cur.text, state: 'current', ...(cur.since !== undefined ? { since: cur.since } : {}) }] : [];
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
      // reveal: a word that has not been spoken yet is not drawn; its place is kept, so the line does not move as words arrive
      if (s.preset === 'reveal' && w.state === 'future') { x += widths[i]! + space; continue; }
      if (s.preset === 'dim-ahead' && w.state === 'future') ctx.globalAlpha = 0.4; // outline and fill both
      // word entrance: the word that has just started fades in, or starts larger and settles
      const entering = w.since !== undefined && s.wordEntrance && s.wordEntrance !== 'none';
      if (entering && s.wordEntrance === 'fade') ctx.globalAlpha *= Math.min(1, w.since! / 0.15);
      if (entering && s.wordEntrance === 'pop' && w.since! < 0.12) {
        const k = 1 + 0.3 * (1 - w.since! / 0.12) ** 2, cx = x + widths[i]! / 2, cy = baseline - px * 0.35;
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
      }
      const popped = entering && s.wordEntrance === 'pop' && w.since! < 0.12;
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
      const plainColour = s.preset === 'box-highlight' || s.preset === 'classic' || s.preset === 'reveal' || s.preset === 'underline' || s.preset === 'dim-ahead';
      ctx.fillStyle = lit && !plainColour ? s.highlightColor : s.color;
      ctx.fillText(w.text, x, baseline);
      ctx.globalAlpha = 1;
      if (s.preset === 'underline' && w.state === 'current') {
        ctx.fillStyle = s.highlightColor;
        ctx.fillRect(x, baseline + px * 0.14, widths[i]!, Math.max(2, px * 0.1));
      }
      if (popped) ctx.restore();
      x += widths[i]! + space;
    }
  });
  ctx.restore();
}

/** Size of a placed layer before its own transform: a picture fitted to the frame (contain or cover); a title spans the frame. */
function placedSize(g: RenderGraph, layer: VideoLayer | ImageLayer | TextLayer): { w: number; h: number } {
  if (layer.kind === 'text') return { w: g.width, h: g.height };
  // Default placement of pictures, centred: contain (whole picture visible) or cover (frame filled, edges cropped). The same
  // rule as core geometry.ts, which motion tracking (ADR-0015) uses to find a tracked point in the frame.
  const fit = fitScale(g.width, g.height, layer.sourceWidth, layer.sourceHeight, g.fit);
  return { w: layer.sourceWidth * fit, h: layer.sourceHeight * fit };
}
/** The placed box of a layer (its picture's size and its transform), in frame px: what layer-relative effects, masks and privacy regions use. */
function boxOf(g: RenderGraph, layer: VideoLayer | ImageLayer | TextLayer): LayerBox {
  const { w, h } = placedSize(g, layer), t = layer.transform;
  return { cx: g.width / 2 + t.x * g.width, cy: g.height / 2 + t.y * g.height, w, h, rotation: t.rotation, scale: t.scale };
}
/**
 * Put an opacity below 1 into a buffer's own alpha: one destination-in fill of the whole buffer. A clip's opacity is applied
 * this way, never as the globalAlpha of a draw onto a picture below it: in 8 bits that is not the same picture. Chromium's
 * software canvas computes such a draw as (s·(a+1) + d·(255−a)) >> 8 with a = round(255·α), a truncation that leaves the
 * frame on average half a level low and some bytes 2 off round(d + (s − d)·α). With the opacity in the buffer's alpha and the
 * buffer composited at full alpha, every byte pair is within 1 of round(d + (s − d)·a/255) at every opacity (a/255 is the
 * nearest alpha an 8-bit canvas has); the bytes still 2 off the real α are those where α itself falls between two such
 * levels. Measured in headless Chromium 153 over all 256×256 byte pairs at the opacities 0.01…0.99, also through stills
 * (conformance:opacity). Used by picture clips (drawPinned) and by the adjustment pass.
 */
function fadeBuf(buf: Buf, opacity: number, width: number, height: number) {
  const b = buf.ctx;
  b.save();
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.filter = 'none';
  b.globalCompositeOperation = 'destination-in';
  b.globalAlpha = opacity;
  b.fillStyle = '#000';
  b.fillRect(0, 0, width, height);
  b.restore();
}
/** Draw a layer's picture (or title) with its transform and opacity, nothing else: the first step of every layer and of every time tap. */
function placeLayer(c: Ctx2D, g: RenderGraph, layer: VideoLayer | ImageLayer | TextLayer, img: FrameImage | null, note?: TextNote) {
  if (layer.kind === 'text') { drawText(c, g, layer, note); return; }
  const { w, h } = placedSize(g, layer);
  withTransform(c, g, layer, () => img!.draw(c, -w / 2, -h / 2, w, h));
}
/**
 * The adjustment pass (ADR-0016): the frame drawn so far (every layer before this one) is copied into scratch slot
 * ADJUST_PASS_SLOT, run through the adjustment's effects with a whole-frame box (effects ping-pong slots 1 and 2), masked in
 * frame space (slots 4 and 5) and composited back with the clip's opacity and blend mode. For the normal blend that is
 * frame·(1 − α·m) + adjusted·α·m (α opacity, m mask coverage): masked-out pixels are transparent in the adjusted copy,
 * so they stay byte-identical. Nothing else is drawn: no picture is asked for, no transform, no transition.
 *
 * Opacity below 1 is put into the copy's own alpha (fadeBuf: one destination-in fill) and the copy is then drawn at full alpha. Drawing
 * the opaque copy with globalAlpha instead is the same picture in exact arithmetic, but not in 8 bits: Chromium's software
 * canvas then computes (s·(a+1) + d·(255−a)) >> 8 with a = 255·α (s adjusted, d frame): weights of (a+1)/256 and (255−a)/256
 * and a truncation, which at α = 0.5 is 2 below round((s + d) / 2) for 4096 of the 65536 byte pairs, and more than 1 off
 * somewhere at 114 of 271 opacities tried. With the alpha in the copy every byte pair is within 1 of round(d + (s − d)·α) at
 * α = 0.5 and at every α = k/255; of 17 opacities between two such levels, 5 had pairs 2 off (measured in headless Chromium
 * 153 over all 256×256 pairs; proof:adjust check 2 holds the 0.5 case on real stills).
 */
async function adjustPass(ctx: Ctx2D, g: RenderGraph, layer: AdjustLayer, tables: Pick<LookEnv, 'luts' | 'lutReasons'>) {
  const snap = scratch(ADJUST_PASS_SLOT, g.width, g.height);
  snap.ctx.drawImage(ctx.canvas, 0, 0);
  const box: LayerBox = { cx: g.width / 2, cy: g.height / 2, w: g.width, h: g.height, rotation: 0, scale: 1 };
  const env: LookEnv = { width: g.width, height: g.height, frameIndex: g.frameIndex, seconds: T.toSeconds(g.time), local: layer.local ?? 0, box, beat: g.beat ?? null, ...tables };
  let buf: Buf = snap;
  if (layer.effects?.length) buf = await applyEffects(buf, layer.effects, env);
  if (layer.mask) applyMask(buf, layer.mask, env);
  if (layer.opacity < 1) fadeBuf(buf, layer.opacity, g.width, g.height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = COMPOSITE[layer.blend ?? 'normal'];
  ctx.drawImage(buf.canvas, 0, 0);
  ctx.restore();
}

/** Key under which a decoded picture can serve every layer and tap of one frame that shows the same source frame. */
const pictureKey = (l: PictureLayer) => (l.kind === 'video' ? `v\n${l.assetId}\n${l.sourceFrameIndex}` : `i\n${l.assetId}`);
/**
 * The video decoders drawing `g` asks its frame provider for at once, as drawGraph asks (ADR-0011): every video layer's
 * own picture, then each time tap whose source frame no earlier request of the frame shows (it shares that image, see
 * pictureKey). Counted as distinct decode lanes (clip id and lane: the media pool's decoder key within one quality), so a
 * pool with fewer decoders than `count` refuses some of these pictures (decode_budget). `clipIds`: the clips they are
 * decoded for (a tap is decoded for its carrier clip). Pure; decodeBudget.test.ts holds it equal to drawGraph's requests.
 */
export function frameDecoders(g: RenderGraph): { count: number; clipIds: string[] } {
  const lanes = new Set<string>(), shown = new Set<string>(), clipIds = new Set<string>();
  const take = (l: PictureLayer) => { if (l.kind === 'video') { lanes.add(`${l.clipId}\n${l.lane ?? 0}`); clipIds.add(l.clipId); } };
  for (const l of g.layers) if (l.kind === 'video' || l.kind === 'image') { take(l); shown.add(pictureKey(l)); }
  for (const l of g.layers) {
    if (l.kind === 'caption' || l.kind === 'adjust' || !l.time) continue;
    for (const tap of l.time.taps) {
      if (tap.layer.kind === 'text' || shown.has(pictureKey(tap.layer))) continue;
      shown.add(pictureKey(tap.layer));
      take(tap.layer);
    }
  }
  return { count: lanes.size, clipIds: [...clipIds] };
}

/** Draw one evaluated frame. Awaits source frames; drawing order equals graph.layers order. */
/**
 * `unavailableEffects`: ids of GPU effects in this frame that could not run here (ADR-0008). The frame was drawn without them;
 * a preview says so, a still or an export must refuse rather than deliver it.
 * `unavailableReasons`: for those of them whose cause is not the graphics adapter (a colour table that could not be loaded,
 * a time effect whose earlier picture could not be decoded), why.
 */
/** The frame that is waiting on a GPU pass, if any (see drawGraph). */
let gpuFrame: Promise<void> | null = null;
export async function drawGraph(ctx: Ctx2D, g: RenderGraph, frames: FrameProvider): Promise<{ missing: string[]; /** For missing clips whose picture the view refused (FrameProvider.refusal, e.g. decode_budget): why, by clip id. */ missingReasons?: Record<string, string>; unavailableEffects: string[]; unavailableReasons?: Record<string, string> }> {
  const pin = frames.begin?.();
  try {
    return await drawPinned(ctx, g, frames);
  } finally {
    frames.end?.(pin);
  }
}
async function drawPinned(ctx: Ctx2D, g: RenderGraph, frames: FrameProvider): Promise<{ missing: string[]; missingReasons?: Record<string, string>; unavailableEffects: string[]; unavailableReasons?: Record<string, string> }> {
  const missing: string[] = [];
  const missingReasons: Record<string, string> = {};
  // Colour tables named by effects of this frame are loaded here, with the source frames and before the GPU gate; a table that
  // cannot be had becomes null with its reason, and the effect that needs it is then reported as unavailable, never thrown.
  const luts = new Map<string, LutStrip | null>();
  const lutReasons = new Map<string, string>();
  for (const l of g.layers) if (l.kind !== 'caption') for (const e of l.effects ?? []) { const id = lutIdOf(e.type, e.params); if (id) luts.set(id, null); }
  const loadLut = async (id: string) => {
    if (!frames.lut) { lutReasons.set(id, 'this view cannot load colour tables'); return; }
    try {
      const strip = await frames.lut(id);
      if (strip) luts.set(id, strip); else lutReasons.set(id, `colour table ${id} is not available`);
    } catch (e) { lutReasons.set(id, `colour table ${id} could not be loaded: ${String((e as Error)?.message ?? e).slice(0, 200)}`); }
  };
  // Every picture of the frame is asked for at once: first each layer's own (in layer order), then the pictures of the time
  // taps (ADR-0011), so that when a frame needs more decoders than the pool may open, it is a time effect that is left out
  // (and reported), never a layer. A tap showing a source frame that an earlier layer or tap of this frame already asked
  // for shares that image.
  const shared = new Map<string, Promise<FrameImage | null>>();
  const ask = (l: PictureLayer) => { const k = pictureKey(l); let p = shared.get(k); if (!p) shared.set(k, (p = frames(l))); return p; };
  /** Why a tap's picture could not be had, by layer index and tap index. */
  const tapWhy = new Map<string, string>();
  const requests = g.layers.map((l) => {
    if (l.kind === 'text' || l.kind === 'caption' || l.kind === 'adjust') return null; // an adjustment has no picture of its own (ADR-0016)
    const own = frames(l);
    if (!shared.has(pictureKey(l))) shared.set(pictureKey(l), own);
    return own;
  });
  const tapRequests = g.layers.map((l, i) => (l.kind === 'caption' || l.kind === 'adjust' || !l.time ? null : l.time.taps.map((tap, k) => {
    if (tap.layer.kind === 'text') return null;
    const layer = tap.layer;
    // a tap whose picture cannot be decoded leaves its time effect out of this frame (reported below), it does not fail the frame
    return ask(layer).then((img) => { if (!img) tapWhy.set(`${i}:${k}`, frames.refusal?.(layer) ?? 'source frame unavailable'); return img; }, (e) => { tapWhy.set(`${i}:${k}`, `source frame unavailable: ${String((e as Error)?.message ?? e).slice(0, 200)}`); return null; });
  })));
  const [images, tapImages] = await Promise.all([Promise.all(requests), Promise.all(tapRequests.map((t) => (t ? Promise.all(t) : null))), Promise.all([...luts.keys()].map(loadLut))]);
  /** Time effects of this frame that could not be drawn faithfully (a tap picture was missing), with why. */
  const timeLeftOut = new Map<string, string>();
  /** Title looks this browser could not draw (ADR-0012: 'text.tracking', 'text.glow', 'text.blur'), with why. */
  const textLeftOut = new Map<string, string>();
  const textNote: TextNote = (id, why) => { if (!textLeftOut.has(id)) textLeftOut.set(id, why); };
  // A frame with a GPU effect waits for the pass in the middle of drawing, while the shared scratch buffers hold its layers.
  // No other frame may draw meanwhile, so every frame first waits for such a frame to finish; frames without one stay synchronous.
  while (gpuFrame) await gpuFrame;
  let release: (() => void) | undefined;
  if (g.layers.some((l) => l.kind !== 'caption' && ((l.effects && hasGpuEffect(l.effects)) || (l.kind !== 'adjust' && l.transition && isGpuTransition(l.transition.type))))) gpuFrame = new Promise<void>((r) => { release = () => { gpuFrame = null; r(); }; });
  takeUnavailable();
  try {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g.background;
  ctx.fillRect(0, 0, g.width, g.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  /** Finished buffer of the outgoing side of a transition, waiting for its incoming layer (the next layer in the graph). */
  let outgoing: Buf | null = null;
  for (const [i, layer] of g.layers.entries()) {
    if (layer.kind === 'caption') { drawCaption(ctx, g, layer); continue; }
    if (layer.kind === 'adjust') { await adjustPass(ctx, g, layer, { luts, lutReasons }); continue; }
    const img = layer.kind === 'text' ? null : images[i];
    if (layer.kind !== 'text' && !img) { missing.push(layer.clipId); const why = frames.refusal?.(layer); if (why) missingReasons[layer.clipId] = why; continue; }
    const { w, h } = placedSize(g, layer);
    const colourFix = layer.kind === 'video' ? layer.colourFix : undefined;
    const regions = layer.kind === 'video' ? layer.regions : undefined;
    // A picture below full opacity is placed opaque in a scratch buffer and faded there (fadeBuf), never drawn onto the frame
    // with globalAlpha. A title keeps its globalAlpha: its stroke shows through its fill, which a fade of the whole would change.
    const faded = layer.kind !== 'text' && layer.transform.opacity < 1;
    const hasLook = !!(faded || colourFix || regions?.length || layer.time || layer.effects?.length || layer.mask || layer.transition || (layer.blend && layer.blend !== 'normal'));
    if (!hasLook) { placeLayer(ctx, g, layer, img ?? null, textNote); continue; } // fast path: identical to drawing without the look system
    const t = layer.transform;
    const box: LayerBox = { cx: g.width / 2 + t.x * g.width, cy: g.height / 2 + t.y * g.height, w, h, rotation: t.rotation, scale: t.scale };
    const env = { width: g.width, height: g.height, frameIndex: g.frameIndex, seconds: T.toSeconds(g.time), local: layer.local ?? 0, box, beat: g.beat ?? null, luts, lutReasons };
    let buf = scratch(1, g.width, g.height);
    const taps = layer.time?.taps, tapImgs = tapImages[i];
    const lost = taps ? taps.findIndex((_, k) => tapWhy.has(`${i}:${k}`)) : -1;
    if (taps && tapImgs && lost < 0) {
      // Time taps (ADR-0011): each picture is placed on its own with its transform and opacity, corrected like the layer
      // would be, read back and merged in exact integer arithmetic; the merged picture then goes on like a placed layer.
      const merger = tapMerger(layer.time!.type, layer.time!.params, taps.map((x) => x.weight), g.width * g.height);
      taps.forEach((tap, k) => {
        const slot = scratch(TAP_PLACE_SLOT, g.width, g.height);
        placeLayer(slot.ctx, g, tap.layer, tapImgs[k] ?? null, textNote);
        if (tap.layer.kind === 'video' && tap.layer.colourFix === 'bt709-as-bt601') applyColourMatrix(slot, BT709_AS_BT601);
        // each earlier picture hides its own privacy regions, resolved at its own source frame (ADR-0015), before the merge
        if (tap.layer.kind === 'video' && tap.layer.regions?.length) applyRegions(slot, tap.layer.regions, { width: g.width, height: g.height, box: boxOf(g, tap.layer) });
        merger.add(k, slot.ctx.getImageData(0, 0, g.width, g.height).data);
      });
      const merged = buf.ctx.createImageData(g.width, g.height);
      merger.finish(merged.data);
      buf.ctx.putImageData(merged, 0, 0);
    } else {
      // Without its time effect (a tap's picture could not be had): the layer's own picture alone, and the effect is reported,
      // so a preview says so and a still or an export refuses.
      if (taps && layer.time) timeLeftOut.set(layer.time.type, tapWhy.get(`${i}:${lost}`) ?? 'source frame unavailable');
      if (faded) {
        // opaque first, then the opacity into the buffer's alpha (fadeBuf): at the same step as before, so colour fix,
        // privacy regions, effects, mask, transition and blend see the faded picture as they always did
        placeLayer(buf.ctx, g, { ...layer, transform: { ...layer.transform, opacity: 1 } }, img ?? null, textNote);
        fadeBuf(buf, layer.transform.opacity, g.width, g.height);
      } else placeLayer(buf.ctx, g, layer, img ?? null, textNote);
      if (colourFix === 'bt709-as-bt601') applyColourMatrix(buf, BT709_AS_BT601); // before effects: it corrects the source, it is not a look
      if (regions?.length) applyRegions(buf, regions, env); // privacy regions (ADR-0015): on the placed picture, before any effect
    }
    if (layer.effects?.length) buf = await applyEffects(buf, layer.effects, env);
    if (layer.mask) applyMask(buf, layer.mask, env);
    if (layer.transition?.role === 'out') {
      // Keep the outgoing picture aside; its incoming partner composites both.
      const keep = scratch(7, g.width, g.height);
      keep.ctx.drawImage(buf.canvas, 0, 0);
      outgoing = keep;
      continue;
    }
    if (layer.transition && isGpuTransition(layer.transition.type)) {
      // A GPU transition mixes both pictures in one pass; the result is then composited like any layer (blend mode, no transition).
      const mixed = scratch(6, g.width, g.height);
      const ok = await gpuTransition(layer.transition, outgoing ? (outgoing as Buf).canvas : null, buf.canvas, mixed.ctx, env);
      // Not available: the incoming picture alone (a cut), recorded as missing so a still or an export refuses.
      compositeLayer(ctx, ok ? mixed : buf, { ...layer, transition: undefined }, g.width, g.height, null);
    } else compositeLayer(ctx, buf, layer, g.width, g.height, layer.transition ? outgoing : null);
    outgoing = null;
  }
  ctx.restore();
  const unavailable = takeUnavailable();
  for (const [id, why] of [...timeLeftOut, ...textLeftOut]) { if (!unavailable.effects.includes(id)) unavailable.effects.push(id); unavailable.reasons[id] = why; }
  return { missing, ...(Object.keys(missingReasons).length ? { missingReasons } : {}), unavailableEffects: unavailable.effects, ...(Object.keys(unavailable.reasons).length ? { unavailableReasons: unavailable.reasons } : {}) };
  } finally { release?.(); }
}
