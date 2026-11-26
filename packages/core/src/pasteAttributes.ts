/**
 * The body of paste_attributes and its preview (wave 7 craft; craft-plan.md §3.3 table and "Corrected" C3).
 * applyAttributes is the op's body (craftOps.ts calls it); planPasteAttributes runs the same routine on a copy, so the dialog's
 * rows equal the commit's applied + skipped (proof P2).
 *
 * THE RULES
 * - Whole-op refusals: the source or a target does not exist (not_found); the source is among the targets
 *   (pasteSourceIsTarget); nothing was applied anywhere (pasteNothing; the plan still lists the rows). Targets named twice count once.
 * - Per (target, group), in the order colour, effects, animation, transform, sound, titleStyle (animation before transform: with
 *   both ticked the keys are replaced first), the existing public ops run through the registry, so each keeps its own refusals
 *   and its own light rule. A pair one of them refuses is put back EXACTLY: the target and every clip linked to it are copied
 *   before the attempt and put back on the refusal (each op used changes only those clips; craft.test.ts checks it with
 *   diffEntities), and the pair is listed in `skipped` with that op's code and message.
 * - A group the source has nothing in is skipped as `source_empty` and NEVER clears a target.
 * - Each group REPLACES the target's (pasting twice gives the same result, effect lists compared without ids):
 *   colour   the target's color.* effects are removed; copies of the source's go, in source order, at the place of the first one
 *            removed, else at the end (ops.ts effectSlot keeps a time effect first); bypass, keys and beat modulators copied too.
 *   effects  the same for every other effect, plus the blend mode, plus the mask on a target that can carry one (a picture on a
 *            video track, an adjustment clip); on other targets the mask is not part of the group.
 *   animation the transform keys of x, y, scale, rotation, opacity (a property the source has no keys on loses the target's,
 *            keeping the value it had at the clip start, as replace_clip_keyframes does) and, between titles, the letter
 *            animation. Source keys before the target's start or after its end are left out and counted (keysLeftOut).
 *   transform x, y, scale, rotation, opacity. Onto a target with keys on any of them while 'animation' is not ticked:
 *            skipped as `target_animated` (the keys would win and nothing would show). Empty for a caption or a sound source.
 *   sound    the gain; from a clip on an audio track also the fades, the volume keys and the sound effects. Empty for a
 *            source that is not a media clip.
 *   titleStyle the whole style of a title (look fields the source has not are switched off on the target).
 * - Always the master document (the editor disables the command while a format is viewed).
 */
import * as T from '@pulseframe/time';
import { findClip, OpError, type OpContext } from './ops.ts';
import { inFixedOrder, restoreTarget, runRegisteredOp, saveTarget } from './pairRun.ts';
import { ANIMATABLE, TEXT_LOOK_FIELDS, type Clip, type ProjectDocument, type Track } from './schema.ts';
import { cloneDocument } from './clone.ts';
import { makeIdSource } from './ops.ts';
import { craftRefusal, type AttributeGroup, type PasteAttributesArgs, type PasteAttributesOutput, type PastePlan, type PasteSkip } from './craftContract.ts';
import type { Keyframe } from './keyframe.ts';
import { opOnlyEffect } from './livingContract.ts';

/** Run a registered public op on the draft (pairRun.ts, shared with teach). */
const runOp = runRegisteredOp;

/** The order the groups are applied in (animation before transform, C3). */
export const PASTE_ORDER: readonly AttributeGroup[] = ['colour', 'effects', 'animation', 'transform', 'sound', 'titleStyle'];
const isColour = (type: string) => type.startsWith('color.');
/**
 * The effects group: every effect that is not colour, except the ones only their own op adds (opOnlyEffect: a living picture needs
 * the target's own drawn depth, verifier C4). Those are neither copied nor removed from the target; the output counts the source's
 * (opOnlyLeftOut) so the dialog can say so.
 */
const isPastedEffect = (type: string) => !isColour(type) && !opOnlyEffect(type);

/** A pair left out without running an op: the source has nothing in the group, or the target is animated. */
class Skip extends Error { constructor(public code: 'source_empty' | 'target_animated', message: string) { super(message); } }

/** Keys inside [0, duration] of the target (both included), and how many were left out. */
function keysWithin(keys: readonly Keyframe[], duration: T.RationalTime): { keys: Keyframe[]; left: number } {
  const kept = keys.filter((k) => !T.isNegative(k.time) && T.lte(k.time, duration)).map((k) => ({ ...k }));
  return { keys: kept, left: keys.length - kept.length };
}

// ---------------------------------------------------------------- rollback: pairRun.ts saveTarget / restoreTarget (re-exported here)
export { restoreTarget, saveTarget } from './pairRun.ts';

// ---------------------------------------------------------------- the groups
interface Ctx { d: ProjectDocument; ctx: OpContext; src: Clip; srcTrack: Track; groups: readonly AttributeGroup[]; left: number }
const target = (d: ProjectDocument, id: string) => findClip(d, id)!;

/** colour and effects: replace the target's effects of the family with copies of the source's, in source order. */
function pasteEffects(c: Ctx, id: string, family: (type: string) => boolean): void {
  const { d, ctx } = c;
  const fx = (c.src.effects ?? []).filter((e) => family(e.type));
  const existing = target(d, id).clip.effects ?? [];
  const first = existing.findIndex((e) => family(e.type));
  for (const e of existing.filter((x) => family(x.type))) runOp(d, ctx, 'remove_effect', { clipId: id, effectId: e.id });
  let at: number | undefined = first >= 0 ? first : undefined;
  const duration = target(d, id).clip.duration;
  for (const s of fx) {
    const r = runOp(d, ctx, 'add_effect', { clipId: id, type: s.type, params: s.params, ...(at !== undefined ? { index: at } : {}) });
    const effectId = (r.output as { effectId: string }).effectId;
    at = target(d, id).clip.effects!.findIndex((e) => e.id === effectId) + 1;
    if (!s.enabled) runOp(d, ctx, 'update_effect', { clipId: id, effectId, enabled: false });
    for (const [param, keys] of Object.entries(s.keyframes ?? {})) {
      const w = keysWithin(keys, duration);
      c.left += w.left;
      if (w.keys.length) runOp(d, ctx, 'replace_effect_keyframes', { clipId: id, effectId, param, keys: w.keys });
    }
    for (const [param, m] of Object.entries(s.modulate ?? {})) runOp(d, ctx, 'set_effect_modulator', { clipId: id, effectId, param, modulator: { every: m.every, depth: m.depth, decay: m.decay } });
  }
}
const takesMask = (clip: Clip, track: Track) => (clip.type === 'media' && track.kind === 'video') || (clip.type === 'adjustment' && track.kind === 'adjustment');

const GROUPS: Record<AttributeGroup, { empty: (c: Ctx) => boolean; apply: (c: Ctx, id: string) => void }> = {
  colour: {
    empty: (c) => !(c.src.effects ?? []).some((e) => isColour(e.type)),
    apply: (c, id) => pasteEffects(c, id, isColour),
  },
  effects: {
    empty: (c) => !(c.src.effects ?? []).some((e) => isPastedEffect(e.type)) && !c.src.blend && !(c.src.type !== 'text' && c.src.type !== 'caption' && 'mask' in c.src && c.src.mask),
    apply: (c, id) => {
      pasteEffects(c, id, isPastedEffect);
      runOp(c.d, c.ctx, 'set_clip_blend', { clipId: id, mode: c.src.blend ?? 'normal' });
      const t = target(c.d, id);
      const mask = 'mask' in c.src ? c.src.mask : undefined;
      if (takesMask(t.clip, t.track) && (mask || ('mask' in t.clip && t.clip.mask))) runOp(c.d, c.ctx, 'set_clip_mask', { clipId: id, mask: mask ?? null });
    },
  },
  animation: {
    empty: (c) => !ANIMATABLE.some((p) => c.src.keyframes?.[p]?.length) && !(c.src.type === 'text' && c.src.animation),
    apply: (c, id) => {
      const t = target(c.d, id);
      let ran = false;
      for (const p of ANIMATABLE) {
        const from = c.src.keyframes?.[p] ?? [], had = t.clip.keyframes?.[p] ?? [];
        if (from.length) {
          const w = keysWithin(from, t.clip.duration);
          c.left += w.left;
          if (w.keys.length || had.length) runOp(c.d, c.ctx, 'replace_clip_keyframes', { clipId: id, property: p, keys: w.keys.length ? w.keys : null });
          ran = true;
        } else if (had.length) { runOp(c.d, c.ctx, 'replace_clip_keyframes', { clipId: id, property: p, keys: null }); ran = true; }
      }
      if (c.src.type === 'text') {
        const anim = c.src.animation ?? null;
        const now = target(c.d, id).clip;
        // between titles the letter animation is replaced; onto another clip it is left out, unless it is all the group holds
        if (now.type === 'text' ? anim !== null || now.animation : anim !== null && !ran) runOp(c.d, c.ctx, 'set_text_animation', { clipId: id, animation: anim });
      }
    },
  },
  transform: {
    empty: (c) => c.src.type === 'caption' || c.srcTrack.kind === 'audio',
    apply: (c, id) => {
      const t = target(c.d, id).clip;
      if (!c.groups.includes('animation') && ANIMATABLE.some((p) => t.keyframes?.[p]?.length))
        throw new Skip('target_animated', `clip ${id} has keys on its position, size, rotation or opacity; tick animation too to replace them`);
      runOp(c.d, c.ctx, 'set_clip_transform', { clipId: id, transform: c.src.transform });
    },
  },
  sound: {
    empty: (c) => c.src.type !== 'media',
    apply: (c, id) => {
      const src = c.src as Extract<Clip, { type: 'media' }>;
      runOp(c.d, c.ctx, 'set_clip_gain', { clipId: id, gain: src.gain });
      if (c.srcTrack.kind !== 'audio') return; // a picture's own sound settings are its gain; the rest lives on its sound clip
      runOp(c.d, c.ctx, 'set_clip_fades', { clipId: id, fadeIn: src.fadeIn ?? T.ZERO, fadeOut: src.fadeOut ?? T.ZERO });
      const t = target(c.d, id).clip as Extract<Clip, { type: 'media' }>;
      // volume keys past the target's end are left out and counted, as transform and effect keys are
      const keys = (src.volume ?? []).filter((k) => !T.isNegative(k.time) && T.lte(k.time, t.duration)).map((k) => ({ ...k }));
      c.left += (src.volume?.length ?? 0) - keys.length;
      if (keys.length) runOp(c.d, c.ctx, 'draw_volume', { clipId: id, from: T.ZERO, to: t.duration, keys });
      else if (t.volume?.length) runOp(c.d, c.ctx, 'delete_volume_keyframe', { clipId: id });
      if (src.audioFx?.length) runOp(c.d, c.ctx, 'copy_audio_effects', { fromClipId: src.id, toClipIds: [id], replace: true });
      else if (t.audioFx?.length) runOp(c.d, c.ctx, 'apply_audio_preset', { clipId: id, presetId: null, includeLinked: false });
    },
  },
  titleStyle: {
    empty: (c) => c.src.type !== 'text',
    apply: (c, id) => {
      const src = c.src as Extract<Clip, { type: 'text' }>;
      const t = target(c.d, id).clip;
      const style: Record<string, unknown> = structuredClone(src.style);
      if (t.type === 'text') for (const k of TEXT_LOOK_FIELDS) if (t.style[k] != null && style[k] == null) style[k] = null;
      runOp(c.d, c.ctx, 'update_text', { clipId: id, style });
    },
  },
};

/**
 * The routine shared by the op and its plan: every (target, group) tried in order, each refused pair put back and listed.
 * Throws only the whole-op refusals other than pasteNothing.
 */
function pasteRoutine(d: ProjectDocument, args: PasteAttributesArgs, ctx: OpContext): PasteAttributesOutput {
  const sf = findClip(d, args.fromClipId);
  if (!sf) throw new OpError('not_found', `clip ${args.fromClipId} not found`, { clipId: args.fromClipId }, 'Call get_timeline to list current clip ids.');
  const targets = [...new Set(args.toClipIds)];
  if (targets.includes(args.fromClipId)) throw craftRefusal('pasteSourceIsTarget', { clipId: args.fromClipId });
  for (const id of targets) if (!findClip(d, id)) throw new OpError('not_found', `clip ${id} not found`, { clipId: id }, 'Call get_timeline to list current clip ids.');
  // the source as it is before anything is pasted (a copy: a later step never reads a half-pasted source)
  const c: Ctx = { d, ctx, src: structuredClone(sf.clip), srcTrack: sf.track, groups: args.groups, left: 0 };
  const out: PasteAttributesOutput = { applied: [], skipped: [], keysLeftOut: 0 };
  const groups = inFixedOrder(PASTE_ORDER, args.groups);
  for (const id of targets) {
    for (const group of groups) {
      const g = GROUPS[group];
      if (g.empty(c)) { out.skipped.push({ clipId: id, group, code: 'source_empty', message: `the clip to copy from has nothing in ${group}` }); continue; }
      const saved = saveTarget(d, id);
      const leftBefore = c.left;
      try {
        g.apply(c, id);
        out.applied.push({ clipId: id, group });
      } catch (e) {
        if (!(e instanceof OpError) && !(e instanceof Skip)) throw e;
        restoreTarget(saved);
        c.left = leftBefore;
        const row: PasteSkip = { clipId: id, group, code: e.code, message: e.message };
        out.skipped.push(row);
      }
    }
  }
  out.keysLeftOut = c.left;
  const opOnly = groups.includes('effects') ? (c.src.effects ?? []).filter((e) => opOnlyEffect(e.type)).length : 0;
  if (opOnly) out.opOnlyLeftOut = opOnly;
  return out;
}

export function applyAttributes(draft: ProjectDocument, args: PasteAttributesArgs, ctx: OpContext): PasteAttributesOutput {
  const out = pasteRoutine(draft, args, ctx);
  if (!out.applied.length) throw craftRefusal('pasteNothing', { skipped: out.skipped });
  return out;
}
/** The same routine on a copy of `doc` (nothing of `doc` changes); a whole-op refusal other than pasteNothing is thrown. */
export function planPasteAttributes(doc: ProjectDocument, args: PasteAttributesArgs): PastePlan {
  const copy = cloneDocument(doc);
  return pasteRoutine(copy, args, { newId: makeIdSource('plan_'), actor: 'plan' });
}
