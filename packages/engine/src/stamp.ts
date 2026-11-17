/**
 * stylize.date-stamp: seven-segment glyphs as polygons (no font, so every machine draws the same shapes), drawn by look.ts in
 * the layer's own space with a soft glow (ADR-0011 wave 1). Always laid out left to right, whatever the document's direction.
 *
 * A digit is h tall and 0.52·h wide before the slant; its bars are hexagons 0.14·h thick with pointed ends, a small gap
 * between neighbours, and the whole glyph is slanted 8° (the top leans right). Separators: '.' a square dot on the baseline,
 * ':' two dots, "'" a short bar at the top (the year in '05), '/' a slanted bar, '-' the middle bar, ' ' a gap.
 */
type Pt = { x: number; y: number };
type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** The characters a stamp may hold; the same pattern as the effect's `text` parameter (core effects.ts). */
export const STAMP_TEXT = /^[0-9 .:'\/-]{0,20}$/;
/** The lit segments of each digit (a top, b upper right, c lower right, d bottom, e lower left, f upper left, g middle). */
export const DIGIT_SEGMENTS: Readonly<Record<string, string>> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
};
/** Proportions, in units of the digit height. */
export const STAMP_GEOMETRY = { width: 0.52, thickness: 0.14, gap: 0.025, slantDegrees: 8, margin: 0.6 } as const;
const ADVANCE: Record<string, number> = { digit: 0.72, '.': 0.3, ':': 0.3, "'": 0.28, '/': 0.5, '-': 0.6, ' ': 0.4 };

/** Horizontal bar with pointed ends from x0 to x1 at height y (thickness t). */
const hbar = (x0: number, x1: number, y: number, t: number): Pt[] => [
  { x: x0, y }, { x: x0 + t / 2, y: y - t / 2 }, { x: x1 - t / 2, y: y - t / 2 }, { x: x1, y }, { x: x1 - t / 2, y: y + t / 2 }, { x: x0 + t / 2, y: y + t / 2 },
];
/** Vertical bar with pointed ends from y0 to y1 at x (thickness t). */
const vbar = (x: number, y0: number, y1: number, t: number): Pt[] => [
  { x, y: y0 }, { x: x + t / 2, y: y0 + t / 2 }, { x: x + t / 2, y: y1 - t / 2 }, { x, y: y1 }, { x: x - t / 2, y: y1 - t / 2 }, { x: x - t / 2, y: y0 + t / 2 },
];
const square = (x: number, y: number, s: number): Pt[] => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];

/** The polygons of one glyph in a box of height 1 with its top-left at (0, 0), before the slant, and its advance. */
export function glyph(ch: string): { polygons: Pt[][]; advance: number } {
  const { width: w, thickness: t, gap: g } = STAMP_GEOMETRY;
  const segs = DIGIT_SEGMENTS[ch];
  if (segs !== undefined) {
    const x0 = t / 2 + g, x1 = w - t / 2 - g, top = t / 2, mid = 0.5, bottom = 1 - t / 2;
    const all: Record<string, Pt[]> = {
      a: hbar(x0, x1, top, t), g: hbar(x0, x1, mid, t), d: hbar(x0, x1, bottom, t),
      f: vbar(t / 2, top + g, mid - g, t), b: vbar(w - t / 2, top + g, mid - g, t),
      e: vbar(t / 2, mid + g, bottom - g, t), c: vbar(w - t / 2, mid + g, bottom - g, t),
    };
    return { polygons: [...segs].map((s) => all[s]!), advance: ADVANCE.digit! };
  }
  switch (ch) {
    case '.': return { polygons: [square(0.05, 1 - t, t)], advance: ADVANCE['.']! };
    case ':': return { polygons: [square(0.05, 0.3 - t / 2, t), square(0.05, 0.7 - t / 2, t)], advance: ADVANCE[':']! };
    case "'": return { polygons: [vbar(0.05 + t / 2, 0, 0.32, t)], advance: ADVANCE["'"]! };
    case '/': return { polygons: [[{ x: 0.03, y: 1 }, { x: 0.03 + t, y: 1 }, { x: 0.36 + t, y: 0 }, { x: 0.36, y: 0 }]], advance: ADVANCE['/']! };
    case '-': return { polygons: [hbar(0.05, 0.45, 0.5, t)], advance: ADVANCE['-']! };
    case ' ': return { polygons: [], advance: ADVANCE[' ']! };
    default: throw new RangeError(`date stamp: "${ch}" cannot be drawn; digits, space and . : ' / - only`);
  }
}

/**
 * Polygons (pixels) of a seven-segment stamp in a corner of a layer box of width×height, with (0, 0) at the box's top-left
 * corner. `sizePx` is the digit height; a stamp too wide for the box is made smaller until it fits inside the margins.
 * Text outside STAMP_TEXT is refused (RangeError): the effect's schema refuses it before it can reach a frame.
 */
export function stampPolygons(text: string, sizePx: number, corner: Corner, width: number, height: number): { x: number; y: number }[][] {
  if (!STAMP_TEXT.test(text)) throw new RangeError(`date stamp: "${text}" holds characters other than digits, space and . : ' / - (at most 20)`);
  if (!(sizePx > 0) || !(width > 0) || !(height > 0)) return [];
  const slant = Math.tan((STAMP_GEOMETRY.slantDegrees * Math.PI) / 180);
  // lay out at height 1, left to right, then slant: x' = x + (1 − y)·tan 8° (the baseline stays put)
  const polys: Pt[][] = [];
  let pen = 0;
  for (const ch of text) {
    const gl = glyph(ch);
    for (const poly of gl.polygons) polys.push(poly.map((q) => ({ x: pen + q.x + (1 - q.y) * slant, y: q.y })));
    pen += gl.advance;
  }
  if (!polys.length) return [];
  let minX = Infinity, maxX = -Infinity;
  for (const poly of polys) for (const q of poly) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); }
  let h = sizePx;
  const m = () => STAMP_GEOMETRY.margin * h;
  const fit = Math.min(1, (width - 2 * m()) / ((maxX - minX) * h), (height - 2 * m()) / h);
  if (fit < 1) h *= Math.max(fit, 0);
  if (!(h > 0)) return [];
  const right = corner.endsWith('right'), bottom = corner.startsWith('bottom');
  const ox = right ? width - m() - maxX * h : m() - minX * h;
  const oy = bottom ? height - m() - h : m();
  return polys.map((poly) => poly.map((q) => ({ x: ox + q.x * h, y: oy + q.y * h })));
}
