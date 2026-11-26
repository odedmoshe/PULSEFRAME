/**
 * The trip map's cached outline paths (tripmap-verify C5): one fill path and one stroke path per (data, level, layer, group), built
 * lazily from the decoded rings the first time a view needs the group, and kept for the life of the page. Coordinates are the
 * integer quanta of the level: the quantum and the camera go into ONE transform per level and world copy, so no vertex is projected
 * or moved in JavaScript per frame.
 * - fill: every ring of the group, closed (outer rings and holes together: filled with the even-odd rule);
 * - stroke: coast edges only. A `cut` edge (a crop or clip line, or Natural Earth's ±180° split) is never in the stroke path (C2).
 */
import { decodeQuanta, type OutlineData, type OutlineGroup, type OutlineLevel } from './outlines.ts';

/** The part of Path2D the cache uses (a test may pass a recording stand-in). */
export interface PathSink { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void }
export type PathFactory = () => PathSink;
export interface GroupPaths { fill: PathSink; stroke: PathSink; vertices: number; coastEdges: number }

/**
 * Runs of coast edges of one ring, as [first vertex, edge count]: edges first … first+count−1 (mod n). Null when the ring has no cut
 * edge (then it is stroked whole and closed). A ring whose every edge is cut gives no run.
 */
export function coastRuns(cut: Uint8Array): [number, number][] | null {
  const n = cut.length;
  const firstCut = cut.indexOf(1);
  if (firstCut < 0) return null;
  const runs: [number, number][] = [];
  let start = -1, len = 0;
  for (let k = 1; k <= n; k++) {
    const e = (firstCut + k) % n;
    if (!cut[e]) { if (start < 0) start = e; len++; }
    else if (start >= 0) { runs.push([start, len]); start = -1; len = 0; }
  }
  if (start >= 0) runs.push([start, len]);
  return runs;
}

/** Builds a group's fill and stroke paths from its integer rings. */
export function buildGroupPaths(group: OutlineGroup, make: PathFactory): GroupPaths {
  const fill = make(), stroke = make();
  let vertices = 0, coastEdges = 0;
  for (const { xy, cut } of decodeQuanta(group)) {
    const n = cut.length;
    vertices += n;
    fill.moveTo(xy[0]!, xy[1]!);
    for (let k = 1; k < n; k++) fill.lineTo(xy[2 * k]!, xy[2 * k + 1]!);
    fill.closePath();
    const runs = coastRuns(cut);
    if (!runs) {
      stroke.moveTo(xy[0]!, xy[1]!);
      for (let k = 1; k < n; k++) stroke.lineTo(xy[2 * k]!, xy[2 * k + 1]!);
      stroke.closePath();
      coastEdges += n;
      continue;
    }
    for (const [s, len] of runs) {
      stroke.moveTo(xy[2 * s]!, xy[2 * s + 1]!);
      for (let k = 1; k <= len; k++) { const v = (s + k) % n; stroke.lineTo(xy[2 * v]!, xy[2 * v + 1]!); }
      coastEdges += len;
    }
  }
  return { fill, stroke, vertices, coastEdges };
}

const CACHE = new WeakMap<OutlineData, Map<string, GroupPaths>>();
let built = 0;
/** The cached paths of one group (built on first use). */
export function groupPaths(data: OutlineData, level: OutlineLevel, layer: 'land' | 'lakes', index: number, make: PathFactory): GroupPaths {
  let m = CACHE.get(data);
  if (!m) { m = new Map(); CACHE.set(data, m); }
  const key = `${level.id}/${layer}/${index}`;
  let p = m.get(key);
  if (!p) { p = buildGroupPaths(level[layer][index]!, make); m.set(key, p); built++; }
  return p;
}
/** How many group paths this page has built so far (tests and the proof: a second frame of the same view builds none). */
export const builtGroupPaths = (): number => built;
