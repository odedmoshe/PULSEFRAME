/**
 * «גדלים מול העיניים» pre-pass contract (wave 8 growing): the schemas, the run record (the privacy rule: eye marks are request data
 * only and never reach it, verifier C8), the stubs' honest not-built state, and nothing stored about eyes anywhere in the schema
 * or the op registry. The planner's own checks are todo rows for W1 (growing.test.ts), named after the plan's checks.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  ApplyTemplateArgsSchema, BIND_NAME, eyesFromTransform, GROWING, GROWING_BUILT, GROWING_RECORD_KEYS, GROWING_REFUSALS, GROWING_RUN_RECIPE_ID, GROWING_TEMPLATE_ID,
  GrowingError, GrowingNotBuilt, GrowingParamsSchema, GrowingRebuildParamsSchema, growingPickKey, growingRunPicked, growingRunRecordParams, listOps, planGrowing,
  ProjectSchema, solveAlignment, suggestEyeOrder, createProject, type ResolvedGrowingParams,
} from './index.ts';

const PLANTED = 0.123457;
const eyes = (k: number) => [{ u: PLANTED, v: 0.4 + k / 1000 }, { u: 0.6, v: PLANTED }] as [{ u: number; v: number }, { u: number; v: number }];
const request = { picks: [{ assetId: 'ast_a', frame: null, eyes: eyes(1) }, { assetId: 'ast_v', frame: 12, eyes: eyes(2) }], holdFrames: 30, dissolve: 'short', caption: { date: true, age: true }, personId: 'per_1' };
const resolved = (): ResolvedGrowingParams => ({ ...(GrowingParamsSchema.parse(request) as unknown as ResolvedGrowingParams), sort: 'capture', holdFrames: 30, dissolve: 'short', faceSize: GROWING.faceSize.default, eyeLine: GROWING.eyeLine.default, fill: 'colour', caption: { date: true, age: true }, personId: 'per_1', at: T.ZERO });
/** Every number of a value, deep. */
const numbers = (v: unknown): number[] => (typeof v === 'number' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(numbers) : []);
/** Objects holding two or more numbers, all in [0,1] (the shape of a point). */
const pointLike = (v: unknown): unknown[] => (v && typeof v === 'object' ? [...(Object.values(v).filter((x) => typeof x === 'number').length >= 2 && Object.values(v).filter((x) => typeof x === 'number').every((x) => (x as number) >= 0 && (x as number) <= 1) ? [v] : []), ...Object.values(v).flatMap(pointLike)] : []);

describe('growing contract: the request', () => {
  it('accepts the shown-coordinate marks in the request and refuses what version 1 does not have', () => {
    expect(GrowingParamsSchema.safeParse(request).success).toBe(true);
    expect(GrowingParamsSchema.safeParse({ ...request, picks: request.picks.slice(0, 1) }).success).toBe(false); // two at least
    expect(GrowingParamsSchema.safeParse({ ...request, fill: 'blur' }).success).toBe(false); // cut 4
    expect(GrowingParamsSchema.safeParse({ ...request, music: { assetId: 'x', beatsPerPicture: 2 } }).success).toBe(false); // cut 2
    expect(GrowingParamsSchema.safeParse({ ...request, caption: { date: true, age: false, hebrewDate: true } }).success).toBe(false); // cut 3
    expect(GrowingParamsSchema.safeParse({ ...request, picks: [{ assetId: 'a', frame: null, eyes: [{ u: 1.2, v: 0 }, { u: 0, v: 0 }] }, request.picks[1]] }).success).toBe(false);
    expect(GrowingParamsSchema.safeParse({ ...request, faceSize: 0.5 }).success).toBe(false);
    // a rebuild may leave picks out, or send a pick without eyes (its untouched clip gives them back)
    expect(GrowingRebuildParamsSchema.safeParse({}).success).toBe(true);
    expect(GrowingRebuildParamsSchema.safeParse({ picks: [{ assetId: 'a', frame: null }, { assetId: 'b', frame: 3 }] }).success).toBe(true);
  });
  it('every refusal has a code and a fixed English sentence', () => {
    for (const [k, r] of Object.entries(GROWING_REFUSALS)) expect((r.message as (...a: unknown[]) => string)(11), k).toMatch(/^[a-z].*[a-z0-9]$/);
  });
});

describe('growing contract: the run record holds the picks and settings, never a coordinate (C8)', () => {
  const picked = [{ key: growingPickKey('ast_a', null), assetId: 'ast_a', frame: null }, { key: growingPickKey('ast_v', 12), assetId: 'ast_v', frame: 12 }];
  it('built key by key: only the listed keys, and the planted eye value appears nowhere even when the eyes are passed in', () => {
    const rec = growingRunRecordParams({ ...resolved(), ...({ picks: request.picks, eyes: eyes(9) } as object) } as ResolvedGrowingParams, picked.map((p, i) => ({ ...p, ...(i ? { eyes: eyes(3) } : {}) })), [{ ...picked[0]!, eyes: eyes(4) } as never]);
    expect(Object.keys(rec).every((k) => (GROWING_RECORD_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(JSON.stringify(rec)).not.toContain(String(PLANTED));
    expect(numbers(rec)).not.toContain(PLANTED);
    expect(pointLike(rec)).toEqual([]);
    expect(JSON.stringify(rec)).not.toMatch(/"eyes"|"[uv]":/); // eyeLine (a setting, the same for every pick) is the only eye word
    expect(rec.picked).toEqual(picked);
  });
  it('is what apply_template accepts as params, and reads back', () => {
    const rec = growingRunRecordParams(resolved(), picked);
    expect(ApplyTemplateArgsSchema.safeParse({ templateId: GROWING_TEMPLATE_ID, templateVersion: 1, params: rec, steps: [], ops: [{ op: 'add_track', args: { kind: 'video' } }], slots: [] }).success).toBe(true);
    expect(GROWING_RUN_RECIPE_ID).toBe(`template:${GROWING_TEMPLATE_ID}`);
    expect(growingRunPicked(rec)).toEqual(picked);
    expect(growingRunPicked({ picked: [{ key: 1 }, null, 'x'] })).toEqual([]);
    expect(growingRunPicked(JSON.parse(JSON.stringify(rec)) as Record<string, unknown>, 'removed')).toEqual([]);
  });
  it('pick keys are bind names, stable, and differ between a still and a frame of the same file', () => {
    expect(growingPickKey('ast_a', null)).toMatch(BIND_NAME);
    expect(growingPickKey('ast_a', 0)).not.toBe(growingPickKey('ast_a', null));
    expect(growingPickKey('ast_a', 7)).toBe(growingPickKey('ast_a', 7));
  });
});

describe('growing contract: nothing about eyes is stored, and the stubs are honest', () => {
  it('the project schema has no eye field and no op writes marks', () => {
    expect(Object.keys(ProjectSchema.shape).filter((k) => /eye/i.test(k))).toEqual([]);
    expect(listOps().map((o) => o.name).filter((n) => /eye/i.test(n))).toEqual([]);
    expect(JSON.stringify(createProject({ id: 'prj_g', name: 'g' }))).not.toMatch(/eye/i);
  });
  it('every planner function says it is not built (a typed refusal, never a value) until W1 flips GROWING_BUILT', () => {
    if (GROWING_BUILT) return;
    for (const fn of [() => planGrowing(createProject({ id: 'prj_g', name: 'g' }), request, { capture: {} }), () => solveAlignment(eyes(0), { width: 4, height: 3 }, { width: 16, height: 9, fit: 'contain' }, { faceSize: 0.14, eyeLine: -0.08 }), () => eyesFromTransform({ x: 0, y: 0, scale: 1, rotation: 0 }, { width: 4, height: 3 }, { width: 16, height: 9, fit: 'contain' }, { faceSize: 0.14, eyeLine: -0.08 }), () => suggestEyeOrder({ u: 0, v: 0 }, { u: 1, v: 1 }, { width: 4, height: 3 })]) {
      let e: unknown;
      try { fn(); } catch (x) { e = x; }
      expect(e).toBeInstanceOf(GrowingNotBuilt);
      expect((e as GrowingError).code).toBe('not_built');
    }
  });
});

// W1 (growing.test.ts) makes these pass; named after the plan's checks (growing-plan.md §5, with the verifier's corrections)
describe('growing planner (W1)', () => {
  it.todo('solveAlignment: sourceToFrame of each eye lands on its target within 1e-4 px; eyesFromTransform inverts it within 1e-6 (C7, C11)');
  it.todo('solveAlignment never swaps (C10); suggestEyeOrder swaps above |θ| 90° only');
  it.todo('coverage: the closed-form smallest face size equals a brute-force search on random rectangles; midpoint outside → cannot_cover_all (C11)');
  it.todo('G4 order: capture order, undated picks after the pick they followed, deterministic');
  it.todo('time: cuts are start + i·hold in integer frames; a hold below flashGapFrames is refused hold_too_short, never raised (G15, C12)');
  it.todo('captions never carry a field without words: undated → none, before birth → date only (G8)');
  it.todo('a video pick is an add_clip freeze at sourceTimeOfFrame(frame); the dissolve after it is accepted (G5, G6)');
  it.todo('step and slot counts under apply_template caps; the run record is growingRunRecordParams of the plan (G9–G11 shrunk)');
  it.todo('G17: the plan digest is identical in two runs');
});
