/**
 * The two built-in test pictures (wave 8 booth; verify C6): deterministic RGBA, an asymmetric arrow and a corner notch (a mirror or a
 * flip changes the bytes), no saturated red, no fine high-contrast grid, a moderate luminance gap between a and b.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../sha256.ts';
import { BOOTH_SCENE_H as H, BOOTH_SCENE_W as W } from './scene.ts';
import { boothTestPictureRgba } from './testPicture.ts';

const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (p: Uint8Array, i: number) => 0.2126 * lin(p[i]!) + 0.7152 * lin(p[i + 1]!) + 0.0722 * lin(p[i + 2]!);
const hex = (p: Uint8Array) => sha256Hex(Array.from(p, (b) => String.fromCharCode(b)).join(''));
const mirror = (p: Uint8Array) => { const o = new Uint8Array(p.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o.set(p.subarray((y * W + x) * 4, (y * W + x) * 4 + 4), (y * W + (W - 1 - x)) * 4); return o; };
const flip = (p: Uint8Array) => { const o = new Uint8Array(p.length); for (let y = 0; y < H; y++) o.set(p.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4); return o; };

describe('booth test pictures', () => {
  const a = boothTestPictureRgba('a'), b = boothTestPictureRgba('b');
  it('are W×H opaque RGBA, the same bytes on every call, and differ from each other', () => {
    for (const p of [a, b]) { expect(p.length).toBe(W * H * 4); for (let i = 3; i < p.length; i += 4) if (p[i] !== 255) throw new Error(`alpha at ${i}`); }
    expect(hex(boothTestPictureRgba('a'))).toBe(hex(a));
    expect(hex(a)).not.toBe(hex(b));
  });
  it('a mirrored or upside-down picture is not the same picture (arrow and notch are asymmetric)', () => {
    for (const p of [a, b]) { expect(hex(mirror(p))).not.toBe(hex(p)); expect(hex(flip(p))).not.toBe(hex(p)); }
    // the notch: a's top-left corner pixel is dark, its top-right is not; b's bottom-right is dark, its bottom-left is not
    expect(lum(a, 0)).toBeLessThan(0.05);
    expect(lum(a, (W - 1) * 4)).toBeGreaterThan(0.1);
    expect(lum(b, ((H - 1) * W + W - 1) * 4)).toBeLessThan(0.05);
    expect(lum(b, (H - 1) * W * 4)).toBeGreaterThan(0.1);
  });
  it('ADR-0009 inputs: no saturated red (linear red share < 0.5 everywhere), moderate mean luminance gap, no fine grid', () => {
    const stats = (p: Uint8Array) => {
      let sum = 0, maxRed = 0, edges = 0;
      for (let i = 0; i < p.length; i += 4) {
        const r = lin(p[i]!), g = lin(p[i + 1]!), bl = lin(p[i + 2]!);
        if (r + g + bl > 0) maxRed = Math.max(maxRed, r / (r + g + bl));
        sum += lum(p, i);
        // a high-contrast step to the right-hand neighbour
        if ((i / 4) % W < W - 1 && Math.abs(lum(p, i) - lum(p, i + 4)) > 0.4) edges++;
      }
      return { mean: sum / (W * H), maxRed, edgeShare: edges / (W * H) };
    };
    const sa = stats(a), sb = stats(b);
    expect(sa.maxRed).toBeLessThan(0.5);
    expect(sb.maxRed).toBeLessThan(0.5);
    // numbers shown on failure: the means are moderate (0.1–0.6) and within 0.25 of each other
    expect({ a: +sa.mean.toFixed(3), b: +sb.mean.toFixed(3), inRange: [sa.mean, sb.mean].every((m) => m > 0.1 && m < 0.6), gapOk: Math.abs(sa.mean - sb.mean) < 0.25 })
      .toMatchObject({ inRange: true, gapOk: true });
    // a fine high-contrast grid would put a strong edge on many pixels; large shapes put one on under 1% of them
    expect(sa.edgeShare).toBeLessThan(0.01);
    expect(sb.edgeShare).toBeLessThan(0.01);
  });
});
