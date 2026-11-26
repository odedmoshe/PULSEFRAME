/**
 * The pure rules of the three clip cards (wave 8D P6): fit sizes, the blend pills, the keyframe chips, the easing into a
 * keyframe and the ops that set it. No DOM. Everything builds on what exists: the transform op (editor.setShownTransform), the
 * clip's blend op (set_clip_blend), keyEdits.ts curveOps (set_keyframe_curve) and the easings of core keyframe.ts CURVES. The
 * tiles draw the curve with curvePicker.math.ts tilePoints, which calls the one sampler the engine uses (animation.ts sampleKeyframes).
 */
import * as T from '@pulseframe/time';
import { BLEND_MODES, CURVES, curveOps, fitScale, keyTimes, sampleKeyframes, transformAt, TRANSFORM_RANGE, type BlendMode, type Clip, type Easing, type KeyRef, type OpCall, type Track } from '@pulseframe/core';
import { polyline, tilePoints, TILE_RANGE } from '../curvePicker.math.ts';

// ---------- fit ----------
export interface FitSizes { fit: number; fill: number; original: number; originalInRange: boolean }
/**
 * The three sizes as the transform's scale (relative to how the project frames the picture, as FrameFill did): fit shows all of it,
 * fill covers the frame, original puts one picture pixel on one frame pixel. Null when the picture's size is not known.
 */
export function fitSizes(frameW: number, frameH: number, srcW: number | undefined, srcH: number | undefined, docFit: 'contain' | 'cover' = 'contain'): FitSizes | null {
  if (!srcW || !srcH || !frameW || !frameH) return null;
  const base = fitScale(frameW, frameH, srcW, srcH, docFit);
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const original = r4(1 / base);
  const { min, max } = TRANSFORM_RANGE.scale;
  return { fit: r4(fitScale(frameW, frameH, srcW, srcH, 'contain') / base), fill: r4(fitScale(frameW, frameH, srcW, srcH, 'cover') / base), original, originalInRange: original >= min && original <= max };
}
/** Whether the current transform is at the given size, centred (position within half a percent). */
export const atSize = (cur: { scale: number; x: number; y: number }, size: number): boolean => Math.abs(cur.scale - size) < 0.005 && Math.abs(cur.x) < 0.005 && Math.abs(cur.y) < 0.005;

// ---------- blend ----------
/** The pills shown first, most used first; every other mode sits behind «עוד». */
export const BLEND_MAIN: readonly BlendMode[] = ['normal', 'screen', 'lighten', 'multiply', 'overlay'];
export const blendRest = (): BlendMode[] => BLEND_MODES.filter((m) => !BLEND_MAIN.includes(m));
/** «עוד» opens by itself when the chosen mode is one of the rest, so the choice is never hidden. */
export const blendMoreOpen = (mode: BlendMode, openedByHand: boolean): boolean => openedByHand || !BLEND_MAIN.includes(mode);

// ---------- keyframes ----------
export interface KeyChip { frame: number; absFrame: number; zoom: number; seconds: number }
/** Clip-local frames of the keys on the five transform channels (effect-parameter keys are not motion of the picture). */
export function transformKeyFrames(clip: Clip, track: Track, rate: T.Rate): number[] {
  return keyTimes(clip, track, rate).filter((k) => k.channels.some((c) => 'property' in c)).map((k) => k.frame);
}
/** One chip per keyframe: the zoom (scale as drawn at that frame) and the time from the clip start. */
export function keyChips(clip: Clip, track: Track, rate: T.Rate): KeyChip[] {
  if (clip.type === 'caption') return [];
  const startFrame = T.frameIndexAt(clip.start, rate);
  return transformKeyFrames(clip, track, rate).map((frame) => ({
    frame, absFrame: startFrame + frame,
    zoom: transformAt(clip, T.add(clip.start, T.frameTime(frame, rate))).scale,
    seconds: T.toSeconds(T.frameTime(frame, rate)),
  }));
}
/** The chip the playhead stands on, if any (the "selected keyframe": what the easing tiles and the zoom slider edit). */
export const chipAt = (chips: readonly KeyChip[], playheadFrame: number): KeyChip | undefined => chips.find((c) => c.absFrame === playheadFrame);
/** m:ss.cc, as the reference clip chips read: the clip's own time. */
export function chipTime(seconds: number): string {
  const cs = Math.round(seconds * 100);
  const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
export const zoomText = (scale: number): string => `×${scale.toFixed(2)}`;

// ---------- easing into a keyframe ----------
type TransformKey = { time: T.RationalTime; easing: Easing };
const keysOnProp = (clip: Clip, prop: string): readonly TransformKey[] => (clip.type === 'caption' ? [] : ((clip.keyframes as Record<string, TransformKey[] | undefined> | undefined)?.[prop] ?? []));
const PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;

/** The transform channels that have a key at the clip-local frame AND a key before it: the segments that end in this keyframe. */
export function segmentsInto(clip: Clip, frame: number, rate: T.Rate): { prop: (typeof PROPS)[number]; easing: Easing }[] {
  const at = T.frameTime(frame, rate);
  const out: { prop: (typeof PROPS)[number]; easing: Easing }[] = [];
  for (const p of PROPS) {
    const keys = keysOnProp(clip, p);
    const i = keys.findIndex((k) => T.eq(T.normalize(k.time), T.normalize(at)) || T.frameIndexAt(k.time, rate) === frame);
    if (i > 0) out.push({ prop: p, easing: keys[i - 1]!.easing });
  }
  return out;
}
/** The easing into the keyframe: the one all its segments share, `mixed` when they differ, null when no segment ends here (first key). */
export function easingInto(clip: Clip, frame: number, rate: T.Rate): Easing | 'mixed' | null {
  const segs = segmentsInto(clip, frame, rate);
  if (!segs.length) return null;
  return segs.every((s) => s.easing === segs[0]!.easing) ? segs[0]!.easing : 'mixed';
}
/** The op that sets the easing into the keyframe at the clip-local frame: set_keyframe_curve on the key's «before» side, for each channel that has one. */
export function easeIntoOps(clip: Clip, frame: number, rate: T.Rate, easing: Easing): OpCall[] {
  const sel: KeyRef[] = segmentsInto(clip, frame, rate).map((s) => ({ channel: { property: s.prop }, frame }));
  return sel.length ? curveOps(clip, rate, sel, 'before', easing) : [];
}

// ---------- easing tiles ----------
/** The six easings shown first (the tiles of the card), then the rest of core CURVES behind «עוד». Only kinds that exist. */
export const EASE_MAIN: readonly Easing[] = ['smooth', 'ease-out', 'ease-in', 'ease-in-out', 'linear', 'hold'];
export const easeRest = (): Easing[] => CURVES.map((c) => c.id).filter((id) => !EASE_MAIN.includes(id));
export const easeMoreOpen = (current: Easing | 'mixed' | null, openedByHand: boolean): boolean => openedByHand || (current !== null && current !== 'mixed' && !EASE_MAIN.includes(current));

export const TILE_W = 56, TILE_H = 32;
/**
 * The polyline of a tile: the real curve (41 samples of the engine's sampler, tilePoints) drawn inside a padded box. The vertical range
 * is the curve's own (at least 0..1, wider when it overshoots or bounces), so a straight kind is a diagonal and a bounce shows its turn.
 */
export function tileLine(easing: Easing, w = TILE_W, h = TILE_H, pad = 5): string {
  const pts = tilePoints(easing);
  const lo = Math.min(0, ...pts.map((p) => p.y)), hi = Math.max(1, ...pts.map((p) => p.y));
  return polyline(pts, w - pad * 2, h - pad * 2, lo, hi).split(' ').map((p) => { const [x, y] = p.split(',').map(Number); return `${(x! + pad).toFixed(2)},${(y! + pad).toFixed(2)}`; }).join(' ');
}
/** The value of a curve at u (0..1) for a one-segment 0 → 1 change: the number the tile's line passes through, for tests. */
export const curveAt = (easing: Easing, u: number): number => {
  const keys = [{ time: T.rt(0, 1), value: 0, easing }, { time: T.rt(1, 1), value: 1, easing: 'linear' as const }];
  return sampleKeyframes(keys, T.rt(Math.round(u * 1000), 1000), TILE_RANGE);
};
