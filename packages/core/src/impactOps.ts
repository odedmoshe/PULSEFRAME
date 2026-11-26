/**
 * The marked moment «הרגע» and impact sync «אל הפעימה» (wave 7 musicfit track; .artifacts/wave7/musicfit-decisions.md §2.8, §2.10).
 * Registered on import (index.ts). The lead fixes names, versions, descriptions and argument schemas (musicFitContract.ts); BUILDER A
 * wrote the bodies (built); MUSICFIT_OPS_BUILT (musicFitOps.ts) turns the fuzz rows on.
 *
 * RULES OF A's BODIES:
 * - Refuse only with musicFitRefusal(...), in the order MUSICFIT_REFUSALS lists for each op. Undo is the generic one (the clip entity).
 * - set_clip_impact: a media clip on a video or sound track whose file is not a still and which is not a freeze frame; moment in
 *   [0, file duration) (exact; any alignment); null deletes the key. Writes nothing else.
 * - sync_impact: positions through speed.ts timelineOfSource (reverse-aware; never timelineAt). The moment's frame is the frame that
 *   shows it; a beat's frame is the NEAREST frame (as the cut read-out, apps/web/src/editor/inspector.model.ts). Beats come from core
 *   musicGrid.ts musicAt (first followable sound clip in track order, muted tracks skipped, beatsFor through lineage). by = f_m − f_b
 *   frames as a timeline amount for a forward clip, f_b − f_m for a reversed one; the slip goes through slip_clip's own registered
 *   body (getOp('slip_clip')), so linked sound slips with it and every slip_clip refusal is kept. After the slip the moment's frame is
 *   recomputed on the draft: invalid_result unless it is the target. Output SyncImpactOutput; residual signed, at most half a frame.
 * - Summaries name the clip's file and the frames, never a person.
 */
import * as T from '@pulseframe/time';
import { defineOp, getOp, mustClip, OpError } from './ops.ts';
import type { MediaClip } from './schema.ts';
import { musicFitRefusal, SetClipImpactArgsSchema, SyncImpactArgsSchema, type SyncImpactOutput } from './musicFitContract.ts';
import { canHoldMoment, frameShowing, planImpact } from './impact.ts';

const fmt = (t: T.RationalTime) => `${(Math.round(T.toSeconds(t) * 1000) / 1000).toString()} s`;
defineOp({
  name: 'set_clip_impact',
  version: 1,
  description: 'Mark the action moment of a video or sound clip («הרגע»: the jump, the candle catching) as a time of the clip\'s FILE, or clear it with null. Changes no picture or sound: sync_impact uses it. A marked clip counts as edited by hand when a family film, template or montage is made again, so it is kept as it is. Refused for a still, a freeze frame or a title, and for a moment outside the file.',
  args: SetClipImpactArgsSchema,
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    if (!canHoldMoment(d, a.clipId)) throw musicFitRefusal('impactNoMoment', { clipId: a.clipId });
    const c = clip as MediaClip, asset = d.assets[c.assetId]!;
    if (a.moment === null) {
      delete c.impact;
      return { affectedIds: [c.id], summary: `Cleared the marked moment of ${asset.name}`.slice(0, 200), output: { moment: null } };
    }
    if (T.isNegative(a.moment) || !T.lt(a.moment, asset.duration)) throw musicFitRefusal('impactOutsideFile', { clipId: a.clipId, moment: a.moment, fileDuration: asset.duration });
    c.impact = a.moment;
    return { affectedIds: [c.id], summary: `Marked the moment at ${fmt(a.moment)} of ${asset.name}`.slice(0, 200), output: { moment: a.moment } };
  },
});
defineOp({
  name: 'sync_impact',
  version: 1,
  description: 'Slide the source of a clip (place and length on the timeline never change; linked sound moves with it, as slip_clip) so that its marked moment shows on the frame of the nearest beat, or bar start, of the music playing under it (beats measured or known from the recipe). With moment, the moment is marked first. pick: nearest (default; a tie goes to the earlier), earlier or later. The output gives the offset before in frames and ms and the residual after (under half a frame; screen and speaker delays are not calibrated). Refused when nothing is marked, the moment is outside what the clip shows, no music with beats plays under it, the file has no material that far, or it is already on that frame.',
  args: SyncImpactArgsSchema,
  apply(d, a, ctx) {
    const { clip } = mustClip(d, a.clipId);
    const plan = planImpact(d, a.clipId, a.moment, a.to, a.pick ?? 'nearest');
    if ('refusal' in plan) throw musicFitRefusal(plan.refusal, plan.details);
    const c = clip as MediaClip, asset = d.assets[c.assetId]!;
    if (a.moment !== undefined) c.impact = a.moment;
    // through slip_clip's own registered body: linked sound slips with it and every refusal of slip_clip is kept
    const slip = getOp('slip_clip')!;
    const slipped = slip.apply(d, slip.args.parse({ clipId: a.clipId, by: plan.by }), ctx);
    const after = frameShowing(c, plan.moment, d.settings.frameRate);
    if (after !== plan.targetFrame) throw new OpError('invalid_result', `the moment would show on frame ${after} instead of the beat's frame ${plan.targetFrame}`, { clipId: a.clipId, frame: after, target: plan.targetFrame });
    const output: SyncImpactOutput = { by: plan.by, target: T.frameTime(plan.targetFrame, d.settings.frameRate), offsetBefore: plan.offsetBefore, residualMs: plan.residualMs, musicClipId: plan.musicClipId, viaAssetId: plan.viaAssetId, wanted: plan.wanted, used: plan.used };
    const n = plan.offsetBefore.frames;
    return {
      affectedIds: [...new Set([c.id, ...slipped.affectedIds])],
      summary: `Brought the marked moment of ${asset.name} to the ${a.to === 'bar' ? 'bar start' : 'beat'} on frame ${plan.targetFrame} (it was ${Math.abs(n)} frame${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'after' : 'before'} it)`.slice(0, 200),
      output: output as unknown as Record<string, unknown>,
    };
  },
});
