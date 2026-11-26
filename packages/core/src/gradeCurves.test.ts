/**
 * Colour curves (wave 8 grade): the contract the lead landed (schema, structural rule, canonical form, key, presets, validation of
 * clips and multicam angle looks) and, what W1 made pass for the tables (grade-plan §4.1, proof G1/G2).
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalGradeCurves, EffectInstanceSchema, GRADE_CURVE_PRESETS, gradeCurveIssue, gradeCurvePreset, gradeCurvesKey, GradeCurvesNotBuilt, GradeCurvesSchema,
  gradeCurveTable, gradeCurveTables, gradeCurveTablesDigest, gradeCurveTablesRgba, GRADE_CURVE_STEEPEST_STEP, GRADE_CURVE_TABLES_BUILT, validateProject,
  type GradeCurvePoint, type ProjectDocument,
} from './index.ts';
import fs from 'node:fs';
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
  /** 37 fixed point sets from an integer generator (an LCG; every third one monotone), so the properties run on more than the presets. */
  const generated = (): GradeCurvePoint[][] => {
    let st = 20261126;
    const next = (mod: number) => { st = (Math.imul(st, 1103515245) + 12345) >>> 0; return (st >>> 8) % mod; };
    const out: GradeCurvePoint[][] = [];
    for (let s = 0; out.length < 37; s++) {
      const n = 2 + next(11);
      const xs = new Set<number>([0, 255]);
      while (xs.size < n) xs.add(4 + next(248));
      const x = [...xs].sort((a, b) => a - b);
      if (x.some((v, k) => k > 0 && v - x[k - 1]! < 4)) continue;
      let y = x.map(() => next(256));
      if (s % 3 === 0) y = [...y].sort((a, b) => a - b);
      out.push(x.map((v, k) => [v, y[k]!] as GradeCurvePoint));
    }
    return out;
  };
  const presetCurves = GRADE_CURVE_PRESETS.flatMap((p) => Object.values(p.curves) as unknown as GradeCurvePoint[][]);
  it('GRADE_CURVE_TABLES_BUILT is set and the stubs no longer throw', () => {
    expect(GRADE_CURVE_TABLES_BUILT).toBe(true);
    expect(() => gradeCurveTable([[0, 0], [255, 255]])).not.toThrow();
    expect(new GradeCurvesNotBuilt('x').code).toBe('grade_curves_not_built');
  });
  it('the identity curve gives C[v] = v for every v, and a missing channel is the identity in the composed tables', () => {
    const id = gradeCurveTable([[0, 0], [255, 255]]);
    expect(Array.from(id)).toEqual(Array.from({ length: 256 }, (_, v) => v));
    const t = gradeCurveTables({ r: [[0, 10], [255, 250]] });
    expect(Array.from(t.g)).toEqual(Array.from(id));
    expect(Array.from(t.b)).toEqual(Array.from(id));
    expect(Array.from(t.r)).toEqual(Array.from(gradeCurveTable([[0, 10], [255, 250]])));
    expect(t.r[0]).toBe(10); expect(t.r[255]).toBe(250);
  });
  it('at every knot of the presets and of 37 fixed generated sets, C[x_k] = y_k exactly', () => {
    const sets = [...presetCurves, ...generated()];
    expect(sets.length).toBe(presetCurves.length + 37);
    for (const pts of sets) {
      expect(gradeCurveIssue(pts)).toBeNull();
      const t = gradeCurveTable(pts);
      expect(t.length).toBe(256);
      for (const [x, y] of pts) expect(t[x], JSON.stringify(pts)).toBe(y);
    }
  });
  it('a monotone point set gives a non-decreasing table with no segment outside its two knots\' range', () => {
    const mono = [...presetCurves, ...generated()].filter((p) => p.every((q, k) => k === 0 || q[1] >= p[k - 1]![1]));
    expect(mono.length).toBeGreaterThanOrEqual(13);
    for (const pts of mono) {
      const t = gradeCurveTable(pts);
      for (let v = 1; v < 256; v++) expect(t[v]!, JSON.stringify(pts)).toBeGreaterThanOrEqual(t[v - 1]!);
      for (let k = 0; k + 1 < pts.length; k++) for (let v = pts[k]![0]; v <= pts[k + 1]![0]; v++) {
        expect(t[v]!).toBeGreaterThanOrEqual(Math.min(pts[k]![1], pts[k + 1]![1]));
        expect(t[v]!).toBeLessThanOrEqual(Math.max(pts[k]![1], pts[k + 1]![1]));
      }
    }
    // a non-monotone set holds its knots too, and a local extreme gets slope 0 (no overshoot past the peak)
    const peak = gradeCurveTable([[0, 0], [128, 200], [255, 0]]);
    expect(Math.max(...peak)).toBe(200);
  });
  it('the steepest set [[0,0],[124,0],[128,255],[255,255]] gives …0,0,40,128,215,255… around 124..128 (GRADE_CURVE_STEEPEST_STEP = 88)', () => {
    const t = gradeCurveTable([[0, 0], [124, 0], [128, 255], [255, 255]]);
    expect(Array.from(t.slice(123, 130))).toEqual([0, 0, 40, 128, 215, 255, 255]);
    let s = 0; for (let v = 1; v < 256; v++) s = Math.max(s, t[v]! - t[v - 1]!);
    expect(s).toBe(GRADE_CURVE_STEEPEST_STEP);
    // no generated set is steeper than the verifier's bound
    for (const pts of generated()) { const g = gradeCurveTable(pts); for (let v = 1; v < 256; v++) expect(Math.abs(g[v]! - g[v - 1]!)).toBeLessThanOrEqual(GRADE_CURVE_STEEPEST_STEP); }
  });
  it('composition is channel first, then master: R[v] = M[Cr[v]] (a master that inverts and a red that lifts give a different table from the other order)', () => {
    const master: GradeCurvePoint[] = [[0, 255], [255, 0]], red: GradeCurvePoint[] = [[0, 0], [128, 200], [255, 255]];
    const M = gradeCurveTable(master), Cr = gradeCurveTable(red);
    const t = gradeCurveTables({ master, r: red });
    for (let v = 0; v < 256; v++) expect(t.r[v]).toBe(M[Cr[v]!]);
    const otherOrder = Array.from({ length: 256 }, (_, v) => Cr[M[v]!]);
    expect(Array.from(t.r)).not.toEqual(otherOrder);
    expect(Array.from(t.g)).toEqual(Array.from(M));
  });
  it('refuses a point list the structural rule rejects (RangeError)', () => {
    expect(() => gradeCurveTable([[0, 0], [2, 9], [255, 255]])).toThrow(RangeError);
    expect(() => gradeCurveTables({ g: [[1, 0], [255, 255]] })).toThrow(RangeError);
  });
  it('gradeCurveTablesRgba is 1024 bytes, R, G, B interleaved with alpha 255; gradeCurveTablesDigest is FNV-1a over r, g, b as 8 hex digits, pinned for the presets', () => {
    const t = gradeCurveTables(gradeCurvePreset('film'));
    const rgba = gradeCurveTablesRgba(t);
    expect(rgba.length).toBe(1024);
    for (let v = 0; v < 256; v++) expect([rgba[v * 4], rgba[v * 4 + 1], rgba[v * 4 + 2], rgba[v * 4 + 3]]).toEqual([t.r[v], t.g[v], t.b[v], 255]);
    // FNV-1a written out independently: offset basis 2166136261, prime 16777619
    let h = 2166136261n;
    for (const ch of [t.r, t.g, t.b]) for (const byte of ch) h = ((h ^ BigInt(byte)) * 16777619n) & 0xffffffffn;
    expect(gradeCurveTablesDigest(t)).toBe(h.toString(16).padStart(8, '0'));
    expect(Object.fromEntries(GRADE_CURVE_PRESETS.map((p) => [p.id, gradeCurveTablesDigest(gradeCurveTables(gradeCurvePreset(p.id)))]))).toEqual({ soft: '43c65bb2', faded: 'e0889ca5', film: '06c81019' });
    expect(gradeCurveTablesDigest(gradeCurveTables({ master: [[0, 0], [255, 255]] }))).toBe('6217cec5');
    expect(() => gradeCurveTablesRgba({ r: new Uint8Array(3), g: t.g, b: t.b })).toThrow(RangeError);
  });
  it('the arithmetic uses only + − × /, comparisons and Math.floor (a source scan of the function bodies finds no Math.pow, sqrt, fround, trigonometry or **)', () => {
    const src = fs.readFileSync(new URL('./gradeCurves.ts', import.meta.url), 'utf8');
    const body = (name: string) => { const at = src.indexOf(`function ${name}(`); expect(at, name).toBeGreaterThan(0); const end = src.indexOf('\n}\n', at); return src.slice(at, end); };
    const code = [body('gradeCurveTable'), body('endSlope'), src.slice(src.indexOf('const sign ='), src.indexOf('/** Step 4'))].join('\n').replace(/\/\/.*$/gm, '');
    const maths = [...code.matchAll(/Math\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(maths)).toEqual(new Set(['floor']));
    expect(code).not.toMatch(/\*\*|fround|sqrt|pow|sin|cos|exp|log/);
  });
});
