/**
 * The trip map painter (wave 8 tripmap W2): the format 1 reader against the reference decoder, the level rule, the cached paths
 * (cut edges never stroked: C2), the look table's flash rule through flashCells (C6), the painter's inputs (C4), the camera grid
 * (C5), the world copies at ±360° and the label cache (C10).
 *
 * The painter calls core's map functions (cameraAt, progressAt, legPath, placeLabels, mercator, unwrapLongitudes: W1). Where core
 * still answers map_not_built, a LABELLED TEST STAND-IN below answers instead (simple versions of the contract, never shipped);
 * once W1's bodies are in, the real ones run and the stand-ins are unused. There is no canvas in Node: the context and Path2D are
 * RECORDING STAND-INS that log the calls the painter makes (they show what is asked of the canvas, not what Chromium draws; the
 * pixels are checked by proof:tripmap on the pinned Chromium render page).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@pulseframe/core';
import { MAP_COAST_MAX_STEP, MAP_KIND_DEF, MAP_LOOK_COLOURS, MAP_LOOKS, type MapPayload, type MapStop } from '@pulseframe/core';
import { referenceDecode } from '../../../../tools/tripmap/referenceDecoder.ts';
import { drawnPainter, drawnUnready, loadOutlines, MAP_PAINTER_BUILT, paintMap, prepareDrawn, decodeGroup, mapLevelFor, type OutlineData } from '../index.ts';
import { FlashAnalyser, flashCells } from '../flashAnalysis.ts';
import { decodeQuanta, mercYOfLat, latOfMercY } from './outlines.ts';
import { buildGroupPaths, builtGroupPaths, coastRuns, type PathSink } from './pathCache.ts';
import { copiesFor, lastMapFrame, levelForView, MAP_NOT_BUILT_WHY } from './paintMap.ts';
import { clearLabelLayouts, setLabelFontCheckForTests } from './labels.ts';
import { clearRoutes, routePointAt } from './route.ts';

// ---------- TEST STAND-IN of core's map functions (used only while core answers map_not_built) ----------
const standIn = vi.hoisted(() => ({ used: new Set<string>(), forceNotBuilt: false }));
vi.mock('@pulseframe/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/core')>();
  const R2D = 180 / Math.PI;
  const mY = (lat: number) => R2D * Math.log(Math.tan(Math.PI / 4 + (Math.max(-80, Math.min(80, lat)) * Math.PI) / 360));
  const snap = (v: number) => Math.round(v * 64) / 64;
  const fallbacks: Record<string, (...a: any[]) => unknown> = {
    mercator: (lon: number, lat: number) => ({ x: lon / 1e6, y: mY(lat / 1e6) }),
    unwrapLongitudes: (m: MapPayload) => { const out: number[] = []; m.stops.forEach((s, i) => { let x = s.lon / 1e6; if (i) { while (x - out[i - 1]! > 180) x -= 360; while (x - out[i - 1]! < -180) x += 360; } out.push(x); }); return out; },
    progressAt: (m: MapPayload, f: number) => {
      const s = m.stops;
      if (f < s[0]!.at) return { leg: 0, s: 0 };
      for (let i = 1; i < s.length; i++) if (f < s[i]!.at) { const t = (f - s[i - 1]!.at) / (s[i]!.at - s[i - 1]!.at); return { leg: i, s: t * t * (3 - 2 * t) }; }
      return { leg: s.length - 1, s: 1 };
    },
    cameraAt: (m: MapPayload, f: number, size: { width: number; height: number }) => {
      const xs = (fallbacks.unwrapLongitudes!(m) as number[]), ys = m.stops.map((s) => mY(s.lat / 1e6));
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      const push = f <= m.stops[0]!.at ? 1 : f >= m.stops.at(-1)!.at ? 0.9 : 1 - 0.1 * ((f - m.stops[0]!.at) / (m.stops.at(-1)!.at - m.stops[0]!.at));
      const spanY = Math.max(1.5, Math.max(h, (w * size.height) / size.width) / 0.64) * push;
      const px = size.height / spanY;
      return { cx: snap(((Math.max(...xs) + Math.min(...xs)) / 2) * px) / px, cy: snap(((Math.max(...ys) + Math.min(...ys)) / 2) * px) / px, spanY };
    },
    legPath: (a: { x: number; y: number }, b: { x: number; y: number }, mode: string) => {
      if (mode !== 'flight') return Float64Array.of(a.x, a.y, b.x, b.y);
      const out = new Float64Array(130), L = Math.hypot(b.x - a.x, b.y - a.y);
      for (let k = 0; k <= 64; k++) { const s = k / 64; out[2 * k] = a.x + (b.x - a.x) * s; out[2 * k + 1] = a.y + (b.y - a.y) * s + 0.15 * L * 4 * s * (1 - s); }
      return out;
    },
    placeLabels: (labels: { stopId: string; x: number; y: number; width: number; height: number; rtl: boolean }[]) => {
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      return labels.map((l) => {
        const box = { x: l.rtl ? l.x - 12 - l.width : l.x + 12, y: l.y - l.height / 2, w: l.width, h: l.height };
        if (placed.some((p) => p.x < box.x + box.w && box.x < p.x + p.w && p.y < box.y + box.h && box.y < p.y + p.h)) return { stopId: l.stopId, box: null, side: null };
        placed.push(box);
        return { stopId: l.stopId, box, side: 'start' as const };
      });
    },
  };
  const wrapped: Record<string, unknown> = {};
  for (const [name, fb] of Object.entries(fallbacks)) {
    const fn = (real as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!;
    wrapped[name] = (...a: unknown[]) => {
      if (standIn.forceNotBuilt) throw new real.MapNotBuiltError(name);
      try { return fn(...a); } catch (e) { if (!(e instanceof real.MapNotBuiltError)) throw e; standIn.used.add(name); return fb(...a); }
    };
  }
  return { ...real, ...wrapped };
});

// ---------- RECORDING STAND-INS of Path2D and the 2D context ----------
class RecPath implements PathSink { ops: (string | number)[][] = []; moveTo(x: number, y: number) { this.ops.push(['M', x, y]); } lineTo(x: number, y: number) { this.ops.push(['L', x, y]); } closePath() { this.ops.push(['Z']); } }
function recordingCtx() {
  const log: unknown[][] = [];
  let measured = 0, depth = 0;
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_t, k: string) {
      if (k in target) return target[k];
      return (...a: unknown[]) => {
        if (k === 'save') depth++;
        if (k === 'restore') depth--;
        if (k === 'measureText') { measured++; return { width: String(a[0]).length * 10 }; }
        log.push([k, ...a.map((x) => (x instanceof RecPath ? 'path' : x))]);
        return undefined;
      };
    },
    set(_t, k: string, v) { target[k] = v; log.push([`=${k}`, v]); return true; },
  });
  return { ctx: ctx as never, log, measured: () => measured, depth: () => depth };
}

let data: OutlineData;
beforeAll(async () => {
  (globalThis as { Path2D?: unknown }).Path2D = RecPath;
  await prepareDrawn(['map']);
  data = await loadOutlines();
});
afterEach(() => { setLabelFontCheckForTests(null); standIn.forceNotBuilt = false; });

const R = { num: 30, den: 1 };
const stop = (id: string, name: string, lonDeg: number, latDeg: number, at: number, extra: Partial<MapStop> = {}): MapStop => ({ id, name, lon: Math.round(lonDeg * 100) * 10_000, lat: Math.round(latDeg * 100) * 10_000, at, ...extra });
const trip = (stops: MapStop[], look: 'paper' | 'night' = 'paper'): MapPayload => ({ kind: 'map', v: 1, stops, look, camera: 'whole', timing: 'even' });
const israel = trip([stop('a', 'תל אביב', 34.78, 32.08, 30), stop('b', 'ירושלים', 35.21, 31.77, 75), stop('c', 'אילת', 34.95, 29.56, 120)]);
const env = (localFrame: number, notes: [string, string][] = [], w = 1280, h = 720, clipFrames = 0) => ({ width: w, height: h, clipTime: { value: String(clipFrames), timescale: 30 }, localFrame, fps: R, note: (id: string, why: string) => notes.push([id, why]) });

describe('the map painter as registered', () => {
  it('is the registered painter of kind map, built; its ready hook loads format 1 data', () => {
    expect(MAP_PAINTER_BUILT).toBe(true);
    expect(drawnPainter('map')).toBe(paintMap);
    expect(drawnUnready('map')).toBeNull();
    expect(data.format).toBe(1);
    expect(data.levels.map((l) => l.id)).toEqual(['coarse', 'world', 'detail']);
  });
  it('a build whose core map functions are not built reports drawn.map with the reason and leaves the context as it was', () => {
    standIn.forceNotBuilt = true;
    const notes: [string, string][] = [];
    const rec = recordingCtx();
    paintMap(rec.ctx, israel, env(40, notes));
    expect(notes).toEqual([['drawn.map', MAP_NOT_BUILT_WHY]]);
    expect(rec.log.filter((l) => ['fill', 'stroke', 'fillRect', 'fillText'].includes(l[0] as string))).toEqual([]);
    expect(rec.depth()).toBe(0);
  });
  it('a payload that is not a map, or no Path2D, is reported, not drawn', () => {
    const notes: [string, string][] = [];
    paintMap(recordingCtx().ctx, { kind: 'map' }, env(0, notes));
    const P = (globalThis as { Path2D?: unknown }).Path2D;
    delete (globalThis as { Path2D?: unknown }).Path2D;
    try { paintMap(recordingCtx().ctx, israel, env(0, notes)); } finally { (globalThis as { Path2D?: unknown }).Path2D = P; }
    expect(notes.map((n) => n[0])).toEqual(['drawn.map', 'drawn.map']);
    expect(notes[1]![1]).toMatch(/Path2D/);
  });
});

describe('format 1 and the level rule', () => {
  it('decodeGroup agrees with the reference decoder of tools/tripmap on every committed group', () => {
    let groups = 0, vertices = 0;
    for (const lv of data.levels) for (const g of [...lv.land, ...lv.lakes]) {
      const ref = referenceDecode(g.data), got = decodeGroup(g, lv.q), q = decodeQuanta(g);
      expect(got.length).toBe(ref.length);
      got.forEach((r, i) => {
        expect([...q[i]!.xy]).toEqual(ref[i]!.xy);
        expect([...r.xy]).toEqual(ref[i]!.xy.map((v) => v * lv.q));
        expect([...r.cut].map(Boolean)).toEqual(ref[i]!.cut);
      });
      groups++; vertices += g.vertices;
    }
    expect(groups).toBe(147);
    expect(vertices).toBe(45059);
  });
  it('a truncated group, extra bytes or a cut run past the ring are refused', () => {
    const g = data.levels[0]!.land[0]!;
    const bytes = Buffer.from(g.data, 'base64');
    expect(() => decodeGroup({ ...g, data: bytes.subarray(0, bytes.length - 1).toString('base64') }, 0.05)).toThrow(RangeError);
    expect(() => decodeGroup({ ...g, data: Buffer.concat([bytes, Buffer.of(0)]).toString('base64') }, 0.05)).toThrow(RangeError);
    // one ring of 3 vertices, a cut run starting at edge 2 of length 2
    expect(() => decodeGroup({ bbox: [0, 0, 1, 1], rings: 1, vertices: 3, cutEdges: 2, data: Buffer.of(1, 3, 0, 0, 2, 0, 0, 2, 1, 2, 2).toString('base64') }, 1)).toThrow(/outside/);
  });
  it('mapLevelFor: coarse above 30°, world 8°–30°, detail only for a view wholly inside DETAIL_BOX under 8° (touching the edge draws world)', () => {
    const v = (lon0: number, lat0: number, lon1: number, lat1: number) => [lon0, mercYOfLat(lat0), lon1, mercYOfLat(lat1)] as const;
    expect(mapLevelFor(data, v(-20, 20, 60, 60), 40).id).toBe('coarse');
    expect(mapLevelFor(data, v(30, 28, 38, 36), 30).id).toBe('world');
    expect(mapLevelFor(data, v(33, 29, 37, 34), 8).id).toBe('world');
    expect(mapLevelFor(data, v(33, 29, 37, 34), 7.9).id).toBe('detail');
    expect(mapLevelFor(data, v(29, 29, 33, 33), 4).id).toBe('world'); // touches lon 29, the box edge
    expect(mapLevelFor(data, v(35, 33, 38, 36.6), 3.6).id).toBe('world'); // crosses lat 36.5
    expect(mapLevelFor(data, v(-5, 50, 2, 56), 6).id).toBe('world'); // outside the box altogether
    expect(levelForView(data, v(33 + 360, 29, 37 + 360, 34), 5).id).toBe('detail'); // an unwrapped view one turn east
    expect(latOfMercY(mercYOfLat(31.7))).toBeCloseTo(31.7, 10);
  });
});

describe('cached paths: cut edges are never stroked (C2)', () => {
  it('coastRuns: the runs between cut edges; none for an all-cut ring; null for a ring with no cut', () => {
    expect(coastRuns(Uint8Array.of(0, 0, 0, 0))).toBeNull();
    expect(coastRuns(Uint8Array.of(0, 1, 1, 0, 0))).toEqual([[3, 3]]); // edges 3, 4, 0
    expect(coastRuns(Uint8Array.of(1, 0, 1, 0))).toEqual([[1, 1], [3, 1]]);
    expect(coastRuns(Uint8Array.of(1, 1, 1))).toEqual([]);
  });
  it('a ring with a cut run: the fill path is the whole closed ring, the stroke path has no segment along the run', () => {
    // square 0,0 → 5,0 → 5,5 → 0,5 with edges 1 (5,0→5,5) and 2 (5,5→0,5) cut, as the reference test encodes it
    const g = { bbox: [0, 0, 5, 5] as [number, number, number, number], rings: 1, vertices: 4, cutEdges: 2, data: Buffer.of(1, 4, 0, 0, 10, 0, 0, 10, 9, 0, 1, 1, 2).toString('base64') };
    expect(referenceDecode(g.data)).toEqual([{ xy: [0, 0, 5, 0, 5, 5, 0, 5], cut: [false, true, true, false] }]);
    const made: RecPath[] = [];
    const p = buildGroupPaths(g, () => { const r = new RecPath(); made.push(r); return r; });
    expect(made[0]!.ops).toEqual([['M', 0, 0], ['L', 5, 0], ['L', 5, 5], ['L', 0, 5], ['Z']]);
    expect(made[1]!.ops).toEqual([['M', 0, 5], ['L', 0, 0], ['L', 5, 0]]);
    expect(p.coastEdges).toBe(2);
  });
  it('on every committed group the stroke path draws exactly the coast edges, and none of them is a cut edge', () => {
    for (const lv of data.levels) for (const g of [...lv.land, ...lv.lakes]) {
      const stroke = new RecPath();
      let n = 0;
      const p = buildGroupPaths(g, () => (n++ % 2 ? stroke : new RecPath()));
      expect(p.coastEdges).toBe(g.vertices - g.cutEdges);
      const cutSegs = new Set<string>();
      for (const r of decodeQuanta(g)) r.cut.forEach((c, e) => { if (!c) return; const m = r.cut.length, b = (e + 1) % m; cutSegs.add(`${r.xy[2 * e]},${r.xy[2 * e + 1]}>${r.xy[2 * b]},${r.xy[2 * b + 1]}`); });
      let last: (string | number)[] | null = null, segs = 0, start: (string | number)[] | null = null;
      for (const op of stroke.ops) {
        if (op[0] === 'M') { last = op; start = op; continue; }
        const to = op[0] === 'Z' ? start! : op;
        const key = `${last![1]},${last![2]}>${to[1]},${to[2]}`;
        if (cutSegs.has(key)) throw new Error(`stroke segment ${key} lies on a cut edge (${lv.id})`);
        segs++; last = to;
      }
      expect(segs).toBe(g.vertices - g.cutEdges);
    }
  });
});

describe('the look table against the analyser (C6)', () => {
  const lum = (hex: string) => { const W = 48, H = 48, px = new Uint8Array(W * H * 4); const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); for (let i = 0; i < W * H; i++) px.set([r!, g!, b!, 255], i * 4); const c = flashCells(px, W, H); return 0.2126 * c.rgb[0]! + 0.7152 * c.rgb[1]! + 0.0722 * c.rgb[2]!; };
  const frame = (hex: string, W = 240, H = 240) => { const px = new Uint8Array(W * H * 4); const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); for (let i = 0; i < W * H; i++) px.set([r!, g!, b!, 255], i * 4); return flashCells(px, W, H); };
  for (const look of MAP_LOOKS) {
    const c = MAP_LOOK_COLOURS[look];
    it(`${look}: sea, land and lake differ by less than 0.1 in cell luminance; a whole frame swapping between any two of them every frame makes no transition`, () => {
      const fills = [c.sea, c.land, c.lake], cells = fills.map((h) => frame(h, 72, 72));
      for (let i = 0; i < fills.length; i++) for (let j = i + 1; j < fills.length; j++) {
        expect(Math.abs(lum(fills[i]!) - lum(fills[j]!))).toBeLessThan(0.1);
        const an = new FlashAnalyser(30);
        for (let k = 0; k < 40; k++) an.push(k % 2 ? cells[i]! : cells[j]!);
        expect(an.report().verdict).toBe('pass');
        expect(an.report().areaPeak.general).toBe(0);
      }
    });
    it(`${look}: the coast step against the land is at most MAP_COAST_MAX_STEP (${MAP_COAST_MAX_STEP}); route, marker and label colours are not saturated red; the marker differs from the route`, () => {
      expect(Math.abs(lum(c.coast) - lum(c.land))).toBeLessThanOrEqual(MAP_COAST_MAX_STEP);
      for (const hex of [c.route, c.marker, c.label, c.labelOutline, c.coast]) {
        const f = frame(hex, 48, 48), [r, g, b] = [f.rgb[0]!, f.rgb[1]!, f.rgb[2]!];
        expect(r / (r + g + b)).toBeLessThan(0.8);
      }
      expect(c.marker.toLowerCase()).not.toBe(c.route.toLowerCase());
    });
  }
});

describe('the painter on a recording context', () => {
  it('reads only localFrame and the stops: the same picture after a trim-start or split shift at the same timeline time, whatever env.clipTime says (C4)', () => {
    setLabelFontCheckForTests(() => true);
    const a = recordingCtx(), b = recordingCtx(), c = recordingCtx();
    clearLabelLayouts();
    paintMap(a.ctx, israel, env(60));
    const shifted = MAP_KIND_DEF.shift!(israel, { delta: { value: '30', timescale: 30 }, frames: 30, rate: R }) as MapPayload;
    expect(shifted.stops.map((s) => s.at)).toEqual([0, 45, 90]);
    clearLabelLayouts();
    paintMap(b.ctx, shifted, env(30, [], 1280, 720, 999));
    clearLabelLayouts();
    paintMap(c.ctx, israel, env(60, [], 1280, 720, 12345));
    expect(a.log.length).toBeGreaterThan(20);
    expect(b.log).toEqual(a.log);
    expect(c.log).toEqual(a.log);
    expect(a.depth()).toBe(0);
  });
  it('one transform per level and world copy, on the 1/64-px grid; sea over the whole frame; land filled even-odd before lakes before coasts; lineWidth = px / scale', () => {
    setLabelFontCheckForTests(() => true);
    const rec = recordingCtx();
    paintMap(rec.ctx, israel, env(60));
    const info = lastMapFrame()!;
    const transforms = rec.log.filter((l) => l[0] === 'transform');
    expect(transforms.length).toBeGreaterThanOrEqual(2); // per world copy: land, lakes (when any is in view), coasts
    expect(transforms.length).toBeLessThanOrEqual(3 * info.copies.length);
    expect(new Set(transforms.map((t) => t[1])).size).toBe(1);
    for (const t of transforms) { expect(t[2]).toBe(0); expect(t[3]).toBe(0); expect(t[4]).toBe(-(t[1] as number)); expect(Number.isInteger((t[5] as number) * 64)).toBe(true); expect(Number.isInteger((t[6] as number) * 64)).toBe(true); }
    expect(rec.log.find((l) => l[0] === 'fillRect')).toEqual(['fillRect', -640, -360, 1280, 720]);
    const firstStroke = rec.log.findIndex((l) => l[0] === 'stroke');
    const fills = rec.log.slice(0, firstStroke).filter((l) => l[0] === 'fill');
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((l) => l[2] === 'evenodd')).toBe(true);
    const widthSet = rec.log.find((l) => l[0] === '=lineWidth')![1] as number;
    expect(widthSet * (transforms[0]![1] as number)).toBeCloseTo((2 / 1080) * 720, 9);
    expect(info.level).toMatch(/world|detail/);
  });
  it('the second frame of the same view builds no new path (paths cached per page); a different view culls groups by bbox', () => {
    setLabelFontCheckForTests(() => true);
    paintMap(recordingCtx().ctx, israel, env(50));
    const before = builtGroupPaths();
    paintMap(recordingCtx().ctx, israel, env(51));
    expect(builtGroupPaths()).toBe(before);
    const total = data.levels.find((l) => l.id === lastMapFrame()!.level)!;
    expect(lastMapFrame()!.groups).toBeLessThan(total.land.length + total.lakes.length);
  });
  it('the marker is at stop 0 before it leaves, on the leg at progress s, at the last stop after it arrives', () => {
    setLabelFontCheckForTests(() => true);
    paintMap(recordingCtx().ctx, israel, env(10));
    const m0 = lastMapFrame()!.marker;
    paintMap(recordingCtx().ctx, israel, env(30));
    expect(lastMapFrame()!.marker).toEqual(m0);
    paintMap(recordingCtx().ctx, israel, env(200));
    const end = lastMapFrame()!;
    paintMap(recordingCtx().ctx, israel, env(120));
    expect(lastMapFrame()!.marker).toEqual(end.marker);
    expect(routePointAt(Float64Array.of(0, 0, 10, 0, 10, 10), 0.75)).toEqual({ x: 10, y: 5 });
  });
  it('land is drawn again at ±360° where the view crosses ±180° (Tokyo → Los Angeles)', () => {
    setLabelFontCheckForTests(() => true);
    const pacific = trip([stop('t', 'Tokyo', 139.69, 35.69, 30), stop('l', 'Los Angeles', -118.24, 34.05, 120, { via: 'flight' })]);
    const rec = recordingCtx();
    paintMap(rec.ctx, pacific, env(60));
    const info = lastMapFrame()!;
    expect(info.copies).toEqual([0, 360]);
    expect(new Set(rec.log.filter((l) => l[0] === 'transform').map((l) => l[5])).size).toBe(2);
    expect(copiesFor([-200, 0, -170, 1])).toEqual([-360, 0]);
    expect(copiesFor([-10, 0, 10, 1])).toEqual([0]);
  });
  it('labels: nothing is measured before the font is ready (reported, no names drawn); then each name is measured once and the layout is kept', () => {
    clearLabelLayouts(); clearRoutes();
    const notes: [string, string][] = [];
    setLabelFontCheckForTests(() => false);
    const early = recordingCtx();
    paintMap(early.ctx, israel, env(130, notes));
    expect(early.measured()).toBe(0);
    expect(early.log.filter((l) => l[0] === 'fillText')).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]![1]).toMatch(/label font .*Heebo.* not loaded/);
    setLabelFontCheckForTests(() => true);
    const a = recordingCtx(), b = recordingCtx();
    paintMap(a.ctx, israel, env(130));
    const boxesA = lastMapFrame()!.labels;
    paintMap(b.ctx, israel, env(131));
    expect(a.measured()).toBe(3);
    expect(b.measured()).toBe(0);
    expect(a.log.filter((l) => l[0] === 'fillText').map((l) => l[1])).toEqual(['תל אביב', 'ירושלים', 'אילת']);
    // the same side on both frames: each box keeps its offset from its stop
    expect(lastMapFrame()!.labels.map((l) => l.box && [l.box.w, l.box.h])).toEqual(boxesA.map((l) => l.box && [l.box.w, l.box.h]));
  });
  it('a label that does not fit is not drawn; a hidden stop has no dot and no label; labels fade in from their stop\'s at, never from the clip', () => {
    setLabelFontCheckForTests(() => true);
    clearLabelLayouts();
    const close = trip([stop('a', 'תל אביב', 34.78, 32.08, 30), stop('j', 'יפו', 34.75, 32.05, 75), stop('h', '', 35.0, 31.0, 100, { hidden: true }), stop('c', 'אילת', 34.95, 29.56, 140)]);
    const rec = recordingCtx();
    paintMap(rec.ctx, close, env(200));
    const info = lastMapFrame()!;
    expect(info.labels.map((l) => l.stopId)).toEqual(['a', 'j', 'c']);
    const hidden = info.labels.filter((l) => l.box === null).map((l) => l.stopId);
    expect(rec.log.filter((l) => l[0] === 'fillText').map((l) => l[1])).toEqual(close.stops.filter((s) => !s.hidden && !hidden.includes(s.id)).map((s) => s.name));
    paintMap(recordingCtx().ctx, close, env(75));
    expect(lastMapFrame()!.labels.find((l) => l.stopId === 'j')!.alpha).toBe(0);
    paintMap(recordingCtx().ctx, close, env(81));
    expect(lastMapFrame()!.labels.find((l) => l.stopId === 'j')!.alpha).toBeCloseTo(0.5, 9);
  });
});

it('records which core functions ran as the labelled stand-in in this build', () => {
  // informational: empty once W1's bodies are in
  expect([...standIn.used].every((n) => ['mercator', 'unwrapLongitudes', 'progressAt', 'cameraAt', 'legPath', 'placeLabels'].includes(n))).toBe(true);
  void core;
});
