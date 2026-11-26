/**
 * The keyframe channels a clip may carry, and the per-channel facts the curve rules need (ADR-0019, W1 bodies; the lead's
 * contracts commit fixes the signatures).
 *
 * Kept OUT of keyframeOps.ts on purpose: ops.ts (set_keyframe, set_effect_keyframe, placeMotion) needs isLightChannel and
 * channelRange, and keyframeOps.ts imports ops.ts (defineOp) — an import of keyframeOps.ts from ops.ts would evaluate its
 * defineOp calls before ops.ts's registry exists. This module imports no op module, so ops.ts, keyframeOps.ts, keyEdits.ts
 * and pathEdits.ts all import it.
 *
 * W1 (ADR-0019): built.
 */
import { ANIMATABLE, type Clip, type Track } from './schema.ts';
import { NO_RANGE, type ChannelRef, type Keyframe, type ValueRange } from './keyframe.ts';
import { animatableParams, modulatableParams } from './effects.ts';
import { effectParamRange, TRANSFORM_RANGE } from './animation.ts';

const effectOf = (clip: Clip, effectId: string) => (clip.effects ?? []).find((e) => e.id === effectId);

/**
 * The channels a clip may carry, transform channels first (in ANIMATABLE order), then each effect's animatable parameters in
 * effect order:
 * - a title, and a media clip on a video track: the five transform channels (as animate_clip, ops.ts);
 * - an adjustment clip: opacity only (validate.ts adjustment_transform, ops.ts refuseAdjustmentTransform);
 * - a caption cue, and a clip on a sound track: none;
 * - every effect instance on a picture, title or adjustment clip: effects.ts animatableParams(type), never NOT_ANIMATABLE.
 * This is the gate of set_keyframe_curve, the range writes of the editor (keyEdits.ts) and the K key.
 */
export function channelsFor(clip: Clip, track: Track): ChannelRef[] {
  if (clip.type === 'caption' || track.kind === 'audio' || track.kind === 'caption') return [];
  const out: ChannelRef[] = clip.type === 'adjustment' ? [{ property: 'opacity' }]
    : clip.type === 'text' || clip.type === 'drawn' || (clip.type === 'media' && track.kind === 'video') ? ANIMATABLE.map((property) => ({ property })) : [];
  for (const fx of clip.effects ?? []) for (const param of animatableParams(fx.type)) out.push({ effectId: fx.id, param });
  return out;
}
/** The keys of one channel ([] when it has none, or the effect is gone). Effect parameters are looked up with Object.hasOwn. */
export function channelKeys(clip: Clip, ch: ChannelRef): readonly Keyframe[] {
  if ('property' in ch) return clip.keyframes?.[ch.property] ?? [];
  const kf = effectOf(clip, ch.effectId)?.keyframes;
  return kf && Object.hasOwn(kf, ch.param) ? kf[ch.param]! : [];
}
/** The channel's declared range: animation.ts TRANSFORM_RANGE[property], or effectParamRange(type, param). */
export function channelRange(clip: Clip, ch: ChannelRef): ValueRange {
  if ('property' in ch) return TRANSFORM_RANGE[ch.property];
  const fx = effectOf(clip, ch.effectId);
  return fx ? effectParamRange(fx.type, ch.param) : NO_RANGE;
}
/** Opacity (also an adjustment's), and every effect parameter not in effects.ts modulatableParams: turn-back curves are refused on these. */
export function isLightChannel(clip: Clip, ch: ChannelRef): boolean {
  if ('property' in ch) return ch.property === 'opacity';
  const fx = effectOf(clip, ch.effectId);
  // an effect that is not on the clip has no modulatable parameter: light, the stricter answer
  return !fx || !modulatableParams(fx.type).includes(ch.param);
}
