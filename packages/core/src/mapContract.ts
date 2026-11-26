/**
 * «מפת טיול» — the trip map (wave 8 tripmap track; .artifacts/wave8/tripmap-plan.md as corrected by tripmap-verify.md and the lead's
 * Batch B decision). LEAD PRE-PASS: the payload contract of the drawn kind `map` (core drawn.ts carrier), its limits, its registration
 * (shift, summary, validate; no box: a map is the whole frame), the refusal table, and the shared constants. The pure functions are in
 * tripMap.ts (W1); the ops in mapOps.ts; the painter in engine map/ (W2); the dialog in web editor/tripMap/ (W3).
 *
 * Version 1 after the verifier's cuts: 2–12 stops; coastlines and lakes only, no border of any kind; two looks («נייר», «לילה»); one
 * camera («כל המסלול», a fit of all stops with a slow push-in defined from the stop times only); even timing, or bar starts of the
 * music under the clip snapped once to the nearest frame (C3). Nothing drawn depends on the clip's start or length (C4): every time
 * the drawing uses is a stop's `at`, an integer clip-local frame. Coordinates are stored at 0.01° for every writer (C7): the schema
 * refuses a value that is not a multiple of MAP_COORD_QUANTUM micro-degrees and the ops round. Places are never selected or shown by a
 * class (capital or otherwise).
 *
 * Registered on import (index.ts): a document may hold a map clip from this build on; while MAP_OPS_BUILT is false the ops refuse
 * `notBuilt` and the engine has no painter that draws one (it reports `drawn.map`, so a still or an export refuses).
 */
import { z } from 'zod';
import type * as T from '@pulseframe/time';
import { registerDrawnKind, type DrawnKindDef, type DrawnPayload, type DrawnSite } from './drawn.ts';
import { OpError, type OpErrorCode } from './ops.ts';

export const MAP_KIND = 'map' as const;
/** How the leg INTO a stop was travelled: a straight line, an arc (great circle with a visual lift), a dotted straight line. */
export const MAP_MODES = ['road', 'flight', 'boat'] as const;
export type MapMode = (typeof MAP_MODES)[number];
/** Two looks in version 1 (cut 3). Each has its own flash sweep in the proof (C6). */
export const MAP_LOOKS = ['paper', 'night'] as const;
export type MapLook = (typeof MAP_LOOKS)[number];
/** One camera in version 1 (cut 1: no `follow`). */
export const MAP_CAMERAS = ['whole'] as const;
/** even: INTRO … last at the end of the content, equal legs; bars: bar starts of the music under the clip, nearest frame (C3). */
export const MAP_TIMINGS = ['even', 'bars'] as const;
export type MapTiming = (typeof MAP_TIMINGS)[number];

export const MIN_MAP_STOPS = 2;
export const MAX_MAP_STOPS = 12;
export const MAX_STOP_NAME = 40;
/** Micro-degrees per stored step: 0.01° (about a kilometre). No house-level place is ever stored. */
export const MAP_COORD_QUANTUM = 10_000;
export const MAX_LON_MICRO = 180_000_000;
/** Latitude limit of the map (the outline data is clipped here at build time; tools/tripmap/build-data.mjs MAX_LAT). */
export const MAX_LAT_MICRO = 80_000_000;
/** Timing constants (seconds; turned into frames of the project rate with mapFrames, rounded once from the exact definition). */
export const MAP_MIN_LEG_SECONDS = 1;
export const MAP_INTRO_SECONDS = 1;
export const MAP_OUTRO_SECONDS = 1.5;
/** The whole-trip view never spans less than this many degrees of latitude (the data cannot support more). */
export const MIN_SPAN_LAT_DEG = 1.2;
/** Fraction of the frame kept around the stops by the whole-trip fit (plus room for labels). */
export const MAP_FIT_MARGIN = 0.18;
/** The push-in of the whole camera: the span shrinks by at most this factor over the trip (log2 units per second ≤ MAX_ZOOM_RATE). */
export const MAP_PUSH_IN = 0.9;
export const MAX_ZOOM_RATE = 1;
export const MAX_PAN_RATE = 0.5;
/** Label height as a fraction of the frame height. Version 1: fixed; the font is the bundled canvas font (Heebo 700, fonts.ts). */
export const MAP_LABEL_SIZE_FRAC = 0.04;
export const MAP_LABEL_FONT = { family: 'Heebo', weight: 700 } as const;
/** Arrival ring and label fade (seconds, from the stop's `at`; never from the clip's end: C4). */
export const MAP_RING_SECONDS = 0.5;
export const MAP_LABEL_FADE_SECONDS = 0.4;
/** Camera and route values are snapped to 1/MAP_PIXEL_GRID of an output pixel before use (C5). */
export const MAP_PIXEL_GRID = 64;
/** Bars per leg for `bars` timing: the smallest of these that gives every leg at least MAP_MIN_LEG_SECONDS (verifier cut 4). */
export const MAP_BARS_PER_LEG = [1, 2] as const;

/** The whole frames of the project rate nearest to `seconds` (exact: num/den rational of the rate; rounded once). */
export const mapFrames = (seconds: number, rate: T.Rate): number => Math.round((seconds * rate.num) / rate.den);

/**
 * The look table (W2 tunes the colours against the analyser; C6). Every fill pair (sea, land, lake) differs by less than 0.1 in
 * relative luminance measured through flashCells (engine test), the coast stroke's step against the land is at most
 * MAP_COAST_MAX_STEP, and no route, marker or label colour is saturated red (R/(R+G+B) ≥ 0.8). Provisional values, not looked at.
 */
export interface MapLookColours { sea: string; land: string; lake: string; coast: string; route: string; marker: string; label: string; labelOutline: string }
export const MAP_LOOK_COLOURS: Readonly<Record<MapLook, MapLookColours>> = {
  // W2 (2026-11-26), measured through flashCells in engine map/paintMap.test.ts, nobody has looked at them: paper's coast lightened from
  // #8A9A9E (its step against the land was 0.447, over MAP_COAST_MAX_STEP) to #A3B1B4 (0.331); each marker now differs from its route
  // colour so the proof can find the marker by colour (paper #0F7A5C, night #7FE0C8; neither is saturated red).
  paper: { sea: '#C9DCE3', land: '#E9E1CE', lake: '#C9DCE3', coast: '#A3B1B4', route: '#2F4B7C', marker: '#0F7A5C', label: '#1F2A36', labelOutline: '#F7F3EA' },
  night: { sea: '#14233A', land: '#25344A', lake: '#14233A', coast: '#52657D', route: '#F2C14E', marker: '#7FE0C8', label: '#F4F1E8', labelOutline: '#0E1726' },
};
export const MAP_COAST_MAX_STEP = 0.35;

// ---------- payload ----------
const micro = (lim: number) => z.number().int().min(-lim).max(lim).refine((v) => v % MAP_COORD_QUANTUM === 0, { message: `must be a multiple of ${MAP_COORD_QUANTUM} micro-degrees (0.01°)` });
export const MapStopSchema = z.object({
  id: z.string().min(1).max(64),
  /** Drawn verbatim, as the owner typed it; '' only on a hidden stop. */
  name: z.string().max(MAX_STOP_NAME),
  lon: micro(MAX_LON_MICRO),
  lat: micro(MAX_LAT_MICRO),
  /** Clip-local frame (project rate): stop 0 = when the marker leaves it; stop i>0 = when it arrives. Strictly increasing, legs ≥
   *  MAP_MIN_LEG_SECONDS. May lie outside [0, duration) after a trim or split: the drawing never reads the clip's length (C4). */
  at: z.number().int().min(-10_000_000).max(10_000_000),
  /** How the leg INTO this stop was travelled; absent on stop 0, absent elsewhere = road. */
  via: z.enum(MAP_MODES).optional(),
  /** A via-point: no dot and no label (it shapes a route). */
  hidden: z.literal(true).optional(),
  /** Natural Earth NE_ID when picked from the built-in list (provenance only; never looked up at render time). */
  placeId: z.number().int().positive().optional(),
}).strict();
export const MapPayloadSchema = z.object({
  kind: z.literal(MAP_KIND),
  v: z.literal(1),
  stops: z.array(MapStopSchema).min(MIN_MAP_STOPS).max(MAX_MAP_STOPS),
  look: z.enum(MAP_LOOKS),
  camera: z.enum(MAP_CAMERAS),
  timing: z.enum(MAP_TIMINGS),
  /** With timing 'bars': the music the times were put on (informational, never re-read at render). */
  timedTo: z.object({ assetId: z.string().min(1).max(64), barsPerLeg: z.union([z.literal(1), z.literal(2)]) }).strict().optional(),
}).strict();
export type MapStop = z.infer<typeof MapStopSchema>;
export type MapPayload = z.infer<typeof MapPayloadSchema> & DrawnPayload;
/** JSON length cap of one payload (12 stops with 64-char ids and 40-char names fit with room). */
export const MAP_MAX_CHARS = 6_000;

// ---------- refusals ----------
/** One refusal: the OpError code (an existing one), the map's own reason (details.reason and the i18n error key), English with the next step. */
export interface MapRefusalRow<A extends unknown[]> { code: OpErrorCode; reason: string; message: (...a: A) => string; hint: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, reason: string, message: (...a: A) => string, hint: string): MapRefusalRow<A> => ({ code, reason, message, hint });
/** Every refusal of add_trip_map, update_trip_map and time_trip_map, and the validate issues (same reasons). Hebrew: i18n tripMap.ts HE_TRIPMAP. */
export const MAP_REFUSALS = {
  notBuilt: refusal('unknown_op', 'map_not_built', (op: string) => `${op}: trip maps are not built in this build yet`, 'Nothing was changed. Update the editor and try again.'),
  stopCount: refusal('invalid_args', 'map_stop_count', (n: number) => `a trip map has ${MIN_MAP_STOPS} to ${MAX_MAP_STOPS} stops, not ${n}`, 'Add or remove stops.'),
  stopName: refusal('invalid_args', 'map_stop_name', (i: number) => `stop ${i + 1} has an empty name or one longer than ${MAX_STOP_NAME} characters`, 'Type a shorter name, or hide the stop\'s name.'),
  noLabel: refusal('invalid_args', 'map_no_label', () => 'every stop of the map is hidden', 'Show the name of at least one stop.'),
  stopPlace: refusal('out_of_bounds', 'map_stop_place', (i: number) => `stop ${i + 1} is off the map: latitude must lie between -80 and 80, longitude between -180 and 180`, 'Choose a place nearer the equator.'),
  samePlace: refusal('invalid_args', 'map_same_place', (i: number) => `stops ${i} and ${i + 1} are at the same place`, 'Remove one of them, or move it.'),
  stopIds: refusal('invalid_args', 'map_stop_ids', () => 'two stops of the map have the same id', 'Give each stop its own id, or leave the ids out.'),
  times: refusal('invalid_args', 'map_times', () => 'arrival times must be given on every stop or on none, and must increase from stop to stop', 'Leave the times out to space them evenly.'),
  firstVia: refusal('invalid_args', 'map_first_via', () => 'the first stop has no leg into it, so it has no travel mode', 'Give the travel mode on the stop the leg arrives at.'),
  tooShort: refusal('invalid_args', 'map_too_short', (n: number, frames: number) => `the map is too short for ${n} legs: each leg needs at least ${frames} frames (one second)`, 'Make the map longer or remove a stop.'),
  noMusic: refusal('incompatible', 'map_no_music', () => 'no analysed music with bar starts plays at the start of the map', 'Put analysed music under the start of the map, or keep even timing.'),
  noBars: refusal('incompatible', 'map_no_bars', () => 'no bars were found in the music under the map', 'Keep even timing.'),
  unitsShort: refusal('incompatible', 'map_units_short', (need: number, have: number) => `the music under the map has ${have} bar starts in the map's time; ${need} are needed`, 'Make the map longer, remove a stop, or keep even timing.'),
  notMap: refusal('incompatible', 'map_not_map', (clipId: string) => `clip ${clipId} is not a trip map`, 'Choose a trip map clip; get_timeline lists the clips.'),
} as const;
export type MapRefusalKey = keyof typeof MAP_REFUSALS;
export function mapRefusal<K extends MapRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof MAP_REFUSALS)[K]['message']>): OpError {
  const r = MAP_REFUSALS[key] as MapRefusalRow<unknown[]>;
  return new OpError(r.code, r.message(...values), { reason: r.reason, ...details }, r.hint);
}

// ---------- document checks (the kind's validate hook) ----------
/**
 * The map's own document rules, for every writer (an op, an archive, a restored version): names, at least one label, stop ids
 * unique, times strictly increasing with legs of at least MAP_MIN_LEG_SECONDS, consecutive stops not at the same place. The schema
 * already holds the coordinate quantum and bounds. Codes are the refusal reasons above.
 */
export function mapIssues(p: MapPayload, at: DrawnSite): { code: string; message: string }[] {
  const out: { code: string; message: string }[] = [];
  const add = (k: MapRefusalKey, ...v: unknown[]) => out.push({ code: MAP_REFUSALS[k].reason, message: (MAP_REFUSALS[k] as MapRefusalRow<unknown[]>).message(...v) });
  const s = p.stops;
  s.forEach((st, i) => { if (st.hidden ? st.name.length > MAX_STOP_NAME : st.name.trim() === '' || st.name.length > MAX_STOP_NAME) add('stopName', i); });
  if (s.every((st) => st.hidden)) add('noLabel');
  if (new Set(s.map((st) => st.id)).size !== s.length) add('stopIds');
  const minLeg = mapFrames(MAP_MIN_LEG_SECONDS, at.doc.settings.frameRate);
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!, b = s[i]!;
    if (b.at <= a.at) { add('times'); break; }
    if (b.at - a.at < minLeg) { add('tooShort', s.length - 1, minLeg); break; }
  }
  for (let i = 1; i < s.length; i++) if (s[i]!.lon === s[i - 1]!.lon && s[i]!.lat === s[i - 1]!.lat) add('samePlace', i);
  return out;
}

/** What agents see of a map (drawnSummary; the assistant sends it only with «כותרות וסמנים» on, like a title's words). */
export function mapSummary(p: MapPayload): Record<string, unknown> {
  return {
    stops: p.stops.length,
    modes: p.stops.slice(1).map((s) => s.via ?? 'road'),
    names: p.stops.filter((s) => !s.hidden).map((s) => s.name),
    look: p.look, timing: p.timing,
  };
}

export const MAP_KIND_DEF: DrawnKindDef<MapPayload> = {
  kind: MAP_KIND,
  name: { he: 'מפת טיול', en: 'Trip map' },
  schema: MapPayloadSchema as unknown as z.ZodType<MapPayload>,
  limits: { maxChars: MAP_MAX_CHARS },
  // the content moves against the clip's start: a stop at clip-local frame f is at f − frames afterwards (as keyframes move)
  shift: (p, s) => (s.frames === 0 ? p : { ...p, stops: p.stops.map((st) => ({ ...st, at: st.at - s.frames })) }),
  summary: mapSummary,
  validate: mapIssues,
  // no box: a map is the whole frame (the carrier's default for a kind without one)
};
registerDrawnKind(MAP_KIND_DEF);

/** True for a drawn clip that holds a trip map. */
export const isMapPayload = (p: DrawnPayload | null | undefined): p is MapPayload => p?.kind === MAP_KIND;
/** A coordinate in degrees rounded to the stored quantum, in micro-degrees (every writer stores this). */
export const quantiseMicro = (deg: number): number => Math.round(deg * 100) * MAP_COORD_QUANTUM;
