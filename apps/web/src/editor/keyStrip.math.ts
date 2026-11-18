/**
 * Pure maths of the keyframe strip (ADR-0019): the layout of the aggregated keys, the glyph of a curve, the drag in whole frames,
 * the nudge bounds, and the selection helpers the editor's session state uses (store.ts keySel). No DOM, no editor.
 */
import * as T from '@pulseframe/time';
import { channelKey, keysOf, type ChannelRef, type Clip, type Easing, type KeyAt, type KeyRef } from '@pulseframe/core';

export type KeySel = { clipId: string; keys: KeyRef[] };

/** The shape that shows the curve after a key: soft for the smooth family, burst for curves that turn back, a square for hold. */
export type Glyph = 'diamond' | 'soft' | 'hold' | 'burst' | 'custom' | 'mixed';
const SOFT = new Set<Easing>(['smooth', 'ease-in', 'ease-out', 'ease-in-out', 'gentle', 'sharp']);
const BURST = new Set<Easing>(['overshoot', 'anticipate', 'bounce', 'spring']);
export function glyphOfEasing(e: Easing): Exclude<Glyph, 'mixed'> {
  return e === 'linear' ? 'diamond' : e === 'hold' ? 'hold' : e === 'bezier' ? 'custom' : BURST.has(e) ? 'burst' : SOFT.has(e) ? 'soft' : 'diamond';
}
/** The glyph of an aggregated frame: the shared one, or 'mixed' when its channels have different curves. */
export function glyphOf(easings: readonly Easing[]): Glyph {
  const g = new Set(easings.map(glyphOfEasing));
  return g.size === 1 ? [...g][0]! : g.size === 0 ? 'diamond' : 'mixed';
}

export interface StripLayout {
  /** Keys inside the clip, with their x offset in the strip (pixels from the clip's left edge). */
  dots: { at: KeyAt; x: number }[];
  /** Keys outside the clip: how many frames (aggregated) lie before the start and after the end. */
  before: number;
  after: number;
}
/** Place the aggregated keys: x = frame time × pps; keys outside [0, count) are counted for the two edge chips. */
export function stripLayout(keys: readonly KeyAt[], rate: T.Rate, pps: number): StripLayout {
  const dots: StripLayout['dots'] = [];
  let before = 0, after = 0;
  for (const at of keys) {
    if (at.inside) dots.push({ at, x: T.toSeconds(T.frameTime(at.frame, rate)) * pps });
    else if (at.frame < 0) before++; else after++;
  }
  return { dots, before, after };
}
/** Whole frames for a pointer distance (dx pixels at pps pixels per second): the same rounding the volume line uses. */
export const framesForPixels = (dx: number, pps: number, rate: T.Rate): number => Math.round(((dx / pps) * rate.num) / rate.den);
/** Pointer movement below this many pixels is a click, not a drag. */
export const DRAG_THRESHOLD = 3;
export const isDrag = (dx: number, dy: number): boolean => Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD;

/** The range a move of the selected frames may take: no key leaves [0, count − 1]. Returns [min delta, max delta]. */
export function nudgeBounds(selectedFrames: readonly number[], count: number): [number, number] {
  const inside = selectedFrames.filter((f) => f >= 0 && f < count);
  if (!inside.length) return [0, 0];
  return [-Math.min(...inside), count - 1 - Math.max(...inside)];
}
export const clampDelta = (delta: number, selectedFrames: readonly number[], count: number): number => {
  const [lo, hi] = nudgeBounds(selectedFrames, count);
  return Math.max(lo, Math.min(hi, delta));
};

const same = (a: KeyRef, b: KeyRef) => a.frame === b.frame && channelKey(a.channel) === channelKey(b.channel);
/** Every channel of one aggregated frame as key references. */
export const refsAt = (at: KeyAt): KeyRef[] => at.channels.map((channel) => ({ channel, frame: at.frame }));
export const isSelected = (sel: KeySel | null, clipId: string, at: KeyAt): 'all' | 'some' | 'none' => {
  if (!sel || sel.clipId !== clipId) return 'none';
  const n = refsAt(at).filter((r) => sel.keys.some((k) => same(k, r))).length;
  return n === 0 ? 'none' : n === at.channels.length ? 'all' : 'some';
};
/** Click: replace the selection by this frame's keys; Shift/Mod: toggle them (all selected → remove, else add). */
export function selectFrame(sel: KeySel | null, clipId: string, at: KeyAt, toggle: boolean): KeySel {
  const refs = refsAt(at);
  const cur = sel && sel.clipId === clipId ? sel.keys : [];
  if (!toggle) return { clipId, keys: refs };
  const state = isSelected(sel, clipId, at);
  const rest = cur.filter((k) => k.frame !== at.frame);
  return { clipId, keys: state === 'all' ? rest : [...rest, ...refs] };
}
/** The selection after its keys moved by `delta` frames (the user's own move). Keys outside the clip did not move. */
export function remapKeySel(sel: KeySel, delta: number, count: number): KeySel {
  return { ...sel, keys: sel.keys.map((k) => (k.frame >= 0 && k.frame < count ? { ...k, frame: k.frame + delta } : k)) };
}
/** Drop selected keys whose clip or key is gone (called when a document loads). Null when nothing is left. */
export function pruneKeySel(sel: KeySel | null, find: (clipId: string) => Clip | undefined, rate: T.Rate): KeySel | null {
  if (!sel) return null;
  const clip = find(sel.clipId);
  if (!clip) return null;
  const keys = sel.keys.filter((r) => keysOf(clip, r.channel).some((k) => T.frameIndexAt(k.time, rate) === r.frame));
  return keys.length ? { clipId: sel.clipId, keys } : null;
}
export const sameChannelRef = (a: ChannelRef, b: ChannelRef) => channelKey(a) === channelKey(b);
