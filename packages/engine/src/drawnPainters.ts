/**
 * Painters of drawn overlays (wave 8 carrier; core drawn.ts holds the payload contracts). Each drawn kind registers ONE
 * painter here; the Canvas2D compositor dispatches a DrawnLayer to it. Preview, stills and export run the same painter
 * through the same compositor (ADR-0005).
 *
 * The painter's contract:
 * - It is called with the context already moved to the clip's anchor (frame centre + transform x/y), rotated and scaled by
 *   the clip's transform. One unit is one output pixel; the frame height is `env.height` pixels (a drawing scales with the
 *   frame height, like a title).
 * - It draws OPAQUE: it never reads or sets the clip's opacity. The compositor draws a drawn layer below full opacity into
 *   the layer buffer at opacity 1 and fades the buffer once (fadeBuf), so shapes that overlap do not darken where they cross
 *   (ink-verify C7). It may use globalAlpha for its own translucent parts (a highlighter), relative to 1.
 * - It is pure in its inputs: payload, `env` numbers and the canvas. No clock, no randomness that is not seeded from the
 *   payload, no font that is not keyed (the frame key holds the payload and the layer's numbers only, nothing font-related).
 * - What it cannot draw in this browser it reports through `env.note(id, why)`: the frame is then reported unavailable, so a
 *   preview says so and a still or an export refuses.
 * A kind without a registered painter is reported as `drawn.<kind>` the same way and nothing is drawn for it.
 */
import type * as T from '@pulseframe/time';
import type { DrawnPayload } from '@pulseframe/core';
import type { Ctx2D } from './compositor2d.ts';

export interface DrawnPaintEnv {
  /** Output frame size in pixels. */
  width: number;
  height: number;
  /** Exact clip-local time of this picture, its whole frame (floor) and the timeline's frame rate. */
  clipTime: T.RationalTime;
  localFrame: number;
  fps: T.Rate;
  /** Report something this browser could not draw (an id such as 'drawn.ink.glow' and why). */
  note(id: string, why: string): void;
}
export type DrawnPainter = (ctx: Ctx2D, payload: DrawnPayload, env: DrawnPaintEnv) => void;

const PAINTERS = new Map<string, DrawnPainter>();
/** Register the painter of a drawn kind (once per page). Throws when the kind already has one. */
export function registerDrawnPainter(kind: string, paint: DrawnPainter): void {
  if (PAINTERS.has(kind)) throw new Error(`drawn kind ${kind} already has a painter`);
  PAINTERS.set(kind, paint);
}
/** Tests only. */
export const unregisterDrawnPainter = (kind: string): boolean => PAINTERS.delete(kind);
export const drawnPainter = (kind: string): DrawnPainter | undefined => PAINTERS.get(kind);
/** The id a frame reports when a drawn kind has no painter in this build. */
export const noPainterId = (kind: string) => `drawn.${kind}`;
