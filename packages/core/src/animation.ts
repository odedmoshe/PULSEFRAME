/**
 * Keyframe evaluation (SPEC §14). Pure and stateless: the value at a time depends only on the keys,
 * so a random seek and sequential playback always agree.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { ANIMATABLE, TransformSchema, type Animatable, type Clip, type Keyframe, type Transform } from './schema.ts';
import { NOT_ANIMATABLE, paramRange, type EffectInstance } from './effects.ts';
import { isV1Easing, NO_RANGE, type V1Easing, type ValueRange } from './keyframe.ts';

/**
 * The declared range of each transform property (from TransformSchema, the way effects.ts paramRange reads an effect's).
 * Curves other than the v1 easings are clamped to it (ADR-0019); the v1 easings never leave their keys' span.
 */
export const TRANSFORM_RANGE: Readonly<Record<Animatable, ValueRange>> = (() => {
  const props = (z.toJSONSchema(TransformSchema) as { properties: Record<string, { minimum: number; maximum: number }> }).properties;
  return Object.freeze(Object.fromEntries(ANIMATABLE.map((p) => [p, Object.freeze({ min: props[p]!.minimum, max: props[p]!.maximum })]))) as Record<Animatable, ValueRange>;
})();
/** The range of an effect parameter for the sampler: its declared one, or NO_RANGE. */
export const effectParamRange = (type: string, param: string): ValueRange => paramRange(type, param) ?? NO_RANGE;

const EASE: Record<V1Easing, (u: number) => number> = {
  linear: (u) => u,
  hold: () => 0,
  'ease-in': (u) => u * u * u,
  'ease-out': (u) => 1 - (1 - u) ** 3,
  'ease-in-out': (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
};

/**
 * Value of one channel at clip-local time `t`. Before the first key: first value. After the last: last value.
 * `range` is the channel's declared range (TRANSFORM_RANGE[p], effectParamRange): only the curves of ADR-0019 are clamped to
 * it; a segment with a v1 easing is computed exactly as before (keys-baseline.json, Object.is).
 */
export function sampleKeyframes(keys: readonly Keyframe[], t: T.RationalTime, range: ValueRange): number {
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
  // The curves of ADR-0019 (W1: curves.ts curveShape / smoothValue, clamped to `range`). No key with one can enter a document
  // before they are built (curves.ts CURVES_BUILT), so this refusal is never met by a validated document.
  if (!isV1Easing(a.easing)) { void range; throw new Error(`curve "${a.easing}" is not built yet (ADR-0019 W1)`); }
  return a.value + (b.value - a.value) * EASE[a.easing](u);
}

/** The clip's transform at sequence time `time` (keys override the static value per property). */
export function transformAt(clip: Clip, time: T.RationalTime): Transform {
  if (!clip.keyframes) return clip.transform;
  const local = T.sub(time, clip.start);
  const out: Transform = { ...clip.transform };
  for (const p of ANIMATABLE) { const keys = clip.keyframes[p]; if (keys?.length) out[p] = sampleKeyframes(keys, local, TRANSFORM_RANGE[p]); }
  return out;
}

/** Shift every key by -delta (used when the clip start moves relative to its content: trim-start and the right half of a split). */
export function shiftKeyframes(clip: Clip, delta: T.RationalTime): void {
  if (clip.keyframes) for (const p of ANIMATABLE) { const keys = clip.keyframes[p]; if (keys) clip.keyframes[p] = keys.map((k) => ({ ...k, time: T.sub(k.time, delta) })); }
  if (clip.type === 'media' && clip.volume) clip.volume = clip.volume.map((k) => ({ ...k, time: T.sub(k.time, delta) }));
  // Effect parameter animation is attached to the content in the same way.
  for (const fx of clip.effects ?? []) if (fx.keyframes) for (const p of Object.keys(fx.keyframes)) fx.keyframes[p] = fx.keyframes[p]!.map((k) => ({ ...k, time: T.sub(k.time, delta) }));
}
/**
 * An effect's parameters at clip-local time `local`: static values with animated numeric parameters sampled from their keys.
 * A parameter that may not be animated (effects.ts NOT_ANIMATABLE) keeps its static value even when the document holds keys for it.
 */
export function effectParamsAt(fx: EffectInstance, local: T.RationalTime): EffectInstance['params'] {
  if (!fx.keyframes) return fx.params;
  const out = { ...fx.params };
  const fixed = NOT_ANIMATABLE[fx.type];
  for (const [p, keys] of Object.entries(fx.keyframes)) if (keys.length && !fixed?.includes(p)) out[p] = sampleKeyframes(keys, local, effectParamRange(fx.type, p));
  return out;
}
