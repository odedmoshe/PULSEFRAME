import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { CameraGeometry, MediaClip } from '@pulseframe/core';
import { centreFromPointer, clampCentre, localFrame, sourceFrameAt, stepZoom, windowFractions, ZOOM_STEP } from './CameraOverlay.tsx';

const R = { num: 30, den: 1 };
const wide: CameraGeometry = { frameW: 1080, frameH: 1920, srcW: 1920, srcH: 1080, fit: 'contain' }; // a 16:9 source in a 9:16 frame
const same: CameraGeometry = { frameW: 1920, frameH: 1080, srcW: 1920, srcH: 1080, fit: 'contain' };

describe('camera geometry (display only; the plan is core planCamera)', () => {
  it('at the fill scale one axis of the window is the whole source and the other is the part the frame shows', () => {
    const w = windowFractions(wide, 1);
    expect(w.wv).toBeCloseTo(1, 9);
    expect(w.wu).toBeCloseTo(0.31640625, 6);
    expect(windowFractions(same, 1)).toEqual({ wu: 1, wv: 1 });
  });
  it('zooming in shrinks the window by the zoom factor', () => {
    const a = windowFractions(wide, 1), b = windowFractions(wide, 2);
    expect(b.wu).toBeCloseTo(a.wu / 2, 9);
    expect(b.wv).toBeCloseTo(a.wv / 2, 9);
  });
  it('the centre never lets the window leave the source', () => {
    expect(clampCentre(0, 0, 0.4, 0.5)).toEqual({ u: 0.2, v: 0.25 });
    expect(clampCentre(2, 2, 0.4, 0.5)).toEqual({ u: 0.8, v: 0.75 });
    expect(clampCentre(0.5, 0.5, 1, 1)).toEqual({ u: 0.5, v: 0.5 });
  });
  it('the pointer maps to the centre inside the picture box and is clamped', () => {
    const box = { left: 100, top: 50, width: 400, height: 200 };
    expect(centreFromPointer(300, 150, box, 0.2, 0.2)).toEqual({ u: 0.5, v: 0.5 });
    expect(centreFromPointer(100, 50, box, 0.2, 0.2)).toEqual({ u: 0.1, v: 0.1 });
    expect(centreFromPointer(900, 900, box, 0.2, 0.2)).toEqual({ u: 0.9, v: 0.9 });
  });
  it('zoom steps by ×1.1 to the ceiling and back down to 1, and never past either', () => {
    expect(stepZoom(1, 1, 4)).toBeCloseTo(ZOOM_STEP, 6);
    expect(stepZoom(ZOOM_STEP, -1, 4)).toBe(1);
    expect(stepZoom(1, -1, 4)).toBe(1);
    expect(stepZoom(3.9, 1, 4)).toBe(4);
    expect(stepZoom(4, 1, 4)).toBe(4);
    let z = 1, n = 0;
    while (z < 2.85 && n < 100) { z = stepZoom(z, 1, 2.85); n++; }
    expect(z).toBe(2.85);
    expect(n).toBe(11); // 1.1^10 = 2.594 and 1.1^11 = 2.853: the eleventh step is clamped to the ceiling
  });
  const clip = (over: Partial<MediaClip> = {}) => ({ type: 'media', id: 'clp_a', assetId: 'ast_a', start: T.rt(2, 1), sourceIn: T.rt(10, 1), duration: T.rt(4, 1), ...over }) as MediaClip;
  it('clip-local frames and the source frame the whole-clip picture shows', () => {
    expect(localFrame(clip(), 90, R)).toBe(30);
    expect(localFrame(clip(), 30, R)).toBe(-30);
    expect(sourceFrameAt(clip(), 30, R)).toBe(11 * 30);
    expect(sourceFrameAt(clip({ speed: { num: 2, den: 1 } }), 30, R)).toBe(12 * 30);
    expect(sourceFrameAt(clip({ reverse: true }), 30, R)).toBe(13 * 30);
    expect(sourceFrameAt(clip(), -500, R)).toBe(0);
  });
});
