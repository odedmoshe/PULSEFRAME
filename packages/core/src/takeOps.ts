/**
 * apply_take (internal, v1; ADR-0025 perform mode): a performance take as ONE step — ordinary public operations from
 * TAKE_STEP_OPS with {$ref} bindings to earlier steps — and its run record (recipeId PERFORM_RECIPE_ID). Lead-built.
 * Issued only by the server from a plan it built (apps/server/src/perform.ts, POST /api/v1/projects/:id/takes), like
 * apply_template (ADR-0016 decision 5): the arguments carry the resolved steps, so replay never reads the pad catalogue.
 * The browser runs the same op on an in-memory document for its preview (applyTransaction with allowInternal; nothing is sent).
 *
 * The op does not trust the plan:
 * - every step must be in TAKE_STEP_OPS (forbidden_op otherwise); $asset bindings are refused (a take carries no media);
 * - at most MAX_TAKE_STEPS steps (schema) and MAX_TAKE_TRACKS add_track steps;
 * - every step works on the take's sequence: a step that names another (sequenceId; left out = the main sequence) or targets a
 *   clip in another is refused (otherSequence);
 * - a step that would write the light of a clip the take did not make (opacity keys, its opacity, a motion that keys opacity,
 *   keys on an effect that changes light) is refused (lightOwned, details.reason 'flash_limit', why 'owned');
 * - after the steps ran, the flash rule (performFlash.ts takeFlashBreach, with the frozen version-1 table) is checked on the
 *   sequence, key changes on the clips the take made included; a breach refuses the whole take with incompatible,
 *   details.reason 'flash_limit'.
 * A step's own refusal is passed on in its own words, with details.step and details.stepOp. Undo is the store's ordinary undo of
 * one transaction (entity diffs), so the take undoes exactly.
 */
import { z } from 'zod';
import { collectCreated, defineOp, findClip, getOp, OpError, refuseInheritedIds, runFingerprints } from './ops.ts';
import { resolveBindings } from './templateOps.ts';
import type { ProjectDocument } from './schema.ts';
import { ApplyTakeArgsSchema, MAX_TAKE_TRACKS, PERFORM_RECIPE_ID, PERFORM_TAKE_VERSION, TAKE_STEP_OPS, type ApplyTakeOutput, type PlannedTake, type TakeRequest, type TakeStepOp } from './performContract.ts';
import { PERFORM_REFUSALS as R } from './performRefusals.ts';
import { effectChangesLightIn, FLASH_TABLE_V1, opacityChangesLight, takeFlashBreach, type FlashTable } from './performFlash.ts';
import { MOTION_PRESETS } from './motionPresets.ts';
import { performGrid, planPerformance, quantiseTaps } from './moves.ts';

const STEP_OPS: ReadonlySet<string> = new Set(TAKE_STEP_OPS);
/** The step ops that name their sequence (sequenceId; left out = the main sequence). Every other step op targets a clip (clipId). */
export const TAKE_SEQUENCE_STEP_OPS: readonly TakeStepOp[] = ['add_track', 'add_adjustment', 'add_clip', 'add_text'];
const SEQUENCE_STEP_OPS: ReadonlySet<string> = new Set(TAKE_SEQUENCE_STEP_OPS);
/**
 * The clip whose light a step would write (opacity keys, its opacity, a motion that keys opacity, or keys on an effect that
 * changes light; by the frozen table), or null. Read before the step runs, on the clip as it is.
 */
function lightTarget(d: ProjectDocument, op: string, args: Readonly<Record<string, unknown>>, table: FlashTable): string | null {
  if (typeof args.clipId !== 'string') return null;
  const clip = findClip(d, args.clipId)?.clip;
  if (!clip) return null; // the step refuses in its own words
  const opacity = opacityChangesLight(clip, table);
  switch (op) {
    case 'set_keyframe': case 'replace_clip_keyframes': return args.property === 'opacity' && opacity ? clip.id : null;
    case 'set_clip_transform': { const t = args.transform; return opacity && typeof t === 'object' && t !== null && Object.hasOwn(t, 'opacity') ? clip.id : null; }
    case 'apply_motion_preset': return opacity && !!MOTION_PRESETS.find((m) => m.id === args.presetId)?.properties.includes('opacity') ? clip.id : null;
    case 'set_effect_keyframe': { const fx = (clip.effects ?? []).find((e) => e.id === args.effectId); return fx && effectChangesLightIn(table, fx.type) ? clip.id : null; }
    default: return null;
  }
}
const NO_ASSETS: ReadonlyMap<string, string> = new Map();
const hasAssetBinding = (v: unknown, depth = 0): boolean => {
  if (depth > 64 || typeof v !== 'object' || v === null) return false;
  if (Array.isArray(v)) return v.some((x) => hasAssetBinding(x, depth + 1));
  return Object.hasOwn(v, '$asset') || Object.values(v).some((x) => hasAssetBinding(x, depth + 1));
};

defineOp({
  name: 'apply_take',
  version: 1,
  internal: true,
  description: 'Apply a performance take (perform mode): ordinary public operations (tracks, adjustment clips, sounds, titles, stickers and keys) with bindings to earlier steps, as one step, and record the run. Issued by the server from the taps it planned (POST /takes); refused when a step is not one a take may run, or when the result would change light faster than three times a second (flash safety).',
  args: ApplyTakeArgsSchema,
  apply(d, a, ctx) {
    const sequenceId = a.sequenceId ?? d.mainSequenceId;
    if (!Object.hasOwn(d.sequences, sequenceId)) throw new OpError('not_found', `sequence ${sequenceId} not found`, { sequenceId });
    const tracks = a.steps.filter((s) => s.op === 'add_track').length;
    if (tracks > MAX_TAKE_TRACKS) throw new OpError(R.tooManyTracks.code, R.tooManyTracks.message(tracks), { tracks, max: MAX_TAKE_TRACKS }, R.tooManyTracks.hint);
    const affected = new Set<string>();
    const bound = new Map<string, Readonly<Record<string, unknown>>>();
    const created: string[] = [];
    const made = new Set<string>();
    for (const [i, step] of a.steps.entries()) {
      const def = getOp(step.op);
      if (!STEP_OPS.has(step.op) || !def || def.internal) throw new OpError(R.forbiddenStep.code, R.forbiddenStep.message(i, step.op), { index: i, op: step.op, allowed: [...TAKE_STEP_OPS] }, R.forbiddenStep.hint);
      if (step.bind !== undefined && bound.has(step.bind)) throw new OpError(R.bindTwice.code, R.bindTwice.message(i, step.bind), { index: i, bind: step.bind }, R.bindTwice.hint);
      if (hasAssetBinding(step.args)) throw new OpError(R.assetBinding.code, R.assetBinding.message(i), { index: i }, R.assetBinding.hint);
      const where = `take step ${i} (${step.op})`;
      const args = resolveBindings(step.args, bound, NO_ASSETS, where);
      const parsed = def.args.safeParse(args);
      if (!parsed.success) throw new OpError('invalid_args', `${where}: ${z.prettifyError(parsed.error)}`, { index: i });
      refuseInheritedIds(parsed.data, where, '', def.checksOwnIds);
      // every step works on the take's sequence (the flash rule reads that one only)
      const pa = parsed.data as Readonly<Record<string, unknown>>;
      const onSeq = SEQUENCE_STEP_OPS.has(step.op) ? (typeof pa.sequenceId === 'string' ? pa.sequenceId : d.mainSequenceId) : typeof pa.clipId === 'string' ? findClip(d, pa.clipId)?.seq.id : undefined;
      if (onSeq !== undefined && onSeq !== sequenceId) throw new OpError(R.otherSequence.code, R.otherSequence.message(i, onSeq, sequenceId), { index: i, sequenceId: onSeq, takeSequenceId: sequenceId, ...(typeof pa.clipId === 'string' ? { clipId: pa.clipId } : {}) }, R.otherSequence.hint);
      // a take changes light only on what it adds (its own clips are judged by the flash rule after the steps)
      const lit = lightTarget(d, step.op, pa, FLASH_TABLE_V1);
      if (lit !== null && !made.has(lit)) throw new OpError(R.lightOwned.code, R.lightOwned.message(i, lit), { reason: 'flash_limit', why: 'owned', clipId: lit, index: i, step: i, stepOp: step.op }, R.lightOwned.hint);
      let r;
      try { r = def.apply(d, parsed.data, ctx); } catch (e) {
        if (e instanceof OpError) throw new OpError(e.code, e.message, { ...e.details, step: i, stepOp: step.op }, e.hint);
        throw e;
      }
      for (const id of r.affectedIds) affected.add(id);
      const out = r.output ?? {};
      const before = created.length;
      collectCreated(out, created);
      for (const id of created.slice(before)) made.add(id);
      if (step.bind !== undefined) bound.set(step.bind, out);
    }
    // version 1 of this op judges with the version-1 table, frozen, so a stored take replays the same (performFlash.ts FlashTable)
    const breach = takeFlashBreach(d, sequenceId, created, FLASH_TABLE_V1);
    if (breach) {
      const details = { reason: 'flash_limit', why: breach.why, clipId: breach.clipId, frame: breach.frame, since: breach.since, gapFrames: breach.gapFrames, ...(breach.other ? { other: breach.other } : {}) };
      const row = breach.why === 'gap' ? R.flashGap : breach.why === 'light' ? R.flashLight : R.flashShort;
      const message = breach.why === 'gap' ? R.flashGap.message(breach.frame, breach.since, breach.gapFrames) : breach.why === 'light' ? R.flashLight.message(breach.frame, breach.gapFrames) : R.flashShort.message(breach.frame, breach.since, breach.gapFrames);
      throw new OpError(row.code, message, details, row.hint);
    }
    const { createdIds, fingerprints } = runFingerprints(d, created, [], {});
    const id = ctx.newId('run');
    const t = a.take;
    d.recipeRuns[id] = {
      id, recipeId: PERFORM_RECIPE_ID,
      params: { version: PERFORM_TAKE_VERSION, sequenceId, snap: t.snap, tempo: t.tempo, parity: t.parity, strength: t.strength, taps: t.taps, hits: t.hits, held: t.held },
      createdIds, fingerprints, steps: t.summary,
    };
    affected.add(id);
    const output: ApplyTakeOutput = { runId: id, createdIds };
    return { affectedIds: [...affected], summary: `Performance take: ${t.hits} hit${t.hits === 1 ? '' : 's'} kept, ${t.held} held`.slice(0, 200), output: { ...output } };
  },
});

/**
 * The whole take as the server (and the browser, for its ghost) plans it: the grid, quantise, then the planner — W1's functions
 * (moves.ts), composed here once so both sides compose them the same way. Throws while they are not built (PERFORM_PLANNER_BUILT).
 */
export function planTakeRequest(doc: ProjectDocument, req: Pick<TakeRequest, 'sequenceId' | 'taps' | 'bank' | 'assets' | 'settings' | 'gpu'>): PlannedTake {
  const grid = performGrid(doc, req.settings, req.sequenceId);
  const hits = quantiseTaps(req.taps, grid, req.settings, doc.settings.frameRate, req.bank);
  return planPerformance(doc, { ...(req.sequenceId ? { sequenceId: req.sequenceId } : {}), hits, bank: req.bank, assets: req.assets, settings: req.settings, gpu: req.gpu });
}
