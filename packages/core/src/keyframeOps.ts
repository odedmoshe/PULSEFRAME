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
import * as T from '@pulseframe/time';
import { assertAligned, assertKeyCurve, defineOp, keyframeRefusal, mustClip, mustEffect, OpError, parseEffect, pictureClip, storedKey } from './ops.ts';
import { channelKey, channelWords, KEYFRAME_SUMMARIES, MAX_EFFECT_KEYS, ReplaceEffectKeyframesArgsSchema, SetKeyframeCurveArgsSchema, type ChannelRef, type CurveHandles, type Keyframe, type ReplaceEffectKeyframesOutput, type SetKeyframeCurveOutput } from './keyframe.ts';
import { animatableParams } from './effects.ts';
import { effectParamRange, sampleKeyframes } from './animation.ts';
import { channelKeys, channelsFor, isLightChannel } from './keyframeChannels.ts';
import { sequenceRefusal } from './shortsContract.ts';

/** True once W1 has built the bodies (and curves.ts CURVES_BUILT): the operations fuzz (ops-fuzz.gen.ts) then draws the keyframe rows. */
export const KEYFRAME_OPS_BUILT = true;

defineOp({
  name: 'replace_effect_keyframes',
  version: 1,
  description: 'Replace the keyframes of one numeric effect parameter of a clip in one step, with the rules of set_effect_keyframe: times are clip-local, frame-aligned, not negative and strictly increasing; at most 500 keys. Without from/to the whole key list is replaced; with from and to only the keys between them (both included) are, every new key must lie there, and the other keys stay. keys null removes the keys (all, or those in the range); a parameter left without keys keeps the value it had at `at` (default the clip start). Keys may carry any curve of list_catalog → curves; curves that turn back are refused on parameters that are not modulatable (brightness and colour).',
  args: ReplaceEffectKeyframesArgsSchema,
  apply(d, a) {
    const { clip } = pictureClip(d, a.clipId);
    const i = mustEffect(clip, a.effectId);
    const fx = { ...clip.effects![i]! };
    // the allowlist first: a name such as "__proto__" never reaches the record below
    if (!animatableParams(fx.type).includes(a.param)) throw new OpError('invalid_args', `"${a.param}" is not a numeric parameter of ${fx.type}`, { animatable: animatableParams(fx.type) });
    if ((a.from === undefined) !== (a.to === undefined)) throw keyframeRefusal('rangeHalf', { clipId: clip.id });
    const range = a.from && a.to ? { from: a.from, to: a.to } : null;
    if (range && T.lt(range.to, range.from)) throw keyframeRefusal('rangeReversed', { clipId: clip.id, from: range.from, to: range.to });
    const ch = { effectId: fx.id, param: a.param };
    const words = channelWords(ch, fx.type);
    const old = channelKeys(clip, ch);
    const inRange = (t: T.RationalTime) => !range || (T.lte(range.from, t) && T.lte(t, range.to));
    const kept = range ? old.filter((k) => !inRange(k.time)).map((k) => storedKey(k.time, k.value, k.easing, k.bezier)) : [];
    const replaced = old.length - kept.length;
    let next: Keyframe[] = kept;
    if (a.keys !== null) {
      const light = isLightChannel(clip, ch);
      const fresh: Keyframe[] = [];
      for (const [n, k] of a.keys.entries()) {
        assertAligned(d, k.time, `keyframe ${n + 1} time`);
        if (T.isNegative(k.time)) throw sequenceRefusal('keyBeforeStart', { index: n, time: k.time });
        if (n > 0 && !T.lt(a.keys[n - 1]!.time, k.time)) throw sequenceRefusal('keysNotIncreasing', { index: n });
        if (!inRange(k.time)) throw keyframeRefusal('keyOutsideRange', { index: n, time: k.time, from: range!.from, to: range!.to }, n + 1);
        parseEffect(fx.type, { ...fx.params, [a.param]: k.value }); // range check; integer parameters stay integer
        assertKeyCurve(k, light, words, { clipId: clip.id, effectId: fx.id, param: a.param, index: n });
        fresh.push(storedKey(k.time, k.value, k.easing, k.bezier));
      }
      next = [...kept, ...fresh].sort((x, y) => T.cmp(x.time, y.time));
      if (next.length > MAX_EFFECT_KEYS) throw keyframeRefusal('tooManyKeys', { clipId: clip.id, effectId: fx.id, param: a.param, keyframes: next.length }, MAX_EFFECT_KEYS);
    }
    const out: ReplaceEffectKeyframesOutput = { keyframeCount: next.length, replaced };
    if (!replaced && !next.length) return { affectedIds: [], summary: KEYFRAME_SUMMARIES.effectKeys(words, 0), output: { ...out } };
    const kf: Record<string, Keyframe[]> = { ...fx.keyframes };
    if (next.length) kf[a.param] = next;
    else {
      // a parameter left without keys keeps the value it had at `at`, as one of its own values (an integer stays an integer)
      const v = sampleKeyframes(old, a.at ?? T.ZERO, effectParamRange(fx.type, a.param));
      const fits = (x: number) => { try { parseEffect(fx.type, { ...fx.params, [a.param]: x }); return true; } catch { return false; } };
      fx.params = { ...fx.params, [a.param]: fits(v) ? v : Math.round(v) };
      delete kf[a.param];
    }
    if (Object.keys(kf).length) fx.keyframes = kf; else delete fx.keyframes;
    clip.effects = clip.effects!.map((e, n) => (n === i ? fx : e));
    return { affectedIds: [clip.id], summary: KEYFRAME_SUMMARIES.effectKeys(words, next.length), output: { ...out } };
  },
});

defineOp({
  name: 'set_keyframe_curve',
  version: 1,
  description: "Change only the curve of existing keyframes: on each channel ({property} or {effectId, param}) and at each clip-local time that is a key, the segment after the key (side 'after'), the one before it ('before') or both. easing is one of list_catalog → curves, or 'bezier' with four handles [x1, y1, x2, y2]. Times that are not keys are listed in `skipped`. Curves that turn back (overshoot, anticipate, bounce, spring, or a custom curve with y outside 0..1) are refused on opacity and on effect parameters that are not modulatable.",
  args: SetKeyframeCurveArgsSchema,
  apply(d, a) {
    const { clip, track } = mustClip(d, a.clipId);
    const allowed = new Set(channelsFor(clip, track).map(channelKey));
    const typeOf = (c: ChannelRef) => ('property' in c ? undefined : clip.effects?.find((e) => e.id === c.effectId)?.type);
    const curve: { easing: typeof a.easing; bezier?: CurveHandles } = a.bezier !== undefined ? { easing: a.easing, bezier: a.bezier } : { easing: a.easing };
    const channels = [...new Map(a.channels.map((c) => [channelKey(c), c] as const)).values()];
    for (const c of channels) {
      const words = channelWords(c, typeOf(c));
      if (!allowed.has(channelKey(c))) throw keyframeRefusal('channelNotOnClip', { clipId: clip.id, channel: c }, words);
      assertKeyCurve(curve, isLightChannel(clip, c), words, { clipId: clip.id, channel: c });
    }
    for (const t of a.times) assertAligned(d, t, 'time');
    const skipped: SetKeyframeCurveOutput['skipped'] = [];
    let changed = 0, matched = 0;
    const set = (keys: Keyframe[], j: number) => {
      const k = keys[j]!;
      const next = storedKey(k.time, k.value, curve.easing, curve.bezier);
      if (k.easing !== next.easing || JSON.stringify(k.bezier) !== JSON.stringify(next.bezier)) { keys[j] = next; changed++; }
    };
    for (const c of channels) {
      const keys = channelKeys(clip, c).map((k) => storedKey(k.time, k.value, k.easing, k.bezier));
      const before = changed;
      for (const t of a.times) {
        const j = keys.findIndex((k) => T.eq(k.time, t));
        if (j < 0) { skipped.push({ channel: c, time: t }); continue; }
        matched++;
        if (a.side !== 'before') set(keys, j);
        if (a.side !== 'after' && j > 0) set(keys, j - 1);
      }
      if (changed === before) continue;
      if ('property' in c) clip.keyframes = { ...clip.keyframes, [c.property]: keys };
      else clip.effects = clip.effects!.map((e) => (e.id === c.effectId ? { ...e, keyframes: { ...e.keyframes, [c.param]: keys } } : e));
    }
    if (!matched) throw keyframeRefusal('noKeysAtTimes', { clipId: clip.id, skipped: skipped.slice(0, 16) });
    const out: SetKeyframeCurveOutput = { changed, skipped };
    return { affectedIds: changed ? [clip.id] : [], summary: KEYFRAME_SUMMARIES.curve(a.easing, changed), output: { ...out } };
  },
});
