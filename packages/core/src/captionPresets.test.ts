import { describe, expect, it } from 'vitest';
import { CAPTION_PRESETS, CaptionStyleSchema, DEFAULT_CAPTION_STYLE } from './schema.ts';
import { FONT_CATALOG } from './fonts.ts';
import { CAPTION_LOOKS as LOOKS, CAPTION_LOOK_IDS as IDS, findCaptionLook as find } from './captionPresets.ts';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const alpha = (hex: string) => (hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1);

describe('caption looks', () => {
  it('has at least 30 distinct, kebab-case looks with names and hints in both languages', () => {
    expect(LOOKS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length);
    expect(IDS).toEqual(LOOKS.map((l) => l.id));
    for (const l of LOOKS) {
      expect(l.id).toMatch(/^caption\.[a-z0-9]+(-[a-z0-9]+)*$/);
      for (const t of [l.name.he, l.name.en, l.hint.he, l.hint.en]) expect(t.trim().length).toBeGreaterThan(0);
      expect(l.name.he).toMatch(/[֐-׿]/);
      expect(find(l.id)).toBe(l);
    }
    expect(find('caption.nope')).toBeUndefined();
  });
  it('every style is valid alone and merged over the default, with the required fields and no direction or margin', () => {
    for (const l of LOOKS) {
      expect(() => CaptionStyleSchema.partial().strict().parse(l.style), l.id).not.toThrow();
      expect(() => CaptionStyleSchema.parse({ ...DEFAULT_CAPTION_STYLE, ...l.style }), l.id).not.toThrow();
      for (const k of ['preset', 'fontFamily', 'fontWeight', 'sizeFrac', 'color', 'highlightColor', 'background', 'stroke', 'strokeFrac', 'position', 'maxLines', 'maxCharsPerLine'])
        expect(l.style, `${l.id}.${k}`).toHaveProperty(k);
      expect(l.style).not.toHaveProperty('direction');
      expect(l.style).not.toHaveProperty('marginFrac');
    }
  });
  it('uses only bundled fonts and weights', () => {
    for (const l of LOOKS) {
      const f = FONT_CATALOG.find((x) => x.family === l.style.fontFamily);
      expect(f, l.id).toBeTruthy();
      expect(f!.weights, l.id).toContain(l.style.fontWeight);
    }
  });
  it('is readable: contrast of text against its plate or outline, and a visible highlight', () => {
    for (const l of LOOKS) {
      const s = { ...DEFAULT_CAPTION_STYLE, ...l.style } as typeof DEFAULT_CAPTION_STYLE & { background: string | null; stroke: string | null };
      const plate = s.background && alpha(s.background) >= 0.6 ? s.background.slice(0, 7) : null;
      expect(plate || s.stroke, `${l.id} needs a plate or outline`).toBeTruthy();
      expect(contrast(s.color, plate ?? s.stroke!), l.id).toBeGreaterThanOrEqual(4.5);
      if (s.preset !== 'classic') expect(contrast(s.color, s.highlightColor), `${l.id} highlight`).toBeGreaterThanOrEqual(1.5);
    }
  });
  it('flags word timing exactly when the look needs it', () => {
    for (const l of LOOKS) {
      const expected = l.style.preset !== 'classic' || (l.style.wordEntrance !== undefined && l.style.wordEntrance !== 'none');
      expect(l.needsWordTiming, l.id).toBe(expected);
    }
  });
  it('no two looks are the same, and every behaviour has at least two looks', () => {
    expect(new Set(LOOKS.map((l) => JSON.stringify(Object.entries(l.style).sort()))).size).toBe(LOOKS.length);
    for (const p of CAPTION_PRESETS) expect(LOOKS.filter((l) => l.style.preset === p).length, p).toBeGreaterThanOrEqual(2);
  });
});
