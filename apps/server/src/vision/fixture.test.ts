/**
 * The model-free tracker (ADR-0015) on the frames of the tracking proof's own fixture (packages/fixtures TRACKING_FIXTURE:
 * a textured disc on noise, hidden on frames 150–169, an identical look-alike from frame 160), without a server, a browser
 * or ffmpeg: every frame comes from the generator the proof encodes (trackingFrame), is turned to BT.709 luminance and
 * averaged 2×2 to the tracker's work size (640×360, what `scale=…:flags=area,format=gray` does to a 1280×720 picture, less
 * the codec), and the tracker is seeded as the job seeds it from the proof's box on frame 0. The assertions are the
 * proof's P2–P4 in source pixels.
 */
import { describe, expect, it } from 'vitest';
import { TRACKING_FIXTURE as FX, decoyDistance, trackingFrame, trackingTruth } from '../../../../packages/fixtures/src/index.ts';
import { createTracker } from './tracker.ts';
import type { GreyFrame, TrackerStep } from './types.ts';

const SW = FX.width, SH = FX.height, W = SW / 2, H = SH / 2, UNIT = 10_000;
function workFrame(index: number): GreyFrame {
  const { rgb } = trackingFrame(index);
  const data = new Uint8Array(W * H);
  const luma = (o: number) => 0.2126 * rgb[o]! + 0.7152 * rgb[o + 1]! + 0.0722 * rgb[o + 2]!;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = (2 * y * SW + 2 * x) * 3, b = a + SW * 3;
      data[y * W + x] = Math.round((luma(a) + luma(a + 3) + luma(b) + luma(b + 3)) / 4);
    }
  return { width: W, height: H, data };
}
const usable = (st: number) => st === 1 || st === 6;

describe('the tracking proof\'s fixture, fed to the tracker directly', () => {
  // the proof's seed: the true box on frame 0 in 1/10000 of the picture, then the job's conversion to work px (pixel centres)
  const t0 = trackingTruth(0);
  const sx = Math.round((t0.cx / SW) * UNIT), sy = Math.round((t0.cy / SH) * UNIT), sw = Math.round(((2 * t0.r) / SW) * UNIT), sh = Math.round(((2 * t0.r) / SH) * UNIT);
  const steps: (TrackerStep | null)[] = [null];
  /** Position of a step in source px (continuous: u = (cx + 0.5) / W). */
  const src = (s: TrackerStep) => ({ x: ((s.cx + 0.5) / W) * SW, y: ((s.cy + 0.5) / H) * SH });
  const err = (k: number) => { const p = src(steps[k]!), t = trackingTruth(k); return Math.hypot(p.x - t.cx, p.y - t.cy); };

  it('tracks all 240 frames', () => {
    const tracker = createTracker(workFrame(0), { kind: 'region', cx: (sx / UNIT) * W - 0.5, cy: (sy / UNIT) * H - 0.5, w: (sw / UNIT) * W, h: (sh / UNIT) * H });
    for (let k = 1; k < FX.frames; k++) steps.push(tracker.step(workFrame(k)));
    expect(steps.length).toBe(FX.frames);
  }, 600_000);
  it('P3: no usable sample is more than 8 px from the truth', () => {
    const off = steps.flatMap((s, k) => (s && usable(s.st) && err(k) > 8 ? [{ frame: k, px: Math.round(err(k)), st: s.st }] : []));
    expect(off.slice(0, 6)).toEqual([]);
  });
  it('P3: at least 90% of the occluded frames 150–169 are weak or lost', () => {
    let bad = 0;
    for (let k = FX.occluded.from; k <= FX.occluded.to; k++) if (steps[k]!.st === 2 || steps[k]!.st === 3) bad++;
    expect(bad).toBeGreaterThanOrEqual(18);
  });
  it('P3: found again by frame 175, at the true disc, marked re-acquired', () => {
    const back = steps.findIndex((s, k) => k > FX.occluded.to && !!s && usable(s.st));
    expect(back).toBeGreaterThan(FX.occluded.to);
    expect(back).toBeLessThanOrEqual(175);
    expect(steps[back]!.st).toBe(6);
    expect(err(back)).toBeLessThanOrEqual(8);
  });
  it('P4: while the look-alike is shown, no usable sample is within 100 px of it', () => {
    const near = steps.flatMap((s, k) => { const p = s && src(s); return p && usable(s.st) && decoyDistance(k) !== null && Math.hypot(p.x - FX.decoy.cx, p.y - FX.decoy.cy) < 100 ? [k] : []; });
    expect(near.slice(0, 6)).toEqual([]);
  });
  it('P2: at least 150 usable frames; median error ≤ 1 px, 95th percentile ≤ 3 px; size error median ≤ 5%', () => {
    const errs: number[] = [], sizes: number[] = [];
    steps.forEach((s, k) => { if (!s || !usable(s.st) || trackingTruth(k).occluded) return; errs.push(err(k)); sizes.push(Math.abs(t0.r * s.s - trackingTruth(k).r) / trackingTruth(k).r); });
    errs.sort((a, b) => a - b); sizes.sort((a, b) => a - b);
    expect(errs.length).toBeGreaterThanOrEqual(150);
    expect(errs[Math.floor((errs.length - 1) / 2)]!).toBeLessThanOrEqual(1);
    expect(errs[Math.min(errs.length - 1, Math.ceil(0.95 * errs.length) - 1)]!).toBeLessThanOrEqual(3);
    expect(sizes[Math.floor((sizes.length - 1) / 2)]!).toBeLessThanOrEqual(0.05);
  });
});
