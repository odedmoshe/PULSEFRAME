/**
 * What a tile of the effects gallery does when it is picked, kept apart from the dialog so it can be tested without a browser.
 * Every pick is one registered op; nothing here keeps project state.
 */
import { COLOR_LOOKS, type Clip, type OpCall } from '@pulseframe/core';

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
export function pickCall(clip: Clip, it: PickItem): OpCall | null {
  const clipId = clip.id;
  if (it.kind === 'effect') return isOn(clip, it) ? null : { op: 'add_effect', args: { clipId, type: it.id } };
  if (it.kind === 'look') return { op: 'apply_look', args: { clipId, lookId: it.id } };
  if (it.kind === 'transition') return { op: 'set_transition', args: { clipId, type: it.id } };
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
