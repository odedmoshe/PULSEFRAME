/**
 * The comfort rule of thumb of «תמונה חיה» (wave 8 living; verifier C1, C5, C6). LEAD-BUILT and frozen after the pre-pass: pure
 * functions used by set_living_picture (W1), update_effect (ops.ts), preflight (W1) and the inspector's amount slider (W3).
 *
 * The rule: between two consecutive frames of the clip, the relative shift between the nearest and the farthest point changes by at
 * most LIVING_MAX_RATE of the frame height per second. With the relative shift d(u) = A · SPAN · g(u), A = amount · LIVING_MAX_SHIFT,
 * and travel u keyed from 0 at the first frame to 1 at the last with a curve of peak slope s, the closed form is
 *   amount ≤ LIVING_MAX_RATE · T / (LIVING_MAX_SHIFT · SPAN · s),   T = (frames − 1) / fps seconds (the keys' span).
 * The discrete check over the frames never exceeds the closed form (a secant is never steeper than the curve's peak). Both are rules
 * of thumb, not a medical check, and the product says neither "safe" nor "comfortable".
 */
import * as T from '@pulseframe/time';
import type { Clip } from './schema.ts';
import type { EffectInstance } from './effects.ts';
import { effectParamRange, sampleKeyframes } from './animation.ts';
import { LIVING_EFFECT, LIVING_MAX_RATE, LIVING_MAX_SHIFT, LIVING_MIN_SECONDS, LIVING_MOVES, LIVING_PEAK_SLOPE, LIVING_SPAN, type LivingCurve, type LivingMove, type LivingUnavailable } from './livingContract.ts';

type Rate = { num: number; den: number };
const fpsOf = (rate: Rate) => rate.num / rate.den;
/** Rounded DOWN to hundredths, so the figure offered always fits. */
const floor2 = (x: number) => Math.max(0, Math.min(1, Math.floor(x * 100 + 1e-9) / 100));
export const livingMoveOf = (params: Record<string, unknown>): LivingMove => ((LIVING_MOVES as readonly unknown[]).includes(params.move) ? params.move as LivingMove : 'push');

/** The clip is long enough to move at all (LIVING_MIN_SECONDS). */
export const livingLongEnough = (clipFrames: number, rate: Rate): boolean => clipFrames >= Math.ceil(LIVING_MIN_SECONDS * fpsOf(rate) - 1e-9);

/** The highest amount the keys set_living_picture writes (0 → 1 from the first to the last frame, `curve`) allow; 0..1, hundredths. */
export function livingMaxAmount(clipFrames: number, rate: Rate, move: LivingMove, curve: LivingCurve): number {
  const seconds = (clipFrames - 1) / fpsOf(rate);
  if (!(seconds > 0)) return 0;
  return floor2((LIVING_MAX_RATE * seconds) / (LIVING_MAX_SHIFT * LIVING_SPAN[move] * LIVING_PEAK_SLOPE[curve]));
}

export interface LivingComfort {
  /** The largest change of the relative shift between two consecutive frames, in frame heights per second. */
  peakRate: number;
  limit: number;
  ok: boolean;
  /** The highest amount these keys allow (1 when travel never changes). */
  maxAmount: number;
}
/**
 * The rule checked frame by frame on an instance as it is (any keys: written by the op, by hand, cut by a split or a trim). Travel
 * without keys is a still and always fits. Times are clip-local frame times (T.frameTime), sampled as animation.ts samples them.
 */
export function livingComfort(fx: Pick<EffectInstance, 'params' | 'keyframes'>, clipFrames: number, rate: Rate): LivingComfort {
  const move = livingMoveOf(fx.params);
  const amount = typeof fx.params.amount === 'number' ? fx.params.amount : 0.5;
  const keys = fx.keyframes?.travel;
  const fps = fpsOf(rate);
  let peakTravel = 0; // largest |Δu| per second
  if (keys?.length) {
    const range = effectParamRange(LIVING_EFFECT, 'travel');
    let prev = sampleKeyframes(keys, T.frameTime(0, rate), range);
    for (let k = 1; k < clipFrames; k++) {
      const u = sampleKeyframes(keys, T.frameTime(k, rate), range);
      peakTravel = Math.max(peakTravel, Math.abs(u - prev) * fps);
      prev = u;
    }
  }
  const perAmount = LIVING_MAX_SHIFT * LIVING_SPAN[move] * peakTravel; // frame heights per second at amount 1
  const peakRate = amount * perAmount;
  return { peakRate, limit: LIVING_MAX_RATE, ok: peakRate <= LIVING_MAX_RATE * (1 + 1e-9), maxAmount: perAmount > 0 ? floor2(LIVING_MAX_RATE / perAmount) : 1 };
}

/** The clip's enabled living picture, if any (at most one per clip: validate.ts living_effect). */
export const livingEffectOf = (clip: Clip): EffectInstance | undefined => (clip.effects ?? []).find((e) => e.type === LIVING_EFFECT && e.enabled);
/**
 * Why an enabled living picture on this clip cannot be drawn (verifier C6; rotated picture-in-picture is cut, decisions): the
 * compositor reports the effect unavailable with this reason (preview notice; still and export refuse) and never draws it flat.
 * null = it can be drawn (or there is no enabled living picture).
 */
export function livingUnavailable(clip: Clip): LivingUnavailable | null {
  if (!livingEffectOf(clip)) return null;
  if (clip.type !== 'media' || !clip.depth) return 'no_depth';
  if (clip.transform.rotation !== 0 || (clip.keyframes?.rotation?.length ?? 0) > 0) return 'rotated';
  return null;
}
