/**
 * Keyframe curves (ADR-0019, wave 4): the ONE definition of a keyframe, its curves (easings), the channels a key lives on,
 * the curve library, the argument schemas of the keyframe operations and their refusals. Lead-owned contract; the bodies are
 * the workers' (W1: curves.ts, keyframeChannels.ts, keyframeOps.ts, the curve branches of animation.ts, validate.ts; W2:
 * keyEdits.ts and the editor; W3: pathEdits.ts and the motion path).
 *
 * Imports zod only (and a type from ops.ts), so schema.ts and effects.ts import it without a cycle: transform keys
 * (schema.ts KeyframesSchema) and effect keys (effects.ts EffectInstanceSchema.keyframes) are this exact object.
 *
 * FIXED RULES (wave4-decisions.md, keyframes-plan.md §1–§4)
 * - No schema version bump: v3 (ADR-0018) holds. New easings and `bezier` are additive; a document without them is stored
 *   and replayed exactly as before.
 * - Handles are shape parameters, never times (ADR-0003): x is a fraction of the segment's own duration (the u of
 *   animation.ts), y a fraction of the segment's value change. Trims, splits, cuts and speed changes keep every shape.
 * - The v1 easings render with animation.ts's EASE table bit for bit and are never clamped; every other curve is clamped to
 *   its channel's range (TRANSFORM_RANGE, effects.ts paramRange).
 * - Flash rule (ADR-0009 decision 3): curves that turn back (overshoot, anticipate, bounce, spring, and a 'bezier' with y1 or y2
 *   outside [0, 1]) are refused on "light" channels: opacity (an adjustment's opacity included) and every effect parameter
 *   that is not in effects.ts modulatableParams (so colour grade values are light). They are allowed on x, y, scale,
 *   rotation and modulatable parameters.
 * - Inserting a key with set_keyframe / set_effect_keyframe into a segment whose start key has a v1 easing keeps today's
 *   rule (the new key is 'linear', the earlier key unchanged), so old op logs replay byte-identically; inside a segment with
 *   a new curve the key is placed by curves.ts splitSegment so the curve keeps its shape.
 * - 'smooth' (Steffen 1990, monotone cubic Hermite) is the one curve whose shape depends on the neighbouring keys.
 * - Every write goes through registered ops (replace_clip_keyframes of ADR-0018 for transform channels,
 *   replace_effect_keyframes for effect channels, set_keyframe_curve, set_keyframe, set_effect_keyframe); undo is the
 *   generic entity diff (the clip entity).
 * - An effect parameter name is a key of a plain record (EffectInstance.keyframes): bodies check it against
 *   effects.ts animatableParams BEFORE indexing, so a name such as "__proto__" never reaches the record.
 */
import { z } from 'zod';
import type { OpErrorCode } from './ops.ts';

/** Exact time = value / timescale seconds. Moved here from schema.ts, which re-exports it (every existing import keeps working). */
export const RationalTimeSchema = z
  .object({
    value: z.string().regex(/^-?\d+$/).describe('Integer numerator as a decimal string'),
    timescale: z.number().int().positive().describe('Ticks per second'),
  })
  .strict()
  .describe('Exact time = value / timescale seconds');
type RT = z.infer<typeof RationalTimeSchema>;

/** The transform properties a key can animate (moved from schema.ts, re-exported there). */
export const ANIMATABLE = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
export type Animatable = (typeof ANIMATABLE)[number];

/** The easings of schema v1/v2. animation.ts renders them with its EASE table, bit for bit, never clamped. */
export const V1_EASINGS = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export type V1Easing = (typeof V1_EASINGS)[number];

/** Named cubic-beziers [x1, y1, x2, y2] (CSS cubic-bezier), rendered by curves.ts cubicBezierShape. */
export const NAMED_BEZIER = {
  gentle: [0.25, 0.1, 0.25, 1],
  sharp: [0.7, 0, 0.3, 1],
  overshoot: [0.34, 1.56, 0.64, 1],
  anticipate: [0.36, 0, 0.66, -0.56],
} as const;
export type NamedBezier = keyof typeof NAMED_BEZIER;

/** Every easing a key may carry. The order is the v1 five first, then wave 4's (stable: tests and fuzz rows index it). */
export const EASINGS = [...V1_EASINGS, 'smooth', 'gentle', 'sharp', 'overshoot', 'anticipate', 'bounce', 'spring', 'bezier'] as const;
export type Easing = (typeof EASINGS)[number];
export const isV1Easing = (e: Easing): e is V1Easing => (V1_EASINGS as readonly string[]).includes(e);

/** Easings whose shape leaves [0, 1] of the change. A 'bezier' turns back iff y1 or y2 is outside [0, 1] (curves.ts turnsBack). */
export const TURN_BACK_EASINGS: readonly Easing[] = ['overshoot', 'anticipate', 'bounce', 'spring'];

/**
 * CSS cubic-bezier handles [x1, y1, x2, y2].
 * x: a fraction of the segment's own duration (0..1): a shape parameter, never a time (ADR-0003).
 * y: a fraction of the segment's value change (-1..2).
 */
export const CurveHandlesSchema = z.tuple([
  z.number().min(0).max(1), z.number().min(-1).max(2),
  z.number().min(0).max(1), z.number().min(-1).max(2),
]);
export type CurveHandles = z.infer<typeof CurveHandlesSchema>;

/** One keyframe: transform keys (schema.ts KeyframesSchema) and effect keys (effects.ts EffectInstanceSchema.keyframes) both use this object. */
export const KeyframeSchema = z
  .object({
    /** Offset from the clip start. May lie outside [0, duration): after a trim or split the curve keeps its exact shape. */
    time: RationalTimeSchema,
    value: z.number(),
    /** Shape of the segment that STARTS at this key. */
    easing: z.enum(EASINGS),
    /** The handles of a custom curve: present exactly when easing is 'bezier' (validate.ts 'keyframe_curve'). */
    bezier: CurveHandlesSchema.optional(),
  })
  .strict();
export type Keyframe = z.infer<typeof KeyframeSchema>;

/** Keys per transform property of a clip (schema.ts KeyframesSchema) and per effect parameter (effects.ts). */
export const MAX_TRANSFORM_KEYS = 2000;
export const MAX_EFFECT_KEYS = 500;

/** The declared range of a channel. Curves other than the v1 easings are clamped to it. */
export interface ValueRange { readonly min: number; readonly max: number }
/** The range of an effect parameter that declares none (effects.ts paramRange null): nothing is clamped. */
export const NO_RANGE: ValueRange = Object.freeze({ min: -Infinity, max: Infinity });

/** A keyframe channel: a transform property, or one numeric parameter of one effect instance on the clip. */
export const ChannelRefSchema = z.union([
  z.object({ property: z.enum(ANIMATABLE) }).strict(),
  z.object({ effectId: z.string().min(1).max(64), param: z.string().min(1).max(48) }).strict(),
]);
export type ChannelRef = z.infer<typeof ChannelRefSchema>;
/** A stable text key of a channel ("x", "fx_1:radius"), for maps and test ids. Use a Map with it, never a plain object. */
export const channelKey = (c: ChannelRef): string => ('property' in c ? c.property : `${c.effectId}:${c.param}`);

/**
 * The curve library, in picker order (list_catalog → curves). The names people see are i18n `curve.name.<id>` (Hebrew first;
 * nobody has reviewed them yet); `description` is the English line for agents.
 */
export interface CurveInfo {
  id: Exclude<Easing, 'bezier'>;
  /** Turns back past its end value (or before its start): refused on light channels. */
  turnsBack: boolean;
  /** The exact cubic form [x1, y1, x2, y2], when one exists (curves.ts exactHandles). */
  handles?: readonly [number, number, number, number];
  description: string;
}
export const CURVES: readonly CurveInfo[] = [
  { id: 'linear', turnsBack: false, handles: [1 / 3, 1 / 3, 2 / 3, 2 / 3], description: 'Straight: an even change from key to key.' },
  { id: 'smooth', turnsBack: false, description: 'Smooth through the keys (monotone cubic, Steffen): never goes past a key value; its shape follows the neighbouring keys.' },
  { id: 'ease-in', turnsBack: false, handles: [1 / 3, 0, 2 / 3, 0], description: 'Starts slowly and ends fast (cubic).' },
  { id: 'ease-out', turnsBack: false, handles: [1 / 3, 1, 2 / 3, 1], description: 'Starts fast and ends slowly (cubic).' },
  { id: 'ease-in-out', turnsBack: false, description: 'Slow at both ends (cubic).' },
  { id: 'gentle', turnsBack: false, handles: NAMED_BEZIER.gentle, description: 'A gentle ease, cubic-bezier(0.25, 0.1, 0.25, 1).' },
  { id: 'sharp', turnsBack: false, handles: NAMED_BEZIER.sharp, description: 'A sharp ease at both ends, cubic-bezier(0.7, 0, 0.3, 1).' },
  { id: 'overshoot', turnsBack: true, handles: NAMED_BEZIER.overshoot, description: 'Goes about 10% past the end value and settles back. Not on opacity or brightness and colour parameters.' },
  { id: 'anticipate', turnsBack: true, handles: NAMED_BEZIER.anticipate, description: 'Pulls back about 10% before it moves. Not on opacity or brightness and colour parameters.' },
  { id: 'bounce', turnsBack: true, description: 'Bounces on the end value (Penner ease-out-bounce). Not on opacity or brightness and colour parameters.' },
  { id: 'spring', turnsBack: true, description: 'A damped spring around the end value. Not on opacity or brightness and colour parameters.' },
  { id: 'hold', turnsBack: false, description: 'Keeps the value until the next key, then jumps.' },
];

// =====================================================================================================================
// The keyframe operations' arguments and outputs (bodies: keyframeOps.ts and ops.ts, W1)
// =====================================================================================================================
/**
 * public, NEW (keyframeOps.ts). The effect-parameter twin of replace_clip_keyframes (ADR-0018, shortsContract.ts), with the same
 * two forms: without from/to the whole key list of the parameter is replaced; with from/to only the keys with
 * from ≤ time ≤ to are, every new key must lie in [from, to], and the keys outside stay as they are (also keys before the clip
 * start, which a trim or split leaves). keys null removes the keys (all, or those in [from, to]); a parameter left with no
 * keys keeps the value it had at `at` (clip-local, default the clip start), as delete_effect_keyframe does.
 * Rules: a picture, title or adjustment clip; the effect exists on the clip; `param` is in animatableParams (never
 * NOT_ANIMATABLE; checked before the record is indexed); new times frame-aligned, not negative, strictly increasing;
 * values pass the effect's parameter schema (integer parameters stay integer); at most MAX_EFFECT_KEYS keys afterwards;
 * curve rules (bezier iff 'bezier'; no turn-back curve on a light parameter).
 */
export const ReplaceEffectKeyframesArgsSchema = z.object({
  clipId: z.string(),
  effectId: z.string(),
  param: z.string().min(1).max(48),
  keys: z.array(KeyframeSchema).min(1).max(MAX_EFFECT_KEYS).nullable().describe('the new keys, strictly increasing in time; null removes the keys (all of them, or those in [from, to])'),
  from: RationalTimeSchema.optional().describe('with `to`: replace only the keys in [from, to] (clip-local); every new key must lie in it'),
  to: RationalTimeSchema.optional(),
  at: RationalTimeSchema.optional().describe('clip-local time whose value a parameter keeps when it is left with no keys; default the clip start'),
}).strict();
export type ReplaceEffectKeyframesArgs = z.infer<typeof ReplaceEffectKeyframesArgsSchema>;
/** replace_effect_keyframes's output (and the range form's output of replace_clip_keyframes adds `replaced` the same way). */
export interface ReplaceEffectKeyframesOutput { keyframeCount: number; replaced: number }

/**
 * public, NEW (keyframeOps.ts). Change only the curve (easing and bezier) of existing keys: on each channel, at each time that
 * is a key, the segment after it ('after'), the one before it ('before': the previous key's easing) or both. Times that are not
 * keys of a channel are listed in `skipped`; when nothing matched it is refused (noKeysAtTimes). Channels outside
 * keyframeChannels.ts channelsFor(clip) are refused (channelNotOnClip). The flash rule applies per channel. Backs the
 * Smooth/Straight toggles, the curve picker and agents' "easing" (SPEC.md §14).
 */
export const SetKeyframeCurveArgsSchema = z.object({
  clipId: z.string(),
  channels: z.array(ChannelRefSchema).min(1).max(64),
  times: z.array(RationalTimeSchema).min(1).max(MAX_TRANSFORM_KEYS).describe('clip-local key times'),
  side: z.enum(['after', 'before', 'both']).describe("after: the segment that starts at the key; before: the one that ends there; both"),
  easing: z.enum(EASINGS),
  bezier: CurveHandlesSchema.optional().describe("the four handles, only with easing 'bezier'"),
}).strict();
export type SetKeyframeCurveArgs = z.infer<typeof SetKeyframeCurveArgsSchema>;
export interface SetKeyframeCurveOutput {
  /** Keys whose easing or handles changed. */
  changed: number;
  skipped: { channel: ChannelRef; time: RT }[];
}

/** Added to the output of set_keyframe and set_effect_keyframe: how a NEW key inside a segment was placed (curves.ts splitSegment). */
export type InsertSplit = 'none' | 'exact' | 'approximate';

/** The keyframe operations this track registers in keyframeOps.ts (set_keyframe, set_effect_keyframe stay in ops.ts). */
export const KEYFRAME_OPS = ['replace_effect_keyframes', 'set_keyframe_curve'] as const;

// ---------- refusals: code, English wording (fixed) and hint ----------
interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
const SAFE_CURVES = 'linear, smooth, ease-in, ease-out, ease-in-out, gentle, sharp or hold';
/**
 * Every refusal of the keyframe curve rules and operations. The messages are fixed: the Hebrew table recognises them by their
 * shape (packages/i18n/src/keyframesWave.ts HE_KEYFRAMES; packages/evals/src/keyframes-wording.test.ts keeps the two in step).
 * Refusals the bodies share with other edits keep those edits' words: a missing clip or effect, a locked track, a frame
 * boundary (ops.ts assertAligned), an out-of-range value (`value <v> is out of range for <p>`), a parameter that cannot be
 * animated (`"<param>" is not a numeric parameter of <type>`), an adjustment's transform (ops.ts refuseAdjustmentTransform),
 * a caption cue, unsorted keys and keys before the start (shortsContract.ts SEQUENCE_REFUSALS).
 * `notBuilt` keeps the words of SEQUENCE_REFUSALS.notBuilt on purpose (worded by the shorts table).
 */
export const KEYFRAME_REFUSALS = {
  notBuilt: refusal('unknown_op', (what: string) => `${what} is not built yet`, 'This build has the contract of this curve or operation but not its body.'),
  bezierNeedsHandles: refusal('invalid_args', () => 'a custom curve (easing "bezier") needs its four handles', 'Give bezier: [x1, y1, x2, y2] with x in 0..1 and y in -1..2, or choose a named curve.'),
  handlesNeedBezier: refusal('invalid_args', (easing: string) => `handles are given only with easing "bezier", not with "${easing}"`, 'Leave bezier out, or set easing to "bezier".'),
  curveFlash: refusal('invalid_args', (easing: string, channel: string) => `the curve "${easing}" goes back and forth past its end value, which is not allowed on ${channel}: a change of brightness that turns back is a flash`, `Use a curve that does not turn back (${SAFE_CURVES}). Overshoot, anticipate, bounce and spring are allowed on position, size, rotation and on parameters that may follow the beat.`),
  channelNotOnClip: refusal('incompatible', (channel: string) => `this clip has no keyframe channel ${channel}`, 'An adjustment clip takes opacity and effect parameters only; a sound clip and a caption cue take none.'),
  rangeHalf: refusal('invalid_args', () => 'give both from and to, or neither'),
  rangeReversed: refusal('invalid_args', () => 'from must not be after to'),
  keyOutsideRange: refusal('out_of_bounds', (index: number) => `new keyframe ${index} lies outside from…to`, 'Every new key of the range form lies between from and to (both included).'),
  tooManyKeys: refusal('out_of_bounds', (max: number) => `a channel holds at most ${max} keyframes`, 'Use fewer keys, or remove keys elsewhere on this channel first.'),
  noKeysAtTimes: refusal('not_found', () => 'none of these times is a keyframe of these channels', 'Pass the clip-local times of existing keys (get_timeline lists them).'),
} as const;
export type KeyframeRefusalKey = keyof typeof KEYFRAME_REFUSALS;
/** The words a channel is named by inside a refusal: the property, or `<type>.<param>` of the effect. */
export const channelWords = (c: ChannelRef, effectType?: string): string => ('property' in c ? c.property : `${effectType ?? c.effectId}.${c.param}`);
/** The summaries of the keyframe operations (history and events), fixed like the refusals. */
export const KEYFRAME_SUMMARIES = {
  effectKeys: (channel: string, count: number) => (count ? `Replaced the ${channel} keyframes (${count})` : `Cleared the ${channel} keyframes`),
  curve: (easing: string, changed: number) => `Curve ${easing} on ${changed} keyframe(s)`,
} as const;
