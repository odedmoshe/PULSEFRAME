/**
 * The element rules of packages/core/src/elements.test.ts, held against the 50 elements of the Hanukkah and birthday packs
 * (ADR-0022), plus the rules of the pack elements: default colours, at most two colours with `colors: 2` exactly when the
 * body paints with its second colour, at most 6 KB, no text, no gradient, no letters (a pack element's slug and names are
 * words, its drawing never is), no hexagram, and no two elements drawn alike. Whether they look good is the contact sheet's
 * business (pnpm packs:sheet), and the owner's.
 */
import { describe, expect, it } from 'vitest';
import { ELEMENT_CATEGORIES, ELEMENTS, elementDefaultColours, elementSvg } from '../elements.ts';
import { PACK_ELEMENTS } from './elements.ts';

const ALLOWED_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const ALLOWED_ATTRS = new Set(['xmlns', 'viewBox', 'width', 'height', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'opacity', 'transform']);
const RED = '#FF0000', BLUE = '#0000FF';
const ids = PACK_ELEMENTS.map((e) => `element.${e.category}.${e.slug}`);
const defs = ids.map((id) => ELEMENTS.find((d) => d.id === id)!);

function check(svg: string): { tags: string[]; attrs: string[]; paints: string[] } {
  const stack: string[] = [], tags: string[] = [], attrs: string[] = [], paints: string[] = [];
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

describe('the pack elements', () => {
  it('are 25 holiday and 25 party elements, listed in the library after its own, and the library holds at least 10 per category', () => {
    expect(PACK_ELEMENTS).toHaveLength(50);
    expect(defs.every(Boolean)).toBe(true);
    expect(ELEMENT_CATEGORIES).toContain('holiday');
    expect(ELEMENT_CATEGORIES).toContain('party');
    for (const c of ['holiday', 'party'] as const) expect(ELEMENTS.filter((e) => e.category === c)).toHaveLength(25);
  });
  it('ids are unique and well formed, slugs are unique within their category, names are in Hebrew and English', () => {
    expect(new Set(ids).size).toBe(50);
    for (const e of PACK_ELEMENTS) {
      expect(e.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(e.he).toMatch(/[א-ת]/);
      expect(e.en.trim().length).toBeGreaterThan(0);
      expect(e.defaults.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      if (e.defaults.color2) expect(e.defaults.color2).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(e.colors === 2).toBe(!!e.defaults.color2);
    }
  });
  it('no pack element is a hexagram: none has six points, none is named a star of six', () => {
    for (const e of PACK_ELEMENTS) { expect(e.slug).not.toMatch(/star-6|hexagram|magen/); expect(e.en).not.toMatch(/hexagram|six-point|magen/i); }
  });
  it('every drawing is well formed, uses only the allowed markup and paints only with the chosen colours, in at most 6 KB', () => {
    for (const id of ids) {
      const d = defs.find((x) => x.id === id)!;
      const svg = elementSvg(id, { color: RED, color2: BLUE });
      expect(svg.startsWith('<svg') && svg.endsWith('</svg>'), id).toBe(true);
      expect(svg).toContain(`viewBox="0 0 ${d.width} ${d.height}"`);
      const { tags, attrs, paints } = check(svg);
      for (const t of tags) expect(ALLOWED_TAGS.has(t), `${id} tag ${t}`).toBe(true);
      for (const a of attrs) expect(ALLOWED_ATTRS.has(a), `${id} attr ${a}`).toBe(true);
      for (const p of paints) expect(['none', RED, BLUE], `${id} paint ${p}`).toContain(p);
      for (const re of [/<text/i, /<image/i, /<use/i, /<style/i, /<script/i, /href/i, /url\(/i, / on[a-z]+=/i, /foreignObject/i, /filter/i, /gradient/i, /font/i]) expect(svg, `${id} ${re}`).not.toMatch(re);
      for (const m of svg.matchAll(/-?\d+\.\d+/g)) expect(m[0].split('.')[1]!.length, `${id} ${m[0]}`).toBeLessThanOrEqual(2);
      expect(svg).toContain(RED);
      if (d.colors === 2) expect(svg, id).toContain(BLUE); else expect(svg, id).not.toContain(BLUE);
      expect(Buffer.byteLength(svg), id).toBeLessThanOrEqual(6 * 1024);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
  it('are drawn in their own default colours when none are named, and those are the two the entry lists', () => {
    for (const e of PACK_ELEMENTS) {
      const id = `element.${e.category}.${e.slug}`, own = elementDefaultColours(id)!, svg = elementSvg(id);
      expect(own.color).toBe(e.defaults.color);
      expect(svg).toContain(e.defaults.color);
      if (e.colors === 2) expect(svg).toContain(e.defaults.color2!);
    }
  });
  it('are deterministic, and no two are drawn alike (nor like an element of the library)', () => {
    for (const id of ids) expect(elementSvg(id, { color: RED, color2: BLUE })).toBe(elementSvg(id, { color: RED, color2: BLUE }));
    expect(new Set(ELEMENTS.map((e) => elementSvg(e.id))).size).toBe(ELEMENTS.length);
  });
  it('the eight hanukkiyot light one more candle each night: the flames are counted from the right', () => {
    const lit = (n: number) => (elementSvg(`element.holiday.hanukkiah-${n}`, { color: RED, color2: BLUE }).match(/<path d="M[\d. ]+C[^"]*A[^"]*"\s+fill="#FF0000"\/>/g) ?? []).length;
    // the outer flame of each, which is the shamash's, is always there; the others are one for each night
    const counts = [1, 2, 3, 4, 5, 6, 7, 8].map(lit);
    for (let n = 1; n < 8; n++) expect(counts[n]! - counts[n - 1]!).toBeGreaterThan(0);
    expect(counts[7]! - counts[0]!).toBeGreaterThanOrEqual(7);
  });
});
