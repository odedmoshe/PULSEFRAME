/**
 * The keyframe operations of ADR-0019: replace_effect_keyframes and set_keyframe_curve (public, version 1). Registered on import
 * of this module (packages/core/src/index.ts exports it); they run only through applyTransaction.
 *
 * The lead's contract fixes the names, versions, descriptions and argument schemas (keyframe.ts
 * ReplaceEffectKeyframesArgsSchema, SetKeyframeCurveArgsSchema), the outputs, and every refusal with its code, English wording
 * and hint (keyframe.ts KEYFRAME_REFUSALS; the Hebrew wording is packages/i18n/src/keyframesWave.ts HE_KEYFRAMES).
 * KEYFRAME_OPS_BUILT turns the fuzz rows on.
 *
 * RULES OF THE BODIES (W1; keyframe.ts and keyframes-plan.md §3)
 * - replace_effect_keyframes: ops.ts mustClip + the picture rule of the effect ops (a caption cue or a sound clip is refused in
 *   their words); the effect must exist (`effect <id> not found on clip <clip>`); `param` must be in animatableParams(type)
 *   before fx.keyframes is indexed (`"<param>" is not a numeric parameter of <type>`); from/to both or neither (rangeHalf),
 *   from ≤ to (rangeReversed); new keys frame-aligned (assertAligned), not negative (SEQUENCE_REFUSALS.keyBeforeStart),
 *   strictly increasing (keysNotIncreasing), inside [from, to] (keyOutsideRange), values through the effect's parameter
 *   schema (integer parameters stay integer); at most MAX_EFFECT_KEYS afterwards (tooManyKeys); the curve rules
 *   (bezierNeedsHandles, handlesNeedBezier, curveFlash on a light parameter). A parameter left with no keys takes the value it
 *   had at `at` (default the clip start) as its static value, and an emptied keyframes record is deleted. Output
 *   ReplaceEffectKeyframesOutput. Summary KEYFRAME_SUMMARIES.effectKeys.
 * - set_keyframe_curve: mustClip; every channel in keyframeChannels.ts channelsFor(clip, track) (channelNotOnClip); the curve
 *   rules per channel; per channel and time: a key at that time → its easing (side 'after'/'both') and/or the previous key's
 *   (side 'before'/'both') becomes `easing` with `bezier` iff 'bezier' (a named easing drops handles); a time with no key →
 *   `skipped`; nothing matched → noKeysAtTimes. Output SetKeyframeCurveOutput. Summary KEYFRAME_SUMMARIES.curve.
 * - Undo is the generic entity diff of the clip (restore_entities): no inverse is stored in the output.
 */
import { defineOp, keyframeRefusal } from './ops.ts';
import { ReplaceEffectKeyframesArgsSchema, SetKeyframeCurveArgsSchema } from './keyframe.ts';

/** True once W1 has built the bodies (and curves.ts CURVES_BUILT): the operations fuzz (ops-fuzz.gen.ts) then draws the keyframe rows. */
export const KEYFRAME_OPS_BUILT = false;

defineOp({
  name: 'replace_effect_keyframes',
  version: 1,
  description: 'Replace the keyframes of one numeric effect parameter of a clip in one step, with the rules of set_effect_keyframe: times are clip-local, frame-aligned, not negative and strictly increasing; at most 500 keys. Without from/to the whole key list is replaced; with from and to only the keys between them (both included) are, every new key must lie there, and the other keys stay. keys null removes the keys (all, or those in the range); a parameter left without keys keeps the value it had at `at` (default the clip start). Keys may carry any curve of list_catalog → curves; curves that turn back are refused on parameters that are not modulatable (brightness and colour).',
  args: ReplaceEffectKeyframesArgsSchema,
  apply(_d, a) {
    throw keyframeRefusal('notBuilt', { clipId: a.clipId }, 'replace_effect_keyframes');
  },
});

defineOp({
  name: 'set_keyframe_curve',
  version: 1,
  description: "Change only the curve of existing keyframes: on each channel ({property} or {effectId, param}) and at each clip-local time that is a key, the segment after the key (side 'after'), the one before it ('before') or both. easing is one of list_catalog → curves, or 'bezier' with four handles [x1, y1, x2, y2]. Times that are not keys are listed in `skipped`. Curves that turn back (overshoot, anticipate, bounce, spring, or a custom curve with y outside 0..1) are refused on opacity and on effect parameters that are not modulatable.",
  args: SetKeyframeCurveArgsSchema,
  apply(_d, a) {
    throw keyframeRefusal('notBuilt', { clipId: a.clipId }, 'set_keyframe_curve');
  },
});
