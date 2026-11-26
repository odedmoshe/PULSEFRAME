/**
 * Volume automation of a sound clip (SPEC §17): the level at a clip-local time, from the clip's volume keys.
 * Held before the first key and after the last; between two keys it moves in a straight line, or — when the earlier key
 * is marked `curve: 'smooth'` — along an S-shaped curve (smoothstep) that leaves and arrives gently.
 * The audio plan, the Sound panel and the timeline's volume line all use this one definition.
 */
import * as T from '@pulseframe/time';
import type { MediaClip } from './schema.ts';

export type VolumeKey = NonNullable<MediaClip['volume']>[number];
/** Shape of a segment: x is how far along it (0..1), the result how much of the level change has happened. */
export const volumeShape = (curve: VolumeKey['curve'], x: number): number => (curve === 'smooth' ? x * x * (3 - 2 * x) : x);
/** Number of straight pieces a smooth segment is rendered with (mixers and the drawn line follow the same points). */
export const SMOOTH_PIECES = 16;

export function volumeLevelAt(keys: VolumeKey[] | undefined, local: T.RationalTime): number {
  if (!keys?.length) return 1;
  if (T.lte(local, keys[0]!.time)) return keys[0]!.value;
  const last = keys[keys.length - 1]!;
  if (T.lte(last.time, local)) return last.value;
  const i = keys.findIndex((k) => T.lt(local, k.time));
  const a = keys[i - 1]!, b = keys[i]!;
  const x = T.toSeconds(T.sub(local, a.time)) / T.toSeconds(T.sub(b.time, a.time));
  return a.value + (b.value - a.value) * volumeShape(a.curve, x);
}
/**
 * The keys as points of a piecewise-linear envelope: `at(key.time)` places a key (samples, pixels, …). A smooth segment
 * becomes SMOOTH_PIECES straight pieces.
 */
export function volumePoints(keys: VolumeKey[], at: (t: T.RationalTime) => number): { x: number; value: number }[] {
  const out: { x: number; value: number }[] = [];
  keys.forEach((k, i) => {
    out.push({ x: at(k.time), value: k.value });
    const next = keys[i + 1];
    if (k.curve !== 'smooth' || !next) return;
    const x0 = at(k.time), x1 = at(next.time);
    for (let j = 1; j < SMOOTH_PIECES; j++) { const u = j / SMOOTH_PIECES; out.push({ x: x0 + (x1 - x0) * u, value: k.value + (next.value - k.value) * volumeShape('smooth', u) }); }
  });
  return out;
}
