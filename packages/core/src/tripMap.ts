/**
 * The trip map's pure functions (wave 8 tripmap; contract mapContract.ts). Signatures by the lead's pre-pass; bodies by W1.
 *
 * Shared rules (tripmap-verify C3, C4, C5):
 * - Mercator units are the outline data's (tools/tripmap/build-data.mjs): x = longitude in degrees, y = (180/π)·ln(tan(π/4 + φ/2)),
 *   φ clamped to ±80°. Longitudes are unwrapped relative to stop 0 (a route never jumps across ±180°); the painter draws the land
 *   again at ±360° wherever the view crosses ±180°.
 * - Every time a function reads is a stop's `at` (integer clip-local frames) and the frame asked for: never the clip's start or
 *   length. Progress inside a leg is a ratio of two integers.
 * - Camera centre and span are snapped to a power-of-two grid no coarser than 1/MAP_PIXEL_GRID of an output pixel at the narrowest
 *   view of the trip; route samples to MAP_ROUTE_GRID Mercator units (finer than 1/64 px at every view the camera allows up to
 *   19 000 px of height). Multiples of a power of two are exact doubles, so last-bit differences of log/exp/sin between engines are
 *   absorbed except at an exact rounding tie. Route samples are computed once per payload by the caller (cache by payload JSON).
 * Nothing computed here is stored: stored values are the owner's integers.
 */
import * as T from '@pulseframe/time';
import {
  MAP_FIT_MARGIN, MAP_INTRO_SECONDS, MAP_LABEL_SIZE_FRAC, MAP_MIN_LEG_SECONDS, MAP_OUTRO_SECONDS, MAP_PIXEL_GRID, MAP_PUSH_IN,
  MAP_COORD_QUANTUM, MAX_LAT_MICRO, MIN_SPAN_LAT_DEG, mapFrames, type MapMode, type MapPayload,
} from './mapContract.ts';
import { heQueryForms, heSkeleton, searchKey } from './librarySearch.ts';

export class MapNotBuiltError extends Error {
  readonly code = 'map_not_built' as const;
  constructor(what: string) { super(`${what}: trip maps are not built in this build yet`); }
}

/** A point in Mercator units (see above). */
export interface MercPoint { x: number; y: number }
/** The view: centre and the height it spans, in Mercator units, snapped to the 1/64-px grid of `size`. */
export interface MapCamera { cx: number; cy: number; spanY: number }
export interface MapSize { width: number; height: number }
/** Where the marker is: the leg it travels (1-based: leg i ends at stop i; 0 before stop 0 leaves), progress s ∈ [0, 1]. */
export interface MapProgress { leg: number; s: number }

// ---------- projection ----------
const R2D = 180 / Math.PI;
const MAX_LAT_DEG = MAX_LAT_MICRO / 1e6;
/** Mercator y of a latitude in degrees, clamped to ±80° (the same expression as build-data.mjs mercY, so the route meets the coast). */
export const mercY = (latDeg: number): number => {
  const lat = Math.max(-MAX_LAT_DEG, Math.min(MAX_LAT_DEG, latDeg));
  return R2D * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
};
/** The inverse of mercY: latitude in degrees of a Mercator y. */
export const latOfMercY = (y: number): number => R2D * (2 * Math.atan(Math.exp(y / R2D)) - Math.PI / 2);
/** Mercator y of the ±80° limit. */
export const MERC_Y_LIMIT = mercY(MAX_LAT_DEG);

/** Micro-degrees → Mercator units (latitude clamped to ±80°). */
export function mercator(lonMicro: number, latMicro: number): MercPoint {
  return { x: lonMicro / 1e6, y: mercY(latMicro / 1e6) };
}
/** Mercator units → micro-degrees (not quantised; the dialog quantises with quantiseMicro). */
export function inverseMercator(p: MercPoint): { lonMicro: number; latMicro: number } {
  return { lonMicro: Math.round(p.x * 1e6), latMicro: Math.round(latOfMercY(p.y) * 1e6) };
}
/** Longitudes of the stops unwrapped relative to stop 0, in degrees (each within 180° of the previous). Integer arithmetic in µ°. */
export function unwrapLongitudes(map: MapPayload): number[] {
  const out: number[] = [];
  let prev = 0;
  map.stops.forEach((s, i) => {
    let l = s.lon;
    if (i > 0) { while (l - prev > 180_000_000) l -= 360_000_000; while (l - prev < -180_000_000) l += 360_000_000; }
    out.push(l / 1e6);
    prev = l;
  });
  return out;
}
/** Every stop in Mercator units, longitudes unwrapped relative to stop 0 (hidden via-points included: they shape the route). */
export function stopPoints(map: MapPayload): MercPoint[] {
  const lons = unwrapLongitudes(map);
  return map.stops.map((s, i) => ({ x: lons[i]!, y: mercY(s.lat / 1e6) }));
}
/** A Mercator point in output pixels under a camera (x right, y down; north up). The painter's transform is the same affine map. */
export function toScreen(cam: MapCamera, size: MapSize, p: MercPoint): { x: number; y: number } {
  const k = size.height / cam.spanY;
  return { x: size.width / 2 + (p.x - cam.cx) * k, y: size.height / 2 - (p.y - cam.cy) * k };
}

// ---------- timing ----------
/** Nearest integer to a/b (b > 0), ties up, exact for safe integers. */
const roundRatio = (a: number, b: number): number => Math.floor((2 * a + b) / (2 * b));
/** A number of seconds given in the contract (1, 1.5) as an exact fraction p/q. */
const secondsFraction = (s: number): [number, number] => {
  for (let q = 1; q <= 1000; q++) if (Number.isInteger(s * q)) return [s * q, q];
  return [Math.round(s * 1000), 1000];
};

/**
 * Even timing (MAP_TIMINGS 'even'): stop 0 at INTRO, the last at durationFrames − OUTRO, each `at` rounded once from its exact
 * definition t_i = INTRO + i·(D − INTRO − OUTRO)/(n − 1), all in frames of `rate` (INTRO and OUTRO are seconds × rate, exact).
 * Never accumulated (ADR-0003): each t_i is one integer fraction rounded to the nearest frame (ties up).
 */
export function evenStopFrames(stops: number, durationFrames: number, rate: T.Rate): number[] {
  const [ip, iq] = secondsFraction(MAP_INTRO_SECONDS), [op, oq] = secondsFraction(MAP_OUTRO_SECONDS);
  // frames: I = ip·num/(iq·den), O = op·num/(oq·den); common denominator Q = iq·oq·den (1 s = 1/1, 1.5 s = 3/2 → Q = 2·den)
  const Q = iq * oq * rate.den;
  const I = ip * oq * rate.num, O = op * iq * rate.num, D = durationFrames * Q; // each over Q
  if (stops <= 1) return [roundRatio(I, Q)];
  const legs = stops - 1;
  return Array.from({ length: stops }, (_, i) => roundRatio(I * legs + i * (D - I - O), Q * legs));
}

/**
 * Bar timing (C3): from the exact bar starts (timeline times, musicAt(doc, clip.start, sequenceId).bars) inside the clip, departure on
 * the first bar at or after clip start + 0.5 s, each arrival `barsPerLeg` bars later (1, else 2 when 1 leaves a leg under a second),
 * the last ≤ clip end − 0.5 s. Each `at` is the nearest frame to its bar start; residualMs is (frame time − bar start) in ms, |r| ≤ half
 * a frame. `{need, have}` when there are not enough bars (the op refuses unitsShort with `need`).
 * When even two bars per leg leave a leg under a second (a bar shorter than half a second) the answer still has barsPerLeg 2: the op
 * refuses it as tooShort.
 */
export function barStopFrames(bars: readonly T.RationalTime[], clipStart: T.RationalTime, durationFrames: number, stops: number, rate: T.Rate): { at: number[]; barsPerLeg: 1 | 2; residualMs: number[] } | { need: number; have: number } {
  const half = T.rt(1, 2);
  const from = T.add(clipStart, half), to = T.sub(T.add(clipStart, T.frameTime(durationFrames, rate)), half);
  const inside = [...bars].sort(T.cmp).filter((b) => T.lte(from, b) && T.lte(b, to));
  const legs = Math.max(0, stops - 1), minLeg = mapFrames(MAP_MIN_LEG_SECONDS, rate);
  const snap = (b: T.RationalTime) => T.nearestFrameIndex(T.sub(b, clipStart), rate);
  let last: { need: number; have: number } = { need: legs + 1, have: inside.length };
  for (const per of [1, 2] as const) {
    const need = legs * per + 1;
    if (inside.length < need) { last = { need, have: inside.length }; return last; }
    const chosen = Array.from({ length: stops }, (_, i) => inside[i * per]!);
    const at = chosen.map(snap);
    const short = at.some((a, i) => i > 0 && a - at[i - 1]! < minLeg);
    if (short && per === 1) continue;
    const residualMs = chosen.map((b, i) => Math.round(T.toSeconds(T.sub(T.add(clipStart, T.frameTime(at[i]!, rate)), b)) * 1e6) / 1e3);
    return { at, barsPerLeg: per, residualMs };
  }
  return last;
}

/**
 * The marker's leg and progress at a clip-local frame (smoothstep inside a leg; waits at stop 0 before it leaves and at the last stop
 * after). Leg 0 (s = 0): the marker rests at stop 0. On the arrival frame of stop i (0 < i < last) the answer is leg i + 1 at s = 0,
 * the same place as leg i at s = 1. s = p²(3q − 2p)/q³ with p = frame − at_{i−1}, q = at_i − at_{i−1}: a ratio of two integers.
 */
export function progressAt(map: MapPayload, localFrame: number): MapProgress {
  const s = map.stops, f = Math.floor(localFrame);
  if (f < s[0]!.at) return { leg: 0, s: 0 };
  const last = s.length - 1;
  if (f >= s[last]!.at) return { leg: last, s: 1 };
  let i = 1;
  while (s[i]!.at <= f) i++;
  return { leg: i, s: smoothRatio(f - s[i - 1]!.at, s[i]!.at - s[i - 1]!.at) };
}
/** smoothstep(p/q) as the ratio of two integers (BigInt when q³ is not a safe integer). */
function smoothRatio(p: number, q: number): number {
  if (q <= 200_000) return (p * p * (3 * q - 2 * p)) / (q * q * q);
  const P = BigInt(p), Q = BigInt(q);
  return Number(P * P * (3n * Q - 2n * P)) / Number(Q * Q * Q);
}

// ---------- camera ----------
/** Room kept for labels by the whole-trip fit, in label heights per side (a heuristic: one line above and below, two beside). */
export const MAP_LABEL_ROOM = { vertical: 1.25, horizontal: 2.5 } as const;
/** Route samples are snapped to multiples of this many Mercator units (2⁻²⁰). */
export const MAP_ROUTE_GRID = 2 ** -20;
const pow2Below = (x: number): number => 2 ** Math.floor(Math.log2(x));
const snapTo = (v: number, g: number): number => Math.round(v / g) * g + 0;

/** The whole-trip fit for an output size, before the push-in: centre and span of the stops' box with margins and label room. */
export function wholeFit(map: MapPayload, size: MapSize): MapCamera {
  const pts = stopPoints(map);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const aspect = size.width / size.height, L = MAP_LABEL_SIZE_FRAC;
  const innerV = 1 - 2 * MAP_FIT_MARGIN - 2 * MAP_LABEL_ROOM.vertical * L;
  const innerH = 1 - 2 * MAP_FIT_MARGIN - (2 * MAP_LABEL_ROOM.horizontal * L) / aspect;
  let spanY = Math.max((y1 - y0) / innerV, (x1 - x0) / (aspect * Math.max(innerH, 0.05)));
  const cy = (y0 + y1) / 2;
  const cx = (x0 + x1) / 2;
  spanY = Math.max(spanY, minSpanAt(cy) / MAP_PUSH_IN);
  return clampView({ cx, cy, spanY });
}
/** The Mercator height S of a view centred on `cy` that spans MIN_SPAN_LAT_DEG degrees of latitude (bisection, 60 steps, rounded up). */
function minSpanAt(cy: number): number {
  const deg = (S: number) => latOfMercY(cy + S / 2) - latOfMercY(cy - S / 2);
  let lo = 0, hi = 2 * MERC_Y_LIMIT;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (deg(mid) >= MIN_SPAN_LAT_DEG) hi = mid; else lo = mid; }
  return hi;
}
/** Keep the view inside ±80° of latitude (the span shrinks to the band if it is taller, the centre moves in). */
function clampView(c: MapCamera): MapCamera {
  const spanY = Math.min(c.spanY, 2 * MERC_Y_LIMIT);
  const cy = Math.max(-MERC_Y_LIMIT + spanY / 2, Math.min(MERC_Y_LIMIT - spanY / 2, c.cy));
  return { cx: c.cx, cy, spanY };
}

/**
 * The «כל המסלול» camera at a clip-local frame: the fit of all stops (margin MAP_FIT_MARGIN plus label room, span ≥ MIN_SPAN_LAT_DEG,
 * latitude ±80°) for the output aspect, pushing in by MAP_PUSH_IN from stop 0's `at` to the last stop's `at` (eased; constant outside).
 * Snapped to the 1/64-px grid of `size`. A 9:16 format refits itself (aspect).
 * The push-in is interpolated in log-span with the smoothstep of (frame − at₀)/(at_last − at₀); its fastest rate is
 * 1.5·log2(1/MAP_PUSH_IN)/(trip seconds) ≤ 0.23 log2 units per second for a trip of at least one second (MAX_ZOOM_RATE is 1).
 * The centre does not move (MAX_PAN_RATE holds trivially).
 */
export function cameraAt(map: MapPayload, localFrame: number, size: MapSize): MapCamera {
  const fit = wholeFit(map, size);
  const a = map.stops[0]!.at, b = map.stops[map.stops.length - 1]!.at, f = Math.floor(localFrame);
  const e = f <= a ? 0 : f >= b ? 1 : smoothRatio(f - a, b - a);
  const g = pow2Below((fit.spanY * MAP_PUSH_IN) / (size.height * MAP_PIXEL_GRID));
  const spanY = e === 0 ? fit.spanY : e === 1 ? fit.spanY * MAP_PUSH_IN : fit.spanY * Math.pow(MAP_PUSH_IN, e);
  // the span is snapped upward, so the snapped view never spans less than MIN_SPAN_LAT_DEG (downward only at the ±80° band); the
  // centre is snapped, then moved inward by whole grid steps until the view lies inside the band
  const band = 2 * MERC_Y_LIMIT, up = Math.ceil(spanY / g) * g, snappedSpan = up <= band ? up : Math.floor(band / g) * g;
  let cy = snapTo(fit.cy, g);
  while (cy + snappedSpan / 2 > MERC_Y_LIMIT) cy -= g;
  while (cy - snappedSpan / 2 < -MERC_Y_LIMIT) cy += g;
  return { cx: snapTo(fit.cx, g), cy: cy + 0, spanY: snappedSpan };
}

// ---------- routes ----------
/** Great-circle samples of a flight leg (65 points: 64 intervals, so the midpoint is a sample). */
export const MAP_FLIGHT_SAMPLES = 64;
/** The visual lift of a flight, as a fraction of the leg's straight length at the middle (0.15·L·4s(1−s)). */
export const MAP_FLIGHT_LIFT = 0.15;
const D2R = Math.PI / 180;
const unit = (lonDeg: number, latDeg: number): [number, number, number] => {
  const l = lonDeg * D2R, p = latDeg * D2R;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
};
/**
 * The leg's path in Mercator units, camera-independent: road and boat straight (boat drawn dotted), flight a great circle (64 slerp
 * samples, unwrapped sample to sample) with a visual lift 0.15·L·4s(1−s) toward screen-up. Cached per payload by the caller.
 * Layout: [x0, y0, x1, y1, …]; the first point is `a` and the last `b` exactly; inner samples snapped to MAP_ROUTE_GRID, lifted y
 * clamped to the ±80° band.
 */
export function legPath(a: MercPoint, b: MercPoint, mode: MapMode): Float64Array {
  if (mode !== 'flight' || (a.x === b.x && a.y === b.y)) return Float64Array.of(a.x, a.y, b.x, b.y);
  const n = MAP_FLIGHT_SAMPLES;
  const ua = unit(a.x, latOfMercY(a.y)), ub = unit(b.x, latOfMercY(b.y));
  const dot = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2]));
  const omega = Math.acos(dot), so = Math.sin(omega);
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const out = new Float64Array(2 * (n + 1));
  let prevX = a.x;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    let x: number, y: number;
    if (i === 0) { x = a.x; y = a.y; }
    else if (i === n) { x = b.x; y = b.y; }
    else {
      let v: [number, number, number];
      if (so < 1e-9) v = [ua[0] + (ub[0] - ua[0]) * s, ua[1] + (ub[1] - ua[1]) * s, ua[2] + (ub[2] - ua[2]) * s];
      else { const ka = Math.sin((1 - s) * omega) / so, kb = Math.sin(s * omega) / so; v = [ka * ua[0] + kb * ub[0], ka * ua[1] + kb * ub[1], ka * ua[2] + kb * ub[2]]; }
      const lat = Math.atan2(v[2], Math.hypot(v[0], v[1])) * R2D;
      let lon = Math.atan2(v[1], v[0]) * R2D;
      while (lon - prevX > 180) lon -= 360;
      while (lon - prevX < -180) lon += 360;
      x = snapTo(lon, MAP_ROUTE_GRID);
      const lifted = mercY(lat) + MAP_FLIGHT_LIFT * L * 4 * s * (1 - s);
      y = snapTo(Math.max(-MERC_Y_LIMIT, Math.min(MERC_Y_LIMIT, lifted)), MAP_ROUTE_GRID);
    }
    out[2 * i] = x; out[2 * i + 1] = y; prevX = x;
  }
  return out;
}
/** The point at arc-length fraction s ∈ [0, 1] of a path (even marker speed along a flight's samples). */
export function pathPointAt(path: Float64Array, s: number): MercPoint {
  const m = path.length / 2;
  if (m < 2 || s <= 0) return { x: path[0]!, y: path[1]! };
  if (s >= 1) return { x: path[2 * m - 2]!, y: path[2 * m - 1]! };
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < m; i++) { const d = Math.hypot(path[2 * i]! - path[2 * i - 2]!, path[2 * i + 1]! - path[2 * i - 1]!); seg.push(d); total += d; }
  let want = s * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i]! || i === seg.length - 1) {
      const t = seg[i]! > 0 ? Math.min(1, want / seg[i]!) : 0;
      return { x: path[2 * i]! + (path[2 * i + 2]! - path[2 * i]!) * t, y: path[2 * i + 1]! + (path[2 * i + 3]! - path[2 * i + 1]!) * t };
    }
    want -= seg[i]!;
  }
  return { x: path[2 * m - 2]!, y: path[2 * m - 1]! };
}

// ---------- labels ----------
/** One label to place: the stop's anchor in output pixels and the measured box of its text (the painter measures after the font is ready: C10). */
export interface LabelInput { stopId: string; x: number; y: number; width: number; height: number; rtl: boolean }
export interface LabelPlacement { stopId: string; box: { x: number; y: number; w: number; h: number } | null; side: 'start' | 'end' | 'above' | 'below' | null }
/** Heuristic sizes of the collision rule, in label heights: the gap between dot and label, the dot's half-size, the near-stop distance. */
export const MAP_LABEL_RULE = { gapEm: 0.25, dotEm: 0.3, nearEm: 1, insetFrac: 0.05 } as const;
type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** True when the segment p→q passes through the inside of the box (Liang–Barsky clip). */
function segmentHitsBox(p: MercPoint, q: MercPoint, b: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const edges: [number, number][] = [[-dx, p.x - b.x], [dx, b.x + b.w - p.x], [-dy, p.y - b.y], [dy, b.y + b.h - p.y]];
  for (const [pp, qq] of edges) {
    if (pp === 0) { if (qq <= 0) return false; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t1 - t0 > 1e-9;
}
/**
 * The collision rule (a heuristic; plan §4.4): candidates beside, then above, then below; the first inside the 5 % inset that overlaps
 * no placed label, dot or marker rest position wins, in stop order; none fits → hidden (box null) and reported. Decided once per
 * (payload, output size, font) in the whole-trip view and kept on every frame.
 *
 * W1's reading of the inputs: `dots` are every stop's position in output pixels in stop order (hidden via-points included; the marker
 * rests on stop 0 and the last stop, which are among them); `labels` are the shown stops in stop order, each anchored on its dot.
 * Sides are named in the label's reading direction: 'end' = the label follows the dot (an RTL label to its left, its first letter
 * beside the dot; an LTR one to its right), 'start' = the other side; then 'above', 'below'. A dot is a square of 2·dotEm label
 * heights; the gap is gapEm. A candidate that crosses the straight chord to a neighbouring stop is skipped. A label whose dot lies
 * within nearEm label heights of the dot of a stop already labelled is hidden (Tel Aviv and Jaffa: the later one; plan §4.4).
 */
export function placeLabels(labels: readonly LabelInput[], dots: readonly MercPoint[], size: MapSize): LabelPlacement[] {
  const ix = size.width * MAP_LABEL_RULE.insetFrac, iy = size.height * MAP_LABEL_RULE.insetFrac;
  const inside = (b: Box) => b.x >= ix && b.y >= iy && b.x + b.w <= size.width - ix && b.y + b.h <= size.height - iy;
  const placed: Box[] = [], labelledDots: { x: number; y: number; h: number }[] = [];
  return labels.map((l) => {
    const h = l.height, w = l.width, gap = MAP_LABEL_RULE.gapEm * h;
    const dotOf = (d: MercPoint, hh: number): Box => { const r = MAP_LABEL_RULE.dotEm * hh; return { x: d.x - r, y: d.y - r, w: 2 * r, h: 2 * r }; };
    const r = MAP_LABEL_RULE.dotEm * h;
    const hidden: LabelPlacement = { stopId: l.stopId, box: null, side: null };
    if (labelledDots.some((d) => Math.hypot(d.x - l.x, d.y - l.y) < MAP_LABEL_RULE.nearEm * Math.max(d.h, h))) return hidden;
    const left: Box = { x: l.x - r - gap - w, y: l.y - h / 2, w, h }, right: Box = { x: l.x + r + gap, y: l.y - h / 2, w, h };
    const cands: [LabelPlacement['side'], Box][] = [
      ['end', l.rtl ? left : right], ['start', l.rtl ? right : left],
      ['above', { x: l.x - w / 2, y: l.y - r - gap - h, w, h }], ['below', { x: l.x - w / 2, y: l.y + r + gap, w, h }],
    ];
    const k = dots.findIndex((d) => d.x === l.x && d.y === l.y);
    const chords: [MercPoint, MercPoint][] = k < 0 ? [] : [[dots[k]!, dots[k - 1]!], [dots[k]!, dots[k + 1]!]].filter((c): c is [MercPoint, MercPoint] => !!c[1]);
    for (const [side, box] of cands) {
      if (!inside(box)) continue;
      if (placed.some((p) => overlaps(p, box))) continue;
      if (dots.some((d) => overlaps(dotOf(d, h), box))) continue;
      if (chords.some(([p, q]) => segmentHitsBox(p, q, box))) continue;
      placed.push(box);
      labelledDots.push({ x: l.x, y: l.y, h });
      return { stopId: l.stopId, box, side };
    }
    return hidden;
  });
}

// ---------- place search ----------
/** One row of the built-in place list (web editor/tripMap/places.data.ts): [NE_ID, Hebrew name, English name, lon, lat] in hundredths of a degree. */
export type PlaceRow = readonly [number, string, string, number, number];
export interface PlaceHit { placeId: number; nameHe: string; nameEn: string; lon: number; lat: number }
const keyCache = new WeakMap<PlaceRow, { he: string; en: string; heSk: string }>();
const keysOf = (r: PlaceRow) => {
  let k = keyCache.get(r);
  if (!k) { const he = searchKey(r[1]); k = { he, en: searchKey(r[2]), heSk: heSkeleton(he) }; keyCache.set(r, k); }
  return k;
};
const wordsPrefixed = (key: string, tokens: readonly string[]) => { const ws = key.split(' '); return tokens.every((t) => ws.some((w) => w.startsWith(t))); };
/**
 * The dialog's search over the committed list (no route, no tool: C7): librarySearch.ts searchKey/heQueryForms/heSkeleton, prefix
 * matches first, at most `max` (8). `lon`/`lat` are micro-degrees (row × MAP_COORD_QUANTUM). A hit never changes what the owner typed.
 * Ranks: 0 the Hebrew or English name starts with the query; 1 every word of the query starts a word of a name; 2 the same with the
 * heuristic forms (heQueryForms without a prefix letter, heSkeleton without vowel letters). List order inside a rank.
 */
export function searchPlaces(rows: readonly PlaceRow[], query: string, max = 8): PlaceHit[] {
  const q = searchKey(query);
  if (!q || max <= 0) return [];
  const tokens = q.split(' ');
  const ranked: [number, number, PlaceRow][] = [];
  rows.forEach((r, i) => {
    const k = keysOf(r);
    let rank = -1;
    if (k.he.startsWith(q) || k.en.startsWith(q)) rank = 0;
    else if (wordsPrefixed(k.he, tokens) || wordsPrefixed(k.en, tokens)) rank = 1;
    else {
      const ws = k.he.split(' '), sk = k.heSk.split(' ');
      const ok = tokens.every((t) => heQueryForms(t).some((form) => ws.some((w) => w.startsWith(form)) || sk.some((w) => w.startsWith(heSkeleton(form)))));
      if (ok) rank = 2;
    }
    if (rank >= 0) ranked.push([rank, i, r]);
  });
  ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return ranked.slice(0, max).map(([, , r]) => ({ placeId: r[0], nameHe: r[1], nameEn: r[2], lon: r[3] * MAP_COORD_QUANTUM, lat: r[4] * MAP_COORD_QUANTUM }));
}
