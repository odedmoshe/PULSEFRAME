/**
 * «גדלים מול העיניים» planner (growing.ts, W1): the checks of growing-plan.md §5 as corrected by growing-verify.md (C4, C7, C10–C12).
 * Every plan that is applied here goes through the REAL internal op apply_template, as the server applies it. Documents are
 * synthetic test data (no pictures are decoded: the planner reads sizes, dates and the request only).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, eyesFromTransform, findClip, fitScale, flashGapFrames, frameToSource, GROWING, GROWING_BUILT, GROWING_RECORD_KEYS, GROWING_REFUSALS, GROWING_TEMPLATE_ID, GROWING_VERSION,
  GrowingError, growingPickKey, placed, shownCapture, planGrowing, resolveFields, solveAlignment, sourceTimeOfFrame, sourceToFrame, suggestEyeOrder, validateProject,
  type Asset, type EyePoint, type GrowingFrame, type GrowingPlan, type GrowingPlanContext, type MediaClip, type ProjectDocument, type TextClip,
} from './index.ts';
import { growingCaptionKey, growingCoverFactor, growingInverseTolerance, growingSolveExact, growingUncoveredShare } from './growing.ts';

type Rate = { num: number; den: number };
type Eyes = [EyePoint, EyePoint];
const R30: Rate = { num: 30, den: 1 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00.000Z', importedBy: 'test' };
let hashSeq = 1;
const hash = () => `sha256:${(hashSeq++).toString(16).padStart(64, '0')}`;
const still = (id: string, w = 1200, h = 1600, mime = 'image/jpeg'): Asset => ({ id, kind: 'image', name: `${id}.jpg`, contentHash: hash(), byteSize: 100, container: mime === 'image/jpeg' ? 'jpeg' : 'png', mimeType: mime, duration: T.ZERO, image: { width: w, height: h, codec: 'mjpeg', hasAlpha: false }, provenance: prov } as Asset);
const video = (id: string, frames = 300, o: { rate?: Rate; w?: number; h?: number; startTime?: T.RationalTime } = {}): Asset => {
  const rate = o.rate ?? R30;
  return { id, kind: 'video', name: `${id}.mp4`, contentHash: hash(), byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames + 2, rate),
    video: { width: o.w ?? 1920, height: o.h ?? 1080, frameRate: rate, codec: 'h264', rotation: 0, frameCount: frames, ...(o.startTime ? { startTime: o.startTime } : {}) },
    audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov } as Asset;
};
function project(assets: Asset[], rate: Rate = R30, w = 1920, h = 1080): ProjectDocument {
  const doc = createProject({ id: 'prj_grow', name: 'grow', width: w, height: h, frameRate: rate });
  for (const a of assets) doc.assets[a.id] = a;
  return doc;
}
/** Eyes level, centred around (cu, cv), `gap` apart in u. */
const level = (cu = 0.5, cv = 0.4, gap = 0.1): Eyes => [{ u: cu - gap / 2, v: cv }, { u: cu + gap / 2, v: cv }];
const ctx = (capture: Record<string, string | null> = {}): GrowingPlanContext => ({ capture });
let seedN = 0;
const applied = (doc: ProjectDocument, plan: GrowingPlan) => applyTransaction(doc, [{ op: 'apply_template', args: { templateId: GROWING_TEMPLATE_ID, templateVersion: GROWING_VERSION, params: plan.record, steps: plan.steps, ops: plan.ops, slots: plan.slots, recordRanges: true } }], { idSeed: `gr${seedN++}_`, actor: 'test', allowInternal: true });
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof GrowingError) return { code: e.code, message: e.message, details: e.details }; throw e; } return null; };
const opsOf = (p: GrowingPlan, op: string) => p.ops.filter((o) => o.op === op).map((o) => ({ ...o, args: o.args as Record<string, unknown> }));
function deepFreeze<X>(x: X): X { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x as object)) deepFreeze(v); } return x; }

// ---------- random inputs (fast-check) ----------
const arbShown = fc.record({ width: fc.integer({ min: 64, max: 6000 }), height: fc.integer({ min: 64, max: 6000 }) });
const arbFrame = fc.record({ width: fc.integer({ min: 160, max: 3840 }), height: fc.integer({ min: 160, max: 3840 }), fit: fc.constantFrom('contain' as const, 'cover' as const) });
const arbTarget = fc.record({ faceSize: fc.double({ min: 0.06, max: 0.4, noNaN: true }), eyeLine: fc.double({ min: -0.3, max: 0.1, noNaN: true }) });
const arbPoint = fc.record({ u: fc.double({ min: 0, max: 1, noNaN: true }), v: fc.double({ min: 0, max: 1, noNaN: true }) });
/** Two points at least minEyeShownPx apart on the shown picture (the planner refuses closer ones). */
const arbCase = fc.tuple(arbShown, arbFrame, arbTarget, arbPoint, arbPoint).filter(([s, , , a, b]) => Math.hypot((b.u - a.u) * s.width, (b.v - a.v) * s.height) >= GROWING.minEyeShownPx);
const target = (f: GrowingFrame, faceSize: number, eyeLine: number) => ({ L: { x: f.width / 2 - (faceSize * f.width) / 2, y: f.height / 2 + eyeLine * f.height }, R: { x: f.width / 2 + (faceSize * f.width) / 2, y: f.height / 2 + eyeLine * f.height } });
/**
 * The frame-pixel error the ONE rounding to 1e-6 can move an eye by (stated tolerance): x, y half of 1e-6 of the frame; the scale half
 * of 1e-6 of the eye's distance from the picture centre in fitted px; the rotation half of 1e-6 degree at that radius times the scale.
 */
const roundingPx = (f: GrowingFrame, shown: { width: number; height: number }, e: EyePoint, scale: number) => {
  const k = fitScale(f.width, f.height, shown.width, shown.height, f.fit);
  const r = Math.hypot((e.u - 0.5) * shown.width * k, (e.v - 0.5) * shown.height * k);
  return 0.5e-6 * (f.width + f.height) + 0.5e-6 * r + 0.5e-6 * (Math.PI / 180) * r * scale + 1e-9 * (f.width + f.height);
};

describe('growing planner (W1): the solve and its inverse (C7, C10, C11)', () => {
  it('GROWING_BUILT is on: all four functions are built', () => { expect(GROWING_BUILT).toBe(true); });

  it('the exact formula lands each eye on its target within 1e-4 px; the stored (rounded) transform within the rounding bound', () => {
    fc.assert(fc.property(arbCase, ([shown, frame, tg, a, b]) => {
      const eyes: Eyes = [a, b];
      const L = target(frame, tg.faceSize, tg.eyeLine);
      const exact = placed(frame.width, frame.height, frame.fit, shown.width, shown.height, growingSolveExact(eyes, shown, frame, tg));
      for (const [e, t] of [[a, L.L], [b, L.R]] as const) {
        const p = sourceToFrame(exact, e.u, e.v);
        expect(Math.hypot(p.px - t.x, p.py - t.y)).toBeLessThan(1e-4);
      }
      const s = solveAlignment(eyes, shown, frame, tg);
      const stored = placed(frame.width, frame.height, frame.fit, shown.width, shown.height, s.transform);
      for (const [e, t] of [[a, L.L], [b, L.R]] as const) {
        const p = sourceToFrame(stored, e.u, e.v);
        expect(Math.hypot(p.px - t.x, p.py - t.y)).toBeLessThanOrEqual(roundingPx(frame, shown, e, s.transform.scale) + 1e-4);
      }
      // every stored number is rounded once to 1e-6
      for (const v of Object.values(s.transform)) expect(Math.abs(v * 1e6 - Math.round(v * 1e6))).toBeLessThan(1e-6);
      expect(s.magnification).toBeCloseTo(s.transform.scale * fitScale(frame.width, frame.height, shown.width, shown.height, frame.fit), 4);
      expect(s.inBounds).toBe(s.transform.scale >= 0.01 && s.transform.scale <= 20 && Math.abs(s.transform.x) <= 4 && Math.abs(s.transform.y) <= 4);
    }), { numRuns: 400, seed: 8801 });
  });

  it('the inverse: exact within 1e-9 of the unrounded solve; marks → stored transform → marks within the stated rounding tolerance; the rebuild re-solves to the same transform (1e-6)', () => {
    fc.assert(fc.property(arbCase, ([shown, frame, tg, a, b]) => {
      const eyes: Eyes = [a, b];
      const exact = growingSolveExact(eyes, shown, frame, tg);
      if (!(exact.scale >= 0.01 && exact.scale <= 20 && Math.abs(exact.x) <= 4 && Math.abs(exact.y) <= 4)) return; // the planner excludes these picks
      const back = eyesFromTransform(exact, shown, frame, tg);
      for (const [e, g] of [[a, back[0]], [b, back[1]]] as const) { expect(Math.abs(g.u - e.u)).toBeLessThan(1e-9); expect(Math.abs(g.v - e.v)).toBeLessThan(1e-9); }
      const s = solveAlignment(eyes, shown, frame, tg);
      const fromStored = eyesFromTransform(s.transform, shown, frame, tg);
      for (const [e, g] of [[a, fromStored[0]], [b, fromStored[1]]] as const) {
        const tol = growingInverseTolerance(s.transform, shown, frame);
        expect(Math.abs(g.u - e.u)).toBeLessThanOrEqual(tol.u);
        expect(Math.abs(g.v - e.v)).toBeLessThanOrEqual(tol.v);
      }
      // a point put back on the picture's edge (within growingInverseTolerance) is no longer the exact inverse; everything else re-solves to the stored numbers
      if (fromStored.some((q) => q.u === 0 || q.u === 1 || q.v === 0 || q.v === 1)) return;
      const again = solveAlignment(fromStored, shown, frame, tg).transform;
      for (const key of ['x', 'y', 'scale', 'rotation'] as const) expect(Math.abs(again[key] - s.transform[key])).toBeLessThanOrEqual(GROWING.agreeWithin + 1e-12);
    }), { numRuns: 400, seed: 8802 });
  });

  it('a typical picture comes back within 2e-5 of its width and height (the stated tolerance at 1080p, a 4000×3000 photo, face size 14%)', () => {
    const shown = { width: 4000, height: 3000 }, frame: GrowingFrame = { width: 1920, height: 1080, fit: 'contain' }, tg = { faceSize: 0.14, eyeLine: -0.08 };
    fc.assert(fc.property(fc.double({ min: 0.3, max: 0.45, noNaN: true }), fc.double({ min: 0.3, max: 0.6, noNaN: true }), fc.double({ min: 0.08, max: 0.2, noNaN: true }), fc.double({ min: -0.05, max: 0.05, noNaN: true }), (cu, cv, gap, tilt) => {
      const eyes: Eyes = [{ u: cu - gap / 2, v: cv - tilt }, { u: cu + gap / 2, v: cv + tilt }];
      const back = eyesFromTransform(solveAlignment(eyes, shown, frame, tg).transform, shown, frame, tg);
      for (let i = 0; i < 2; i++) { expect(Math.abs(back[i]!.u - eyes[i]!.u)).toBeLessThan(2e-5); expect(Math.abs(back[i]!.v - eyes[i]!.v)).toBeLessThan(2e-5); }
    }), { numRuns: 200, seed: 8803 });
  });

  it('refuses honestly a transform that puts a target off the picture (as a hand edit can); no point value in the refusal', () => {
    const shown = { width: 1200, height: 1600 }, frame: GrowingFrame = { width: 1920, height: 1080, fit: 'contain' }, tg = { faceSize: 0.14, eyeLine: -0.08 };
    const t = solveAlignment(level(), shown, frame, tg).transform;
    const r = refusal(() => eyesFromTransform({ ...t, scale: t.scale * 0.1 }, shown, frame, tg));
    expect(r).toMatchObject({ code: 'invalid_args', message: GROWING_REFUSALS.needsMarks.message() });
    expect(JSON.stringify(r!.details)).not.toMatch(/\d\.\d/);
    expect(refusal(() => eyesFromTransform({ ...t, x: t.x + 3 }, shown, frame, tg))).toMatchObject({ code: 'invalid_args' });
  });

  it('never swaps (C10): eyes[0] goes left whatever the angle, so a baby lying down (85° or 95°) keeps the click order; suggestEyeOrder swaps only when the line points left', () => {
    const shown = { width: 1200, height: 1600 }, frame: GrowingFrame = { width: 1920, height: 1080, fit: 'contain' }, tg = { faceSize: 0.14, eyeLine: -0.08 };
    const deg = (d: number): Eyes => { const r = (d * Math.PI) / 180; return [{ u: 0.5, v: 0.4 }, { u: 0.5 + (0.1 * Math.cos(r) * 1600) / 1200, v: 0.4 + 0.1 * Math.sin(r) }]; };
    for (const d of [0, 45, 85, 90, 95, 135, 180, -95, -85]) {
      const eyes = deg(d);
      const s = solveAlignment(eyes, shown, frame, tg);
      expect(Math.abs(((s.transform.rotation + d + 540) % 360) - 180)).toBeLessThan(1e-4); // rotation = −angle of b − a
      const p = placed(1920, 1080, 'contain', 1200, 1600, s.transform);
      expect(sourceToFrame(p, eyes[0].u, eyes[0].v).px).toBeLessThan(sourceToFrame(p, eyes[1].u, eyes[1].v).px);
      const [first] = suggestEyeOrder(eyes[0], eyes[1], shown);
      expect(first === eyes[0]).toBe(Math.abs(d) <= 90);
    }
    // 85° and 95°: the solve differs only by the turn the clicks say, not by a flip
    expect(Math.abs(solveAlignment(deg(85), shown, frame, tg).transform.rotation - -85)).toBeLessThan(1e-4);
    expect(Math.abs(solveAlignment(deg(95), shown, frame, tg).transform.rotation - -95)).toBeLessThan(1e-4);
    // suggestEyeOrder measures in shown pixels: a picture twice as wide as tall turns the same (u, v) differently only by the aspect, never across 90°
    expect(suggestEyeOrder({ u: 0.6, v: 0.1 }, { u: 0.59, v: 0.9 }, { width: 4000, height: 100 })).toEqual([{ u: 0.59, v: 0.9 }, { u: 0.6, v: 0.1 }]);
  });
});

describe('growing planner (W1): coverage (C11)', () => {
  /** Brute force: the smallest k (face size × k) at which all four corners map inside the picture, by bisection on the exact solve. */
  const brute = (eyes: Eyes, shown: { width: number; height: number }, frame: GrowingFrame, tg: { faceSize: number; eyeLine: number }) => {
    const covers = (k: number) => {
      const p = placed(frame.width, frame.height, frame.fit, shown.width, shown.height, growingSolveExact(eyes, shown, frame, { faceSize: tg.faceSize * k, eyeLine: tg.eyeLine }));
      return [[0, 0], [frame.width, 0], [0, frame.height], [frame.width, frame.height]].every(([x, y]) => { const q = frameToSource(p, x!, y!); return q.u >= -1e-12 && q.u <= 1 + 1e-12 && q.v >= -1e-12 && q.v <= 1 + 1e-12; });
    };
    let lo = 1e-4, hi = 1e4;
    if (!covers(hi)) return Infinity;
    for (let i = 0; i < 200; i++) { const mid = Math.sqrt(lo * hi); if (covers(mid)) hi = mid; else lo = mid; }
    return hi;
  };
  it('the closed-form factor equals a brute-force search on random rectangles', () => {
    fc.assert(fc.property(arbCase, ([shown, frame, tg, a, b]) => {
      const eyes: Eyes = [a, b];
      const k = growingCoverFactor(eyes, shown, frame, tg), kb = brute(eyes, shown, frame, tg);
      if (!Number.isFinite(kb) || kb > 1e3) { expect(k > 1e3 || !Number.isFinite(k)).toBe(true); return; }
      expect(Math.abs(k - kb) / kb).toBeLessThan(1e-6);
      // at the factor every corner is in (up to float noise); a little below it one is out
      const share = growingUncoveredShare(eyes, shown, frame, { faceSize: tg.faceSize * k * (1 + 1e-9), eyeLine: tg.eyeLine });
      expect(share).toBe(0);
    }), { numRuns: 300, seed: 8804 });
  });
  it('the eye midpoint on the edge of the picture cannot cover: Infinity, and the plan warns cannot_cover_all with no suggestion', () => {
    const frame: GrowingFrame = { width: 1920, height: 1080, fit: 'contain' }, tg = { faceSize: 0.14, eyeLine: -0.08 };
    const edge: Eyes = [{ u: 0, v: 0.3 }, { u: 0, v: 0.6 }];
    expect(growingCoverFactor(edge, { width: 1200, height: 1600 }, frame, tg)).toBe(Infinity);
    const doc = project([still('a'), still('b')]);
    const p = planGrowing(doc, { picks: [{ assetId: 'a', frame: null, eyes: edge }, { assetId: 'b', frame: null, eyes: level() }] }, ctx());
    expect(p.suggestedFaceSize).toBeNull();
    expect(p.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['uncovered_corners', 'cannot_cover_all']));
    expect(p.picks.find((x) => x.assetId === 'a')!.reasons).toContain('uncovered_corners');
    expect(p.picks.find((x) => x.assetId === 'a')!.uncoveredShare).toBeGreaterThan(0);
  });
  it('suggestedFaceSize is the smallest size with no uncovered corner, and at it every pick covers and stays in bounds', () => {
    const doc = project([still('a', 1200, 1600), still('b', 1600, 1200)]);
    const params = { picks: [{ assetId: 'a', frame: null, eyes: level(0.5, 0.4, 0.2) }, { assetId: 'b', frame: null, eyes: level(0.45, 0.45, 0.15) }], faceSize: 0.1 };
    const p = planGrowing(doc, params, ctx());
    expect(p.warnings.map((w) => w.code)).toContain('uncovered_corners');
    expect(p.suggestedFaceSize).not.toBeNull();
    const q = planGrowing(doc, { ...params, faceSize: p.suggestedFaceSize! }, ctx());
    expect(q.warnings.map((w) => w.code)).not.toContain('uncovered_corners');
    expect(q.picks.every((x) => x.uncoveredShare === 0)).toBe(true);
    const below = planGrowing(doc, { ...params, faceSize: p.suggestedFaceSize! - 0.001 }, ctx());
    expect(below.warnings.map((w) => w.code)).toContain('uncovered_corners');
  });
});

describe('growing planner (W1): order (G4) and time (G15, C12)', () => {
  it('capture order by compareWall, then name, frame, given index; an undated pick stays right after the pick it followed', () => {
    const doc = project([still('s18'), still('s20'), still('u1'), still('s19'), still('u2'), video('v', 600)]);
    const capture = { s18: '2018-05-01', s20: '2020-01-01T10:00:00', u1: null, s19: '2019-03-03', u2: null, v: '2019-03-03T08:00:00' };
    const picks = [
      { assetId: 'u2', frame: null, eyes: level() }, // first in the list, undated: stays first
      { assetId: 's20', frame: null, eyes: level() },
      { assetId: 'u1', frame: null, eyes: level() }, // after s20
      { assetId: 's18', frame: null, eyes: level() },
      { assetId: 'v', frame: 400, eyes: level() }, // 2019-03-03 08:00:13 (frame 400 at 30 fps)
      { assetId: 'v', frame: 10, eyes: level() }, // 08:00:00
      { assetId: 's19', frame: null, eyes: level() }, // day only: before the timed captures of that day (compareWall)
    ];
    const p = planGrowing(doc, { picks }, ctx(capture));
    expect(p.picks.map((x) => `${x.assetId}${x.frame ?? ''}`)).toEqual(['u2', 's18', 's19', 'v10', 'v400', 's20', 'u1']);
    expect(p.picks.find((x) => x.frame === 400)!.capture).toBe('2019-03-03T08:00:13');
    expect(p.picks.map((x) => x.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(planGrowing(doc, { picks, sort: 'given' }, ctx(capture)).picks.map((x) => `${x.assetId}${x.frame ?? ''}`)).toEqual(['u2', 's20', 'u1', 's18', 'v400', 'v10', 's19']);
    // the record keeps the show order, never a coordinate
    expect((p.record.picked as { assetId: string }[]).map((x) => x.assetId)).toEqual(['u2', 's18', 's19', 'v', 'v', 's20', 'u1']);
  });

  for (const rate of [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }]) {
    it(`cuts are start + i·hold in integer frames at ${rate.num}/${rate.den} fps; the default hold is round(fps); dissolves ⌊h/3⌋ / ⌊2h/3⌋`, () => {
      const fps = rate.num / rate.den;
      const doc = project(['a', 'b', 'c', 'd', 'e'].map((id) => still(id)), rate);
      const picks = ['a', 'b', 'c', 'd', 'e'].map((assetId) => ({ assetId, frame: null, eyes: level() }));
      const at = T.frameTime(7, rate);
      const p = planGrowing(doc, { picks, at, sort: 'given' }, ctx());
      const h = Math.round(fps);
      expect(p.predicted).toMatchObject({ startFrame: 7, endFrame: 7 + 5 * h, holdFrames: h, dissolveFrames: Math.floor(h / 3) });
      opsOf(p, 'add_clip').forEach((o, i) => { expect(o.args.start).toEqual(T.frameTime(7 + i * h, rate)); expect(o.args.duration).toEqual(T.frameTime(h, rate)); });
      const r = applied(doc, p);
      expect(validateProject(r.doc)).toEqual([]);
      const clips = r.doc.sequences[r.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'media').sort((x, y) => T.toSeconds(x.start) - T.toSeconds(y.start));
      clips.forEach((c, i) => expect(T.eq(c.start, T.frameTime(7 + i * h, rate))).toBe(true));
      // no rounding accumulates: the 120th cut is exactly frame start + 119·hold
      const many = project(Array.from({ length: 120 }, (_, i) => still(`m${i}`)), rate);
      const pm = planGrowing(many, { picks: Array.from({ length: 120 }, (_, i) => ({ assetId: `m${i}`, frame: null, eyes: level() })), sort: 'given', holdFrames: flashGapFrames(fps) }, ctx());
      expect(opsOf(pm, 'add_clip')[119]!.args.start).toEqual(T.frameTime(119 * flashGapFrames(fps), rate));
      const gap = flashGapFrames(fps);
      expect(planGrowing(doc, { picks, holdFrames: 30, dissolve: 'long' }, ctx()).predicted.dissolveFrames).toBe(20);
      expect(planGrowing(doc, { picks, holdFrames: 300, dissolve: 'long' }, ctx()).predicted.dissolveFrames).toBe(150);
      expect(planGrowing(doc, { picks, holdFrames: gap, dissolve: 'none' }, ctx()).ops.some((o) => o.op === 'set_transition')).toBe(false);
    });
  }

  it('a hold below flashGapFrames is refused hold_too_short with the minimum, never raised (G15)', () => {
    const doc = project([still('a'), still('b')]);
    const picks = [{ assetId: 'a', frame: null, eyes: level() }, { assetId: 'b', frame: null, eyes: level() }];
    const gap = flashGapFrames(30);
    expect(refusal(() => planGrowing(doc, { picks, holdFrames: gap - 1 }, ctx()))).toEqual({ code: 'out_of_bounds', message: GROWING_REFUSALS.holdTooShort.message(gap), details: { minFrames: gap, holdFrames: gap - 1, fps: 30 } });
    const ok = planGrowing(doc, { picks, holdFrames: gap }, ctx());
    expect(ok.predicted.holdFrames).toBe(gap);
    expect(ok.warnings.find((w) => w.code === 'flash_checked_after_export')!.details).toEqual({ minFrames: gap });
    // the first pick has no dissolve; the dissolve is never longer than the hold
    expect(opsOf(ok, 'set_transition').map((o) => o.args)).toEqual([{ clipId: { $ref: growingPickKey('b', null) }, type: 'dissolve', frames: Math.floor(gap / 3) }]);
  });
});

describe('growing planner (W1): captions never carry a field without words (G8)', () => {
  const capture: Record<string, string | null> = { before: '2019-01-01', after: '2020-01-01T09:00:00', undated: null };
  /** The people sheet, and the capture dates on the files themselves (what the caption's fields read; the server's ctx.capture is shownCapture of them). */
  const people = (doc: ProjectDocument, birthDate: string | null) => {
    doc.people = { per_1: { id: 'per_1', name: 'Noa', birthDate, form: 'f' } };
    for (const [id, at] of Object.entries(capture)) if (at) doc.assets[id]!.capture = { at, utcOffsetMinutes: null, source: 'manual' };
    return doc;
  };
  const picks = [{ assetId: 'before', frame: null, eyes: level() }, { assetId: 'after', frame: null, eyes: level() }, { assetId: 'undated', frame: null, eyes: level() }];
  it('undated → none; before birth → date only; after → date and age; every caption resolves with nothing missing, at its start and where the dissolve into it starts', () => {
    const doc = people(project([still('before'), still('after'), still('undated')]), '2019-06-01');
    const fromDoc = Object.fromEntries(['before', 'after', 'undated'].map((id) => [id, shownCapture(doc, id)?.wall ?? null]));
    expect(fromDoc).toEqual(capture);
    const p = planGrowing(doc, { picks, caption: { date: true, age: true }, personId: 'per_1' }, ctx(fromDoc));
    const byAsset = Object.fromEntries(p.picks.map((x) => [x.assetId, x]));
    expect(byAsset.before!.caption).toBe('{date}');
    expect(byAsset.after!.caption).toBe('{date} · {age:per_1}');
    expect(byAsset.undated!.caption).toBeNull();
    expect(byAsset.before!.reasons).toContain('before_birth');
    expect(byAsset.undated!.reasons).toContain('undated_no_caption');
    expect(p.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['before_birth', 'undated_no_caption']));
    const texts = opsOf(p, 'add_text');
    expect(texts.every((o) => o.args.fields === true)).toBe(true);
    expect(p.slots.filter((s) => s.kind === 'text').map((s) => s.key).sort()).toEqual([growingCaptionKey(byAsset.before!.key), growingCaptionKey(byAsset.after!.key)].sort());
    const r = applied(doc, p);
    expect(validateProject(r.doc)).toEqual([]);
    const seqId = r.doc.mainSequenceId;
    const titles = r.doc.sequences[seqId]!.tracks.flatMap((t) => t.clips).filter((c): c is TextClip => c.type === 'text');
    expect(titles).toHaveLength(2);
    for (const t of titles) for (const at of [t.start, T.add(t.start, T.frameTime(1, R30))]) {
      const res = resolveFields(r.doc, seqId, t, at);
      expect(res.missing).toEqual([]);
      expect(res.text.length).toBeGreaterThan(0);
    }
  });
  it('no birth date → the age is left out (no_birth_date); age alone before birth → no caption at all; an age caption needs a person', () => {
    const doc = people(project([still('before'), still('after'), still('undated')]), null);
    const p = planGrowing(doc, { picks, caption: { date: true, age: true }, personId: 'per_1' }, ctx(capture));
    expect(p.picks.map((x) => x.caption)).toEqual(['{date}', '{date}', null]);
    expect(p.warnings.map((w) => w.code)).toContain('no_birth_date');
    const born = people(project([still('before'), still('after'), still('undated')]), '2019-06-01');
    const q = planGrowing(born, { picks, caption: { date: false, age: true }, personId: 'per_1' }, ctx(capture));
    expect(q.picks.map((x) => x.caption)).toEqual([null, '{age:per_1}', null]);
    expect(refusal(() => planGrowing(born, { picks, caption: { date: false, age: true } }, ctx(capture)))!.code).toBe('invalid_args');
    expect(planGrowing(born, { picks, caption: null }, ctx(capture)).ops.some((o) => o.op === 'add_text')).toBe(false);
  });
});

describe('growing planner (W1): applied through apply_template (G5, G6, G9–G11, G17)', () => {
  const PLANTED = 0.123457;
  const planted = (k: number): Eyes => [{ u: PLANTED, v: 0.4 + k / 1000 }, { u: 0.3, v: PLANTED + 0.3 }];
  const numbers = (v: unknown): number[] => (typeof v === 'number' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(numbers) : []);

  it('a video pick is an add_clip freeze at sourceTimeOfFrame(frame) (start offset counted); the dissolve after it is accepted and the document validates', () => {
    const v = video('v', 300, { startTime: T.frameTime(3, R30) });
    const doc = project([v, still('p')]);
    const p = planGrowing(doc, { picks: [{ assetId: 'v', frame: 120, eyes: level() }, { assetId: 'p', frame: null, eyes: level() }, { assetId: 'v', frame: 200, eyes: level() }], sort: 'given' }, ctx());
    const adds = opsOf(p, 'add_clip');
    expect(adds[0]!.args).toEqual({ assetId: 'v', trackId: 'trk_video', start: T.frameTime(0, R30), duration: T.frameTime(30, R30), sourceIn: sourceTimeOfFrame(v, 120), freeze: true });
    expect(opsOf(p, 'add_track')).toEqual([]); // the new project's empty picture track is used
    expect(adds[1]!.args.withLinkedAudio).toBe(false);
    expect(adds[1]!.args.freeze).toBeUndefined();
    expect(T.eq(sourceTimeOfFrame(v, 120), T.frameTime(123, R30))).toBe(true);
    expect(opsOf(p, 'set_clip_transform').every((o) => Object.keys(o.args.transform as object).sort().join() === 'rotation,scale,x,y')).toBe(true);
    const r = applied(doc, p);
    expect(validateProject(r.doc)).toEqual([]);
    const out = r.results[0]!.output as { slots: { key: string; clipId: string }[] };
    const clipOf = (key: string) => findClip(r.doc, out.slots.find((s) => s.key === key)!.clipId)!.clip as MediaClip;
    expect(clipOf(growingPickKey('v', 120))).toMatchObject({ freeze: true, linkGroupId: null });
    expect(clipOf(growingPickKey('p', null)).transition).toEqual({ type: 'dissolve', frames: 10 }); // into the still, after a freeze
    expect(clipOf(growingPickKey('v', 200)).transition).toEqual({ type: 'dissolve', frames: 10 }); // after a still
    expect(clipOf(growingPickKey('p', null)).transform).toEqual({ ...p.picks[1]!.transform, opacity: 1 });
  });

  it('120 picks: steps, ops and slots under the apply_template caps; one transaction; the record is growingRunRecordParams of the plan', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `a${i}`);
    const doc = project(ids.map((id) => still(id)));
    const capture = Object.fromEntries(ids.map((id, i) => [id, `20${String(10 + (i % 10)).padStart(2, '0')}-0${1 + (i % 9)}-1${i % 10}`]));
    doc.people = { per_1: { id: 'per_1', name: 'Noa', birthDate: '2009-01-01' } };
    const p = planGrowing(doc, { picks: ids.map((assetId, i) => ({ assetId, frame: null, eyes: planted(i % 50) })), caption: { date: true, age: true }, personId: 'per_1' }, ctx(capture));
    expect(p.ops.length).toBeLessThanOrEqual(GROWING.maxOps);
    expect(p.slots.length).toBeLessThanOrEqual(GROWING.maxSlots);
    expect(p.steps.length).toBeLessThanOrEqual(GROWING.maxSteps);
    expect(p.slots.length).toBe(240);
    const r = applied(doc, p);
    expect(validateProject(r.doc)).toEqual([]);
    const run = Object.values(r.doc.recipeRuns)[0]!;
    expect(run.recipeId).toBe(`template:${GROWING_TEMPLATE_ID}`);
    expect(run.params).toEqual({ ...p.record, templateVersion: GROWING_VERSION });
    expect(Object.keys(p.record).every((k) => (GROWING_RECORD_KEYS as readonly string[]).includes(k))).toBe(true);
    // the planted eye value reaches neither the record nor the document nor the steps (G9–G11 shrunk, C8)
    expect(numbers(run.params)).not.toContain(PLANTED);
    for (const s of [JSON.stringify(r.doc), JSON.stringify(p.record), JSON.stringify(p.steps), JSON.stringify(p.basis), JSON.stringify(p.warnings), JSON.stringify(r.results.map((x) => x.summary))]) {
      expect(s).not.toContain(String(PLANTED));
      expect(s).not.toMatch(/"eyes"/);
    }
  });

  it('G17: the same request plans the same digest twice; the document is never mutated; nothing reads a clock or a random source', () => {
    const doc = deepFreeze(project([still('a'), still('b'), video('v')]));
    const req = { picks: [{ assetId: 'a', frame: null, eyes: planted(1) }, { assetId: 'v', frame: 5, eyes: planted(2) }, { assetId: 'b', frame: null, eyes: planted(3) }], caption: { date: true, age: false } };
    const c = ctx({ a: '2020-01-01', b: null, v: '2019-01-01T10:00:00' });
    expect(JSON.stringify(planGrowing(doc, req, c))).toBe(JSON.stringify(planGrowing(doc, structuredClone(req), structuredClone(c))));
  });
});

describe('growing planner (W1): exclusions, warnings and the rebuild context', () => {
  it('a pick outside the transform bounds is excluded, not refused; enlarged, PNG orientation, linked formats are said with their numbers', () => {
    const doc = project([still('big', 6000, 4000), still('small', 200, 150), still('png', 1200, 1600, 'image/png'), still('ok')]);
    doc.variants = { var_1: { id: 'var_1', name: 'tall', width: 1080, height: 1920, fit: 'cover' } } as never;
    const p = planGrowing(doc, { picks: [
      { assetId: 'big', frame: null, eyes: [{ u: 0.5, v: 0.5 }, { u: 0.5007, v: 0.5 }] }, // 4.2 shown px apart: scale > 20
      { assetId: 'small', frame: null, eyes: level(0.5, 0.4, 0.1) }, // 20 shown px → enlarged
      { assetId: 'png', frame: null, eyes: level() }, { assetId: 'ok', frame: null, eyes: level() },
    ], sort: 'given', faceSize: 0.3 }, ctx());
    expect(p.excluded).toEqual([expect.objectContaining({ assetId: 'big', code: 'outside_transform_range' })]);
    expect(p.picks.map((x) => x.assetId)).toEqual(['small', 'png', 'ok']);
    expect(p.picks.map((x) => x.startFrame)).toEqual([0, 30, 60]); // no gap where the excluded pick was
    const enlarged = p.warnings.find((w) => w.code === 'enlarged')!;
    expect(enlarged.message).toMatch(/×\d+\.\d/);
    expect((enlarged.details.picks as { key: string; magnification: number }[]).map((x) => x.key)).toEqual(expect.arrayContaining([growingPickKey('small', null)]));
    expect(p.picks[0]!.magnification).toBeGreaterThan(2);
    expect(p.picks.find((x) => x.assetId === 'png')!.reasons).toContain('orientation_unverified');
    expect(p.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['orientation_unverified', 'other_formats_not_aligned', 'flash_checked_after_export']));
    const { variants: _v, ...plain } = doc;
    expect(validateProject(applied({ ...plain, variants: {} } as ProjectDocument, p).doc)).toEqual([]);
  });

  it('rebuild: kept picks keep their places, removed picks are recorded, a pick without eyes is excluded needs_marks; tracks are reused', () => {
    const doc = project(['a', 'b', 'c', 'd'].map((id) => still(id)));
    const first = planGrowing(doc, { picks: ['a', 'b', 'c', 'd'].map((assetId) => ({ assetId, frame: null, eyes: level() })), sort: 'given', caption: { date: true, age: false } }, ctx({ a: '2020-01-01', b: '2020-01-02', c: '2020-01-03', d: '2020-01-04' }));
    const r = applied(doc, first);
    const runSlots = (r.results[0]!.output as { slots: { key: string; clipId: string }[] }).slots;
    const clipId = (key: string) => runSlots.find((s) => s.key === key)!.clipId;
    const ka = growingPickKey('a', null), kb = growingPickKey('b', null), kc = growingPickKey('c', null), kd = growingPickKey('d', null);
    const track = findClip(r.doc, clipId(ka))!.track.id, capTrack = findClip(r.doc, clipId(growingCaptionKey(ka)))!.track.id;
    // what the server would do: keep b (edited by hand), forget c (deleted), remove the untouched a and d with their captions
    const rest = applyTransaction(r.doc, [ka, kd, kc, growingCaptionKey(ka), growingCaptionKey(kd), growingCaptionKey(kc)].map((k) => ({ op: 'delete_clip', args: { clipId: clipId(k) } })), { idSeed: 'del_', actor: 'test' }).doc;
    const p = planGrowing(rest, { picks: [{ assetId: 'a', frame: null, eyes: level() }, { assetId: 'b', frame: null }, { assetId: 'c', frame: null }, { assetId: 'd', frame: null }], sort: 'given', caption: { date: true, age: false }, at: T.ZERO },
      { capture: { a: '2020-01-01', b: '2020-01-02', c: '2020-01-03', d: '2020-01-04' }, keptKeys: [kb, growingCaptionKey(kb)], removedKeys: [kc], movedKeys: [], reuseTracks: { pictures: track, captions: capTrack } });
    expect(p.excluded.map((x) => [x.assetId, x.code])).toEqual([['b', 'kept_by_hand'], ['d', 'needs_marks'], ['c', 'removed_by_hand']]);
    expect(p.picks.map((x) => [x.assetId, x.startFrame])).toEqual([['a', 0]]);
    expect(p.record.removedPicks).toEqual([{ key: kc, assetId: 'c', frame: null }]);
    // every listed pick in show order, those not made again too (so the next rebuild keeps the same places); trailing empty slots are dropped
    expect((p.record.picked as { key: string }[]).map((x) => x.key)).toEqual([ka, kb, kc, kd]);
    expect(p.predicted.endFrame).toBe(60);
    expect(opsOf(p, 'add_track')).toEqual([]);
    expect(p.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['kept_by_hand', 'removed_by_hand']));
    // a first plan (no rebuild context) refuses a pick without eyes
    expect(refusal(() => planGrowing(doc, { picks: [{ assetId: 'a', frame: null }, { assetId: 'b', frame: null, eyes: level() }] }, ctx()))!.message).toBe(GROWING_REFUSALS.needsMarks.message());
  });

  it('rebuild (integration): a pick deleted by hand leaves its slot empty, so a clip kept by hand after it stays on its slot and nothing lands on it', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const doc = project(ids.map((id) => still(id)));
    const first = planGrowing(doc, { picks: ids.map((assetId) => ({ assetId, frame: null, eyes: level() })), sort: 'given' }, ctx());
    const r = applied(doc, first);
    const runSlots = (r.results[0]!.output as { slots: { key: string; clipId: string }[] }).slots;
    const clipId = (id: string) => runSlots.find((s) => s.key === growingPickKey(id, null))!.clipId;
    const track = findClip(r.doc, clipId('a'))!.track.id;
    // b deleted by hand, d kept by hand (rotated), a, c and e untouched: the server removes those three and plans again
    const rest = applyTransaction(r.doc, [
      { op: 'delete_clip', args: { clipId: clipId('b') } },
      { op: 'set_clip_transform', args: { clipId: clipId('d'), transform: { rotation: 7 } } },
      ...['a', 'c', 'e'].map((id) => ({ op: 'delete_clip', args: { clipId: clipId(id) } })),
    ], { idSeed: 'hand_', actor: 'test' }).doc;
    const p = planGrowing(rest, { picks: ids.map((assetId) => (assetId === 'b' || assetId === 'd' ? { assetId, frame: null } : { assetId, frame: null, eyes: level() })), sort: 'given', at: T.ZERO },
      { capture: {}, keptKeys: [growingPickKey('d', null)], removedKeys: [growingPickKey('b', null)], reuseTracks: { pictures: track } });
    expect(p.picks.map((x) => [x.assetId, x.startFrame, x.dissolveFrames])).toEqual([['a', 0, 0], ['c', 60, 0], ['e', 120, p.predicted.dissolveFrames]]);
    expect(opsOf(p, 'add_track')).toEqual([]); // the pictures track is free over every new range
    expect((p.record.picked as { key: string }[]).map((x) => x.key)).toEqual(ids.map((id) => growingPickKey(id, null)));
    const out = applyTransaction(rest, [{ op: 'apply_template', args: { templateId: GROWING_TEMPLATE_ID, templateVersion: GROWING_VERSION, params: p.record, steps: p.steps, ops: p.ops, slots: p.slots, keepIds: [clipId('d')], recordRanges: true } }], { idSeed: 'rb_', actor: 'test', allowInternal: true }).doc;
    expect(validateProject(out)).toEqual([]);
    const starts = out.sequences[out.mainSequenceId]!.tracks.find((t) => t.id === track)!.clips.map((c) => T.frameIndexAt(c.start, R30)).sort((x, y) => x - y);
    expect(starts).toEqual([0, 60, 90, 120]);
  });

  it('a clip moved in time keeps its transform, and the inverse gives its eyes back (the rebuild of an untouched or moved-only pick)', () => {
    const doc = project([still('a', 3000, 4000), still('b')]);
    const eyes: Eyes = [{ u: 0.41, v: 0.37 }, { u: 0.55, v: 0.39 }];
    const p = planGrowing(doc, { picks: [{ assetId: 'a', frame: null, eyes }, { assetId: 'b', frame: null, eyes: level() }], sort: 'given' }, ctx());
    const r = applied(doc, p);
    const id = (r.results[0]!.output as { slots: { key: string; clipId: string }[] }).slots.find((s) => s.key === growingPickKey('a', null))!.clipId;
    const moved = applyTransaction(r.doc, [{ op: 'move_clip', args: { clipId: id, start: T.frameTime(300, R30) } }], { idSeed: 'mv_', actor: 'test' }).doc;
    const c = findClip(moved, id)!.clip as MediaClip;
    expect(T.eq(c.start, T.frameTime(300, R30))).toBe(true);
    const { opacity: _o, ...tr } = c.transform;
    const back = eyesFromTransform(tr, { width: 3000, height: 4000 }, { width: 1920, height: 1080, fit: 'contain' }, { faceSize: GROWING.faceSize.default, eyeLine: GROWING.eyeLine.default });
    for (let i = 0; i < 2; i++) { expect(Math.abs(back[i]!.u - eyes[i]!.u)).toBeLessThan(2e-5); expect(Math.abs(back[i]!.v - eyes[i]!.v)).toBeLessThan(2e-5); }
  });
});
