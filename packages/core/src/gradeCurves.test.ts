/**
 * Colour curves (wave 8 grade): the contract the lead landed (schema, structural rule, canonical form, key, presets, validation of
 * clips and multicam angle looks) and, as todo rows, what W1 must make pass for the tables (grade-plan §4.1, proof G1/G2).
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalGradeCurves, EffectInstanceSchema, GRADE_CURVE_PRESETS, gradeCurveIssue, gradeCurvePreset, gradeCurvesKey, GradeCurvesNotBuilt, GradeCurvesSchema,
  gradeCurveTable, gradeCurveTables, GRADE_CURVE_TABLES_BUILT, validateProject, type ProjectDocument,
} from './index.ts';
import { CURVED, curvedArgs, gradeOf, project, tx } from './gradeCurves.testFixture.ts';
import { podcast } from './multicam.testFixture.ts';

describe('grade curves: the contract', () => {
  it('the structural rule: count, then whole values 0..255, then ends at 0 and 255 with inputs at least 4 apart', () => {
    expect(gradeCurveIssue([[0, 0], [255, 255]])).toBeNull();
    expect(gradeCurveIssue([[0, 3], [4, 9], [255, 200]])).toBeNull();
    expect(gradeCurveIssue([[0, 0]])).toBe('curve_count');
    expect(gradeCurveIssue(Array.from({ length: 13 }, (_, i) => [i * 20, i]))).toBe('curve_count');
    expect(gradeCurveIssue('x')).toBe('curve_count');
    expect(gradeCurveIssue([[0, 0], [255, 256]])).toBe('curve_value');
    expect(gradeCurveIssue([[0, 0.5], [255, 255]])).toBe('curve_value');
    expect(gradeCurveIssue([[0, -1], [255, 255]])).toBe('curve_value');
    expect(gradeCurveIssue([[1, 0], [255, 255]])).toBe('curve_points');
    expect(gradeCurveIssue([[0, 0], [254, 255]])).toBe('curve_points');
    expect(gradeCurveIssue([[0, 0], [100, 9], [103, 9], [255, 255]])).toBe('curve_points');
    expect(gradeCurveIssue([[0, 0], [100, 9], [60, 9], [255, 255]])).toBe('curve_points');
  });
  it('the canonical form drops identity channels, orders the channels, and is null when nothing is left; the key follows it', () => {
    expect(canonicalGradeCurves(null)).toBeNull();
    expect(canonicalGradeCurves({ master: [[0, 0], [255, 255]] })).toBeNull();
    const c = canonicalGradeCurves({ b: [[0, 4], [255, 255]], master: [[0, 0], [255, 255]], r: [[0, 0], [255, 250]] });
    expect(Object.keys(c!)).toEqual(['r', 'b']);
    expect(gradeCurvesKey(c)).toBe(JSON.stringify([null, [[0, 0], [255, 250]], null, [[0, 4], [255, 255]]]));
    expect(gradeCurvesKey(null)).toBe('');
    expect(gradeCurvesKey({ r: [[0, 0], [255, 250]], master: [[0, 0], [255, 255]] })).toBe(gradeCurvesKey({ r: [[0, 0], [255, 250]] }));
  });
  it('the schema: an instance may carry curves; an empty curves object, a bad point or an unknown channel is refused', () => {
    const fx = { id: 'fx_1', type: 'color.grade', enabled: true, params: {} };
    expect(EffectInstanceSchema.safeParse({ ...fx, curves: CURVED }).success).toBe(true);
    expect(EffectInstanceSchema.safeParse({ ...fx, curves: {} }).success).toBe(false);
    expect(EffectInstanceSchema.safeParse({ ...fx, curves: { master: [[0, 0], [255, 256]] } }).success).toBe(false);
    expect(GradeCurvesSchema.safeParse({ luma: [[0, 0], [255, 255]] }).success).toBe(false);
  });
  it('the three ready-made curves are valid, canonical and named in both languages («מראה קולנועי», not «סרט»)', () => {
    expect(GRADE_CURVE_PRESETS.map((p) => p.id)).toEqual(['soft', 'faded', 'film']);
    for (const p of GRADE_CURVE_PRESETS) {
      expect(GradeCurvesSchema.safeParse(p.curves).success, p.id).toBe(true);
      for (const c of Object.values(p.curves)) expect(gradeCurveIssue(c), p.id).toBeNull();
      expect(gradeCurvePreset(p.id)).toEqual(canonicalGradeCurves(p.curves as never));
      expect(p.he).toMatch(/[א-ת]/); expect(p.en).toMatch(/[a-z]/i);
    }
    expect(GRADE_CURVE_PRESETS.find((p) => p.id === 'film')!.he).toBe('מראה קולנועי');
  });
  it('validation: curves only on color.grade, each curve valid — on clips and inside a multicam angle look (C4)', () => {
    const p = project();
    const graded = tx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: curvedArgs() } }]).doc;
    expect(validateProject(graded)).toEqual([]);
    const broken = structuredClone(graded);
    gradeOf(broken, p.picture)!.curves = { master: [[0, 0], [2, 9], [255, 255]] };
    expect(validateProject(broken).map((i) => i.code)).toContain('grade_curves');
    const wrongType = tx(graded, [{ op: 'add_effect', args: { clipId: p.picture, type: 'blur.gaussian' } }]).doc;
    const fx = (wrongType.sequences[wrongType.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === p.picture) as { effects: { type: string; curves?: unknown }[] }).effects.find((e) => e.type === 'blur.gaussian')!;
    fx.curves = structuredClone(CURVED);
    expect(validateProject(wrongType).map((i) => i.code)).toContain('grade_curves_type');
    // an angle look (multicam group) is walked as well
    const pod = podcast();
    const withGroup = structuredClone(pod.doc) as ProjectDocument;
    const g = Object.values(withGroup.multicam!)[0]!;
    g.angles.find((a) => a.kind === 'picture')!.look = { transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, effects: [{ id: 'fx_a', type: 'color.grade', enabled: true, params: {}, curves: { r: [[0, 0], [3, 3], [255, 255]] } }] } as never;
    expect(validateProject(pod.doc)).toEqual([]);
    expect(validateProject(withGroup).filter((i) => i.code === 'grade_curves').length).toBe(1);
  });
});

describe('grade curves: the tables (W1, grade-plan §4.1; proof G1, G2)', () => {
  it('stubs throw a typed not-built error until GRADE_CURVE_TABLES_BUILT', () => {
    if (GRADE_CURVE_TABLES_BUILT) return;
    expect(() => gradeCurveTable([[0, 0], [255, 255]])).toThrow(GradeCurvesNotBuilt);
    expect(() => gradeCurveTables({ master: [[0, 0], [255, 255]] })).toThrow(GradeCurvesNotBuilt);
  });
  it.todo('the identity curve gives C[v] = v for every v, and a missing channel is the identity in the composed tables');
  it.todo('at every knot of the presets and of 37 fixed generated sets, C[x_k] = y_k exactly');
  it.todo('a monotone point set gives a non-decreasing table with no segment outside its two knots\' range');
  it.todo('the steepest set [[0,0],[124,0],[128,255],[255,255]] gives …0,0,40,128,215,255… around 124..128 (GRADE_CURVE_STEEPEST_STEP = 88)');
  it.todo('composition is channel first, then master: R[v] = M[Cr[v]] (a master that inverts and a red that lifts give a different table from the other order)');
  it.todo('gradeCurveTablesRgba is 1024 bytes, R, G, B interleaved with alpha 255; gradeCurveTablesDigest is FNV-1a over r, g, b as 8 hex digits, pinned for the presets');
  it.todo('the arithmetic uses only + − × /, comparisons and Math.floor (a source scan of the function bodies finds no Math.pow, sqrt, fround, trigonometry or **)');
});
