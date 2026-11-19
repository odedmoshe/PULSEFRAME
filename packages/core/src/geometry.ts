/**
 * Where a point of a source picture lands in the frame, and back (ADR-0015). The same placement the compositor draws with
 * (compositor2d.ts placedSize and withTransform): the picture is fitted to the frame (contain or cover), centred, then moved
 * by its transform (x, y as fractions of the frame), rotated clockwise and scaled about its centre.
 * Pure arithmetic in frame pixels; shared by the follow resolver, the track picker and the tests.
 */
export type Fit = 'contain' | 'cover';
export interface Placed { cx: number; cy: number; w: number; h: number; rotation: number; scale: number }
/** compositor2d.ts placedSize: the factor that fits a srcW×srcH picture into a frameW×frameH frame. */
export const fitScale = (frameW: number, frameH: number, srcW: number, srcH: number, fit: Fit): number => (fit === 'cover' ? Math.max : Math.min)(frameW / srcW, frameH / srcH);
/** A picture's placement in the frame: its centre in frame px, its fitted size before its own scale, its rotation (degrees, clockwise) and scale. */
export function placed(frameW: number, frameH: number, fit: Fit, srcW: number, srcH: number, t: { x: number; y: number; scale: number; rotation: number }): Placed {
  const f = fitScale(frameW, frameH, srcW, srcH, fit);
  return { cx: frameW / 2 + t.x * frameW, cy: frameH / 2 + t.y * frameH, w: srcW * f, h: srcH * f, rotation: t.rotation, scale: t.scale };
}
/** Normalised source point (u, v in 0..1 of the source width and height) → frame px, exactly as withTransform draws (translate, rotate clockwise, scale). */
export function sourceToFrame(p: Placed, u: number, v: number): { px: number; py: number } {
  const a = (p.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const lx = (u - 0.5) * p.w * p.scale, ly = (v - 0.5) * p.h * p.scale;
  return { px: p.cx + c * lx - s * ly, py: p.cy + s * lx + c * ly };
}
/** Frame px → normalised source point: the inverse of sourceToFrame (values outside 0..1 are off the picture). */
export function frameToSource(p: Placed, px: number, py: number): { u: number; v: number } {
  const a = (-p.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = px - p.cx, dy = py - p.cy;
  return { u: (c * dx - s * dy) / p.scale / p.w + 0.5, v: (s * dx + c * dy) / p.scale / p.h + 0.5 };
}
