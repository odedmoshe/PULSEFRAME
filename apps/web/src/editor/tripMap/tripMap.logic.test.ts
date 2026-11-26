/**
 * The trip map dialog's logic (wave 8 tripmap W3; integration: the stand-ins for W1's search and camera are gone, the real core
 * searchPlaces, cameraAt and toScreen run here).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { cameraAt, MapPayloadSchema, mapIssues, searchPlaces, toScreen, mercator, type DrawnClip, type MapCamera, type MapPayload, type PlaceRow } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import {
  barsState, createPlan, defaultFrames, draftOf, draftProblems, framesOfSeconds, hitLabel, initialPicker, minFrames, moveStop, pickerBox, pickerKey, pickerPayload, pixelToPlace,
  placeToPixel, project, retimePlan, savePlan, secondsText, stopFromHit, stopsArg, suggestionsFor, unproject, MAX_SUGGESTIONS, PICKER_SIZE, type Draft, type DraftStop,
} from './tripMap.logic.ts';

const R30 = { num: 30, den: 1 }, R2997 = { num: 30000, den: 1001 };
const stop = (id: string, name: string, lon: number, lat: number, extra: Partial<DraftStop> = {}): DraftStop => ({ id, name, hidden: false, lon, lat, via: 'road', ...extra });
const A = stop('a', 'תל אביב', 34_770_000, 32_080_000), B = stop('b', 'אילת', 34_950_000, 29_560_000, { via: 'flight' });
const draft = (o: Partial<Draft> = {}): Draft => ({ stops: [A, B], look: 'paper', seconds: '8', bars: false, ...o });

describe('length: seconds typed, whole frames kept', () => {
  it('rounds once to the nearest frame, accepts a comma, refuses non-numbers', () => {
    expect(framesOfSeconds('8', R30)).toBe(240);
    expect(framesOfSeconds('2,5', R30)).toBe(75);
    expect(framesOfSeconds('1.0167', R30)).toBe(31);
    expect(framesOfSeconds('abc', R30)).toBeNull();
    expect(framesOfSeconds('0', R30)).toBeNull();
    expect(framesOfSeconds('-3', R30)).toBeNull();
    expect(framesOfSeconds('10', R2997)).toBe(300);
  });
  it('secondsText shows at most three decimals', () => {
    expect(secondsText(240, R30)).toBe('8');
    expect(secondsText(31, R30)).toBe('1.033');
  });
  it('the minimum holds intro, outro and one second a leg; the default is never under it', () => {
    expect(minFrames(2, R30)).toBe(30 + 45 + 30);
    expect(minFrames(4, R30)).toBe(30 + 45 + 90);
    for (const n of [2, 3, 7, 12]) expect(defaultFrames(n, R30)).toBeGreaterThanOrEqual(minFrames(n, R30));
  });
});

describe('draft checks say before the click what the ops would refuse', () => {
  it('a good draft has none', () => expect(draftProblems(draft(), R30)).toEqual([]));
  it('fewer than two stops, an empty shown name, all hidden, same place, a short length', () => {
    expect(draftProblems(draft({ stops: [A] }), R30).map((p) => p.code)).toContain('needStops');
    expect(draftProblems(draft({ stops: [A, { ...B, name: ' ' }] }), R30)).toContainEqual({ code: 'needName', n: 2 });
    expect(draftProblems(draft({ stops: [{ ...A, hidden: true }, { ...B, hidden: true }] }), R30).map((p) => p.code)).toContain('needShown');
    expect(draftProblems(draft({ stops: [A, { ...B, lon: A.lon, lat: A.lat }] }), R30)).toContainEqual({ code: 'samePlace', n: 2 });
    expect(draftProblems(draft({ seconds: '3' }), R30)).toContainEqual({ code: 'tooShort', stops: 2, minSeconds: '3.5' });
    expect(draftProblems(draft({ seconds: 'x' }), R30).map((p) => p.code)).toContain('badLength');
  });
  it('a hidden stop may have an empty name', () => expect(draftProblems(draft({ stops: [A, { ...B, name: '', hidden: true }, { ...A, id: 'c', lon: 35_000_000 }] }), R30)).toEqual([]));
});

describe('search wrapper (core searchPlaces, the real one)', () => {
  const rows: PlaceRow[] = Array.from({ length: 30 }, (_, i) => [i + 1, `מקום ${i}`, `Place ${i}`, 3000 + i, 3000 + i] as const);
  const search = searchPlaces; // the default of suggestionsFor, passed explicitly
  it('the default search is core searchPlaces over the committed list: «ירושלים» is found, «אילת» is not in the list', async () => {
    const list = (await import('./places.data.ts')).default;
    expect(suggestionsFor(list, 'ירושלים')[0]?.nameHe).toBe('ירושלים');
    expect(suggestionsFor(list, 'אילת')).toEqual([]);
  });
  it('no query, no hits; never more than eight', () => {
    expect(suggestionsFor(rows, '  ', search)).toEqual([]);
    expect(suggestionsFor(rows, 'מקום', search)).toHaveLength(MAX_SUGGESTIONS);
  });
  it('a hit gives coordinates and placeId, and the typed text stays the name', () => {
    const hit = suggestionsFor(rows, 'מקום 1', search)[0]!;
    const s = stopFromHit(hit, 'ת"א שלנו', 's1');
    expect(s).toMatchObject({ name: 'ת"א שלנו', lon: hit.lon, lat: hit.lat, placeId: hit.placeId, hidden: false });
    expect(hitLabel(hit)).toBe(`${hit.nameHe} (${hit.nameEn})`);
  });
  it('a name is cut at the limit', () => expect(stopFromHit({ placeId: 1, lon: 0, lat: 0 }, 'x'.repeat(60), 's').name).toHaveLength(40));
});

describe('picker keys', () => {
  const st = initialPicker('near');
  it('arrows move 0.1 degree, Shift 1 degree, at the stored quantum', () => {
    const r = pickerKey(st, 'ArrowRight', false);
    expect(r).toMatchObject({ kind: 'move' });
    expect((r as { state: typeof st }).state.lon - st.lon).toBe(100_000);
    expect(((pickerKey(st, 'ArrowUp', true) as { state: typeof st }).state.lat - st.lat)).toBe(1_000_000);
    expect(((pickerKey(st, 'ArrowDown', false) as { state: typeof st }).state.lat - st.lat)).toBe(-100_000);
  });
  it('plus and minus zoom within bounds; Enter places; Escape cancels; others are ignored', () => {
    expect((pickerKey(st, '+', false) as { state: typeof st }).state.zoom).toBe(1);
    expect((pickerKey(st, '-', false) as { state: typeof st }).state.zoom).toBe(0);
    expect(pickerKey(st, 'Enter', false)).toEqual({ kind: 'place' });
    expect(pickerKey(st, 'Escape', false)).toEqual({ kind: 'cancel' });
    expect(pickerKey(st, 'a', false)).toBeNull();
  });
  it('the crosshair never leaves the map', () => {
    const edge = { ...st, lat: 80_000_000 };
    expect((pickerKey(edge, 'ArrowUp', true) as { state: typeof st }).state.lat).toBe(80_000_000);
  });
  it('the picker payload is a valid map payload whose hidden corner stops keep the quantum; zoomed boxes stay within the map', () => {
    for (const v of ['near', 'world'] as const) {
      const p = pickerPayload({ ...initialPicker(v), zoom: 2 }, 'night');
      expect(MapPayloadSchema.safeParse(p).success).toBe(true);
      const b = pickerBox({ ...initialPicker(v), zoom: 2 });
      expect(b[1]).toBeGreaterThanOrEqual(-80);
      expect(b[3]).toBeLessThanOrEqual(80);
    }
  });
});

describe('picker maths (core cameraAt and toScreen)', () => {
  const cam: MapCamera = { cx: 34.5, cy: project(0, 32).y, spanY: 12 };
  it('the picker camera is core cameraAt of the picker payload, and its pixels are core toScreen', () => {
    const c = cameraAt(pickerPayload(initialPicker('near'), 'paper'), -1, PICKER_SIZE);
    const want = toScreen(c, PICKER_SIZE, mercator(35_000_000, 31_000_000));
    const got = placeToPixel(c, PICKER_SIZE, 35_000_000, 31_000_000);
    expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(1e-9);
  });
  it('«כל העולם» shows the whole world: the picker camera spans at least 300 degrees of longitude (corners at ±180 must not unwrap onto one another)', () => {
    const c = cameraAt(pickerPayload(initialPicker('world'), 'paper'), -1, PICKER_SIZE);
    const spanLon = (c.spanY * PICKER_SIZE.width) / PICKER_SIZE.height;
    expect(spanLon).toBeGreaterThanOrEqual(300);
    expect(Math.abs(c.cx)).toBeLessThan(1);
    expect(MapPayloadSchema.safeParse(pickerPayload(initialPicker('world'), 'night')).success).toBe(true);
  });
  it('mercator and its inverse agree', () => {
    for (const [lon, lat] of [[34.77, 32.08], [-118.2, 34.05], [139.7, 35.7]] as const) {
      const p = unproject(project(lon, lat));
      expect(p.lon).toBeCloseTo(lon, 9);
      expect(p.lat).toBeCloseTo(lat, 9);
    }
  });
  it('the centre pixel is the camera centre, quantised to 0.01 degree; pixel and place round trip within a pixel', () => {
    const c = pixelToPlace(cam, PICKER_SIZE, PICKER_SIZE.width / 2, PICKER_SIZE.height / 2);
    expect(c.lon).toBe(34_500_000);
    expect(c.lon % 10_000).toBe(0);
    expect(c.lat % 10_000).toBe(0);
    const px = placeToPixel(cam, PICKER_SIZE, 35_000_000, 31_000_000);
    const back = pixelToPlace(cam, PICKER_SIZE, px.x, px.y);
    const again = placeToPixel(cam, PICKER_SIZE, back.lon, back.lat);
    expect(Math.hypot(again.x - px.x, again.y - px.y)).toBeLessThan(1.5);
  });
  it('a click across the date line wraps and the latitude is held within the map', () => {
    const far: MapCamera = { cx: 175, cy: 0, spanY: 120 };
    expect(Math.abs(pixelToPlace(far, PICKER_SIZE, PICKER_SIZE.width - 1, 180).lon)).toBeLessThanOrEqual(180_000_000);
    expect(Math.abs(pixelToPlace({ cx: 0, cy: 170, spanY: 50 }, PICKER_SIZE, 320, 0).lat)).toBeLessThanOrEqual(80_000_000);
  });
});

describe('what Create and Save send', () => {
  const at = T.frameTime(90, R30);
  it('create: ONE add_trip_map with the stops in order, no times, via not on the first stop; the bars box rides on it as timing (one undo)', () => {
    const ops = createPlan(draft({ bars: true }), R30, at, 'seq_x')!;
    expect(ops).toHaveLength(1);
    expect(ops[0]!.op).toBe('add_trip_map');
    expect(ops[0]!.args.timing).toBe('bars');
    expect(createPlan(draft({ bars: false }), R30, at, 'seq_x')![0]!.args).not.toHaveProperty('timing');
    const a = ops[0]!.args as { start: unknown; duration: unknown; stops: Record<string, unknown>[]; look: string; sequenceId: string };
    expect(a.sequenceId).toBe('seq_x');
    expect(a.start).toEqual(at);
    expect(T.frameIndexAt(a.duration as T.RationalTime, R30)).toBe(240);
    expect(a.stops.map((s) => s.name)).toEqual(['תל אביב', 'אילת']);
    expect(a.stops[0]).not.toHaveProperty('via');
    expect(a.stops[1]!.via).toBe('flight');
    expect(a.stops.every((s) => !('at' in s))).toBe(true);
  });
  it('create refuses a draft with problems', () => expect(createPlan(draft({ stops: [A] }), R30, at, undefined)).toBeNull());
  const clip = { id: 'clp_1', type: 'drawn', start: at, duration: T.frameTime(240, R30), transform: {}, drawn: null } as unknown as DrawnClip;
  const map: MapPayload = { kind: 'map', v: 1, look: 'paper', camera: 'whole', timing: 'even', stops: [
    { id: 'a', name: 'תל אביב', lon: 34_770_000, lat: 32_080_000, at: 30 }, { id: 'b', name: 'אילת', lon: 34_950_000, lat: 29_560_000, at: 210, via: 'flight' }] };
  const before = draftOf(map, 240, R30);
  it('save: nothing changed sends nothing', () => expect(savePlan(clip, before, { ...before }, R30)).toBeNull());
  it('save: a look change is one update_trip_map with the look only', () => {
    const ops = savePlan(clip, before, { ...before, look: 'night' }, R30)!;
    expect(ops).toEqual([{ op: 'update_trip_map', args: { clipId: 'clp_1', look: 'night' } }]);
  });
  it('save: a new length trims first, then new stops, then bars, in that order', () => {
    const d: Draft = { ...before, seconds: '10', bars: true, stops: [...before.stops, stop('c', 'פטרה', 35_440_000, 30_320_000)] };
    const ops = savePlan(clip, before, d, R30)!;
    expect(ops.map((o) => o.op)).toEqual(['trim_clip', 'update_trip_map', 'time_trip_map']);
    expect(ops[0]!.args).toMatchObject({ clipId: 'clp_1', edge: 'end', includeLinked: false });
    expect(T.frameIndexAt(ops[0]!.args.to as T.RationalTime, R30)).toBe(90 + 300);
    expect(ops[2]!.args).toEqual({ clipId: 'clp_1', to: 'bars' });
  });
  it('save: clearing the bars box on unchanged stops puts even timing back', () => {
    const barsMap: MapPayload = { ...map, timing: 'bars', timedTo: { assetId: 'ast_1', barsPerLeg: 1 } };
    const b = draftOf(barsMap, 240, R30);
    expect(b.bars).toBe(true);
    expect(savePlan(clip, b, { ...b, bars: false }, R30)).toEqual([{ op: 'time_trip_map', args: { clipId: 'clp_1', to: 'even' } }]);
  });
  it('retime is time_trip_map bars', () => expect(retimePlan('c')).toEqual([{ op: 'time_trip_map', args: { clipId: 'c', to: 'bars' } }]));
  it('stopsArg and the document checks agree on a draft the dialog accepts', () => {
    const args = stopsArg(draft().stops);
    expect(args).toHaveLength(2);
    const p: MapPayload = { ...map, stops: map.stops.map((s, i) => ({ ...s, name: args[i]!.name as string })) };
    expect(mapIssues(p, { doc: { settings: { frameRate: R30 } } } as never)).toEqual([]);
  });
  it('moveStop swaps neighbours and ignores the ends', () => {
    expect(moveStop([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveStop([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveStop([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });
});

describe('bars box', () => {
  it('needs music with bars; says which reason', () => {
    expect(barsState(null)).toEqual({ ok: false, reason: 'barsNoMusic' });
    expect(barsState({ bars: [] })).toEqual({ ok: false, reason: 'barsNoBars' });
    expect(barsState({ bars: [1] })).toEqual({ ok: true });
  });
});

describe('strings used by the surfaces exist in both languages', () => {
  it('every t(\'key\') of the dialog and the panel is in he and en', () => {
    const dir = import.meta.dirname;
    const keys = new Set<string>();
    for (const f of ['TripMapDialog.tsx', 'TripMapPanel.tsx']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/\bt\('([A-Za-z.]+)'/g)) keys.add(m[1]!);
      for (const m of src.matchAll(/\bt\(([a-z]+)\.reason\)/g)) void m;
    }
    for (const k of ['barsNoMusic', 'barsNoBars', 'mode.road', 'mode.flight', 'mode.boat', 'look.paper', 'look.night', 'unseen', 'coastsOnly', 'roadStraight', 'agents', 'listSource']) keys.add(k);
    for (const lang of ['he', 'en'] as const) for (const k of keys) expect((dictionaries[lang] as Record<string, string>)[`tripMap.${k}`], `${lang} ${k}`).toBeTruthy();
  });
  it('Hebrew has no gendered address forms in the new lines', () => {
    for (const [k, v] of Object.entries(dictionaries.he)) if (k.startsWith('tripMap.')) expect(v, k).not.toMatch(/\b(לחץ|בחר|הקלד|הוסף)\b/);
  });
});
