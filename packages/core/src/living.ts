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
import * as T from '@pulseframe/time';
import type { Clip } from './schema.ts';
import type { Keyframe } from './keyframe.ts';
import { MOTION_PRESETS, motionKeys, type MotionKey, type MotionProperty } from './motionPresets.ts';
import { LIVING_EFFECT, type LivingCurve } from './livingContract.ts';
import { livingEffectOf, livingMoveOf, livingUnavailable } from './livingComfort.ts';

export function livingTravelKeys(clipFrames: number, rate: T.Rate, curve: LivingCurve): Keyframe[] {
  return [
    { time: T.frameTime(0, rate), value: 0, easing: curve },
    { time: T.frameTime(Math.max(1, clipFrames - 1), rate), value: 1, easing: 'linear' },
  ];
}

export interface ReplacedMotion { properties: MotionProperty[]; presetIds: string[] }
/** How close a stored key value must be to the preset's own to count as the same key (floating point of the amount fit only). */
const SAME = 1e-9;
const same = (a: number, b: number) => Math.abs(a - b) <= SAME * Math.max(1, Math.abs(b));
/** Presets with more properties first, so a push with tilt is not read as a Ken Burns on its scale alone. */
const MOVES = MOTION_PRESETS.filter((m) => m.kind === 'move').sort((a, b) => b.properties.length - a.properties.length);
/**
 * The body (W1). A whole-clip move is recognised only when, for EVERY property the preset writes, the clip's keys are exactly the
 * keys apply_motion_preset would write now: motionKeys(preset, {totalFrames: the clip's whole frames, rest: the clip's transform,
 * amount}) — the same count, the same frame-aligned times (T.cmp = 0), the same easings, values equal within 1e-9 (relative). The
 * amount (0..2) is read back from the key that deviates most from rest (keys are linear in the amount), then checked on every key.
 * A clip trimmed after the move, a changed resting transform, an entrance on the same property, a key moved by hand: not a match.
 */
export function livingReplacedMotion(clip: Clip, rate: T.Rate): ReplacedMotion {
  const none: ReplacedMotion = { properties: [], presetIds: [] };
  if (clip.type === 'caption' || !clip.keyframes) return none;
  const kf = clip.keyframes;
  const totalFrames = T.frameIndexAt(clip.duration, rate);
  if (totalFrames < 2) return none;
  const rest = clip.transform;
  const matches = (keys: readonly Keyframe[] | undefined, want: readonly MotionKey[]) =>
    !!keys && keys.length === want.length && keys.every((k, i) => !k.bezier && k.easing === want[i]!.easing && T.cmp(k.time, T.frameTime(want[i]!.frame, rate)) === 0 && same(k.value, want[i]!.value));
  for (const m of MOVES) {
    const props = m.properties;
    if (!props.every((p) => kf[p]?.length)) continue;
    const one = motionKeys(m.id, { totalFrames, rest, amount: 1 }), zero = motionKeys(m.id, { totalFrames, rest, amount: 0 });
    let best = { dev: 0, amount: NaN };
    for (const p of props) (one[p] ?? []).forEach((k, i) => {
      const z = zero[p]?.[i], have = kf[p]?.[i];
      if (!z || !have) return;
      const dev = Math.abs(k.value - z.value);
      if (dev > best.dev) best = { dev, amount: (have.value - z.value) / (k.value - z.value) };
    });
    if (!(best.dev > 0) || !(best.amount >= -SAME && best.amount <= 2 + SAME)) continue;
    const amount = Math.min(2, Math.max(0, best.amount));
    const want = motionKeys(m.id, { totalFrames, rest, amount });
    if (props.every((p) => matches(kf[p], want[p] ?? []))) return { properties: [...props], presetIds: [m.id] };
  }
  return none;
}

/**
 * One line per living picture for agents (get_summary, describe_moment): "living picture: push, amount 0.5; depth: drawn (3 strokes)",
 * with "(off)" when bypassed and "; not shown: no drawn depth|rotated" when the compositor reports it unavailable. null = none on
 * the clip. A description of the document only: nobody has looked at the result.
 */
export function livingSummaryLine(clip: Clip): string | null {
  const fx = (clip.effects ?? []).find((e) => e.type === LIVING_EFFECT);
  if (!fx) return null;
  const amount = typeof fx.params.amount === 'number' ? fx.params.amount : 0.5;
  const depth = clip.type === 'media' && clip.depth ? `drawn (${clip.depth.strokes.length} stroke${clip.depth.strokes.length === 1 ? '' : 's'}, ${clip.depth.base.kind === 'ramp' ? `horizon ${clip.depth.base.horizon}/1000` : 'flat base'})` : 'none';
  const why = livingEffectOf(clip) ? livingUnavailable(clip) : null;
  return `living picture${fx.enabled ? '' : ' (off)'}: ${livingMoveOf(fx.params)}, amount ${amount}; depth: ${depth}${why ? `; not shown: ${why === 'no_depth' ? 'no drawn depth' : 'rotated'}` : ''}`;
}
