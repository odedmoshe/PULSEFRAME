import { describe, expect, it } from 'vitest';
import { clampPps, fitPps, MAX_PPS, MIN_PPS, ppsToSlider, scrollLeftAfterZoom, sliderToPps, SLIDER_MAX, wheelFactor, zoomAnchorX } from './zoom.math.ts';

describe('slider scale', () => {
  it('ends at the limits and round-trips', () => {
    expect(sliderToPps(0)).toBeCloseTo(MIN_PPS, 9);
    expect(sliderToPps(SLIDER_MAX)).toBeCloseTo(MAX_PPS, 9);
    for (const p of [10, 17, 90, 135, 400, 720]) expect(sliderToPps(ppsToSlider(p))).toBeCloseTo(p, 6);
    for (const v of [0, 100, 500, 999, 1000]) expect(ppsToSlider(sliderToPps(v))).toBeCloseTo(v, 6);
  });
  it('clamps out-of-range input and is monotonic', () => {
    expect(sliderToPps(-5)).toBe(MIN_PPS);
    expect(sliderToPps(5000)).toBe(MAX_PPS);
    expect(ppsToSlider(1)).toBe(0);
    expect(ppsToSlider(9999)).toBeCloseTo(SLIDER_MAX, 9);
    expect(sliderToPps(300)).toBeLessThan(sliderToPps(301));
    expect(clampPps(NaN)).toBe(MIN_PPS);
  });
});

describe('fitPps', () => {
  it('fits duration plus margin into the visible width', () => {
    for (const [d, w] of [[20, 1200], [5, 800], [120, 1440], [60, 600]] as const) {
      const p = fitPps(d, w, 90);
      expect(p).toBeGreaterThanOrEqual(MIN_PPS);
      expect(p).toBeLessThanOrEqual(MAX_PPS);
      if (p > MIN_PPS && p < MAX_PPS) expect(76 + (d + 1) * p).toBeLessThanOrEqual(w);
    }
    expect(fitPps(20, 1200, 90)).toBeCloseTo((1200 - 76 - 12) / 21, 9);
  });
  it('clamps and handles empty or tiny areas', () => {
    expect(fitPps(0, 1000, 90)).toBe(90);
    expect(fitPps(0.2, 3000, 90)).toBe(MAX_PPS);
    expect(fitPps(100000, 1000, 90)).toBe(MIN_PPS);
    expect(fitPps(10, 50, 90)).toBe(MIN_PPS);
  });
});

describe('scrollLeftAfterZoom', () => {
  it('keeps the anchor time at the same x within half a pixel', () => {
    for (const sl of [0, 120, 900]) for (const ax of [100, 400, 777]) for (const [o, n] of [[90, 135], [135, 90], [90, 720], [300, 10]] as const) {
      const t = (sl + ax - 76) / o;
      const next = scrollLeftAfterZoom({ scrollLeft: sl, oldPps: o, newPps: n, anchorX: ax });
      if (next > 0) expect(Math.abs(76 + t * n - next - ax)).toBeLessThan(0.5);
    }
  });
  it('never goes negative', () => {
    expect(scrollLeftAfterZoom({ scrollLeft: 0, oldPps: 100, newPps: 10, anchorX: 300 })).toBe(0);
  });
});

describe('zoomAnchorX and wheelFactor', () => {
  it('uses the playhead when visible, else the centre', () => {
    expect(zoomAnchorX({ playheadS: 10, pps: 90, scrollLeft: 0, viewWidth: 1200 })).toBe(976);
    expect(zoomAnchorX({ playheadS: 100, pps: 90, scrollLeft: 0, viewWidth: 1200 })).toBe(76 + (1200 - 76) / 2);
    expect(zoomAnchorX({ playheadS: 0, pps: 90, scrollLeft: 500, viewWidth: 1200 })).toBe(76 + (1200 - 76) / 2);
  });
  it('scales smoothly with deltaY', () => {
    expect(wheelFactor(0, 0)).toBe(1);
    expect(wheelFactor(-4, 0)).toBeGreaterThan(1);
    expect(wheelFactor(-4, 0)).toBeLessThan(1.02);
    expect(wheelFactor(4, 0)).toBeLessThan(1);
    expect(wheelFactor(-100, 0) * wheelFactor(100, 0)).toBeCloseTo(1, 9);
  });
});
