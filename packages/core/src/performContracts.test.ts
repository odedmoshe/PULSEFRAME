/**
 * Perform mode contracts (ADR-0025), lead tests: the one flash rule (performFlash.ts) and the internal op apply_take
 * (takeOps.ts) — refusals with hints, the flash re-check against what is already in the sequence, the run record, replay
 * equality and determinism. The planner (moves.ts, W1) and the camera (cameraPath.ts, W2) are not built here: their cases are todo.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, EFFECTS, effectChangesLight, flashClassOf, flashGapFrames, FLASH_NEUTRAL_EFFECTS, FLASH_TABLE_V1, getOp, lightChanges, lightRanges, liveFlashTable, MODULATABLE, OpError,
  PERFORM_RECIPE_ID, PERFORM_REFUSALS, TAKE_SEQUENCE_STEP_OPS, TAKE_STEP_OPS, takeFlashBreach, validateProject, ApplyTakeArgsSchema, TakeRequestSchema, PadBankSchema, MoveSpecSchema, PAD_COUNT,
  type ApplyTakeArgs, type OpCall, type ProjectDocument, type TemplateStep,
} from './index.ts';

const R30 = { num: 30, den: 1 };
const f = (n: number, rate = R30) => T.frameTime(n, rate);
const base = (rate = R30): ProjectDocument => {
  const d = createProject({ id: 'prj_perf', name: 'perform', width: 640, height: 360, frameRate: rate });
  // a title under the take, so an adjustment has something to act on and the edit has a length
  return applyTransaction(d, [{ op: 'add_text', args: { text: 'במה', start: T.ZERO, duration: f(300, rate) } }], { idSeed: 'b_', actor: 't' }).doc;
};
const take = (steps: TemplateStep[], over: Partial<ApplyTakeArgs['take']> = {}): OpCall => ({ op: 'apply_take', args: { take: { snap: 'beat', tempo: 'normal', parity: 0, strength: 1, taps: steps.length, hits: Math.max(1, steps.length), held: 0, summary: ['a take'], ...over }, steps } });
const adj = (start: number, frames: number, type = 'color.grayscale', rate = R30): TemplateStep => ({ op: 'add_adjustment', args: { span: { start: f(start, rate), duration: f(frames, rate) }, effects: [{ type }] } });
let seed = 0;
const run = (doc: ProjectDocument, calls: OpCall[]) => applyTransaction(doc, calls, { idSeed: `p${seed++}_`, actor: 'user:owner', allowInternal: true });
const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };

describe('what changes light (one source of truth: effects.ts modulatableParams)', () => {
  it('every catalogue effect is classified, and the neutral list is a decision pinned here', () => {
    for (const e of EFFECTS) expect(typeof effectChangesLight(e.id)).toBe('boolean');
    // an effect is neutral only when every numeric parameter it has may follow the beat; a new effect changes light until listed
    expect([...FLASH_NEUTRAL_EFFECTS].sort()).toEqual(['blur.gaussian', 'distort.fisheye', 'stylize.pixelate']);
    expect(effectChangesLight('light.strobe')).toBe(true);
    expect(effectChangesLight('no.such-effect')).toBe(true);
  });
  it('apply_take version 1 judges with the FROZEN version-1 tables, so a stored take replays whatever the catalogue says later', () => {
    // the literal is the decision; the live derivation is only how a new version would be worked out
    expect(FLASH_TABLE_V1).toEqual({ version: 1, neutralEffects: ['blur.gaussian', 'distort.fisheye', 'stylize.pixelate'], lightTransitions: ['film-burn', 'light-leak'] });
    expect(Object.isFrozen(FLASH_TABLE_V1) && Object.isFrozen(FLASH_TABLE_V1.neutralEffects) && Object.isFrozen(FLASH_TABLE_V1.lightTransitions)).toBe(true);
    // when this fails, the catalogue reclassified an effect or transition: leave the v1 literal alone and ship apply_take version 2 with a new table
    expect(liveFlashTable(1)).toEqual(FLASH_TABLE_V1);
    // three 2-frame blur hits 3 frames apart: neutral under v1, so kept; still kept when the live table changes under the op
    const steps = [adj(30, 2, 'blur.gaussian'), adj(33, 2, 'blur.gaussian'), adj(36, 2, 'blur.gaussian')];
    const before = applyTransaction(base(), [take(steps)], { idSeed: 'frz_', actor: 'u', allowInternal: true }).doc;
    const table = MODULATABLE as Record<string, readonly string[]>;
    const saved = table['blur.gaussian'];
    try {
      table['blur.gaussian'] = [];
      expect(effectChangesLight('blur.gaussian')).toBe(true); // the live classification moved
      const after = applyTransaction(base(), [take(steps)], { idSeed: 'frz_', actor: 'u', allowInternal: true }).doc;
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    } finally { table['blur.gaussian'] = saved!; }
  });
  it('flashClassOf: a strobe is light, any light-changing effect is colour, disabled effects do not count', () => {
    expect(flashClassOf([{ type: 'blur.gaussian' }, { type: 'stylize.pixelate' }])).toBe('none');
    expect(flashClassOf([{ type: 'blur.gaussian' }, { type: 'color.grayscale' }])).toBe('colour');
    expect(flashClassOf([{ type: 'color.grayscale', enabled: false }])).toBe('none');
    expect(flashClassOf([{ type: 'color.invert' }, { type: 'light.strobe' }])).toBe('light');
    expect(flashClassOf([])).toBe('none');
  });
});

describe('apply_take (internal)', () => {
  it('is registered internal at version 1 with the contract schema; every step op exists, is public and is not freeze_frame', () => {
    const def = getOp('apply_take')!;
    expect(def.internal).toBe(true);
    expect(def.version).toBe(1);
    expect(def.args).toBe(ApplyTakeArgsSchema);
    for (const op of TAKE_STEP_OPS) { expect(getOp(op), op).toBeTruthy(); expect(getOp(op)!.internal, op).toBeFalsy(); }
    expect(TAKE_STEP_OPS).not.toContain('freeze_frame');
  });
  it('is refused without allowInternal (only the server issues it)', () => {
    const e = refusal(() => applyTransaction(base(), [take([adj(0, 30)])], { idSeed: 'x_', actor: 't' }));
    expect(e.code).toBe('forbidden_op');
  });
  it('applies its steps with bindings, records ONE run, and leaves a valid document', () => {
    const d0 = base();
    const r = run(d0, [take([
      { op: 'add_track', args: { kind: 'text', name: 'הופעה' }, bind: 'lane' },
      { op: 'add_text', args: { text: 'הופ', start: f(30), duration: f(15), trackId: { $ref: 'lane', out: 'trackId' } }, bind: 'title' },
      adj(90, 20),
      adj(150, 3, 'blur.gaussian'), // changes no light: neither spaced nor lengthened
      adj(152, 3, 'stylize.pixelate'),
    ], { hits: 4, held: 1, taps: 5 })]);
    const out = r.results[0]!.output as { runId: string; createdIds: string[] };
    const runRec = r.doc.recipeRuns[out.runId]!;
    expect(runRec.recipeId).toBe(PERFORM_RECIPE_ID);
    expect(runRec.params).toMatchObject({ version: 1, snap: 'beat', tempo: 'normal', hits: 4, held: 1, taps: 5 });
    expect(runRec.steps).toEqual(['a take']);
    // the track, the title, the three adjustments, and the adjustment track(s) add_adjustment made for them
    expect(out.createdIds.filter((id) => !!r.doc.sequences[r.doc.mainSequenceId]!.tracks.find((t) => t.clips.some((c) => c.id === id))).length).toBe(4);
    expect(out.createdIds.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(runRec.fingerprints).length).toBe(4);
    expect(validateProject(r.doc)).toEqual([]);
  });
  it('the same arguments on the same document give byte-identical documents (replay)', () => {
    const steps = [adj(0, 30), adj(60, 15, 'color.invert')];
    const a = applyTransaction(base(), [take(steps)], { idSeed: 'same_', actor: 'u', allowInternal: true }).doc;
    const b = applyTransaction(base(), [take(steps)], { idSeed: 'same_', actor: 'u', allowInternal: true }).doc;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  it('refuses a step a take may not run, an $asset binding, a repeated bind name and more than six tracks, each with its hint', () => {
    const cases: [OpCall, keyof typeof PERFORM_REFUSALS][] = [
      [take([{ op: 'freeze_frame', args: {} }]), 'forbiddenStep'],
      [take([{ op: 'apply_template', args: {} }]), 'forbiddenStep'],
      [take([{ op: 'add_clip', args: { assetId: { $asset: 'boom' }, start: T.ZERO } }]), 'assetBinding'],
      [take([{ op: 'add_track', args: { kind: 'audio' }, bind: 'x' }, { op: 'add_track', args: { kind: 'audio' }, bind: 'x' }]), 'bindTwice'],
      [take(Array.from({ length: 7 }, () => ({ op: 'add_track', args: { kind: 'audio' } }))), 'tooManyTracks'],
    ];
    for (const [call, key] of cases) {
      const e = refusal(() => run(base(), [call]));
      expect(e.code, key).toBe(PERFORM_REFUSALS[key].code);
      expect(e.hint, key).toBe(PERFORM_REFUSALS[key].hint);
    }
  });
  it('passes a step\'s own refusal on in its own words, naming the step', () => {
    const e = refusal(() => run(base(), [take([adj(0, 30), { op: 'add_text', args: { text: 'x', start: f(1), duration: f(40), trackId: 'trk_nowhere' } }])]));
    expect(e.details).toMatchObject({ step: 1, stepOp: 'add_text' });
    expect(e.message).not.toMatch(/^take step/);
  });
  it('refuses an unknown sequence', () => {
    const e = refusal(() => run(base(), [{ op: 'apply_take', args: { ...(take([adj(0, 30)]).args as object), sequenceId: 'seq_none' } }]));
    expect(e.code).toBe('not_found');
  });
});

describe('the flash rule, re-checked by the op (not trusting the plan)', () => {
  for (const rate of [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, R30, { num: 60, den: 1 }]) {
    const gap = flashGapFrames(rate.num / rate.den);
    it(`${rate.num}/${rate.den}: two changes of light exactly ${gap} frames apart are kept, ${gap - 1} apart refused with flash_limit (gap)`, () => {
      const d = base(rate);
      expect(() => run(d, [take([adj(0, gap, 'color.grayscale', rate), adj(gap, gap, 'color.invert', rate)])])).not.toThrow();
      const e = refusal(() => run(d, [take([adj(0, gap, 'color.grayscale', rate), adj(gap - 1, gap, 'color.invert', rate)])]));
      expect(e.code).toBe('incompatible');
      expect(e.details).toMatchObject({ reason: 'flash_limit', why: 'gap', since: gap - 1, gapFrames: gap });
    });
  }
  it('checks against changes of light already in the sequence (an earlier take or the owner\'s own adjustment)', () => {
    const d = run(base(), [take([adj(100, 30)])]).doc;
    const e = refusal(() => run(d, [take([adj(105, 30, 'color.sepia')])]));
    expect(e.details).toMatchObject({ reason: 'flash_limit', why: 'gap', since: 5 });
    expect(() => run(d, [take([adj(111, 30, 'color.sepia')])])).not.toThrow();
  });
  it('a title or sticker the take makes is a change of light; titles the owner made are not judged', () => {
    const e = refusal(() => run(base(), [take([adj(30, 20), { op: 'add_text', args: { text: 'הופ', start: f(34), duration: f(20) } }])]));
    expect(e.details).toMatchObject({ why: 'gap' });
    // the base title starts at 0; an adjustment at 0 is judged against the take's own changes only
    expect(() => run(base(), [take([adj(0, 20)])])).not.toThrow();
  });
  it('a picture, title or light-changing adjustment shorter than the gap is refused (short); a neutral one is not', () => {
    const e = refusal(() => run(base(), [take([adj(30, 5)])]));
    expect(e.details).toMatchObject({ reason: 'flash_limit', why: 'short', since: 5, gapFrames: 11 });
    expect(e.hint).toBe(PERFORM_REFUSALS.flashShort.hint);
    expect(() => run(base(), [take([adj(30, 2, 'blur.gaussian')])])).not.toThrow();
  });
  it('a strobe claims its frames first: a change of light inside its range widened by the gap is refused (light)', () => {
    const strobe = adj(60, 60, 'light.strobe');
    const inside = refusal(() => run(base(), [take([strobe, adj(80, 20)])]));
    expect(inside.details).toMatchObject({ reason: 'flash_limit', why: 'light' });
    const before = refusal(() => run(base(), [take([strobe, adj(50, 20)])]));
    expect(before.details).toMatchObject({ why: 'light' });
    expect(() => run(base(), [take([strobe, adj(131, 20)])])).not.toThrow(); // 120 + 11
    // and a strobe the take makes next to an old change of light breaks the rule too
    const d = run(base(), [take([adj(200, 20)])]).doc;
    const late = refusal(() => run(d, [take([adj(195, 60, 'light.strobe')])]));
    expect(late.details).toMatchObject({ why: 'light' });
  });
  it('lightRanges and lightChanges read the sequence the rule reads', () => {
    const d = run(base(), [take([adj(60, 60, 'light.strobe'), adj(200, 20), adj(300, 3, 'blur.gaussian')])]).doc;
    expect(lightRanges(d).map((r) => [r.from, r.to, r.kind])).toEqual([[60, 120, 'strobe']]);
    expect(lightChanges(d, new Set()).map((c) => [c.frame, c.kind])).toEqual([[200, 'adjustment']]);
    expect(takeFlashBreach(d, d.mainSequenceId, [])).toBeNull();
  });
});

describe('keys and transforms on light channels, and the sequence a step works on (the op re-checks these too)', () => {
  const ownerTitle = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'text')!.id;
  // 30 opacity keys two frames apart, alternating 1, 0, 1, 0 with hold: fifteen changes of light a second
  const flicker = (clipId: unknown, n = 30): TemplateStep[] => Array.from({ length: n }, (_, i) => ({ op: 'set_keyframe', args: { clipId, property: 'opacity', time: f(2 * i), value: i % 2 ? 0 : 1, easing: 'hold' } }));
  const ref = (bind: string) => ({ $ref: bind, out: 'clipId' });
  const adjA = (start: number, frames: number, type = 'color.invert'): TemplateStep => ({ ...adj(start, frames, type), bind: 'a' });
  it('alternating opacity keys on an adjustment the take made are changes of light: refused (gap)', () => {
    const e = refusal(() => run(base(), [take([adjA(30, 60), ...flicker(ref('a'))])]));
    expect(e.code).toBe('incompatible');
    expect(e.details).toMatchObject({ reason: 'flash_limit', why: 'gap', since: 2, gapFrames: 11 });
  });
  it('the same keys on an effect parameter that changes light are refused too; on a neutral adjustment (blur) they are not judged', () => {
    const keys: TemplateStep[] = Array.from({ length: 10 }, (_, i) => ({ op: 'set_effect_keyframe', args: { clipId: ref('a'), effectId: { $ref: 'a', out: 'effectIds', at: 0 }, param: 'amount', time: f(3 * i), value: i % 2 ? 0 : 1, easing: 'linear' } }));
    const e = refusal(() => run(base(), [take([adjA(30, 60, 'color.invert'), ...keys])]));
    expect(e.details).toMatchObject({ reason: 'flash_limit', why: 'gap' });
    expect(() => run(base(), [take([adjA(30, 60, 'blur.gaussian'), ...flicker(ref('a'))])])).not.toThrow();
  });
  it('a take never writes the light of a clip it did not make (keys, a motion with opacity, or its opacity): refused (owned)', () => {
    const d = base(), title = ownerTitle(d);
    for (const steps of [flicker(title), flicker(title, 1), [{ op: 'apply_motion_preset', args: { clipId: title, presetId: 'motion.in.fade' } }], [{ op: 'set_clip_transform', args: { clipId: title, transform: { opacity: 0.5 } } }], [{ op: 'replace_clip_keyframes', args: { clipId: title, property: 'opacity', keys: null } }]] as TemplateStep[][]) {
      const e = refusal(() => run(d, [take(steps)]));
      expect(e.code, steps[0]!.op).toBe(PERFORM_REFUSALS.lightOwned.code);
      expect(e.details, steps[0]!.op).toMatchObject({ reason: 'flash_limit', why: 'owned', clipId: title, step: 0, stepOp: steps[0]!.op });
      expect(e.hint).toBe(PERFORM_REFUSALS.lightOwned.hint);
    }
    // its size and position are not light: the zoom punch writes scale keys on the owner's clip
    expect(() => run(d, [take([{ op: 'set_keyframe', args: { clipId: title, property: 'scale', time: f(30), value: 1.2 } }, { op: 'set_keyframe', args: { clipId: title, property: 'scale', time: f(32), value: 1 } }])])).not.toThrow();
  });
  it('allowed: one fade-out ending at the clip end, a pop entrance from invisible, a release to the end', () => {
    const fade: TemplateStep[] = [adjA(30, 60), { op: 'set_keyframe', args: { clipId: ref('a'), property: 'opacity', time: f(30), value: 1 } }, { op: 'set_keyframe', args: { clipId: ref('a'), property: 'opacity', time: f(60), value: 0 } }];
    const r = run(base(), [take(fade)]);
    expect(validateProject(r.doc)).toEqual([]);
    const pop: TemplateStep[] = [{ op: 'add_text', args: { text: 'הופ', start: f(30), duration: f(30) }, bind: 't' }, { op: 'apply_motion_preset', args: { clipId: ref('t'), presetId: 'motion.in.pop' } }];
    expect(() => run(base(), [take(pop)])).not.toThrow();
  });
  it('refused: a change inside a clip within the gap of its start (a fast decay) or of its end (a hold that pops on in the last frame)', () => {
    const decay = refusal(() => run(base(), [take([adjA(30, 60), { op: 'set_keyframe', args: { clipId: ref('a'), property: 'opacity', time: T.ZERO, value: 1 } }, { op: 'set_keyframe', args: { clipId: ref('a'), property: 'opacity', time: f(3), value: 0 } }])]));
    expect(decay.details).toMatchObject({ reason: 'flash_limit', why: 'gap', frame: 33, since: 3 });
    const late = refusal(() => run(base(), [take([{ op: 'add_text', args: { text: 'הופ', start: f(30), duration: f(30) }, bind: 't' }, { op: 'set_keyframe', args: { clipId: ref('t'), property: 'opacity', time: T.ZERO, value: 0, easing: 'hold' } }, { op: 'set_keyframe', args: { clipId: ref('t'), property: 'opacity', time: f(29), value: 1 } }])]));
    expect(late.details).toMatchObject({ reason: 'flash_limit', why: 'short', frame: 59, since: 1 });
  });
  it('lightChanges lists the key changes of the clips the take made', () => {
    const d = run(base(), [take([adjA(30, 60), { op: 'set_keyframe', args: { clipId: ref('a'), property: 'opacity', time: f(20), value: 1 } }, { op: 'set_keyframe', args: { clipId: ref('a'), property: 'opacity', time: f(60), value: 0 } }])]).doc;
    const id = d.sequences[d.mainSequenceId]!.tracks.find((t) => t.kind === 'adjustment')!.clips[0]!.id;
    expect(lightChanges(d, new Set([id])).map((c) => [c.frame, c.kind])).toEqual([[30, 'adjustment'], [50, 'key']]);
  });
  it('every step works on the take\'s sequence: another sequenceId, or a clip in another sequence, is refused (otherSequence)', () => {
    const d = applyTransaction(base(), [{ op: 'add_sequence', args: { name: 'short' } }], { idSeed: 'sq_', actor: 't' }).doc;
    const other = Object.keys(d.sequences).find((id) => id !== d.mainSequenceId)!;
    const e = refusal(() => run(d, [take([{ ...adj(30, 20), args: { ...(adj(30, 20).args as object), sequenceId: other } }])]));
    expect(e.code).toBe(PERFORM_REFUSALS.otherSequence.code);
    expect(e.details).toMatchObject({ index: 0, sequenceId: other, takeSequenceId: d.mainSequenceId });
    expect(e.hint).toBe(PERFORM_REFUSALS.otherSequence.hint);
    // a take performed on the short: a step that leaves out sequenceId means the main sequence, so it is refused as well
    const onShort = refusal(() => run(d, [{ op: 'apply_take', args: { ...(take([adj(30, 20)]).args as object), sequenceId: other } }]));
    expect(onShort.details).toMatchObject({ sequenceId: d.mainSequenceId, takeSequenceId: other });
    expect(() => run(d, [{ op: 'apply_take', args: { ...(take([{ ...adj(30, 20), args: { ...(adj(30, 20).args as object), sequenceId: other } }]).args as object), sequenceId: other } }])).not.toThrow();
    // a clip-targeted step on the owner's title (main) while the take is on the short
    const title = ownerTitle(d);
    const clipStep = refusal(() => run(d, [{ op: 'apply_take', args: { ...(take([{ op: 'set_keyframe', args: { clipId: title, property: 'scale', time: f(30), value: 1.2 } }]).args as object), sequenceId: other } }]));
    expect(clipStep.details).toMatchObject({ index: 0, clipId: title, sequenceId: d.mainSequenceId, takeSequenceId: other });
  });
  it('every step op either names its sequence or targets a clip (so the sequence check covers it)', () => {
    for (const op of TAKE_STEP_OPS) {
      const shape = (getOp(op)!.args as unknown as { shape: Record<string, unknown> }).shape;
      expect(TAKE_SEQUENCE_STEP_OPS.includes(op) ? 'sequenceId' in shape : 'clipId' in shape, op).toBe(true);
    }
  });
});

describe('request and bank schemas', () => {
  it('a bank has exactly PAD_COUNT pads, pads store catalogue ids (never asset ids), and there is no freeze kind', () => {
    const empty = Array.from({ length: PAD_COUNT }, () => null);
    expect(PadBankSchema.safeParse(empty).success).toBe(true);
    expect(PadBankSchema.safeParse(empty.slice(1)).success).toBe(false);
    expect(MoveSpecSchema.safeParse({ id: 'move.boom', kind: 'sound', minSeconds: 0.1, source: { sfxId: 'boom' }, gain: 1 }).success).toBe(true);
    expect(MoveSpecSchema.safeParse({ id: 'move.boom', kind: 'sound', minSeconds: 0.1, assetId: 'ast_1', gain: 1 }).success).toBe(false);
    expect(MoveSpecSchema.safeParse({ id: 'move.freeze', kind: 'freeze', minSeconds: 0.5 }).success).toBe(false);
  });
  it('a take request refuses a tap that ends before it starts and a pad outside 0..7', () => {
    const req = (taps: unknown) => ({ taps, bank: Array(PAD_COUNT).fill(null), assets: Array(PAD_COUNT).fill(null), settings: { snap: 'beat', tempo: 'normal', strength: 1, parity: 0 }, gpu: false });
    expect(TakeRequestSchema.safeParse(req([{ pad: 0, down: 1, up: 1.2 }])).success).toBe(true);
    expect(TakeRequestSchema.safeParse(req([{ pad: 0, down: 1, up: 0.5 }])).success).toBe(false);
    expect(TakeRequestSchema.safeParse(req([{ pad: 8, down: 1, up: 1.5 }])).success).toBe(false);
  });
});

import { defaultBank, planTakeRequest } from './index.ts';
describe('workers (todo until built)', () => {
  // W1 (moves.ts): built
  const mash = (n: number, pads: number[]) => Array.from({ length: n }, (_, i) => ({ pad: pads[i % pads.length]!, down: 0.2 + i / 20, up: 0.2 + i / 20 + 0.03 }));
  const request = (taps: { pad: number; down: number; up: number }[]) => ({ taps, bank: [...defaultBank('canvas')], assets: Array(PAD_COUNT).fill(null), settings: { snap: 'beat' as const, tempo: 'normal' as const, strength: 1, parity: 0 as const }, gpu: false });
  it('W1 moves.ts: planTakeRequest on a seeded take gives args that apply_take accepts and that pass validateProject (perform W1)', () => {
    const d0 = base();
    const plan = planTakeRequest(d0, request(mash(60, [1, 2, 3, 4, 5, 7])));
    expect(plan.args).not.toBeNull();
    const r = run(d0, [{ op: 'apply_take', args: plan.args! }]);
    expect(validateProject(r.doc)).toEqual([]);
    expect(Object.values(r.doc.recipeRuns).filter((x) => x.recipeId === PERFORM_RECIPE_ID)).toHaveLength(1);
    // same document, same taps: byte-identical arguments
    expect(JSON.stringify(planTakeRequest(base(), request(mash(60, [1, 2, 3, 4, 5, 7]))).args)).toBe(JSON.stringify(plan.args));
  });
  it('W1 moves.ts: every hit the planner keeps passes takeFlashBreach; every hit it holds flash_limit would breach it', () => {
    const d0 = base();
    const plan = planTakeRequest(d0, request(mash(80, [4, 1]))); // black-and-white and colour split, 20 taps a second
    const r = run(d0, [{ op: 'apply_take', args: plan.args! }]);
    const created = (r.results[0]!.output as { createdIds: string[] }).createdIds;
    expect(takeFlashBreach(r.doc, r.doc.mainSequenceId, created)).toBeNull();
    const held = plan.chips.filter((c) => c.reason === 'flash_limit');
    expect(held.length).toBeGreaterThan(10);
    for (const c of held.slice(0, 12)) {
      const effect = c.pad === 4 ? { type: 'color.grayscale', params: { amount: 1 } } : { type: 'digital.rgb-split', params: { amount: 0.02 } };
      const forced = { ...plan.args!, steps: [...plan.args!.steps, { op: 'add_adjustment', args: { span: { start: f(c.frame), duration: f(c.frames) }, effects: [effect] } }] };
      const e = refusal(() => run(d0, [{ op: 'apply_take', args: forced }]));
      expect(e.details, `tap ${c.tap}`).toMatchObject({ reason: 'flash_limit' });
    }
  });
  it.todo('W2 cameraPath.ts: the camera plan is three replace_clip_keyframes calls with the take range, and keys outside the range stay');
});
