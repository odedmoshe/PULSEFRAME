/**
 * Canvas2D reference compositor (Phase 0). One implementation draws the editor preview,
 * agent stills and export frames; export runs it in a pinned headless Chromium.
 *
 * Conventions: sRGB 8-bit, straight-alpha canvas source-over compositing, SDR Rec.709 assumed for sources.
 * Text is shaped by the browser engine (HarfBuzz inside Chromium) using a bundled, pinned font file.
 */
import * as T from '@pulseframe/time';
import { gpuTransition, isGpuTransition, lutIdOf, takeUnavailable, type LutStrip } from './gpu.ts';
import type { Layer, PictureLayer, RenderGraph, TextLayer } from './evaluate.ts';
import { visualOrder, wordDir, wrapWords, type CaptionLayer } from './captions.ts';
import { textAtRest, unitPose } from './textAnimation.ts';
import { applyColourMatrix, applyEffects, hasGpuEffect, applyMask, BT709_AS_BT601, compositeLayer, scratch, type Buf, type LayerBox } from './look.ts';

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
}

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
    if (layer.animation && !textAtRest(layer.animation)) { drawTextUnits(ctx, layer, measured, { px, lineH, blockW, blockH }); return; }
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

const GRAPHEMES = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
/** User-perceived characters: a letter stays with its vowel points and other combining marks. */
const graphemes = (w: string): string[] => (GRAPHEMES ? Array.from(GRAPHEMES.segment(w), (x) => x.segment) : Array.from(w));
const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/, LTR_CHAR = /[A-Za-z0-9À-ɏͰ-ϿЀ-ӿ]/;
/** A word as runs of one direction each (Hebrew letters; Latin letters and digits); marks and symbols stay with the run before them. */
function directionRuns(word: string, base: 'rtl' | 'ltr'): { text: string; dir: 'rtl' | 'ltr' }[] {
  const runs: { text: string; dir: 'rtl' | 'ltr' | null }[] = [];
  for (const g of graphemes(word)) {
    const d = RTL_CHAR.test(g) ? 'rtl' : LTR_CHAR.test(g) ? 'ltr' : null;
    const last = runs[runs.length - 1];
    if (last && (d === null || last.dir === null || last.dir === d)) { last.text += g; last.dir ??= d; } else runs.push({ text: g, dir: d });
  }
  return runs.map((r) => ({ text: r.text, dir: r.dir ?? base }));
}
/**
 * A title whose letters, words or lines are animating: each unit is placed where the whole line would put it (word-level
 * visual order as for captions; letters by the measured width of the text before them, per direction run) and drawn with
 * the pose textAnimation.ts computes for it. All outlines are drawn before all fills, so a thick outline never covers a neighbour.
 */
function drawTextUnits(ctx: Ctx2D, layer: TextLayer, lines: { line: string; dir: 'rtl' | 'ltr'; width: number }[], geo: { px: number; lineH: number; blockW: number; blockH: number }) {
  const s = layer.style, a = layer.animation!, { px, lineH, blockW, blockH } = geo;
  const units: { text: string; left: number; width: number; baseline: number; dir: 'rtl' | 'ltr'; rtl: boolean }[] = [];
  lines.forEach((m, li) => {
    const rtl = m.dir === 'rtl';
    const left = s.align === 'center' ? -m.width / 2 : (s.align === 'start') === rtl ? blockW / 2 - m.width : -blockW / 2;
    const baseline = -blockH / 2 + lineH * li + lineH / 2 + px * 0.34;
    if (a.by === 'line') { if (m.line.trim()) units.push({ text: m.line, left, width: m.width, baseline, dir: m.dir, rtl }); return; }
    ctx.direction = m.dir;
    const words = m.line.split(' ');
    const widths = words.map((w) => ctx.measureText(w).width), space = ctx.measureText(' ').width;
    const lefts: number[] = [];
    let x = left;
    for (const wi of visualOrder(words, m.dir)) { lefts[wi] = x; x += widths[wi]! + space; }
    words.forEach((w, wi) => {
      if (!w) return;
      const wdir = wordDir(w) ?? m.dir;
      if (a.by === 'word') { units.push({ text: w, left: lefts[wi]!, width: widths[wi]!, baseline, dir: wdir, rtl }); return; }
      // letters: runs of one direction inside the word, placed in visual order; inside a run, by the width of the text before each letter
      const runs = directionRuns(w, wdir);
      ctx.direction = wdir;
      const runWidths = runs.map((r) => ctx.measureText(r.text).width);
      const scale = widths[wi]! / Math.max(1e-6, runWidths.reduce((n, v) => n + v, 0)); // runs measured apart can differ from the word by kerning: spread the difference
      const runLefts: number[] = [];
      let rx = lefts[wi]!;
      for (const ri of visualOrder(runs.map((r) => r.text), wdir)) { runLefts[ri] = rx; rx += runWidths[ri]! * scale; }
      runs.forEach((r, ri) => {
        ctx.direction = r.dir;
        let before = 0, prefix = '';
        for (const g of graphemes(r.text)) {
          prefix += g;
          const upTo = ctx.measureText(prefix).width, width = (upTo - before) * scale;
          units.push({ text: g, left: r.dir === 'rtl' ? runLefts[ri]! + (runWidths[ri]! - upTo) * scale : runLefts[ri]! + before * scale, width, baseline, dir: r.dir, rtl });
          before = upTo;
        }
      });
    });
  });
  const poses = units.map((_, i) => unitPose(a, i, units.length, units[i]!.rtl));
  const paint = (outline: boolean) => units.forEach((u, i) => {
    const p = poses[i]!;
    if (p.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= p.alpha;
    ctx.direction = u.dir;
    ctx.translate(u.left + u.width / 2 + p.dx * px, u.baseline + p.dy * px - px * 0.34);
    ctx.scale(p.scale, p.scale); // about the middle of the unit, a third of the font size above the baseline
    if (outline) ctx.strokeText(u.text, -u.width / 2, px * 0.34); else ctx.fillText(u.text, -u.width / 2, px * 0.34);
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

/** Draw one evaluated frame. Awaits source frames; drawing order equals graph.layers order. */
/**
 * `unavailableEffects`: ids of GPU effects in this frame that could not run here (ADR-0008). The frame was drawn without them;
 * a preview says so, a still or an export must refuse rather than deliver it.
 * `unavailableReasons`: for those of them whose cause is not the graphics adapter (a colour table that could not be loaded), why.
 */
/** The frame that is waiting on a GPU pass, if any (see drawGraph). */
let gpuFrame: Promise<void> | null = null;
export async function drawGraph(ctx: Ctx2D, g: RenderGraph, frames: FrameProvider): Promise<{ missing: string[]; unavailableEffects: string[]; unavailableReasons?: Record<string, string> }> {
  const missing: string[] = [];
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
  const [images] = await Promise.all([Promise.all(g.layers.map((l) => (l.kind === 'text' || l.kind === 'caption' ? null : frames(l)))), Promise.all([...luts.keys()].map(loadLut))]);
  // A frame with a GPU effect waits for the pass in the middle of drawing, while the shared scratch buffers hold its layers.
  // No other frame may draw meanwhile, so every frame first waits for such a frame to finish; frames without one stay synchronous.
  while (gpuFrame) await gpuFrame;
  let release: (() => void) | undefined;
  if (g.layers.some((l) => l.kind !== 'caption' && ((l.effects && hasGpuEffect(l.effects)) || (l.transition && isGpuTransition(l.transition.type))))) gpuFrame = new Promise<void>((r) => { release = () => { gpuFrame = null; r(); }; });
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
    const img = layer.kind === 'text' ? null : images[i];
    if (layer.kind !== 'text' && !img) { missing.push(layer.clipId); continue; }
    // Default placement of pictures, centred: contain (whole picture visible) or cover (frame filled, edges cropped).
    const fit = layer.kind === 'text' ? 1 : (g.fit === 'cover' ? Math.max : Math.min)(g.width / layer.sourceWidth, g.height / layer.sourceHeight);
    const w = layer.kind === 'text' ? g.width : layer.sourceWidth * fit;
    const h = layer.kind === 'text' ? g.height : layer.sourceHeight * fit;
    const place = (c: Ctx2D) => (layer.kind === 'text' ? drawText(c, g, layer) : withTransform(c, g, layer, () => img!.draw(c, -w / 2, -h / 2, w, h)));
    const colourFix = layer.kind === 'video' ? layer.colourFix : undefined;
    const hasLook = !!(colourFix || layer.effects?.length || layer.mask || layer.transition || (layer.blend && layer.blend !== 'normal'));
    if (!hasLook) { place(ctx); continue; } // fast path: identical to drawing without the look system
    const t = layer.transform;
    const box: LayerBox = { cx: g.width / 2 + t.x * g.width, cy: g.height / 2 + t.y * g.height, w, h, rotation: t.rotation, scale: t.scale };
    const env = { width: g.width, height: g.height, frameIndex: g.frameIndex, seconds: T.toSeconds(g.time), box, beat: g.beat ?? null, luts, lutReasons };
    let buf = scratch(1, g.width, g.height);
    place(buf.ctx);
    if (colourFix === 'bt709-as-bt601') applyColourMatrix(buf, BT709_AS_BT601); // before effects: it corrects the source, it is not a look
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
      const ok = await gpuTransition(layer.transition.type, layer.transition.progress, outgoing ? (outgoing as Buf).canvas : null, buf.canvas, mixed.ctx, env);
      // Not available: the incoming picture alone (a cut), recorded as missing so a still or an export refuses.
      compositeLayer(ctx, ok ? mixed : buf, { ...layer, transition: undefined }, g.width, g.height, null);
    } else compositeLayer(ctx, buf, layer, g.width, g.height, layer.transition ? outgoing : null);
    outgoing = null;
  }
  ctx.restore();
  const unavailable = takeUnavailable();
  return { missing, unavailableEffects: unavailable.effects, ...(Object.keys(unavailable.reasons).length ? { unavailableReasons: unavailable.reasons } : {}) };
  } finally { release?.(); }
}
