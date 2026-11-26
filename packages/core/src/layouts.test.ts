import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MaskSchema } from './effects.ts';
import { TransformSchema } from './schema.ts';
import { LAYOUTS, LAYOUT_IDS, findLayout, layoutPlacements, visibleRect, type LayoutDef } from './layouts.ts';

const TOL = 0.5;
const FRAMES = [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1080, height: 1080 }];
const PICS = [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 640, height: 480 }, { width: 1000, height: 1000 }];
const FITS = ['contain', 'cover'];
const near = (a: number, b: number) => Math.abs(a - b) <= TOL;

function checkOne(l: LayoutDef, frame: { width: number; height: number }, fit: string, pics: { width: number; height: number }[]) {
  const input = { frame, fit, pictures: pics };
  const out = layoutPlacements(l.id, input);
  expect(out).toHaveLength(l.count);
  out.forEach((p, i) => {
    expect(TransformSchema.partial().safeParse(p.transform).success).toBe(true);
    if (p.mask) expect(MaskSchema.safeParse(p.mask).success).toBe(true);
    const c = l.slots[i]!;
    const cell = { x: c.x * frame.width, y: c.y * frame.height, w: c.w * frame.width, h: c.h * frame.height };
    const v = visibleRect(input, pics[i]!, p);
    if (l.fill) {
      expect([near(v.x, cell.x), near(v.y, cell.y), near(v.w, cell.w), near(v.h, cell.h)]).toEqual([true, true, true, true]);
      // centre of the picture is shown: visible rect centred on the layer centre
      expect(near(v.x + v.w / 2, frame.width / 2 + p.transform.x * frame.width)).toBe(true);
    } else {
      expect(v.x >= cell.x - TOL && v.y >= cell.y - TOL && v.x + v.w <= cell.x + cell.w + TOL && v.y + v.h <= cell.y + cell.h + TOL).toBe(true);
      expect((near(v.w, cell.w) && v.h <= cell.h + TOL) || (near(v.h, cell.h) && v.w <= cell.w + TOL)).toBe(true);
      expect(p.mask).toBeNull();
    }
  });
}

describe('layout registry', () => {
  it('is well formed', () => {
    expect(LAYOUTS.length).toBeGreaterThanOrEqual(14);
    expect(new Set(LAYOUT_IDS).size).toBe(LAYOUTS.length);
    for (const l of LAYOUTS) {
      expect(l.id).toMatch(/^layout\.[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(l.name.he.length).toBeGreaterThan(0);
      expect(l.name.en.length).toBeGreaterThan(0);
      expect(l.slots).toHaveLength(l.count);
      for (const s of l.slots) {
        expect(s.x).toBeGreaterThanOrEqual(0); expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(1 + 1e-12); expect(s.y + s.h).toBeLessThanOrEqual(1 + 1e-12);
        expect(s.w).toBeGreaterThan(0); expect(s.h).toBeGreaterThan(0);
      }
      expect(findLayout(l.id)).toBe(l);
    }
    expect(findLayout('nope')).toBeUndefined();
  });
  it('split and grid cells do not overlap and tile the frame with the gap', () => {
    for (const l of LAYOUTS.filter((x) => !x.id.startsWith('layout.pip-'))) {
      for (let i = 0; i < l.slots.length; i++) for (let j = i + 1; j < l.slots.length; j++) {
        const a = l.slots[i]!, b = l.slots[j]!;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 1e-9 && oy > 1e-9).toBe(false);
      }
      expect(Math.min(...l.slots.map((s) => s.x))).toBeCloseTo(0, 9);
      expect(Math.min(...l.slots.map((s) => s.y))).toBeCloseTo(0, 9);
      expect(Math.max(...l.slots.map((s) => s.x + s.w))).toBeCloseTo(1, 9);
      expect(Math.max(...l.slots.map((s) => s.y + s.h))).toBeCloseTo(1, 9);
      // every uncovered point lies within one gap of a cell
      for (let u = 0; u <= 100; u++) for (let v = 0; v <= 100; v++) {
        const px = u / 100, py = v / 100;
        const d = Math.min(...l.slots.map((s) => Math.hypot(Math.max(s.x - px, 0, px - s.x - s.w), Math.max(s.y - py, 0, py - s.y - s.h))));
        expect(d).toBeLessThanOrEqual(l.gap + 1e-9);
      }
    }
  });
  it('picture-in-picture windows have rounded corners', () => {
    for (const l of LAYOUTS.filter((x) => x.id.startsWith('layout.pip-'))) {
      const out = layoutPlacements(l.id, { frame: FRAMES[0]!, fit: 'contain', pictures: [PICS[0]!, PICS[0]!] });
      expect(out[1]!.mask!.radius).toBeGreaterThan(0);
    }
  });
});

describe('layout geometry', () => {
  it('matches the cell for every layout, frame, picture size and fit', () => {
    for (const l of LAYOUTS) for (const frame of FRAMES) for (const fit of FITS) {
      for (const p of PICS) checkOne(l, frame, fit, Array(l.count).fill(p));
      checkOne(l, frame, fit, Array.from({ length: l.count }, (_, i) => PICS[i % PICS.length]!));
    }
  });
  it('property: random picture sizes', () => {
    const side = fc.integer({ min: 16, max: 8000 });
    const pic = fc.tuple(side, side).filter(([w, h]) => w / h >= 0.25 && w / h <= 4).map(([width, height]) => ({ width, height }));
    fc.assert(fc.property(fc.constantFrom(...LAYOUTS), fc.constantFrom(...FRAMES), fc.constantFrom(...FITS), fc.array(pic, { minLength: 9, maxLength: 9 }), (l, frame, fit, pics) => {
      checkOne(l, frame, fit, pics.slice(0, l.count));
    }), { numRuns: 300 });
  });
  it('pip window is not cropped for a picture of the frame aspect', () => {
    const out = layoutPlacements('layout.pip-top-left', { frame: FRAMES[0]!, fit: 'contain', pictures: [PICS[0]!, PICS[0]!] });
    expect(out[1]!.mask!.width).toBeCloseTo(1, 9);
    expect(out[1]!.mask!.height).toBeCloseTo(1, 9);
  });
});

describe('errors', () => {
  it('throws RangeError for bad input', () => {
    const frame = FRAMES[0]!;
    expect(() => layoutPlacements('layout.side-by-side', { frame, fit: 'cover', pictures: [PICS[0]!] })).toThrow(RangeError);
    expect(() => layoutPlacements('layout.side-by-side', { frame, fit: 'cover', pictures: [PICS[0]!, { width: 0, height: 5 }] })).toThrow(RangeError);
    expect(() => layoutPlacements('layout.side-by-side', { frame, fit: 'cover', pictures: [PICS[0]!, { width: 5, height: -1 }] })).toThrow(RangeError);
    expect(() => layoutPlacements('layout.side-by-side', { frame, fit: 'cover', pictures: [PICS[0]!, { width: NaN, height: 5 }] })).toThrow(RangeError);
    expect(() => layoutPlacements('layout.side-by-side', { frame, fit: 'stretch', pictures: [PICS[0]!, PICS[0]!] })).toThrow(RangeError);
  });
});

// The renderer's per-layer rectangle (compositor2d.ts drawGraph/withTransform) is not exported as a function, and
// @pulseframe/engine is not a dependency of core, so there is no independent check against it here.
