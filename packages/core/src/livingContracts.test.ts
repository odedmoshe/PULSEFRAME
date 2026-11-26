/**
 * «תמונה חיה» (wave 8 living): the lead's contract — the depth record and its limits, the comfort rule of thumb with the real peak
 * slopes (verifier C1), the effect row (stir none, C12), set_clip_depth (complete), set_living_picture (refuses notBuilt until W1),
 * and every existing path that adds or updates effects (C4, C5, C6): add_effect, update_effect, adjustment clips, paste attributes,
 * the command bar, replace_clip_media. The copiers are livingSites.test.ts. Fixtures are synthetic; nobody has looked at a picture.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  adjustmentRefusal, applyTransaction, CALM_OFF_EFFECTS, ClipDepthSchema, createProject, curveShape, depthGridSize, depthKey, depthProblems, describeCatalog,
  EFFECTS, findClip, findEffect, GPU_EFFECT_IDS, LIVING_BUILT, LIVING_EFFECT, LIVING_MAX_RATE, LIVING_MAX_SHIFT, LIVING_PEAK_SLOPE, LIVING_SPAN,
  livingComfort, livingLongEnough, livingMaxAmount, livingSteps, livingUnavailable, MAX_DEPTH_NUMBERS, NOT_ANIMATABLE, OpError, opOnlyEffect,
  animatableParams, depthGrid, diffEntities, restoreEntities, v1Shape, validateProject, type ClipDepth, type EffectInstance, type MediaClip, type OpCall, type ProjectDocument,
} from './index.ts';
import { interpret } from './commandBar/index.ts';
import { DEPTH, f, livingDoc, R, refused, tx, withLiving } from './living.testFixture.ts';
import { ctxFor } from './commandBar/fixture.testFixture.ts';

const why = (e: OpError) => e.details.why;

describe('the depth record', () => {
  it('accepts a ramp or a flat base with up to 64 strokes; odd coordinates and more than 8192 numbers are problems; no model member', () => {
    expect(ClipDepthSchema.safeParse(DEPTH).success).toBe(true);
    expect(ClipDepthSchema.safeParse({ v: 1, base: { kind: 'flat' }, strokes: [] }).success).toBe(true);
    expect(ClipDepthSchema.safeParse({ v: 1, base: { kind: 'model', sha256: 'a'.repeat(64) }, strokes: [] }).success).toBe(false);
    expect(ClipDepthSchema.safeParse({ ...DEPTH, strokes: [{ layer: 'mid', size: 10, pts: [1, 2] }] }).success).toBe(false);
    expect(ClipDepthSchema.safeParse({ ...DEPTH, strokes: Array.from({ length: 65 }, () => DEPTH.strokes[0]) }).success).toBe(false);
    expect(depthProblems(DEPTH)).toEqual([]);
    expect(depthProblems({ ...DEPTH, strokes: [{ layer: 'far', size: 10, pts: [1, 2, 3] }] })).toEqual(['stroke 1 has an odd number of coordinates']);
    const big = { ...DEPTH, strokes: Array.from({ length: 17 }, () => ({ layer: 'near' as const, size: 10, pts: Array.from({ length: 512 }, () => 5) })) };
    expect(depthProblems(big)[0]).toMatch(new RegExp(`at most ${MAX_DEPTH_NUMBERS}`));
  });
  it('the hand grid is 256 on the long side, the short side rounded, at least 16; the key is prefixed and covers the rasteriser version', () => {
    expect(depthGridSize({ width: 1920, height: 1080 })).toEqual({ width: 256, height: 144 });
    expect(depthGridSize({ width: 1080, height: 1920 })).toEqual({ width: 144, height: 256 });
    expect(depthGridSize({ width: 5000, height: 100 })).toEqual({ width: 256, height: 16 });
    expect(depthKey(DEPTH)).toMatch(/^depth:r1:/);
    expect(depthKey({ strokes: DEPTH.strokes, base: DEPTH.base, v: 1 })).toBe(depthKey(DEPTH)); // key order does not matter
    expect(depthKey({ ...DEPTH, base: { kind: 'ramp', horizon: 401 } })).not.toBe(depthKey(DEPTH));
  });
  it('the search steps follow the depth grid (C7): clamp(2·⌈shift texels⌉ + 3, 9, 64), the same at every output size', () => {
    expect(livingSteps(0)).toBe(9);
    expect(livingSteps(0.03 * 144)).toBe(13); // full-frame 16:9 photo on the hand grid at amount 1
    expect(livingSteps(0.03 * 576)).toBe(39); // a 1024 map, for a later wave
    expect(livingSteps(1000)).toBe(64);
  });
});

describe('the comfort rule of thumb (verifier C1, C5)', () => {
  it('the frozen peak slopes are the curves\' real ones: linear 1, ease-in-out 3 at u = ½, gentle 2.2881 rounded up', () => {
    const peak = (shape: (u: number) => number) => { let m = 0; const N = 200_000; for (let i = 0; i < N; i++) m = Math.max(m, (shape((i + 1) / N) - shape(i / N)) * N); return m; };
    expect(peak((u) => v1Shape('linear', u))).toBeCloseTo(LIVING_PEAK_SLOPE.linear, 4);
    expect(peak((u) => v1Shape('ease-in-out', u))).toBeCloseTo(LIVING_PEAK_SLOPE['ease-in-out'], 3);
    const g = peak((u) => curveShape('gentle', undefined, u));
    expect(g).toBeLessThanOrEqual(LIVING_PEAK_SLOPE.gentle);
    expect(LIVING_PEAK_SLOPE.gentle - g).toBeLessThan(1e-3);
  });
  it('the shortest clips the verifier computed: push 0.5 → 2.25 s, 1 → 4.5 s; slide 0.5 → 4.5 s, 1 → 9 s (ease-in-out)', () => {
    const seconds = (move: 'push' | 'slide', amount: number) => (amount * LIVING_MAX_SHIFT * LIVING_SPAN[move] * LIVING_PEAK_SLOPE['ease-in-out']) / LIVING_MAX_RATE;
    expect([seconds('push', 0.5), seconds('push', 1), seconds('slide', 0.5), seconds('slide', 1)].map((x) => +x.toFixed(6))).toEqual([2.25, 4.5, 4.5, 9]);
    // keys span frames − 1: a 5 s clip at 30 fps has 149/30 s of travel
    expect(livingMaxAmount(150, R, 'push', 'ease-in-out')).toBe(1);
    expect(livingMaxAmount(150, R, 'slide', 'ease-in-out')).toBe(0.55);
    expect(livingMaxAmount(60, R, 'push', 'ease-in-out')).toBe(0.43);
    expect(livingMaxAmount(60, R, 'push', 'linear')).toBe(1);
    expect(livingMaxAmount(1, R, 'push', 'linear')).toBe(0);
    expect(livingLongEnough(29, R)).toBe(false);
    expect(livingLongEnough(30, R)).toBe(true);
  });
  it('frame by frame the keys the op writes never exceed the closed form; at the closed-form amount they fit; hold keys never fit', () => {
    for (const frames of [30, 45, 60, 90, 150, 301]) for (const move of ['push', 'slide'] as const) {
      const max = livingMaxAmount(frames, R, move, 'ease-in-out');
      const fx = { params: { move, amount: max }, keyframes: { travel: [{ time: f(0), value: 0, easing: 'ease-in-out' as const }, { time: f(frames - 1), value: 1, easing: 'linear' as const }] } };
      const c = livingComfort(fx, frames, R);
      expect(c.ok, `${frames} ${move}`).toBe(true);
      expect(c.maxAmount).toBeGreaterThanOrEqual(max);
    }
    const hold = { params: { move: 'push', amount: 0.1 }, keyframes: { travel: [{ time: f(0), value: 0, easing: 'hold' as const }, { time: f(100), value: 1, easing: 'linear' as const }] } };
    expect(livingComfort(hold, 150, R).ok).toBe(false);
    expect(livingComfort({ params: { amount: 1 } }, 150, R)).toMatchObject({ ok: true, peakRate: 0, maxAmount: 1 });
  });
});

describe('the effect row', () => {
  it('depth.living: a GPU motion row, stir none (kept by both audience versions), amount not keyframable, travel keyframable, move push|slide only', () => {
    const e = findEffect(LIVING_EFFECT)!;
    expect([e.cost, e.category, e.stir, e.temporal, e.seeded]).toEqual(['gpu', 'motion', 'none', false, false]);
    expect(GPU_EFFECT_IDS).toContain(LIVING_EFFECT);
    expect(CALM_OFF_EFFECTS).not.toContain(LIVING_EFFECT);
    expect(NOT_ANIMATABLE[LIVING_EFFECT]).toEqual(['amount']);
    expect(animatableParams(LIVING_EFFECT)).toEqual(['travel']);
    expect(e.params.parse({})).toEqual({ move: 'push', amount: 0.5, travel: 0 });
    expect(e.params.safeParse({ move: 'orbit' }).success).toBe(false);
    expect(EFFECTS[EFFECTS.length - 1]!.id).toBe(LIVING_EFFECT); // appended: the order of earlier rows is unchanged
    expect(opOnlyEffect(LIVING_EFFECT)).toBe(true);
    expect(EFFECTS.filter((x) => opOnlyEffect(x.id)).map((x) => x.id)).toEqual([LIVING_EFFECT]);
    expect(describeCatalog().effects.find((x) => x.id === LIVING_EFFECT)).toMatchObject({ addedWith: 'set_living_picture' });
  });
});

describe('set_clip_depth (lead-built) and set_living_picture (W1)', () => {
  it('set_clip_depth replaces the depth whole, refuses a video, a title, an invalid depth; null removes it; undo exact; validation holds', () => {
    const s = livingDoc();
    expect((findClip(s.doc, s.clip)!.clip as MediaClip).depth).toEqual(DEPTH);
    expect(validateProject(s.doc)).toEqual([]);
    const flat: ClipDepth = { v: 1, base: { kind: 'flat' }, strokes: [] };
    const r = tx(s.doc, [{ op: 'set_clip_depth', args: { clipId: s.clip, depth: flat } }], false);
    expect((findClip(r.doc, s.clip)!.clip as MediaClip).depth).toEqual(flat);
    expect(why(refused(s.doc, [{ op: 'set_clip_depth', args: { clipId: s.video, depth: DEPTH } }]))).toBe('living_not_photo');
    const bad = refused(s.doc, [{ op: 'set_clip_depth', args: { clipId: s.clip, depth: { ...DEPTH, strokes: [{ layer: 'near', size: 10, pts: [1, 2, 3] }] } } }]);
    expect([bad.code, why(bad), bad.message]).toEqual(['invalid_args', 'depth_invalid', 'the painted depth is not valid: stroke 1 has an odd number of coordinates']);
    const gone = tx(s.doc, [{ op: 'set_clip_depth', args: { clipId: s.clip, depth: null } }], false);
    expect((findClip(gone.doc, s.clip)!.clip as MediaClip).depth).toBeUndefined();
  });
  it('null is refused while the clip has a living picture (C6): «קודם הסירו את התמונה החיה, ואז את העומק»', () => {
    const s = livingDoc();
    const e = refused(withLiving(s.doc, s.clip), [{ op: 'set_clip_depth', args: { clipId: s.clip, depth: null } }]);
    expect([e.code, why(e), e.message]).toEqual(['incompatible', 'living_needs_depth', 'remove the living picture first, then its depth']);
  });
  it('set_living_picture is built (LIVING_BUILT): the op no longer refuses notBuilt', () => {
    const s = livingDoc();
    expect(LIVING_BUILT).toBe(true);
    expect(tx(s.doc, [{ op: 'set_living_picture', args: { clipId: s.clip } }], false).results[0]!.output).toMatchObject({ move: 'push', amount: 0.5, maxAmount: 1, replacedMotion: [] });
  });
  it('W1 set_living_picture: refusals in the header order (notPhoto, rotated, tooShort, needsDepth, depthInvalid, tooFast with max = livingMaxAmount, 16 effects); remove keeps the depth', () => {
    const s = livingDoc();
    const live = (args: Record<string, unknown>, doc: ProjectDocument = s.doc) => refused(doc, [{ op: 'set_living_picture', args: { clipId: s.clip, ...args } }]);
    expect(refused(s.doc, [{ op: 'set_living_picture', args: { clipId: 'clp_none' } }]).code).toBe('not_found');
    expect(why(refused(s.doc, [{ op: 'set_living_picture', args: { clipId: s.video, depth: DEPTH } }]))).toBe('living_not_photo');
    // rotated comes before too short: a rotated 20-frame photo is refused rotated
    const short = tx(s.doc, [{ op: 'trim_clip', args: { clipId: s.clip, edge: 'end', to: f(20) } }]).doc;
    const rotShort = tx(short, [{ op: 'set_clip_transform', args: { clipId: s.clip, transform: { rotation: 5 } } }]).doc;
    expect(why(live({}, rotShort))).toBe('living_rotated');
    const rotKeys = tx(s.doc, [{ op: 'set_keyframe', args: { clipId: s.clip, property: 'rotation', time: f(10), value: 0 } }]).doc;
    expect(why(live({}, rotKeys))).toBe('living_rotated');
    expect(why(live({}, short))).toBe('living_too_short');
    // too short comes before needs depth: clip2 has no depth
    const short2 = tx(s.doc, [{ op: 'trim_clip', args: { clipId: s.clip2, edge: 'end', to: f(170) } }]).doc;
    expect(why(refused(short2, [{ op: 'set_living_picture', args: { clipId: s.clip2 } }]))).toBe('living_too_short');
    const nd = refused(s.doc, [{ op: 'set_living_picture', args: { clipId: s.clip2 } }]);
    expect([nd.code, why(nd)]).toEqual(['incompatible', 'living_needs_depth']);
    const bad = refused(s.doc, [{ op: 'set_living_picture', args: { clipId: s.clip2, depth: { ...DEPTH, strokes: [{ layer: 'near', size: 10, pts: [1, 2, 3] }] }, amount: 1, move: 'slide' } }]);
    expect([bad.code, why(bad)]).toEqual(['invalid_args', 'depth_invalid']); // invalid depth before too fast
    // too fast: a 2-second clip at amount 1 → max = livingMaxAmount (60 frames, push, ease-in-out: 0.43)
    const two = tx(s.doc, [{ op: 'trim_clip', args: { clipId: s.clip, edge: 'end', to: f(60) } }]).doc;
    const fast = live({ amount: 1 }, two);
    expect([fast.code, why(fast), fast.details.max, fast.message]).toEqual(['out_of_bounds', 'living_too_fast', livingMaxAmount(60, R, 'push', 'ease-in-out'), 'this clip is too short for that amount; the highest amount that fits it: 0.43']);
    expect(why(live({ amount: 0.6, move: 'slide' }))).toBe('living_too_fast'); // 150 frames: slide fits 0.55
    expect(live({ amount: 1, curve: 'gentle' }, two).details.max).toBe(livingMaxAmount(60, R, 'push', 'gentle'));
    // the default amount is lowered to the cap, never refused
    expect(tx(two, [{ op: 'set_living_picture', args: { clipId: s.clip } }], false).results[0]!.output).toMatchObject({ amount: 0.43, maxAmount: 0.43 });
    // 16 effects: add_effect's sentence
    let full = s.doc;
    for (let i = 0; i < 16; i++) full = tx(full, [{ op: 'add_effect', args: { clipId: s.clip, type: 'blur.gaussian' } }]).doc;
    expect(live({}, full).message).toBe('a clip can carry at most 16 effects');
    // remove: drops the instance and its keys, keeps the depth; with none there it changes nothing
    const on = tx(s.doc, [{ op: 'set_living_picture', args: { clipId: s.clip } }], false).doc;
    const off = tx(on, [{ op: 'set_living_picture', args: { clipId: s.clip, remove: true } }], false);
    const c = findClip(off.doc, s.clip)!.clip as MediaClip;
    expect([c.effects, c.depth]).toEqual([undefined, DEPTH]);
    expect(tx(s.doc, [{ op: 'set_living_picture', args: { clipId: s.clip, remove: true } }], false).results[0]!.affectedIds).toEqual([]);
    // remove is not refused on a rotated or short clip (nothing else is checked)
    expect(tx(tx(on, [{ op: 'set_clip_transform', args: { clipId: s.clip, transform: { rotation: 5 } } }]).doc, [{ op: 'set_living_picture', args: { clipId: s.clip, remove: true } }], false).doc).toBeTruthy();
  });
  it('W1 set_living_picture: one transaction writes the depth, the instance and travel keys 0 → 1 at frame-aligned clip-local times; one undo restores the clip exactly (entity diff empty)', () => {
    const s = livingDoc();
    const flat: ClipDepth = { v: 1, base: { kind: 'flat' }, strokes: [{ layer: 'near', size: 200, pts: [500, 500] }] };
    const r = tx(s.doc, [{ op: 'set_living_picture', args: { clipId: s.clip2, depth: flat, move: 'slide', amount: 0.5, curve: 'linear' } }], false);
    const c = findClip(r.doc, s.clip2)!.clip as MediaClip;
    expect(c.depth).toEqual(flat);
    expect(c.effects!.length).toBe(1);
    const fx = c.effects![0]!;
    expect([fx.type, fx.enabled, fx.params]).toEqual([LIVING_EFFECT, true, { move: 'slide', amount: 0.5, travel: 0 }]);
    expect(fx.keyframes!.travel).toEqual([{ time: T.frameTime(0, R), value: 0, easing: 'linear' }, { time: T.frameTime(149, R), value: 1, easing: 'linear' }]);
    expect(r.results[0]!.output).toEqual({ effectId: fx.id, move: 'slide', amount: 0.5, maxAmount: livingMaxAmount(150, R, 'slide', 'linear'), replacedMotion: [] });
    expect(livingComfort(fx, 150, R).ok).toBe(true);
    expect(validateProject(r.doc)).toEqual([]);
    const changes = diffEntities(s.doc, r.doc);
    expect(changes.map((x) => x.id)).toEqual([s.clip2]);
    const back = structuredClone(r.doc);
    restoreEntities(back, changes.map((x) => ({ id: x.id, state: x.before })));
    expect(diffEntities(s.doc, back)).toEqual([]);
  });
  it('W1 set_living_picture: replaces a Ken Burns or pan move (motion.move.*) in the same transaction and lists it in output.replacedMotion (C3); an entrance, an exit, a loop and hand keys stay', () => {
    const s = livingDoc();
    const live = (doc: ProjectDocument) => tx(doc, [{ op: 'set_living_picture', args: { clipId: s.clip } }], false);
    for (const [presetId, amount, props] of [['motion.move.ken-burns-in', undefined, ['scale']], ['motion.move.ken-burns-out', 0.4, ['scale']], ['motion.move.pan-left', 0.7, ['scale', 'x']], ['motion.move.push-in-tilt', 0.5, ['scale', 'rotation']]] as const) {
      const kb = tx(s.doc, [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId, ...(amount !== undefined ? { amount } : {}) } }]).doc;
      const startScale = findClip(kb, s.clip)!.clip.keyframes!.scale![0]!.value;
      const r = live(kb);
      expect(r.results[0]!.output!.replacedMotion, presetId).toEqual([presetId]);
      const c = findClip(r.doc, s.clip)!.clip;
      expect(c.keyframes, presetId).toBeUndefined();
      expect(c.transform.scale, presetId).toBeCloseTo(startScale, 12); // the value at the clip start stays
      for (const p of props) expect(c.transform[p], `${presetId} ${p}`).toBeCloseTo(findClip(kb, s.clip)!.clip.keyframes![p]![0]!.value, 12);
      // one undo brings the move back
      const back = structuredClone(r.doc);
      restoreEntities(back, diffEntities(kb, r.doc).map((x) => ({ id: x.id, state: x.before })));
      expect(diffEntities(kb, back)).toEqual([]);
    }
    // a move that starts tilted (pull-back-tilt starts at 2°) leaves the clip rotated: refused, nothing changed
    const tilt = tx(s.doc, [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId: 'motion.move.pull-back-tilt' } }]).doc;
    expect(why(refused(tilt, [{ op: 'set_living_picture', args: { clipId: s.clip } }]))).toBe('living_rotated');
    // kept: an entrance, an exit, a loop, hand keys, a move made for another length (the clip was trimmed after it)
    const keep: OpCall[][] = [
      [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId: 'motion.in.zoom-in' } }],
      [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId: 'motion.out.fade' } }],
      [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId: 'motion.loop.breathe' } }],
      [{ op: 'set_keyframe', args: { clipId: s.clip, property: 'scale', time: f(0), value: 1 } }, { op: 'set_keyframe', args: { clipId: s.clip, property: 'scale', time: f(150), value: 1.18 } }],
      [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId: 'motion.move.ken-burns-in' } }, { op: 'trim_clip', args: { clipId: s.clip, edge: 'end', to: f(120) } }],
      [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId: 'motion.move.ken-burns-in' } }, { op: 'set_keyframe', args: { clipId: s.clip, property: 'scale', time: f(75), value: 1.05 } }],
    ];
    for (const ops of keep) {
      const before = tx(s.doc, ops).doc;
      const r = live(before);
      expect(r.results[0]!.output!.replacedMotion, JSON.stringify(ops)).toEqual([]);
      expect(findClip(r.doc, s.clip)!.clip.keyframes, JSON.stringify(ops)).toEqual(findClip(before, s.clip)!.clip.keyframes);
    }
    // the hand-key twin of Ken Burns is the same keys: recognised only because they ARE the preset's keys (same easing)
    const twin = tx(s.doc, [{ op: 'replace_clip_keyframes', args: { clipId: s.clip, property: 'scale', keys: [{ time: f(0), value: 1, easing: 'ease-in-out' }, { time: f(150), value: 1.18, easing: 'linear' }] } }]).doc;
    expect(live(twin).results[0]!.output!.replacedMotion).toEqual(['motion.move.ken-burns-in']);
  });
  it('W1 set_living_picture on a clip that has a living picture updates that one (at most one per clip)', () => {
    const s = livingDoc();
    const a = tx(s.doc, [{ op: 'set_living_picture', args: { clipId: s.clip, move: 'slide', amount: 0.3, curve: 'gentle' } }], false);
    const id = a.results[0]!.output!.effectId;
    const d1 = tx(a.doc, [{ op: 'add_effect', args: { clipId: s.clip, type: 'blur.gaussian' } }]).doc;
    const b = tx(d1, [{ op: 'set_living_picture', args: { clipId: s.clip, amount: 0.4 } }], false);
    const c = findClip(b.doc, s.clip)!.clip;
    expect(c.effects!.map((e) => e.type)).toEqual([LIVING_EFFECT, 'blur.gaussian']); // same place, same id
    expect(c.effects![0]!.id).toBe(id);
    expect(c.effects![0]!.params).toMatchObject({ move: 'slide', amount: 0.4 }); // the move it had is kept
    expect(c.effects![0]!.keyframes!.travel![0]!.easing).toBe('gentle'); // and its curve
    // a bypassed one is switched on again
    const off = tx(b.doc, [{ op: 'update_effect', args: { clipId: s.clip, effectId: id, enabled: false } }]).doc;
    const on = tx(off, [{ op: 'set_living_picture', args: { clipId: s.clip, move: 'push' } }], false);
    const fx = findClip(on.doc, s.clip)!.clip.effects!.filter((e) => e.type === LIVING_EFFECT);
    expect(fx.map((e) => [e.id, e.enabled, e.params.move, e.params.amount])).toEqual([[id, true, 'push', 0.4]]);
    expect(validateProject(on.doc)).toEqual([]);
  });
  it('W1 depthGrid: golden SHA-256 of the ramp, the flat base with one dab, and 64 strokes at the caps; integer only (same bytes twice) — depthGrid.test.ts', () => {
    expect(depthGrid(DEPTH, { width: 640, height: 360 }).data.length).toBe(256 * 144);
  });
});

describe('every existing path that adds or updates effects (verifier C4, C5, C6)', () => {
  it('add_effect refuses depth.living with a sentence pointing at the feature', () => {
    const s = livingDoc();
    const e = refused(s.doc, [{ op: 'add_effect', args: { clipId: s.clip, type: LIVING_EFFECT } }]);
    expect([e.code, why(e), e.message]).toEqual(['incompatible', 'living_use_op', 'a living picture is added with set_living_picture (the Motion tab), not with add_effect']);
  });
  it('an adjustment clip refuses it (add_adjustment and add_effect on the adjustment): «לתמונה חיה צריך תמונה משלה»', () => {
    const s = livingDoc();
    expect(adjustmentRefusal(LIVING_EFFECT)).toBe('a living picture needs a photo of its own; an adjustment clip has none');
    const a = refused(s.doc, [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: LIVING_EFFECT }] } }]);
    expect(a.message).toMatch(/a living picture needs a photo of its own/);
    const withAdj = tx(s.doc, [{ op: 'add_adjustment', args: { span: 'edit' } }]);
    const adj = withAdj.results[0]!.output!.clipId as string;
    const b = refused(withAdj.doc, [{ op: 'add_effect', args: { clipId: adj, type: LIVING_EFFECT } }]);
    expect(b.message).toBe(`${LIVING_EFFECT} cannot go on an adjustment: a living picture needs a photo of its own; an adjustment clip has none`);
  });
  it('update_effect cannot make the move faster than the rule of thumb (amount or move), may always lower it, and does not switch it on without a depth', () => {
    const s = livingDoc();
    const d = withLiving(s.doc, s.clip, 0.5, 'push');
    const fx = `fx_living_${s.clip}`;
    // a 150-frame clip: push fits amount 1, slide only 0.55
    expect(tx(d, [{ op: 'update_effect', args: { clipId: s.clip, effectId: fx, params: { amount: 1 } } }], false).doc).toBeTruthy();
    const e = refused(d, [{ op: 'update_effect', args: { clipId: s.clip, effectId: fx, params: { move: 'slide', amount: 0.9 } } }]);
    expect([e.code, why(e), e.details.max, e.message]).toEqual(['out_of_bounds', 'living_too_fast', 0.55, 'this clip is too short for that amount; the highest amount that fits it: 0.55']);
    expect(tx(d, [{ op: 'update_effect', args: { clipId: s.clip, effectId: fx, params: { move: 'slide', amount: 0.55 } } }], false).doc).toBeTruthy();
    // already too fast (hand keys): lowering is accepted, raising is not
    const fast = withLiving(s.doc, s.clip, 0.9, 'slide');
    expect(livingComfort(findClip(fast, s.clip)!.clip.effects![0]!, 150, R).ok).toBe(false);
    expect(tx(fast, [{ op: 'update_effect', args: { clipId: s.clip, effectId: fx, params: { amount: 0.8 } } }], false).doc).toBeTruthy();
    expect(why(refused(fast, [{ op: 'update_effect', args: { clipId: s.clip, effectId: fx, params: { amount: 1 } } }]))).toBe('living_too_fast');
    // switched on without a depth: refused; switched off: always accepted
    const off = withLiving(s.doc, s.clip2);
    findClip(off, s.clip2)!.clip.effects![0]!.enabled = false;
    expect(why(refused(off, [{ op: 'update_effect', args: { clipId: s.clip2, effectId: `fx_living_${s.clip2}`, enabled: true } }]))).toBe('living_needs_depth');
  });
  it('what draws with no depth or rotated is "unavailable", never flat (C6; rotated picture-in-picture is cut)', () => {
    const s = livingDoc();
    expect(livingUnavailable(findClip(withLiving(s.doc, s.clip), s.clip)!.clip)).toBeNull();
    expect(livingUnavailable(findClip(withLiving(s.doc, s.clip2), s.clip2)!.clip)).toBe('no_depth');
    const rot = tx(withLiving(s.doc, s.clip), [{ op: 'set_clip_transform', args: { clipId: s.clip, transform: { rotation: 10 } } }]).doc;
    expect(livingUnavailable(findClip(rot, s.clip)!.clip)).toBe('rotated');
    expect(livingUnavailable(findClip(s.doc, s.clip)!.clip)).toBeNull(); // no living picture at all
  });
  it('validation: at most one living picture per clip, only on a photo clip; a depth only on a photo clip', () => {
    const s = livingDoc();
    const two = withLiving(s.doc, s.clip);
    const c = findClip(two, s.clip)!.clip;
    c.effects = [...c.effects!, { ...c.effects![0]!, id: 'fx_2' }];
    expect(validateProject(two).map((i) => i.code)).toEqual(['living_effect']);
    const onVideo = withLiving(s.doc, s.video, 0.5, 'push', 90);
    (findClip(onVideo, s.video)!.clip as MediaClip).depth = DEPTH;
    expect(validateProject(onVideo).map((i) => i.code).sort()).toEqual(['clip_depth', 'living_effect']);
  });
  it('paste attributes, effects group: the living picture is neither copied nor removed from the target; the output counts it', () => {
    const s = livingDoc();
    const d = tx(withLiving(s.doc, s.clip), [{ op: 'add_effect', args: { clipId: s.clip, type: 'blur.gaussian' } }]).doc;
    const r = tx(d, [{ op: 'paste_attributes', args: { fromClipId: s.clip, toClipIds: [s.clip2], groups: ['effects'] } }], false);
    const target = findClip(r.doc, s.clip2)!.clip as MediaClip;
    expect(target.effects!.map((e) => e.type)).toEqual(['blur.gaussian']);
    expect(target.depth).toBeUndefined();
    expect(r.results[0]!.output).toMatchObject({ opOnlyLeftOut: 1 });
    // a target with its own living picture keeps it
    const both = withLiving(tx(d, [{ op: 'set_clip_depth', args: { clipId: s.clip2, depth: DEPTH } }]).doc, s.clip2);
    const r2 = tx(both, [{ op: 'paste_attributes', args: { fromClipId: s.clip, toClipIds: [s.clip2], groups: ['effects'] } }], false);
    expect(findClip(r2.doc, s.clip2)!.clip.effects!.map((e) => e.id)).toContain(`fx_living_${s.clip2}`);
    // a source whose only effect is the living picture has nothing to paste
    const only = tx(withLiving(s.doc, s.clip), [{ op: 'paste_attributes', args: { fromClipId: s.clip, toClipIds: [s.clip2], groups: ['effects', 'transform'] } }], false);
    expect((only.results[0]!.output as any).skipped).toEqual([expect.objectContaining({ clipId: s.clip2, group: 'effects', code: 'source_empty' })]);
  });
  it('the command bar: «תמונה חיה» does not plan add_effect; it is refused with the sentence that points at the Motion tab', () => {
    for (const text of ['הוסף אפקט תמונה חיה', 'add effect living picture']) {
      const r = interpret(text, ctxFor('effect')) as any;
      expect(r.kind, text).toBe('refused');
      expect(r.code).toBe('op_refused');
      expect(r.opError.message).toBe('a living picture is added with set_living_picture (the Motion tab), not with add_effect');
    }
  });
  it('replace_clip_media to another photo is refused while the clip has a drawn depth (it was drawn on this photo)', () => {
    const s = livingDoc();
    const e = refused(s.doc, [{ op: 'replace_clip_media', args: { clipId: s.clip, assetId: s.pic2 } }]);
    expect([e.code, why(e)]).toEqual(['incompatible', 'depth_other_file']);
    expect(tx(s.doc, [{ op: 'replace_clip_media', args: { clipId: s.clip2, assetId: s.pic } }], false).doc).toBeTruthy();
  });
});
