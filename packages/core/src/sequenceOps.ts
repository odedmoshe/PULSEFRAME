/**
 * The sequence lifecycle (ADR-0018): add_sequence, update_sequence, remove_sequence, replace_clip_keyframes (public) and
 * apply_sequence_plan (internal). Registered on import of this module (packages/core/src/index.ts exports it); every one runs
 * only through applyTransaction.
 *
 * The lead's contract fixes the names, versions, descriptions and argument schemas (shortsContract.ts SequenceOpArgs,
 * ApplySequencePlanArgsSchema), the outputs, and every refusal with its code, English wording and hint (SEQUENCE_REFUSALS;
 * the Hebrew wording is packages/i18n/src/shorts.ts HE_SHORTS). The apply bodies are W1's: in this pre-pass each one REFUSES
 * with SEQUENCE_REFUSALS.notBuilt (code unknown_op) and changes nothing. SEQUENCE_OPS_BUILT turns the fuzz rows on.
 *
 * RULES OF THE BODIES (plan §4.1, the W1 brief, wave4-decisions.md)
 * - Ids: ctx.newId('seq') for a sequence; tracks through ops.ts newTrack (export it), 'standard' = V1 video, T1 text, A1 audio.
 * - Undo is the generic one: entities.ts emits the 'sequence' entity and restoreEntities restores it (see its contract there),
 *   including the stricter rule that an undo never deletes a clip added later (undo_conflict instead).
 * - Look sequences up with sequences.ts sequenceOf (own property). The main sequence never takes a format or an origin.
 * - remove_sequence removes the sequence's tracks, clips and markers (withContents) and is refused while a track of it is
 *   locked. It never removes the main sequence.
 * - replace_clip_keyframes: mustClip; a caption clip refuses (captionKeys); an adjustment clip takes opacity only (ops.ts
 *   refuseAdjustmentTransform words); times strictly increasing (keysNotIncreasing), frame-aligned (ops.ts assertAligned),
 *   not negative (keyBeforeStart); values pass TransformSchema.shape[property] (set_keyframe's words); keys null freezes the
 *   value at `at` with animation.ts sampleKeyframes exactly like clear_keyframes. Output ReplaceClipKeyframesOutput.
 * - apply_sequence_plan: removeSequenceIds first (each an existing non-main sequence with origin.kind 'short', no locked
 *   track; notPlanMade otherwise); then per step: getOp → a missing or internal op is planStepForbidden → templateOps.ts
 *   resolveBindings(step.args, bound, new Map(), `plan step ${i} (${op})`) → safeParse (planStepInvalid) → refuseInheritedIds
 *   → apply → ops.ts collectCreated → an add_sequence output's sequenceId joins the created sequences → bind the output.
 *   Origins: each {$ref, out:'sequenceId'} must resolve to a created sequence (originNotCreated), then sequence.origin is
 *   written. recipeRuns[id] = {recipeId SHORTS_RUN_ID, params, createdIds filtered with ops.ts isLiveCreated, fingerprints
 *   of the created clips, steps}. Output ApplySequencePlanOutput. Summaries: SEQUENCE_SUMMARIES.
 */
import { defineOp } from './ops.ts';
import { MAX_SEQUENCES } from './schema.ts';
import { ApplySequencePlanArgsSchema, SEQUENCE_PLAN_OP, SequenceOpArgs, sequenceRefusal } from './shortsContract.ts';

/** True once W1 has built the bodies: the operations fuzz (packages/evals/src/ops-fuzz.gen.ts) then draws the sequence rows. */
export const SEQUENCE_OPS_BUILT = false;

const notBuilt = (op: string) => () => { throw sequenceRefusal('notBuilt', { op }, op); };

defineOp({
  name: 'add_sequence',
  version: 1,
  description: `Add a sequence to the project: an edit of its own beside the main one (a short is one), with its own name and optionally its own output frame (format: width, height, fit, safe-area guides, loudness). 'standard' tracks (default) are a video, a text and an audio track, as a new project has; 'empty' has none. Every sequence runs at the project frame rate. Range operations take sequenceId to edit it; without it they edit the main sequence. At most ${MAX_SEQUENCES} sequences. Output: sequenceId, videoTrackId, textTrackId, audioTrackId.`,
  args: SequenceOpArgs.add_sequence,
  apply: notBuilt('add_sequence'),
});
defineOp({
  name: 'update_sequence',
  version: 1,
  description: 'Rename a sequence or change its own output frame (format null removes it, so it renders at the project frame). The main sequence takes its frame from the project settings (set_project_format) and cannot have a format of its own.',
  args: SequenceOpArgs.update_sequence,
  apply: notBuilt('update_sequence'),
});
defineOp({
  name: 'remove_sequence',
  version: 1,
  description: 'Remove a sequence that is not the main one. A sequence that still has clips is removed only with withContents: true, which also removes its tracks, clips and markers. Refused while one of its tracks is locked.',
  args: SequenceOpArgs.remove_sequence,
  apply: notBuilt('remove_sequence'),
});
defineOp({
  name: 'replace_clip_keyframes',
  version: 1,
  description: 'Replace the whole keyframe list of one property (x, y, scale, rotation or opacity) of a clip in one step, with the rules of set_keyframe: times are clip-local, frame-aligned, not negative and strictly increasing; at most 2000 keys. keys null removes every key of that property and keeps the value it had at `at` (default the clip start), as clear_keyframes does. An adjustment clip takes opacity keys only; a caption cue has no keyframes.',
  args: SequenceOpArgs.replace_clip_keyframes,
  apply: notBuilt('replace_clip_keyframes'),
});
defineOp({
  name: SEQUENCE_PLAN_OP,
  version: 1,
  internal: true,
  description: 'Apply a shorts plan (ordinary public ops with bindings to earlier steps) as one step: optionally remove the plan-made shorts it rebuilds, make the new sequences, write their measured origin, and record the run. Issued only by the server from a plan it built; never from a proposal. Rule-based; no model.',
  args: ApplySequencePlanArgsSchema,
  apply: notBuilt(SEQUENCE_PLAN_OP),
});
