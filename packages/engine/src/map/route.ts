/**
 * The trip map's route geometry shared by the painter and the proof: the legs' paths from core legPath, computed once per payload
 * and cached (C5), and the point at progress s of a leg: core pathPointAt (arc length along the samples, so a flight's marker moves
 * at an even speed on the drawn curve). The painter, the marker and the proof's prediction use this one definition (integration
 * 2026-11-26: the by-index reading drew a flight's marker up to 22.6 px away from core's point).
 */
import { legPath, pathPointAt, type MapPayload, type MercPoint } from '@pulseframe/core';
import { stopPoints } from './labels.ts';

export interface RouteGeometry { stops: MercPoint[]; /** legs[i−1] is the leg into stop i, as x,y pairs in Mercator units */ legs: Float64Array[] }
const CACHE = new Map<string, RouteGeometry>();
const CACHE_MAX = 32;
/** The payload's stops and legs (cached by payload JSON). */
export function routeOf(p: MapPayload): RouteGeometry {
  const key = JSON.stringify(p);
  let r = CACHE.get(key);
  if (!r) {
    const stops = stopPoints(p);
    const legs = p.stops.slice(1).map((s, i) => legPath(stops[i]!, stops[i + 1]!, s.via ?? 'road'));
    r = { stops, legs };
    if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
    CACHE.set(key, r);
  }
  return r;
}
/** The point at progress s ∈ [0, 1] of a path (x,y pairs): core pathPointAt (arc length). */
export const routePointAt = (path: Float64Array, s: number): MercPoint => pathPointAt(path, Math.min(1, Math.max(0, s)));
/** The samples of a path up to progress s (the travelled part, by arc length), ending exactly at routePointAt(path, s). */
export function routeUpTo(path: Float64Array, s: number): MercPoint[] {
  const m = path.length / 2, c = Math.min(1, Math.max(0, s));
  const out: MercPoint[] = [{ x: path[0]!, y: path[1]! }];
  if (m < 2 || c <= 0) return out;
  let total = 0;
  for (let i = 1; i < m; i++) total += Math.hypot(path[2 * i]! - path[2 * i - 2]!, path[2 * i + 1]! - path[2 * i - 1]!);
  const want = c * total;
  let run = 0;
  for (let i = 1; i < m; i++) {
    run += Math.hypot(path[2 * i]! - path[2 * i - 2]!, path[2 * i + 1]! - path[2 * i - 1]!);
    if (run >= want && c < 1) break;
    out.push({ x: path[2 * i]!, y: path[2 * i + 1]! });
  }
  if (c < 1) out.push(routePointAt(path, c));
  return out;
}
/** Tests only. */
export const clearRoutes = (): void => CACHE.clear();
