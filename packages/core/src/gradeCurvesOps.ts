/**
 * set_grade_curves «עקומות» (wave 8 grade; grade-plan.md §3.2 as corrected by grade-verify.md C10). LEAD-built, complete: the body is
 * small and settled by the verifier. Registered on import (index.ts).
 * - Replace only (no `merge`, C10a): the given channels become the clip's curves; a missing channel is the identity; `curves: null`
 *   removes them all («איפוס העקומות»). Identity channels are dropped (canonicalGradeCurves).
 * - Placement exactly where set_colour_grade puts the grade: the clip's FIRST color.grade, in place (same id; turned on when curves
 *   are set). None and curves to set: a neutral grade is added first in the list (after a time effect). None and no curves: NOTHING
 *   is added (C10b: a neutral GPU effect would make export refuse on a machine without an adapter).
 * - Refusals (OpError, Hebrew in packages/i18n/src/grade.ts HE_GRADE, each with the next step): curve_count, curve_value,
 *   curve_points, 16 effects; caption, audio and locked clips get the existing pictureClip / mustClip refusals.
 * - Undo: the generic entity diff (exact). Not GPU-gated at storage, like set_colour_grade.
 * - In ASSISTANT_EXCLUDED_OPS for version 1 (C10c), so the reviewed assistant prompts are unchanged; on MCP apply_transaction and REST.
 */
import { z } from 'zod';
import { defineOp, effectSlot, OpError, parseEffect, pictureClip } from './ops.ts';
import { canonicalGradeCurves, GRADE_CURVE_GRID, GRADE_CURVE_MAX_POINTS, GRADE_CURVE_MIN_GAP, GRADE_CURVE_MIN_POINTS, gradeCurvesIssue, type GradeCurveChannel } from './gradeCurves.ts';

/** Loose on purpose: the body words what is wrong (count, values, order) instead of the generic argument refusal. */
const PointsArg = z.array(z.tuple([z.number(), z.number()])).max(64);
export const SetGradeCurvesArgsSchema = z.object({
  clipId: z.string(),
  curves: z.object({ master: PointsArg.optional(), r: PointsArg.optional(), g: PointsArg.optional(), b: PointsArg.optional() }).strict().nullable()
    .describe('the clip\'s curves after the step (replace): each [[input, output], …] in code values 0..255, first input 0, last 255, inputs at least 4 apart, 2 to 12 points; a channel left out is the identity; null removes every curve'),
}).strict();

/** The English refusal sentences (fixed; HE_GRADE words each in Hebrew with the next step). */
export const GRADE_CURVE_MESSAGES = {
  curve_count: (ch: GradeCurveChannel) => `the ${ch} curve needs ${GRADE_CURVE_MIN_POINTS} to ${GRADE_CURVE_MAX_POINTS} points`,
  curve_value: (ch: GradeCurveChannel) => `every value of the ${ch} curve must be a whole number from 0 to ${GRADE_CURVE_GRID}`,
  curve_points: (ch: GradeCurveChannel) => `the ${ch} curve must start at input 0 and end at input ${GRADE_CURVE_GRID}, with points left to right at least ${GRADE_CURVE_MIN_GAP} apart`,
  too_many_effects: () => 'a clip can carry at most 16 effects',
} as const;
const HINTS = {
  curve_count: `Give between ${GRADE_CURVE_MIN_POINTS} and ${GRADE_CURVE_MAX_POINTS} points; remove a point or join two.`,
  curve_value: `Round every input and output to a whole number from 0 to ${GRADE_CURVE_GRID}.`,
  curve_points: `Sort the points by input, keep the first at 0 and the last at ${GRADE_CURVE_GRID}, and leave at least ${GRADE_CURVE_MIN_GAP} between inputs.`,
} as const;

defineOp({
  name: 'set_grade_curves',
  version: 1,
  description: 'Set the colour curves «עקומות» of a picture, title or adjustment clip\'s colour grade (color.grade), where set_colour_grade puts it: the clip\'s first colour grade is changed in place (same id, turned on), or a neutral one is added first in its effect list (after a time effect). Up to four curves: master, r, g, b; each maps code values 0..255 (after the transfer function, not light) with 2 to 12 whole-number points [input, output], first input 0, last 255, inputs at least 4 apart, joined by a monotone cubic (PCHIP). The curves act after the grade\'s sliders and before a colour table further down the list; each channel\'s curve first, then the master. The given curves replace the clip\'s curves; a channel left out is the identity; curves null removes them all (a clip without a grade gets none added). Ready-made curves: soft contrast master [[0,0],[64,56],[192,200],[255,255]]; faded master [[0,24],[128,128],[255,236]]; cinematic look master [[0,10],[64,54],[192,204],[255,246]], r [[0,0],[128,132],[255,255]], b [[0,8],[128,124],[255,248]] (nobody has looked at them on real footage). Curves are not animatable. Needs a graphics adapter (WebGPU) to be shown and exported.',
  args: SetGradeCurvesArgsSchema,
  apply(d, a, ctx) {
    const { clip } = pictureClip(d, a.clipId);
    if (a.curves) {
      const bad = gradeCurvesIssue(a.curves);
      if (bad) throw new OpError(bad.issue === 'curve_points' ? 'invalid_args' : 'out_of_bounds', GRADE_CURVE_MESSAGES[bad.issue](bad.channel), { clipId: clip.id, channel: bad.channel, reason: bad.issue }, HINTS[bad.issue]);
    }
    const curves = canonicalGradeCurves(a.curves);
    const list = [...(clip.effects ?? [])];
    const at = list.findIndex((e) => e.type === 'color.grade');
    if (at < 0 && !curves) return { affectedIds: [clip.id], summary: 'No colour curves to remove', output: { effectId: null, curves: null } };
    let effectId: string;
    if (at >= 0) {
      const { curves: _old, ...rest } = list[at]!;
      list[at] = curves ? { ...rest, enabled: true, curves } : rest;
      effectId = rest.id;
    } else {
      if (list.length >= 16) throw new OpError('out_of_bounds', GRADE_CURVE_MESSAGES.too_many_effects(), { clipId: clip.id }, 'Remove an effect the clip does not need, then set the curves again.');
      effectId = ctx.newId('fx');
      list.splice(effectSlot(list, 'color.grade', 0), 0, { id: effectId, type: 'color.grade', enabled: true, params: parseEffect('color.grade', {}), curves: curves! });
    }
    clip.effects = list;
    return { affectedIds: [clip.id], summary: curves ? 'Set colour curves' : 'Removed the colour curves', output: { effectId, curves } };
  },
});
