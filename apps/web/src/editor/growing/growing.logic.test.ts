/**
 * growing.logic (wave 8 growing, W3): pixel <-> (u, v) on the SHOWN picture, the marks, the request built from them, the preview built on a
 * copy, the run view, and the privacy rule of the folder (no storage, no network other than the api calls). The planner and the order
 * rule are LABELLED STAND-INS here (W1's bodies are not in this worktree); the contract is core growingContract.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, GROWING_RUN_RECIPE_ID, growingPickKey, type Asset, type EyePoint, type GrowingPlan, type PlanGrowing, type ProjectDocument } from '@pulseframe/core';
import { sourceDocument } from '../sourceDocument.ts';
import {
  buildParams, buildPreview, clearMark, closeLosesMarks, createBlocker, currentGrowingRun, emptyMark, eyesFarEnough, holdFrames, listCandidates, markedCount, markWords, moveCrosshair,
  moveUndated, pickId, pixelToUv, placePoint, removeLastMark, restoreParams, secondsText, shownSizeOf, stepFrame, swapEyes, uvFromClient, uvToPixel, withFrame, whyRows,
} from './growing.logic.ts';

const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const still = (id: string, w: number, h: number): Asset => ({ id, kind: 'image', name: `${id}.jpg`, contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'jpeg', mimeType: 'image/jpeg', duration: T.ZERO, image: { width: w, height: h, codec: 'mjpeg', hasAlpha: false }, provenance: prov });
const base = (): ProjectDocument => {
  const d = createProject({ id: 'prj_g', name: 'g', frameRate: { num: 30, den: 1 } });
  for (const a of [still('a1', 3024, 4032), still('a2', 640, 480), still('a3', 640, 480)]) d.assets[a.id] = a;
  return d;
};
const P = (u: number, v: number): EyePoint => ({ u, v });
/** STAND-IN (labelled): the swap rule of C10 for tests only, not W1's suggestEyeOrder. */
const standInOrder = (a: EyePoint, b: EyePoint, shown: { width: number; height: number }): [EyePoint, EyePoint] => {
  const deg = Math.atan2(-(b.v - a.v) * shown.height, (b.u - a.u) * shown.width) * 180 / Math.PI;
  return Math.abs(deg) > 90 ? [b, a] : [a, b];
};
const shown = { width: 640, height: 480 };

describe('pixels and (u, v) of the shown picture', () => {
  it('a 3024x4032 EXIF-6 still: the document frame is the shown shape and canvas px / canvas size is (u, v)', () => {
    const d = base();
    const src = sourceDocument(d, d.assets.a1!);
    expect([src.settings.width, src.settings.height]).toEqual([3024, 4032]);
    const uv = pixelToUv(1512, 2016, src.settings.width, src.settings.height);
    expect(uv).toEqual({ u: 0.5, v: 0.5 });
    expect(uvToPixel(uv, 3024, 4032)).toEqual({ px: 1512, py: 2016 });
    expect(shownSizeOf(d.assets.a1!)).toEqual({ width: 3024, height: 4032 });
    expect(pixelToUv(-5, 99999, 100, 100)).toEqual({ u: 0, v: 1 });
  });
  it('a client position over the drawn canvas is divided by its rectangle', () => {
    expect(uvFromClient(150, 80, { left: 100, top: 40, width: 200, height: 100 })).toEqual({ u: 0.25, v: 0.4 });
    expect(uvFromClient(1, 1, { left: 0, top: 0, width: 0, height: 5 })).toBeNull();
  });
  it('arrows move one picture pixel, Shift ten, clamped; other keys do nothing', () => {
    expect(moveCrosshair(P(0.5, 0.5), 'ArrowRight', false, shown)).toEqual({ u: 0.5 + 1 / 640, v: 0.5 });
    expect(moveCrosshair(P(0.5, 0.5), 'ArrowUp', true, shown)!.v).toBeCloseTo(0.5 - 10 / 480, 12);
    expect(moveCrosshair(P(0, 0), 'ArrowLeft', true, shown)).toEqual({ u: 0, v: 0 });
    expect(moveCrosshair(P(0.5, 0.5), 'Enter', false, shown)).toBeNull();
  });
});

describe('the marks of a picture', () => {
  it('click order is kept unless the order rule swaps; S swaps; Backspace removes the last; clear empties', () => {
    let m = emptyMark(null);
    m = placePoint(m, P(0.3, 0.5), shown, null).mark;
    expect(markWords(m)).toBe('one');
    const r = placePoint(m, P(0.7, 0.5), shown, null);
    expect(r.mark.eyes).toEqual([P(0.3, 0.5), P(0.7, 0.5)]);
    expect(markWords(r.mark)).toBe('done');
    expect(swapEyes(r.mark).eyes).toEqual([P(0.7, 0.5), P(0.3, 0.5)]);
    expect(swapEyes(swapEyes(r.mark)).eyes).toEqual(r.mark.eyes);
    expect(removeLastMark(r.mark)).toMatchObject({ clicks: [P(0.3, 0.5)], eyes: null });
    expect(clearMark(r.mark)).toEqual(emptyMark(null));
    // the proposed order of the (stand-in) rule: a line turned more than 90 degrees is flipped; the click order is data
    expect(placePoint(m, P(0.7, 0.5), shown, standInOrder).mark.eyes![0]).toEqual(P(0.3, 0.5));
    expect(placePoint(placePoint(emptyMark(null), P(0.7, 0.5), shown, null).mark, P(0.3, 0.5), shown, standInOrder).mark.eyes![0]).toEqual(P(0.3, 0.5));
  });
  it('two points under 4 shown pixels apart are refused; a throwing order rule keeps the click order; a third placement starts over', () => {
    const one = placePoint(emptyMark(null), P(0.5, 0.5), shown, null).mark;
    expect(eyesFarEnough(P(0.5, 0.5), P(0.5 + 3 / 640, 0.5), shown)).toBe(false);
    expect(placePoint(one, P(0.5 + 3 / 640, 0.5), shown, null)).toEqual({ mark: one, refused: 'too_close' });
    const two = placePoint(one, P(0.8, 0.5), shown, () => { throw new Error('not built'); }).mark;
    expect(two.eyes).toEqual([P(0.5, 0.5), P(0.8, 0.5)]);
    expect(placePoint(two, P(0.1, 0.1), shown, null).mark).toMatchObject({ clicks: [P(0.1, 0.1)], eyes: null });
  });
  it('a video frame: the chosen frame steps by one, Shift by a second; changing it drops the points', () => {
    expect(stepFrame(10, 'ArrowRight', false, 29.97, 100)).toBe(11);
    expect(stepFrame(10, 'ArrowLeft', true, 29.97, 100)).toBe(0);
    expect(stepFrame(95, 'ArrowRight', true, 30, 100)).toBe(100);
    expect(stepFrame(5, 'a', false, 30, 100)).toBeNull();
    const m = placePoint(emptyMark(3), P(0.2, 0.2), shown, null).mark;
    expect(withFrame(m, 3)).toBe(m);
    expect(withFrame(m, 4)).toEqual(emptyMark(4));
  });
  it('counts and the ask before closing (C8)', () => {
    const done = placePoint(placePoint(emptyMark(null), P(0.2, 0.5), shown, null).mark, P(0.6, 0.5), shown, null).mark;
    const marks = { [pickId('a2', null)]: done, [pickId('a3', null)]: emptyMark(null) };
    expect(markedCount(['a2', 'a3'].map((i) => pickId(i, null)), marks)).toEqual({ marked: 1, of: 2 });
    expect(closeLosesMarks(marks, false)).toBe(true);
    expect(closeLosesMarks(marks, true)).toBe(false);
    expect(closeLosesMarks({}, false)).toBe(false);
  });
});

describe('the request built from the marks', () => {
  const done = (u1: number): ReturnType<typeof emptyMark> => placePoint(placePoint(emptyMark(null), P(u1, 0.5), shown, null).mark, P(u1 + 0.3, 0.5), shown, null).mark;
  it('only marked pictures go in, in the shown order, with the eyes as settled and nothing else of the dialog', () => {
    const d = base();
    const refs = [{ assetId: 'a2', frame: null }, { assetId: 'a3', frame: null }, { assetId: 'a1', frame: null }];
    const marks = { [pickId('a2', null)]: done(0.2), [pickId('a3', null)]: done(0.3) };
    const p = buildParams(d, refs, marks, { holdSeconds: 1, dissolve: 'short', faceSize: 0.14, caption: { date: true, age: true } })!;
    expect(p.picks.map((x) => x.assetId)).toEqual(['a2', 'a3']);
    expect(p.picks[0]!.eyes).toEqual([P(0.2, 0.5), P(0.5, 0.5)]);
    expect(p.holdFrames).toBe(30);
    expect(p.caption).toEqual({ date: true, age: false }); // no person with a birth date: the age has no words
    expect(p.personId).toBeUndefined();
    expect(buildParams(d, refs, { [pickId('a2', null)]: done(0.2) }, { holdSeconds: 1, dissolve: 'none', faceSize: 0.14, caption: { date: false, age: false } })).toBeNull();
    expect(createBlocker(refs, marks)).toBe('unmarked');
    expect(createBlocker(refs.slice(0, 2), marks)).toBeNull();
    expect(createBlocker(refs.slice(0, 1), marks)).toBe('few');
  });
  it('age caption carries the person with a birth date; hold seconds <-> frames', () => {
    const d = base();
    d.people = { p1: { id: 'p1', name: 'נועה', birthDate: '2019-05-04' } };
    const refs = [{ assetId: 'a2', frame: null }, { assetId: 'a3', frame: null }];
    const marks = { [pickId('a2', null)]: done(0.2), [pickId('a3', null)]: done(0.3) };
    const p = buildParams(d, refs, marks, { holdSeconds: 0.5, dissolve: 'long', faceSize: 0.2, caption: { date: false, age: true } })!;
    expect(p).toMatchObject({ caption: { date: false, age: true }, personId: 'p1', holdFrames: 15, dissolve: 'long', faceSize: 0.2 });
    expect(holdFrames(0.01, 30)).toBe(1);
    expect(secondsText(45, 30)).toBe('1.50');
  });
});

describe('the library list', () => {
  it('capture order first, undated after; Alt+arrow moves only an undated item', () => {
    const d = base();
    d.assets.a2!.capture = { at: '2020-01-01T10:00:00', utcOffsetMinutes: 120, source: 'container' };
    d.assets.a1!.capture = { at: '2019-01-01T10:00:00', utcOffsetMinutes: 120, source: 'container' };
    const c = listCandidates(d);
    expect(c.map((x) => [x.assetId, x.wall === null])).toEqual([['a1', false], ['a2', false], ['a3', true]]);
    const byId = Object.fromEntries(c.map((x) => [x.assetId, x]));
    expect(moveUndated(['a1', 'a2', 'a3'], byId, 'a3', -1)).toEqual(['a1', 'a3', 'a2']);
    expect(moveUndated(['a1', 'a2', 'a3'], byId, 'a1', 1)).toEqual(['a1', 'a2', 'a3']);
    expect(moveUndated(['a1', 'a2', 'a3'], byId, 'a3', 1)).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('the live preview is planned on a copy and never saved (C13; STAND-IN planner)', () => {
  it('apply_template runs on a copy: the original is untouched; a refusal comes back as its message', () => {
    const d = base();
    const before = JSON.stringify(d);
    let seenCtx: unknown = null;
    // STAND-IN planner, not W1's: plans nothing but a track, to prove the plumbing (copy, internal op, fixed seed)
    const plan = (doc: ProjectDocument, _p: unknown, ctx: unknown): GrowingPlan => {
      seenCtx = ctx;
      return { record: { sort: 'capture' }, steps: ['stand-in'], ops: [{ op: 'add_track', args: { kind: 'video' } }], slots: [], warnings: [], picks: [], excluded: [], suggestedFaceSize: null } as unknown as GrowingPlan;
    };
    const refs = [{ assetId: 'a2', frame: null }, { assetId: 'a3', frame: null }];
    const m = (u: number) => placePoint(placePoint(emptyMark(null), P(u, 0.5), shown, null).mark, P(u + 0.3, 0.5), shown, null).mark;
    const params = buildParams(d, refs, { [pickId('a2', null)]: m(0.1), [pickId('a3', null)]: m(0.2) }, { holdSeconds: 1, dissolve: 'short', faceSize: 0.14, caption: { date: false, age: false } })!;
    const r = buildPreview(d, params, { plan: plan as PlanGrowing });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(d)).toBe(before);
    expect(seenCtx).toEqual({ capture: { a2: null, a3: null } });
    const refusal = buildPreview(d, params, { plan: () => { throw new Error('each picture must stay at least 11 frames, so that the film does not flash'); } });
    expect(refusal).toEqual({ ok: false, message: 'each picture must stay at least 11 frames, so that the film does not flash' });
    expect(applyTransaction).toBeTypeOf('function');
  });
});

describe('the run in the document', () => {
  it('lists deleted picks (clip gone) and builds the restore request with eyes only for the marked-again ones', () => {
    const d = base();
    const k2 = growingPickKey('a2', null), k3 = growingPickKey('a3', null);
    d.recipeRuns = { r1: { id: 'r1', recipeId: GROWING_RUN_RECIPE_ID, params: { picked: [{ key: k2, assetId: 'a2', frame: null }, { key: k3, assetId: 'a3', frame: null }] }, createdIds: [], fingerprints: {}, steps: [], slots: [{ key: k2, kind: 'media', clipId: 'clip_missing' }] as never } };
    const v = currentGrowingRun(d)!;
    expect(v.deleted.map((x) => x.assetId)).toEqual(['a2']);
    const eyes = placePoint(placePoint(emptyMark(null), P(0.2, 0.5), shown, null).mark, P(0.6, 0.5), shown, null).mark;
    const req = restoreParams(v, { [pickId('a2', null)]: eyes })!;
    // the deleted pick is marked again at its place in the record's list (integration: sort 'given' keeps it where it was)
    expect(req.picks).toEqual([{ assetId: 'a2', frame: null, eyes: [P(0.2, 0.5), P(0.6, 0.5)] }, { assetId: 'a3', frame: null }]);
    // a pick the record names only as removed comes after the list
    const d2 = base();
    d2.recipeRuns = { r1: { ...d.recipeRuns.r1!, params: { picked: [{ key: k3, assetId: 'a3', frame: null }, { key: growingPickKey('a1', null), assetId: 'a1', frame: null }], removedPicks: [{ key: k2, assetId: 'a2', frame: null }] }, slots: [] } };
    expect(restoreParams(currentGrowingRun(d2)!, { [pickId('a2', null)]: eyes })!.picks.map((x) => [x.assetId, !!x.eyes])).toEqual([['a3', false], ['a1', false], ['a2', true]]);
    expect(whyRows([{ assetId: 'a2', frame: null, capture: null, magnification: 1.23456, uncoveredShare: 0.0123 } as never])).toEqual([{ assetId: 'a2', frame: null, date: null, magnification: 1.23, uncoveredPercent: 1.2 }]);
  });
});

describe('the marks stay in memory (C8)', () => {
  afterEach(() => vi.restoreAllMocks());
  it('the pure logic writes to no browser storage', () => {
    const S = (globalThis as { Storage?: { prototype: object } }).Storage ?? ((globalThis as Record<string, unknown>).Storage = class { setItem() {} }); // node has no Storage: a stand-in class, so the spy has something to watch
    const spy = vi.spyOn((S as { prototype: { setItem: () => void } }).prototype, 'setItem');
    const m = placePoint(placePoint(emptyMark(null), P(0.2, 0.5), shown, null).mark, P(0.6, 0.5), shown, null).mark;
    buildParams(base(), [{ assetId: 'a2', frame: null }], { [pickId('a2', null)]: m }, { holdSeconds: 1, dissolve: 'short', faceSize: 0.14, caption: { date: false, age: false } });
    expect(spy).not.toHaveBeenCalled();
  });
  it('no file of the folder touches storage, a URL, a log or the network other than the two api calls', () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const files = fs.readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'BroadcastChannel', 'history.', 'location.', 'console.', 'setItem', 'document.cookie', 'postMessage']) {
        expect(code.includes(bad), `${f} uses ${bad}`).toBe(false);
      }
      for (const m of code.matchAll(/(?<![\w/.'\"])api\.(\w+)/g)) expect(['applyGrowing', 'regenerateGrowing', 'planGrowing'], `${f} api.${m[1]}`).toContain(m[1]);
      expect(/editor\.(set|commit)\w*\(.*(marks|eyes)/i.test(code), f).toBe(false);
    }
  });
});
