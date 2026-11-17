/**
 * Placement geometry shared by the follow resolver and the track picker (ADR-0015): it must agree with how the compositor
 * draws a picture (compositor2d.ts placedSize + withTransform: translate to the centre, rotate clockwise, scale), and
 * frameToSource must invert sourceToFrame.
 */
import { describe, expect, it } from 'vitest';
import { fitScale, frameToSource, placed, sourceToFrame, type Fit } from './index.ts';

/** mulberry32: a small seeded generator, so a failure names a reproducible case. */
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** The canvas transform chain written out as 3×3 affine matrices, independently of geometry.ts. */
type M = [number, number, number, number, number, number]; // a b c d e f: x' = a·x + c·y + e, y' = b·x + d·y + f (DOMMatrix order)
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
const translate = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const rotate = (deg: number): M => { const r = (deg * Math.PI) / 180; return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]; };
const scaleM = (k: number): M => [k, 0, 0, k, 0, 0];
const apply = (m: M, x: number, y: number) => ({ px: m[0] * x + m[2] * y + m[4], py: m[1] * x + m[3] * y + m[5] });

describe('placement geometry', () => {
  it('fitScale is contain = min and cover = max of the two ratios', () => {
    expect(fitScale(1920, 1080, 1280, 720, 'contain')).toBe(1.5);
    expect(fitScale(1080, 1920, 1280, 720, 'contain')).toBeCloseTo(1080 / 1280, 15);
    expect(fitScale(1080, 1920, 1280, 720, 'cover')).toBeCloseTo(1920 / 720, 15);
    const p = placed(1080, 1920, 'contain', 1280, 720, { x: 0.25, y: -0.1, scale: 2, rotation: 30 });
    expect(p).toEqual({ cx: 540 + 270, cy: 960 - 192, w: 1080, h: 720 * (1080 / 1280), rotation: 30, scale: 2 });
  });
  it('the centre of the picture is the transform centre; its corners land where the canvas draws them', () => {
    const p = placed(1920, 1080, 'contain', 1280, 720, { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(sourceToFrame(p, 0.5, 0.5)).toEqual({ px: 960, py: 540 });
    expect(sourceToFrame(p, 0, 0)).toEqual({ px: 0, py: 0 });
    expect(sourceToFrame(p, 1, 1)).toEqual({ px: 1920, py: 1080 });
    // rotated a quarter turn clockwise: the picture's top-left corner goes to the top-right of its centre (y grows downwards)
    const q = placed(1920, 1080, 'contain', 1280, 720, { x: 0, y: 0, scale: 1, rotation: 90 });
    const c = sourceToFrame(q, 0, 0);
    expect(c.px).toBeCloseTo(960 + 540, 9);
    expect(c.py).toBeCloseTo(540 - 960, 9);
  });
  it('agrees with the canvas transform chain and round-trips within 1e-9 over 2,000 seeded placements', () => {
    const r = rng(12_345);
    const frames: [number, number][] = [[1920, 1080], [1080, 1920], [1080, 1080], [1280, 720], [720, 1280]];
    let worstChain = 0, worstTrip = 0;
    for (let i = 0; i < 2000; i++) {
      const [W, H] = frames[i % frames.length]!;
      const srcW = 16 + Math.floor(r() * 4000), srcH = 16 + Math.floor(r() * 4000);
      const fit: Fit = r() < 0.5 ? 'contain' : 'cover';
      const t = { x: r() * 2 - 1, y: r() * 2 - 1, scale: 0.1 + r() * 4.9, rotation: r() * 360 - 180 };
      const p = placed(W, H, fit, srcW, srcH, t);
      const f = fitScale(W, H, srcW, srcH, fit);
      const m = mul(mul(translate(W / 2 + t.x * W, H / 2 + t.y * H), rotate(t.rotation)), scaleM(t.scale));
      for (let k = 0; k < 5; k++) {
        const u = r() * 1.4 - 0.2, v = r() * 1.4 - 0.2;
        const got = sourceToFrame(p, u, v);
        // the picture is drawn at (−w/2, −h/2, w, h) inside the chain: source point (u, v) is local ((u − ½)·w, (v − ½)·h)
        const want = apply(m, (u - 0.5) * srcW * f, (v - 0.5) * srcH * f);
        worstChain = Math.max(worstChain, Math.abs(got.px - want.px), Math.abs(got.py - want.py));
        const back = frameToSource(p, got.px, got.py);
        worstTrip = Math.max(worstTrip, Math.abs(back.u - u), Math.abs(back.v - v));
      }
    }
    expect(worstChain).toBeLessThan(1e-6); // frame px (points reach ~10^5 px at scale 5): only floating-point rounding differs
    expect(worstTrip).toBeLessThan(1e-9);
  });
});
