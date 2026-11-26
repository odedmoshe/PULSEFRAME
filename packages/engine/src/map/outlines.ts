/**
 * The trip map's outline data (wave 8 tripmap): types of the committed, generated outlines.data.ts (tools/tripmap/build-data.mjs,
 * FORMAT 1) and the codec reader's signature. LEAD PRE-PASS: types, the format and the reader's contract; W2 builds decodeGroup and
 * the cached Path2D groups (C5) and tests them against the committed file.
 *
 * Format 1, settled by the pre-pass (the script's encodeGroup is the writer):
 * - Levels `coarse` (q 0.05), `world` (q 0.01) and `detail` (q 0.001, the 1:10m box DETAIL_BOX) of land and lakes. Coordinates are
 *   Mercator units (x = longitude in degrees, y = (180/π)·ln(tan(π/4 + φ/2))) as integers of the level's quantum q: a vertex is
 *   (x·q, y·q). Projected at build time: the painter needs no trigonometry for the outlines, only one setTransform per frame.
 * - Polygons are clipped at ±80° latitude at build time; the 10m level is cropped to DETAIL_BOX. Edges created by those clips and the
 *   antimeridian edges of Natural Earth are marked `cut`: they are filled but NEVER stroked (C2). Every other edge is coast.
 * - A group holds whole polygons (outer ring and holes): fill a group's rings together with the even-odd rule. `bbox` is
 *   [minX, minY, maxX, maxY] in quanta, for culling. Lakes are filled in the lake colour over the land and their shores stroked.
 * - Group bytes (base64 `data`): varint ringCount; per ring: varint n, zigzag x0, zigzag y0, n−1 × (zigzag dx, zigzag dy), varint k,
 *   k × (varint gap, varint len) cut runs over edge indices (edge i joins vertex i to vertex (i+1) mod n). Varints are unsigned LEB128.
 * Which level a view uses (W2, mapLevelFor): coarse when the view spans more than 30° of latitude, world from 8° to 30°, detail only when
 * the view lies wholly inside DETAIL_BOX and spans less than 8° (a view that touches the box edge draws `world` everywhere: no seam).
 * The data and the painter are covered by the engine fingerprint's bundle digest (C5): no second hash is keyed.
 */
export interface OutlineGroup { bbox: [number, number, number, number]; rings: number; vertices: number; cutEdges: number; data: string }
export interface OutlineLevel { id: 'coarse' | 'world' | 'detail'; q: number; use: string; box?: { lonMin: number; lonMax: number; latMin: number; latMax: number }; land: OutlineGroup[]; lakes: OutlineGroup[] }
export interface OutlineData { format: 1; source: string; projection: string; maxLat: number; grid: number; levels: OutlineLevel[] }

/** One decoded ring: vertices as Mercator units (x0, y0, x1, y1, …) and the indices of its cut edges (never stroked). */
export interface DecodedRing { xy: Float64Array; cut: Uint8Array }

export class MapDataNotBuiltError extends Error {
  readonly code = 'map_not_built' as const;
  constructor(what: string) { super(`${what}: the trip map's outline reader is not built in this build yet`); }
}

const R2D = 180 / Math.PI;
/** Latitude in degrees → Mercator y (the outline data's unit). Used for box tests and the level rule only, never per vertex. */
export const mercYOfLat = (lat: number): number => R2D * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
/** Mercator y → latitude in degrees (inverse of mercYOfLat). */
export const latOfMercY = (y: number): number => 2 * R2D * Math.atan(Math.exp(y / R2D)) - 90;

/** Reads unsigned LEB128 varints and zigzag integers from base64 bytes. */
function reader(b64: string) {
  const bin = atob(b64);
  let i = 0;
  const v = (): number => {
    let x = 0, m = 1, c: number;
    do {
      if (i >= bin.length) throw new RangeError('outline group ends inside a varint');
      c = bin.charCodeAt(i++);
      x += (c & 127) * m; m *= 128;
    } while (c & 128);
    return x;
  };
  const z = (): number => { const u = v(); return u % 2 ? -(u + 1) / 2 : u / 2; };
  return { v, z, done: () => i === bin.length };
}

/**
 * Decode one group (format 1). The vertices come back in Mercator units (quanta × q); `cut[e]` is 1 when edge e (vertex e to
 * vertex (e+1) mod n) is a cut edge, filled but never stroked. Throws on bytes that are not format 1 (a truncated or extra byte, a
 * cut run past the ring's last edge, a ring of fewer than 3 vertices).
 */
export function decodeGroup(group: OutlineGroup, q: number): DecodedRing[] {
  return decodeQuanta(group).map((r) => {
    const xy = new Float64Array(r.xy.length);
    for (let k = 0; k < xy.length; k++) xy[k] = r.xy[k]! * q;
    return { xy, cut: r.cut };
  });
}
/** The same rings in integer quanta (what the cached paths are built from: the quantum goes into the one transform per level). */
export function decodeQuanta(group: OutlineGroup): { xy: Int32Array; cut: Uint8Array }[] {
  const rd = reader(group.data);
  const count = rd.v();
  if (count !== group.rings) throw new RangeError(`outline group holds ${count} rings, its header says ${group.rings}`);
  const out: { xy: Int32Array; cut: Uint8Array }[] = [];
  for (let r = 0; r < count; r++) {
    const n = rd.v();
    if (n < 3) throw new RangeError(`outline ring of ${n} vertices`);
    const xy = new Int32Array(2 * n);
    xy[0] = rd.z(); xy[1] = rd.z();
    for (let k = 1; k < n; k++) { xy[2 * k] = xy[2 * k - 2]! + rd.z(); xy[2 * k + 1] = xy[2 * k - 1]! + rd.z(); }
    const cut = new Uint8Array(n);
    const runs = rd.v();
    let end = 0;
    for (let k = 0; k < runs; k++) {
      const s = end + rd.v(), len = rd.v();
      if (len < 1 || s + len > n) throw new RangeError(`outline cut run ${s}+${len} outside a ring of ${n} edges`);
      cut.fill(1, s, s + len);
      end = s + len;
    }
    out.push({ xy, cut });
  }
  if (!rd.done()) throw new RangeError('outline group has bytes after its last ring');
  return out;
}

/** Latitude span above which the coarse level is drawn, and below which the detail level may be (degrees). */
export const MAP_COARSE_ABOVE_DEG = 30;
export const MAP_DETAIL_BELOW_DEG = 8;
/**
 * The level a view uses: coarse when it spans more than 30° of latitude; detail only when it spans less than 8° AND lies wholly
 * inside the detail level's box (a view touching or crossing the box edge draws world everywhere, so there is no seam); else world.
 */
export function mapLevelFor(data: OutlineData, view: readonly [number, number, number, number], spanLatDeg: number): OutlineLevel {
  const level = (id: OutlineLevel['id']) => {
    const l = data.levels.find((x) => x.id === id);
    if (!l) throw new RangeError(`outline data has no ${id} level`);
    return l;
  };
  if (spanLatDeg > MAP_COARSE_ABOVE_DEG) return level('coarse');
  if (spanLatDeg < MAP_DETAIL_BELOW_DEG) {
    const d = level('detail'), b = d.box;
    if (b && view[0] > b.lonMin && view[2] < b.lonMax && view[1] > mercYOfLat(b.latMin) && view[3] < mercYOfLat(b.latMax)) return d;
  }
  return level('world');
}
/** Load the committed data lazily (a separate chunk in the web bundle). */
export const loadOutlines = async (): Promise<OutlineData> => (await import('./outlines.data.ts')).default;
