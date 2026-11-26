/**
 * The two operations of «תמונה חיה» (wave 8 living; livingContract.ts). Registered on import (index.ts). Undo is the generic one
 * (the clip entity). Both are in ASSISTANT_EXCLUDED_OPS (the reviewed assistant prompt is unchanged); they stay on MCP and REST.
 *
 * set_clip_depth: LEAD-BUILT, complete (small and settled by verifier C6/C13).
 * set_living_picture: the body is W1's. Until LIVING_BUILT it refuses notBuilt and changes nothing. The body W1 writes, in this
 * order of refusals: mustClip (not found, locked) → notPhoto (a media clip of an image file on a video track; adjustment clips are
 * not media) → remove:true (drop the instance and its keys, the depth stays; nothing else checked) → rotated (rotation ≠ 0 or rotation
 * keys) → tooShort (livingLongEnough) → needsDepth (no `depth` given and the clip has none: no depth is ever guessed and stored, C13)
 * → depthInvalid (depthProblems of the given depth) → tooFast (amount > livingMaxAmount for the clip's frames, move and curve; the
 * details and the sentence carry max) → the 16-effect cap (add_effect's sentence). Then in the SAME transaction: write the depth when
 * given; add the one depth.living instance (or update the one there is) with move and amount; key travel 0 at clip-local frame 0 with
 * the curve and 1 at the last frame (livingTravelKeys); replace the clip's whole-clip moves (motion.move.*, Ken Burns) with the
 * living picture (livingReplacedMotion, C3), reporting them in output.replacedMotion so the editor says «התנועה הקודמת הוחלפה בתמונה
 * חיה». One undo removes all of it.
 */
import { defineOp, livingRefusal, mustClip } from './ops.ts';
import { depthProblems, LIVING_BUILT, LIVING_EFFECT, SetClipDepthArgsSchema, SetLivingPictureArgsSchema } from './livingContract.ts';
import type { ProjectDocument } from './schema.ts';

/** The photo clip an op of this track works on (refusal notPhoto otherwise). */
export function mustPhotoClip(d: ProjectDocument, clipId: string) {
  const f = mustClip(d, clipId);
  const c = f.clip;
  const asset = c.type === 'media' && Object.hasOwn(d.assets, c.assetId) ? d.assets[c.assetId] : undefined;
  if (c.type !== 'media' || f.track.kind !== 'video' || asset?.kind !== 'image') throw livingRefusal('notPhoto', { clipId });
  return { ...f, clip: c };
}

defineOp({
  name: 'set_living_picture',
  version: 1,
  description: 'Make a photo clip a living picture («תמונה חיה»): the photo moves slowly in depth, what was drawn as near more than what is far. Needs a depth drawn on the photo: pass `depth` ({v:1, base: ramp with a horizon or flat, strokes of near/far soft brush}) or set it first with set_clip_depth; nothing is estimated. Moves: push (a slow push in, default) or slide. The amount (default 0.5) is capped by the clip length by a comfort rule of thumb; above it the refusal names the highest amount that fits. Replaces the clip\'s Ken Burns move in the same step. remove:true takes the living picture away (the depth stays). Photos only, not rotated; needs a graphics adapter to be seen.',
  args: SetLivingPictureArgsSchema,
  apply(d, a) {
    // W1 replaces this with the body described in this file's header (and sets LIVING_BUILT).
    throw livingRefusal('notBuilt', { clipId: a.clipId, built: LIVING_BUILT });
  },
});

defineOp({
  name: 'set_clip_depth',
  version: 1,
  description: 'Set or replace the depth drawn on a photo clip (what is near and what is far, for its living picture): {v:1, base: {kind:"ramp", horizon 0..999 in 1/1000 of the height} or {kind:"flat"}, strokes: up to 64 of {layer near|far, size 5..300 (1/1000 of the short side), pts [x,y,…] 0..1000}}, at most 8192 numbers. The whole record is replaced at once. null removes it, refused while the clip has a living picture (remove that first).',
  args: SetClipDepthArgsSchema,
  apply(d, a) {
    const { clip } = mustPhotoClip(d, a.clipId);
    if (a.depth === null) {
      if ((clip.effects ?? []).some((e) => e.type === LIVING_EFFECT)) throw livingRefusal('depthInUse', { clipId: clip.id });
      delete clip.depth;
      return { affectedIds: [clip.id], summary: 'Removed the drawn depth' };
    }
    const problems = depthProblems(a.depth);
    if (problems.length) throw livingRefusal('depthInvalid', { clipId: clip.id, problems }, problems.join('; '));
    clip.depth = structuredClone(a.depth);
    return { affectedIds: [clip.id], summary: `Drew the depth (${a.depth.base.kind}, ${a.depth.strokes.length} strokes)`, output: { strokes: a.depth.strokes.length } };
  },
});
