/**
 * The three public operations of «מפת טיול» (wave 8 tripmap; contract mapContract.ts). Registered on import (index.ts). LEAD PRE-PASS:
 * names, versions, descriptions, argument schemas, refusal order and the bodies, which use the pure functions of tripMap.ts (W1 builds
 * those). Each body first refuses `notBuilt` while MAP_OPS_BUILT is false: until W1 has built the timing functions and the engine
 * draws a map, an op that placed one would put an undrawable clip on the timeline. W1 sets MAP_OPS_BUILT.
 *
 * Every writer stores coordinates at 0.01° (C7): the ops take micro-degrees (degrees × 1 000 000, like the stored stops) and round
 * them to MAP_COORD_QUANTUM. One op = one transaction = one undo (the generic entity diff). All three are in ASSISTANT_EXCLUDED_OPS so
 * the reviewed assistant prompt is unchanged; they stay on MCP and REST as ordinary reversible edits. No place route, no find_place.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { defineOp, mustClip, placeDrawnClip } from './ops.ts';
import { musicAt } from './musicGrid.ts';
import type { DrawnClip, ProjectDocument } from './schema.ts';
import {
  MAP_INTRO_SECONDS, MAP_KIND, MAP_LOOKS, MAP_MIN_LEG_SECONDS, MAP_MODES, MAP_OUTRO_SECONDS, MAP_TIMINGS, MAX_LAT_MICRO, MAX_LON_MICRO,
  MAX_MAP_STOPS, MAX_STOP_NAME, MIN_MAP_STOPS, isMapPayload, mapFrames, mapRefusal, type MapPayload, type MapStop,
} from './mapContract.ts';
import { barStopFrames, evenStopFrames } from './tripMap.ts';

/** W1 sets this when tripMap.ts's timing functions are built and the engine painter draws a map. */
export const MAP_OPS_BUILT = false;
export const MAP_PUBLIC_OPS = ['add_trip_map', 'update_trip_map', 'time_trip_map'] as const;

const R = z.object({ value: z.string(), timescale: z.number().int().positive() }).strict();
const StopArgSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().max(200).describe(`the name drawn on the map, exactly as typed (at most ${MAX_STOP_NAME} characters; '' only with hidden)`),
  lon: z.number().int().min(-1_000_000_000).max(1_000_000_000).describe('micro-degrees east (degrees × 1 000 000), rounded to 0.01°; -180…180°'),
  lat: z.number().int().min(-1_000_000_000).max(1_000_000_000).describe('micro-degrees north, rounded to 0.01°; -80…80°'),
  via: z.enum(MAP_MODES).optional().describe('how the leg INTO this stop was travelled (road = straight line, flight = arc, boat = dotted); not on the first stop; absent = road'),
  hidden: z.literal(true).optional().describe('a via-point: no dot and no name, it only shapes the route'),
  placeId: z.number().int().positive().optional().describe('Natural Earth NE_ID when the place came from the built-in list (provenance only)'),
  at: z.number().int().min(-10_000_000).max(10_000_000).optional().describe('clip-local frame of the arrival (stop 0: departure); give it on every stop or on none (none = even timing)'),
}).strict();
export const AddTripMapArgsSchema = z.object({
  sequenceId: z.string().optional(), trackId: z.string().optional(),
  start: R, duration: R,
  stops: z.array(StopArgSchema).max(64),
  look: z.enum(MAP_LOOKS).optional().describe('paper (default) or night'),
}).strict();
export const UpdateTripMapArgsSchema = z.object({
  clipId: z.string(),
  stops: z.array(StopArgSchema).max(64).optional().describe('replaces every stop; without times they are spaced evenly again and the timing becomes even'),
  look: z.enum(MAP_LOOKS).optional(),
}).strict();
export const TimeTripMapArgsSchema = z.object({
  clipId: z.string(),
  to: z.enum(MAP_TIMINGS).describe('even, or bars: each arrival on a bar start of the analysed music under the start of the map (nearest frame)'),
}).strict();
type StopArg = z.infer<typeof StopArgSchema>;

const notBuilt = (op: string) => { if (!MAP_OPS_BUILT) throw mapRefusal('notBuilt', { op }, op); };
const roundMicro = (v: number) => Math.round(v / 10_000) * 10_000 || 0;

/** The stops as stored, in the refusal order of MAP_REFUSALS; `at` from the args or from even timing over `durationFrames`. */
function stopsOf(d: ProjectDocument, args: StopArg[], durationFrames: number, ids: () => string): { stops: MapStop[]; timing: 'even' } | { stops: MapStop[]; timing: 'given' } {
  const n = args.length;
  if (n < MIN_MAP_STOPS || n > MAX_MAP_STOPS) throw mapRefusal('stopCount', { stops: n }, n);
  const stops: MapStop[] = args.map((a, i) => {
    if (i === 0 && a.via) throw mapRefusal('firstVia', { stop: 0 });
    const name = a.name.normalize('NFC');
    if (name.length > MAX_STOP_NAME || (!a.hidden && name.trim() === '')) throw mapRefusal('stopName', { stop: i }, i);
    const lon = roundMicro(a.lon), lat = roundMicro(a.lat);
    if (Math.abs(lon) > MAX_LON_MICRO || Math.abs(lat) > MAX_LAT_MICRO) throw mapRefusal('stopPlace', { stop: i }, i);
    return { id: a.id ?? ids(), name, lon, lat, at: a.at ?? 0, ...(i > 0 && a.via ? { via: a.via } : {}), ...(a.hidden ? { hidden: true as const } : {}), ...(a.placeId ? { placeId: a.placeId } : {}) };
  });
  if (stops.every((s) => s.hidden)) throw mapRefusal('noLabel', {});
  if (new Set(stops.map((s) => s.id)).size !== n) throw mapRefusal('stopIds', {});
  for (let i = 1; i < n; i++) if (stops[i]!.lon === stops[i - 1]!.lon && stops[i]!.lat === stops[i - 1]!.lat) throw mapRefusal('samePlace', { stop: i }, i);
  const rate = d.settings.frameRate, minLeg = mapFrames(MAP_MIN_LEG_SECONDS, rate);
  const given = args.filter((a) => a.at !== undefined).length;
  if (given !== 0 && given !== n) throw mapRefusal('times', {});
  if (given === n) {
    for (let i = 1; i < n; i++) {
      if (stops[i]!.at <= stops[i - 1]!.at) throw mapRefusal('times', {});
      if (stops[i]!.at - stops[i - 1]!.at < minLeg) throw mapRefusal('tooShort', { legs: n - 1, minLeg }, n - 1, minLeg);
    }
    return { stops, timing: 'given' };
  }
  return { stops: evenly(stops, durationFrames, rate), timing: 'even' };
}
function evenly(stops: MapStop[], durationFrames: number, rate: T.Rate): MapStop[] {
  const n = stops.length, minLeg = mapFrames(MAP_MIN_LEG_SECONDS, rate);
  if (durationFrames - mapFrames(MAP_INTRO_SECONDS, rate) - mapFrames(MAP_OUTRO_SECONDS, rate) < (n - 1) * minLeg) throw mapRefusal('tooShort', { legs: n - 1, minLeg }, n - 1, minLeg);
  const at = evenStopFrames(n, durationFrames, rate);
  return stops.map((s, i) => ({ ...s, at: at[i]! }));
}
function mustMap(d: ProjectDocument, clipId: string): { clip: DrawnClip & { drawn: MapPayload }; seqId: string } {
  const f = mustClip(d, clipId);
  if (f.clip.type !== 'drawn' || !isMapPayload(f.clip.drawn)) throw mapRefusal('notMap', { clipId }, clipId);
  return { clip: f.clip as DrawnClip & { drawn: MapPayload }, seqId: f.seq.id };
}

defineOp({
  name: 'add_trip_map',
  version: 1,
  description: `Add a trip map clip («מפת טיול») on a titles track: ${MIN_MAP_STOPS}–${MAX_MAP_STOPS} stops (name as typed, micro-degree coordinates rounded to 0.01°, the travel mode of each leg), coastlines and lakes only (no borders), a line travelling from stop to stop and each name appearing on arrival. Look paper or night; the camera shows the whole route. Without times the stops are spaced evenly; time_trip_map puts them on the bars of the music. Placed like add_text (a named text track, else a free one, else a new one).`,
  args: AddTripMapArgsSchema,
  apply(d, a, ctx) {
    notBuilt('add_trip_map');
    const rate = d.settings.frameRate;
    const { stops } = stopsOf(d, a.stops, T.frameIndexAt(a.duration, rate), () => ctx.newId('stp'));
    const drawn: MapPayload = { kind: MAP_KIND, v: 1, stops, look: a.look ?? 'paper', camera: 'whole', timing: 'even' };
    const { clip, track } = placeDrawnClip(d, { sequenceId: a.sequenceId, trackId: a.trackId, start: a.start, duration: a.duration, drawn }, ctx);
    return { affectedIds: [clip.id], summary: `Added a trip map with ${stops.length} stops`, output: { clipId: clip.id, trackId: track.id } };
  },
});

defineOp({
  name: 'update_trip_map',
  version: 1,
  description: 'Change a trip map: replace its stops (without times they are spaced evenly over the clip again and the timing becomes even) and/or its look. Its place on the timeline, size and effects are changed with the ordinary clip operations.',
  args: UpdateTripMapArgsSchema,
  apply(d, a, ctx) {
    notBuilt('update_trip_map');
    const { clip } = mustMap(d, a.clipId);
    const next: MapPayload = structuredClone(clip.drawn);
    if (a.stops) {
      const r = stopsOf(d, a.stops, T.frameIndexAt(clip.duration, d.settings.frameRate), () => ctx.newId('stp'));
      next.stops = r.stops;
      if (r.timing === 'even') { next.timing = 'even'; delete next.timedTo; }
    }
    if (a.look) next.look = a.look;
    clip.drawn = next;
    return { affectedIds: [clip.id], summary: `Changed the trip map (${next.stops.length} stops, ${next.look})` };
  },
});

defineOp({
  name: 'time_trip_map',
  version: 1,
  description: 'Time a trip map: even (stops spaced evenly over the clip) or bars (each arrival on a bar start of the analysed music under the start of the map, one or two bars per leg, snapped to the nearest frame). The times stay when the song changes later.',
  args: TimeTripMapArgsSchema,
  apply(d, a) {
    notBuilt('time_trip_map');
    const { clip, seqId } = mustMap(d, a.clipId);
    const rate = d.settings.frameRate, durationFrames = T.frameIndexAt(clip.duration, rate);
    const next: MapPayload = structuredClone(clip.drawn);
    if (a.to === 'even') { next.stops = evenly(next.stops, durationFrames, rate); next.timing = 'even'; delete next.timedTo; }
    else {
      const music = musicAt(d, clip.start, seqId);
      if (!music) throw mapRefusal('noMusic', { clipId: clip.id });
      if (!music.bars.length) throw mapRefusal('noBars', { clipId: clip.id, assetId: music.viaAssetId });
      const r = barStopFrames(music.bars, clip.start, durationFrames, next.stops.length, rate);
      if ('need' in r) throw mapRefusal('unitsShort', { clipId: clip.id, need: r.need, have: r.have }, r.need, r.have);
      next.stops = next.stops.map((s, i) => ({ ...s, at: r.at[i]! }));
      next.timing = 'bars';
      next.timedTo = { assetId: music.viaAssetId, barsPerLeg: r.barsPerLeg };
    }
    clip.drawn = next;
    return { affectedIds: [clip.id], summary: `Timed the trip map: ${a.to}` };
  },
});
