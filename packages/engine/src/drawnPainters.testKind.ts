/**
 * TEST-ONLY painter of the test drawn kind (core drawn.testKind.ts; a labelled test double, never registered by production
 * code): a filled rectangle of the payload's colour and half sizes (1/10 000 of the frame height) around the anchor, moved
 * right by one pixel per content frame (offset + local frame), so a picture shows where in its content it is. It is drawn as
 * TWO overlapping fills (left two thirds, right two thirds): a fade that went through globalAlpha would darken the middle third.
 */
import { registerTestDrawnKind, TEST_DRAWN_UNIT, type TestDrawn } from '@pulseframe/core/drawn.testKind.ts';
import { drawnPainter, registerDrawnPainter, type DrawnPainter } from './drawnPainters.ts';

export const paintTestDrawn: DrawnPainter = (ctx, payload, env) => {
  const p = payload as TestDrawn;
  const hw = (p.w / TEST_DRAWN_UNIT) * env.height, hh = (p.h / TEST_DRAWN_UNIT) * env.height;
  const dx = p.offset + env.localFrame;
  ctx.fillStyle = p.color;
  ctx.fillRect(-hw + dx, -hh, (4 * hw) / 3, 2 * hh);
  ctx.fillRect(-hw / 3 + dx, -hh, (4 * hw) / 3, 2 * hh);
};
/** Register the test kind (core) and its painter, once per process. */
export function registerTestDrawnPainter(): void {
  registerTestDrawnKind();
  if (!drawnPainter('test')) registerDrawnPainter('test', paintTestDrawn);
}
