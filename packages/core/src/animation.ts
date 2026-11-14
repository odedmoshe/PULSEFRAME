/**
 * Keyframe evaluation (SPEC §14). Pure and stateless: the value at a time depends only on the keys,
 * so a random seek and sequential playback always agree.
 */
import * as T from '@pulseframe/time';
import { ANIMATABLE, type Clip, type Keyframe, type Transform } from './schema.ts';

const EASE: Record<Keyframe['easing'], (u: number) => number> = {
  linear: (u) => u,
  hold: () => 0,
  'ease-in': (u) => u * u * u,
  'ease-out': (u) => 1 - (1 - u) ** 3,
  'ease-in-out': (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
};

/** Value of one property at clip-local time `t`. Before the first key: first value. After the last: last value. */
export function sampleKeyframes(keys: Keyframe[], t: T.RationalTime): number {
  if (T.lte(t, keys[0]!.time)) return keys[0]!.value;
  const last = keys[keys.length - 1]!;
  if (T.lte(last.time, t)) return last.value;
  // binary search for the segment [a, b) containing t
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T.lte(keys[mid]!.time, t)) lo = mid; else hi = mid; }
  const a = keys[lo]!;
  const b = keys[hi]!;
  // Exact rational position inside the segment, converted to a float only for the blend itself.
  const u = T.toSeconds(T.sub(t, a.time)) / T.toSeconds(T.sub(b.time, a.time));
  return a.value + (b.value - a.value) * EASE[a.easing](u);
}

/** The clip's transform at sequence time `time` (keys override the static value per property). */
export function transformAt(clip: Clip, time: T.RationalTime): Transform {
  if (!clip.keyframes) return clip.transform;
  const local = T.sub(time, clip.start);
  const out: Transform = { ...clip.transform };
  for (const p of ANIMATABLE) { const keys = clip.keyframes[p]; if (keys?.length) out[p] = sampleKeyframes(keys, local); }
  return out;
}

/** Shift every key by -delta (used when the clip start moves relative to its content: trim-start and the right half of a split). */
export function shiftKeyframes(clip: Clip, delta: T.RationalTime): void {
  if (!clip.keyframes) return;
  for (const p of ANIMATABLE) { const keys = clip.keyframes[p]; if (keys) clip.keyframes[p] = keys.map((k) => ({ ...k, time: T.sub(k.time, delta) })); }
}
