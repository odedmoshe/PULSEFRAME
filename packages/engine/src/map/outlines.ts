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

/** Decode one group (format 1) at quantum q. W2. */
export function decodeGroup(group: OutlineGroup, q: number): DecodedRing[] { throw new MapDataNotBuiltError(`decodeGroup(${group.rings} rings, q ${q})`); }
/** The level a view uses (rule above). `view`: [minX, minY, maxX, maxY] in Mercator units; spanLatDeg the view's height in degrees of latitude at its centre. W2. */
export function mapLevelFor(data: OutlineData, view: readonly [number, number, number, number], spanLatDeg: number): OutlineLevel { throw new MapDataNotBuiltError(`mapLevelFor(${data.levels.length} levels, ${view.join(',')}, ${spanLatDeg})`); }
/** Load the committed data lazily (a separate chunk in the web bundle). */
export const loadOutlines = async (): Promise<OutlineData> => (await import('./outlines.data.ts')).default;
