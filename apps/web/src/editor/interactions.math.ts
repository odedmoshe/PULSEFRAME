/** Pure geometry/time helpers for direct manipulation. No DOM, no editor state. */
import * as T from '@pulseframe/time';

export interface SnapResult { time: T.RationalTime; snapped: boolean; index: number }

/**
 * Snap `time` to the nearest candidate within `thresholdPx` (at `pxPerSecond`). The exact candidate is returned
 * when snapping; on equal distance the earlier candidate (lower index) wins. `index` is -1 when not snapped.
 */
export function snapTime(a: { time: T.RationalTime; candidates: readonly T.RationalTime[]; pxPerSecond: number; thresholdPx: number }): SnapResult {
  let best = -1;
  let bestDist = Infinity;
  a.candidates.forEach((c, i) => {
    const dist = Math.abs(T.toSeconds(T.sub(c, a.time))) * a.pxPerSecond;
    if (dist <= a.thresholdPx && dist < bestDist) { best = i; bestDist = dist; }
  });
  return best < 0 ? { time: a.time, snapped: false, index: -1 } : { time: a.candidates[best]!, snapped: true, index: best };
}

/** A pixel offset on the timeline as a frame-aligned time (nearest frame; ties round up). */
export function pxToFrameTime(px: number, pxPerSecond: number, rate: T.Rate): T.RationalTime {
  return T.snapToFrame(T.fromSeconds(px / pxPerSecond), rate);
}

export interface LayerTransform { x: number; y: number; scale: number; rotation: number }
export interface LayerBox { cx: number; cy: number; w: number; h: number; rotationDeg: number }

/**
 * Where the compositor draws a layer, in frame pixels. Media is contain-fitted into the frame (`fit`, default);
 * a text block (`fit: false`) is used at its given size. Then the layer's scale applies about its centre.
 */
export function layerBox(a: { frameW: number; frameH: number; naturalW: number; naturalH: number; transform: LayerTransform; fit?: boolean }): LayerBox {
  const f = a.fit === false ? 1 : Math.min(a.frameW / a.naturalW, a.frameH / a.naturalH);
  return {
    cx: a.frameW / 2 + a.transform.x * a.frameW,
    cy: a.frameH / 2 + a.transform.y * a.frameH,
    w: a.naturalW * f * a.transform.scale,
    h: a.naturalH * f * a.transform.scale,
    rotationDeg: a.transform.rotation,
  };
}

/** Frame pixels -> displayed canvas pixels. */
export function boxToScreen(box: LayerBox, canvasRectW: number, frameW: number): LayerBox {
  const k = canvasRectW / frameW;
  return { cx: box.cx * k, cy: box.cy * k, w: box.w * k, h: box.h * k, rotationDeg: box.rotationDeg };
}

/** A displayed-pixel delta as a fraction of the frame width / height (the unit of transform x / y). */
export function screenDeltaToFrameFraction(dxPx: number, dyPx: number, canvasRectW: number, canvasRectH: number): { dx: number; dy: number } {
  return { dx: dxPx / canvasRectW, dy: dyPx / canvasRectH };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clampX = (v: number) => clamp(v, -4, 4);
export const clampScale = (v: number) => clamp(v, 0.01, 20);
export const clampRotation = (v: number) => clamp(v, -3600, 3600);

/** Uniform scale about the centre from the ratio of pointer distances. */
export function scaleFromDrag(startDist: number, nowDist: number, startScale: number): number {
  if (!(startDist > 0) || !Number.isFinite(nowDist)) return clampScale(startScale);
  return clampScale(startScale * (nowDist / startDist));
}

/** Rotation in degrees (clockwise, screen y down). The pointer-angle delta is wrapped into (-180, 180] so crossing +-180 does not jump. */
export function rotationFromDrag(centre: { x: number; y: number }, startPoint: { x: number; y: number }, nowPoint: { x: number; y: number }, startRotation: number, snap15: boolean): number {
  const a0 = Math.atan2(startPoint.y - centre.y, startPoint.x - centre.x);
  const a1 = Math.atan2(nowPoint.y - centre.y, nowPoint.x - centre.x);
  let delta = ((a1 - a0) * 180) / Math.PI;
  while (delta > 180) delta -= 360;
  while (delta <= -180) delta += 360;
  const r = startRotation + delta;
  return clampRotation(snap15 ? Math.round(r / 15) * 15 : r);
}

/** True when [start, end) overlaps any clip on the track other than the moving ones (rational compare). */
export function overlapsOnTrack(clips: readonly { id: string; start: T.RationalTime; duration: T.RationalTime }[], movingIds: Iterable<string>, start: T.RationalTime, end: T.RationalTime): boolean {
  const moving = new Set(movingIds);
  return clips.some((c) => !moving.has(c.id) && T.lt(c.start, end) && T.lt(start, T.add(c.start, c.duration)));
}

/** Beat / scene-cut times as snap targets: each marker moved to its nearest frame so a snapped clip stays frame-aligned. */
export function markerSnapCandidates(markers: readonly T.RationalTime[], rate: T.Rate): T.RationalTime[] {
  return markers.map((m) => T.snapToFrame(m, rate));
}
