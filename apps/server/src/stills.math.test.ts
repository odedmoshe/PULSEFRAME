/**
 * W1 (wave 8 cover): the per-frame numbers of stills.math.ts on frames written by this test (no ffmpeg). Sobel is moments'
 * sharpness() itself; Immerkær's σ recovers a known grain; motion is to the previous frame; hi/lo count the clipped pixels; the
 * numbers are the same on every run. The noisy dark pair shows what the noise term does, with its numbers: a heuristic, compared
 * within one pair only.
 */
import { describe, expect, it } from 'vitest';
import { noiseCorrected, STILLS_NOISE_KERNEL } from '@pulseframe/core';
import { sharpness } from './moments.math.ts';
import { clippedPermille, measureFrame, motionPermille, noiseKernelSum, noiseSigma100, sobelEnergy } from './stills.math.ts';
import type { GreyFrame } from './vision/types.ts';

/** A deterministic PRNG (mulberry32) and a Box–Muller normal: test grain, labelled synthetic. */
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, normal: () => Math.sqrt(-2 * Math.log(Math.max(1e-12, u()))) * Math.cos(2 * Math.PI * u()) };
}
const frame = (W: number, H: number, f: (x: number, y: number) => number): GreyFrame => {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = Math.max(0, Math.min(255, Math.round(f(x, y))));
  return { width: W, height: H, data };
};
/** Horizontal and vertical box blur of radius r (clamped edges). */
export function boxBlur(src: Float64Array, W: number, H: number, r: number): Float64Array {
  if (r <= 0) return src;
  const tmp = new Float64Array(W * H), out = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let d = -r; d <= r; d++) s += src[y * W + Math.max(0, Math.min(W - 1, x + d))]!; tmp[y * W + x] = s / (2 * r + 1); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let d = -r; d <= r; d++) s += tmp[Math.max(0, Math.min(H - 1, y + d)) * W + x]!; out[y * W + x] = s / (2 * r + 1); }
  return out;
}

describe('stills maths', () => {
  it('sobel is moments\' sharpness(), reused', () => {
    const f = frame(40, 30, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 200 : 40);
    expect(sobelEnergy(f)).toBe(sharpness(f));
    expect(sobelEnergy(f)).toBeGreaterThan(0);
    expect(sobelEnergy(frame(2, 2, () => 9))).toBe(0);
  });
  it('Immerkær: 0 on flat and on linear ramps (the kernel cancels planes); recovers grain σ 6 as sigma100 about 600', () => {
    expect(STILLS_NOISE_KERNEL.reduce((a, b) => a + b, 0)).toBe(0);
    expect(noiseSigma100(frame(50, 40, () => 77))).toBe(0);
    expect(noiseKernelSum(frame(50, 40, (x, y) => 20 + 2 * x + 3 * y))).toBe(0);
    const g = rng(7);
    const noisy = frame(400, 300, () => 128 + 6 * g.normal());
    const s100 = noiseSigma100(noisy);
    expect(s100).toBeGreaterThan(560);
    expect(s100).toBeLessThan(640);
    // white noise: E[gx² + gy²] / 16 = 1.5 σ²; the corrected value of pure grain is near 0
    const sob = sobelEnergy(noisy);
    expect(Math.abs(sob - 54)).toBeLessThan(8);
    expect(noiseCorrected(sob, s100)).toBeLessThan(8);
  });
  it('motion: 0 to an equal frame, the mean absolute difference in permille of full scale otherwise; null only for frame 0', () => {
    const a = frame(20, 10, () => 100), b = frame(20, 10, () => 151);
    expect(motionPermille(a, a)).toBe(0);
    expect(motionPermille(a, b)).toBe(200); // 51/255
    expect(() => motionPermille(a, frame(10, 10, () => 0))).toThrow();
    expect(measureFrame(0, null, a).motion).toBeNull();
    expect(measureFrame(5, a, b).motion).toBe(200);
    expect(() => measureFrame(5, null, a)).toThrow(/previous frame/);
  });
  it('hi / lo: permille of grey >= 250 and <= 5', () => {
    const f = frame(100, 10, (x) => (x < 10 ? 255 : x < 15 ? 250 : x < 20 ? 249 : x < 45 ? 5 : x < 50 ? 6 : 128));
    expect(clippedPermille(f)).toEqual({ hi: 150, lo: 250 });
  });
  it('the same bytes give the same integers, every run', () => {
    const g = rng(11);
    const f = frame(321, 179, (x, y) => 60 + 40 * Math.sin(x / 7) * Math.cos(y / 5) + 5 * g.normal());
    const p = frame(321, 179, (x, y) => 60 + 40 * Math.sin((x + 1) / 7) * Math.cos(y / 5));
    const a = measureFrame(9, p, f), b = measureFrame(9, { ...p, data: p.data.slice() }, { ...f, data: f.data.slice() });
    expect(a).toEqual(b);
    for (const v of [a.sobel, a.sigma100, a.sharp, a.motion, a.hi, a.lo]) expect(Number.isInteger(v)).toBe(true);
  });
  it('the noisy dark pair: the raw Sobel picks the blurred grainy frame, the noise-corrected value picks the clean sharp one (numbers shown)', () => {
    // a dim room: texture of low contrast around grey 30. A = the texture blurred (radius 3) plus grain σ 6 (high gain);
    // B = the same texture sharp, no grain. Synthetic, one pair; a heuristic within this pair only.
    const W = 480, H = 270, g = rng(3), t = rng(5);
    const tex = new Float64Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tex[y * W + x] = 30 + (((x >> 3) + (y >> 3)) % 2 ? 4 : -4) + 3 * t.normal();
    const blurred = boxBlur(tex, W, H, 3);
    const A = frame(W, H, (x, y) => blurred[y * W + x]! + 6 * g.normal());
    const B = frame(W, H, (x, y) => tex[y * W + x]!);
    const a = measureFrame(1, B, A), b = measureFrame(2, A, B);
    const numbers = { A: { sobel: a.sobel, sigma100: a.sigma100, sharp: a.sharp }, B: { sobel: b.sobel, sigma100: b.sigma100, sharp: b.sharp } };
    console.info('stills noisy dark pair (synthetic):', JSON.stringify(numbers));
    expect(a.sobel).toBeGreaterThan(b.sobel); // the naive measure picks the wrong frame
    expect(a.sharp).toBeLessThan(b.sharp); // the noise term turns it round on this pair
    expect(a.sigma100).toBeGreaterThan(b.sigma100);
  });
});
