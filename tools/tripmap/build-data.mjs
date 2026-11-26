// Trip map data builder (wave 8, «מפת טיול»). One self-contained file for Node >= 22, built-in modules only, no network.
//   node tools/tripmap/build-data.mjs --src <dir with the six downloaded files> [--check]
// Reads Natural Earth v5.1.2 as DATA (JSON.parse only; nothing from the download directory is executed or imported),
// refuses any input whose SHA-256 differs from the table below, and writes the two committed outputs:
//   packages/engine/src/map/outlines.data.ts   coastlines and lakes, clipped, projected to Mercator, simplified, quantised
//   apps/web/src/editor/tripMap/places.data.ts the dialog's place list
// --check writes nothing and exits 1 when a committed output differs from what the inputs give.
// Deterministic: the same inputs on the same Node give the same bytes (no clock, no randomness, sorted output; the
// projection uses Math.log/Math.tan once per vertex at build time and the result is rounded to an integer grid).
//
// Source (fetched once by the tripmap pre-pass, 2026-11-26, then deleted):
//   https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/<path>
//   tag v5.1.2 = commit f1890d9f152c896d250a77557a5751a93d494776 (git ls-remote, 2026-11-26)
// Licence, read at that tag (LICENSE.md): "Everything here is public domain." … "All versions of Natural Earth raster +
// vector map data found on this website are in the public domain." … "No permission is needed to use Natural Earth.
// Crediting the authors is unnecessary." Names (NAME_HE, NAME_EN) come from Wikidata, CC0 (naturalearthdata.com terms page).
//
// What is used and what is NOT: land and lakes only. No admin-0/admin-1 file is read: nothing here is a border. Places
// are selected by SCALERANK and a fixed box only; no capital or feature class is read, stored or shown (tripmap-verify C7).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const INPUTS = {
  'LICENSE.md': { path: 'LICENSE.md', sha256: '2631b5b39b6d1acc56de75235109b5af2dbb4b0ac5a127b6f06185977247fd4b', bytes: 4636 },
  'ne_50m_land.geojson': { path: 'geojson/ne_50m_land.geojson', sha256: 'e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b', bytes: 1636166 },
  'ne_50m_lakes.geojson': { path: 'geojson/ne_50m_lakes.geojson', sha256: 'd350b75978b26fe839b797c2c529b2fb8f47fb3983c03f4964e36d5df9378a52', bytes: 876018 },
  'ne_10m_land.geojson': { path: 'geojson/ne_10m_land.geojson', sha256: '1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416', bytes: 10157965 },
  'ne_10m_lakes.geojson': { path: 'geojson/ne_10m_lakes.geojson', sha256: '2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9', bytes: 5043554 },
  'ne_10m_populated_places.geojson': { path: 'geojson/ne_10m_populated_places.geojson', sha256: '9b8e3de09048ef00dfc70357dbb9fa324493f214b5e0ae4daf1aa79a8d10116b', bytes: 19359003 },
};
export const SOURCE = { repo: 'nvkelso/natural-earth-vector', tag: 'v5.1.2', commit: 'f1890d9f152c896d250a77557a5751a93d494776' };

/** Latitude limit: polygons are CLIPPED here at build time and the clip edge is marked `cut` (never stroked; C2). */
export const MAX_LAT = 80;
/** The 1:10m box (tripmap-verify C2): used only for views that lie wholly inside it. Its crop edges are `cut`. */
export const DETAIL_BOX = { lonMin: 29, lonMax: 39.5, latMin: 27, latMax: 36.5 };
/** Place rule: every place inside PLACE_BOX, plus places worldwide with SCALERANK <= PLACE_MAX_SCALERANK. */
export const PLACE_BOX = DETAIL_BOX;
export const PLACE_MAX_SCALERANK = 3;

/**
 * Levels. `q`: quantum in Mercator degrees (x = longitude in degrees; y = (180/π)·ln(tan(π/4 + φ/2)), same unit).
 * `tol`: Douglas–Peucker tolerance in Mercator degrees (projected, so the error is the same on screen at any latitude).
 * `minArea`: rings with a smaller |area| (Mercator degrees²) are dropped after simplification.
 * `use`: the span rule the painter applies (spanLat = the view's height in degrees of latitude at its centre; W2 owns it).
 */
export const LEVELS = [
  { id: 'coarse', src: '50m', q: 0.05, tol: 0.25, minArea: 1.0, use: 'views wider than 30° of span' },
  { id: 'world', src: '50m', q: 0.01, tol: 0.03, minArea: 0.02, use: 'views from 8° to 30° of span, and narrower views not wholly inside DETAIL_BOX' },
  { id: 'detail', src: '10m', q: 0.001, tol: 0.003, minArea: 0.0003, box: true, use: 'views narrower than 8° that lie wholly inside DETAIL_BOX' },
];
/** Spatial groups: whole polygons by the cell of their bbox centre in a GRID×GRID grid over the level's extent. */
export const GRID = 8;
export const FORMAT = 1;

const R2D = 180 / Math.PI;
export const mercY = (lat) => R2D * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

// ---------------------------------------------------------------- geometry
/** A ring is { pts: [[x,y],…] (open: last != first), cut: [bool per edge i→i+1] }. */
export function ringFromCoords(coords) {
  const pts = coords.slice(0, coords.length - 1).map(([x, y]) => [x, y]); // GeoJSON rings repeat the first point
  // Natural Earth splits polygons at the antimeridian: an edge running along lon ±180 is a cut, not a coast.
  const cut = pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return Math.abs(Math.abs(p[0]) - 180) < 1e-6 && Math.abs(Math.abs(q[0]) - 180) < 1e-6; });
  return { pts, cut };
}
/** Sutherland–Hodgman against one half-plane, keeping the edge flags: edges created along the clip line are `cut`. */
function clipHalf(ring, inside, cross) {
  const { pts, cut } = ring, n = pts.length, out = [], oc = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n], f = cut[i];
    const pin = inside(p), qin = inside(q);
    if (pin && qin) { out.push(p); oc.push(f); }
    else if (pin && !qin) { out.push(p); oc.push(f); out.push(cross(p, q)); oc.push(true); }
    else if (!pin && qin) { out.push(cross(p, q)); oc.push(f); }
  }
  return { pts: out, cut: oc };
}
const atLat = (lat) => (p, q) => [p[0] + ((q[0] - p[0]) * (lat - p[1])) / (q[1] - p[1]), lat];
const atLon = (lon) => (p, q) => [lon, p[1] + ((q[1] - p[1]) * (lon - p[0])) / (q[0] - p[0])];
export function clipRing(ring, box) {
  let r = ring;
  r = clipHalf(r, (p) => p[1] <= box.latMax, atLat(box.latMax));
  if (r.pts.length) r = clipHalf(r, (p) => p[1] >= box.latMin, atLat(box.latMin));
  if (box.lonMin != null && r.pts.length) r = clipHalf(r, (p) => p[0] >= box.lonMin, atLon(box.lonMin));
  if (box.lonMax != null && r.pts.length) r = clipHalf(r, (p) => p[0] <= box.lonMax, atLon(box.lonMax));
  return r;
}
function dpRun(pts, a, b, tol2, keep) {
  // iterative Douglas–Peucker over pts[a..b] (indices into a linear array), endpoints kept
  const stack = [[a, b]];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j <= i + 1) continue;
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = pts[k];
      let d2;
      if (L2 === 0) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else { const t = ((px - ax) * dx + (py - ay) * dy) / L2; const cx = ax + t * dx, cy = ay + t * dy; d2 = (px - cx) ** 2 + (py - cy) ** 2; }
      if (d2 > best) { best = d2; bi = k; }
    }
    if (best > tol2) { keep[bi] = true; stack.push([i, bi], [bi, j]); }
  }
}
/** Simplify a closed ring: runs of equal edge flags are simplified separately with their ends fixed, so a cut stays a cut. */
export function simplifyRing(ring, tol) {
  const { pts, cut } = ring, n = pts.length;
  if (n < 3) return null;
  const keep = new Array(n).fill(false);
  const breaks = [];
  for (let i = 0; i < n; i++) if (cut[i] !== cut[(i - 1 + n) % n]) breaks.push(i);
  if (breaks.length === 0) {
    // all one kind: anchor at vertex 0 and at the vertex farthest from it
    let far = 0, fd = -1;
    for (let k = 1; k < n; k++) { const d = (pts[k][0] - pts[0][0]) ** 2 + (pts[k][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = k; } }
    breaks.push(0, far);
  }
  for (const b of breaks) keep[b] = true;
  const lin = [...pts, ...pts]; // unrolled so a run may wrap past the end
  const tol2 = tol * tol;
  for (let k = 0; k < breaks.length; k++) {
    const a = breaks[k], b = k + 1 < breaks.length ? breaks[k + 1] : breaks[0] + n;
    const kp = new Array(b - a + 1).fill(false);
    const sub = lin.slice(a, b + 1);
    dpRun(sub, 0, sub.length - 1, tol2, kp);
    for (let t = 1; t < kp.length - 1; t++) if (kp[t]) keep[(a + t) % n] = true;
  }
  const outP = [], outC = [];
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    outP.push(pts[i]);
    outC.push(cut[i]); // the run from a kept vertex to the next kept one has one flag (breaks are always kept)
  }
  return outP.length >= 3 ? { pts: outP, cut: outC } : null;
}
const ringArea = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; s += x1 * y2 - x2 * y1; } return s / 2; };

// ---------------------------------------------------------------- encoding
/** Unsigned LEB128 varint; zigzag for signed. */
function varint(out, v) { if (!Number.isSafeInteger(v) || v < 0) throw new Error(`varint ${v}`); while (v >= 128) { out.push((v % 128) | 128); v = Math.floor(v / 128); } out.push(v); }
const zig = (v) => (v >= 0 ? 2 * v : -2 * v - 1);

/**
 * One group's bytes (FORMAT 1), the layout the engine codec reads (packages/engine/src/map/outlines.ts):
 *   varint ringCount
 *   per ring: varint n (>= 3 vertices, open ring), zigzag x0, zigzag y0 (absolute, in quanta),
 *             then n-1 pairs zigzag dx, dy (quanta, vertex to vertex),
 *             then varint k (cut runs), then k pairs: varint gap (edges since the end of the previous run, or since edge 0),
 *             varint len (edges). Edge i joins vertex i to vertex (i+1) mod n. Edges not in a cut run are coast.
 *   Rings of one polygon (outer and holes) are always in the same group: fill a group's rings together, even-odd.
 */
export function encodeGroup(rings) {
  const out = [];
  varint(out, rings.length);
  for (const r of rings) {
    const n = r.q.length;
    varint(out, n);
    varint(out, zig(r.q[0][0])); varint(out, zig(r.q[0][1]));
    for (let i = 1; i < n; i++) { varint(out, zig(r.q[i][0] - r.q[i - 1][0])); varint(out, zig(r.q[i][1] - r.q[i - 1][1])); }
    const runs = [];
    for (let i = 0; i < n; i++) if (r.cut[i] && (i === 0 || !r.cut[i - 1])) { let j = i; while (j < n && r.cut[j]) j++; runs.push([i, j - i]); }
    varint(out, runs.length);
    let end = 0;
    for (const [s, len] of runs) { varint(out, s - end); varint(out, len); end = s + len; }
  }
  return Buffer.from(out);
}

function polygonsOf(fc) {
  const polys = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') polys.push(g.coordinates);
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) polys.push(p);
    else throw new Error(`unexpected geometry ${g.type}`);
  }
  return polys;
}

/** One layer (land or lakes) of one level → { groups: [{ bbox, rings, vertices, b64 }] }. */
function buildLayer(fc, level) {
  const clipBox = level.box ? DETAIL_BOX : { latMin: -MAX_LAT, latMax: MAX_LAT };
  const polys = [];
  for (const poly of polygonsOf(fc)) {
    const rings = [];
    for (const coords of poly) {
      if (coords.length < 4) continue;
      let r = clipRing(ringFromCoords(coords), clipBox);
      if (r.pts.length < 3) continue;
      r = { pts: r.pts.map(([lon, lat]) => [lon, mercY(lat)]), cut: r.cut };
      const s = simplifyRing(r, level.tol);
      if (!s) continue;
      // quantise, then drop repeated vertices (keeping the edge flag of the edge that survives) and tiny rings
      const q = [], cut = [];
      for (let i = 0; i < s.pts.length; i++) {
        const v = [Math.round(s.pts[i][0] / level.q), Math.round(s.pts[i][1] / level.q)];
        const last = q[q.length - 1];
        if (last && last[0] === v[0] && last[1] === v[1]) { cut[cut.length - 1] = cut[cut.length - 1] && s.cut[i]; continue; }
        q.push(v); cut.push(s.cut[i]);
      }
      while (q.length > 1 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) { q.pop(); cut.pop(); }
      if (q.length < 3) continue;
      if (Math.abs(ringArea(q)) * level.q * level.q < level.minArea) continue;
      rings.push({ q, cut });
    }
    if (rings.length) polys.push(rings);
  }
  // groups by the cell of each polygon's bbox centre
  const ext = level.box
    ? { x0: DETAIL_BOX.lonMin, x1: DETAIL_BOX.lonMax, y0: mercY(DETAIL_BOX.latMin), y1: mercY(DETAIL_BOX.latMax) }
    : { x0: -180, x1: 180, y0: mercY(-MAX_LAT), y1: mercY(MAX_LAT) };
  const cells = new Map();
  for (const rings of polys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) for (const [x, y] of r.q) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const cx = ((x0 + x1) / 2) * level.q, cy = ((y0 + y1) / 2) * level.q;
    const col = Math.min(GRID - 1, Math.max(0, Math.floor(((cx - ext.x0) / (ext.x1 - ext.x0)) * GRID)));
    const row = Math.min(GRID - 1, Math.max(0, Math.floor(((cy - ext.y0) / (ext.y1 - ext.y0)) * GRID)));
    const key = row * GRID + col;
    if (!cells.has(key)) cells.set(key, { rings: [], bbox: [Infinity, Infinity, -Infinity, -Infinity] });
    const c = cells.get(key);
    c.rings.push(...rings);
    c.bbox = [Math.min(c.bbox[0], x0), Math.min(c.bbox[1], y0), Math.max(c.bbox[2], x1), Math.max(c.bbox[3], y1)];
  }
  const groups = [...cells.keys()].sort((a, b) => a - b).map((k) => {
    const c = cells.get(k);
    return { bbox: c.bbox, rings: c.rings.length, vertices: c.rings.reduce((s, r) => s + r.q.length, 0), cutEdges: c.rings.reduce((s, r) => s + r.cut.filter(Boolean).length, 0), b64: encodeGroup(c.rings).toString('base64') };
  });
  return groups;
}

// ---------------------------------------------------------------- places
export function buildPlaces(fc) {
  const rows = [];
  for (const f of fc.features) {
    const p = f.properties, g = f.geometry;
    if (!g || g.type !== 'Point') continue;
    const [lon, lat] = g.coordinates;
    const inBox = lon >= PLACE_BOX.lonMin && lon <= PLACE_BOX.lonMax && lat >= PLACE_BOX.latMin && lat <= PLACE_BOX.latMax;
    if (!(inBox || (typeof p.SCALERANK === 'number' && p.SCALERANK <= PLACE_MAX_SCALERANK))) continue;
    if (Math.abs(lat) > MAX_LAT) continue;
    const he = typeof p.NAME_HE === 'string' ? p.NAME_HE.normalize('NFC').trim() : '';
    const en = (typeof p.NAME_EN === 'string' && p.NAME_EN.trim() ? p.NAME_EN : String(p.NAME ?? '')).normalize('NFC').trim();
    if (!Number.isSafeInteger(p.NE_ID) || (!he && !en)) continue;
    // [NE_ID, Hebrew name, English name, lon and lat in hundredths of a degree] — 0.01°, the stored quantum (C7)
    rows.push([p.NE_ID, he, en, Math.round(lon * 100), Math.round(lat * 100)]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return rows;
}

// ---------------------------------------------------------------- output
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const HEADER = (what) => `// GENERATED by tools/tripmap/build-data.mjs from Natural Earth ${SOURCE.tag} (commit ${SOURCE.commit}). Do not edit.
// Public domain: "Everything here is public domain." (LICENSE.md at that tag). ${what}
// Size and SHA-256 of this file are tested (tools/tripmap/data.test.ts); regenerate with the script, never by hand.
`;

export function build(srcDir) {
  const read = (name) => {
    const spec = INPUTS[name];
    const buf = fs.readFileSync(path.join(srcDir, name));
    const got = sha(buf);
    if (got !== spec.sha256) throw new Error(`${name}: SHA-256 ${got} is not the pinned ${spec.sha256}; refusing to build from it`);
    return buf;
  };
  const licence = read('LICENSE.md').toString('utf8');
  if (!licence.startsWith('# Everything here is public domain.')) throw new Error('LICENSE.md does not open with the public-domain sentence');
  const json = (name) => JSON.parse(read(name).toString('utf8'));
  const src = { '50m': { land: json('ne_50m_land.geojson'), lakes: json('ne_50m_lakes.geojson') }, '10m': { land: json('ne_10m_land.geojson'), lakes: json('ne_10m_lakes.geojson') } };
  const levels = LEVELS.map((lv) => ({
    id: lv.id, q: lv.q, use: lv.use,
    ...(lv.box ? { box: DETAIL_BOX } : {}),
    land: buildLayer(src[lv.src].land, lv),
    lakes: buildLayer(src[lv.src].lakes, lv),
  }));
  const outlines = {
    format: FORMAT,
    source: `Natural Earth ${SOURCE.tag} (${SOURCE.repo}@${SOURCE.commit}): ne_50m_land, ne_50m_lakes, ne_10m_land, ne_10m_lakes`,
    projection: 'x = longitude in degrees; y = (180/π)·ln(tan(π/4 + latitude/2)); both in units of the level quantum q',
    maxLat: MAX_LAT,
    grid: GRID,
    levels: levels.map((lv) => ({ ...lv, land: lv.land.map(({ bbox, rings, vertices, cutEdges, b64 }) => ({ bbox, rings, vertices, cutEdges, data: b64 })), lakes: lv.lakes.map(({ bbox, rings, vertices, cutEdges, b64 }) => ({ bbox, rings, vertices, cutEdges, data: b64 })) })),
  };
  const outlinesTs = `${HEADER('Coastlines and lakes only: no border of any kind.')}import type { OutlineData } from './outlines.ts';
const DATA: OutlineData = ${JSON.stringify(outlines)};
export default DATA;
`;
  const places = buildPlaces(json('ne_10m_populated_places.geojson'));
  const placesTs = `${HEADER(`Names from Wikidata (CC0). Rule: every place in lon ${PLACE_BOX.lonMin}–${PLACE_BOX.lonMax}, lat ${PLACE_BOX.latMin}–${PLACE_BOX.latMax}, plus SCALERANK <= ${PLACE_MAX_SCALERANK} worldwide; no class field is read.`)}// Row: [NE_ID, Hebrew name, English name, longitude, latitude] (coordinates in hundredths of a degree).
export type PlaceRow = readonly [number, string, string, number, number];
const PLACES: readonly PlaceRow[] = ${JSON.stringify(places)};
export default PLACES;
`;
  return { outlinesTs, placesTs, outlines, places };
}

export const OUT = { outlines: 'packages/engine/src/map/outlines.data.ts', places: 'apps/web/src/editor/tripMap/places.data.ts' };

function main(argv) {
  const at = argv.indexOf('--src');
  if (at < 0 || !argv[at + 1]) { console.error('usage: node tools/tripmap/build-data.mjs --src <download dir> [--check]'); return 2; }
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { outlinesTs, placesTs, outlines, places } = build(path.resolve(argv[at + 1]));
  const files = [[OUT.outlines, outlinesTs], [OUT.places, placesTs]];
  let bad = 0;
  for (const [rel, text] of files) {
    const p = path.join(repo, rel);
    if (argv.includes('--check')) { const same = fs.existsSync(p) && fs.readFileSync(p, 'utf8') === text; if (!same) bad++; console.log(`${same ? 'same' : 'DIFFERS'} ${rel}`); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    console.log(`${rel}: ${Buffer.byteLength(text)} bytes, sha256 ${sha(Buffer.from(text))}`);
  }
  for (const lv of outlines.levels) for (const layer of ['land', 'lakes']) {
    const g = lv[layer];
    console.log(`  ${lv.id}/${layer}: ${g.length} groups, ${g.reduce((s, x) => s + x.rings, 0)} rings, ${g.reduce((s, x) => s + x.vertices, 0)} vertices, ${g.reduce((s, x) => s + x.cutEdges, 0)} cut edges, ${g.reduce((s, x) => s + x.data.length, 0)} base64 chars`);
  }
  console.log(`  places: ${places.length} rows`);
  return bad ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
