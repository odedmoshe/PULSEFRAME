/**
 * The keyframe channels a clip may carry, and the per-channel facts the curve rules need (ADR-0019, W1 bodies; the lead's
 * contracts commit fixes the signatures).
 *
 * Kept OUT of keyframeOps.ts on purpose: ops.ts (set_keyframe, set_effect_keyframe, placeMotion) needs isLightChannel and
 * channelRange, and keyframeOps.ts imports ops.ts (defineOp) — an import of keyframeOps.ts from ops.ts would evaluate its
 * defineOp calls before ops.ts's registry exists. This module imports no op module, so ops.ts, keyframeOps.ts, keyEdits.ts
 * and pathEdits.ts all import it.
 *
 * PLACEHOLDERS: every function refuses ("… is not built yet") until W1 fills it.
 */
import type { Clip, Track } from './schema.ts';
import type { ChannelRef, Keyframe, ValueRange } from './keyframe.ts';

const notBuilt = (what: string): never => { throw new Error(`${what} is not built yet (ADR-0019 W1)`); };

/**
 * The channels a clip may carry, transform channels first (in ANIMATABLE order), then each effect's animatable parameters in
 * effect order:
 * - a title, and a media clip on a video track: the five transform channels (as animate_clip, ops.ts);
 * - an adjustment clip: opacity only (validate.ts adjustment_transform, ops.ts refuseAdjustmentTransform);
 * - a caption cue, and a clip on a sound track: none;
 * - every effect instance on a picture, title or adjustment clip: effects.ts animatableParams(type), never NOT_ANIMATABLE.
 * This is the gate of set_keyframe_curve, the range writes of the editor (keyEdits.ts) and the K key.
 */
export function channelsFor(clip: Clip, track: Track): ChannelRef[] { void clip; void track; return notBuilt('channelsFor'); }
/** The keys of one channel ([] when it has none, or the effect is gone). Effect parameters are looked up with Object.hasOwn. */
export function channelKeys(clip: Clip, ch: ChannelRef): readonly Keyframe[] { void clip; void ch; return notBuilt('channelKeys'); }
/** The channel's declared range: animation.ts TRANSFORM_RANGE[property], or effectParamRange(type, param). */
export function channelRange(clip: Clip, ch: ChannelRef): ValueRange { void clip; void ch; return notBuilt('channelRange'); }
/** Opacity (also an adjustment's), and every effect parameter not in effects.ts modulatableParams: turn-back curves are refused on these. */
export function isLightChannel(clip: Clip, ch: ChannelRef): boolean { void clip; void ch; return notBuilt('isLightChannel'); }
