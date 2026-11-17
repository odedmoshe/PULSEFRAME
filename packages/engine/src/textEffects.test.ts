import { describe, expect, it } from 'vitest';
import {
  bucketShade, darken, deviceBox, direction, extrudeLayers, gradientAt, gradientLine, outlineWidths, paragraphSpacing, parseColour,
  smearCount, smearDraws, smearSteps, smearVector, unitCorners, unitGradientLine, unitOrigin, EXTRUDE_MAX_BUCKETS, EXTRUDE_MAX_LAYERS,
} from './textEffects.ts';

/** ⌈log₂ n⌉ in integers. */
const ceilLog2 = (n: number) => { let k = 0; while (2 ** k < n) k++; return k; };

describe('long shadow smear (ADR-0012)', () => {
  it('smearSteps(L) covers the offsets 0 … L−1 exactly, in ⌈log₂ L⌉ + 1 draws, for L = 1 … 4000', () => {
    const covered = new Uint8Array(4001), next = new Uint8Array(4001);
    for (let L = 1; L <= 4000; L++) {
      const steps = smearSteps(L);
      expect(steps.length, `L=${L}`).toBe(ceilLog2(L) + 1);
      expect(smearDraws(L)).toBe(steps.length);
      expect(steps[0]).toBe(0); // the first draw is the picture itself
      // each later draw puts everything drawn so far again `o` further on
      covered.fill(0); covered[0] = 1;
      let max = 0;
      for (const o of steps.slice(1)) {
        expect(o, `L=${L}`).toBeGreaterThan(0);
        next.set(covered);
        for (let i = 0; i <= max; i++) if (covered[i] && i + o <= 4000) next[i + o] = 1;
        covered.set(next);
        max += o;
      }
      expect(max, `L=${L}: the last position`).toBe(L - 1);
      for (let i = 0; i < L; i++) if (!covered[i]) throw new Error(`L=${L}: offset ${i} not covered`);
    }
  });
  it('a smear is counted along the main axis of its direction: exactly one position per pixel column (or row), nothing skipped', () => {
    expect(smearCount(100, 0)).toBe(101);
    expect(smearCount(100, 90)).toBe(101);
    expect(smearCount(100, 45)).toBe(Math.round(100 * Math.SQRT1_2) + 1);
    expect(smearCount(0, 30)).toBe(1);
    expect(smearVector(7, 0)).toEqual([7, 0]); expect(smearVector(7, 90)).toEqual([0, 7]); expect(smearVector(7, 180)).toEqual([-7, 0]); expect(smearVector(7, 270)).toEqual([0, -7]);
    expect(smearVector(7, 45)).toEqual([7, 7]);
    for (let angle = 0; angle < 360; angle += 15) {
      const [x, y] = direction(angle), major = Math.abs(x) >= Math.abs(y), slope = major ? y / Math.abs(x) : x / Math.abs(y);
      for (const n of [2, 3, 17, 64, 100, 257, 600]) {
        // the positions the doubling draws reach: every subset of the steps
        let pos: [number, number][] = [[0, 0]];
        for (const o of smearSteps(n).slice(1)) { const [vx, vy] = smearVector(o, angle); pos = [...pos, ...pos.map(([a, b]) => [a + vx, b + vy] as [number, number])]; }
        const along = new Map<number, number>();
        for (const [a, b] of pos) along.set(Math.abs(major ? a : b), major ? b : a);
        expect([...along.keys()].sort((p, q) => p - q), `${angle}° n=${n}`).toEqual(Array.from({ length: n }, (_, i) => i)); // every column once, no gap
        let prev = 0;
        for (let k = 0; k < n; k++) {
          const m = along.get(k)!;
          expect(Math.abs(m - k * slope), `${angle}° n=${n} k=${k}: off the line`).toBeLessThanOrEqual(2.5);
          if (k > 0) expect(Math.abs(m - prev), `${angle}° n=${n} k=${k}: a jump across`).toBeLessThanOrEqual(2);
          prev = m;
        }
      }
    }
  });
});

describe('extrusion layers and shade buckets', () => {
  it('N = min(48, ⌈depth⌉) layers in K = min(6, N) buckets, listed far to near, the farthest at the full depth', () => {
    for (const [depth, N, K] of [[0.4, 1, 1], [1, 1, 1], [3.2, 4, 4], [6, 6, 6], [10, 10, 6], [48, 48, 6], [48.5, 48, 6], [115, 48, 6]] as const) {
      const e = extrudeLayers(depth, 45);
      expect([e.N, e.K, e.layers.length], `depth ${depth}`).toEqual([N, K, N]);
      expect(e.layers.map((l) => l.k)).toEqual(Array.from({ length: N }, (_, i) => N - i)); // far to near
      const far = e.layers[0]!;
      expect([far.dx, far.dy]).toEqual([Math.round(depth * Math.SQRT1_2), Math.round(depth * Math.SQRT1_2)]);
      // buckets: 0 next to the letters, K−1 at the back; every bucket used; deeper layers never in a nearer bucket
      const buckets = e.layers.map((l) => l.bucket).reverse();
      expect(new Set(buckets).size).toBe(K);
      for (let i = 1; i < buckets.length; i++) expect(buckets[i]!).toBeGreaterThanOrEqual(buckets[i - 1]!);
      expect(buckets[0]).toBe(0); expect(buckets.at(-1)).toBe(K - 1);
    }
    expect(EXTRUDE_MAX_LAYERS).toBe(48); expect(EXTRUDE_MAX_BUCKETS).toBe(6);
    // a straight extrusion toward 0° steps one pixel at a time up to 48 px deep
    expect(extrudeLayers(20, 0).layers.map((l) => l.dx).reverse()).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
  it('the side darkens with depth: bucket b of K is darkened by shade·(b + ½)/K', () => {
    expect(bucketShade(0.6, 0, 6)).toBeCloseTo(0.05, 12);
    expect(bucketShade(0.6, 5, 6)).toBeCloseTo(0.55, 12);
    for (let b = 1; b < 6; b++) expect(bucketShade(0.5, b, 6)).toBeGreaterThan(bucketShade(0.5, b - 1, 6));
    expect(darken('#3A0CA3', 0)).toBe('#3a0ca3ff');
    expect(darken('#FFFFFF', 0.5)).toBe('#808080ff');
    expect(darken('#0000004D', 0.5)).toBe('#0000004d'); // the colour's own opacity is kept
    expect(parseColour('#FF2BD6')).toEqual([255, 43, 214, 255]);
    expect(parseColour('#0000004D')).toEqual([0, 0, 0, 77]);
  });
});

describe('gradient fill', () => {
  const box = { x: -300, y: -60, w: 600, h: 120 };
  it('runs through the centre of the ink box, half-length (w/2)|cos| + (h/2)|sin|: its ends at 0°, 45°, 90° and 135°', () => {
    expect(gradientLine(0, box)).toEqual({ x0: -300, y0: 0, x1: 300, y1: 0 }); // left to right
    expect(gradientLine(90, box)).toEqual({ x0: 0, y0: -60, x1: 0, y1: 60 }); // top to bottom
    const g45 = gradientLine(45, box), half45 = (300 + 60) * Math.SQRT1_2;
    expect(g45.x1).toBeCloseTo(half45 * Math.SQRT1_2, 9); expect(g45.y1).toBeCloseTo(half45 * Math.SQRT1_2, 9);
    expect(g45.x0).toBeCloseTo(-g45.x1, 9); expect(g45.y0).toBeCloseTo(-g45.y1, 9);
    const g135 = gradientLine(135, box);
    expect(g135.x1).toBeCloseTo(-half45 * Math.SQRT1_2, 9); expect(g135.y1).toBeCloseTo(half45 * Math.SQRT1_2, 9);
    // the ends are exactly where the box's farthest corners fall: the first and last colour reach the ink's corners
    for (const angle of [0, 45, 90, 135, 200, 330]) {
      const g = gradientLine(angle, box);
      const t = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([x, y]) => gradientAt(g, x!, y!));
      expect(Math.min(...t), `${angle}°`).toBeCloseTo(0, 9); expect(Math.max(...t), `${angle}°`).toBeCloseTo(1, 9);
      expect(gradientAt(g, box.x + box.w / 2, box.y + box.h / 2)).toBeCloseTo(0.5, 9);
    }
  });
  it('a unit\'s gradient is the block\'s shifted by minus its place at rest: equal to the still picture at rest, and the letter keeps its colours while it moves', () => {
    const block = gradientLine(90, box), px = 100;
    const unit = { left: 120, width: 60, baseline: 34 };
    const o = unitOrigin(unit, px);
    expect(o).toEqual({ x: 150, y: 0 });
    const local = unitGradientLine(block, o);
    for (const [x, y] of [[120, -50], [150, 0], [179, 40], [130, 22]]) {
      // at rest the unit is drawn at its origin: a block point (x, y) is the unit-local point (x − ox, y − oy)
      expect(gradientAt(local, x! - o.x, y! - o.y)).toBeCloseTo(gradientAt(block, x!, y!), 12);
    }
    // the unit risen by 0.7 font sizes: its own points still take the colours they have at rest
    const risen = { dx: 0, dy: 0.7 * px };
    for (const [lx, ly] of [[-20, -40], [0, 0], [25, 30]]) expect(gradientAt(local, lx!, ly!)).toBeCloseTo(gradientAt(block, lx! + o.x, ly! + o.y), 12);
    expect(gradientAt(block, o.x, o.y + risen.dy)).not.toBeCloseTo(gradientAt(local, 0, 0), 3); // whereas the block's gradient at the moved place differs
  });
});

describe('device bounding box', () => {
  const I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  it('is the whole-pixel box of the posed units in the frame, widened by what the looks add, cut to the frame', () => {
    const u = { left: -50, width: 100, baseline: 34 }, px = 100;
    const c = unitCorners({ ...I, e: 540, f: 960 }, u, { dx: 0, dy: 0, scale: 1 }, px, 0); // the title in the middle of 1080×1920
    expect(c).toEqual([{ x: 490, y: 810 }, { x: 590, y: 810 }, { x: 590, y: 1110 }, { x: 490, y: 1110 }]);
    expect(deviceBox(c, 10.2, 1080, 1920)).toEqual({ x: 479, y: 799, w: 122, h: 322 });
    // a pose moves and scales about the unit's place
    const posed = unitCorners({ ...I, e: 540, f: 960 }, u, { dx: 1, dy: 0.5, scale: 2 }, px, 0);
    expect(posed[0]).toEqual({ x: 540 + 100 - 100, y: 960 + 50 - 300 });
    // a title turned by 90° (the frame's x follows the block's y)
    const turned = unitCorners({ a: 0, b: 1, c: -1, d: 0, e: 540, f: 960 }, u, { dx: 0, dy: 0, scale: 1 }, px, 0);
    expect(deviceBox(turned, 0, 1080, 1920)).toEqual({ x: 390, y: 910, w: 300, h: 100 });
    // cut to the frame, and nothing when it is all outside
    expect(deviceBox([{ x: -40, y: -40 }, { x: 20, y: 30 }], 5, 1080, 1920)).toEqual({ x: 0, y: 0, w: 25, h: 35 });
    expect(deviceBox([{ x: 2000, y: 10 }, { x: 2100, y: 30 }], 5, 1080, 1920)).toBeNull();
    expect(deviceBox([], 5, 1080, 1920)).toBeNull();
    expect(deviceBox([{ x: Number.NaN, y: 1 }], 5, 1080, 1920)).toBeNull();
  });
});

describe('tracking and outlines', () => {
  it('space between letters is tracking × font size, and 0 for a paragraph with Arabic script (its letters join)', () => {
    expect(paragraphSpacing('שלום עולם', 0.25, 96)).toBe(24);
    expect(paragraphSpacing('Hello', -0.05, 100)).toBeCloseTo(-5, 12);
    expect(paragraphSpacing('مرحبا بالعالم', 0.25, 96)).toBe(0);
    expect(paragraphSpacing('שלום مرحبا', 0.25, 96)).toBe(0); // any Arabic letter in the paragraph
    expect(paragraphSpacing('Salam ﻼ', 0.25, 96)).toBe(0); // presentation forms too
    expect(paragraphSpacing('שלום', null, 96)).toBe(0);
    expect(paragraphSpacing('שלום', 0, 96)).toBe(0);
  });
  it('the second outline lies outside the first: its line is 2·px·(strokeFrac + widthFrac) wide', () => {
    expect(outlineWidths({ stroke: '#E0218A', strokeFrac: 0.08, stroke2: { color: '#111111', widthFrac: 0.08 } }, 100)).toEqual({ stroke: 16, total: 32 });
    expect(outlineWidths({ stroke: null, strokeFrac: 0.08, stroke2: { color: '#111111', widthFrac: 0.05 } }, 100)).toEqual({ stroke: 0, total: 10 }); // no first outline: the second starts at the letters
    expect(outlineWidths({ stroke: '#000000', strokeFrac: 0.1, stroke2: null }, 100)).toEqual({ stroke: 20, total: 20 });
  });
});
