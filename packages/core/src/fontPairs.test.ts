import { describe, expect, it } from 'vitest';
import { FONT_CATALOG, findFont, resolveWeight } from './fonts.ts';
import { FONT_PAIRS } from './fontPairs.ts';

describe('font pairs', () => {
  it('has eight pairs', () => expect(FONT_PAIRS).toHaveLength(8));
  it('every family and weight is in the catalogue and the weight is bundled as it stands', () => {
    for (const p of FONT_PAIRS) {
      const h = findFont(p.heading), b = findFont(p.body);
      expect(h, p.heading).toBeDefined();
      expect(b, p.body).toBeDefined();
      expect(h!.weights).toContain(p.headingWeight);
      expect(b!.weights).toContain(p.bodyWeight);
      expect(resolveWeight(h!, p.headingWeight)).toBe(p.headingWeight);
      expect(h!.hebrew && b!.hebrew).toBe(true);
    }
  });
  it('every note has Hebrew (with Hebrew letters) and English (with Latin letters), and no emoji', () => {
    for (const p of FONT_PAIRS) {
      expect(p.note.he).toMatch(/[א-ת]/);
      expect(p.note.en).toMatch(/[A-Za-z]/);
      expect(p.note.he + p.note.en).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(p.note.he.length).toBeGreaterThan(8);
    }
  });
  it('a heading is not its own body and a pair is listed once', () => {
    for (const p of FONT_PAIRS) expect(p.heading).not.toBe(p.body);
    expect(new Set(FONT_PAIRS.map((p) => `${p.heading}/${p.body}`)).size).toBe(FONT_PAIRS.length);
  });
  it('no two loud faces are paired: the body is a sans or serif text face', () => {
    for (const p of FONT_PAIRS) expect(['sans', 'serif']).toContain(findFont(p.body)!.category);
  });
  it('the headings cover every category and use each title family at least once, so each is suggested somewhere', () => {
    const heads = new Set(FONT_PAIRS.map((p) => p.heading));
    for (const f of FONT_CATALOG.filter((x) => x.category !== 'sans')) expect(heads.has(f.family), f.family).toBe(true);
  });
});
