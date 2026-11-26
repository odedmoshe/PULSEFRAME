/**
 * set_grade_curves (wave 8 grade; grade-verify C10): placement, the canonical form, replace and null, no neutral grade when there is
 * nothing to set, the worded refusals, exact undo, and the exclusion from the assistants (their reviewed prompts stay as they are).
 */
import { describe, expect, it } from 'vitest';
import { ASSISTANT_EXCLUDED_OPS, assistantOps, GRADE_CURVE_MESSAGES, listOps, type EffectInstance } from './index.ts';
import { clipOf, curvedArgs, f, gradeOf, project, refusal, tx, undone } from './gradeCurves.testFixture.ts';

const effects = (c: unknown) => ((c as { effects?: EffectInstance[] }).effects ?? []);

describe('set_grade_curves', () => {
  it('adds a neutral grade first (after a time effect) when the clip has none, and sets the canonical curves on it', () => {
    const p = project();
    const withTime = tx(p.doc, [{ op: 'add_effect', args: { clipId: p.picture, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId: p.picture, type: 'time.echo' } }]).doc;
    const r = tx(withTime, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: { ...curvedArgs(), g: [[0, 0], [255, 255]] } } }]);
    const list = effects(clipOf(r.doc, p.picture));
    expect(list.map((e) => e.type)).toEqual(['time.echo', 'color.grade', 'blur.gaussian']);
    expect(list[1]!.curves).toEqual(curvedArgs()); // identity green dropped
    expect(list[1]!.params).toEqual(gradeOf(tx(p.doc, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: {} } }]).doc, p.picture)!.params);
    expect(r.results[0]!.output).toEqual({ effectId: list[1]!.id, curves: curvedArgs() });
    expect(undone(withTime, r.doc)).toEqual(withTime);
  });
  it('uses the first grade in place (same id, turned on, sliders and keyframes kept); replace drops channels not given; null removes', () => {
    const p = project();
    let d = tx(p.doc, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { exposure: 0.4 } } }]).doc;
    const id = gradeOf(d, p.picture)!.id;
    d = tx(d, [{ op: 'set_effect_keyframe', args: { clipId: p.picture, effectId: id, param: 'fade', time: f(0), value: 0.2 } }, { op: 'update_effect', args: { clipId: p.picture, effectId: id, enabled: false } }]).doc;
    const a = tx(d, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: curvedArgs() } }]).doc;
    const g = gradeOf(a, p.picture)!;
    expect([g.id, g.enabled, g.params.exposure, !!g.keyframes?.fade]).toEqual([id, true, 0.4, true]);
    const b = tx(a, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: { b: [[0, 8], [255, 248]] } } }]).doc;
    expect(gradeOf(b, p.picture)!.curves).toEqual({ b: [[0, 8], [255, 248]] });
    const c = tx(b, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: null } }]);
    expect('curves' in gradeOf(c.doc, p.picture)!).toBe(false);
    expect(gradeOf(c.doc, p.picture)!.id).toBe(id);
    expect(undone(b, c.doc)).toEqual(b);
    // all-identity curves are the same as null
    const e = tx(b, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: { master: [[0, 0], [255, 255]] } } }]).doc;
    expect(e).toEqual(c.doc);
  });
  it('adds no neutral grade when there is nothing to set (C10b)', () => {
    const p = project();
    for (const curves of [null, { master: [[0, 0], [255, 255]] as [number, number][] }]) {
      const r = tx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves } }]);
      expect(effects(clipOf(r.doc, p.picture))).toEqual([]);
      expect(r.results[0]!.output).toEqual({ effectId: null, curves: null });
    }
  });
  it('works on titles; refuses captions, sound, locked tracks and a full effect list with the existing sentences', () => {
    const p = project();
    expect(gradeOf(tx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.title, curves: curvedArgs() } }]).doc, p.title)!.curves).toEqual(curvedArgs());
    expect(refusal(() => tx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.cue, curves: curvedArgs() } }])).code).toBe('incompatible');
    expect(refusal(() => tx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.sound, curves: curvedArgs() } }])).code).toBe('incompatible');
    expect(refusal(() => tx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.lockedClip, curves: curvedArgs() } }])).code).toBe('track_locked');
    const full = tx(p.doc, Array.from({ length: 16 }, () => ({ op: 'add_effect', args: { clipId: p.picture, type: 'blur.gaussian' } }))).doc;
    const e = refusal(() => tx(full, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: curvedArgs() } }]));
    expect([e.code, e.message]).toEqual(['out_of_bounds', GRADE_CURVE_MESSAGES.too_many_effects()]);
  });
  it('refuses bad points in words, naming the channel, with a next step', () => {
    const p = project();
    const cases: [unknown, string, string][] = [
      [{ r: [[0, 0]] }, 'out_of_bounds', GRADE_CURVE_MESSAGES.curve_count('r')],
      [{ master: Array.from({ length: 13 }, (_, i) => [Math.min(255, i * 21), i]) }, 'out_of_bounds', GRADE_CURVE_MESSAGES.curve_count('master')],
      [{ g: [[0, 0], [255, 256]] }, 'out_of_bounds', GRADE_CURVE_MESSAGES.curve_value('g')],
      [{ b: [[0, 0.5], [255, 255]] }, 'out_of_bounds', GRADE_CURVE_MESSAGES.curve_value('b')],
      [{ master: [[0, 0], [120, 30], [118, 40], [255, 255]] }, 'invalid_args', GRADE_CURVE_MESSAGES.curve_points('master')],
      [{ master: [[0, 0], [100, 30], [102, 40], [255, 255]] }, 'invalid_args', GRADE_CURVE_MESSAGES.curve_points('master')],
      [{ master: [[4, 0], [255, 255]] }, 'invalid_args', GRADE_CURVE_MESSAGES.curve_points('master')],
    ];
    for (const [curves, code, message] of cases) {
      const e = refusal(() => tx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves } }]));
      expect([e.code, e.message], JSON.stringify(curves)).toEqual([code, message]);
      expect(e.hint?.length).toBeGreaterThan(20);
    }
    // the argument schema has no merge mode (C10a)
    expect(refusal(() => tx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: curvedArgs(), mode: 'merge' } }])).code).toBe('invalid_args');
  });
  it('is registered, public, and left out of both assistants so their reviewed prompts do not change (C10c)', () => {
    expect(listOps().find((o) => o.name === 'set_grade_curves')?.internal).toBeFalsy();
    expect(ASSISTANT_EXCLUDED_OPS).toContain('set_grade_curves');
    expect(assistantOps()).not.toContain('set_grade_curves');
  });
});
