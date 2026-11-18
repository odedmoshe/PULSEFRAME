/**
 * The sequence lifecycle (ADR-0018): add_sequence, update_sequence, remove_sequence, replace_clip_keyframes (public) and
 * apply_sequence_plan (internal). Registered on import of this module (packages/core/src/index.ts exports it); every one runs
 * only through applyTransaction.
 *
 * The lead's contract fixes the names, versions, descriptions and argument schemas (shortsContract.ts SequenceOpArgs,
 * ApplySequencePlanArgsSchema), the outputs, and every refusal with its code, English wording and hint (SEQUENCE_REFUSALS;
 * the Hebrew wording is packages/i18n/src/shorts.ts HE_SHORTS). The apply bodies (shorts W1) follow the rules below;
 * SEQUENCE_OPS_BUILT turns the fuzz rows on.
 *
 * RULES OF THE BODIES (plan §4.1, the W1 brief, wave4-decisions.md)
 * - Ids: ctx.newId('seq') for a sequence; tracks through ops.ts newTrack, 'standard' = V1 video, T1 text, A1 audio.
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
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { assertAligned, collectCreated, defineOp, keyframeRefusal, refuseUnbuiltCurve, dissolveLoneLinks, findClip, getOp, isLiveCreated, linkIdsOf, mustClip, newTrack, OpError, refuseAdjustmentTransform, refuseInheritedIds, type OpContext } from './ops.ts';
import { MAX_SEQUENCES, TransformSchema, type Keyframe, type ProjectDocument, type Sequence, type SequenceFormat } from './schema.ts';
import { ApplySequencePlanArgsSchema, SEQUENCE_PLAN_OP, SEQUENCE_SUMMARIES, SequenceOpArgs, sequenceRefusal, SHORTS_RUN_ID, type AddSequenceOutput, type ApplySequencePlanOutput, type RemoveSequenceOutput, type ReplaceClipKeyframesOutput } from './shortsContract.ts';
import { sequenceOf } from './sequences.ts';
import { fingerprint, trackOrderEntityId } from './entities.ts';
import { sampleKeyframes, TRANSFORM_RANGE } from './animation.ts';
import { resolveBindings } from './templateOps.ts';

/** True once W1 has built the bodies: the operations fuzz (packages/evals/src/ops-fuzz.gen.ts) then draws the sequence rows. */
export const SEQUENCE_OPS_BUILT = true;

const mustSequence = (d: ProjectDocument, sequenceId: string): Sequence => {
  const seq = sequenceOf(d, sequenceId);
  if (!seq) throw sequenceRefusal('sequenceNotFound', { sequenceId, available: Object.keys(d.sequences) }, sequenceId);
  return seq;
};
const refuseOddFormat = (f: SequenceFormat | null | undefined) => {
  if (f && (f.width % 2 || f.height % 2)) throw sequenceRefusal('sequenceFormatOdd', { width: f.width, height: f.height });
};
const clipCount = (seq: Sequence) => seq.tracks.reduce((n, t) => n + t.clips.length, 0);

/** add_sequence's body (also a step of apply_sequence_plan). */
function addSequence(d: ProjectDocument, a: z.infer<typeof SequenceOpArgs.add_sequence>, ctx: OpContext): { output: AddSequenceOutput; affectedIds: string[] } {
  const count = Object.keys(d.sequences).length;
  if (count >= MAX_SEQUENCES) throw sequenceRefusal('tooManySequences', { max: MAX_SEQUENCES, count });
  refuseOddFormat(a.format);
  const id = ctx.newId('seq');
  const seq: Sequence = { id, name: a.name, tracks: [], ...(a.format ? { format: structuredClone(a.format) } : {}) };
  d.sequences[id] = seq;
  const standard = (a.tracks ?? 'standard') === 'standard';
  // as createProject lays out a new project (schema.ts): V1, T1, A1, bottom-most first
  const output: AddSequenceOutput = standard
    ? { sequenceId: id, videoTrackId: newTrack(seq, 'video', ctx).id, textTrackId: newTrack(seq, 'text', ctx).id, audioTrackId: newTrack(seq, 'audio', ctx).id }
    : { sequenceId: id, videoTrackId: null, textTrackId: null, audioTrackId: null };
  return { output, affectedIds: [id, trackOrderEntityId(id), ...seq.tracks.map((t) => t.id)] };
}

/** remove_sequence's body with contents (also the rebuild of apply_sequence_plan): the tracks, clips and markers go with it. */
function removeSequence(d: ProjectDocument, seq: Sequence): RemoveSequenceOutput & { unlinkedClipIds: string[] } {
  const locked = seq.tracks.find((t) => t.locked);
  if (locked) throw new OpError('track_locked', `track ${locked.id} is locked`, { trackId: locked.id, sequenceId: seq.id }, 'Unlock the track first (update_track locked=false).');
  const clips = seq.tracks.flatMap((t) => t.clips);
  const removedMarkerIds = Object.values(d.markers ?? {}).filter((m) => m.sequenceId === seq.id).map((m) => m.id);
  for (const id of removedMarkerIds) delete d.markers[id];
  delete d.sequences[seq.id];
  // a clip elsewhere that was linked to a clip of this sequence is linked to nothing now (ops.ts dissolveLoneLinks)
  const unlinkedClipIds = dissolveLoneLinks(d, linkIdsOf(clips));
  return { removedTrackIds: seq.tracks.map((t) => t.id), removedClipIds: clips.map((c) => c.id), removedMarkerIds, unlinkedClipIds };
}
const removedIds = (seq: Sequence, r: ReturnType<typeof removeSequence>) => [seq.id, trackOrderEntityId(seq.id), ...r.removedTrackIds, ...r.removedClipIds, ...r.removedMarkerIds, ...r.unlinkedClipIds];

defineOp({
  name: 'add_sequence',
  version: 1,
  description: `Add a sequence to the project: an edit of its own beside the main one (a short is one), with its own name and optionally its own output frame (format: width, height, fit, safe-area guides, loudness). 'standard' tracks (default) are a video, a text and an audio track, as a new project has; 'empty' has none. Every sequence runs at the project frame rate. Range operations take sequenceId to edit it; without it they edit the main sequence. At most ${MAX_SEQUENCES} sequences. Output: sequenceId, videoTrackId, textTrackId, audioTrackId.`,
  args: SequenceOpArgs.add_sequence,
  apply(d, a, ctx) {
    const { output, affectedIds } = addSequence(d, a, ctx);
    return { affectedIds, summary: SEQUENCE_SUMMARIES.added(a.name), output: output as unknown as Record<string, unknown> };
  },
});
defineOp({
  name: 'update_sequence',
  version: 1,
  description: 'Rename a sequence or change its own output frame (format null removes it, so it renders at the project frame). The main sequence takes its frame from the project settings (set_project_format) and cannot have a format of its own.',
  args: SequenceOpArgs.update_sequence,
  apply(d, a) {
    const seq = mustSequence(d, a.sequenceId);
    if (a.name === undefined && a.format === undefined) throw sequenceRefusal('sequenceNothingToChange', { sequenceId: seq.id });
    if (a.format && seq.id === d.mainSequenceId) throw sequenceRefusal('mainSequenceFormat', { sequenceId: seq.id });
    refuseOddFormat(a.format);
    if (a.name !== undefined) seq.name = a.name;
    let note = '';
    if (a.format !== undefined) {
      const before = seq.format;
      if (a.format === null) delete seq.format; else seq.format = structuredClone(a.format);
      const frameChanged = (before?.width ?? null) !== (seq.format?.width ?? null) || (before?.height ?? null) !== (seq.format?.height ?? null) || (before?.fit ?? null) !== (seq.format?.fit ?? null);
      // x keys are fractions of the frame width: a reframe made for the old frame does not fit the new one
      if (frameChanged && seq.tracks.some((t) => t.clips.some((c) => c.keyframes?.x?.length))) note = '; its x keyframes were made for the old frame (plan the reframe again)';
    }
    return { affectedIds: [seq.id], summary: `${SEQUENCE_SUMMARIES.updated(seq.name)}${note}` };
  },
});
defineOp({
  name: 'remove_sequence',
  version: 1,
  description: 'Remove a sequence that is not the main one. A sequence that still has clips is removed only with withContents: true, which also removes its tracks, clips and markers. Refused while one of its tracks is locked.',
  args: SequenceOpArgs.remove_sequence,
  apply(d, a) {
    const seq = mustSequence(d, a.sequenceId);
    if (seq.id === d.mainSequenceId) throw sequenceRefusal('mainSequence', { sequenceId: seq.id });
    const locked = seq.tracks.find((t) => t.locked);
    if (locked) throw new OpError('track_locked', `track ${locked.id} is locked`, { trackId: locked.id, sequenceId: seq.id }, 'Unlock the track first (update_track locked=false).');
    const clips = clipCount(seq);
    if (clips && !a.withContents) throw sequenceRefusal('sequenceNotEmpty', { sequenceId: seq.id, clips }, clips);
    const r = removeSequence(d, seq);
    const { unlinkedClipIds: _u, ...output } = r;
    return { affectedIds: removedIds(seq, r), summary: SEQUENCE_SUMMARIES.removed(seq.name), output: { ...output } };
  },
});
defineOp({
  name: 'replace_clip_keyframes',
  version: 1,
  description: 'Replace the whole keyframe list of one property (x, y, scale, rotation or opacity) of a clip in one step, with the rules of set_keyframe: times are clip-local, frame-aligned, not negative and strictly increasing; at most 2000 keys. keys null removes every key of that property and keeps the value it had at `at` (default the clip start), as clear_keyframes does. An adjustment clip takes opacity keys only; a caption cue has no keyframes.',
  args: SequenceOpArgs.replace_clip_keyframes,
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    if (clip.type === 'caption') throw sequenceRefusal('captionKeys', { clipId: clip.id });
    if (a.property !== 'opacity') refuseAdjustmentTransform(clip, { [a.property]: NaN }, 'animated'); // any key on these properties
    const p = a.property;
    // ADR-0019 contracts: the range form and the new curves are refused as not built until keyframe W1 builds them here
    if (a.from !== undefined || a.to !== undefined) throw keyframeRefusal('notBuilt', { clipId: clip.id }, 'the range form of replace_clip_keyframes');
    for (const k of a.keys ?? []) refuseUnbuiltCurve(k.easing, k.bezier);
    if (a.keys === null) {
      // as clear_keyframes: the property keeps the value it had at `at`
      const old = clip.keyframes?.[p];
      if (old?.length) {
        clip.transform = { ...clip.transform, [p]: sampleKeyframes(old, a.at ?? T.ZERO, TRANSFORM_RANGE[p]) };
        const kf = { ...clip.keyframes };
        delete kf[p];
        if (Object.keys(kf).length) clip.keyframes = kf; else delete clip.keyframes;
      }
      const out: ReplaceClipKeyframesOutput = { keyframeCount: 0 };
      return { affectedIds: old?.length ? [clip.id] : [], summary: SEQUENCE_SUMMARIES.keys(p, 0), output: { ...out } };
    }
    const keys: Keyframe[] = [];
    for (const [i, k] of a.keys.entries()) {
      assertAligned(d, k.time, `keyframe ${i + 1} time`);
      if (T.isNegative(k.time)) throw sequenceRefusal('keyBeforeStart', { index: i, time: k.time });
      if (i > 0 && !T.lt(a.keys[i - 1]!.time, k.time)) throw sequenceRefusal('keysNotIncreasing', { index: i });
      if (!TransformSchema.shape[p].safeParse(k.value).success) throw new OpError('invalid_args', `value ${k.value} is out of range for ${p}`, { property: p, index: i });
      keys.push({ time: k.time, value: k.value, easing: k.easing });
    }
    clip.keyframes = { ...clip.keyframes, [p]: keys };
    const out: ReplaceClipKeyframesOutput = { keyframeCount: keys.length };
    return { affectedIds: [clip.id], summary: SEQUENCE_SUMMARIES.keys(p, keys.length), output: { ...out } };
  },
});
defineOp({
  name: SEQUENCE_PLAN_OP,
  version: 1,
  internal: true,
  description: 'Apply a shorts plan (ordinary public ops with bindings to earlier steps) as one step: optionally remove the plan-made shorts it rebuilds, make the new sequences, write their measured origin, and record the run. Issued only by the server from a plan it built; never from a proposal. Rule-based; no model.',
  args: ApplySequencePlanArgsSchema,
  apply(d, a, ctx) {
    const affected = new Set<string>();
    const earlier = a.runId !== undefined && Object.hasOwn(d.recipeRuns, a.runId) ? d.recipeRuns[a.runId] : undefined;
    if (earlier && earlier.recipeId !== SHORTS_RUN_ID) throw new OpError('invalid_args', `run ${a.runId} is a run of ${earlier.recipeId}, not of ${SHORTS_RUN_ID}`, { runId: a.runId, recipeId: earlier.recipeId });
    // 1. a rebuild: the plan-made shorts it replaces go first, with their tracks, clips and markers
    for (const id of new Set(a.removeSequenceIds ?? [])) {
      const seq = mustSequence(d, id);
      if (seq.id === d.mainSequenceId || seq.origin?.kind !== 'short') throw sequenceRefusal('notPlanMade', { sequenceId: seq.id }, seq.id);
      for (const x of removedIds(seq, removeSequence(d, seq))) affected.add(x);
    }
    // 2. the steps, each with its bindings resolved against the steps before it only
    const bound = new Map<string, Readonly<Record<string, unknown>>>();
    const created: string[] = [];
    const createdSequences: string[] = [];
    for (const [i, step] of a.ops.entries()) {
      const def = getOp(step.op);
      if (!def || def.internal) throw sequenceRefusal('planStepForbidden', { index: i, op: step.op }, i, step.op);
      if (step.bind !== undefined && bound.has(step.bind)) throw sequenceRefusal('planStepInvalid', { index: i, bind: step.bind }, i, step.op, `the bind name "${step.bind}" is used twice`);
      const where = `plan step ${i} (${step.op})`;
      const args = resolveBindings(step.args, bound, new Map(), where);
      const parsed = def.args.safeParse(args);
      if (!parsed.success) throw sequenceRefusal('planStepInvalid', { index: i, op: step.op }, i, step.op, z.prettifyError(parsed.error));
      refuseInheritedIds(parsed.data, where, '', def.checksOwnIds);
      const r = def.apply(d, parsed.data, ctx);
      for (const id of r.affectedIds) affected.add(id);
      const out = r.output ?? {};
      collectCreated(out, created);
      if (step.op === 'add_sequence' && typeof out.sequenceId === 'string') createdSequences.push(out.sequenceId);
      if (step.bind !== undefined) bound.set(step.bind, out);
    }
    // 3. measured provenance, written only onto sequences an add_sequence step of THIS plan made
    for (const [i, o] of a.origins.entries()) {
      let id: unknown;
      try { id = o.sequence.out === 'sequenceId' ? resolveBindings(o.sequence, bound, new Map(), `origin ${i}`) : undefined; } catch (e) { if (!(e instanceof OpError)) throw e; id = undefined; }
      const seq = typeof id === 'string' && createdSequences.includes(id) ? sequenceOf(d, id) : undefined;
      if (!seq) throw sequenceRefusal('originNotCreated', { index: i, ref: o.sequence.$ref }, i);
      seq.origin = structuredClone(o.origin);
      affected.add(seq.id);
    }
    // 4. the run record: what still exists of what the plan made, and the fingerprints of its clips
    const runId = a.runId ?? ctx.newId('run');
    const createdIds = [...new Set(created)].filter((x) => isLiveCreated(d, x));
    const fingerprints: Record<string, string> = {};
    for (const cid of createdIds) { const f = findClip(d, cid); if (f) fingerprints[cid] = fingerprint(f.clip); }
    d.recipeRuns[runId] = { id: runId, recipeId: SHORTS_RUN_ID, params: structuredClone(a.params), createdIds, fingerprints, steps: [...a.steps] };
    affected.add(runId);
    const sequenceIds = createdSequences.filter((id) => Object.hasOwn(d.sequences, id));
    const output: ApplySequencePlanOutput = { runId, createdIds, sequenceIds };
    const summary = a.removeSequenceIds?.length ? SEQUENCE_SUMMARIES.rebuilt(sequenceIds.length) : SEQUENCE_SUMMARIES.made(sequenceIds.length);
    return { affectedIds: [...affected], summary, output: output as unknown as Record<string, unknown> };
  },
});
