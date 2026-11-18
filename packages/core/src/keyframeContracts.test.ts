/**
 * The contract of keyframe curves (ADR-0019; keyframe.ts): one keyframe definition shared by transform and effect keys, the
 * curve library, the channel references, the argument schemas of the keyframe operations and their registry rows. The bodies
 * are the workers' (W1 built them: the last three checks below; the full coverage is keyframeOps.test.ts).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { z } from 'zod';
import * as schema from './schema.ts';
import {
  ANIMATABLE, channelKey, ChannelRefSchema, CURVES, CurveHandlesSchema, describeCatalog, EASINGS, EffectInstanceSchema, getOp, isV1Easing, KEYFRAME_OPS, KEYFRAME_REFUSALS,
  KeyframeSchema, MAX_EFFECT_KEYS, MAX_TRANSFORM_KEYS, NAMED_BEZIER, RationalTimeSchema, ReplaceEffectKeyframesArgsSchema, SequenceOpArgs, SetKeyframeCurveArgsSchema, TRANSFORM_RANGE,
  TransformSchema, TURN_BACK_EASINGS, V1_EASINGS,
} from './index.ts';
import { applyTransaction, createProject, findClip, OpError, validateProject, type OpCall, type ProjectDocument } from './index.ts';

const t = (n: number) => T.frameTime(n, { num: 30, den: 1 });

describe('one keyframe definition (keyframe.ts)', () => {
  it('schema.ts re-exports the same objects, so every existing import keeps working', () => {
    expect(schema.KeyframeSchema).toBe(KeyframeSchema);
    expect(schema.RationalTimeSchema).toBe(RationalTimeSchema);
    expect(schema.EASINGS).toBe(EASINGS);
    expect(schema.ANIMATABLE).toBe(ANIMATABLE);
  });
  it('the v1 easings come first and in their old order; a v1 key parses to itself', () => {
    expect(EASINGS.slice(0, 5)).toEqual(['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out']);
    expect([...V1_EASINGS]).toEqual(EASINGS.slice(0, 5));
    for (const e of EASINGS) expect(isV1Easing(e)).toBe((V1_EASINGS as readonly string[]).includes(e));
    const k = { time: t(3), value: 0.25, easing: 'ease-out' as const };
    expect(KeyframeSchema.parse(k)).toEqual(k);
    expect(Object.keys(KeyframeSchema.parse(k))).toEqual(['time', 'value', 'easing']);
  });
  it('a custom curve carries four handles: x in 0..1 of the duration, y in -1..2 of the change', () => {
    expect(KeyframeSchema.safeParse({ time: t(0), value: 0, easing: 'bezier', bezier: [0.1, -1, 1, 2] }).success).toBe(true);
    expect(CurveHandlesSchema.safeParse([1.01, 0, 0, 0]).success).toBe(false);
    expect(CurveHandlesSchema.safeParse([0, 2.01, 0, 0]).success).toBe(false);
    expect(CurveHandlesSchema.safeParse([0, 0, 0]).success).toBe(false);
    expect(KeyframeSchema.safeParse({ time: t(0), value: 0, easing: 'elastic' }).success).toBe(false);
  });
  it('effect keys are the same object (handles included), at most 500 per parameter; transform keys at most 2000', () => {
    const fx = { id: 'fx_1', type: 'blur.gaussian', enabled: true, params: { radius: 4 }, keyframes: { radius: [{ time: t(0), value: 2, easing: 'bezier', bezier: [0.3, 0, 0.7, 1] }] } };
    expect(EffectInstanceSchema.safeParse(fx).success).toBe(true);
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ time: t(i), value: 1, easing: 'linear' }));
    expect(EffectInstanceSchema.safeParse({ ...fx, keyframes: { radius: many(MAX_EFFECT_KEYS + 1) } }).success).toBe(false);
    expect(schema.KeyframesSchema.safeParse({ x: many(MAX_TRANSFORM_KEYS) }).success).toBe(true);
    expect(schema.KeyframesSchema.safeParse({ x: many(MAX_TRANSFORM_KEYS + 1) }).success).toBe(false);
  });
});

describe('the curve library', () => {
  it('lists every easing except bezier once; turn-back flags match TURN_BACK_EASINGS; named handles are the CSS ones', () => {
    expect(CURVES.map((c) => c.id).sort()).toEqual(EASINGS.filter((e) => e !== 'bezier').sort());
    for (const c of CURVES) expect(c.turnsBack, c.id).toBe(TURN_BACK_EASINGS.includes(c.id));
    for (const [id, h] of Object.entries(NAMED_BEZIER)) expect(CURVES.find((c) => c.id === id)!.handles).toEqual(h);
    for (const c of CURVES) if (c.handles) expect(CurveHandlesSchema.safeParse([...c.handles]).success, c.id).toBe(true);
  });
  it('list_catalog names the curves and where turn-back curves are refused', () => {
    const cat = describeCatalog().curves;
    expect(cat.named.map((c) => c.id)).toEqual(CURVES.map((c) => c.id));
    expect(cat.custom.easing).toBe('bezier');
    expect(cat.refusedOn).toMatch(/opacity/);
  });
  it('TRANSFORM_RANGE is the declared range of each transform property', () => {
    for (const p of ANIMATABLE) {
      const r = TRANSFORM_RANGE[p];
      expect(TransformSchema.shape[p].safeParse(r.min).success && TransformSchema.shape[p].safeParse(r.max).success, p).toBe(true);
      expect(TransformSchema.shape[p].safeParse(r.max + 1e-9).success || TransformSchema.shape[p].safeParse(r.min - 1e-9).success, p).toBe(false);
    }
  });
});

describe('channels and the keyframe operations', () => {
  it('a channel is a transform property or one parameter of one effect; its text key is stable', () => {
    expect(ChannelRefSchema.safeParse({ property: 'x' }).success).toBe(true);
    expect(ChannelRefSchema.safeParse({ effectId: 'fx_1', param: 'radius' }).success).toBe(true);
    expect(ChannelRefSchema.safeParse({ property: 'x', param: 'radius' }).success).toBe(false);
    expect(ChannelRefSchema.safeParse({ property: 'blur' }).success).toBe(false);
    expect(channelKey({ property: 'opacity' })).toBe('opacity');
    expect(channelKey({ effectId: 'fx_1', param: 'radius' })).toBe('fx_1:radius');
  });
  it('the new operations are registered, public, version 1, with plain object arguments (MCP reads .shape)', () => {
    for (const name of KEYFRAME_OPS) {
      const op = getOp(name)!;
      expect(op, name).toBeDefined();
      expect(op.version).toBe(1);
      expect(op.internal).toBeFalsy();
      expect(op.args).toBeInstanceOf(z.ZodObject);
    }
    expect(getOp('replace_effect_keyframes')!.args).toBe(ReplaceEffectKeyframesArgsSchema);
    expect(getOp('set_keyframe_curve')!.args).toBe(SetKeyframeCurveArgsSchema);
  });
  it('argument schemas: set_keyframe / set_effect_keyframe take handles; replace_clip_keyframes takes the range form; old calls still parse', () => {
    const sk = getOp('set_keyframe')!.args;
    expect(sk.safeParse({ clipId: 'c', property: 'x', time: t(0), value: 0 }).success).toBe(true);
    expect(sk.safeParse({ clipId: 'c', property: 'x', time: t(0), value: 0, easing: 'bezier', bezier: [0.2, 0, 0.8, 1] }).success).toBe(true);
    expect(getOp('set_effect_keyframe')!.args.safeParse({ clipId: 'c', effectId: 'fx', param: 'radius', time: t(0), value: 1, easing: 'spring' }).success).toBe(true);
    const rk = SequenceOpArgs.replace_clip_keyframes;
    expect(rk.safeParse({ clipId: 'c', property: 'x', keys: [{ time: t(0), value: 0, easing: 'linear' }] }).success).toBe(true);
    expect(rk.safeParse({ clipId: 'c', property: 'x', keys: null, from: t(0), to: t(10) }).success).toBe(true);
    expect(ReplaceEffectKeyframesArgsSchema.safeParse({ clipId: 'c', effectId: 'fx', param: 'radius', keys: [{ time: t(0), value: 1, easing: 'smooth' }], from: t(0), to: t(0) }).success).toBe(true);
    expect(SetKeyframeCurveArgsSchema.safeParse({ clipId: 'c', channels: [{ property: 'x' }, { effectId: 'fx', param: 'radius' }], times: [t(0)], side: 'both', easing: 'overshoot' }).success).toBe(true);
    expect(SetKeyframeCurveArgsSchema.safeParse({ clipId: 'c', channels: [], times: [t(0)], side: 'both', easing: 'linear' }).success).toBe(false);
  });
  it('every refusal has a code and a message; the not-built words are the shorts table\'s', () => {
    for (const [k, r] of Object.entries(KEYFRAME_REFUSALS)) { expect(r.code, k).toBeTruthy(); expect(typeof r.message, k).toBe('function'); }
    expect(KEYFRAME_REFUSALS.notBuilt.message('set_keyframe_curve')).toBe('set_keyframe_curve is not built yet');
  });
  // W1 (ADR-0019): the bodies are built; keyframeOps.test.ts, curves.test.ts and animation.test.ts hold the full coverage
  const run = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `kc${n++}_`, actor: 't' });
  let n = 0;
  const title = () => { const r = run(createProject({ id: 'p', name: 'p' }), [{ op: 'add_text', args: { text: 'א', start: t(0), duration: t(60) } }]); return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string }; };
  const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : String(e); } return 'ok'; };
  it('W1: set_keyframe keeps easing and handles when easing is left out, refuses bezier/easing mismatches and turn-back curves on light channels, inserts into a non-v1 segment with splitSegment (output.split)', () => {
    const { doc, clipId } = title();
    let d = run(doc, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: t(0), value: 0, easing: 'bezier', bezier: [0.2, 0, 0.6, 1] } }, { op: 'set_keyframe', args: { clipId, property: 'x', time: t(30), value: 0.5 } }]).doc;
    d = run(d, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: t(0), value: 0.1 } }]).doc;
    expect(findClip(d, clipId)!.clip.keyframes!.x![0]).toEqual({ time: t(0), value: 0.1, easing: 'bezier', bezier: [0.2, 0, 0.6, 1] });
    expect(code(() => run(d, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: t(0), value: 0, easing: 'linear', bezier: [0, 0, 1, 1] } }]))).toBe('invalid_args');
    expect(code(() => run(d, [{ op: 'set_keyframe', args: { clipId, property: 'opacity', time: t(0), value: 0, easing: 'spring' } }]))).toBe('invalid_args');
    expect(run(d, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: t(10), value: 0.2 } }]).results[0]!.output!.split).toBe('exact');
  });
  it('W1: replace_clip_keyframes range form keeps keys outside [from, to] and copies handles; replace_effect_keyframes and set_keyframe_curve are built', () => {
    const { doc, clipId } = title();
    const d = run(doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'y', keys: [{ time: t(0), value: 0, easing: 'linear' }, { time: t(20), value: 0.2, easing: 'linear' }] } },
      { op: 'replace_clip_keyframes', args: { clipId, property: 'y', from: t(10), to: t(30), keys: [{ time: t(15), value: 0.3, easing: 'bezier', bezier: [0.1, 0.2, 0.3, 0.4] }] } },
      { op: 'set_keyframe_curve', args: { clipId, channels: [{ property: 'y' }], times: [t(0)], side: 'after', easing: 'smooth' } }]).doc;
    expect(findClip(d, clipId)!.clip.keyframes!.y).toEqual([{ time: t(0), value: 0, easing: 'smooth' }, { time: t(15), value: 0.3, easing: 'bezier', bezier: [0.1, 0.2, 0.3, 0.4] }]);
    expect(code(() => run(d, [{ op: 'replace_effect_keyframes', args: { clipId, effectId: 'fx_none', param: 'radius', keys: null } }]))).toBe('not_found');
  });
  it('W1: validate.ts keyframe_curve (bezier iff easing bezier) and keyframe_curve_flash (no turn-back curve on opacity)', () => {
    const { doc, clipId } = title();
    const bad = structuredClone(doc);
    findClip(bad, clipId)!.clip.keyframes = { x: [{ time: t(0), value: 0, easing: 'bezier' }], opacity: [{ time: t(0), value: 0, easing: 'bounce' }, { time: t(9), value: 1, easing: 'linear' }] };
    expect(validateProject(bad).map((i) => i.code).sort()).toEqual(['keyframe_curve', 'keyframe_curve_flash']);
  });
});
