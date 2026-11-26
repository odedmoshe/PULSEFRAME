/**
 * The public op apply_lesson of «למדו אותי פעם אחת» (wave 8 teach; lessonContract.ts). Registered on import (index.ts). The lead
 * wrote the name, version, description, argument schema and the body, which is complete around one call: validation
 * (lessonValidate.ts) and the target check run first, then the body refuses notBuilt while LESSON_OPS_BUILT is false (lesson.ts,
 * W1 sets it with lessonRoutine), then the routine runs and the op refuses `nothing` when no pair applied anywhere.
 * Undo is the generic one (one transaction, its exact entity diff). Excluded from the assistants (ASSISTANT_EXCLUDED_OPS), and in
 * version 1 refused to every agent by governance (apps/server/src/lessons/guard.ts, 403 lesson_owner_only): only the owner's own
 * session applies a lesson. The label is LESSON_LABEL, never a name.
 */
import { defineOp, findClip } from './ops.ts';
import { ApplyLessonArgsSchema, LESSON_OP, lessonRefusal } from './lessonContract.ts';
import { validateLessonArgs } from './lessonValidate.ts';
import { LESSON_OPS_BUILT, lessonRoutine } from './lesson.ts';

defineOp({
  name: LESSON_OP,
  version: 1,
  description: 'Repeat the owner\'s recent edits of one clip («למדו אותי פעם אחת») on other clips in one step: each part (speed, trim, transform, motion, look, effect, title, gain, fades, sound effects, transition, stabilise) is applied to each target whole, or put back exactly and listed as skipped with the reason (a target without sound skips the sound parts: no_sound). Parts run in that fixed order whatever order the edits were made in. Steps name their clip only as {"$slot":"clip"|"sound"}; a trim is {"$edge":…,"by":…} relative to the target\'s own edge, a length {"$dur":…} and a frame count {"$frames":…,"rate":…}, each rounded once to the project rate. Effects are upserted: the target\'s one effect of the same type is replaced. A lesson carries no words, no project file ids, no measurements and only catalogue fonts. At most 64 steps and 2,000 operation runs (targets × steps). In this version only the owner\'s own session applies a lesson: every agent credential is refused (403 lesson_owner_only); send the separate edits as ordinary operations instead.',
  args: ApplyLessonArgsSchema,
  apply(d, a, ctx) {
    const args = validateLessonArgs(a);
    for (const id of args.targets) if (!findClip(d, id)) throw lessonRefusal('targetNotFound', { clipId: id }, id);
    if (!LESSON_OPS_BUILT) throw lessonRefusal('notBuilt', {});
    const out = lessonRoutine(d, args, ctx);
    if (!out.applied.length) throw lessonRefusal('nothing', { skipped: out.skipped });
    const clips = [...new Set(out.applied.map((p) => p.clipId))];
    return { affectedIds: clips, summary: `Lesson: ${new Set(out.applied.map((p) => p.part)).size} part(s) on ${clips.length} clip(s)${out.skipped.length ? `, ${out.skipped.length} skipped` : ''}`, output: { ...out } };
  },
});
