/**
 * Pure maths of the curve picker (ADR-0019): the thumbnails and the preview are drawn from the ONE sampler (core
 * animation.ts sampleKeyframes, the same call preview, still and export make), and the custom editor's handle maths keeps a
 * curve inside what CurveHandlesSchema allows (x in 0..1, y in -1..2). No DOM.
 */
import * as T from '@pulseframe/time';
import { sampleKeyframes, TURN_BACK_EASINGS, type CurveHandles, type Easing, type Keyframe, type ValueRange } from '@pulseframe/core';

/** Points of a thumbnail and of the preview (the curve at i/40, i = 0..40). */
export const CURVE_POINTS = 41;
/** The thumbnails show the shape in the widest range a handle may reach, so a bounce or an overshoot is seen. */
export const TILE_RANGE: ValueRange = { min: -1, max: 2 };
export const HANDLE_X: readonly [number, number] = [0, 1];
export const HANDLE_Y: readonly [number, number] = [-1, 2];
export type Point = { x: number; y: number };

/** The two keys of a one-segment curve: value `a` at 0 s to value `b` at 1 s, the curve on the first. */
const segment = (easing: Easing, bezier: CurveHandles | undefined, a: number, b: number): Keyframe[] => [
  { time: T.rt(0, 1), value: a, easing, ...(bezier ? { bezier } : {}) },
  { time: T.rt(1, 1), value: b, easing: 'linear' },
];
/** The sampler's values at the 41 points, 0 → 1 in shape units (exactly what sampleKeyframes returns, clamped to TILE_RANGE). */
export function tilePoints(easing: Easing, bezier?: CurveHandles): Point[] {
  const keys = segment(easing, bezier, 0, 1);
  return Array.from({ length: CURVE_POINTS }, (_, i) => ({ x: i / (CURVE_POINTS - 1), y: sampleKeyframes(keys, T.rt(i, CURVE_POINTS - 1), TILE_RANGE) }));
}
/**
 * The preview in channel units: the curve from the channel's lowest to its highest value, clamped to its range as the sampler
 * does. An integer parameter is drawn stepped: the renderer rounds it (gpu.ts), so the picture rounds too.
 */
export function previewPoints(easing: Easing, bezier: CurveHandles | undefined, range: ValueRange, integer: boolean): Point[] {
  const keys = segment(easing, bezier, range.min, range.max);
  return Array.from({ length: CURVE_POINTS }, (_, i) => {
    const v = sampleKeyframes(keys, T.rt(i, CURVE_POINTS - 1), range);
    return { x: i / (CURVE_POINTS - 1), y: integer ? Math.round(v) : v };
  });
}
/** The polyline text of points in a box: x 0..1 across `w`, y `lo..hi` from the bottom to the top of `h`. */
export function polyline(points: readonly Point[], w: number, h: number, lo: number, hi: number): string {
  return points.map((p) => `${(p.x * w).toFixed(2)},${(h - ((p.y - lo) / (hi - lo)) * h).toFixed(2)}`).join(' ');
}

/** True for the curves that go past their end value and come back; a 'bezier' does when y1 or y2 is outside 0..1. */
export function turnsBackLocal(easing: Easing, bezier?: CurveHandles): boolean {
  if (easing === 'bezier') return !!bezier && (bezier[1] < 0 || bezier[1] > 1 || bezier[3] < 0 || bezier[3] > 1);
  return TURN_BACK_EASINGS.includes(easing);
}

// ---------- the custom editor: a square box, x 0..1 left to right, y from -1 (bottom) to 2 (top) ----------
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** A pointer position inside the box (pixels from its top-left, size × size) as handle values; anywhere, also outside the box. */
export function handleFromPoint(px: number, py: number, size: number): { x: number; y: number } {
  const x = clamp(px / size, 0, 1);
  const y = HANDLE_Y[1] - (clamp(py / size, 0, 1)) * (HANDLE_Y[1] - HANDLE_Y[0]);
  return { x: clamp(r3(x), 0, 1), y: clamp(r3(y), HANDLE_Y[0], HANDLE_Y[1]) };
}
/** A handle's place in the box (pixels from the top-left). */
export const pointFromHandle = (x: number, y: number, size: number): Point => ({ x: x * size, y: ((HANDLE_Y[1] - y) / (HANDLE_Y[1] - HANDLE_Y[0])) * size });
/** Replace handle 1 or 2 (0 or 1) of a curve with a pointer position. */
export function dragHandle(h: CurveHandles, which: 0 | 1, px: number, py: number, size: number): CurveHandles {
  const p = handleFromPoint(px, py, size);
  return which === 0 ? [p.x, p.y, h[2], h[3]] : [h[0], h[1], p.x, p.y];
}
/** Move a handle by a keyboard step (dx in x units, dy in y units), staying inside the allowed box. */
export function nudgeHandle(h: CurveHandles, which: 0 | 1, dx: number, dy: number): CurveHandles {
  const i = which * 2;
  const next = [...h] as [number, number, number, number];
  next[i] = clamp(r3(h[i]! + dx), 0, 1);
  next[i + 1] = clamp(r3(h[i + 1]! + dy), HANDLE_Y[0], HANDLE_Y[1]);
  return next;
}
/** One of the four number inputs: the value is clamped to its field's range; text that is not a number leaves the curve alone. */
export function setHandleField(h: CurveHandles, index: 0 | 1 | 2 | 3, text: string): CurveHandles {
  const v = Number(text);
  if (text.trim() === '' || !Number.isFinite(v)) return h;
  const next = [...h] as [number, number, number, number];
  next[index] = index % 2 === 0 ? clamp(r3(v), 0, 1) : clamp(r3(v), HANDLE_Y[0], HANDLE_Y[1]);
  return next;
}

/** True when two handle sets differ: a field blur commits only then (tabbing through the dialog must not rewrite a key's curve). */
export const handlesDiffer = (a: CurveHandles, b: CurveHandles): boolean => a.some((v, i) => v !== b[i]);
