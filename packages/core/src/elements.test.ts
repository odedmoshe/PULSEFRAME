import { describe, expect, it } from 'vitest';
import { ELEMENT_CATEGORIES, ELEMENT_IDS, ELEMENTS, elementSvg } from './elements.ts';

const ALLOWED_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const ALLOWED_ATTRS = new Set(['xmlns', 'viewBox', 'width', 'height', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'opacity', 'transform']);
const RED = '#FF0000', BLUE = '#0000FF';

/** Tag-stack check: every open tag is closed in order; returns the tags seen. */
function check(svg: string): { tags: string[]; attrs: string[]; paints: string[] } {
  const stack: string[] = []; const tags: string[] = []; const attrs: string[] = []; const paints: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, name, rest, selfClose] = m;
    tags.push(name!);
    if (close) { expect(stack.pop()).toBe(name); continue; }
    for (const a of rest!.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) { attrs.push(a[1]!); if (a[1] === 'fill' || a[1] === 'stroke') paints.push(a[2]!); }
    if (!selfClose) stack.push(name!);
  }
  expect(stack).toEqual([]);
  return { tags, attrs, paints };
}

describe('element library', () => {
  it('has at least 120 elements and 10 per category', () => {
    expect(ELEMENTS.length).toBeGreaterThanOrEqual(120);
    expect(ELEMENT_IDS).toHaveLength(ELEMENTS.length);
    for (const cat of ELEMENT_CATEGORIES) expect(ELEMENTS.filter((e) => e.category === cat).length).toBeGreaterThanOrEqual(10);
    for (const e of ELEMENTS) expect(ELEMENT_CATEGORIES).toContain(e.category);
  });
  it('ids are unique, well formed and match their category', () => {
    expect(new Set(ELEMENT_IDS).size).toBe(ELEMENT_IDS.length);
    for (const e of ELEMENTS) {
      expect(e.id).toMatch(/^element\.[a-z]+\.[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.id.split('.')[1]).toBe(e.category);
      expect(e.version).toBeGreaterThanOrEqual(1);
      expect([1, 2]).toContain(e.colors);
    }
  });
  it('names are present in both languages', () => {
    for (const e of ELEMENTS) { expect(e.name.he).toMatch(/[א-ת]/); expect(e.name.en.trim().length).toBeGreaterThan(0); }
  });
  it('every SVG is well formed, uses only allowed markup and paints only with the chosen colours', () => {
    for (const e of ELEMENTS) {
      const svg = elementSvg(e.id, { color: RED, color2: BLUE });
      expect(svg.startsWith('<svg'), e.id).toBe(true);
      expect(svg.endsWith('</svg>'), e.id).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain(`viewBox="0 0 ${e.width} ${e.height}"`);
      expect(svg).toContain(`width="${e.width}" height="${e.height}"`);
      const { tags, attrs, paints } = check(svg);
      for (const t of tags) expect(ALLOWED_TAGS.has(t), `${e.id} tag ${t}`).toBe(true);
      for (const a of attrs) expect(ALLOWED_ATTRS.has(a), `${e.id} attr ${a}`).toBe(true);
      for (const p of paints) expect(['none', RED, BLUE], `${e.id} paint ${p}`).toContain(p);
      for (const re of [/<text/i, /<image/i, /<use/i, /<style/i, /<script/i, /href/i, /url\(/i, / on[a-z]+=/i, /foreignObject/i, /filter/i, /gradient/i]) expect(svg, `${e.id} ${re}`).not.toMatch(re);
      for (const m of svg.matchAll(/-?\d+\.\d+/g)) expect(m[0].split('.')[1]!.length, `${e.id} ${m[0]}`).toBeLessThanOrEqual(2);
      expect(svg).toContain(RED);
      if (e.colors === 2) expect(svg, e.id).toContain(BLUE); else expect(svg, e.id).not.toContain(BLUE);
      expect(Buffer.byteLength(svg), e.id).toBeLessThanOrEqual(6 * 1024);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
  it('is deterministic, defaults the colours, and no two elements share markup', () => {
    for (const e of ELEMENTS) expect(elementSvg(e.id, { color: RED })).toBe(elementSvg(e.id, { color: RED }));
    const a = elementSvg(ELEMENTS[0]!.id);
    expect(a).toContain('#FFFFFF');
    expect(new Set(ELEMENTS.map((e) => elementSvg(e.id))).size).toBe(ELEMENTS.length);
    expect(elementSvg('element.symbol.circle-check')).toContain('#3DE0C8');
  });
  it('rejects unknown ids and bad colours with RangeError', () => {
    expect(() => elementSvg('element.arrow.nope')).toThrow(RangeError);
    expect(() => elementSvg(ELEMENT_IDS[0], { color: 'red' })).toThrow(RangeError);
    expect(() => elementSvg(ELEMENT_IDS[0], { color: '#FFF' })).toThrow(RangeError);
    expect(() => elementSvg(ELEMENT_IDS[0], { color2: '#GGGGGG' })).toThrow(RangeError);
    expect(() => elementSvg(ELEMENT_IDS[0], { color: '#FFFFFF" onload="x' })).toThrow(RangeError);
  });
});
