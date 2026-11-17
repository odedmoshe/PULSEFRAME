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

// ---- canvas handles that lie outside the viewer ----
// The handle overlay is clipped to the viewer (CanvasHandles.tsx): nothing of it can lie over the transport bar, the panels or
// the header and take their clicks. A handle whose centre is outside the viewer therefore cannot be reached there; it gets
// a stand-in (a "proxy") at the viewer edge that does the same thing when dragged. The positions below are in the
// coordinates of the overlay root (the displayed canvas: 0,0 is its top-left corner, pixels on screen).

export type ScaleHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export type LayerHandle = ScaleHandle | 'rotate' | 'move';
/** Where the scale handles sit on the box, as fractions of its width and height from its top-left corner. */
export const SCALE_ANCHORS: Readonly<Record<ScaleHandle, readonly [number, number]>> = { n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5], nw: [0, 0] };
/** The rotate handle sits this far above the top edge of the box (interactions.css: .ch-rotate). */
export const ROTATE_ABOVE_PX = 28;
export interface ViewRect { left: number; top: number; right: number; bottom: number }
export interface HandlePoint { id: Exclude<LayerHandle, 'move'>; x: number; y: number }
export interface Proxy { id: LayerHandle; x: number; y: number; /** stands in for the handle that has the keyboard focus, whose own ring cannot be seen */ mirror: boolean }

/** The centre of every scale handle and of the rotate handle of a box drawn centred at (cx, cy) and turned clockwise by rotationDeg. */
export function handlePoints(box: LayerBox): HandlePoint[] {
  const a = (box.rotationDeg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const at = (dx: number, dy: number) => ({ x: box.cx + dx * cos - dy * sin, y: box.cy + dx * sin + dy * cos });
  const out: HandlePoint[] = (Object.entries(SCALE_ANCHORS) as [ScaleHandle, readonly [number, number]][]).map(([id, [u, v]]) => ({ id, ...at((u - 0.5) * box.w, (v - 0.5) * box.h) }));
  out.push({ id: 'rotate', ...at(0, -box.h / 2 - ROTATE_ABOVE_PX) });
  return out;
}

/**
 * Stand-ins at the viewer edge for the handles that cannot be reached inside it. `margin` is half a handle: a handle counts
 * as inside when all of it is, and a stand-in is placed that far inside the edge. `gap` is the least distance between two
 * grips; a stand-in that would land on another grip slides along the edge.
 * - all scale handles do the same thing (a uniform scale about the centre, by the ratio of pointer distances from it), so
 *   only when none of them is inside is one stand-in added: for the one nearest the viewer;
 * - the rotate handle gets one when it is outside;
 * - the box can always be moved by dragging its visible part; when nothing of it (its bounding box) is inside, a move
 *   stand-in is placed at its centre, pulled to the edge;
 * - `focused`: the handle that has the keyboard focus. When its focus ring cannot be seen (it is outside; for the move
 *   handle, the box covers the whole viewer or lies outside it), its stand-in is shown with the ring (`mirror`), first.
 * The result depends only on the box and the viewer, so it stays put while a drag runs from the committed transform.
 */
export function edgeProxies(a: { box: LayerBox; view: ViewRect; margin: number; gap: number; focused?: LayerHandle | null }): Proxy[] {
  const { box, view, margin: m, gap } = a;
  const lo = { x: view.left + m, y: view.top + m }, hi = { x: view.right - m, y: view.bottom - m };
  if (!(hi.x >= lo.x && hi.y >= lo.y) || ![box.cx, box.cy, box.w, box.h, box.rotationDeg].every(Number.isFinite)) return [];
  const inside = (p: { x: number; y: number }) => p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y;
  const pull = (p: { x: number; y: number }) => ({ x: clamp(p.x, lo.x, hi.x), y: clamp(p.y, lo.y, hi.y) });
  const points = handlePoints(box);
  const scale = points.filter((p) => p.id !== 'rotate');
  const rotate = points.find((p) => p.id === 'rotate')!;
  // every handle that shows at least in part is a grip a stand-in must not cover
  const shows = (p: { x: number; y: number }) => p.x >= view.left - m && p.x <= view.right + m && p.y >= view.top - m && p.y <= view.bottom + m;
  const taken = points.filter(shows).map((p) => ({ x: p.x, y: p.y }));
  const out: Proxy[] = [];
  const place = (id: LayerHandle, at: { x: number; y: number }, mirror: boolean) => {
    const q = pull(at);
    const onTopOrBottom = Math.abs(q.y - lo.y) < 0.5 || Math.abs(q.y - hi.y) < 0.5;
    const tries = [q];
    for (let k = 1; k <= 4; k++) for (const s of [k, -k]) tries.push(onTopOrBottom ? { x: q.x + s * gap, y: q.y } : { x: q.x, y: q.y + s * gap });
    const spot = tries.find((t) => inside(t) && taken.every((o) => Math.hypot(o.x - t.x, o.y - t.y) >= gap)) ?? q;
    taken.push(spot);
    out.push({ id, x: spot.x, y: spot.y, mirror });
  };
  // the box's bounding box: how much of it the viewer shows decides the move stand-in
  const r = (box.rotationDeg * Math.PI) / 180, ex = Math.abs((box.w / 2) * Math.cos(r)) + Math.abs((box.h / 2) * Math.sin(r)), ey = Math.abs((box.w / 2) * Math.sin(r)) + Math.abs((box.h / 2) * Math.cos(r));
  const boxOutside = box.cx + ex < lo.x || box.cx - ex > hi.x || box.cy + ey < lo.y || box.cy - ey > hi.y;
  const boxCovers = box.cx - ex <= view.left && box.cx + ex >= view.right && box.cy - ey <= view.top && box.cy + ey >= view.bottom;
  const f = a.focused ?? null;
  let scaleDone = scale.some(inside);
  let rotateDone = inside(rotate);
  let moveDone = !boxOutside;
  if (f === 'move') {
    if (boxOutside || boxCovers) { place('move', { x: box.cx, y: box.cy }, true); moveDone = true; }
  } else if (f === 'rotate') {
    if (!rotateDone) { place('rotate', rotate, true); rotateDone = true; }
  } else if (f) {
    const own = scale.find((p) => p.id === f);
    if (own && !inside(own)) { place(f, own, true); scaleDone = true; }
  }
  if (!rotateDone) place('rotate', rotate, false);
  if (!scaleDone) {
    const dist = (p: { x: number; y: number }) => { const q = pull(p); return Math.hypot(q.x - p.x, q.y - p.y); };
    const order = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'].map((id) => scale.find((p) => p.id === id)!); // on a tie, the middle of a side
    const near = order.reduce((best, p) => (dist(p) < dist(best) ? p : best));
    place(near.id, near, false);
  }
  if (!moveDone) place('move', { x: box.cx, y: box.cy }, false);
  return out;
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
