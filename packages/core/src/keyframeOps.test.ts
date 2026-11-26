/**
 * The keyframe operations of ADR-0019 (keyframes-plan.md §3; keyframe.ts FIXED RULES): set_keyframe / set_effect_keyframe with
 * curves, placeMotion next to custom curves, clear_keyframes on a clamped curve, the range form of replace_clip_keyframes,
 * replace_effect_keyframes and set_keyframe_curve. Every refusal of KEYFRAME_REFUSALS is provoked once, plus the shared ones
 * (channel type, NOT_ANIMATABLE, alignment, uniqueness, value range); undo goes through the entity diff.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, channelKeys, channelRange, channelsFor, createProject, creativeProjection, diffEntities, findClip, isLightChannel, KEYFRAME_OPS_BUILT, KEYFRAME_REFUSALS,
  OpError, restoreEntities, sampleKeyframes, TRANSFORM_RANGE, transformAt, validateProject, type Clip, type Keyframe, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seq = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `ko${seq++}_`, actor: 't' });
/** The refusal of a call: [code, message], or 'ok'. */
const refusal = (doc: ProjectDocument, ops: OpCall[]): [string, string] | 'ok' => {
  try { tx(doc, ops); } catch (e) { if (e instanceof OpError) return [e.code, e.message]; throw e; }
  return 'ok';
};
const clipOf = (d: ProjectDocument, id: string) => findClip(d, id)!.clip;
const fxOf = (d: ProjectDocument, id: string, fxId: string) => clipOf(d, id).effects!.find((e) => e.id === fxId)!;
const k = (fr: number, value: number, easing: Keyframe['easing'] = 'linear', bezier?: Keyframe['bezier']): Keyframe => ({ time: f(fr), value, easing, ...(bezier ? { bezier } : {}) });

/** A title (frames 30..120) with a blur, a colour grade and a posterize (an integer parameter); an adjustment clip with a blur. */
function project() {
  let doc = createProject({ id: 'p', name: 'p' });
  const t = tx(doc, [{ op: 'add_text', args: { text: 'כותרת', start: f(30), duration: f(90) } }]);
  doc = t.doc;
  const clipId = t.results[0]!.output!.clipId as string;
  const fx = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId, type: 'color.grade' } }, { op: 'add_effect', args: { clipId, type: 'stylize.posterize' } }, { op: 'add_effect', args: { clipId, type: 'light.strobe' } }]);
  doc = fx.doc;
  const [blur, grade, poster, strobe] = fx.results.map((r) => r.output!.effectId as string) as [string, string, string, string];
  const adj = tx(doc, [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(60) }, effects: [{ type: 'blur.gaussian' }] } }]);
  doc = adj.doc;
  const adjustId = adj.results[0]!.output!.clipId as string;
  const adjustFx = (adj.results[0]!.output!.effectIds as string[])[0]!;
  return { doc, clipId, blur, grade, poster, strobe, adjustId, adjustFx };
}
/** The entity diff of a step, applied backwards, gives the document before it. */
const undoes = (before: ProjectDocument, after: ProjectDocument) => {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  return creativeProjection(back) === creativeProjection(before);
};

describe('keyframe operations are built', () => {
  it('KEYFRAME_OPS_BUILT', () => expect(KEYFRAME_OPS_BUILT).toBe(true));
});

describe('keyframeChannels.ts', () => {
  it('channelsFor: a title takes the five transforms and the animatable effect parameters (never NOT_ANIMATABLE); an adjustment opacity and its effects', () => {
    const p = project();
    const title = findClip(p.doc, p.clipId)!;
    const chs = channelsFor(title.clip, title.track);
    expect(chs.slice(0, 5)).toEqual([{ property: 'x' }, { property: 'y' }, { property: 'scale' }, { property: 'rotation' }, { property: 'opacity' }]);
    expect(chs).toContainEqual({ effectId: p.blur, param: 'radius' });
    expect(chs).toContainEqual({ effectId: p.grade, param: 'exposure' });
    expect(chs.some((c) => 'effectId' in c && c.effectId === p.strobe && c.param === 'rate')).toBe(false); // NOT_ANIMATABLE
    const adj = findClip(p.doc, p.adjustId)!;
    expect(channelsFor(adj.clip, adj.track)).toEqual([{ property: 'opacity' }, { effectId: p.adjustFx, param: 'radius' }]);
    expect(channelsFor(adj.clip, { ...adj.track, kind: 'audio' })).toEqual([]);
  });
  it('isLightChannel: opacity and non-modulatable parameters; channelRange; channelKeys reads own entries only', () => {
    const { doc, clipId, blur, grade } = project();
    const c = clipOf(doc, clipId);
    expect(isLightChannel(c, { property: 'opacity' })).toBe(true);
    expect(isLightChannel(c, { property: 'scale' })).toBe(false);
    expect(isLightChannel(c, { effectId: blur, param: 'radius' })).toBe(false);
    expect(isLightChannel(c, { effectId: grade, param: 'exposure' })).toBe(true);
    expect(channelRange(c, { property: 'scale' })).toEqual(TRANSFORM_RANGE.scale);
    expect(channelRange(c, { effectId: blur, param: 'radius' })).toEqual({ min: 0, max: 0.2 });
    expect(channelKeys(c, { effectId: blur, param: '__proto__' })).toEqual([]);
    expect(channelKeys(c, { effectId: 'fx_none', param: 'radius' })).toEqual([]);
  });
});

describe('set_keyframe and set_effect_keyframe with curves', () => {
  const sk = (clipId: string, frame: number, value: number, extra: Record<string, unknown> = {}, property = 'scale'): OpCall => ({ op: 'set_keyframe', args: { clipId, property, time: f(frame), value, ...extra } });
  it('easing left out keeps the easing AND the handles of an existing key; a named easing drops them; bezier alone keeps old handles', () => {
    const { doc, clipId } = project();
    let d = tx(doc, [sk(clipId, 0, 1, { easing: 'bezier', bezier: [0.2, 0.1, 0.4, 1.3] }), sk(clipId, 30, 2)]).doc;
    d = tx(d, [sk(clipId, 0, 1.5)]).doc;
    expect(clipOf(d, clipId).keyframes!.scale![0]).toEqual(k(0, 1.5, 'bezier', [0.2, 0.1, 0.4, 1.3]));
    d = tx(d, [sk(clipId, 0, 1.5, { easing: 'bezier' })]).doc;
    expect(clipOf(d, clipId).keyframes!.scale![0]!.bezier).toEqual([0.2, 0.1, 0.4, 1.3]);
    d = tx(d, [sk(clipId, 0, 1.5, { bezier: [0.3, 0, 0.7, 1] })]).doc;
    expect(clipOf(d, clipId).keyframes!.scale![0]!.bezier).toEqual([0.3, 0, 0.7, 1]);
    d = tx(d, [sk(clipId, 0, 1.5, { easing: 'gentle' })]).doc;
    expect(clipOf(d, clipId).keyframes!.scale![0]).toEqual(k(0, 1.5, 'gentle'));
    expect(validateProject(d)).toEqual([]);
  });
  it('refuses bezier/easing mismatches: handles with a named easing, handles alone on a key without a custom curve, bezier without handles', () => {
    const { doc, clipId } = project();
    const d = tx(doc, [sk(clipId, 0, 1), sk(clipId, 30, 2)]).doc;
    expect(refusal(d, [sk(clipId, 0, 1, { easing: 'gentle', bezier: [0.2, 0, 0.8, 1] })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.handlesNeedBezier.message('gentle')]);
    expect(refusal(d, [sk(clipId, 0, 1, { bezier: [0.2, 0, 0.8, 1] })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.handlesNeedBezier.message('linear')]);
    expect(refusal(d, [sk(clipId, 0, 1, { easing: 'bezier' })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.bezierNeedsHandles.message()]);
  });
  it('flash rule: turn-back curves refused on opacity (adjustment opacity too) and on colour grade; allowed on scale and blur radius', () => {
    const p = project();
    for (const easing of ['overshoot', 'anticipate', 'bounce', 'spring'] as const) {
      expect(refusal(p.doc, [sk(p.clipId, 0, 0.5, { easing }, 'opacity')])).toEqual(['invalid_args', KEYFRAME_REFUSALS.curveFlash.message(easing, 'opacity')]);
      expect(refusal(p.doc, [sk(p.adjustId, 0, 0.5, { easing }, 'opacity')])).toEqual(['invalid_args', KEYFRAME_REFUSALS.curveFlash.message(easing, 'opacity')]);
      expect(refusal(p.doc, [{ op: 'set_effect_keyframe', args: { clipId: p.clipId, effectId: p.grade, param: 'exposure', time: f(0), value: 0.5, easing } }])).toEqual(['invalid_args', KEYFRAME_REFUSALS.curveFlash.message(easing, 'color.grade.exposure')]);
    }
    expect(refusal(p.doc, [sk(p.clipId, 0, 0.5, { easing: 'bezier', bezier: [0.3, -0.2, 0.7, 1] }, 'opacity')])[0]).toBe('invalid_args');
    expect(refusal(p.doc, [sk(p.clipId, 0, 0.5, { easing: 'bezier', bezier: [0.3, 0, 0.7, 1] }, 'opacity')])).toBe('ok');
    expect(refusal(p.doc, [sk(p.clipId, 0, 0.5, { easing: 'smooth' }, 'opacity')])).toBe('ok');
    const ok = tx(p.doc, [sk(p.clipId, 0, 1, { easing: 'overshoot' }), sk(p.clipId, 30, 2), { op: 'set_effect_keyframe', args: { clipId: p.clipId, effectId: p.blur, param: 'radius', time: f(0), value: 0.01, easing: 'overshoot' } }, { op: 'set_effect_keyframe', args: { clipId: p.clipId, effectId: p.blur, param: 'radius', time: f(30), value: 0.1 } }]).doc;
    expect(validateProject(ok)).toEqual([]);
    expect(clipOf(ok, p.clipId).keyframes!.scale![0]!.easing).toBe('overshoot');
    expect(fxOf(ok, p.clipId, p.blur).keyframes!.radius![0]!.easing).toBe('overshoot');
  });
  it('a new key inside a non-v1 segment is placed with splitSegment (output.split); inside a v1 segment today\'s rule holds', () => {
    const { doc, clipId, blur } = project();
    let r = tx(doc, [sk(clipId, 0, 1, { easing: 'sharp' }), sk(clipId, 30, 2)]);
    const before = clipOf(r.doc, clipId);
    const at = (c: Clip, fr: number) => transformAt(c, f(30 + fr)).scale;
    const cut = tx(r.doc, [sk(clipId, 13, sampleKeyframes(before.keyframes!.scale!, f(13), TRANSFORM_RANGE.scale))]);
    expect(cut.results[0]!.output!.split).toBe('exact');
    const after = clipOf(cut.doc, clipId);
    expect(after.keyframes!.scale!.map((x) => x.easing)).toEqual(['bezier', 'bezier', 'linear']);
    for (let fr = 0; fr <= 30; fr++) expect(Math.abs(at(after, fr) - at(before, fr))).toBeLessThan(1e-9);
    expect(validateProject(cut.doc)).toEqual([]);
    // the new key takes the given value; a curve with no cubic form is approximate
    r = tx(doc, [sk(clipId, 0, 1, { easing: 'spring' }), sk(clipId, 30, 2)]);
    const spring = tx(r.doc, [sk(clipId, 10, 1.4)]);
    expect(spring.results[0]!.output!.split).toBe('approximate');
    expect(clipOf(spring.doc, clipId).keyframes!.scale![1]).toEqual(k(10, 1.4, 'spring'));
    // a v1 segment: the new key is 'linear', the earlier one untouched
    r = tx(doc, [sk(clipId, 0, 1, { easing: 'ease-in' }), sk(clipId, 30, 2)]);
    const v1 = tx(r.doc, [sk(clipId, 10, 1.4)]);
    expect(v1.results[0]!.output!.split).toBe('none');
    expect(clipOf(v1.doc, clipId).keyframes!.scale).toEqual([k(0, 1, 'ease-in'), k(10, 1.4, 'linear'), k(30, 2)]);
    // effects: the same rule, and the given easing wins for the new key
    const e = tx(doc, [{ op: 'set_effect_keyframe', args: { clipId, effectId: blur, param: 'radius', time: f(0), value: 0.01, easing: 'gentle' } }, { op: 'set_effect_keyframe', args: { clipId, effectId: blur, param: 'radius', time: f(30), value: 0.1 } }, { op: 'set_effect_keyframe', args: { clipId, effectId: blur, param: 'radius', time: f(15), value: 0.05, easing: 'hold' } }]);
    expect(e.results[2]!.output!.split).toBe('exact');
    expect(fxOf(e.doc, clipId, blur).keyframes!.radius!.map((x) => x.easing)).toEqual(['bezier', 'hold', 'linear']);
    expect(validateProject(e.doc)).toEqual([]);
  });
  it('the key caps hold for set_keyframe (2000) and set_effect_keyframe (500)', () => {
    const { doc, clipId, blur } = project();
    const keys = Array.from({ length: 500 }, (_, i) => k(i, 0.01));
    const d = tx(doc, [{ op: 'replace_effect_keyframes', args: { clipId, effectId: blur, param: 'radius', keys } }]).doc;
    expect(refusal(d, [{ op: 'set_effect_keyframe', args: { clipId, effectId: blur, param: 'radius', time: f(600), value: 0.02 } }])).toEqual(['out_of_bounds', KEYFRAME_REFUSALS.tooManyKeys.message(500)]);
    expect(refusal(d, [{ op: 'set_effect_keyframe', args: { clipId, effectId: blur, param: 'radius', time: f(3), value: 0.02 } }])).toBe('ok'); // replaces a key
  });
});

describe('placeMotion and clear_keyframes next to the new curves', () => {
  it('an entrance and an exit next to bezier keys: the document validates, handles are copied or dropped with the easing', () => {
    const { doc, clipId } = project();
    let d = tx(doc, [
      { op: 'set_keyframe', args: { clipId, property: 'scale', time: f(20), value: 1.2, easing: 'bezier', bezier: [0.1, 0.4, 0.5, 1.2] } },
      { op: 'set_keyframe', args: { clipId, property: 'scale', time: f(60), value: 1.6, easing: 'bezier', bezier: [0.2, 0, 0.8, 1] } },
      { op: 'set_keyframe', args: { clipId, property: 'scale', time: f(70), value: 1.1 } },
    ]).doc;
    d = tx(d, [{ op: 'apply_motion_preset', args: { clipId, presetId: 'motion.in.pop' } }]).doc;
    expect(validateProject(d)).toEqual([]);
    d = tx(d, [{ op: 'animate_clip', args: { clipId, in: 'fade', out: 'pop' } }]).doc;
    expect(validateProject(d)).toEqual([]);
    for (const keys of Object.values(clipOf(d, clipId).keyframes ?? {})) for (const x of keys ?? []) expect(x.easing === 'bezier', JSON.stringify(x)).toBe(x.bezier !== undefined);
    d = tx(d, [{ op: 'animate_clip', args: { clipId, out: 'slide-left' } }]).doc;
    expect(validateProject(d)).toEqual([]);
  });
  it('clear_keyframes on an overshooting scale keeps a value inside the range', () => {
    const { doc, clipId } = project();
    let d = tx(doc, [{ op: 'set_keyframe', args: { clipId, property: 'scale', time: f(0), value: 10, easing: 'overshoot' } }, { op: 'set_keyframe', args: { clipId, property: 'scale', time: f(30), value: 20 } }]).doc;
    d = tx(d, [{ op: 'clear_keyframes', args: { clipId, property: 'scale', at: f(17) } }]).doc;
    expect(clipOf(d, clipId).transform.scale).toBe(20);
    expect(validateProject(d)).toEqual([]);
  });
});

describe('replace_clip_keyframes: the range form and curves', () => {
  const rk = (clipId: string, args: Record<string, unknown>, property = 'x'): OpCall => ({ op: 'replace_clip_keyframes', args: { clipId, property, ...args } });
  it('replaces only the keys in [from, to], keeps the others (also keys before the clip start), copies handles, reports replaced', () => {
    const { doc, clipId } = project();
    let d = tx(doc, [rk(clipId, { keys: [k(0, 0), k(10, 0.1), k(20, 0.2), k(40, 0.4)] })]).doc;
    // a trim leaves a key before the clip start
    d = tx(d, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(35) } }]).doc;
    expect(clipOf(d, clipId).keyframes!.x![0]!.time).toEqual(T.sub(f(0), f(5)));
    const r = tx(d, [rk(clipId, { from: f(5), to: f(15), keys: [k(8, 0.3, 'bezier', [0.2, -0.5, 0.6, 1.5]), k(12, 0.25, 'spring')] })]);
    // after the trim the keys sit at −5, 5, 15 and 35: the range takes the two at 5 and 15 (both ends included)
    expect(r.results[0]!.output).toEqual({ keyframeCount: 4, replaced: 2 });
    expect(clipOf(r.doc, clipId).keyframes!.x).toEqual([{ time: T.sub(f(0), f(5)), value: 0, easing: 'linear' }, k(8, 0.3, 'bezier', [0.2, -0.5, 0.6, 1.5]), k(12, 0.25, 'spring'), k(35, 0.4)]);
    expect(validateProject(r.doc)).toEqual([]);
    expect(undoes(d, r.doc)).toBe(true);
  });
  it('the inverse: the range form with the old keys of [from, to] gives back a deep-equal clip; undo through the entity diff too', () => {
    const { doc, clipId } = project();
    const d = tx(doc, [rk(clipId, { keys: [k(0, 0, 'gentle'), k(10, 0.1, 'bezier', [0.1, 0.2, 0.3, 0.9]), k(20, 0.2), k(40, 0.4, 'smooth')] })]).doc;
    const old = clipOf(d, clipId);
    const range = { from: f(5), to: f(25) };
    const oldIn = old.keyframes!.x!.filter((x) => T.lte(range.from, x.time) && T.lte(x.time, range.to));
    const changed = tx(d, [rk(clipId, { ...range, keys: [k(15, -0.3, 'bounce')] })]).doc;
    const back = tx(changed, [rk(clipId, { ...range, keys: oldIn })]).doc;
    expect(clipOf(back, clipId)).toEqual(old);
    expect(undoes(d, changed)).toBe(true);
  });
  it('keys null in a range removes those keys; a property left with none keeps its value at `at`', () => {
    const { doc, clipId } = project();
    let d = tx(doc, [rk(clipId, { keys: [k(0, 0), k(30, 0.6)] })]).doc;
    const r = tx(d, [rk(clipId, { from: f(0), to: f(0), keys: null })]);
    expect(r.results[0]!.output).toEqual({ keyframeCount: 1, replaced: 1 });
    d = tx(r.doc, [rk(clipId, { from: f(0), to: f(60), keys: null, at: f(0) })]).doc;
    expect(clipOf(d, clipId).keyframes).toBeUndefined();
    expect(clipOf(d, clipId).transform.x).toBe(0.6);
  });
  it('refusals: from without to, from after to, a key outside the range, the flash rule on opacity, bezier mismatches, the adjustment rule, alignment, order, value range, the cap', () => {
    const { doc, clipId, adjustId } = project();
    expect(refusal(doc, [rk(clipId, { from: f(0), keys: [k(0, 0)] })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.rangeHalf.message()]);
    expect(refusal(doc, [rk(clipId, { from: f(9), to: f(3), keys: [k(4, 0)] })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.rangeReversed.message()]);
    expect(refusal(doc, [rk(clipId, { from: f(3), to: f(9), keys: [k(4, 0), k(10, 0)] })])).toEqual(['out_of_bounds', KEYFRAME_REFUSALS.keyOutsideRange.message(2)]);
    expect(refusal(doc, [rk(clipId, { keys: [k(0, 0.5, 'overshoot'), k(9, 1)] }, 'opacity')])).toEqual(['invalid_args', KEYFRAME_REFUSALS.curveFlash.message('overshoot', 'opacity')]);
    expect(refusal(doc, [rk(clipId, { keys: [k(0, 0.5, 'bezier')] })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.bezierNeedsHandles.message()]);
    expect(refusal(doc, [rk(clipId, { keys: [k(0, 0.5, 'smooth', [0, 0, 1, 1])] })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.handlesNeedBezier.message('smooth')]);
    expect(refusal(doc, [rk(adjustId, { keys: [k(0, 0.5, 'gentle')] })])[0]).toBe('incompatible');
    expect(refusal(doc, [rk(clipId, { keys: [{ time: T.rt(1, 1000), value: 0, easing: 'linear' }] })])[0]).toBe('invalid_args');
    expect(refusal(doc, [rk(clipId, { keys: [k(5, 0), k(5, 0.1)] })])[0]).toBe('invalid_args');
    expect(refusal(doc, [rk(clipId, { keys: [k(5, 5, 'smooth')] })])).toEqual(['invalid_args', 'value 5 is out of range for x']);
    const full = tx(doc, [rk(clipId, { keys: Array.from({ length: 2000 }, (_, i) => k(i, 0)) })]).doc;
    expect(refusal(full, [rk(clipId, { from: f(2000), to: f(2100), keys: [k(2050, 0)] })])).toEqual(['out_of_bounds', KEYFRAME_REFUSALS.tooManyKeys.message(2000)]);
  });
});

describe('replace_effect_keyframes', () => {
  const re = (clipId: string, effectId: string, param: string, args: Record<string, unknown>): OpCall => ({ op: 'replace_effect_keyframes', args: { clipId, effectId, param, ...args } });
  it('whole list and range form; values through the parameter schema; emptied parameters keep their value at `at`; undo', () => {
    const { doc, clipId, blur, poster } = project();
    const a = tx(doc, [re(clipId, blur, 'radius', { keys: [k(0, 0.01, 'overshoot'), k(30, 0.1, 'smooth'), k(60, 0.05)] })]);
    expect(a.results[0]!.output).toEqual({ keyframeCount: 3, replaced: 0 });
    expect(validateProject(a.doc)).toEqual([]);
    expect(undoes(doc, a.doc)).toBe(true);
    const b = tx(a.doc, [re(clipId, blur, 'radius', { from: f(20), to: f(40), keys: [k(25, 0.15, 'bezier', [0.4, 0, 0.6, 1])] })]);
    expect(b.results[0]!.output).toEqual({ keyframeCount: 3, replaced: 1 });
    expect(fxOf(b.doc, clipId, blur).keyframes!.radius).toEqual([k(0, 0.01, 'overshoot'), k(25, 0.15, 'bezier', [0.4, 0, 0.6, 1]), k(60, 0.05)]);
    const c = tx(b.doc, [re(clipId, blur, 'radius', { keys: null, at: f(60) })]);
    expect(fxOf(c.doc, clipId, blur).keyframes).toBeUndefined();
    expect(fxOf(c.doc, clipId, blur).params.radius).toBe(0.05);
    expect(undoes(b.doc, c.doc)).toBe(true);
    // an integer parameter: a fractional key is refused, an emptied one keeps a whole value
    expect(refusal(doc, [re(clipId, poster, 'levels', { keys: [k(0, 2.5)] })])[0]).toBe('invalid_args');
    const p = tx(doc, [re(clipId, poster, 'levels', { keys: [k(0, 2), k(30, 9)] })]).doc;
    const q = tx(p, [re(clipId, poster, 'levels', { keys: null, at: f(13) })]).doc;
    expect(Number.isInteger(fxOf(q, clipId, poster).params.levels)).toBe(true);
    expect(validateProject(q)).toEqual([]);
  });
  it('refusals: a missing clip or effect, NOT_ANIMATABLE, "__proto__", the range, the flash rule on colour grade, the cap', () => {
    const { doc, clipId, blur, grade, strobe } = project();
    expect(refusal(doc, [re(clipId, 'fx_none', 'radius', { keys: [k(0, 0.1)] })])).toEqual(['not_found', `effect fx_none not found on clip ${clipId}`]);
    expect(refusal(doc, [re(clipId, strobe, 'rate', { keys: [k(0, 1)] })])).toEqual(['invalid_args', '"rate" is not a numeric parameter of light.strobe']);
    expect(refusal(doc, [re(clipId, blur, '__proto__', { keys: [k(0, 0.1)] })])[0]).toBe('invalid_args');
    expect(refusal(doc, [re(clipId, blur, 'radius', { to: f(3), keys: [k(0, 0.1)] })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.rangeHalf.message()]);
    expect(refusal(doc, [re(clipId, blur, 'radius', { from: f(3), to: f(0), keys: [k(0, 0.1)] })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.rangeReversed.message()]);
    expect(refusal(doc, [re(clipId, blur, 'radius', { from: f(0), to: f(3), keys: [k(4, 0.1)] })])).toEqual(['out_of_bounds', KEYFRAME_REFUSALS.keyOutsideRange.message(1)]);
    expect(refusal(doc, [re(clipId, blur, 'radius', { keys: [k(0, 0.5)] })])[0]).toBe('invalid_args');
    expect(refusal(doc, [re(clipId, blur, 'radius', { keys: [k(-1, 0.1)] })])[0]).toBe('out_of_bounds');
    expect(refusal(doc, [re(clipId, grade, 'saturation', { keys: [k(0, 1, 'spring'), k(9, 1.5)] })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.curveFlash.message('spring', 'color.grade.saturation')]);
    const full = tx(doc, [re(clipId, blur, 'radius', { keys: Array.from({ length: 500 }, (_, i) => k(i, 0.01)) })]).doc;
    expect(refusal(full, [re(clipId, blur, 'radius', { from: f(500), to: f(600), keys: [k(550, 0.01)] })])).toEqual(['out_of_bounds', KEYFRAME_REFUSALS.tooManyKeys.message(500)]);
    expect(refusal(doc, [re('clp_none', blur, 'radius', { keys: [k(0, 0.1)] })])).toEqual(['not_found', 'clip clp_none not found']);
  });
});

describe('set_keyframe_curve', () => {
  const sc = (clipId: string, args: Record<string, unknown>): OpCall => ({ op: 'set_keyframe_curve', args: { clipId, ...args } });
  const base = () => {
    const p = project();
    const doc = tx(p.doc, [
      { op: 'replace_clip_keyframes', args: { clipId: p.clipId, property: 'x', keys: [k(0, 0), k(10, 0.1), k(20, 0.2)] } },
      { op: 'replace_clip_keyframes', args: { clipId: p.clipId, property: 'opacity', keys: [k(0, 0), k(10, 1)] } },
      { op: 'replace_effect_keyframes', args: { clipId: p.clipId, effectId: p.blur, param: 'radius', keys: [k(0, 0.01), k(10, 0.1)] } },
    ]).doc;
    return { ...p, doc };
  };
  it("each side: 'after' the key's own easing, 'before' the previous key's, 'both'; handles only with bezier", () => {
    const { doc, clipId } = base();
    const easings = (d: ProjectDocument) => clipOf(d, clipId).keyframes!.x!.map((x) => x.easing);
    const after = tx(doc, [sc(clipId, { channels: [{ property: 'x' }], times: [f(10)], side: 'after', easing: 'smooth' })]);
    expect(easings(after.doc)).toEqual(['linear', 'smooth', 'linear']);
    expect(after.results[0]!.output).toEqual({ changed: 1, skipped: [] });
    expect(easings(tx(doc, [sc(clipId, { channels: [{ property: 'x' }], times: [f(10)], side: 'before', easing: 'smooth' })]).doc)).toEqual(['smooth', 'linear', 'linear']);
    const both = tx(doc, [sc(clipId, { channels: [{ property: 'x' }], times: [f(10)], side: 'both', easing: 'bezier', bezier: [0.1, 0.2, 0.3, 1.4] })]);
    expect(clipOf(both.doc, clipId).keyframes!.x).toEqual([k(0, 0, 'bezier', [0.1, 0.2, 0.3, 1.4]), k(10, 0.1, 'bezier', [0.1, 0.2, 0.3, 1.4]), k(20, 0.2)]);
    expect(validateProject(both.doc)).toEqual([]);
    expect(undoes(doc, both.doc)).toBe(true);
    const named = tx(both.doc, [sc(clipId, { channels: [{ property: 'x' }], times: [f(0)], side: 'after', easing: 'sharp' })]);
    expect(clipOf(named.doc, clipId).keyframes!.x![0]).toEqual(k(0, 0, 'sharp'));
  });
  it('times that are not keys are skipped; several channels, effect channels included; nothing matched is refused', () => {
    const { doc, clipId, blur } = base();
    const r = tx(doc, [sc(clipId, { channels: [{ property: 'x' }, { effectId: blur, param: 'radius' }, { property: 'y' }], times: [f(0), f(20)], side: 'after', easing: 'gentle' })]);
    expect(r.results[0]!.output!.changed).toBe(3);
    expect(r.results[0]!.output!.skipped).toEqual([{ channel: { effectId: blur, param: 'radius' }, time: f(20) }, { channel: { property: 'y' }, time: f(0) }, { channel: { property: 'y' }, time: f(20) }]);
    expect(fxOf(r.doc, clipId, blur).keyframes!.radius![0]!.easing).toBe('gentle');
    expect(refusal(doc, [sc(clipId, { channels: [{ property: 'x' }], times: [f(5)], side: 'both', easing: 'gentle' })])).toEqual(['not_found', KEYFRAME_REFUSALS.noKeysAtTimes.message()]);
  });
  it('refusals: a channel the clip cannot carry, the flash rule on opacity, bezier mismatches, a time off the frame grid', () => {
    const { doc, clipId, adjustId, strobe } = base();
    expect(refusal(doc, [sc(adjustId, { channels: [{ property: 'x' }], times: [f(0)], side: 'after', easing: 'gentle' })])).toEqual(['incompatible', KEYFRAME_REFUSALS.channelNotOnClip.message('x')]);
    expect(refusal(doc, [sc(clipId, { channels: [{ effectId: strobe, param: 'rate' }], times: [f(0)], side: 'after', easing: 'gentle' })])).toEqual(['incompatible', KEYFRAME_REFUSALS.channelNotOnClip.message('light.strobe.rate')]);
    expect(refusal(doc, [sc(clipId, { channels: [{ property: 'opacity' }], times: [f(0)], side: 'after', easing: 'bounce' })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.curveFlash.message('bounce', 'opacity')]);
    expect(refusal(doc, [sc(clipId, { channels: [{ property: 'x' }], times: [f(0)], side: 'after', easing: 'bezier' })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.bezierNeedsHandles.message()]);
    expect(refusal(doc, [sc(clipId, { channels: [{ property: 'x' }], times: [f(0)], side: 'after', easing: 'gentle', bezier: [0, 0, 1, 1] })])).toEqual(['invalid_args', KEYFRAME_REFUSALS.handlesNeedBezier.message('gentle')]);
    expect(refusal(doc, [sc(clipId, { channels: [{ property: 'x' }], times: [T.rt(1, 1000)], side: 'after', easing: 'gentle' })])[0]).toBe('invalid_args');
    // overshoot on scale is allowed
    const s = tx(doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'scale', keys: [k(0, 1), k(9, 2)] } }, sc(clipId, { channels: [{ property: 'scale' }], times: [f(0)], side: 'after', easing: 'overshoot' })]);
    expect(validateProject(s.doc)).toEqual([]);
  });
});

describe('validation of curves (ADR-0019)', () => {
  it("keyframe_curve: bezier exactly when easing is 'bezier'; keyframe_curve_flash: no turn-back curve on opacity or a non-modulatable parameter", () => {
    const { doc, clipId, grade, blur, adjustId } = project();
    const bad = structuredClone(doc);
    const c = clipOf(bad, clipId);
    c.keyframes = { x: [k(0, 0, 'bezier')], opacity: [k(0, 0, 'spring'), k(9, 1)], scale: [k(0, 1, 'linear', [0, 0, 1, 1])] };
    c.effects = c.effects!.map((e) => (e.id === grade ? { ...e, keyframes: { exposure: [k(0, 0, 'overshoot'), k(9, 1)] } } : e.id === blur ? { ...e, keyframes: { radius: [k(0, 0.01, 'bezier', [0.3, -0.4, 0.6, 1.4]), k(9, 0.1)] } } : e));
    const codes = validateProject(bad).map((i) => i.code);
    expect(codes.filter((x) => x === 'keyframe_curve')).toHaveLength(2);
    expect(codes.filter((x) => x === 'keyframe_curve_flash')).toHaveLength(2); // opacity and color.grade; the blur radius may turn back
    const adj = structuredClone(doc);
    const a = clipOf(adj, adjustId);
    a.keyframes = { opacity: [k(0, 0, 'anticipate'), k(9, 1)] };
    expect(validateProject(adj).map((i) => i.code)).toContain('keyframe_curve_flash');
  });
});
