/**
 * What a tile of the effects gallery does when it is picked, kept apart from the dialog so it can be tested without a browser.
 * Every pick is one registered op; nothing here keeps project state.
 */
import * as T from '@pulseframe/time';
import { COLOR_LOOKS, findClip, handleAfterEnd, handleBeforeStart, previousAdjacent, velocityNeeds, type Clip, type OpCall, type ProjectDocument } from '@pulseframe/core';

export type PickKind = 'effect' | 'look' | 'transition' | 'text' | 'motion';
export interface PickItem { kind: PickKind; id: string }

const sameParams = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(b).every((k) => a[k] === b[k]);

/** True when the clip already carries what the tile stands for; the tile is then shown pressed. */
export function isOn(clip: Clip, it: PickItem): boolean {
  if (it.kind === 'transition') return clip.type === 'media' && clip.transition?.type === it.id;
  if (it.kind === 'text' || it.kind === 'motion') return false;
  const fx = clip.type === 'caption' ? [] : clip.effects ?? [];
  if (it.kind === 'effect') return fx.some((e) => e.type === it.id);
  const look = COLOR_LOOKS.find((l) => l.id === it.id);
  return !!look && fx.some((e) => e.type === 'color.grade' && sameParams(e.params as Record<string, unknown>, look.params));
}

/**
 * The op a pick commits, or null when there is nothing to commit: an effect that is already on the clip is not added a
 * second time (its tile is shown pressed; the copy on the clip is adjusted or removed in the Look panel).
 * Looks, transitions, text styles and motions replace what the clip has, so picking them again is not a second copy.
 */
export function pickCall(clip: Clip, it: PickItem, transitionFrames?: number): OpCall | null {
  const clipId = clip.id;
  if (it.kind === 'effect') return isOn(clip, it) ? null : { op: 'add_effect', args: { clipId, type: it.id } };
  if (it.kind === 'look') return { op: 'apply_look', args: { clipId, lookId: it.id } };
  if (it.kind === 'transition') return { op: 'set_transition', args: { clipId, type: it.id, ...(transitionFrames !== undefined ? { frames: transitionFrames } : {}) } };
  if (it.kind === 'motion') return { op: 'apply_motion_preset', args: { clipId, presetId: it.id } };
  return { op: 'apply_text_preset', args: { clipId, presetId: it.id } };
}

/**
 * Why a pick did not land, read right after Editor.commit resolved to null: the refusal the editor recorded (the reason the
 * server or the op gave), or a conflict with someone else's edit (the editor reloads and records no error for that).
 */
export function pickRefusal(after: { error: string | null; save: string }): { reason: string | null; conflict: boolean } {
  return { reason: after.error, conflict: !after.error && after.save === 'save.conflict' };
}

/** Thumbnail size for a frame of the given format: the long side is `longSide` pixels, the short side follows the format's shape. */
export function thumbSize(width: number, height: number, longSide = 180): [number, number] {
  const aspect = width > 0 && height > 0 ? width / height : 16 / 9;
  return aspect >= 1 ? [longSide, Math.max(16, Math.round(longSide / aspect))] : [Math.max(16, Math.round(longSide * aspect)), longSide];
}

/** The length set_transition gives a transition when none is asked for, and the most it takes (packages/core/src/ops.ts). */
export const DEFAULT_TRANSITION_FRAMES = 15;
export const MAX_TRANSITION_FRAMES = 150;
export interface TransitionRoom {
  /** The longest transition the op accepts at the start of this clip, in frames; 0 when none fits. */
  maxFrames: number;
  /**
   * What sets it: the clip's own length, the unused source after the previous clip, the source before this clip's start
   * (which only a velocity ramp reads), or the op's maximum.
   */
  limit: 'clip' | 'previous' | 'start' | 'max';
  /** The velocity ramp the clip's transition has: set_transition keeps it on a new type, so the limits above count its needs (ADR-0012). */
  velocity?: 2 | 3 | 4;
  /** Present (3) when the transition is locked to the beat, which set_transition also keeps: shorter than this is refused. */
  minFrames?: number;
}
/**
 * How long a transition at the start of this clip may be, by the rule of set_transition: no longer than the clip itself and,
 * when a clip ends exactly where this one starts on the same track and plays a file (not a still), no longer than the unused
 * source after that clip's end, which the outgoing picture plays on into under the transition (its "handle"). Two clips
 * placed whole, one after the other, have no handle between them: nothing fits. null: not a clip on the timeline.
 * A new type keeps the transition's options (set_transition, ADR-0012): with a velocity ramp the handle must hold
 * velocityNeeds(n, v).outFrames instead of n, and the clip's own source before its start velocityNeeds(n, v).headFrames;
 * with a beat lock nothing shorter than 3 frames is accepted.
 * A clip with a gradual speed change (or after one), or a ramp the clips cannot take at all (a reversed or frozen side, a time
 * effect first), is refused by the op whatever the length; that refusal is shown as is.
 */
export function transitionRoom(doc: ProjectDocument, clipId: string): TransitionRoom | null {
  const f = findClip(doc, clipId);
  if (!f || f.clip.type !== 'media') return null;
  const rate = doc.settings.frameRate;
  const kept = f.clip.transition, v = kept?.velocity;
  let room: Pick<TransitionRoom, 'maxFrames' | 'limit'> = { maxFrames: MAX_TRANSITION_FRAMES, limit: 'max' };
  const own = T.frameIndexAt(f.clip.duration, rate);
  if (own < room.maxFrames) room = { maxFrames: own, limit: 'clip' };
  /** The longest length up to the current limit whose need fits in `have` frames (needs grow with the length). */
  const fitting = (have: number, need: (n: number) => number) => { let n = room.maxFrames; while (n > 0 && need(n) > have) n--; return n; };
  const prev = previousAdjacent(f.track, f.clip);
  const asset = prev ? doc.assets[prev.assetId] : undefined;
  if (prev && asset && asset.kind !== 'image') {
    const handle = Math.max(0, T.frameIndexAt(handleAfterEnd(prev, asset.duration), rate));
    const n = fitting(handle, (m) => (v ? velocityNeeds(m, v).outFrames : m));
    if (n < room.maxFrames) room = { maxFrames: n, limit: 'previous' };
  }
  const ownAsset = doc.assets[f.clip.assetId];
  if (v && ownAsset && ownAsset.kind !== 'image') {
    const head = Math.max(0, T.frameIndexAt(handleBeforeStart(f.clip), rate));
    const n = fitting(head, (m) => velocityNeeds(m, v).headFrames);
    if (n < room.maxFrames) room = { maxFrames: n, limit: 'start' };
  }
  return { ...room, ...(v ? { velocity: v } : {}), ...(kept?.sync ? { minFrames: 3 } : {}) };
}
/** The length to ask for: what is wanted (the clip's current transition length, or the default), cut to what fits; 0 when nothing fits. */
export function transitionLength(room: TransitionRoom, wanted = DEFAULT_TRANSITION_FRAMES): number {
  const n = Math.max(0, Math.min(Math.round(wanted), room.maxFrames));
  return n < (room.minFrames ?? 1) ? 0 : n;
}
