/**
 * The per-pair machinery shared by paste attributes (wave 7 craft, pasteAttributes.ts) and «למדו אותי פעם אחת» (wave 8 teach,
 * lesson.ts): run a registered public op on a draft as apply_recipe runs its steps, copy a target with every clip linked to it and
 * put the copies back on a refusal, and walk a caller's choice in a FIXED order (teach-verify C10, C16; one helper for both, so the
 * two features cannot drift). Extracted from pasteAttributes.ts by the teach pre-pass with no change of behaviour (craft.test.ts and
 * craftContracts.test.ts stay as they were).
 *
 * The rollback is exact only for ops that change nothing but the target and its linked partners (craft.test.ts checks paste's ops
 * with diffEntities; lessonContracts.test.ts names the teach ops whose touch W1 must check the same way).
 */
import { z } from 'zod';
import { findClip, getOp, OpError, partnersOf, refuseInheritedIds, type OpContext, type OpResult } from './ops.ts';
import type { Clip, ProjectDocument, Track } from './schema.ts';

/** Run a registered public op on the draft, as apply_recipe runs its steps (its arguments parsed by its own schema). */
export function runRegisteredOp(d: ProjectDocument, ctx: OpContext, op: string, args: unknown): OpResult {
  const def = getOp(op);
  if (!def || def.internal) throw new OpError('forbidden_op', `${op}: not a public operation of this build`, { op });
  const parsed = def.args.safeParse(args);
  if (!parsed.success) throw new OpError('invalid_args', `${op}: ${z.prettifyError(parsed.error)}`, { op });
  refuseInheritedIds(parsed.data, op, '', def.checksOwnIds);
  return def.apply(d, parsed.data, ctx);
}

// ---------------------------------------------------------------- rollback (the target and its linked clips)
export interface SavedClip { track: Track; clip: Clip }
/** Copies of the target and of every clip linked to it, wherever they are. */
export function saveTarget(d: ProjectDocument, clipId: string): SavedClip[] {
  const f = findClip(d, clipId)!;
  return [{ track: f.track, clip: structuredClone(f.clip) }, ...partnersOf(d, f.clip).map((p) => ({ track: p.track, clip: structuredClone(p.clip) as Clip }))];
}
/** Put the copies back in place (the ops that use this never move a clip in time or between tracks). */
export function restoreTarget(saved: readonly SavedClip[]): void {
  for (const s of saved) {
    const i = s.track.clips.findIndex((c) => c.id === s.clip.id);
    if (i >= 0) s.track.clips[i] = s.clip; else s.track.clips.push(s.clip);
  }
}

/**
 * The members of `wanted` in the fixed `order` (each once; a member not in `order` is dropped). Paste attributes walks its groups
 * with it (PASTE_ORDER), teach its parts' kinds (LESSON_PART_ORDER): what the caller ticked never decides the order.
 */
export function inFixedOrder<K extends string>(order: readonly K[], wanted: Iterable<K>): K[] {
  const w = new Set(wanted);
  return order.filter((k) => w.has(k));
}
