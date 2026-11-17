/**
 * The checks of overlays-proof.ts, on pictures drawn here in JavaScript from the model: a faithful drawing passes them and a
 * drawing that is off fails them, so a pass in the proof (which reads what the browser drew) means what it says.
 */
import { describe, expect, it } from 'vitest';
import { findEffect } from '@pulseframe/core';
import { overlayParticles, speedLines, wedgeCorners, type Particle } from '@pulseframe/engine/overlays.ts';
import { stampPolygons } from '@pulseframe/engine/stamp.ts';
import { centroid, particleMatch, polygonMask, rasterise, wedgeMatch, type Img } from './overlays-proof.ts';

const W = 1280, H = 720;
const params = (type: string, over: Record<string, unknown> = {}) => findEffect(type)!.params.parse(over) as Record<string, number | string | boolean>;
const toImg = (v: Float64Array, w: number, h: number): Img => { const rgb = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = Math.round(255 * Math.min(1, v[i]!)); return { w, h, rgb }; };
const black = (w: number, h: number): Img => ({ w, h, rgb: Buffer.alloc(w * h * 3) });
const shifted = (parts: Particle[], dx: number) => parts.map((q) => ({ ...q, x: q.x + dx }));

describe('overlays proof checks (on the model drawn in JavaScript)', () => {
  it('particle centres and far pixels: a faithful drawing passes, a drawing moved by a few pixels fails', () => {
    for (const [type, over] of [['overlay.snow', {}], ['overlay.hearts', { color: '#FFFFFF' }], ['overlay.confetti', { palette: 'single', color: '#FFFFFF' }]] as const) {
      const parts = overlayParticles(type, params(type, over), W, H, 1.5, 1.5, null);
      const good = particleMatch(toImg(rasterise(parts, W, H), W, H), black(W, H), parts);
      expect(good.litPct, type).toBeGreaterThanOrEqual(99);
      expect(good.farUnchangedPct, type).toBe(100);
      expect(good.considered).toBeGreaterThan(50);
      const bad = particleMatch(toImg(rasterise(shifted(parts, 0.5 * Math.max(...parts.map((q) => q.r)) + 4), W, H), W, H), black(W, H), parts);
      expect(bad.litPct, type).toBeLessThan(99);
    }
  }, 60_000);

  it('speed lines: a faithful drawing of the wedges passes, wedges turned by half a slot fail', () => {
    const p = params('overlay.speed-lines');
    const draw = (turn: number) => {
      const { cx, cy, lines } = speedLines(p, W, H, 1.5);
      const tris = lines.map((s) => wedgeCorners(cx, cy, { ...s, a0: s.a0 + turn, a1: s.a1 + turn }));
      const v = new Float64Array(W * H);
      for (const [a, b, c] of tris) {
        const xs = [a[0], b[0], c[0]], ys = [a[1], b[1], c[1]];
        for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(W - 1, Math.ceil(Math.max(...xs))); x++) {
          let k = 0;
          for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
            const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
            const s1 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]), s2 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]), s3 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
            if (!((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0))) k++;
          }
          v[y * W + x] = Math.max(v[y * W + x]!, (k / 16) * Number(p.amount));
        }
      }
      return toImg(v, W, H);
    };
    const good = wedgeMatch(draw(0), black(W, H), p, 1.5);
    expect(good.insideLitPct).toBeGreaterThanOrEqual(99);
    expect(good.outsideUnchangedPct).toBeGreaterThanOrEqual(99.9);
    const bad = wedgeMatch(draw(Math.PI / 90), black(W, H), p, 1.5);
    expect(bad.insideLitPct).toBeLessThan(90);
  }, 60_000);

  it('date stamp IoU: the polygons drawn with antialiasing and thresholded at half coverage reach IoU ≥ 0.95 at 16:9 and 9:16', () => {
    for (const [w, h] of [[1280, 720], [720, 1280]] as const) for (const text of ["'05 7 14", '12:34']) {
      const polys = stampPolygons(text, 0.1 * h, 'bottom-right', w, h);
      const model = polygonMask(polys, w, h);
      // a 4×4-sampled drawing of the same polygons, thresholded like the proof reads a still
      const fine = polygonMask(polys.map((poly) => poly.map((q) => ({ x: q.x * 4, y: q.y * 4 }))), w * 4, h * 4);
      let inter = 0, uni = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let k = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) k += fine[(y * 4 + sy) * w * 4 + x * 4 + sx]!;
        const drawn = k >= 8 ? 1 : 0, m = model[y * w + x]!;
        if (drawn && m) inter++;
        if (drawn || m) uni++;
      }
      expect(inter / uni, `${w}x${h} ${text}`).toBeGreaterThanOrEqual(0.95);
      // and a stamp one digit-thickness off is far from it
      const moved = polygonMask(polys.map((poly) => poly.map((q) => ({ x: q.x - 0.14 * 0.1 * h, y: q.y }))), w, h);
      let i2 = 0, u2 = 0;
      for (let i = 0; i < w * h; i++) { if (moved[i] && model[i]) i2++; if (moved[i] || model[i]) u2++; }
      expect(i2 / u2).toBeLessThan(0.8);
    }
  });

  it('burst centroid: the model drawn and blurred keeps its centroid within 2 px; moved by 3 px it does not', () => {
    const p = params('overlay.confetti', { mode: 'burst', palette: 'single', color: '#FFFFFF', seed: 3 });
    const parts = overlayParticles('overlay.confetti', p, W, H, 0.5, 0.5, null);
    const v = rasterise(parts, W, H);
    const blurred = new Float64Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += v[(y + dy) * W + x + dx]!; blurred[y * W + x] = s / 9; }
    const a = centroid((i) => v[i]!, W, H), b = centroid((i) => blurred[i]!, W, H);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(2);
    const m = rasterise(shifted(parts, 3), W, H), c = centroid((i) => m[i]!, W, H);
    expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThan(2);
    expect(parts).toHaveLength(48);
  }, 60_000);
});
