/**
 * The trip map's contract (wave 8 tripmap pre-pass; mapContract.ts, mapOps.ts, tripMap.ts): the drawn kind `map` is registered with a
 * strict payload at 0.01°, no box (whole frame), its validate rules, its shift on split and trim-start, its agent summary; the three ops
 * are registered public, kept out of the assistant, and refuse notBuilt until W1 sets MAP_OPS_BUILT; every pure function is a typed stub.
 * Map clips are put in the document by hand here (the ops refuse until built), exactly as an archive could bring one in.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, ASSISTANT_EXCLUDED_OPS, assistantOps, createProject, creativeProjection, diffEntities, drawnBox, drawnKind, drawnSummary, getOp,
  MAP_KIND, MAP_LOOK_COLOURS, MAP_LOOKS, MAP_OPS_BUILT, MAP_PUBLIC_OPS, MAP_REFUSALS, MapNotBuiltError, OpError, ProjectSchema, quantiseMicro,
  restoreEntities, validateProject, barStopFrames, cameraAt, evenStopFrames, legPath, mercator, placeLabels, progressAt, searchPlaces, unwrapLongitudes,
  type DrawnClip, type MapPayload, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `map${n++}_`, actor: 'test' });
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };

const sampleMap = (over: Partial<MapPayload> = {}): MapPayload => ({
  kind: 'map', v: 1, look: 'paper', camera: 'whole', timing: 'even',
  stops: [
    { id: 's1', name: 'תל אביב', lon: 34_770_000, lat: 32_080_000, at: 30 },
    { id: 's2', name: 'ירושלים', lon: 35_210_000, lat: 31_780_000, at: 90, via: 'road' },
    { id: 's3', name: 'לונדון', lon: -120_000, lat: 51_500_000, at: 150, via: 'flight' },
  ],
  ...over,
});
/** A title at 0…30 (it makes the text track), and a map clip put in by hand at 30…210 on the same track. */
function withMap(drawn: MapPayload = sampleMap()) {
  const r = tx(createProject({ id: 'prj_map', name: 'M', width: 1280, height: 720 }), [{ op: 'add_text', args: { text: 'טיול', start: f(0), duration: f(30) } }]);
  const doc = structuredClone(r.doc);
  const track = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'text')!;
  const clip: DrawnClip = { id: 'clp_map', type: 'drawn', start: f(30), duration: f(180), transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, drawn: drawn };
  track.clips.push(clip);
  return { doc, clipId: clip.id };
}
const mapOf = (doc: ProjectDocument, id: string) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as DrawnClip & { drawn: MapPayload };

describe('the drawn kind map', () => {
  it('is registered on import with its names, no box (the whole frame), and a strict payload at 0.01°', () => {
    const def = drawnKind(MAP_KIND)!;
    expect(def.name).toEqual({ he: 'מפת טיול', en: 'Trip map' });
    expect(drawnBox(sampleMap())).toBeNull();
    const { doc } = withMap();
    expect(ProjectSchema.safeParse(doc).success).toBe(true);
    expect(validateProject(doc)).toEqual([]);
    for (const bad of [{ lon: 34_771_000 }, { lat: 80_010_000 }, { lat: 1.5 }]) {
      const m = sampleMap(); Object.assign(m.stops[0]!, bad);
      expect(ProjectSchema.safeParse(withMap(m).doc).success, JSON.stringify(bad)).toBe(false);
    }
    expect(ProjectSchema.safeParse(withMap({ ...sampleMap(), look: 'chalk' as never }).doc).success).toBe(false); // cut look
    expect(ProjectSchema.safeParse(withMap({ ...sampleMap(), camera: 'follow' as never }).doc).success).toBe(false); // cut camera
    expect(ProjectSchema.safeParse(withMap({ ...sampleMap(), stops: sampleMap().stops.slice(0, 1) }).doc).success).toBe(false);
  });
  it('validate: names, a label, unique ids, increasing times with one-second legs, no two stops in a row at one place', () => {
    const issues = (m: MapPayload) => validateProject(withMap(m).doc).map((i) => i.code);
    const s = sampleMap().stops;
    expect(issues(sampleMap({ stops: [{ ...s[0]!, name: ' ' }, s[1]!] }))).toEqual(['map_stop_name']);
    expect(issues(sampleMap({ stops: [{ ...s[0]!, name: '', hidden: true }, s[1]!] }))).toEqual([]);
    expect(issues(sampleMap({ stops: s.map((x) => ({ ...x, hidden: true as const })) }))).toEqual(['map_no_label']);
    expect(issues(sampleMap({ stops: [s[0]!, { ...s[1]!, id: 's1' }] }))).toEqual(['map_stop_ids']);
    expect(issues(sampleMap({ stops: [s[0]!, { ...s[1]!, at: 30 }] }))).toEqual(['map_times']);
    expect(issues(sampleMap({ stops: [s[0]!, { ...s[1]!, at: 59 }] }))).toEqual(['map_too_short']); // 29 frames < 30
    expect(issues(sampleMap({ stops: [s[0]!, { ...s[1]!, lon: s[0]!.lon, lat: s[0]!.lat }] }))).toEqual(['map_same_place']);
  });
  it('split and trim-start move every stop by the frames the start moved (at − frames); left halves and end trims keep them; undo is exact', () => {
    const { doc, clipId } = withMap();
    const at = (d: ProjectDocument, id: string) => mapOf(d, id).drawn.stops.map((s) => s.at);
    const split = tx(doc, [{ op: 'split_clip', args: { clipId, at: f(100) } }]);
    expect(validateProject(split.doc)).toEqual([]);
    const right = split.doc.sequences[split.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'drawn' && c.id !== clipId)!;
    expect(at(split.doc, clipId)).toEqual([30, 90, 150]);
    expect(at(split.doc, right.id)).toEqual([-40, 20, 80]);
    expect(at(tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(45) } }]).doc, clipId)).toEqual([15, 75, 135]);
    expect(at(tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(120) } }]).doc, clipId)).toEqual([30, 90, 150]);
    const back = structuredClone(split.doc);
    restoreEntities(back, diffEntities(doc, split.doc).map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(doc));
  });
  it('agents see the stop count, travel modes, shown names, look and timing; never coordinates in the summary', () => {
    expect(drawnSummary(sampleMap())).toEqual({ kind: 'map', name: { he: 'מפת טיול', en: 'Trip map' }, stops: 3, modes: ['road', 'flight'], names: ['תל אביב', 'ירושלים', 'לונדון'], look: 'paper', timing: 'even' });
  });
  it('every writer stores 0.01°: quantiseMicro rounds degrees to multiples of 10 000 micro-degrees', () => {
    expect(quantiseMicro(34.7681)).toBe(34_770_000);
    expect(quantiseMicro(-0.118668)).toBe(-120_000);
    expect(quantiseMicro(29.554) % 10_000).toBe(0);
  });
  it('the look table has exactly the two version-1 looks; no route, marker or label colour is saturated red', () => {
    expect(Object.keys(MAP_LOOK_COLOURS).sort()).toEqual([...MAP_LOOKS].sort());
    for (const look of MAP_LOOKS) for (const k of ['route', 'marker', 'label'] as const) {
      const h = MAP_LOOK_COLOURS[look][k]; const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      expect(r! / (r! + g! + b! || 1), `${look}.${k}`).toBeLessThan(0.8);
    }
  });
});

describe('the three ops', () => {
  it('are registered public, kept out of the assistant, and refuse notBuilt until W1 sets MAP_OPS_BUILT', () => {
    for (const name of MAP_PUBLIC_OPS) {
      expect(getOp(name), name).toBeTruthy();
      expect(getOp(name)!.internal ?? false, name).toBe(false);
      expect(ASSISTANT_EXCLUDED_OPS as readonly string[]).toContain(name);
      expect(assistantOps()).not.toContain(name);
    }
    if (MAP_OPS_BUILT) return;
    const { doc, clipId } = withMap();
    const calls: OpCall[] = [
      { op: 'add_trip_map', args: { start: f(0), duration: f(240), stops: [{ name: 'תל אביב', lon: 34_770_000, lat: 32_080_000 }, { name: 'אילת', lon: 34_950_000, lat: 29_560_000 }] } },
      { op: 'update_trip_map', args: { clipId, look: 'night' } },
      { op: 'time_trip_map', args: { clipId, to: 'even' } },
    ];
    for (const c of calls) {
      const e = refusal(() => tx(doc, [c]));
      expect(e.code, c.op).toBe(MAP_REFUSALS.notBuilt.code);
      expect(e.details.reason).toBe('map_not_built');
      expect(e.message).toBe(MAP_REFUSALS.notBuilt.message(c.op));
    }
  });
  it('every refusal row has a reason map_*, an existing code and a next step', () => {
    for (const [k, r] of Object.entries(MAP_REFUSALS)) {
      expect(r.reason, k).toMatch(/^map_[a-z_]+$/);
      expect(r.hint.length, k).toBeGreaterThan(10);
    }
  });
  it.todo('W1: add_trip_map rounds every coordinate to 0.01°, spaces stops evenly (INTRO … duration − OUTRO, each rounded once), places like add_text; one undo restores the hash');
  it.todo('W1: each refusal is provoked through its op in MAP_REFUSALS order (13 stops, a 41-letter name, latitude 81°, two identical stops, legs under 1 s, mixed times, via on stop 0, a non-map clip)');
  it.todo('W1: update_trip_map without times retimes evenly and clears timedTo; with times keeps them; look only changes the look');
  it.todo('W1: time_trip_map bars — each at is the nearest frame to its bar start, |residual| ≤ half a frame (C3); musicAt with the clip\'s own sequence; map_no_music / map_no_bars / map_units_short');
  it.todo('W1: update_text, apply_text_preset, set_text_animation, set_text_fields, replace_text and set_variant_override text on a map clip answer drawn_not_text naming «מפת טיול»');
});

describe('the pure functions are typed stubs until W1 builds them', () => {
  it('each throws MapNotBuiltError (code map_not_built)', () => {
    const m = sampleMap();
    const fns: (() => unknown)[] = [
      () => mercator(0, 0), () => unwrapLongitudes(m), () => evenStopFrames(3, 240, R), () => barStopFrames([], f(0), 240, 3, R), () => progressAt(m, 0),
      () => cameraAt(m, 0, { width: 1280, height: 720 }), () => legPath({ x: 0, y: 0 }, { x: 1, y: 1 }, 'flight'), () => placeLabels([], [], { width: 1280, height: 720 }), () => searchPlaces([], 'אילת'),
    ];
    for (const fn of fns) expect(fn).toThrow(MapNotBuiltError);
  });
  it.todo('W1: mercator and its inverse; longitudes unwrapped relative to stop 0 (Tel Aviv → Los Angeles goes east or west by the shorter way)');
  it.todo('W1: cameraAt depends only on localFrame and the stops (trim and split give the same camera at the same timeline time); snapped to 1/64 px; span ≥ 1.2°; a 9:16 size refits');
  it.todo('W1: progressAt — the marker waits at stop 0 before its at and at the last stop after it; s is a ratio of integers');
  it.todo('W1: legPath — flight midpoint on the lifted great circle, not on the straight line; unwrapped sample to sample');
  it.todo('W1: placeLabels — Tel Aviv / Jaffa (4 km): the later is hidden and reported; no two placed boxes overlap; all inside the 5 % inset');
  it.todo('W1: searchPlaces — «תל אביב» finds «תל אביב-יפו» (prefix), «ירושלים», «לונדון» (UK first by list order), at most 8; «אילת» finds nothing (not in the list)');
});
