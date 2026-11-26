// The committed trip map data (tools/tripmap/build-data.mjs output; wave 8 tripmap pre-pass). No network and no download: the inputs
// were fetched once and deleted; their SHA-256 are pinned in the script. Checks: the size ceiling (200 000 bytes for both files
// together), the SHA-256 of each committed file (regenerate with the script, never by hand: then update the digests here and in
// THIRD_PARTY_LICENSES.md §8), the shape of format 1 through a REFERENCE decoder written here (W2's engine reader must agree with
// it), the C2 rules (cut edges, ±80° clip, the detail box), and the place list's rule, quantum and size.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipRing, DETAIL_BOX, encodeGroup, INPUTS, MAX_LAT, mercY, OUT, PLACE_MAX_SCALERANK, ringFromCoords, simplifyRing, SOURCE, buildPlaces } from './build-data.mjs';
import OUTLINES from '../../packages/engine/src/map/outlines.data.ts';
import PLACES from '../../apps/web/src/editor/tripMap/places.data.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = (rel: string) => fs.readFileSync(path.join(repo, rel));
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
/** The committed digests (also in THIRD_PARTY_LICENSES.md §8). */
export const COMMITTED = {
  outlines: { sha256: 'c90df74f225e7f9205f77052763bf7d6693347ee638655b2382c3f4641c64475', bytes: 146370 },
  places: { sha256: '866edd5bebcfca5e0261987b690935c145c3932351b0bc64fe14c5a6a775142f', bytes: 30464 },
};
export const DATA_CEILING = 200_000;

/** REFERENCE decoder of format 1 (test-only; the engine's decodeGroup is W2's and must agree). */
function decode(b64: string) {
  const b = Buffer.from(b64, 'base64');
  let i = 0;
  const v = () => { let x = 0, m = 1, c; do { c = b[i++]!; x += (c & 127) * m; m *= 128; } while (c & 128); return x; };
  const z = () => { const u = v(); return u % 2 ? -(u + 1) / 2 : u / 2; };
  const rings: { xy: number[]; cut: boolean[] }[] = [];
  const count = v();
  for (let r = 0; r < count; r++) {
    const n = v(); const xy = [z(), z()];
    for (let k = 1; k < n; k++) { const px = xy[xy.length - 2]!, py = xy[xy.length - 1]!; xy.push(px + z(), py + z()); }
    const cut = new Array<boolean>(n).fill(false);
    const runs = v(); let end = 0;
    for (let k = 0; k < runs; k++) { const s = end + v(), len = v(); for (let e = s; e < s + len; e++) { expect(e).toBeLessThan(n); cut[e] = true; } end = s + len; }
    rings.push({ xy, cut });
  }
  expect(i).toBe(b.length);
  return rings;
}

describe('the committed outline and place data', () => {
  it('stays under the ceiling and matches its pinned SHA-256', () => {
    const o = file(OUT.outlines), p = file(OUT.places);
    expect(o.length + p.length).toBeLessThanOrEqual(DATA_CEILING);
    expect({ sha256: sha(o), bytes: o.length }).toEqual(COMMITTED.outlines);
    expect({ sha256: sha(p), bytes: p.length }).toEqual(COMMITTED.places);
    expect(String(o)).toContain(SOURCE.commit);
    for (const spec of Object.values(INPUTS)) expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('format 1 decodes; bboxes, counts and quanta agree; nothing lies beyond ±80°; the detail level stays inside its box', () => {
    expect(OUTLINES.format).toBe(1);
    expect(OUTLINES.levels.map((l) => l.id)).toEqual(['coarse', 'world', 'detail']);
    const yMax = mercY(MAX_LAT);
    for (const lv of OUTLINES.levels) for (const layer of [lv.land, lv.lakes]) for (const g of layer) {
      const rings = decode(g.data);
      expect(rings.length).toBe(g.rings);
      expect(rings.reduce((s, r) => s + r.xy.length / 2, 0)).toBe(g.vertices);
      expect(rings.reduce((s, r) => s + r.cut.filter(Boolean).length, 0)).toBe(g.cutEdges);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of rings) {
        expect(r.xy.length / 2).toBeGreaterThanOrEqual(3);
        for (let k = 0; k < r.xy.length; k += 2) { x0 = Math.min(x0, r.xy[k]!); x1 = Math.max(x1, r.xy[k]!); y0 = Math.min(y0, r.xy[k + 1]!); y1 = Math.max(y1, r.xy[k + 1]!); }
      }
      expect(g.bbox).toEqual([x0, y0, x1, y1]);
      expect(Math.abs(y0 * lv.q)).toBeLessThanOrEqual(yMax + lv.q);
      expect(Math.abs(y1 * lv.q)).toBeLessThanOrEqual(yMax + lv.q);
      if (lv.id === 'detail') {
        expect(x0 * lv.q).toBeGreaterThanOrEqual(DETAIL_BOX.lonMin - lv.q);
        expect(x1 * lv.q).toBeLessThanOrEqual(DETAIL_BOX.lonMax + lv.q);
        expect(y0 * lv.q).toBeGreaterThanOrEqual(mercY(DETAIL_BOX.latMin) - lv.q);
        expect(y1 * lv.q).toBeLessThanOrEqual(mercY(DETAIL_BOX.latMax) + lv.q);
      }
    }
  });
  it('the detail lakes hold the Dead Sea and the Kinneret; the world land is cut at ±80° (cut edges exist, all on a clip line or ±180°)', () => {
    const detail = OUTLINES.levels.find((l) => l.id === 'detail')!;
    const inside = (lon: number, lat: number) => detail.lakes.some((g) => decode(g.data).some((r) => {
      // even-odd point in polygon, in quanta
      const px = lon / detail.q, py = mercY(lat) / detail.q; let c = false;
      for (let a = 0, b = r.xy.length / 2 - 1; a < r.xy.length / 2; b = a++) { const ax = r.xy[2 * a]!, ay = r.xy[2 * a + 1]!, bx = r.xy[2 * b]!, by = r.xy[2 * b + 1]!; if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) c = !c; }
      return c;
    }));
    expect(inside(35.5, 31.5)).toBe(true); // Dead Sea
    expect(inside(35.58, 32.83)).toBe(true); // Kinneret
    expect(inside(34.78, 32.08)).toBe(false); // Tel Aviv
    const world = OUTLINES.levels.find((l) => l.id === 'world')!;
    const yClip = Math.round(mercY(MAX_LAT) / world.q);
    let cuts = 0;
    for (const g of world.land) for (const r of decode(g.data)) r.cut.forEach((c, e) => {
      if (!c) return;
      cuts++;
      const n = r.xy.length / 2, a = e, b = (e + 1) % n;
      const ax = r.xy[2 * a]!, ay = r.xy[2 * a + 1]!, bx = r.xy[2 * b]!, by = r.xy[2 * b + 1]!;
      const onClip = (Math.abs(Math.abs(ay) - yClip) <= 1 && Math.abs(Math.abs(by) - yClip) <= 1) || (Math.abs(Math.abs(ax) - 18000) <= 1 && Math.abs(Math.abs(bx) - 18000) <= 1);
      expect(onClip, `cut edge ${ax},${ay} → ${bx},${by}`).toBe(true);
    });
    expect(cuts).toBeGreaterThan(0);
  });
  it('the place list: [NE_ID, he, en, lon, lat] at 0.01°, sorted by id, unique; the asked-for places as they are spelled (אילת and פטרה are absent)', () => {
    expect(PLACES.length).toBe(588);
    const ids = PLACES.map((r) => r[0]);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of PLACES) { expect(Number.isInteger(r[3]) && Math.abs(r[3]) <= 18000).toBe(true); expect(Number.isInteger(r[4]) && Math.abs(r[4]) <= 8000).toBe(true); }
    const he = (name: string) => PLACES.filter((r) => r[1] === name).map((r) => r[2]);
    expect(he('ירושלים')).toEqual(['Jerusalem']);
    expect(he('תל אביב-יפו')).toEqual(['Tel Aviv']); // the list's spelling; the owner's «תל אביב» is kept as typed
    expect(he('חיפה')).toEqual(['Haifa']);
    expect(he('לרנקה')).toEqual(['Larnaca']);
    expect(he('פריז')).toEqual(['Paris']);
    expect(he('לונדון')).toEqual(['London']);
    expect(he('ניו יורק')).toEqual(['New York City']);
    expect(PLACES.filter((r) => r[1].includes('אילת') || r[1].includes('פטרה') || r[2] === 'Eilat' || r[2] === 'Petra')).toEqual([]);
    expect(String(file(OUT.places))).toContain(`SCALERANK <= ${PLACE_MAX_SCALERANK}`);
    expect(String(file(OUT.places))).not.toMatch(/capital|FEATURECLA|ADM0CAP|FCLASS/i);
  });
});

describe('the build rules on synthetic rings (C2)', () => {
  it('a ring crossing 80° N is clipped there and only the new edge is cut; simplification keeps cut edges cut', () => {
    const r = clipRing(ringFromCoords([[0, 70], [10, 70], [10, 85], [0, 85], [0, 70]]), { latMin: -MAX_LAT, latMax: MAX_LAT });
    expect(r.pts.map(([x, y]) => [x, y])).toEqual([[0, 70], [10, 70], [10, 80], [0, 80]]);
    expect(r.cut).toEqual([false, false, true, false]);
    expect(simplifyRing(r, 0.01)!.cut).toEqual([false, false, true, false]);
  });
  it('antimeridian edges of the source are cut; a box crop marks every crop edge cut', () => {
    expect(ringFromCoords([[170, 60], [180, 60], [180, 65], [170, 65], [170, 60]]).cut).toEqual([false, true, false, false]);
    const c = clipRing(ringFromCoords([[28, 30], [31, 30], [31, 32], [28, 32], [28, 30]]), DETAIL_BOX);
    expect(c.pts).toEqual([[29, 30], [31, 30], [31, 32], [29, 32]]);
    expect(c.cut).toEqual([false, false, false, true]);
  });
  it('the encoder writes the cut runs the reference decoder reads', () => {
    const rings = decode(encodeGroup([{ q: [[0, 0], [5, 0], [5, 5], [0, 5]], cut: [false, true, true, false] }]).toString('base64'));
    expect(rings).toEqual([{ xy: [0, 0, 5, 0, 5, 5, 0, 5], cut: [false, true, true, false] }]);
  });
  it('places are chosen by the box and SCALERANK only, at 0.01°', () => {
    const pt = (props: Record<string, unknown>, lon: number, lat: number) => ({ properties: { NE_ID: 1, NAME_HE: 'א', NAME_EN: 'A', ...props }, geometry: { type: 'Point', coordinates: [lon, lat] } });
    const rows = buildPlaces({ features: [pt({ NE_ID: 3, SCALERANK: 9 }, 34.95, 29.556), pt({ NE_ID: 2, SCALERANK: 9, ADM0CAP: 1, FEATURECLA: 'Admin-0 capital' }, 2, 48), pt({ NE_ID: 1, SCALERANK: 3 }, -73.995718, 40.721562)] });
    expect(rows).toEqual([[1, 'א', 'A', -7400, 4072], [3, 'א', 'A', 3495, 2956]]); // the capital-class row outside the box is not chosen
  });
});
