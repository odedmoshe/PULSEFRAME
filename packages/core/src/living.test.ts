/**
 * living.ts (wave 8 living, W1): the travel keys set_living_picture writes, the whole-clip move it replaces, and the agents' summary
 * line. Synthetic documents only; nobody has looked at a picture.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { findClip, LIVING_CURVES, LIVING_EFFECT, livingComfort, livingMaxAmount, livingReplacedMotion, livingSummaryLine, livingTravelKeys, MOTION_PRESETS, type MediaClip } from './index.ts';
import { DEPTH, f, livingDoc, R, tx, withLiving } from './living.testFixture.ts';

const RATES = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }];

describe('livingTravelKeys', () => {
  it('two keys {time, value, easing}: 0 at clip-local frame 0 with the curve, 1 at the last frame, linear; frame-aligned rational times', () => {
    expect(livingTravelKeys(150, R, 'ease-in-out')).toEqual([{ time: T.frameTime(0, R), value: 0, easing: 'ease-in-out' }, { time: T.frameTime(149, R), value: 1, easing: 'linear' }]);
    const ntsc = { num: 30000, den: 1001 };
    const k = livingTravelKeys(300, ntsc, 'gentle');
    expect(k[1]!.time).toEqual(T.frameTime(299, ntsc));
    expect(T.frameIndexAt(k[1]!.time, ntsc)).toBe(299);
  });
  it('at livingMaxAmount the keys fit the rule of thumb frame by frame, for many lengths at 24, 25, 29.97, 30 and 60 fps, every move and curve', () => {
    let checked = 0;
    for (const rate of RATES) for (const seconds of [1, 1.5, 2, 3, 4.5, 5, 7, 9, 12, 20]) {
      const frames = Math.ceil(seconds * rate.num / rate.den);
      for (const move of ['push', 'slide'] as const) for (const curve of LIVING_CURVES) {
        const max = livingMaxAmount(frames, rate, move, curve);
        const c = livingComfort({ params: { move, amount: max }, keyframes: { travel: livingTravelKeys(frames, rate, curve) } }, frames, rate);
        expect(c.ok, `${frames} frames at ${rate.num}/${rate.den}, ${move}, ${curve}, amount ${max}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBe(5 * 10 * 2 * 3);
  });
});

describe('livingReplacedMotion', () => {
  it('recognises every whole-clip move preset at its default and other amounts; nothing else', () => {
    const s = livingDoc();
    for (const m of MOTION_PRESETS.filter((x) => x.kind === 'move')) for (const amount of [undefined, 0.4, 1.5]) {
      const d = tx(s.doc, [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId: m.id, ...(amount !== undefined ? { amount } : {}) } }]).doc;
      const c = findClip(d, s.clip)!.clip;
      expect(livingReplacedMotion(c, R), `${m.id} ${amount}`).toEqual({ properties: [...m.properties], presetIds: [m.id] });
    }
    for (const m of MOTION_PRESETS.filter((x) => x.kind !== 'move')) {
      const d = tx(s.doc, [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId: m.id } }]).doc;
      expect(livingReplacedMotion(findClip(d, s.clip)!.clip, R), m.id).toEqual({ properties: [], presetIds: [] });
    }
  });
  it('a move measured from another resting transform, a curve changed by hand, a clip without keys: not a match', () => {
    const s = livingDoc();
    const kb = tx(s.doc, [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId: 'motion.move.ken-burns-in' } }]).doc;
    const moved = tx(kb, [{ op: 'set_clip_transform', args: { clipId: s.clip, transform: { scale: 1.3 } } }]).doc;
    expect(livingReplacedMotion(findClip(moved, s.clip)!.clip, R).presetIds).toEqual([]);
    const bent = structuredClone(kb);
    findClip(bent, s.clip)!.clip.keyframes!.scale![0]!.easing = 'gentle';
    expect(livingReplacedMotion(findClip(bent, s.clip)!.clip, R).presetIds).toEqual([]);
    expect(livingReplacedMotion(findClip(s.doc, s.clip)!.clip, R).presetIds).toEqual([]);
    // the move with an entrance on another property: the move is still recognised, the entrance stays
    const both = tx(kb, [{ op: 'apply_motion_preset', args: { clipId: s.clip, presetId: 'motion.in.fade' } }]).doc;
    expect(livingReplacedMotion(findClip(both, s.clip)!.clip, R)).toEqual({ properties: ['scale'], presetIds: ['motion.move.ken-burns-in'] });
    const r = tx(both, [{ op: 'set_living_picture', args: { clipId: s.clip } }]);
    expect(Object.keys(findClip(r.doc, s.clip)!.clip.keyframes!)).toEqual(['opacity']);
  });
  it('at 29.97 fps too (frame-aligned times compared exactly)', () => {
    const s = livingDoc();
    const ntsc = { num: 30000, den: 1001 };
    const d = structuredClone(s.doc);
    d.settings.frameRate = ntsc;
    const c = findClip(d, s.clip)!.clip;
    c.duration = T.frameTime(150, ntsc);
    c.keyframes = { scale: [{ time: T.frameTime(0, ntsc), value: 1, easing: 'ease-in-out' }, { time: T.frameTime(150, ntsc), value: 1.18, easing: 'linear' }] };
    expect(livingReplacedMotion(c, ntsc).presetIds).toEqual(['motion.move.ken-burns-in']);
    c.keyframes.scale![1]!.time = T.frameTime(149, ntsc);
    expect(livingReplacedMotion(c, ntsc).presetIds).toEqual([]);
  });
});

describe('livingSummaryLine (get_summary, describe_moment)', () => {
  it('one line per living picture; null without one; says when it is bypassed or not shown', () => {
    const s = livingDoc();
    expect(livingSummaryLine(findClip(s.doc, s.clip)!.clip)).toBeNull();
    const d = tx(s.doc, [{ op: 'set_living_picture', args: { clipId: s.clip, move: 'slide', amount: 0.5 } }]).doc;
    expect(livingSummaryLine(findClip(d, s.clip)!.clip)).toBe('living picture: slide, amount 0.5; depth: drawn (1 stroke, horizon 400/1000)');
    const three = tx(s.doc, [{ op: 'set_living_picture', args: { clipId: s.clip2, depth: { v: 1, base: { kind: 'flat' }, strokes: [DEPTH.strokes[0]!, DEPTH.strokes[0]!, DEPTH.strokes[0]!] } } }]).doc;
    expect(livingSummaryLine(findClip(three, s.clip2)!.clip)).toBe('living picture: push, amount 0.5; depth: drawn (3 strokes, flat base)');
    expect(livingSummaryLine(findClip(withLiving(s.doc, s.clip2), s.clip2)!.clip)).toBe('living picture: push, amount 0.5; depth: none; not shown: no drawn depth');
    const rot = tx(d, [{ op: 'set_clip_transform', args: { clipId: s.clip, transform: { rotation: 3 } } }]).doc;
    expect(livingSummaryLine(findClip(rot, s.clip)!.clip)).toMatch(/; not shown: rotated$/);
    const off = structuredClone(d);
    (findClip(off, s.clip)!.clip as MediaClip).effects!.find((e) => e.type === LIVING_EFFECT)!.enabled = false;
    expect(livingSummaryLine(findClip(off, s.clip)!.clip)).toBe('living picture (off): slide, amount 0.5; depth: drawn (1 stroke, horizon 400/1000)');
    void f;
  });
});
