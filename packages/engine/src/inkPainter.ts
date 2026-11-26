/**
 * The painter of «ציור חי» drawings (wave 8 ink; core inkContract.ts; the carrier's painter contract is drawnPainters.ts). Lead
 * pre-pass: the exact drawing rule of each brush, as constants and signatures; W2 builds the bodies and sets INK_PAINTER_BUILT,
 * which registers the painter. Until then a frame with a drawing reports `drawn.ink` (the carrier's rule), so a preview says so and a
 * still or an export refuses: nothing is drawn wrongly in the meantime.
 *
 * THE RULE (one stroke; preview, still and export run it through the one compositor, ADR-0005):
 * - Units: a point (x, y) is at (x / INK_UNIT · H, y / INK_UNIT · H) pixels from the anchor, H = env.height (the context is already at
 *   the anchor, rotated and scaled, one unit one output pixel). The width w px = stroke.width / INK_UNIT · H.
 * - Geometry: a polyline (lineTo, no curves) through the first `points` points of inkStrokeProgress(at, t, inkDrawnMs(payload,
 *   env.clipTime, env.fps)), then `frac` of the next segment (linear). lineCap = lineJoin = 'round'. A stroke of one reached point is
 *   a dot of diameter w (a zero-length round-capped line, drawn as an arc fill so every browser draws it). points === 0: nothing.
 *   Simplification left every point within 0.65 px of the raw stroke at 1080 lines (INK_SIMPLIFY_EPS), so no curve is fitted.
 * - Opaque: the painter never reads or sets the clip's opacity; the compositor fades the whole drawing through its buffer once
 *   (carrier, ink-verify C7), so crossings of two strokes never darken under a fade.
 * - marker «טוש»: the stroke in its colour at alpha 1, straight onto the layer.
 * - highlighter «מדגש»: the stroke drawn OPAQUE into the silhouette slot (TEXT_FX_SLOTS.silhouette), then that slot composited onto
 *   the layer once with source-over at HIGHLIGHTER_ALPHA. Decided against 'multiply': it vanishes on dark footage, and the Node pixel
 *   stand-in (drawn.test.ts) models source-over and destination-in only, so source-over at an alpha is the rule both it and Chromium
 *   compute (Chromium to 8-bit rounding). A stroke crossing itself is not darker; two highlighter strokes crossing are (as on paper).
 * - neon «ניאון»: the stroke at width w in opaque white into the silhouette slot, then textEffects `glow(ctx, S, box, {color, radiusFrac,
 *   intensity: NEON.intensity}, NEON.glowRadius · w)` (three blurs added with 'lighter'; it writes TEXT_FX_SLOTS.work and work2), then
 *   a core line of NEON.coreWidth · w in mixToWhite(colour, NEON.coreToWhite) at alpha 1. Without ctx.filter: no glow, the core and the
 *   stroke only, and env.note('drawn.ink.glow', …) — the title precedent (textEffects 'text.glow').
 * - Scratch: only TEXT_FX_SLOTS 10–12 (the title looks' own slots; a title and a drawing are never painted at the same time). No new
 *   slot (ink-verify C7's second half: slot 17/18 of the plan are not needed). Never 0–2 (layer buffer, effects), 8 (taps), 13–16.
 *   The silhouette slot is cleared over the stroke's device box before and after use.
 * - Order: strokes in stored order, each finished before the next. No clock, no randomness (no wiggle, no chalk in version 1).
 */
import type * as T from '@pulseframe/time';
import { inkDrawnMs, type InkBrush, type InkPayload, type InkStroke } from '@pulseframe/core';
import type { Ctx2D } from './compositor2d.ts';
import { registerDrawnPainter, type DrawnPaintEnv, type DrawnPainter } from './drawnPainters.ts';
import { TEXT_FX_SLOTS } from './textEffects.ts';

/** True once W2 has built paintInk (it is then registered for the kind `ink`). */
export const INK_PAINTER_BUILT = false;

export const HIGHLIGHTER_ALPHA = 0.45;
export const NEON = { glowRadius: 1.5, coreWidth: 0.45, coreToWhite: 0.7, intensity: 1 } as const;
/** The scratch slots the painter may use (and no other). */
export const INK_SCRATCH_SLOTS = [TEXT_FX_SLOTS.silhouette, TEXT_FX_SLOTS.work, TEXT_FX_SLOTS.work2] as const;
export const INK_GLOW_NOTE = 'drawn.ink.glow';

/** How the painter composites one brush (the table the tests read). */
export const INK_BRUSH_RULES: Readonly<Record<InkBrush, { via: 'direct' | 'silhouette' | 'glow'; alpha: number }>> = {
  marker: { via: 'direct', alpha: 1 },
  highlighter: { via: 'silhouette', alpha: HIGHLIGHTER_ALPHA },
  neon: { via: 'glow', alpha: 1 },
};

export class InkPaintNotBuiltError extends Error {
  readonly code = 'ink_not_built';
  constructor(readonly fn: string) { super(`${fn}: the drawing painter is not built in this build yet`); }
}

/** `#RRGGBB` mixed toward white by `k` ∈ [0, 1] per channel, rounded to integers (the neon core). */
export function mixToWhite(color: string, k: number): string {
  void color; void k;
  throw new InkPaintNotBuiltError('mixToWhite');
}
/** The part of one stroke reached at drawing time `drawnMs`, as pixel points around the anchor (the polyline the rule draws). */
export function inkStrokePixels(stroke: InkStroke, drawnMs: number, height: number): { xs: number[]; ys: number[]; widthPx: number } {
  void stroke; void drawnMs; void height;
  throw new InkPaintNotBuiltError('inkStrokePixels');
}
/** One stroke by its brush's rule (above). */
export function paintInkStroke(ctx: Ctx2D, stroke: InkStroke, drawnMs: number, env: DrawnPaintEnv): void {
  void ctx; void stroke; void drawnMs; void env;
  throw new InkPaintNotBuiltError('paintInkStroke');
}
/** The registered painter: drawnMs = inkDrawnMs(payload, env.clipTime, env.fps), then every stroke in order. */
export const paintInk: DrawnPainter = (ctx, payload, env) => {
  const p = payload as InkPayload;
  const drawnMs = inkDrawnMs(p, env.clipTime as T.RationalTime, env.fps);
  for (const s of p.strokes) paintInkStroke(ctx, s, drawnMs, env);
};
if (INK_PAINTER_BUILT) registerDrawnPainter('ink', paintInk);
