import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { boxToScreen, layerBox, overlapsOnTrack, pxToFrameTime, rotationFromDrag, scaleFromDrag, screenDeltaToFrameFraction, snapTime, markerSnapCandidates } from './interactions.math.ts';

const s = (v: number) => T.rt(v, 1);

describe('snapTime', () => {
  const candidates = [s(0), s(2), s(4)];
  it('returns the exact candidate within threshold', () => {
    const r = snapTime({ time: T.rt(1990, 1000), candidates, pxPerSecond: 100, thresholdPx: 8 });
    expect(r).toEqual({ time: s(2), snapped: true, index: 1 });
  });
  it('does not snap outside the threshold', () => {
    const t = T.rt(3, 2);
    expect(snapTime({ time: t, candidates, pxPerSecond: 100, thresholdPx: 8 })).toEqual({ time: t, snapped: false, index: -1 });
  });
  it('ties go to the earlier candidate', () => {
    expect(snapTime({ time: s(1), candidates: [s(0), s(2)], pxPerSecond: 4, thresholdPx: 8 }).index).toBe(0);
  });
  it('threshold scales with zoom', () => {
    expect(snapTime({ time: T.rt(1, 10), candidates: [s(0)], pxPerSecond: 90, thresholdPx: 8 }).snapped).toBe(false);
    expect(snapTime({ time: T.rt(1, 10), candidates: [s(0)], pxPerSecond: 80, thresholdPx: 8 }).snapped).toBe(true);
  });
});

describe('pxToFrameTime', () => {
  it('rounds to the nearest frame at 30 fps', () => {
    expect(pxToFrameTime(45, 90, { num: 30, den: 1 })).toEqual(T.frameTime(15, { num: 30, den: 1 }));
    expect(T.eq(pxToFrameTime(46, 90, { num: 30, den: 1 }), T.rt(1, 2))).toBe(true);
  });
  it('is exact at 30000/1001', () => {
    const r = pxToFrameTime(90, 90, { num: 30000, den: 1001 });
    expect(r).toEqual({ value: '1001', timescale: 1000 });
    expect(T.isFrameAligned(r, { num: 30000, den: 1001 })).toBe(true);
  });
  it('handles negative offsets', () => {
    expect(T.eq(pxToFrameTime(-90, 90, { num: 30, den: 1 }), T.rt(-1, 1))).toBe(true);
  });
});

describe('layerBox / boxToScreen', () => {
  it('contain-fits a 4:3 picture into a 1920x1080 frame', () => {
    const b = layerBox({ frameW: 1920, frameH: 1080, naturalW: 400, naturalH: 300, transform: { x: 0, y: 0, scale: 1, rotation: 0 } });
    expect(b).toEqual({ cx: 960, cy: 540, w: 1440, h: 1080, rotationDeg: 0 });
  });
  it('applies offset, scale and rotation', () => {
    const b = layerBox({ frameW: 1000, frameH: 500, naturalW: 1000, naturalH: 500, transform: { x: 0.1, y: -0.2, scale: 0.5, rotation: 30 } });
    expect(b).toEqual({ cx: 600, cy: 150, w: 500, h: 250, rotationDeg: 30 });
  });
  it('uses text size as is with fit:false', () => {
    const b = layerBox({ frameW: 1000, frameH: 500, naturalW: 800, naturalH: 60, transform: { x: 0, y: 0, scale: 2, rotation: 0 }, fit: false });
    expect(b.w).toBe(1600);
    expect(b.h).toBe(120);
  });
  it('maps to screen pixels', () => {
    expect(boxToScreen({ cx: 960, cy: 540, w: 1440, h: 1080, rotationDeg: 5 }, 480, 1920)).toEqual({ cx: 240, cy: 135, w: 360, h: 270, rotationDeg: 5 });
  });
  it('maps screen deltas to frame fractions', () => {
    expect(screenDeltaToFrameFraction(48, -27, 480, 270)).toEqual({ dx: 0.1, dy: -0.1 });
  });
});

describe('scaleFromDrag', () => {
  it('scales by distance ratio', () => expect(scaleFromDrag(100, 150, 2)).toBe(3));
  it('clamps to schema range', () => {
    expect(scaleFromDrag(100, 0, 1)).toBe(0.01);
    expect(scaleFromDrag(1, 1000, 1)).toBe(20);
  });
  it('ignores a degenerate start', () => expect(scaleFromDrag(0, 50, 1.5)).toBe(1.5));
});

describe('rotationFromDrag', () => {
  const c = { x: 0, y: 0 };
  it('quarter turn clockwise on screen', () => {
    expect(rotationFromDrag(c, { x: 1, y: 0 }, { x: 0, y: 1 }, 10, false)).toBeCloseTo(100, 9);
  });
  it('wraps across +-180 without a jump', () => {
    expect(rotationFromDrag(c, { x: -1, y: 1 }, { x: -1, y: -1 }, 0, false)).toBeCloseTo(90, 9);
    expect(rotationFromDrag(c, { x: -1, y: -1 }, { x: -1, y: 1 }, 0, false)).toBeCloseTo(-90, 9);
  });
  it('snaps to 15 degrees', () => {
    expect(rotationFromDrag(c, { x: 1, y: 0 }, { x: Math.cos(0.3), y: Math.sin(0.3) }, 0, true)).toBe(15);
  });
  it('clamps to the schema range', () => {
    expect(rotationFromDrag(c, { x: 1, y: 0 }, { x: 0, y: 1 }, 3590, false)).toBe(3600);
  });
});

describe('overlapsOnTrack', () => {
  const clips = [
    { id: 'a', start: s(0), duration: s(2) },
    { id: 'b', start: s(3), duration: s(2) },
  ];
  it('detects overlap, treating intervals as half-open', () => {
    expect(overlapsOnTrack(clips, ['a'], s(2), s(4))).toBe(true);
    expect(overlapsOnTrack(clips, ['a'], s(2), s(3))).toBe(false);
    expect(overlapsOnTrack(clips, ['a'], s(5), s(7))).toBe(false);
  });
  it('ignores moving clips', () => {
    expect(overlapsOnTrack(clips, ['a', 'b'], s(0), s(10))).toBe(false);
    expect(overlapsOnTrack(clips, ['b'], s(1), s(2))).toBe(true);
  });
});

describe('markerSnapCandidates', () => {
  const rate = { num: 30, den: 1 };
  it('moves markers to the nearest frame', () => {
    const c = markerSnapCandidates([T.rt(1, 3), T.rt(5, 1)], rate);
    expect(c.every((t) => T.isFrameAligned(t, rate))).toBe(true);
    expect(T.eq(c[0]!, T.rt(10, 30))).toBe(true);
  });
  it('a snapped time is frame-aligned and exact', () => {
    const c = markerSnapCandidates([T.rt(1003, 1000)], rate);
    const r = snapTime({ time: T.rt(1, 1), candidates: c, pxPerSecond: 100, thresholdPx: 8 });
    expect(r.snapped).toBe(true);
    expect(T.isFrameAligned(r.time, rate)).toBe(true);
  });
});
