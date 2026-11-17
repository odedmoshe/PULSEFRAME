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

// ---- the timeline of the redesign (docs/design/UX_REDESIGN.md §4.7) ----

/** The lane a track is drawn in: its height and tint come from the role (timeline.css, the --pf-lane-* tokens). */
export type LaneRole = 't' | 'c' | 'fx' | 'v2' | 'v1' | 'a1' | 'a2' | 'a3';
export interface Lane<TR> { track: TR; role: LaneRole; /** Short id by kind and place: V1, V2, A1, T1, C1, FX1. */ code: string }
const KIND_PREFIX: Record<string, string> = { video: 'V', audio: 'A', text: 'T', caption: 'C', adjustment: 'FX' };

/**
 * The order the lanes are shown in, top to bottom: titles, captions, then the picture stack as it is drawn (adjustment and
 * video tracks, the front-most first, so the main track V1 is the last picture lane), then sound in list order (A1, A2, A3).
 * The project lists picture tracks bottom-most first, so the picture groups are reversed and the sound group is not.
 * Adjustment and video tracks stay in their true order among themselves: an adjustment layer acts on the pictures below it,
 * and a layer moved between two video tracks must be seen there.
 */
export function laneOrder<TR extends { id: string; kind: string }>(tracks: readonly TR[]): Lane<TR>[] {
  const ordinal = new Map<string, number>();
  const codeOf = new Map<string, string>();
  for (const t of tracks) { const n = (ordinal.get(t.kind) ?? 0) + 1; ordinal.set(t.kind, n); codeOf.set(t.id, `${KIND_PREFIX[t.kind] ?? '?'}${n}`); }
  const main = tracks.find((t) => t.kind === 'video')?.id;
  const audio = tracks.filter((t) => t.kind === 'audio');
  const roleOf = (t: TR): LaneRole => t.kind === 'text' ? 't' : t.kind === 'caption' ? 'c' : t.kind === 'adjustment' ? 'fx' : t.kind === 'video' ? (t.id === main ? 'v1' : 'v2')
    : (['a1', 'a2'] as const)[audio.indexOf(t)] ?? 'a3';
  const back = (kinds: string[]) => tracks.filter((t) => kinds.includes(t.kind)).reverse();
  return [...back(['text']), ...back(['caption']), ...back(['adjustment', 'video']), ...audio].map((track) => ({ track, role: roleOf(track), code: codeOf.get(track.id)! }));
}

/** A cut: two clips of one track that touch (the second starts exactly where the first ends). */
export interface Cut<C> { before: C; after: C; at: T.RationalTime }
export function cutsOf<C extends { id: string; start: T.RationalTime; duration: T.RationalTime }>(clips: readonly C[]): Cut<C>[] {
  const sorted = [...clips].sort((a, b) => T.cmp(a.start, b.start));
  const out: Cut<C>[] = [];
  for (let i = 1; i < sorted.length; i++) if (T.eq(T.add(sorted[i - 1]!.start, sorted[i - 1]!.duration), sorted[i]!.start)) out.push({ before: sorted[i - 1]!, after: sorted[i]!, at: sorted[i]!.start });
  return out;
}

/** Index of the last value <= x in an ascending list, or -1. */
export function lastAtOrBefore(sorted: ArrayLike<number>, x: number): number {
  let lo = 0, hi = sorted.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (sorted[mid]! <= x) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at;
}

/**
 * Bars and beats as the Pulse Strip counts them, from the analysed grid on the timeline (frame numbers, ascending; a bar
 * start is one of the beats). `at(frame)`: the bar (1-based) and the beat in it (1-based) the frame falls in, or null before
 * the first bar start or when no bar starts are known. Nothing is extrapolated: outside the analysed grid there is no answer.
 */
export function barGrid(beatFrames: readonly number[], barFrames: readonly number[]) {
  const beats = [...beatFrames].sort((a, b) => a - b), bars = [...barFrames].sort((a, b) => a - b);
  return {
    beats, bars,
    at(frame: number): { bar: number; beat: number; onBeat: boolean; onBar: boolean } | null {
      const b = lastAtOrBefore(bars, frame);
      if (b < 0) return null;
      const from = lastAtOrBefore(beats, bars[b]!), now = lastAtOrBefore(beats, frame);
      if (from < 0 || now < from) return null;
      // past the last analysed beat by more than a beat's length: no claim
      if (now === beats.length - 1 && beats.length > 1 && frame - beats[now]! > beats[now]! - beats[now - 1]!) return null;
      return { bar: b + 1, beat: now - from + 1, onBeat: beats[now] === frame, onBar: bars[b] === frame };
    },
    /** The beat nearest to a frame (ties: the earlier), or null without beats. */
    nearestBeat(frame: number): number | null {
      const i = lastAtOrBefore(beats, frame);
      const a = i >= 0 ? beats[i]! : null, b = i + 1 < beats.length ? beats[i + 1]! : null;
      return a === null ? b : b === null ? a : frame - a <= b - frame ? a : b;
    },
    /** A length in frames as whole beats or bars when it is one (within a frame), from the median beat length; otherwise null. */
    lengthIn(frames: number): { unit: 'bar' | 'beat'; count: number } | null {
      if (beats.length < 3 || frames <= 0) return null;
      const gaps = beats.slice(1).map((v, i) => v - beats[i]!).sort((x, y) => x - y), beat = gaps[gaps.length >> 1]!;
      if (!(beat > 0)) return null;
      const perBar = bars.length >= 2 ? Math.round((bars[1]! - bars[0]!) / beat) : 0;
      const n = frames / beat;
      if (Math.abs(n - Math.round(n)) * beat > 1 || Math.round(n) < 1) return null;
      const whole = Math.round(n);
      return perBar >= 2 && whole % perBar === 0 ? { unit: 'bar', count: whole / perBar } : { unit: 'beat', count: whole };
    },
  };
}
export type BarGrid = ReturnType<typeof barGrid>;

/** What a dragged edge or clip snapped to. Beats and bar starts are told apart so the tether can name them. */
export type SnapKind = 'playhead' | 'clip-edge' | 'zero' | 'marker' | 'scene' | 'beat' | 'bar';
export interface SnapTarget { time: T.RationalTime; kind: SnapKind }
/** Snap precedence when two targets are equally near: the playhead and cuts first, then bar starts, beats, markers and scene cuts. */
const SNAP_RANK: Record<SnapKind, number> = { playhead: 0, 'clip-edge': 1, zero: 2, bar: 3, beat: 4, marker: 5, scene: 6 };
/**
 * Snap to the nearest target within the threshold. Among targets at the same distance (a bar start is also a beat, and a
 * cut may sit on one) the higher-ranked kind names the snap; the time is the same either way.
 */
export function snapToTargets(a: { time: T.RationalTime; targets: readonly SnapTarget[]; pxPerSecond: number; thresholdPx: number }): { time: T.RationalTime; kind: SnapKind } | null {
  let best: SnapTarget | null = null, bestDist = Infinity;
  for (const t of a.targets) {
    const dist = Math.abs(T.toSeconds(T.sub(t.time, a.time))) * a.pxPerSecond;
    if (dist > a.thresholdPx) continue;
    if (dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) <= 1e-9 && best && SNAP_RANK[t.kind] < SNAP_RANK[best.kind])) { best = t; bestDist = dist; }
  }
  return best ? { time: best.time, kind: best.kind } : null;
}
/** Beats (and the bar starts among them) as snap targets, each moved to its nearest frame so what snaps stays frame-aligned. */
export function beatSnapTargets(beats: readonly T.RationalTime[], downbeats: readonly T.RationalTime[], rate: T.Rate): SnapTarget[] {
  const bars = new Set(downbeats.map((d) => T.nearestFrameIndex(d, rate)));
  return beats.map((b) => { const time = T.snapToFrame(b, rate); return { time, kind: bars.has(T.nearestFrameIndex(b, rate)) ? 'bar' as const : 'beat' as const }; });
}

/** The spacing of the ruler's labels: the smallest step from a fixed ladder that keeps two labels at least `minPx` apart. */
const RULER_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
export function rulerStep(pxPerSecond: number, minPx = 72): number {
  return RULER_STEPS.find((s) => s * pxPerSecond >= minPx) ?? RULER_STEPS[RULER_STEPS.length - 1]!;
}
/** A ruler label: m:ss, with tenths when the step is below a second. */
export function rulerLabel(seconds: number, step: number): string {
  const whole = Math.floor(seconds + 1e-9), m = Math.floor(whole / 60), s = whole % 60;
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return step < 1 ? `${base}.${Math.round((seconds - whole) * 10)}` : base;
}
/** How many of the bars get a number at this zoom: every bar, or every 2nd, 4th, 8th… so two numbers are at least `minPx` apart. */
export function barLabelEvery(pxPerBar: number, minPx = 34): number {
  let every = 1;
  while (pxPerBar * every < minPx && every < 4096) every *= 2;
  return every;
}

/** A signed length for the trim chip: +0:00.12 (minutes:seconds.frames). */
export function signedTimecode(frames: number, rate: T.Rate): string {
  const fps = Math.round(rate.num / rate.den) || 1, n = Math.abs(frames);
  const s = Math.floor(n / fps), f = n % fps;
  return `${frames < 0 ? '−' : '+'}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

// ---- a catalogue item dragged onto the timeline (a transition onto a cut, an effect or a look onto a clip) ----
// While something is dragged over a drop target the browser shows the page only the TYPES of the dragged data, never the
// data. The drop tip must name the item before it is dropped ("release to apply «light leak» to «kids dancing»"), so the
// kind, id and name travel in the type string itself. Type strings are lower-cased by the browser: the values are hex.

export type CatalogKind = 'transition' | 'effect' | 'look';
export interface CatalogDragItem { kind: CatalogKind; id: string; name: string }
export const CATALOG_DRAG_PREFIX = 'application/x-pulseframe-catalog;';
const hex = (s: string) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h: string): string | null => {
  if (h.length % 2 || /[^0-9a-f]/.test(h)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16))); } catch { return null; }
};
/** The drag type a gallery tile sets (`e.dataTransfer.setData(catalogDragType(item), item.id)`). */
export function catalogDragType(item: CatalogDragItem): string {
  return `${CATALOG_DRAG_PREFIX}k=${item.kind};i=${hex(item.id)};n=${hex(item.name.slice(0, 80))}`;
}
/** The catalogue item among the types of a drag, or null when the drag carries none (or a malformed one). */
export function catalogDragFrom(types: readonly string[]): CatalogDragItem | null {
  for (const t of types) {
    if (!t.startsWith(CATALOG_DRAG_PREFIX)) continue;
    const f = Object.fromEntries(t.slice(CATALOG_DRAG_PREFIX.length).split(';').map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
    const id = unhex(f.i ?? ''), name = unhex(f.n ?? '');
    if ((f.k === 'transition' || f.k === 'effect' || f.k === 'look') && id) return { kind: f.k, id, name: name ?? '' };
  }
  return null;
}

// ---- the splitter between the viewer and the timeline ----
/** The timeline's height after a splitter move: at least `min`, and never so tall that the viewer above keeps less than `keepAbove`. */
export function splitterHeight(wanted: number, a: { min: number; available: number; keepAbove: number }): number {
  const max = Math.max(a.min, a.available - a.keepAbove);
  return Math.round(Math.min(max, Math.max(a.min, wanted)));
}
