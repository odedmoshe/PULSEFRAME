/**
 * The trip map's route geometry shared by the painter and the proof: the legs' paths from core legPath, computed once per payload
 * and cached (C5), and the point at progress s of a leg. A point at progress s lies at the fraction s of the leg's samples by index
 * (the samples of legPath are evenly spaced along the leg: straight legs have two, flights 64 slerp steps), so the painter, the
 * marker and the proof's prediction use one definition.
 */
import { legPath, type MapPayload, type MercPoint } from '@pulseframe/core';
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
/** The point at progress s ∈ [0, 1] of a path (x,y pairs), by sample index. */
export function routePointAt(path: Float64Array, s: number): MercPoint {
  const m = path.length / 2;
  if (m < 2) return { x: path[0]!, y: path[1]! };
  const t = Math.min(1, Math.max(0, s)) * (m - 1), i = Math.min(m - 2, Math.floor(t)), f = t - i;
  return { x: path[2 * i]! + (path[2 * i + 2]! - path[2 * i]!) * f, y: path[2 * i + 1]! + (path[2 * i + 3]! - path[2 * i + 1]!) * f };
}
/** The samples of a path up to progress s (the travelled part), ending exactly at routePointAt(path, s). */
export function routeUpTo(path: Float64Array, s: number): MercPoint[] {
  const m = path.length / 2;
  const t = Math.min(1, Math.max(0, s)) * (m - 1), whole = Math.floor(t);
  const out: MercPoint[] = [];
  for (let i = 0; i <= Math.min(whole, m - 1); i++) out.push({ x: path[2 * i]!, y: path[2 * i + 1]! });
  if (t > whole) out.push(routePointAt(path, s));
  return out;
}
/** Tests only. */
export const clearRoutes = (): void => CACHE.clear();
