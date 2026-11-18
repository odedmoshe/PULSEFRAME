/**
 * Keeps the Hebrew wording of the refusals of keyframe curves (packages/i18n/src/keyframesWave.ts HE_KEYFRAMES) in step with
 * their fixed English sentences (core keyframe.ts KEYFRAME_REFUSALS; ADR-0019). The sentences are built from the table (the
 * bodies that raise them are W1's, who provokes each one for real); the three refusals the keyframe operations share with
 * older edits are provoked for real here. Every pattern is used. Also: the curve names, op names and command labels exist in
 * both languages, and no string of the track says "velocity" or «מהירות» (those words belong to the transition speed ramp and
 * the clip speed).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, EASINGS, KEYFRAME_OPS, KEYFRAME_REFUSALS, OpError, type KeyframeRefusalKey, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { dictionaries, KEYFRAME_REFUSAL_PATTERNS, SHORTS_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';
import { HE_KEYFRAMES, KEYFRAMES_WAVE_EN, KEYFRAMES_WAVE_HE } from '../../i18n/src/keyframesWave.ts';

const MESSAGES: Record<KeyframeRefusalKey, string> = {
  notBuilt: KEYFRAME_REFUSALS.notBuilt.message('set_keyframe_curve'),
  bezierNeedsHandles: KEYFRAME_REFUSALS.bezierNeedsHandles.message(),
  handlesNeedBezier: KEYFRAME_REFUSALS.handlesNeedBezier.message('ease-in'),
  curveFlash: KEYFRAME_REFUSALS.curveFlash.message('overshoot', 'opacity'),
  channelNotOnClip: KEYFRAME_REFUSALS.channelNotOnClip.message('x'),
  rangeHalf: KEYFRAME_REFUSALS.rangeHalf.message(),
  rangeReversed: KEYFRAME_REFUSALS.rangeReversed.message(),
  keyOutsideRange: KEYFRAME_REFUSALS.keyOutsideRange.message(3),
  tooManyKeys: KEYFRAME_REFUSALS.tooManyKeys.message(500),
  noKeysAtTimes: KEYFRAME_REFUSALS.noKeysAtTimes.message(),
};
/** Refusals worded by another track's table on purpose (the same words as there). */
const ELSEWHERE: Partial<Record<KeyframeRefusalKey, readonly RegExp[]>> = { notBuilt: SHORTS_REFUSAL_PATTERNS };

const rate = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, rate);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `kw${n++}_`, actor: 'test' });
const refusalOf = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };

describe('Hebrew wording of the refusals of keyframe curves (ADR-0019)', () => {
  it('every refusal is worded in Hebrew by exactly one keyframe pattern (or, on purpose, by another table); no pattern is left unused', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual(Object.keys(KEYFRAME_REFUSALS).sort());
    const used = new Set<number>();
    for (const [key, message] of Object.entries(MESSAGES) as [KeyframeRefusalKey, string][]) {
      expect(translateRefusal('he', message), `${key}: ${message}`).toMatch(/[֐-׿]/);
      expect(translateRefusal('en', message)).toBeUndefined();
      const hits = KEYFRAME_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      const elsewhere = ELSEWHERE[key];
      if (elsewhere) {
        expect(hits, `${key} is worded by its own table`).toEqual([]);
        expect(elsewhere.filter((re) => re.test(message)), key).toHaveLength(1);
        continue;
      }
      expect(hits.length, `${key} is recognised by exactly one keyframe pattern`).toBe(1);
      used.add(hits[0]!);
    }
    // the three shared refusals, provoked for real with today's operations
    let doc = createProject({ id: 'prj_kw', name: 'kw', width: 640, height: 360, frameRate: rate });
    const added = tx(doc, [{ op: 'add_text', args: { text: 'א', start: f(0), duration: f(60) } }]);
    doc = added.doc;
    const clipId = added.results[0]!.affectedIds[0]!;
    const fx = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }]);
    doc = fx.doc;
    const effectId = (fx.results[0]!.output as { effectId: string }).effectId;
    const real = [
      refusalOf(() => tx(doc, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: f(0), value: 9 } }])).message,
      refusalOf(() => tx(doc, [{ op: 'set_effect_keyframe', args: { clipId, effectId, param: 'nope', time: f(0), value: 1 } }])).message,
      refusalOf(() => tx(doc, [{ op: 'set_effect_keyframe', args: { clipId, effectId: 'fx_none', param: 'radius', time: f(0), value: 1 } }])).message,
    ];
    for (const message of real) {
      expect(translateRefusal('he', message), message).toMatch(/[֐-׿]/);
      const hits = KEYFRAME_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      expect(hits.length, message).toBe(1);
      used.add(hits[0]!);
    }
    expect(KEYFRAME_REFUSAL_PATTERNS.filter((_, i) => !used.has(i)).map((re) => re.source)).toEqual([]);
    // numbers and channel names survive
    expect(translateRefusal('he', MESSAGES.tooManyKeys)).toContain('500');
    expect(translateRefusal('he', MESSAGES.curveFlash)).toContain('opacity');
  });
  it('every curve, keyframe operation and keyframe command has words in both languages, and the two languages differ', () => {
    const he = dictionaries.he as Record<string, string>, en = dictionaries.en as Record<string, string>;
    const keys = [...EASINGS.map((e) => `curve.name.${e}`), ...KEYFRAME_OPS.map((o) => `op.${o}`), 'op.replace_clip_keyframes',
      'cmd.keyframeFocus', 'cmd.keyframeSmooth', 'cmd.keyframeLinear', 'cmd.keyframeCurve', 'cmd.keyframeCopy', 'cmd.keyframePaste', 'cmd.motionPath'];
    for (const k of keys) {
      expect(he[k]?.trim(), `he ${k}`).toBeTruthy();
      expect(en[k]?.trim(), `en ${k}`).toBeTruthy();
      expect(he[k], k).not.toBe(en[k]);
    }
    expect(Object.keys(KEYFRAMES_WAVE_EN).sort()).toEqual(Object.keys(KEYFRAMES_WAVE_HE).sort());
    // the dictionaries carry the track's own words (no later spread replaced one of them)
    for (const k of Object.keys(KEYFRAMES_WAVE_HE)) expect(he[k], k).toBe((KEYFRAMES_WAVE_HE as Record<string, string>)[k]);
  });
  it('no string of the track says "velocity" or «מהירות»', () => {
    const texts = [...Object.values(KEYFRAMES_WAVE_HE), ...Object.values(KEYFRAMES_WAVE_EN), ...Object.values(MESSAGES).map((m) => translateRefusal('he', m) ?? ''), ...HE_KEYFRAMES.map(([re]) => re.source)];
    expect(texts.filter((s) => /velocity|מהירות/i.test(s))).toEqual([]);
  });
});
