/**
 * The move keys of «תמונה חיה» (wave 8 living; livingContract.ts). Bodies are W1's; the signatures are the contract.
 *
 * livingTravelKeys(clipFrames, rate, curve): the `travel` keys set_living_picture writes — {time: frame 0, value 0, easing: curve}
 * and {time: frame clipFrames − 1, value 1, easing: 'linear'}, both clip-local frame times built with T.frameTime (never float
 * seconds). A trim later keeps them exactly (the move ends earlier; it never speeds up).
 *
 * livingReplacedMotion(clip, rate): which of the clip's transform keys are a whole-clip move (motion.move.*, Ken Burns and pans,
 * motionPresets.ts) that the living picture replaces in the same transaction (verifier C3), as the properties to clear and the
 * preset ids recognised; keys that are not such a move (an entrance, an exit, a loop, keys by hand) are left as they are.
 */
import type * as T from '@pulseframe/time';
import type { Clip } from './schema.ts';
import type { Keyframe } from './keyframe.ts';
import type { MotionProperty } from './motionPresets.ts';
import { LivingNotBuiltError, type LivingCurve } from './livingContract.ts';

export function livingTravelKeys(clipFrames: number, rate: T.Rate, curve: LivingCurve): Keyframe[] {
  void clipFrames; void rate; void curve;
  throw new LivingNotBuiltError('livingTravelKeys');
}

export interface ReplacedMotion { properties: MotionProperty[]; presetIds: string[] }
export function livingReplacedMotion(clip: Clip, rate: T.Rate): ReplacedMotion {
  void clip; void rate;
  throw new LivingNotBuiltError('livingReplacedMotion');
}
