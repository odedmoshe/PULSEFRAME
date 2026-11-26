/**
 * The trip map's pure functions (wave 8 tripmap; contract mapContract.ts). LEAD PRE-PASS: signatures and types only; W1 builds the
 * bodies and their tests and sets MAP_OPS_BUILT (mapOps.ts) once the ops use them. Until then each throws MapNotBuiltError.
 *
 * Shared rules (tripmap-verify C3, C4, C5):
 * - Mercator units are the outline data's (tools/tripmap/build-data.mjs): x = longitude in degrees, y = (180/π)·ln(tan(π/4 + φ/2)),
 *   φ clamped to ±80°. Longitudes are unwrapped relative to stop 0 (a route never jumps across ±180°); the painter draws the land
 *   again at ±360° wherever the view crosses ±180°.
 * - Every time a function reads is a stop's `at` (integer clip-local frames) and the frame asked for: never the clip's start or
 *   length. Progress inside a leg is a ratio of two integers.
 * - Camera centre and span and route samples are snapped to 1/MAP_PIXEL_GRID of an output pixel before use; route samples are
 *   computed once per payload (cache by payload JSON) in Mercator units.
 * Nothing computed here is stored: stored values are the owner's integers.
 */
import type * as T from '@pulseframe/time';
import type { MapMode, MapPayload } from './mapContract.ts';

export class MapNotBuiltError extends Error {
  readonly code = 'map_not_built' as const;
  constructor(what: string) { super(`${what}: trip maps are not built in this build yet`); }
}
const notBuilt = (what: string): never => { throw new MapNotBuiltError(what); };

/** A point in Mercator units (see above). */
export interface MercPoint { x: number; y: number }
/** The view: centre and the height it spans, in Mercator units, snapped to the 1/64-px grid of `size`. */
export interface MapCamera { cx: number; cy: number; spanY: number }
export interface MapSize { width: number; height: number }
/** Where the marker is: the leg it travels (1-based: leg i ends at stop i; 0 before stop 0 leaves), progress s ∈ [0, 1]. */
export interface MapProgress { leg: number; s: number }

/** Micro-degrees → Mercator units (latitude clamped to ±80°). */
export function mercator(lonMicro: number, latMicro: number): MercPoint { return notBuilt(`mercator(${lonMicro}, ${latMicro})`); }
/** Longitudes of the stops unwrapped relative to stop 0, in degrees (each within 180° of the previous). */
export function unwrapLongitudes(map: MapPayload): number[] { return notBuilt(`unwrapLongitudes(${map.stops.length} stops)`); }

/** Even timing (MAP_TIMINGS 'even'): stop 0 at INTRO, the last at durationFrames − OUTRO, each `at` rounded once from its exact definition. */
export function evenStopFrames(stops: number, durationFrames: number, rate: T.Rate): number[] { return notBuilt(`evenStopFrames(${stops}, ${durationFrames}, ${rate.num}/${rate.den})`); }
/**
 * Bar timing (C3): from the exact bar starts (timeline times, musicAt(doc, clip.start, sequenceId).bars) inside the clip, departure on
 * the first bar at or after clip start + 0.5 s, each arrival `barsPerLeg` bars later (1, else 2 when 1 leaves a leg under a second),
 * the last ≤ clip end − 0.5 s. Each `at` is the nearest frame to its bar start; residualMs is (frame time − bar start) in ms, |r| ≤ half
 * a frame. Null when there are not enough bars (the op refuses unitsShort with `need`).
 */
export function barStopFrames(bars: readonly T.RationalTime[], clipStart: T.RationalTime, durationFrames: number, stops: number, rate: T.Rate): { at: number[]; barsPerLeg: 1 | 2; residualMs: number[] } | { need: number; have: number } {
  return notBuilt(`barStopFrames(${bars.length} bars, ${stops} stops, ${durationFrames}, ${clipStart.value}/${rate.num})`);
}

/** The marker's leg and progress at a clip-local frame (smoothstep inside a leg; waits at stop 0 before it leaves and at the last stop after). */
export function progressAt(map: MapPayload, localFrame: number): MapProgress { return notBuilt(`progressAt(${localFrame}, ${map.stops.length})`); }
/**
 * The «כל המסלול» camera at a clip-local frame: the fit of all stops (margin MAP_FIT_MARGIN plus label room, span ≥ MIN_SPAN_LAT_DEG,
 * latitude ±80°) for the output aspect, pushing in by MAP_PUSH_IN from stop 0's `at` to the last stop's `at` (eased; constant outside).
 * Snapped to the 1/64-px grid of `size`. A 9:16 format refits itself (aspect).
 */
export function cameraAt(map: MapPayload, localFrame: number, size: MapSize): MapCamera { return notBuilt(`cameraAt(${localFrame}, ${size.width}x${size.height}, ${map.stops.length})`); }
/**
 * The leg's path in Mercator units, camera-independent: road and boat straight (boat drawn dotted), flight a great circle (64 slerp
 * samples, unwrapped sample to sample) with a visual lift 0.15·L·4s(1−s) toward screen-up. Cached per payload by the caller.
 */
export function legPath(a: MercPoint, b: MercPoint, mode: MapMode): Float64Array { return notBuilt(`legPath(${a.x},${a.y} → ${b.x},${b.y}, ${mode})`); }

/** One label to place: the stop's anchor in output pixels and the measured box of its text (the painter measures after the font is ready: C10). */
export interface LabelInput { stopId: string; x: number; y: number; width: number; height: number; rtl: boolean }
export interface LabelPlacement { stopId: string; box: { x: number; y: number; w: number; h: number } | null; side: 'start' | 'end' | 'above' | 'below' | null }
/**
 * The collision rule (a heuristic; plan §4.4): candidates beside, then above, then below; the first inside the 5 % inset that overlaps
 * no placed label, dot or marker rest position wins, in stop order; none fits → hidden (box null) and reported. Decided once per
 * (payload, output size, font) in the whole-trip view and kept on every frame.
 */
export function placeLabels(labels: readonly LabelInput[], dots: readonly MercPoint[], size: MapSize): LabelPlacement[] { return notBuilt(`placeLabels(${labels.length}, ${dots.length}, ${size.width}x${size.height})`); }

/** One row of the built-in place list (web editor/tripMap/places.data.ts): [NE_ID, Hebrew name, English name, lon, lat] in hundredths of a degree. */
export type PlaceRow = readonly [number, string, string, number, number];
export interface PlaceHit { placeId: number; nameHe: string; nameEn: string; lon: number; lat: number }
/**
 * The dialog's search over the committed list (no route, no tool: C7): librarySearch.ts searchKey/heQueryForms/heSkeleton, prefix
 * matches first, at most `max` (8). `lon`/`lat` are micro-degrees (row × MAP_COORD_QUANTUM). A hit never changes what the owner typed.
 */
export function searchPlaces(rows: readonly PlaceRow[], query: string, max = 8): PlaceHit[] { return notBuilt(`searchPlaces(${rows.length} rows, ${query.length} chars, ${max})`); }
