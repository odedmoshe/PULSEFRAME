/**
 * The trip map's pure functions (wave 8 tripmap W1; tripMap.ts): projection and unwrapping, even and bar timing (C3, C4, ADR-0003),
 * progress, the «כל המסלול» camera (C4, C5), flight paths, the label rule (a heuristic, plan §4.4) and the place search over the
 * committed list (read from the web file as text; nothing is added to it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  barStopFrames, cameraAt, evenStopFrames, inverseMercator, latOfMercY, legPath, MAP_FLIGHT_LIFT, MAP_PIXEL_GRID, MAP_PUSH_IN, mercator, mercY,
  MERC_Y_LIMIT, MIN_SPAN_LAT_DEG, pathPointAt, placeLabels, progressAt, searchPlaces, stopPoints, toScreen, unwrapLongitudes, wholeFit,
  type LabelInput, type MapPayload, type PlaceRow,
} from './index.ts';

const R30 = { num: 30, den: 1 }, NTSC = { num: 30000, den: 1001 }, R24 = { num: 24000, den: 1001 };
const map = (stops: [string, number, number, number][], over: Partial<MapPayload> = {}): MapPayload => ({
  kind: 'map', v: 1, look: 'paper', camera: 'whole', timing: 'even',
  stops: stops.map(([name, lonDeg, latDeg, at], i) => ({ id: `s${i}`, name, lon: Math.round(lonDeg * 100) * 10_000, lat: Math.round(latDeg * 100) * 10_000, at })),
  ...over,
});
const ISRAEL = map([['תל אביב', 34.77, 32.08, 30], ['ירושלים', 35.21, 31.78, 90], ['אילת', 34.95, 29.56, 150]]);
const latSpan = (c: { cy: number; spanY: number }) => latOfMercY(c.cy + c.spanY / 2) - latOfMercY(c.cy - c.spanY / 2);

describe('projection', () => {
  it('mercator is the outline data\'s: x = longitude, y = (180/π)·ln tan(π/4 + φ/2), clamped at ±80°; the inverse returns the micro-degrees', () => {
    expect(mercator(0, 0).x).toBe(0);
    expect(Math.abs(mercator(0, 0).y)).toBeLessThan(1e-13); // tan(π/4) is not exactly 1 in doubles; the outline data has the same value
    expect(mercator(34_770_000, 32_080_000).x).toBe(34.77);
    expect(mercator(0, 45_000_000).y).toBeCloseTo((180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + Math.PI / 8)), 12);
    expect(mercator(0, 89_000_000).y).toBe(mercY(80));
    expect(mercY(-85)).toBe(mercY(-80));
    expect(mercY(-80)).toBeCloseTo(-MERC_Y_LIMIT, 12);
    for (const [lon, lat] of [[34_770_000, 32_080_000], [-120_000, 51_500_000], [139_690_000, -35_000_000]] as const)
      expect(inverseMercator(mercator(lon, lat))).toEqual({ lonMicro: lon, latMicro: lat });
  });
  it('longitudes are unwrapped relative to stop 0, each within 180° of the previous (Tel Aviv → Los Angeles goes the shorter way)', () => {
    expect(unwrapLongitudes(map([['a', 34.77, 32, 0], ['b', -118.24, 34, 30]]))).toEqual([34.77, -118.24]); // 153° west: shorter than 207° east
    expect(unwrapLongitudes(map([['a', 139.69, 35, 0], ['b', -118.24, 34, 30], ['c', -0.12, 51, 60]]))).toEqual([139.69, 241.76, 359.88]);
    expect(unwrapLongitudes(map([['a', -170, 0, 0], ['b', 170, 0, 30]]))).toEqual([-170, -190]);
    const p = stopPoints(map([['a', 179, 0, 0], ['b', -179, 10, 30]]));
    expect(p[1]!.x).toBe(181);
  });
});

describe('timing', () => {
  it('even: stop 0 at INTRO, the last at D − OUTRO, each rounded once from its exact definition (ties up); never accumulated', () => {
    expect(evenStopFrames(3, 240, R30)).toEqual([30, 113, 195]); // 112.5 → 113
    expect(evenStopFrames(2, 240, R30)).toEqual([30, 195]);
    // 29.97: INTRO 29.97 → 30, last = 300 − 44.955 = 255.045 → 255
    expect(evenStopFrames(4, 300, NTSC)).toEqual([30, 105, 180, 255]);
    // against an exact reference with bigint rationals, many sizes and rates
    for (const rate of [R30, NTSC, R24, { num: 25, den: 1 }, { num: 60000, den: 1001 }]) for (const n of [2, 3, 7, 12]) for (const D of [600, 1234, 99_999]) {
      const num = BigInt(rate.num), den = BigInt(rate.den);
      const want = Array.from({ length: n }, (_, i) => {
        // t_i = I + i(D − I − O)/(n−1), I = num/den, O = 3num/(2den): over 2den(n−1)
        const a = 2n * num * BigInt(n - 1) + BigInt(i) * (2n * den * BigInt(D) - 5n * num), b = 2n * den * BigInt(n - 1);
        return Number((2n * a + b) / (2n * b));
      });
      expect(evenStopFrames(n, D, rate), `${rate.num}/${rate.den} n=${n} D=${D}`).toEqual(want);
    }
  });
  it('bars (C3): departure on the first bar ≥ start + 0.5 s, one bar per leg, each at the nearest frame, |residual| ≤ half a frame', () => {
    // bars every 2 s from 0.517 s on the timeline (not on frames); the clip starts at 1 s (frame 30) and lasts 10 s
    const bars = Array.from({ length: 8 }, (_, k) => T.normalize(T.rt(517 + 2000 * k, 1000)));
    const r = barStopFrames(bars, T.frameTime(30, R30), 300, 3, R30);
    if ('need' in r) throw new Error('short');
    expect(r.barsPerLeg).toBe(1);
    // first bar ≥ 1.5 s is 2.517 s → local 1.517 s = 45.51 frames → 46; then 3.517 → 106 (105.51), 5.517 → 166
    expect(r.at).toEqual([46, 106, 166]);
    for (const ms of r.residualMs) expect(Math.abs(ms)).toBeLessThanOrEqual(1000 / 30 / 2);
    expect(r.residualMs[0]).toBeCloseTo((46 / 30 - 1.517) * 1000, 3);
    // the last bar must be ≤ clip end − 0.5 s = 10.5 s: bars at 2.517 … 10.517 → 2.517, 4.517, 6.517, 8.517 inside: 4 bars
    expect(barStopFrames(bars, T.frameTime(30, R30), 300, 5, R30)).toEqual({ need: 5, have: 4 });
    // at 29.97 every at is still the nearest frame to its bar
    const n = barStopFrames(bars, T.ZERO, 600, 4, NTSC);
    if ('need' in n) throw new Error('short');
    n.at.forEach((a, i) => expect(a).toBe(T.nearestFrameIndex(bars[i]!, NTSC)));
  });
  it('bars: two bars per leg when one would leave a leg under a second; need counts the bars of two per leg', () => {
    const fast = Array.from({ length: 20 }, (_, k) => T.normalize(T.rt(600 + 700 * k, 1000))); // a bar every 0.7 s
    const r = barStopFrames(fast, T.ZERO, 600, 4, R30);
    if ('need' in r) throw new Error('short');
    expect(r.barsPerLeg).toBe(2);
    expect(r.at).toEqual([18, 60, 102, 144]); // 0.6, 2.0, 3.4, 4.8 s
    expect(barStopFrames(fast, T.ZERO, 120, 4, R30)).toEqual({ need: 7, have: 5 }); // bars 0.6 … 3.4 inside [0.5, 3.5]
    expect(barStopFrames([], T.ZERO, 300, 2, R30)).toEqual({ need: 2, have: 0 });
  });
  it('progressAt: waits at stop 0 before its at and at the last stop after; smoothstep inside a leg as a ratio of integers', () => {
    expect(progressAt(ISRAEL, -100)).toEqual({ leg: 0, s: 0 });
    expect(progressAt(ISRAEL, 29)).toEqual({ leg: 0, s: 0 });
    expect(progressAt(ISRAEL, 30)).toEqual({ leg: 1, s: 0 });
    expect(progressAt(ISRAEL, 60)).toEqual({ leg: 1, s: 0.5 });
    expect(progressAt(ISRAEL, 45)).toEqual({ leg: 1, s: (15 * 15 * (3 * 60 - 2 * 15)) / 60 ** 3 });
    expect(progressAt(ISRAEL, 90)).toEqual({ leg: 2, s: 0 });
    expect(progressAt(ISRAEL, 150)).toEqual({ leg: 2, s: 1 });
    expect(progressAt(ISRAEL, 10_000)).toEqual({ leg: 2, s: 1 });
    // a leg longer than the integer path: same value through BigInt
    const long = map([['a', 0, 0, 0], ['b', 1, 1, 1_000_000]]);
    expect(progressAt(long, 500_000).s).toBe(0.5);
  });
});

describe('the «כל המסלול» camera', () => {
  const size = { width: 1280, height: 720 };
  it('reads only localFrame and the stops: a shifted copy (trim, split: at − frames) gives the same camera at the same timeline time', () => {
    const shifted = { ...ISRAEL, stops: ISRAEL.stops.map((s) => ({ ...s, at: s.at - 17 })) };
    for (const f of [-50, 0, 30, 47, 90, 133, 150, 400]) expect(cameraAt(shifted, f - 17, size)).toEqual(cameraAt(ISRAEL, f, size));
  });
  it('constant before stop 0 and after the last; pushes in by MAP_PUSH_IN; the zoom rate stays far under MAX_ZOOM_RATE', () => {
    const a = cameraAt(ISRAEL, 0, size), b = cameraAt(ISRAEL, 30, size), c = cameraAt(ISRAEL, 150, size), d = cameraAt(ISRAEL, 999, size);
    expect(b).toEqual(a);
    expect(d).toEqual(c);
    expect(c.spanY / a.spanY).toBeCloseTo(MAP_PUSH_IN, 4);
    expect([c.cx, c.cy]).toEqual([a.cx, a.cy]);
    let worst = 0;
    for (let f = 30; f < 150; f++) worst = Math.max(worst, Math.abs(Math.log2(cameraAt(ISRAEL, f + 1, size).spanY / cameraAt(ISRAEL, f, size).spanY)) * 30);
    expect(worst).toBeLessThan(0.25); // log2 units per second; 1.5·log2(1/0.9)/4 s = 0.057 expected
  });
  it('every stop is inside the frame with the fit margin; the span never goes under 1.2° of latitude; 9:16 refits', () => {
    for (const s of [size, { width: 720, height: 1280 }]) for (const f of [0, 90, 150]) {
      const cam = cameraAt(ISRAEL, f, s);
      for (const p of stopPoints(ISRAEL)) {
        const q = toScreen(cam, s, p);
        expect(q.x).toBeGreaterThan(s.width * 0.18 - 1); expect(q.x).toBeLessThan(s.width * 0.82 + 1);
        expect(q.y).toBeGreaterThan(s.height * 0.18 - 1); expect(q.y).toBeLessThan(s.height * 0.82 + 1);
      }
    }
    // a wide route (Tel Aviv → London) needs a taller view in 9:16 than in 16:9 (in Mercator units)
    const wide = map([['תל אביב', 34.77, 32.08, 0], ['לונדון', -0.12, 51.5, 60]]);
    expect(cameraAt(wide, 0, { width: 720, height: 1280 }).spanY).toBeGreaterThan(cameraAt(wide, 0, size).spanY * 2);
    for (const p of stopPoints(wide)) { const q = toScreen(cameraAt(wide, 60, { width: 720, height: 1280 }), { width: 720, height: 1280 }, p); expect(q.x).toBeGreaterThan(0); expect(q.x).toBeLessThan(720); }
    const close = map([['a', 34.77, 32.08, 0], ['b', 34.78, 32.09, 30]]);
    for (const f of [0, 15, 30]) expect(latSpan(cameraAt(close, f, size))).toBeGreaterThanOrEqual(MIN_SPAN_LAT_DEG - 1e-9);
  });
  it('snapped to a power-of-two grid no coarser than 1/64 px; kept inside ±80°', () => {
    for (const f of [0, 77, 150]) {
      const cam = cameraAt(ISRAEL, f, size);
      const px = cameraAt(ISRAEL, 150, size).spanY / size.height, g = 2 ** Math.floor(Math.log2((wholeFit(ISRAEL, size).spanY * MAP_PUSH_IN) / (size.height * MAP_PIXEL_GRID)));
      expect(g).toBeLessThanOrEqual(px / 64 + 1e-15);
      for (const v of [cam.cx, cam.cy, cam.spanY]) expect(Number.isInteger(v / g)).toBe(true);
    }
    const world = map([['a', -170, 75, 0], ['b', 170, -70, 30], ['c', 0, 79, 60]]);
    const cam = cameraAt(world, 0, size);
    expect(cam.cy + cam.spanY / 2).toBeLessThanOrEqual(MERC_Y_LIMIT + 1e-9);
    expect(cam.cy - cam.spanY / 2).toBeGreaterThanOrEqual(-MERC_Y_LIMIT - 1e-9);
  });
});

describe('leg paths', () => {
  const tlv = mercator(34_770_000, 32_080_000), lon = mercator(-120_000, 51_500_000);
  it('road and boat are straight: the two ends', () => {
    expect([...legPath(tlv, lon, 'road')]).toEqual([tlv.x, tlv.y, lon.x, lon.y]);
    expect([...legPath(tlv, lon, 'boat')]).toEqual([tlv.x, tlv.y, lon.x, lon.y]);
  });
  it('flight: 65 samples on the great circle lifted 0.15·L·4s(1−s); the midpoint is on the lifted circle and not on the straight line', () => {
    const p = legPath(tlv, lon, 'flight');
    expect(p.length).toBe(130);
    expect([p[0], p[1], p[128], p[129]]).toEqual([tlv.x, tlv.y, lon.x, lon.y]);
    // the great-circle midpoint is the normalised sum of the two unit vectors
    const u = (q: { x: number; y: number }) => { const l = (q.x * Math.PI) / 180, f = (latOfMercY(q.y) * Math.PI) / 180; return [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)]; };
    const a = u(tlv), b = u(lon), m = a.map((v, i) => v + b[i]!);
    const midLat = (Math.atan2(m[2]!, Math.hypot(m[0]!, m[1]!)) * 180) / Math.PI, midLon = (Math.atan2(m[1]!, m[0]!) * 180) / Math.PI;
    const L = Math.hypot(lon.x - tlv.x, lon.y - tlv.y);
    expect(p[64]).toBeCloseTo(midLon, 5);
    expect(p[65]).toBeCloseTo(mercY(midLat) + MAP_FLIGHT_LIFT * L, 5);
    const straightMidY = (tlv.y + lon.y) / 2;
    expect(Math.abs(p[65]! - straightMidY)).toBeGreaterThan(0.1 * L);
  });
  it('flight across ±180° is unwrapped sample to sample (Tokyo → Los Angeles goes east past 180)', () => {
    const tokyo = mercator(139_690_000, 35_690_000), la = { x: 241.76, y: mercY(34.05) }; // unwrapped like stopPoints
    const p = legPath(tokyo, la, 'flight');
    for (let i = 2; i < p.length; i += 2) expect(Math.abs(p[i]! - p[i - 2]!)).toBeLessThan(10);
    expect(p[p.length - 2]).toBe(241.76);
    expect(Math.max(...p.filter((_, i) => i % 2 === 0))).toBeGreaterThan(180);
  });
  it('pathPointAt walks the path by arc length', () => {
    const p = Float64Array.of(0, 0, 3, 0, 3, 1);
    expect(pathPointAt(p, 0)).toEqual({ x: 0, y: 0 });
    expect(pathPointAt(p, 0.5)).toEqual({ x: 2, y: 0 });
    expect(pathPointAt(p, 0.875)).toEqual({ x: 3, y: 0.5 });
    expect(pathPointAt(p, 1)).toEqual({ x: 3, y: 1 });
  });
});

describe('labels (a heuristic: plan §4.4)', () => {
  const size = { width: 1280, height: 720 };
  /** Tel Aviv, Jaffa (about 4 km away) and Eilat in the whole-trip view; widths injected (a stand-in for measureText: 0.6 em per letter). */
  function fixture() {
    const m = map([['תל אביב', 34.78, 32.08, 0], ['יפו', 34.75, 32.05, 30], ['אילת', 34.95, 29.56, 60]]);
    const cam = cameraAt(m, 0, size);
    const dots = stopPoints(m).map((p) => toScreen(cam, size, p));
    const h = 0.04 * size.height;
    const labels: LabelInput[] = m.stops.map((s, i) => ({ stopId: s.id, x: dots[i]!.x, y: dots[i]!.y, width: 0.6 * h * [...s.name].length, height: h, rtl: true }));
    return { labels, dots };
  }
  const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  it('Tel Aviv / Jaffa: the later is hidden and reported; no two placed boxes overlap; all inside the 5 % inset; RTL goes left of the dot first', () => {
    const { labels, dots } = fixture();
    const out = placeLabels(labels, dots, size);
    expect(out.map((o) => o.stopId)).toEqual(['s0', 's1', 's2']);
    expect(out[1]).toEqual({ stopId: 's1', box: null, side: null });
    expect(out[0]!.side).toBe('end');
    expect(out[0]!.box!.x + out[0]!.box!.w).toBeLessThan(labels[0]!.x);
    const boxes = out.flatMap((o) => (o.box ? [o.box] : []));
    expect(boxes.length).toBe(2);
    for (const b of boxes) { expect(b.x).toBeGreaterThanOrEqual(64); expect(b.y).toBeGreaterThanOrEqual(36); expect(b.x + b.w).toBeLessThanOrEqual(1216); expect(b.y + b.h).toBeLessThanOrEqual(684); }
    expect(hit(boxes[0]!, boxes[1]!)).toBe(false);
    // the same inputs give the same answer (decided once and kept)
    expect(placeLabels(labels, dots, size)).toEqual(out);
  });
  it('an LTR label goes right of the dot first; a label that fits nowhere is hidden; a candidate crossing the chord to a neighbour is skipped', () => {
    const ltr = placeLabels([{ stopId: 'a', x: 400, y: 300, width: 100, height: 20, rtl: false }], [{ x: 400, y: 300 }], size)[0]!;
    expect(ltr.side).toBe('end'); expect(ltr.box!.x).toBeGreaterThan(400);
    expect(placeLabels([{ stopId: 'a', x: 640, y: 360, width: 1200, height: 20, rtl: false }], [{ x: 640, y: 360 }], size)[0]!.box).toBeNull();
    // the next stop lies straight to the right: the 'end' box would cross the leg, so the label goes left ('start')
    const crossed = placeLabels([{ stopId: 'a', x: 400, y: 300, width: 100, height: 20, rtl: false }], [{ x: 400, y: 300 }, { x: 700, y: 300 }], size)[0]!;
    expect(crossed.side).toBe('start');
  });
});

describe('the place search (the committed list; nothing added)', () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../../apps/web/src/editor/tripMap/places.data.ts'), 'utf8');
  const rows = JSON.parse(/const PLACES[^=]*= (\[.*\]);/.exec(src)![1]!) as PlaceRow[];
  it('«תל אביב» finds «תל אביב-יפו» by prefix; «ירושלים», «לונדון» and London are found; coordinates in micro-degrees', () => {
    expect(searchPlaces(rows, 'תל אביב')[0]).toMatchObject({ nameHe: 'תל אביב-יפו', lon: 34_770_000, lat: 32_080_000 });
    expect(searchPlaces(rows, 'ירושלים')[0]!.nameEn).toBe('Jerusalem');
    expect(searchPlaces(rows, 'לונדון')[0]).toMatchObject({ nameEn: 'London', lon: -120_000, lat: 51_500_000 });
    expect(searchPlaces(rows, 'LONDON')[0]!.nameHe).toBe('לונדון');
    expect(searchPlaces(rows, 'ירושלים')[0]!.placeId).toBe(rows.find((r) => r[2] === 'Jerusalem')![0]);
  });
  it('at most max (8) hits, prefix matches first; «אילת» and «פטרה» find nothing (not in the list); an empty query finds nothing', () => {
    const t = searchPlaces(rows, 'ת');
    expect(t.length).toBeLessThanOrEqual(8);
    expect(searchPlaces(rows, 'a', 3).length).toBe(3);
    expect(searchPlaces(rows, 'אילת')).toEqual([]);
    expect(searchPlaces(rows, 'פטרה')).toEqual([]);
    expect(searchPlaces(rows, '  ')).toEqual([]);
    // «אביב» starts a later word only: rank 1, after names that start with the query
    const tel = searchPlaces(rows, 'אביב');
    expect(tel.map((h) => h.nameHe)).toContain('תל אביב-יפו');
  });
});
