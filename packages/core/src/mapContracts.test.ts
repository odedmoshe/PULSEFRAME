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
  it('are registered public, kept out of the assistant, and built (MAP_OPS_BUILT)', () => {
    for (const name of MAP_PUBLIC_OPS) {
      expect(getOp(name), name).toBeTruthy();
      expect(getOp(name)!.internal ?? false, name).toBe(false);
      expect(ASSISTANT_EXCLUDED_OPS as readonly string[]).toContain(name);
      expect(assistantOps()).not.toContain(name);
    }
    expect(MAP_OPS_BUILT).toBe(true);
  });
  it('every refusal row has a reason map_*, an existing code and a next step', () => {
    for (const [k, r] of Object.entries(MAP_REFUSALS)) {
      expect(r.reason, k).toMatch(/^map_[a-z_]+$/);
      expect(r.hint.length, k).toBeGreaterThan(10);
    }
  });
  const TLV = { name: 'תל אביב', lon: 34_768_066, lat: 32_081_937 }, JLM = { name: 'ירושלים', lon: 35_206_626, lat: 31_778_408 }, LDN = { name: 'לונדון', lon: -118_668, lat: 51_501_941 };
  const titleDoc = () => tx(createProject({ id: 'prj_map', name: 'M', width: 1280, height: 720 }), [{ op: 'add_text', args: { text: 'טיול', start: f(0), duration: f(30) } }]).doc;
  const add = (doc: ProjectDocument, args: Record<string, unknown>) => { const r = tx(doc, [{ op: 'add_trip_map', args: { start: f(30), duration: f(240), ...args } }]); return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string, trackId: r.results[0]!.output!.trackId as string }; };
  it('add_trip_map rounds every coordinate to 0.01°, spaces stops evenly (INTRO … duration − OUTRO, each rounded once), places like add_text; one undo restores the hash', () => {
    const doc = titleDoc();
    const r = add(doc, { stops: [TLV, { ...JLM, via: 'road' }, { ...LDN, via: 'flight' }] });
    const c = mapOf(r.doc, r.clipId);
    expect(c.drawn.stops.map((s) => [s.lon, s.lat])).toEqual([[34_770_000, 32_080_000], [35_210_000, 31_780_000], [-120_000, 51_500_000]]);
    expect(c.drawn.stops.map((s) => s.at)).toEqual(evenStopFrames(3, 240, R));
    expect(c.drawn.stops.map((s) => s.at)).toEqual([30, 113, 195]);
    expect(c.drawn).toMatchObject({ kind: 'map', v: 1, look: 'paper', camera: 'whole', timing: 'even' });
    expect(c.drawn.stops.map((s) => s.via)).toEqual([undefined, 'road', 'flight']);
    expect(new Set(c.drawn.stops.map((s) => s.id)).size).toBe(3);
    // placed like add_text: on the existing text track, which already holds the title
    const track = r.doc.sequences[r.doc.mainSequenceId]!.tracks.find((t) => t.id === r.trackId)!;
    expect(track.kind).toBe('text');
    expect(track.clips.map((x) => x.type)).toEqual(['text', 'drawn']);
    expect(T.eq(c.start, f(30)) && T.eq(c.duration, f(240))).toBe(true);
    expect(validateProject(r.doc)).toEqual([]);
    const back = structuredClone(r.doc);
    restoreEntities(back, diffEntities(doc, r.doc).map((x) => ({ id: x.id, state: x.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(doc));
    // given times are kept as given; look night
    const g = add(doc, { look: 'night', stops: [{ ...TLV, at: 0 }, { ...JLM, at: 40 }] });
    expect(mapOf(g.doc, g.clipId).drawn.stops.map((s) => s.at)).toEqual([0, 40]);
    expect(mapOf(g.doc, g.clipId).drawn.look).toBe('night');
  });
  it('each refusal is provoked through its op in MAP_REFUSALS order (13 stops, a 41-letter name, latitude 81°, two identical stops, legs under 1 s, mixed times, via on stop 0, a non-map clip)', () => {
    const doc = titleDoc();
    const why = (args: Record<string, unknown>) => refusal(() => add(doc, args));
    const many = Array.from({ length: 13 }, (_, i) => ({ name: `s${i}`, lon: i * 1_000_000, lat: 0 }));
    const cases: [string, OpError, keyof typeof MAP_REFUSALS, unknown[]][] = [
      ['13 stops', why({ stops: many }), 'stopCount', [13]],
      ['1 stop', why({ stops: [TLV] }), 'stopCount', [1]],
      ['via on stop 0', why({ stops: [{ ...TLV, via: 'flight' }, JLM] }), 'firstVia', []],
      ['41 letters', why({ stops: [TLV, { ...JLM, name: 'א'.repeat(41) }] }), 'stopName', [1]],
      ['empty shown name', why({ stops: [{ ...TLV, name: '  ' }, JLM] }), 'stopName', [0]],
      ['latitude 81°', why({ stops: [TLV, { ...JLM, lat: 81_000_000 }] }), 'stopPlace', [1]],
      ['longitude 181°', why({ stops: [TLV, { ...JLM, lon: 181_000_000 }] }), 'stopPlace', [1]],
      ['all hidden', why({ stops: [{ ...TLV, hidden: true }, { ...JLM, hidden: true }] }), 'noLabel', []],
      ['same ids', why({ stops: [{ ...TLV, id: 'a' }, { ...JLM, id: 'a' }] }), 'stopIds', []],
      ['two identical stops (after rounding)', why({ stops: [TLV, { ...TLV, lon: TLV.lon + 3_000, name: 'יפו' }] }), 'samePlace', [1]],
      ['mixed times', why({ stops: [{ ...TLV, at: 0 }, JLM] }), 'times', []],
      ['times not increasing', why({ stops: [{ ...TLV, at: 40 }, { ...JLM, at: 40 }] }), 'times', []],
      ['leg under 1 s (given)', why({ stops: [{ ...TLV, at: 0 }, { ...JLM, at: 29 }] }), 'tooShort', [1, 30]],
      ['leg under 1 s (even)', refusal(() => tx(doc, [{ op: 'add_trip_map', args: { start: f(30), duration: f(100), stops: [TLV, JLM] } }])), 'tooShort', [1, 30]],
    ];
    for (const [name, e, key, values] of cases) {
      expect(e.code, name).toBe(MAP_REFUSALS[key].code);
      expect(e.details.reason, name).toBe(MAP_REFUSALS[key].reason);
      expect(e.message, name).toBe((MAP_REFUSALS[key].message as (...a: unknown[]) => string)(...values));
      expect(e.hint, name).toBe(MAP_REFUSALS[key].hint);
    }
    // the first rule in the table order answers: 13 stops with via on stop 0 is a stop count
    expect(why({ stops: [{ ...many[0]!, via: 'road' }, ...many.slice(1)] }).details.reason).toBe('map_stop_count');
    // not a map: the title clip
    const titleId = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips)[0]!.id;
    for (const c of [{ op: 'update_trip_map', args: { clipId: titleId, look: 'night' } }, { op: 'time_trip_map', args: { clipId: titleId, to: 'even' } }]) {
      const e = refusal(() => tx(doc, [c]));
      expect([e.code, e.details.reason, e.message]).toEqual([MAP_REFUSALS.notMap.code, 'map_not_map', MAP_REFUSALS.notMap.message(titleId)]);
    }
  });
  it('update_trip_map without times retimes evenly and clears timedTo; with times keeps them; look only changes the look', () => {
    const { doc, clipId } = withMap(sampleMap({ timing: 'bars', timedTo: { assetId: 'ast_m', barsPerLeg: 1 } }));
    const look = tx(doc, [{ op: 'update_trip_map', args: { clipId, look: 'night' } }]).doc;
    expect(mapOf(look, clipId).drawn).toEqual({ ...mapOf(doc, clipId).drawn, look: 'night' });
    const even = mapOf(tx(doc, [{ op: 'update_trip_map', args: { clipId, stops: [TLV, JLM] } }]).doc, clipId).drawn;
    expect(even.stops.map((s) => s.at)).toEqual(evenStopFrames(2, 180, R));
    expect(even.timing).toBe('even');
    expect(even.timedTo).toBeUndefined();
    const given = mapOf(tx(doc, [{ op: 'update_trip_map', args: { clipId, stops: [{ ...TLV, at: 5 }, { ...JLM, at: 50 }] } }]).doc, clipId).drawn;
    expect(given.stops.map((s) => s.at)).toEqual([5, 50]);
    expect(given.timedTo).toEqual({ assetId: 'ast_m', barsPerLeg: 1 });
  });
  /** Music ast_m (60 s) on a sound track under the map, with bar starts every 2 s from 0.317 s (not on frames). */
  function withMusic(first = T.normalize(T.rt(317, 1000)), period = T.rt(2, 1), count = 30) {
    const { doc, clipId } = withMap();
    doc.assets.ast_m = { id: 'ast_m', kind: 'audio', name: 'loop.wav', contentHash: `sha256:${'1'.padStart(64, '0')}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture', importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' } } as ProjectDocument['assets'][string];
    const beats = Array.from({ length: count * 4 }, (_, k) => T.normalize(T.add(first, T.rt(BigInt(period.value) * BigInt(k), period.timescale * 4))));
    doc.analyses.ast_m = { assetId: 'ast_m', beats: { origin: { method: 'test grid', params: {}, createdAt: '2026-11-26T00:00:00Z', createdBy: 'test', edited: false }, bpm: 120, confidence: 0.9, beats, downbeats: beats.filter((_, k) => k % 4 === 0), meter: 4 } } as ProjectDocument['analyses'][string];
    return { doc: tx(doc, [{ op: 'add_clip', args: { assetId: 'ast_m', start: T.ZERO, withLinkedAudio: false } }]).doc, clipId };
  }
  it('time_trip_map bars: each at is the nearest frame to its bar start, |residual| ≤ half a frame (C3), with the clip\'s own sequence; map_no_music / map_no_bars / map_units_short', () => {
    const { doc, clipId } = withMusic();
    const r = tx(doc, [{ op: 'time_trip_map', args: { clipId, to: 'bars' } }]);
    const m = mapOf(r.doc, clipId).drawn;
    // the map is 1 s … 7 s: bars inside [1.5 s, 6.5 s] are 2.317, 4.317, 6.317 s → local 1.317 s = frame 39.51 → 40; then 100, 160
    expect(m.stops.map((s) => s.at)).toEqual([40, 100, 160]);
    expect(m.timing).toBe('bars');
    expect(m.timedTo).toEqual({ assetId: 'ast_m', barsPerLeg: 1 });
    for (const [i, s] of m.stops.entries()) {
      const bar = T.normalize(T.rt(2317 + 2000 * i, 1000));
      expect(T.nearestFrameIndex(T.sub(bar, f(30)), R)).toBe(s.at);
      expect(Math.abs(T.toSeconds(T.sub(T.add(f(30), f(s.at)), bar)))).toBeLessThanOrEqual(1 / 60);
    }
    expect(validateProject(r.doc)).toEqual([]);
    // back to even
    expect(mapOf(tx(r.doc, [{ op: 'time_trip_map', args: { clipId, to: 'even' } }]).doc, clipId).drawn).toMatchObject({ timing: 'even', stops: evenStopFrames(3, 180, R).map((at) => ({ at })) });
    // no music under the start of the map
    const none = withMap();
    expect(refusal(() => tx(none.doc, [{ op: 'time_trip_map', args: { clipId: none.clipId, to: 'bars' } }])).details.reason).toBe('map_no_music');
    // beats without bars
    const nb = withMusic();
    (nb.doc.analyses.ast_m!.beats as { downbeats?: unknown }).downbeats = [];
    expect(refusal(() => tx(nb.doc, [{ op: 'time_trip_map', args: { clipId: nb.clipId, to: 'bars' } }])).details.reason).toBe('map_no_bars');
    // bars every 4 s: inside [1.5 s, 6.5 s] only 4.317 s (0.317, 4.317, 8.317 …) → 1 of the 3 needed
    const sparse = withMusic(T.normalize(T.rt(317, 1000)), T.rt(4, 1));
    const e = refusal(() => tx(sparse.doc, [{ op: 'time_trip_map', args: { clipId: sparse.clipId, to: 'bars' } }]));
    expect([e.details.reason, e.details.need, e.details.have, e.message]).toEqual(['map_units_short', 3, 1, MAP_REFUSALS.unitsShort.message(3, 1)]);
    // bars every 0.4 s: one bar per leg is 12 frames, two are 24, both under a second → a typed tooShort, never a stored short leg
    const fast = withMusic(T.normalize(T.rt(317, 1000)), T.rt(2, 5));
    const short = refusal(() => tx(fast.doc, [{ op: 'time_trip_map', args: { clipId: fast.clipId, to: 'bars' } }]));
    expect([short.code, short.details.reason, short.message]).toEqual([MAP_REFUSALS.tooShort.code, 'map_too_short', MAP_REFUSALS.tooShort.message(2, 30)]);
  });
  it('time_trip_map bars reads the music of the clip\'s own sequence, not the main one (C3)', () => {
    // the music is in a second sequence beside the map; the main sequence (where the music clip is removed) has none
    const { doc } = withMusic();
    const music = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'media')!;
    const s = tx(doc, [{ op: 'add_sequence', args: { name: 'קצר' } }, { op: 'delete_clip', args: { clipId: music.id } }]);
    const seqId = s.results[0]!.output!.sequenceId as string;
    const placed = tx(s.doc, [
      { op: 'add_clip', args: { sequenceId: seqId, assetId: 'ast_m', start: T.ZERO, withLinkedAudio: false } },
      { op: 'add_trip_map', args: { sequenceId: seqId, start: f(30), duration: f(180), stops: [TLV, JLM, LDN] } },
    ]);
    const mapId = placed.results[1]!.output!.clipId as string;
    const r = tx(placed.doc, [{ op: 'time_trip_map', args: { clipId: mapId, to: 'bars' } }]);
    expect(mapOf2(r.doc, mapId).stops.map((x) => x.at)).toEqual([40, 100, 160]);
    // the same map in the main sequence finds no music there
    const main = tx(placed.doc, [{ op: 'add_trip_map', args: { start: f(30), duration: f(180), stops: [TLV, JLM] } }]);
    expect(refusal(() => tx(main.doc, [{ op: 'time_trip_map', args: { clipId: main.results[0]!.output!.clipId as string, to: 'bars' } }])).details.reason).toBe('map_no_music');
  });
  it('add_trip_map with timing equals add_trip_map then time_trip_map (same document, same refusals); one undo removes the clip; absent = unchanged', () => {
    const { doc } = withMusic();
    const args = { start: f(300), duration: f(180), stops: [TLV, { ...JLM, via: 'road' }, { ...LDN, via: 'flight' }] };
    // bars every 2 s from 0.317 s: under 10 s … 16 s the bars 12.317, 14.317 (and 16.317 > 15.5 s): 2 of 3 → refused alike
    for (const [start, timing] of [[f(30), 'bars'], [f(30), 'even'], [f(300), 'bars']] as const) {
      const a = { ...args, start };
      let two: ProjectDocument | OpError, one: ProjectDocument | OpError;
      // the two-op form in two commits (a commit cannot name the clip an earlier op of it creates), with the same id seed
      const first = applyTransaction(doc, [{ op: 'add_trip_map', args: a }], { idSeed: 'same_', actor: 'test' });
      const clipId = first.results[0]!.output!.clipId as string;
      try { two = applyTransaction(first.doc, [{ op: 'time_trip_map', args: { clipId, to: timing } }], { idSeed: 'later_', actor: 'test' }).doc; } catch (e) { two = e as OpError; }
      try { one = applyTransaction(doc, [{ op: 'add_trip_map', args: { ...a, timing } }], { idSeed: 'same_', actor: 'test' }).doc; } catch (e) { one = e as OpError; }
      if (two instanceof OpError || one instanceof OpError) {
        expect(one instanceof OpError && two instanceof OpError, `${timing} at ${start.value}`).toBe(true);
        expect([(one as OpError).code, (one as OpError).message, (one as OpError).details.reason]).toEqual([(two as OpError).code, (two as OpError).message, (two as OpError).details.reason]);
        continue;
      }
      expect(creativeProjection(one)).toBe(creativeProjection(two));
      expect(mapOf(one, clipId).drawn).toEqual(mapOf(two, clipId).drawn);
      const back = structuredClone(one);
      restoreEntities(back, diffEntities(doc, one).map((x) => ({ id: x.id, state: x.before })));
      expect(creativeProjection(back)).toBe(creativeProjection(doc));
      expect(back.sequences[back.mainSequenceId]!.tracks.flatMap((t) => t.clips).some((c) => c.id === clipId)).toBe(false);
    }
    // the bars case was really timed to bars (not refused) and the late one was refused with unitsShort
    const ok = applyTransaction(doc, [{ op: 'add_trip_map', args: { ...args, start: f(30), timing: 'bars' } }], { idSeed: 'b_', actor: 'test' });
    expect(mapOf(ok.doc, ok.results[0]!.output!.clipId as string).drawn).toMatchObject({ timing: 'bars', stops: [{ at: 40 }, { at: 100 }, { at: 160 }] });
    expect(refusal(() => applyTransaction(doc, [{ op: 'add_trip_map', args: { ...args, timing: 'bars' } }], { idSeed: 'c_', actor: 'test' })).details.reason).toBe('map_units_short');
    // absent: the same document as before the argument existed (no timing key → even, as given)
    const plain = applyTransaction(doc, [{ op: 'add_trip_map', args }], { idSeed: 'd_', actor: 'test' });
    expect(mapOf(plain.doc, plain.results[0]!.output!.clipId as string).drawn).toEqual({ kind: 'map', v: 1, look: 'paper', camera: 'whole', timing: 'even', stops: expect.any(Array) });
  });
  it('update_text, apply_text_preset, set_text_animation, set_text_fields, replace_text and set_variant_override text on a map clip answer drawn_not_text naming «מפת טיול»', () => {
    const { doc, clipId } = withMap();
    const calls: OpCall[] = [
      { op: 'update_text', args: { clipId, text: 'x' } },
      { op: 'apply_text_preset', args: { clipId, presetId: 'clean' } },
      { op: 'set_text_animation', args: { clipId, animation: { in: 'fade' } } },
      { op: 'set_text_fields', args: { clipId, enabled: true } },
      { op: 'replace_text', args: { edits: [{ at: { kind: 'title', clipId }, was: '', text: 'x' }] } },
    ];
    for (const c of calls) {
      const e = refusal(() => tx(doc, [c]));
      expect(e.code, c.op).toBe('drawn_not_text');
      expect(e.message, c.op).toMatch(/trip map/i);
    }
    const v = tx(doc, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }]);
    const variantId = v.results[0]!.output!.variantId as string;
    expect(refusal(() => tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId, text: 'x' } }])).code).toBe('drawn_not_text');
  });
});
const mapOf2 = (doc: ProjectDocument, id: string) => (Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === id) as DrawnClip & { drawn: MapPayload }).drawn;

describe('the pure functions are built (tripMap.test.ts holds their own tests)', () => {
  it('none throws MapNotBuiltError any more', () => {
    const m = sampleMap();
    const fns: (() => unknown)[] = [
      () => mercator(0, 0), () => unwrapLongitudes(m), () => evenStopFrames(3, 240, R), () => barStopFrames([], f(0), 240, 3, R), () => progressAt(m, 0),
      () => cameraAt(m, 0, { width: 1280, height: 720 }), () => legPath({ x: 0, y: 0 }, { x: 1, y: 1 }, 'flight'), () => placeLabels([], [], { width: 1280, height: 720 }), () => searchPlaces([], 'אילת'),
    ];
    for (const fn of fns) expect(fn).not.toThrow();
    expect(new MapNotBuiltError('x').code).toBe('map_not_built');
  });
});
