/**
 * Colour curves «עקומות» of the colour grade (wave 8 `grade`; .artifacts/wave8/grade-plan.md §3.1, §4.1 as corrected by
 * grade-verify.md C1–C12). Named `gradeCurves` on purpose: `curves.ts` is the keyframe-curve maths of ADR-0019 (C1).
 *
 * Data: an optional `curves` field on a `color.grade` effect instance (effects.ts EffectInstanceSchema): up to four curves (master,
 * red, green, blue), each 2–12 integer points [input, output] on the code values 0..255 the compositor holds (8-bit, non-linear,
 * display-referred: a curve maps CODE VALUES after the transfer function, not light; it says nothing about HDR or log footage).
 * Structural rule (validate.ts, and the op set_grade_curves): the first input is 0, the last is 255, inputs strictly increase with
 * gaps of at least GRADE_CURVE_MIN_GAP. `curves` appears only on `color.grade` (also inside a multicam angle's look).
 * Documents without curves are byte-identical to before; an older build refuses a document with curves (strict instance schema),
 * the same accepted refusal as the `drawn` clip kind (decisions.md, Batch B; grade-verify lead decision 7). No version bump.
 *
 * Where it acts (the WGSL pass of color.grade, gpu.ts; ADR-0008 decision 2 forbids a CPU grade): sliders (exposure → white balance →
 * contrast → saturation → tinted shadows/highlights → fade → clamp), THEN the curves, then premultiply. Channel first, then master.
 *
 * LEAD (pre-pass): the schema, limits, the structural rule, the canonical form, the key, the presets and every signature. W1: the
 * bodies of gradeCurveTable / gradeCurveTables / gradeCurveTablesRgba / gradeCurveTablesDigest (they throw GradeCurvesNotBuilt
 * until then) and gradeCurves.test.ts' todo rows. This file imports zod only (effects.ts imports it).
 */
import { z } from 'zod';

export const GRADE_CURVE_CHANNELS = ['master', 'r', 'g', 'b'] as const;
export type GradeCurveChannel = (typeof GRADE_CURVE_CHANNELS)[number];
/** The grid of both axes: code values 0..GRADE_CURVE_GRID. */
export const GRADE_CURVE_GRID = 255;
export const GRADE_CURVE_MIN_POINTS = 2;
export const GRADE_CURVE_MAX_POINTS = 12;
/** The smallest step between two inputs of one curve. */
export const GRADE_CURVE_MIN_GAP = 4;
/** Entries of one channel's table (one per input code value). */
export const GRADE_CURVE_TABLE_SIZE = 256;
/** The largest step between neighbouring table entries any valid point set can give, computed by the verifier: points [[0,0],[124,0],[128,255],[255,255]] give …0,0,40,128,215,255… (grade-verify C6). */
export const GRADE_CURVE_STEEPEST_STEP = 88;
/** At most this many table textures stay on the device at once (clear-all when full, like MAX_LUT_TEXTURES; each is 1 KB): grade-verify C3. */
export const MAX_GRADE_CURVE_TEXTURES = 16;

const Code = z.number().int().min(0).max(GRADE_CURVE_GRID);
/** [input, output], both code values. */
export const GradeCurvePointSchema = z.tuple([Code, Code]);
/** One curve: its points in input order (the structural rule is gradeCurveIssue, checked by validation and by the op). */
export const GradeCurveSchema = z.array(GradeCurvePointSchema).min(GRADE_CURVE_MIN_POINTS).max(GRADE_CURVE_MAX_POINTS);
export type GradeCurvePoint = z.infer<typeof GradeCurvePointSchema>;
export type GradeCurve = z.infer<typeof GradeCurveSchema>;
/** The `curves` field of a color.grade instance: at least one channel; a missing channel is the identity. */
export const GradeCurvesSchema = z.object({
  master: GradeCurveSchema.optional(), r: GradeCurveSchema.optional(), g: GradeCurveSchema.optional(), b: GradeCurveSchema.optional(),
}).strict().refine((c) => GRADE_CURVE_CHANNELS.some((ch) => c[ch] !== undefined), 'a curves field holds at least one curve');
export type GradeCurves = z.infer<typeof GradeCurvesSchema>;
/** The composed tables the pass reads: R[v] = M[Cr[v]], G[v] = M[Cg[v]], B[v] = M[Cb[v]] (channel first, then master). */
export interface GradeCurveTables { r: Uint8Array; g: Uint8Array; b: Uint8Array }

/** The identity curve, which the canonical form drops. */
export const GRADE_CURVE_IDENTITY: readonly GradeCurvePoint[] = Object.freeze([[0, 0], [GRADE_CURVE_GRID, GRADE_CURVE_GRID]] as GradeCurvePoint[]);
const isIdentity = (c: readonly (readonly number[])[]) => c.length === 2 && c[0]![0] === 0 && c[0]![1] === 0 && c[1]![0] === GRADE_CURVE_GRID && c[1]![1] === GRADE_CURVE_GRID;

/** What is wrong with one curve, in the order the op reports it: the count, then the values, then the order and the ends. */
export type GradeCurveIssue = 'curve_count' | 'curve_value' | 'curve_points';
/** Why a point list is not a valid curve, or null. Takes any value (it checks the shape itself), so the op and validation share it. */
export function gradeCurveIssue(points: unknown): GradeCurveIssue | null {
  if (!Array.isArray(points) || points.length < GRADE_CURVE_MIN_POINTS || points.length > GRADE_CURVE_MAX_POINTS) return 'curve_count';
  for (const p of points) if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => Number.isInteger(v) && v >= 0 && v <= GRADE_CURVE_GRID)) return 'curve_value';
  const pts = points as GradeCurvePoint[];
  if (pts[0]![0] !== 0 || pts[pts.length - 1]![0] !== GRADE_CURVE_GRID) return 'curve_points';
  for (let k = 1; k < pts.length; k++) if (pts[k]![0] - pts[k - 1]![0] < GRADE_CURVE_MIN_GAP) return 'curve_points';
  return null;
}
/** The first broken curve of a curves value, by channel order, or null. */
export function gradeCurvesIssue(curves: Partial<Record<GradeCurveChannel, unknown>>): { channel: GradeCurveChannel; issue: GradeCurveIssue } | null {
  for (const ch of GRADE_CURVE_CHANNELS) {
    if (curves[ch] === undefined) continue;
    const issue = gradeCurveIssue(curves[ch]);
    if (issue) return { channel: ch, issue };
  }
  return null;
}
/**
 * The issues of the curves in one effect list (validate.ts, for clips and for multicam angle looks): `curves` only on color.grade
 * (code grade_curves_type), each curve valid (code grade_curves). `where` names the owner in the message.
 */
export function gradeCurvesListIssues(effects: readonly { id: string; type: string; curves?: unknown }[] | undefined, where: string): { code: 'grade_curves' | 'grade_curves_type'; message: string }[] {
  const out: { code: 'grade_curves' | 'grade_curves_type'; message: string }[] = [];
  for (const fx of effects ?? []) {
    if (fx.curves === undefined) continue;
    if (fx.type !== 'color.grade') { out.push({ code: 'grade_curves_type', message: `${where} effect ${fx.id}: colour curves belong to the colour grade (color.grade) only, not to ${fx.type}` }); continue; }
    const bad = gradeCurvesIssue(fx.curves as Record<string, unknown>);
    if (bad) out.push({ code: 'grade_curves', message: `${where} effect ${fx.id}: the ${bad.channel} curve is invalid (${bad.issue}): it starts at input 0 and ends at input 255, with 2 to 12 whole-number points left to right at least ${GRADE_CURVE_MIN_GAP} apart` });
  }
  return out;
}

/**
 * The canonical form the op stores: channels in GRADE_CURVE_CHANNELS order, copied; a channel that is exactly the identity
 * [[0,0],[255,255]] is dropped; no channel left (or null/undefined given) is null, meaning "no `curves` field". Does not validate.
 */
export function canonicalGradeCurves(curves: Partial<Record<GradeCurveChannel, readonly (readonly number[])[]>> | null | undefined): GradeCurves | null {
  if (!curves) return null;
  const out: GradeCurves = {};
  for (const ch of GRADE_CURVE_CHANNELS) {
    const c = curves[ch];
    if (c === undefined || isIdentity(c)) continue;
    out[ch] = c.map((p) => [p[0]!, p[1]!] as GradeCurvePoint);
  }
  return GRADE_CURVE_CHANNELS.some((ch) => out[ch]) ? out : null;
}
/** A stable text of the canonical curves (the table-texture cache key, gpu.ts): the four channels in order, null for the identity. '' for no curves. */
export function gradeCurvesKey(curves: GradeCurves | null | undefined): string {
  const c = canonicalGradeCurves(curves);
  return c ? JSON.stringify(GRADE_CURVE_CHANNELS.map((ch) => c[ch] ?? null)) : '';
}

/** Thrown by the table functions until W1 has built them (the pass refuses curves with a reason meanwhile: gpu.ts). */
export class GradeCurvesNotBuilt extends Error {
  readonly code = 'grade_curves_not_built' as const;
  constructor(public what: string) { super(`${what}: colour curves are not built in this build yet`); }
}
/** W1 sets this when the four table functions below are built and gradeCurves.test.ts' todo rows pass. */
export const GRADE_CURVE_TABLES_BUILT = true;

/**
 * One curve's table: 256 entries, C[x] for x = 0..255. THE ARITHMETIC (plan §4.1, confirmed by grade-verify), binding for W1:
 * monotone piecewise cubic Hermite (PCHIP: Fritsch–Carlson with the Fritsch–Butland weighted harmonic mean and the MATLAB/Moler end
 * condition), in IEEE-754 binary64 using ONLY + − × /, comparisons and Math.floor (no pow, sqrt, trigonometry, Math.fround or
 * any library call), each expression evaluated in the order written here. Basic binary64 operations are correctly rounded and JS
 * forbids contraction (no FMA), so Node and Chromium (both V8) build identical bytes; proof:grade G1 holds it in both.
 * For points (x_k, y_k), k = 0..n−1:
 *  1. h_k = x_{k+1} − x_k;  d_k = (y_{k+1} − y_k) / h_k.
 *  2. n = 2: m_0 = m_1 = d_0 (a straight line).
 *  3. interior k = 1..n−2: if d_{k−1} · d_k ≤ 0 then m_k = 0; else w1 = 2·h_k + h_{k−1}, w2 = h_k + 2·h_{k−1},
 *     m_k = (w1 + w2) / (w1 / d_{k−1} + w2 / d_k).
 *  4. ends (n ≥ 3), start (the end mirrored with the last two segments): m_0 = ((2·h_0 + h_1)·d_0 − h_0·d_1) / (h_0 + h_1);
 *     if sign(m_0) ≠ sign(d_0) then m_0 = 0; else if sign(d_0) ≠ sign(d_1) and |m_0| > |3·d_0| then m_0 = 3·d_0.
 *  5. for every integer x in 0..255: the segment k with x_k ≤ x ≤ x_{k+1} (x = 255 takes the last segment); t = (x − x_k) / h_k,
 *     u = 1 − t; y = (1 + 2t)·u·u·y_k + t·u·u·h_k·m_k + t·t·(3 − 2t)·y_{k+1} + t·t·(t − 1)·h_k·m_{k+1} (left to right);
 *     C[x] = min(255, max(0, floor(y + 0.5))).
 * Properties (gradeCurves.test.ts, proof G2): C[x_k] = y_k exactly; a monotone point set gives a non-decreasing table and no segment
 * leaves the range of its two knots; the identity gives C[v] = v. Refuses (RangeError) a point list gradeCurveIssue rejects.
 */
export function gradeCurveTable(points: readonly GradeCurvePoint[]): Uint8Array {
  const issue = gradeCurveIssue(points);
  if (issue) throw new RangeError(`gradeCurveTable: the points are not a valid curve (${issue})`);
  const n = points.length;
  const x: number[] = [], y: number[] = [];
  for (let k = 0; k < n; k++) { x.push(points[k]![0]); y.push(points[k]![1]); }
  // 1. segment widths and slopes
  const h: number[] = [], d: number[] = [];
  for (let k = 0; k < n - 1; k++) { h.push(x[k + 1]! - x[k]!); d.push((y[k + 1]! - y[k]!) / h[k]!); }
  const m: number[] = new Array<number>(n).fill(0);
  if (n === 2) {
    // 2. a straight line
    m[0] = d[0]!; m[1] = d[0]!;
  } else {
    // 3. interior: the Fritsch–Butland weighted harmonic mean, 0 at a local extreme or a flat neighbour
    for (let k = 1; k <= n - 2; k++) {
      const a = d[k - 1]!, b = d[k]!;
      if (a * b <= 0) { m[k] = 0; continue; }
      const w1 = 2 * h[k]! + h[k - 1]!, w2 = h[k]! + 2 * h[k - 1]!;
      m[k] = (w1 + w2) / (w1 / a + w2 / b);
    }
    // 4. the ends (MATLAB/Moler), the end mirrored with the last two segments
    m[0] = endSlope(h[0]!, h[1]!, d[0]!, d[1]!);
    m[n - 1] = endSlope(h[n - 2]!, h[n - 3]!, d[n - 2]!, d[n - 3]!);
  }
  // 5. evaluate at every code value
  const out = new Uint8Array(GRADE_CURVE_TABLE_SIZE);
  let k = 0;
  for (let xi = 0; xi < GRADE_CURVE_TABLE_SIZE; xi++) {
    while (k < n - 2 && xi > x[k + 1]!) k++;
    const t = (xi - x[k]!) / h[k]!, u = 1 - t;
    const v = (1 + 2 * t) * u * u * y[k]! + t * u * u * h[k]! * m[k]! + t * t * (3 - 2 * t) * y[k + 1]! + t * t * (t - 1) * h[k]! * m[k + 1]!;
    const c = Math.floor(v + 0.5);
    out[xi] = c < 0 ? 0 : c > GRADE_CURVE_GRID ? GRADE_CURVE_GRID : c;
  }
  return out;
}
const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const abs = (v: number) => (v < 0 ? -v : v);
/** Step 4 of gradeCurveTable for one end: h0, d0 are the end segment, h1, d1 its neighbour. */
function endSlope(h0: number, h1: number, d0: number, d1: number): number {
  const m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (sign(m) !== sign(d0)) return 0;
  if (sign(d0) !== sign(d1) && abs(m) > abs(3 * d0)) return 3 * d0;
  return m;
}
const IDENTITY_TABLE = (() => { const t = new Uint8Array(GRADE_CURVE_TABLE_SIZE); for (let v = 0; v < t.length; v++) t[v] = v; return t; })();
/** The composed tables of a curves value (step 6 of §4.1): R[v] = M[Cr[v]] … a missing curve is the identity; integer composition rounds once per stage. */
export function gradeCurveTables(curves: GradeCurves): GradeCurveTables {
  const bad = gradeCurvesIssue(curves);
  if (bad) throw new RangeError(`gradeCurveTables: the ${bad.channel} curve is not valid (${bad.issue})`);
  const of = (c: GradeCurve | undefined) => (c ? gradeCurveTable(c) : IDENTITY_TABLE);
  const M = of(curves.master);
  const compose = (C: Uint8Array) => { const t = new Uint8Array(GRADE_CURVE_TABLE_SIZE); for (let v = 0; v < t.length; v++) t[v] = M[C[v]!]!; return t; };
  return { r: compose(of(curves.r)), g: compose(of(curves.g)), b: compose(of(curves.b)) };
}
/** The 256×1 rgba8 texture bytes the pass reads at binding 3 (1024 bytes: R, G, B tables interleaved, alpha 255), written raw (no premultiply). */
export function gradeCurveTablesRgba(tables: GradeCurveTables): Uint8Array {
  for (const ch of ['r', 'g', 'b'] as const) if (tables[ch].length !== GRADE_CURVE_TABLE_SIZE) throw new RangeError(`gradeCurveTablesRgba: the ${ch} table has ${tables[ch].length} entries, not ${GRADE_CURVE_TABLE_SIZE}`);
  const out = new Uint8Array(GRADE_CURVE_TABLE_SIZE * 4);
  for (let v = 0; v < GRADE_CURVE_TABLE_SIZE; v++) { out[v * 4] = tables.r[v]!; out[v * 4 + 1] = tables.g[v]!; out[v * 4 + 2] = tables.b[v]!; out[v * 4 + 3] = 255; }
  return out;
}
/** FNV-1a 32-bit over r, then g, then b (768 bytes), as 8 hex digits: proof G1 compares it between Node and Chromium (window.__pfGradeCurveHash). */
export function gradeCurveTablesDigest(tables: GradeCurveTables): string {
  let hsh = 0x811c9dc5;
  for (const t of [tables.r, tables.g, tables.b]) for (let i = 0; i < t.length; i++) { hsh ^= t[i]!; hsh = Math.imul(hsh, 0x01000193) >>> 0; }
  return hsh.toString(16).padStart(8, '0');
}

/**
 * The ready-made curves «עקומות מוכנות» (points only). Each is a starting point, not a judgement; nobody has looked at them on real
 * footage (grade.presetsUnseen says so under the buttons). The names: «מראה קולנועי», not «סרט» (film / ribbon; grade-verify C12).
 */
export const GRADE_CURVE_PRESETS = [
  { id: 'soft', he: 'ניגודיות רכה', en: 'Soft contrast', curves: { master: [[0, 0], [64, 56], [192, 200], [255, 255]] } },
  { id: 'faded', he: 'דהוי', en: 'Faded', curves: { master: [[0, 24], [128, 128], [255, 236]] } },
  { id: 'film', he: 'מראה קולנועי', en: 'Cinematic look', curves: { master: [[0, 10], [64, 54], [192, 204], [255, 246]], r: [[0, 0], [128, 132], [255, 255]], b: [[0, 8], [128, 124], [255, 248]] } },
] as const satisfies readonly { id: string; he: string; en: string; curves: GradeCurves }[];
export type GradeCurvePresetId = (typeof GRADE_CURVE_PRESETS)[number]['id'];
/** The preset's curves as a fresh mutable value (for set_grade_curves). */
export const gradeCurvePreset = (id: GradeCurvePresetId): GradeCurves => canonicalGradeCurves(GRADE_CURVE_PRESETS.find((p) => p.id === id)!.curves as GradeCurves)!;
