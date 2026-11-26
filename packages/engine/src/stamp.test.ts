import { describe, expect, it } from 'vitest';
import { findEffect } from '@pulseframe/core';
import { DIGIT_SEGMENTS, STAMP_GEOMETRY, STAMP_TEXT, glyph, stampPolygons } from './stamp.ts';

const area = (poly: { x: number; y: number }[]) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]!; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
const bounds = (polys: { x: number; y: number }[][]) => {
  const xs = polys.flat().map((p) => p.x), ys = polys.flat().map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

describe('date stamp glyphs (seven segments, no font)', () => {
  it('segment table for 0–9 is the standard seven-segment one', () => {
    expect(DIGIT_SEGMENTS).toEqual({ '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg' });
    for (const [d, segs] of Object.entries(DIGIT_SEGMENTS)) {
      const g = glyph(d);
      expect(g.polygons).toHaveLength(segs.length);
      for (const poly of g.polygons) expect(poly).toHaveLength(6); // hexagonal bars
    }
    // bars do not overlap and sit inside the digit box
    const eight = glyph('8').polygons;
    const b = bounds(eight);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(STAMP_GEOMETRY.width + 1e-12);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxY).toBeLessThanOrEqual(1 + 1e-12);
    // middle bar of 8 is exactly the lone bar of '-' in height
    const mid = eight[6]!, dash = glyph('-').polygons[0]!;
    expect(Math.min(...mid.map((p) => p.y))).toBeCloseTo(Math.min(...dash.map((p) => p.y)), 12);
  });

  it('separators: . : \' / - and space', () => {
    expect(glyph('.').polygons).toHaveLength(1);
    expect(glyph(':').polygons).toHaveLength(2);
    expect(glyph("'").polygons).toHaveLength(1);
    expect(glyph('/').polygons).toHaveLength(1);
    expect(glyph('-').polygons).toHaveLength(1);
    expect(glyph(' ').polygons).toHaveLength(0);
    expect(glyph(' ').advance).toBeGreaterThan(0);
    // the dot sits on the baseline, the apostrophe at the top, the colon's dots one above the other
    expect(Math.max(...glyph('.').polygons[0]!.map((p) => p.y))).toBeCloseTo(1, 12);
    expect(Math.min(...glyph("'").polygons[0]!.map((p) => p.y))).toBeCloseTo(0, 12);
    const [c1, c2] = glyph(':').polygons;
    expect(Math.max(...c1!.map((p) => p.y))).toBeLessThan(Math.min(...c2!.map((p) => p.y)));
  });

  it('refuses characters outside digits, space and . : \' / - (the schema of the effect refuses them too)', () => {
    for (const bad of ['12a', 'שלום', '1,2', '12:34!', '0'.repeat(21), '١٢']) {
      expect(STAMP_TEXT.test(bad)).toBe(false);
      expect(() => stampPolygons(bad, 40, 'bottom-right', 1280, 720)).toThrow(RangeError);
      expect(findEffect('stylize.date-stamp')!.params.safeParse({ text: bad }).success).toBe(false);
    }
    expect(() => glyph('x')).toThrow(RangeError);
    for (const good of ["'05 7 14", '12:34', '2026/11/17', '17.11.26', '-', '', '   ']) {
      expect(STAMP_TEXT.test(good)).toBe(true);
      expect(findEffect('stylize.date-stamp')!.params.safeParse({ text: good }).success).toBe(true);
    }
    expect(stampPolygons('', 40, 'bottom-right', 1280, 720)).toEqual([]);
    expect(stampPolygons('   ', 40, 'bottom-right', 1280, 720)).toEqual([]);
  });

  it('lays out left to right in the corner, slanted 8°, inside the margins, at the asked height', () => {
    const h = 0.045 * 720;
    const polys = stampPolygons("'05 7 14", h, 'bottom-right', 1280, 720);
    expect(polys).toHaveLength(1 + 6 + 5 + 3 + 2 + 4); // ' 0 5 7 1 4
    const b = bounds(polys), m = STAMP_GEOMETRY.margin * h;
    expect(b.maxX).toBeCloseTo(1280 - m, 9);
    expect(b.maxY).toBeCloseTo(720 - m, 9);
    expect(b.maxY - b.minY).toBeCloseTo(h, 9);
    // left to right: the first glyph (the apostrophe) is the leftmost
    expect(Math.min(...polys[0]!.map((p) => p.x))).toBeCloseTo(b.minX, 9);
    // slant: the top of a vertical bar lies tan 8°·(its height) to the right of its bottom
    const f = stampPolygons('1', h, 'top-left', 1280, 720)[0]!; // segment b
    const top = f[0]!, bottom = f[3]!;
    expect((top.x - bottom.x) / (bottom.y - top.y)).toBeCloseTo(Math.tan((8 * Math.PI) / 180), 9);
    const tl = bounds(stampPolygons('12:34', h, 'top-left', 1280, 720));
    expect(tl.minX).toBeCloseTo(m, 9);
    expect(tl.minY).toBeCloseTo(m, 9);
    const bl = bounds(stampPolygons('12:34', h, 'bottom-left', 1280, 720)), tr = bounds(stampPolygons('12:34', h, 'top-right', 1280, 720));
    expect(bl.minX).toBeCloseTo(m, 9); expect(bl.maxY).toBeCloseTo(720 - m, 9);
    expect(tr.maxX).toBeCloseTo(1280 - m, 9); expect(tr.minY).toBeCloseTo(m, 9);
    expect(polys.every((p) => area(p) > 0)).toBe(true);
  });

  it('a stamp too wide for the box is made smaller until it fits (a portrait frame at the largest size)', () => {
    const W = 720, H = 1280, h = 0.12 * H;
    const polys = stampPolygons('2026/11/17 12:34:56', h, 'bottom-right', W, H);
    const b = bounds(polys);
    expect(b.minX).toBeGreaterThan(0);
    expect(b.maxX).toBeLessThan(W);
    expect(b.maxY - b.minY).toBeLessThan(h);
    // and a stamp that fits is not changed
    expect(bounds(stampPolygons('12', h, 'bottom-right', W, H)).maxY - bounds(stampPolygons('12', h, 'bottom-right', W, H)).minY).toBeCloseTo(h, 9);
  });
});
