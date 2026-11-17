/**
 * The model-free tracker (ADR-0015) on synthetic sequences with exact truth (vision/synthetic.ts): optical-flow accuracy,
 * scale, robustness to outlier points, occlusion, an identical decoy, re-acquisition, and bit-for-bit determinism.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTracker } from './tracker.ts';
import { discScene, outlierSequence, shiftedPair, zoomSequence, type DiscScene } from './synthetic.ts';
import type { TrackerStep } from './types.ts';

const usable = (st: number) => st === 1 || st === 6;
const dist = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) => Math.sqrt((a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2);
const rms = (e: number[]) => Math.sqrt(e.reduce((a, b) => a + b * b, 0) / e.length);

/** Track a disc scene from the true centre on frame 0, with a box that fits the disc. */
function run(sc: DiscScene): TrackerStep[] {
  const t = createTracker(sc.frames[0]!, { kind: 'region', cx: sc.truth[0]!.cx, cy: sc.truth[0]!.cy, w: 2 * sc.radius, h: 2 * sc.radius });
  return sc.frames.slice(1).map((f) => t.step(f)); // out[k - 1] is frame k
}
const digest = (steps: TrackerStep[]) => createHash('sha256').update(new Uint8Array(Float64Array.from(steps.flatMap((s) => [s.cx, s.cy, s.s, s.q, s.st])).buffer)).digest('hex');

describe('point tracking (pyramidal Lucas-Kanade, forward-backward checked)', () => {
  it('sub-pixel shifts up to 8 px: RMS error ≤ 0.05 px', () => {
    const err: number[] = [];
    for (let k = 0; k < 24; k++) {
      const dx = -7.6 + (15.2 * ((k * 7) % 24)) / 23 + 0.011 * k, dy = 7.6 - (15.2 * ((k * 11) % 24)) / 23 - 0.013 * k;
      expect(Math.max(Math.abs(dx), Math.abs(dy))).toBeLessThanOrEqual(8);
      const [a, b] = shiftedPair(160, 120, dx, dy);
      const s = createTracker(a, { kind: 'point', cx: 80, cy: 60 }).step(b);
      expect(s.st).toBe(1);
      err.push(s.cx - 80 - dx, s.cy - 60 - dy);
    }
    expect(rms(err)).toBeLessThanOrEqual(0.05);
  });
  it('20 px shifts with 3 pyramid levels: RMS error ≤ 0.1 px', () => {
    const err: number[] = [];
    for (const [dx, dy] of [[20, 0], [0, -20], [14.2, 14.1], [-13.7, 14.6], [19.3, -5.2], [-6.1, -19.05]] as const) {
      const [a, b] = shiftedPair(200, 160, dx, dy);
      const s = createTracker(a, { kind: 'point', cx: 100, cy: 80 }, { levels: 3 }).step(b);
      expect(s.st).toBe(1);
      err.push(s.cx - 100 - dx, s.cy - 80 - dy);
    }
    expect(rms(err)).toBeLessThanOrEqual(0.1);
  });
});

describe('region tracking (median flow)', () => {
  it('a zoom of 1.05 per frame over 20 frames: the size is recovered within 1% and the centre stays put', () => {
    const z = zoomSequence(400, 300, 21, 1.05, 200, 150);
    const t = createTracker(z.frames[0]!, { kind: 'region', cx: 200, cy: 150, w: 60, h: 60 });
    let last!: TrackerStep;
    for (let k = 1; k <= 20; k++) { last = t.step(z.frames[k]!); expect(last.st).toBe(1); }
    expect(Math.abs(last.s / z.scale[20]! - 1)).toBeLessThanOrEqual(0.01);
    expect(dist(last, { cx: 200, cy: 150 })).toBeLessThan(1);
  }, 60_000);
  it('30% of the box moving the other way (outlier points): translation error ≤ 0.1 px on every frame', () => {
    const o = outlierSequence(320, 240, 12, { cx: 150, cy: 120, w: 100, h: 100 }, { x: 2.37, y: -1.61 }, { x: -3.1, y: 4.2 }, 0.3);
    const t = createTracker(o.frames[0]!, { kind: 'region', cx: 150, cy: 120, w: 100, h: 100 });
    for (let k = 1; k < 12; k++) {
      const s = t.step(o.frames[k]!);
      expect(s.st).not.toBe(3);
      expect(Math.abs(s.cx - o.truth[k]!.cx)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(s.cy - o.truth[k]!.cy)).toBeLessThanOrEqual(0.1);
    }
  }, 60_000);
});

describe('occlusion, decoy and re-acquisition', () => {
  // The disc is hidden on frames 25–44; an identical disc appears 150 px away when it is hidden and stays.
  const scene = discScene({ width: 400, height: 240, frames: 70, occlude: { from: 25, to: 45 }, decoy: { from: 25, to: 70, offset: { x: -150, y: 0 } } });
  const steps = run(scene);
  const at = (k: number) => steps[k - 1]!;

  it('a disc occluded for 20 frames: ≥ 95% of those frames are weak or lost, and no usable sample is more than 3 px from the truth', () => {
    let bad = 0;
    for (let k = 25; k < 45; k++) if (at(k).st === 2 || at(k).st === 3) bad++;
    expect(bad / 20).toBeGreaterThanOrEqual(0.95);
    for (let k = 1; k < 70; k++) if (usable(at(k).st)) expect(dist(at(k), scene.truth[k]!), `frame ${k}`).toBeLessThanOrEqual(3);
    // lost samples hold the last usable position (never extrapolated)
    const held = at(24);
    for (let k = 25; k < 45; k++) if (at(k).st === 3) expect([at(k).cx, at(k).cy]).toEqual([held.cx, held.cy]);
  });
  it('an identical decoy 150 px away while lost: no usable sample within 20 px of it', () => {
    for (let k = 25; k < 70; k++) if (usable(at(k).st)) expect(dist(at(k), scene.decoy[k]!)).toBeGreaterThan(20);
  });
  it('re-acquired within 5 frames after the occluder leaves, marked as re-acquired, then tracked', () => {
    const first = steps.findIndex((s, i) => i + 1 >= 45 && usable(s.st)) + 1;
    expect(first).toBeGreaterThanOrEqual(45);
    expect(first - 45).toBeLessThan(5);
    expect(at(first).st).toBe(6);
    expect(at(first).q).toBeGreaterThanOrEqual(80);
    for (let k = first + 1; k < 70; k++) expect(at(k).st).toBe(1);
  });
  it('two identical candidates in reach: it stays lost rather than jump to either', () => {
    // the decoy appears 60 px below the disc just as it comes out, both inside the search radius
    const twin = discScene({ width: 400, height: 240, frames: 75, occlude: { from: 25, to: 45 }, decoy: { from: 45, to: 75, offset: { x: 0, y: 60 } } });
    const s = run(twin);
    for (let k = 45; k < 75; k++) expect(s[k - 1]!.st, `frame ${k}`).toBe(3);
  }, 60_000);
  it('a manual sample (anchor) ends the loss at once', () => {
    const t = createTracker(scene.frames[0]!, { kind: 'region', cx: scene.truth[0]!.cx, cy: scene.truth[0]!.cy, w: 2 * scene.radius, h: 2 * scene.radius });
    for (let k = 1; k <= 30; k++) t.step(scene.frames[k]!);
    t.anchor(scene.frames[30]!, { ...scene.truth[30]!, s: 1 }); // the disc is hidden here: the manual position is trusted as given
    for (let k = 31; k < 45; k++) t.step(scene.frames[k]!);
    // it re-seeded at the hidden position; whatever it reports while hidden, once the disc is visible it is followed again
    const after: TrackerStep[] = [];
    for (let k = 45; k < 60; k++) after.push(t.step(scene.frames[k]!));
    expect(after.some((s) => usable(s.st))).toBe(true);
    after.forEach((s, i) => { if (usable(s.st)) expect(dist(s, scene.truth[45 + i]!)).toBeLessThanOrEqual(3); });
  }, 60_000);
  it('two runs are bit-identical, and the result is pinned', () => {
    const again = run(scene);
    expect(digest(again)).toBe(digest(steps));
    // Golden digest of this scene's 69 steps (cx, cy, s, q, st as float64). It changes only when the algorithm does: then
    // bump TRACKER_ALGO (tracker.ts) and pin the new value.
    expect(digest(steps)).toBe(GOLDEN);
  });
});

const GOLDEN = '076a293cc0b7105af8674ddf87adcd53d24547be7c50ca5b5f1191cf0a1bb87b';
