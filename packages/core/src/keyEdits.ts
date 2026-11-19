/**
 * Key edits of the editor (ADR-0019, W2): pure functions from a gesture on the keyframe strip, the curve picker or the
 * clipboard to the operations that make it. The editor calls them inside commit(() => …) (apps/web/src/editor/store.ts), so
 * they read the clip as it is when the edit's turn comes.
 *
 * Writes: transform channels through replace_clip_keyframes in its RANGE form (shortsContract.ts; from/to, so keys outside the
 * range, also those before the clip start that a trim or split left, are kept), effect channels through
 * replace_effect_keyframes (keyframe.ts), curves through set_keyframe_curve. Every function returns at most one op per channel
 * (curveOps: one per group of channels that share the same key times, see there); the caller commits them as one transaction
 * (one undo step). Keys are identified by clip-local FRAME index (KeyRef); a key's time is an exact rational on that frame.
 *
 * Channels: the helpers `carriedChannels`, `keysOf`, `isLightChannel2` and `rangeOf` below state the same rules as
 * keyframeChannels.ts (channelsFor, channelKeys, isLightChannel, channelRange). They are written out here, over the same
 * registries (effects.ts animatableParams, modulatableParams, animation.ts ranges), so this module and its tests do not depend
 * on bodies that another worker builds in parallel; once keyframeChannels.ts is built they must agree with it (the web tests
 * of KeyStrip and the picker compare them, keyEdits.test.ts "agrees with keyframeChannels once it is built").
 */
import * as T from '@pulseframe/time';
import type { OpCall } from './ops.ts';
import type { Clip, Track } from './schema.ts';
import { ANIMATABLE, MAX_EFFECT_KEYS, MAX_TRANSFORM_KEYS, channelKey, type ChannelRef, type CurveHandles, type Easing, type Keyframe, type ValueRange } from './keyframe.ts';
import { TRANSFORM_RANGE, effectParamRange } from './animation.ts';
import { animatableParams, modulatableParams } from './effects.ts';

// ---------- channels (the rules of keyframeChannels.ts, over the same registries) ----------
type EffectCarrier = Exclude<Clip, { type: 'caption' }>;
const hasEffects = (c: Clip): c is EffectCarrier => c.type !== 'caption';
const effectOf = (clip: Clip, effectId: string) => (hasEffects(clip) ? (clip.effects ?? []).find((e) => e.id === effectId) : undefined);

/**
 * The channels a clip may carry, transform channels first (ANIMATABLE order), then each effect's animatable parameters in effect
 * order: a title and a media clip off the sound tracks carry the five transform channels, an adjustment clip opacity only, a
 * caption cue and a sound clip none; every effect instance of a picture, title or adjustment clip carries its animatable params.
 */
export function carriedChannels(clip: Clip, track: Track): ChannelRef[] {
  if (clip.type === 'caption' || track.kind === 'audio') return [];
  const out: ChannelRef[] = (clip.type === 'adjustment' ? (['opacity'] as const) : ANIMATABLE).map((property) => ({ property }));
  for (const fx of clip.effects ?? []) for (const param of animatableParams(fx.type)) out.push({ effectId: fx.id, param });
  return out;
}
/** The keys of one channel ([] when it has none or the effect is gone). Effect parameters are looked up with Object.hasOwn. */
export function keysOf(clip: Clip, ch: ChannelRef): readonly Keyframe[] {
  if (clip.type === 'caption') return [];
  if ('property' in ch) return Object.hasOwn(clip.keyframes ?? {}, ch.property) ? clip.keyframes?.[ch.property] ?? [] : [];
  const fx = effectOf(clip, ch.effectId);
  const map = fx?.keyframes;
  return map && Object.hasOwn(map, ch.param) ? map[ch.param] ?? [] : [];
}
/** Opacity (also an adjustment's) and every effect parameter that may not follow the beat: turn-back curves are refused there. */
export function isLightChannel2(clip: Clip, ch: ChannelRef): boolean {
  if ('property' in ch) return ch.property === 'opacity';
  const fx = effectOf(clip, ch.effectId);
  return !fx || !modulatableParams(fx.type).includes(ch.param);
}
/** The channel's declared range (a transform property's, or the effect parameter's schema range). */
export function rangeOf(clip: Clip, ch: ChannelRef): ValueRange {
  if ('property' in ch) return TRANSFORM_RANGE[ch.property];
  const fx = effectOf(clip, ch.effectId);
  return fx ? effectParamRange(fx.type, ch.param) : effectParamRange('', ch.param);
}
const sameChannel = (a: ChannelRef, b: ChannelRef) => channelKey(a) === channelKey(b);
const frameOf = (k: Keyframe, rate: T.Rate) => T.frameIndexAt(k.time, rate);
const frameCountOf = (clip: Clip, rate: T.Rate) => T.frameIndexAt(clip.duration, rate);
const copyKey = (k: Keyframe, time: T.RationalTime = k.time): Keyframe => ({ time, value: k.value, easing: k.easing, ...(k.bezier ? { bezier: [...k.bezier] as unknown as CurveHandles } : {}) });
const maxKeys = (ch: ChannelRef) => ('property' in ch ? MAX_TRANSFORM_KEYS : MAX_EFFECT_KEYS);

/** One range write of one channel: the keys in [from, to] (clip-local) become `keys` (null: none), the others stay. */
function rangeWrite(clip: Clip, ch: ChannelRef, keys: Keyframe[] | null, from: T.RationalTime, to: T.RationalTime, at?: T.RationalTime): OpCall {
  const rest = { keys, from, to, ...(keys === null && at ? { at } : {}) };
  return 'property' in ch
    ? { op: 'replace_clip_keyframes', args: { clipId: clip.id, property: ch.property, ...rest } }
    : { op: 'replace_effect_keyframes', args: { clipId: clip.id, effectId: ch.effectId, param: ch.param, ...rest } };
}

/** The keys of the selection grouped by channel (a key listed twice counts once; a frame with no key on the channel is ignored). */
function byChannel(clip: Clip, rate: T.Rate, sel: readonly KeyRef[]): { channel: ChannelRef; keys: readonly Keyframe[]; frames: Set<number> }[] {
  const groups = new Map<string, { channel: ChannelRef; keys: readonly Keyframe[]; frames: Set<number> }>();
  for (const r of sel) {
    const id = channelKey(r.channel);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { channel: r.channel, keys: keysOf(clip, r.channel), frames: new Set() }));
    if (g.keys.some((k) => frameOf(k, rate) === r.frame)) g.frames.add(r.frame);
  }
  return [...groups.values()].filter((g) => g.frames.size > 0);
}

// ---------- reading ----------
/** One key of one channel, by clip-local frame index (may be < 0 or ≥ the clip's frame count: keys a trim or split left). */
export interface KeyRef { channel: ChannelRef; frame: number }
/** The keys at one clip-local frame, across channels (transform and effect). `inside`: 0 ≤ frame < the clip's frame count. */
export interface KeyAt { frame: number; channels: ChannelRef[]; easings: Easing[]; inside: boolean }
/**
 * Every keyed frame of the clip, ascending, aggregated by EXACT frame (T.frameIndexAt of the key time), effect keys included.
 * Only channels the clip carries count (carriedChannels), so inert keys on a parameter that cannot be animated are not shown.
 */
export function keyTimes(clip: Clip, track: Track, rate: T.Rate): KeyAt[] {
  const count = frameCountOf(clip, rate);
  const at = new Map<number, KeyAt>();
  for (const ch of carriedChannels(clip, track)) {
    for (const k of keysOf(clip, ch)) {
      const frame = frameOf(k, rate);
      let a = at.get(frame);
      if (!a) at.set(frame, (a = { frame, channels: [], easings: [], inside: frame >= 0 && frame < count }));
      if (a.channels.some((c) => sameChannel(c, ch))) continue; // two keys of one channel on one frame (not frame-aligned): the first
      a.channels.push(ch);
      a.easings.push(k.easing);
    }
  }
  return [...at.values()].sort((x, y) => x.frame - y.frame);
}

// ---------- move ----------
export type MoveResult = { ops: OpCall[] } | { refused: 'crosses_key' | 'lands_on_key'; channel: ChannelRef };
/**
 * Move the selected keys by `deltaFrames`, counted from their ORIGINAL positions (a drag recomputes from the start each time).
 * One range write per channel over [min(old, new), max(old, new)]. Crossing or landing on an unselected key is refused.
 *
 * Only keys inside the clip move; the move is clamped so that none leaves [0, frame count − 1] (a key before the clip start
 * would be refused by the operation, and the strip draws keys inside the clip). Keys outside the clip stay where they are.
 * Nothing to do (delta 0 after the clamp, or no selected key) gives `{ ops: [] }`.
 */
export function moveKeysOps(clip: Clip, track: Track, rate: T.Rate, sel: readonly KeyRef[], deltaFrames: number): MoveResult {
  const count = frameCountOf(clip, rate);
  const carried = new Set(carriedChannels(clip, track).map(channelKey));
  const groups = byChannel(clip, rate, sel).filter((g) => carried.has(channelKey(g.channel))).map((g) => ({ ...g, frames: new Set([...g.frames].filter((f) => f >= 0 && f < count)) })).filter((g) => g.frames.size > 0);
  if (!groups.length || !Number.isFinite(deltaFrames)) return { ops: [] };
  const all = groups.flatMap((g) => [...g.frames]);
  const lo = Math.min(...all), hi = Math.max(...all);
  const delta = Math.max(-lo, Math.min(count - 1 - hi, Math.round(deltaFrames)));
  if (delta === 0) return { ops: [] };
  const ops: OpCall[] = [];
  for (const g of groups) {
    const others = g.keys.filter((k) => !g.frames.has(frameOf(k, rate)));
    for (const f of g.frames) {
      const dest = f + delta;
      for (const o of others) {
        const of = frameOf(o, rate);
        if (of === dest) return { refused: 'lands_on_key', channel: g.channel };
        if (delta > 0 ? of > f && of < dest : of < f && of > dest) return { refused: 'crosses_key', channel: g.channel };
      }
    }
    const moving = g.keys.filter((k) => g.frames.has(frameOf(k, rate)));
    const frames = [...g.frames];
    const from = Math.min(...frames, ...frames.map((f) => f + delta)), to = Math.max(...frames, ...frames.map((f) => f + delta));
    const out: Keyframe[] = [];
    for (const k of g.keys) {
      const f = frameOf(k, rate);
      if (g.frames.has(f)) { if (moving.includes(k)) out.push(copyKey(k, T.frameTime(f + delta, rate))); continue; }
      if (f >= from && f <= to) out.push(copyKey(k));
    }
    out.sort((a, b) => T.cmp(a.time, b.time));
    ops.push(rangeWrite(clip, g.channel, out, T.frameTime(from, rate), T.frameTime(to, rate)));
  }
  return { ops };
}

// ---------- delete ----------
/**
 * Remove the selected keys: one range write per channel over the selection's span, with the unselected keys inside the span as
 * the new keys (null when there are none). A channel left with no keys keeps the value of the last removed key, as
 * delete_keyframe does (`at`).
 */
export function deleteKeysOps(clip: Clip, rate: T.Rate, sel: readonly KeyRef[]): OpCall[] {
  const ops: OpCall[] = [];
  for (const g of byChannel(clip, rate, sel)) {
    const frames = [...g.frames].sort((a, b) => a - b);
    const from = frames[0]!, to = frames[frames.length - 1]!;
    const kept = g.keys.filter((k) => { const f = frameOf(k, rate); return f >= from && f <= to && !g.frames.has(f); }).map((k) => copyKey(k));
    const left = g.keys.length - g.keys.filter((k) => g.frames.has(frameOf(k, rate))).length;
    const last = g.keys.find((k) => frameOf(k, rate) === to)!;
    ops.push(rangeWrite(clip, g.channel, kept.length ? kept : null, T.frameTime(from, rate), T.frameTime(to, rate), left === 0 ? last.time : undefined));
  }
  return ops;
}

// ---------- curve ----------
/**
 * Set the curve on the selected keys with set_keyframe_curve. The operation applies its `times` to every one of its `channels`,
 * so the selection is grouped by the exact key times: channels whose selected keys sit on the same times share one operation
 * (the usual case: a strip key at one frame, all its channels), and no other key is touched. At most 64 channels and 2000 times
 * go in one call. `bezier` goes with the easing 'bezier' only.
 */
export function curveOps(clip: Clip, rate: T.Rate, sel: readonly KeyRef[], side: 'after' | 'before' | 'both', easing: Easing, bezier?: CurveHandles): OpCall[] {
  const groups = new Map<string, { channels: ChannelRef[]; times: T.RationalTime[] }>();
  for (const g of byChannel(clip, rate, sel)) {
    const times = g.keys.filter((k) => g.frames.has(frameOf(k, rate))).map((k) => T.normalize(k.time)).sort(T.cmp);
    const id = times.map((t) => `${t.value}/${t.timescale}`).join(',');
    const cur = groups.get(id);
    if (cur) cur.channels.push(g.channel); else groups.set(id, { channels: [g.channel], times });
  }
  const ops: OpCall[] = [];
  for (const { channels, times } of groups.values()) {
    for (let c = 0; c < channels.length; c += 64) {
      for (let t = 0; t < times.length; t += MAX_TRANSFORM_KEYS) {
        ops.push({ op: 'set_keyframe_curve', args: { clipId: clip.id, channels: channels.slice(c, c + 64), times: times.slice(t, t + MAX_TRANSFORM_KEYS), side, easing, ...(easing === 'bezier' && bezier ? { bezier: [...bezier] } : {}) } });
      }
    }
  }
  return ops;
}

// ---------- copy and paste ----------
/** The key clipboard (session state, never stored): values and curves per channel, frames relative to the earliest copied key. */
export interface KeyClipboard {
  entries: {
    channel: ChannelRef;
    /** The effect type of an effect channel: paste finds the target's first effect of this type. */
    effectType?: string;
    keys: { df: number; value: number; easing: Easing; bezier?: CurveHandles }[];
  }[];
}
/** Copy the selected keys. Frames are relative to the earliest selected key over all channels. An empty selection gives no entries. */
export function copyKeys(clip: Clip, rate: T.Rate, sel: readonly KeyRef[]): KeyClipboard {
  const groups = byChannel(clip, rate, sel);
  if (!groups.length) return { entries: [] };
  const origin = Math.min(...groups.flatMap((g) => [...g.frames]));
  return {
    entries: groups.map((g) => {
      const fx = 'effectId' in g.channel ? effectOf(clip, g.channel.effectId) : undefined;
      return {
        channel: g.channel,
        ...(fx ? { effectType: fx.type } : {}),
        keys: g.keys.filter((k) => g.frames.has(frameOf(k, rate))).map((k) => ({ df: frameOf(k, rate) - origin, value: k.value, easing: k.easing, ...(k.bezier ? { bezier: [...k.bezier] as unknown as CurveHandles } : {}) })).sort((a, b) => a.df - b.df),
      };
    }),
  };
}
/**
 * Paste at clip-local frame `atFrame` (playhead − clip start, through T.frameTime): one range write per channel over the pasted
 * span, replacing the keys there. Effect channels map to the target's first effect of the same type; channels the target
 * cannot carry (an adjustment takes opacity and effects only), whose effect is missing, or that would hold more keys than a
 * channel may are skipped and reported (with the channel as it was copied).
 */
export function pasteKeysOps(target: Clip, track: Track, rate: T.Rate, cb: KeyClipboard, atFrame: number): { ops: OpCall[]; skipped: ChannelRef[] } {
  const carried = carriedChannels(target, track);
  const ops: OpCall[] = [];
  const skipped: ChannelRef[] = [];
  for (const e of cb.entries) {
    let dest: ChannelRef | undefined;
    if ('property' in e.channel) dest = carried.find((c) => sameChannel(c, e.channel));
    else if (e.effectType && target.type !== 'caption') {
      const fx = (target.effects ?? []).find((x) => x.type === e.effectType && animatableParams(x.type).includes((e.channel as { param: string }).param));
      if (fx) dest = carried.find((c) => 'effectId' in c && c.effectId === fx.id && c.param === (e.channel as { param: string }).param);
    }
    if (!dest || !e.keys.length) { skipped.push(e.channel); continue; }
    const keys: Keyframe[] = e.keys.map((k) => ({ time: T.frameTime(atFrame + k.df, rate), value: k.value, easing: k.easing, ...(k.bezier ? { bezier: [...k.bezier] as unknown as CurveHandles } : {}) }));
    const from = keys[0]!.time, to = keys[keys.length - 1]!.time;
    const outside = keysOf(target, dest).filter((k) => T.lt(k.time, from) || T.lt(to, k.time)).length;
    if (outside + keys.length > maxKeys(dest)) { skipped.push(e.channel); continue; }
    ops.push(rangeWrite(target, dest, keys, from, to));
  }
  return { ops, skipped };
}
