/**
 * The trip map dialog's logic without any DOM (wave 8 tripmap W3): the draft (stops in travel order, look, length, the bars box),
 * its checks, the place search wrapper, the picker's maths (a pixel of the picker canvas <-> a place, the keyboard crosshair) and
 * the operations a Create or a Save sends. Pure and unit tested (tripMap.logic.test.ts); the dialog (TripMapDialog.tsx) only draws it.
 *
 * Contracts used: core mapContract.ts (limits, quantiseMicro, mapFrames), mapOps.ts (add/update/time_trip_map arguments), tripMap.ts
 * (searchPlaces, cameraAt, mercator: W1's, injected where a test needs a stand-in), engine DrawnLayer (the picker's one map layer).
 */
import * as T from '@pulseframe/time';
import {
  DEFAULT_TRANSFORM, MAP_COORD_QUANTUM, MAP_INTRO_SECONDS, MAP_KIND, MAP_MIN_LEG_SECONDS, MAP_OUTRO_SECONDS, MAX_LAT_MICRO, MAX_LON_MICRO, MAX_MAP_STOPS,
  MAX_STOP_NAME, MIN_MAP_STOPS, mapFrames, quantiseMicro, searchPlaces, type DrawnClip, type MapCamera, type MapLook, type MapMode, type MapPayload, type MapSize, type MercPoint,
  type PlaceHit, type PlaceRow, type ProjectDocument,
} from '@pulseframe/core';

// ---------- the draft ----------
export interface DraftStop { id: string; name: string; hidden: boolean; lon: number; lat: number; via: MapMode; placeId?: number }
export interface Draft { stops: DraftStop[]; look: MapLook; /** the length field, as typed (seconds) */ seconds: string; bars: boolean }

/** Ids of draft stops are the dialog's own (the ops keep ids that are given; they must be unique within the map). */
export const newStopId = (n: number): string => `s${n}`;
export function stopFromHit(hit: Pick<PlaceHit, 'placeId' | 'lon' | 'lat'>, typed: string, id: string, via: MapMode = 'road'): DraftStop {
  return { id, name: typed.normalize('NFC').slice(0, MAX_STOP_NAME), hidden: false, lon: hit.lon, lat: hit.lat, via, placeId: hit.placeId };
}
export function stopFromPoint(lon: number, lat: number, typed: string, id: string, via: MapMode = 'road'): DraftStop {
  return { id, name: typed.normalize('NFC').slice(0, MAX_STOP_NAME), hidden: false, lon, lat, via };
}
export function draftOf(map: MapPayload, durationFrames: number, rate: T.Rate): Draft {
  return {
    stops: map.stops.map((s) => ({ id: s.id, name: s.name, hidden: s.hidden === true, lon: s.lon, lat: s.lat, via: s.via ?? 'road', ...(s.placeId ? { placeId: s.placeId } : {}) })),
    look: map.look, seconds: secondsText(durationFrames, rate), bars: map.timing === 'bars',
  };
}
export const moveStop = <A>(list: readonly A[], i: number, by: -1 | 1): A[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

// ---------- length: seconds typed, whole frames kept ----------
/** The shortest length that holds `stops` legs: intro and outro plus one second a leg (the op refuses less, mapOps evenly()). */
export function minFrames(stops: number, rate: T.Rate): number {
  return mapFrames(MAP_INTRO_SECONDS, rate) + mapFrames(MAP_OUTRO_SECONDS, rate) + Math.max(1, stops - 1) * mapFrames(MAP_MIN_LEG_SECONDS, rate);
}
/** The default length: three seconds a leg plus intro and outro, never under the minimum. */
export const defaultFrames = (stops: number, rate: T.Rate): number => Math.max(minFrames(stops, rate), mapFrames(MAP_INTRO_SECONDS + MAP_OUTRO_SECONDS + 3 * Math.max(1, stops - 1), rate));
/** Frames of a typed number of seconds (decimal point or comma), rounded once to the nearest whole frame; null when it is not a positive number. */
export function framesOfSeconds(text: string, rate: T.Rate): number | null {
  const v = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0 || v > 3600) return null;
  const f = Math.round((v * rate.num) / rate.den);
  return f >= 1 ? f : null;
}
/** Seconds of whole frames, as the field shows them: at most three decimals, no trailing zeros. */
export function secondsText(frames: number, rate: T.Rate): string {
  const v = (frames * rate.den) / rate.num;
  return String(Math.round(v * 1000) / 1000);
}

// ---------- checks (the ops refuse the same things; this says it before the click) ----------
export type DraftProblem =
  | { code: 'needStops' } | { code: 'needName'; n: number } | { code: 'needShown' } | { code: 'tooShort'; stops: number; minSeconds: string } | { code: 'badLength' } | { code: 'samePlace'; n: number };
export function draftProblems(d: Draft, rate: T.Rate): DraftProblem[] {
  const out: DraftProblem[] = [];
  const n = d.stops.length;
  if (n < MIN_MAP_STOPS) out.push({ code: 'needStops' });
  d.stops.forEach((s, i) => { if (!s.hidden && s.name.trim() === '') out.push({ code: 'needName', n: i + 1 }); });
  if (n > 0 && d.stops.every((s) => s.hidden)) out.push({ code: 'needShown' });
  for (let i = 1; i < n; i++) if (d.stops[i]!.lon === d.stops[i - 1]!.lon && d.stops[i]!.lat === d.stops[i - 1]!.lat) out.push({ code: 'samePlace', n: i + 1 });
  const f = framesOfSeconds(d.seconds, rate);
  if (f === null) out.push({ code: 'badLength' });
  else if (n >= MIN_MAP_STOPS && f < minFrames(n, rate)) out.push({ code: 'tooShort', stops: n, minSeconds: secondsText(minFrames(n, rate), rate) });
  return out;
}

// ---------- the place search ----------
/** The list is a lazy chunk (import()); a test passes its own rows. */
export type PlacesLoader = () => Promise<readonly PlaceRow[]>;
export const loadPlaces: PlacesLoader = async () => (await import('./places.data.ts')).default;
export const MAX_SUGGESTIONS = 8;
/** At most MAX_SUGGESTIONS hits for what is typed (core searchPlaces); nothing while the field is empty. A hit never changes what was typed. */
export function suggestionsFor(rows: readonly PlaceRow[], typed: string, search: typeof searchPlaces = searchPlaces): PlaceHit[] {
  if (typed.trim() === '') return [];
  return search(rows, typed, MAX_SUGGESTIONS).slice(0, MAX_SUGGESTIONS);
}
/** The line shown for a suggestion: its Hebrew name, and the English one beside it when it differs. */
export const hitLabel = (h: PlaceHit): string => (h.nameEn && h.nameEn !== h.nameHe ? `${h.nameHe} (${h.nameEn})` : h.nameHe);

// ---------- the picker ----------
export type PickerViewId = 'near' | 'world';
/** The two views, in degrees: [west, south, east, north]. The camera is core's «כל המסלול» fit of two corner stops, so the picture is the painter's own. */
export const PICKER_VIEWS: Readonly<Record<PickerViewId, readonly [number, number, number, number]>> = { near: [29, 27, 39.5, 36.5], world: [-180, -60, 180, 75] };
export const PICKER_SIZE: Readonly<MapSize> = { width: 640, height: 360 };
export interface PickerState { view: PickerViewId; /** zoom steps in (each halves the span) */ zoom: number; /** the crosshair, micro-degrees at the stored quantum */ lon: number; lat: number }
export const MAX_ZOOM = 6;
export const initialPicker = (view: PickerViewId = 'near'): PickerState => {
  const [w, s, e, n] = PICKER_VIEWS[view];
  return { view, zoom: 0, lon: quantiseMicro((w + e) / 2), lat: quantiseMicro((s + n) / 2) };
};
const clampMicro = (lon: number, lat: number): { lon: number; lat: number } => ({
  lon: Math.max(-MAX_LON_MICRO, Math.min(MAX_LON_MICRO, lon)), lat: Math.max(-MAX_LAT_MICRO, Math.min(MAX_LAT_MICRO, lat)),
});
/** Keys of the picker: arrows move the crosshair 0.1° (Shift 1°), + and − zoom, Enter places, Escape cancels. Anything else is null. */
export type PickerKey = { kind: 'move'; state: PickerState } | { kind: 'zoom'; state: PickerState } | { kind: 'place' } | { kind: 'cancel' };
export function pickerKey(st: PickerState, key: string, shift: boolean): PickerKey | null {
  const step = (shift ? 1 : 0.1) * 1_000_000;
  const at = (dLon: number, dLat: number): PickerKey => ({ kind: 'move', state: { ...st, ...clampMicro(st.lon + dLon, st.lat + dLat) } });
  switch (key) {
    case 'ArrowLeft': return at(-step, 0);
    case 'ArrowRight': return at(step, 0);
    case 'ArrowUp': return at(0, step);
    case 'ArrowDown': return at(0, -step);
    case '+': case '=': return { kind: 'zoom', state: { ...st, zoom: Math.min(MAX_ZOOM, st.zoom + 1) } };
    case '-': case '_': case '−': return { kind: 'zoom', state: { ...st, zoom: Math.max(0, st.zoom - 1) } };
    case 'Enter': return { kind: 'place' };
    case 'Escape': return { kind: 'cancel' };
    default: return null;
  }
}
/** The view's centre follows the crosshair (a crosshair never leaves the picture): centre = crosshair for a zoomed view; the whole view when not zoomed. */
export function pickerBox(st: PickerState): [number, number, number, number] {
  const [w, s, e, n] = PICKER_VIEWS[st.view];
  if (st.zoom === 0) return [w, s, e, n];
  const f = 2 ** st.zoom, hw = (e - w) / f / 2, hh = (n - s) / f / 2;
  const lon = st.lon / 1_000_000, lat = st.lat / 1_000_000;
  return [lon - hw, Math.max(-80, lat - hh), lon + hw, Math.min(80, lat + hh)];
}
/** The picker's map clip: two hidden corner stops of the view, drawn before the marker leaves (no route), so the camera is the painter's own fit. */
export function pickerPayload(st: PickerState, look: MapLook): MapPayload {
  const [w, s, e, n] = pickerBox(st);
  return {
    kind: MAP_KIND, v: 1, look, camera: 'whole', timing: 'even',
    stops: [
      { id: 'a', name: '', hidden: true, lon: quantiseMicro(w), lat: quantiseMicro(s), at: 30 },
      { id: 'b', name: '', hidden: true, lon: quantiseMicro(e), lat: quantiseMicro(n), at: 60, via: 'road' },
    ],
  };
}
/** Before stop 0 leaves: nothing has travelled. */
export const PICKER_FRAME = -1;
const DEG = 180 / Math.PI;
/** Mercator units (core mercator.ts: x = longitude in degrees, y = (180/pi) ln tan(pi/4 + phi/2)) back to degrees. */
export const unproject = (p: MercPoint): { lon: number; lat: number } => ({ lon: p.x, lat: (2 * Math.atan(Math.exp(p.y / DEG)) - Math.PI / 2) * DEG });
export const project = (lon: number, lat: number): MercPoint => ({ x: lon, y: DEG * Math.log(Math.tan(Math.PI / 4 + (Math.max(-80, Math.min(80, lat)) / DEG) / 2)) });
/** A pixel of the picker canvas as a stored place (quantised, longitude wrapped, latitude held within the map). */
export function pixelToPlace(cam: MapCamera, size: MapSize, px: number, py: number): { lon: number; lat: number } {
  const per = cam.spanY / size.height;
  const p = unproject({ x: cam.cx + (px - size.width / 2) * per, y: cam.cy - (py - size.height / 2) * per });
  let lon = p.lon;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return clampMicro(quantiseMicro(lon), quantiseMicro(p.lat));
}
/** Where a stored place falls on the picker canvas (for the crosshair), in pixels. */
export function placeToPixel(cam: MapCamera, size: MapSize, lon: number, lat: number): { x: number; y: number } {
  const per = cam.spanY / size.height, m = project(lon / 1_000_000, lat / 1_000_000);
  return { x: size.width / 2 + (m.x - cam.cx) / per, y: size.height / 2 - (m.y - cam.cy) / per };
}
/** A coordinate for display: degrees with the stored two decimals, sign kept (drawn in <bdi dir="ltr">). */
export const degText = (micro: number): string => (micro / 1_000_000).toFixed(2);

/** The picker's one layer, as the compositor takes it (engine DrawnLayer): the map is the whole frame. */
export function pickerLayer(payload: MapPayload, fps: T.Rate) {
  return { kind: 'drawn' as const, clipId: 'picker', trackId: 'picker', drawn: payload, transform: { ...DEFAULT_TRANSFORM }, clipTime: T.frameTime(0, fps), localFrame: PICKER_FRAME, fps };
}

// ---------- what Create and Save send ----------
export interface OpCallLike { op: string; args: Record<string, unknown> }
const stopArgs = (s: DraftStop) => ({
  id: s.id, name: s.name, lon: s.lon, lat: s.lat,
  ...(s.hidden ? { hidden: true as const } : {}), ...(s.placeId ? { placeId: s.placeId } : {}), via: s.via,
});
/** `via` is the leg INTO a stop: the first stop has none. */
export const stopsArg = (stops: readonly DraftStop[]) => stops.map((s, i) => { const a = stopArgs(s); if (i === 0) delete (a as { via?: unknown }).via; return a; });
export function sameStops(a: readonly DraftStop[], b: readonly DraftStop[]): boolean {
  return a.length === b.length && a.every((s, i) => { const t = b[i]!; return s.id === t.id && s.name === t.name && s.hidden === t.hidden && s.lon === t.lon && s.lat === t.lat && (i === 0 || s.via === t.via); });
}
/** Create: one add_trip_map. The bars step needs the new clip's id, so it is a second step (see the report: no binding between steps in a commit). */
export function createPlan(d: Draft, rate: T.Rate, at: T.RationalTime, sequenceId: string | undefined): { add: OpCallLike; bars: boolean } | null {
  const f = framesOfSeconds(d.seconds, rate);
  if (f === null || draftProblems(d, rate).length) return null;
  return {
    add: { op: 'add_trip_map', args: { ...(sequenceId ? { sequenceId } : {}), start: at, duration: T.frameTime(f, rate), stops: stopsArg(d.stops), look: d.look } },
    bars: d.bars,
  };
}
/**
 * Save: ONE transaction, in this order: trim the end when the length changed (so the timing sees the new length), update_trip_map when the
 * stops or the look changed (new stops without times: even timing again), time_trip_map when the bars box is ticked and the times are not
 * already on the bars of the same stops and length, or even when the box was cleared.
 */
export function savePlan(clip: DrawnClip, before: Draft, d: Draft, rate: T.Rate): OpCallLike[] | null {
  const f = framesOfSeconds(d.seconds, rate);
  if (f === null || draftProblems(d, rate).length) return null;
  const was = T.frameIndexAt(clip.duration, rate);
  const ops: OpCallLike[] = [];
  const lengthChanged = f !== was, stopsChanged = !sameStops(before.stops, d.stops);
  if (lengthChanged) ops.push({ op: 'trim_clip', args: { clipId: clip.id, edge: 'end', to: T.add(clip.start, T.frameTime(f, rate)), includeLinked: false } });
  if (stopsChanged || d.look !== before.look) ops.push({ op: 'update_trip_map', args: { clipId: clip.id, ...(stopsChanged ? { stops: stopsArg(d.stops) } : {}), ...(d.look !== before.look ? { look: d.look } : {}) } });
  // new stops (or a new length under even re-spaced stops) lose bar timing: put it back when the box is ticked
  const timingLost = stopsChanged;
  if (d.bars && (timingLost || lengthChanged || !before.bars)) ops.push({ op: 'time_trip_map', args: { clipId: clip.id, to: 'bars' } });
  else if (!d.bars && before.bars && !stopsChanged) ops.push({ op: 'time_trip_map', args: { clipId: clip.id, to: 'even' } });
  else if (!d.bars && lengthChanged && !stopsChanged && !before.bars) ops.push({ op: 'time_trip_map', args: { clipId: clip.id, to: 'even' } });
  return ops.length ? ops : null;
}
/** The «retime» button: time_trip_map bars again (music or length changed). */
export const retimePlan = (clipId: string): OpCallLike[] => [{ op: 'time_trip_map', args: { clipId, to: 'bars' } }];

/** Whether the bars box can be ticked: musicAt finds music with bars at the start in its own sequence (injected so a test needs no document). */
export type BarsState = { ok: true } | { ok: false; reason: 'barsNoMusic' | 'barsNoBars' };
export function barsState(music: { bars: readonly unknown[] } | null): BarsState {
  if (!music) return { ok: false, reason: 'barsNoMusic' };
  return music.bars.length ? { ok: true } : { ok: false, reason: 'barsNoBars' };
}
export const docRate = (d: ProjectDocument): T.Rate => d.settings.frameRate;
export { MAX_MAP_STOPS, MAX_STOP_NAME, MAP_COORD_QUANTUM };
