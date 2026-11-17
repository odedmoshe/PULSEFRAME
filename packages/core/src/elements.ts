/**
 * Original graphic elements (arrows, shapes, badges, speech bubbles, frames, bars, lines, symbols). Every one is SVG markup
 * produced by a formula in this file: no third-party artwork, no logos, no characters, no fonts, no text. The markup uses
 * only svg, g, path, rect, circle, ellipse, line, polyline, polygon, so it can be rasterised by ffmpeg's librsvg
 * and shown inline in a browser. Pure functions; the same id and options always return the same string.
 */
export type ElementCategory = 'arrow' | 'shape' | 'badge' | 'bubble' | 'frame' | 'bar' | 'line' | 'symbol';
export interface ElementDef {
  id: string;
  /**
   * Version of the element's picture as it is stored in a project (recorded in the asset's provenance). Raised whenever the bytes
   * produced for the same id, colours and size change, so pictures made by different recipes never share an identity; see
   * ELEMENT_PICTURE_VERSION. Assets made earlier keep their bytes and their recorded version.
   */
  version: number;
  category: ElementCategory; name: { he: string; en: string };
  /** viewBox width and height in user units */
  width: number; height: number;
  /** how many colours the element uses (1 or 2) */
  colors: 1 | 2;
}
export interface ElementOptions {
  /** #RRGGBB */ color?: string;
  /** #RRGGBB, second colour for two-colour elements */ color2?: string;
}

// ---- number and path helpers ----
type Pt = [number, number];
const r2 = (x: number): number => { const v = Math.round(x * 100) / 100; return v === 0 ? 0 : v; };
const n = (x: number): string => String(r2(x));
const poly = (p: Pt[], close = true): string => p.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('') + (close ? 'Z' : '');
const fillD = (d: string, c: string, extra = ''): string => `<path d="${d}" fill="${c}"${extra}/>`;
const strokeD = (d: string, c: string, w: number, extra = ''): string => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const both = (d: string, fill: string, stroke: string, w: number): string => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
const disc = (cx: number, cy: number, r: number, c: string): string => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${c}"/>`;
const ringC = (cx: number, cy: number, r: number, c: string, w: number, extra = ''): string => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${c}" stroke-width="${n(w)}"${extra}/>`;
const box = (x: number, y: number, w: number, h: number, c: string, rx = 0): string => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx ? ` rx="${n(rx)}"` : ''} fill="${c}"/>`;
const boxS = (x: number, y: number, w: number, h: number, c: string, sw: number, rx = 0, extra = ''): string => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx ? ` rx="${n(rx)}"` : ''} fill="none" stroke="${c}" stroke-width="${n(sw)}"${extra}/>`;
const g = (body: string, tf: string): string => `<g transform="${tf}">${body}</g>`;
const rot = (a: number, cx = 50, cy = 50): string => `rotate(${n(a)} ${n(cx)} ${n(cy)})`;
const FLIPX = 'matrix(-1 0 0 1 100 0)', FLIPY = 'matrix(1 0 0 -1 0 100)', FLIPXY = 'matrix(-1 0 0 -1 100 100)';
const rad = (deg: number): number => (deg * Math.PI) / 180;
const polar = (cx: number, cy: number, R: number, deg: number): Pt => [cx + R * Math.cos(rad(deg)), cy + R * Math.sin(rad(deg))];
const regular = (cx: number, cy: number, R: number, k: number, start = -90): Pt[] => Array.from({ length: k }, (_, i) => polar(cx, cy, R, start + (360 * i) / k));
const star = (cx: number, cy: number, R: number, r: number, k: number, start = -90): Pt[] => Array.from({ length: 2 * k }, (_, i) => polar(cx, cy, i % 2 ? r : R, start + (180 * i) / k));
/** Closed Catmull-Rom curve through the points, as cubic Beziers. */
const smoothClosed = (p: Pt[]): string => {
  const k = p.length; let d = `M${n(p[0]![0])} ${n(p[0]![1])}`;
  for (let i = 0; i < k; i++) {
    const p0 = p[(i + k - 1) % k]!, p1 = p[i]!, p2 = p[(i + 1) % k]!, p3 = p[(i + 2) % k]!;
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d + 'Z';
};
/** Open path through the points, smoothed. */
const smoothOpen = (p: Pt[]): string => {
  const k = p.length; let d = `M${n(p[0]![0])} ${n(p[0]![1])}`;
  for (let i = 0; i < k - 1; i++) {
    const p0 = p[Math.max(0, i - 1)]!, p1 = p[i]!, p2 = p[i + 1]!, p3 = p[Math.min(k - 1, i + 2)]!;
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
};
/** Two short strokes forming an arrow head at (x, y) for travel in direction `ang` (radians). Returned as sub-paths. */
const head = (x: number, y: number, ang: number, s = 24, spread = 0.75): string => {
  const a: Pt = [x + s * Math.cos(ang + Math.PI - spread), y + s * Math.sin(ang + Math.PI - spread)];
  const b: Pt = [x + s * Math.cos(ang + Math.PI + spread), y + s * Math.sin(ang + Math.PI + spread)];
  return `M${n(a[0])} ${n(a[1])}L${n(x)} ${n(y)}L${n(b[0])} ${n(b[1])}`;
};
const sine = (x0: number, x1: number, y: number, amp: number, wl: number, steps: number): Pt[] =>
  Array.from({ length: steps + 1 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / steps; return [x, y + amp * Math.sin(((x - x0) / wl) * 2 * Math.PI)] as Pt; });
/** Rounded rectangle path, optionally with a triangular tail on one side. s1 < s2 are offsets along the edge. */
function rrPath(x: number, y: number, w: number, h: number, r: number, tail?: { side: 'top' | 'right' | 'bottom' | 'left'; s1: number; s2: number; tip: Pt }): string {
  const L = (a: number, b: number) => `L${n(a)} ${n(b)}`;
  const A = (a: number, b: number) => `A${n(r)} ${n(r)} 0 0 1 ${n(a)} ${n(b)}`;
  const t = tail; const [tx, ty] = t?.tip ?? [0, 0];
  let d = `M${n(x + r)} ${n(y)}`;
  if (t?.side === 'top') d += L(x + t.s1, y) + L(tx, ty) + L(x + t.s2, y);
  d += L(x + w - r, y) + A(x + w, y + r);
  if (t?.side === 'right') d += L(x + w, y + t.s1) + L(tx, ty) + L(x + w, y + t.s2);
  d += L(x + w, y + h - r) + A(x + w - r, y + h);
  if (t?.side === 'bottom') d += L(x + t.s2, y + h) + L(tx, ty) + L(x + t.s1, y + h);
  d += L(x + r, y + h) + A(x, y + h - r);
  if (t?.side === 'left') d += L(x, y + t.s2) + L(tx, ty) + L(x, y + t.s1);
  d += L(x, y + r) + A(x + r, y);
  return d + 'Z';
}

// ---- the table ----
/**
 * Picture version shared by every element (ElementDef.version), the same rule as the built-in sounds: a recipe that gives other
 * bytes gets a new number.
 *   1  the first PNGs: they kept the rasteriser's premultiplied colour, so partly transparent edges came out darker, and a short
 *      side of odd length was resampled by one row or column.
 *   2  straight (unpremultiplied) alpha, and the short side drawn at an even size directly (2026-11-17).
 * An element whose own drawing changes later gets a higher number of its own.
 */
export const ELEMENT_PICTURE_VERSION = 2;
type Body = (c: string, k: string) => string;
interface Entry extends ElementDef { body: Body }
const TABLE: Entry[] = [];
const add = (category: ElementCategory, slug: string, he: string, en: string, width: number, height: number, colors: 1 | 2, body: Body): void => {
  TABLE.push({ id: `element.${category}.${slug}`, version: ELEMENT_PICTURE_VERSION, category, name: { he, en }, width, height, colors, body });
};

// ================= arrows (100 x 100) =================
{
  const A = (slug: string, he: string, en: string, body: Body, colors: 1 | 2 = 1) => add('arrow', slug, he, en, 100, 100, colors, body);
  const dirs: [string, string, string, number][] = [['right', 'ימינה', 'right', 0], ['down', 'למטה', 'down', 90], ['left', 'שמאלה', 'left', 180], ['up', 'למעלה', 'up', -90]];
  const diags: [string, string, string, number][] = [['up-right', 'ימינה למעלה', 'up right', -45], ['down-right', 'ימינה למטה', 'down right', 45], ['down-left', 'שמאלה למטה', 'down left', 135], ['up-left', 'שמאלה למעלה', 'up left', -135]];
  const straight = (c: string) => strokeD(`M10 50H90${head(90, 50, 0, 26)}`, c, 8);
  for (const [s, he, en, a] of [...dirs, ...diags]) A(`straight-${s}`, `חץ ישר ${he}`, `Straight arrow ${en}`, (c) => g(straight(c), rot(a)));
  const chunky = poly([[8, 36], [54, 36], [54, 16], [94, 50], [54, 84], [54, 64], [8, 64]]);
  for (const [s, he, en, a] of dirs) A(`chunky-${s}`, `חץ עבה ${he}`, `Chunky arrow ${en}`, (c) => g(fillD(chunky, c), rot(a)));
  A('chunky-outline-right', 'חץ עבה עם מסגרת ימינה', 'Outlined chunky arrow right', (c, k) => both(chunky, c, k, 4), 2);
  A('chunky-outline-up', 'חץ עבה עם מסגרת למעלה', 'Outlined chunky arrow up', (c, k) => g(both(chunky, c, k, 4), rot(-90)), 2);
  const dbl = poly([[6, 50], [30, 24], [30, 40], [70, 40], [70, 24], [94, 50], [70, 76], [70, 60], [30, 60], [30, 76]]);
  A('double-horizontal', 'חץ כפול אופקי', 'Double arrow horizontal', (c) => fillD(dbl, c));
  A('double-vertical', 'חץ כפול אנכי', 'Double arrow vertical', (c) => g(fillD(dbl, c), rot(90)));
  const curved = (c: string) => strokeD(`M16 80Q16 24 76 24${head(80, 24, 0, 24)}`, c, 8);
  A('curved-up-right', 'חץ מעוגל למעלה ימינה', 'Curved arrow up right', curved);
  A('curved-down-right', 'חץ מעוגל למטה ימינה', 'Curved arrow down right', (c) => g(curved(c), FLIPY));
  A('curved-up-left', 'חץ מעוגל למעלה שמאלה', 'Curved arrow up left', (c) => g(curved(c), FLIPX));
  A('curved-down-left', 'חץ מעוגל למטה שמאלה', 'Curved arrow down left', (c) => g(curved(c), FLIPXY));
  const sCurve = (c: string) => strokeD(`M12 82C12 40 88 64 86 22${head(86, 18, -Math.PI / 2, 24)}`, c, 8);
  A('s-curve-up', 'חץ בצורת S למעלה', 'S-curve arrow up', sCurve);
  A('s-curve-up-left', 'חץ בצורת S למעלה שמאלה', 'S-curve arrow up left', (c) => g(sCurve(c), FLIPX));
  const bent = (c: string) => strokeD(`M14 86V30H78${head(86, 30, 0, 24)}`, c, 8);
  A('bent-up-right', 'חץ שבור למעלה ימינה', 'Bent arrow up right', bent);
  A('bent-down-right', 'חץ שבור למטה ימינה', 'Bent arrow down right', (c) => g(bent(c), FLIPY));
  A('bent-up-left', 'חץ שבור למעלה שמאלה', 'Bent arrow up left', (c) => g(bent(c), FLIPX));
  A('bent-down-left', 'חץ שבור למטה שמאלה', 'Bent arrow down left', (c) => g(bent(c), FLIPXY));
  const wob: Pt[] = Array.from({ length: 17 }, (_, i) => [10 + i * 4.9, 50 + 4 * Math.sin(i * 0.9) + 2 * Math.sin(i * 2.3 + 1)] as Pt);
  const wobble = (c: string) => strokeD(`${smoothOpen(wob)}${head(88.4, wob[16]![1], 0.12, 24)}`, c, 7);
  A('wobble-right', 'חץ ביד חופשית ימינה', 'Hand-drawn arrow right', wobble);
  A('wobble-left', 'חץ ביד חופשית שמאלה', 'Hand-drawn arrow left', (c) => g(wobble(c), FLIPX));
  A('wobble-up', 'חץ ביד חופשית למעלה', 'Hand-drawn arrow up', (c) => g(wobble(c), rot(-90)));
  A('wobble-down', 'חץ ביד חופשית למטה', 'Hand-drawn arrow down', (c) => g(wobble(c), rot(90)));
  const loop = (c: string) => { const a0 = -60, a1 = 210; const s = polar(50, 50, 34, a0), e = polar(50, 50, 34, a1); return strokeD(`M${n(s[0])} ${n(s[1])}A34 34 0 1 1 ${n(e[0])} ${n(e[1])}${head(e[0], e[1], rad(a1 + 90), 24)}`, c, 8); };
  A('circle-clockwise', 'חץ מעגלי עם כיוון השעון', 'Circle arrow clockwise', loop);
  A('circle-counterclockwise', 'חץ מעגלי נגד כיוון השעון', 'Circle arrow counterclockwise', (c) => g(loop(c), FLIPX));
  A('circle-refresh', 'חצים מתחלפים', 'Refresh arrows', (c) => {
    const arc = (a0: number, a1: number) => { const s = polar(50, 50, 34, a0), e = polar(50, 50, 34, a1); return `M${n(s[0])} ${n(s[1])}A34 34 0 0 1 ${n(e[0])} ${n(e[1])}${head(e[0], e[1], rad(a1 + 90), 22)}`; };
    return strokeD(arc(-170, -40) + arc(10, 140), c, 8);
  });
  A('u-turn', 'חץ פנייה חדה', 'U-turn arrow', (c) => strokeD(`M28 90V38A22 22 0 0 1 72 38V84${head(72, 88, Math.PI / 2, 24)}`, c, 8));
  A('u-turn-left', 'חץ פנייה חדה שמאלה', 'U-turn arrow left', (c) => g(strokeD(`M28 90V38A22 22 0 0 1 72 38V84${head(72, 88, Math.PI / 2, 24)}`, c, 8), FLIPX));
  const chev = (c: string) => strokeD('M32 14L68 50L32 86', c, 12);
  const dchev = (c: string) => strokeD('M14 16L48 50L14 84M50 16L84 50L50 84', c, 11);
  for (const [s, he, en, a] of dirs) A(`chevron-${s}`, `שברון ${he}`, `Chevron ${en}`, (c) => g(chev(c), rot(a)));
  for (const [s, he, en, a] of dirs) A(`chevron-double-${s}`, `שברון כפול ${he}`, `Double chevron ${en}`, (c) => g(dchev(c), rot(a)));
  A('chevron-solid-right', 'שברון מלא ימינה', 'Solid chevron right', (c) => fillD(poly([[24, 10], [56, 10], [90, 50], [56, 90], [24, 90], [58, 50]]), c));
  A('chevron-solid-left', 'שברון מלא שמאלה', 'Solid chevron left', (c) => g(fillD(poly([[24, 10], [56, 10], [90, 50], [56, 90], [24, 90], [58, 50]]), c), FLIPX));
}

// ================= shapes (100 x 100 unless stated) =================
{
  const S = (slug: string, he: string, en: string, body: Body, colors: 1 | 2 = 1, w = 100, h = 100) => add('shape', slug, he, en, w, h, colors, body);
  S('circle', 'עיגול', 'Circle', (c) => disc(50, 50, 44, c));
  S('ring', 'טבעת', 'Ring', (c) => ringC(50, 50, 38, c, 12));
  S('ring-thin', 'טבעת דקה', 'Thin ring', (c) => ringC(50, 50, 42, c, 5));
  S('ring-double', 'טבעת כפולה', 'Double ring', (c, k) => ringC(50, 50, 42, c, 6) + ringC(50, 50, 28, k, 6), 2);
  S('donut', 'דונאט', 'Donut', (c, k) => disc(50, 50, 44, c) + disc(50, 50, 20, k), 2);
  S('square', 'ריבוע', 'Square', (c) => box(8, 8, 84, 84, c));
  S('rounded-square', 'ריבוע מעוגל', 'Rounded square', (c) => box(8, 8, 84, 84, c, 20));
  S('rounded-square-outline', 'מסגרת ריבוע מעוגל', 'Rounded square outline', (c) => boxS(10, 10, 80, 80, c, 8, 18));
  S('rectangle', 'מלבן', 'Rectangle', (c) => box(6, 8, 108, 64, c, 8), 1, 120, 80);
  S('pill', 'גלולה', 'Pill', (c) => box(6, 6, 128, 48, c, 24), 1, 140, 60);
  S('pill-outline', 'מסגרת גלולה', 'Pill outline', (c) => boxS(8, 8, 124, 44, c, 6, 22), 1, 140, 60);
  S('ellipse', 'אליפסה', 'Ellipse', (c) => `<ellipse cx="60" cy="40" rx="54" ry="34" fill="${c}"/>`, 1, 120, 80);
  S('triangle', 'משולש', 'Triangle', (c) => fillD(poly([[50, 8], [94, 88], [6, 88]]), c));
  S('triangle-down', 'משולש הפוך', 'Triangle down', (c) => fillD(poly([[6, 12], [94, 12], [50, 92]]), c));
  S('triangle-rounded', 'משולש מעוגל', 'Rounded triangle', (c) => both(poly([[50, 16], [86, 82], [14, 82]]), c, c, 14));
  S('triangle-outline', 'מסגרת משולש', 'Triangle outline', (c) => strokeD(poly([[50, 12], [90, 84], [10, 84]]), c, 8));
  S('right-triangle', 'משולש ישר זווית', 'Right triangle', (c) => fillD(poly([[8, 8], [8, 92], [92, 92]]), c));
  S('star-5', 'כוכב חמש קודקודים', 'Star, 5 points', (c) => fillD(poly(star(50, 53, 46, 19, 5)), c));
  S('star-6', 'כוכב שש קודקודים', 'Star, 6 points', (c) => fillD(poly(star(50, 50, 46, 25, 6)), c));
  S('star-8', 'כוכב שמונה קודקודים', 'Star, 8 points', (c) => fillD(poly(star(50, 50, 46, 28, 8)), c));
  S('star-5-outline', 'מסגרת כוכב', 'Star outline', (c) => strokeD(poly(star(50, 53, 42, 18, 5)), c, 6));
  S('star-5-rounded', 'כוכב מעוגל', 'Rounded star', (c) => both(poly(star(50, 53, 38, 18, 5)), c, c, 12));
  S('heart', 'לב', 'Heart', (c) => fillD('M50 90C10 60 6 30 28 18C40 12 50 20 50 30C50 20 60 12 72 18C94 30 90 60 50 90Z', c));
  S('heart-outline', 'מסגרת לב', 'Heart outline', (c) => strokeD('M50 86C14 58 10 32 30 22C41 17 50 24 50 33C50 24 59 17 70 22C90 32 86 58 50 86Z', c, 7));
  S('hexagon', 'משושה', 'Hexagon', (c) => fillD(poly(regular(50, 50, 46, 6)), c));
  S('hexagon-outline', 'מסגרת משושה', 'Hexagon outline', (c) => strokeD(poly(regular(50, 50, 42, 6)), c, 7));
  S('pentagon', 'מחומש', 'Pentagon', (c) => fillD(poly(regular(50, 54, 46, 5)), c));
  S('octagon', 'מתומן', 'Octagon', (c) => fillD(poly(regular(50, 50, 47, 8, -67.5)), c));
  S('diamond', 'מעוין', 'Diamond', (c) => fillD(poly([[50, 6], [94, 50], [50, 94], [6, 50]]), c));
  S('diamond-outline', 'מסגרת מעוין', 'Diamond outline', (c) => strokeD(poly([[50, 10], [90, 50], [50, 90], [10, 50]]), c, 7));
  S('burst-12', 'התפרצות 12 קצוות', 'Burst, 12 spikes', (c) => fillD(poly(star(50, 50, 47, 35, 12)), c));
  S('burst-16', 'התפרצות 16 קצוות', 'Burst, 16 spikes', (c) => fillD(poly(star(50, 50, 47, 38, 16)), c));
  S('burst-24', 'התפרצות 24 קצוות', 'Burst, 24 spikes', (c) => fillD(poly(star(50, 50, 47, 40, 24)), c));
  S('cloud', 'ענן', 'Cloud', (c) => box(14, 42, 92, 30, c, 15) + disc(42, 42, 20, c) + disc(72, 34, 26, c) + disc(94, 52, 16, c), 1, 120, 80);
  const blob = (seed: number) => (c: string) => fillD(smoothClosed(Array.from({ length: 12 }, (_, i): Pt => { const t = (i / 12) * 2 * Math.PI; return polar(50, 50, 36 + 6 * Math.sin(3 * t + seed) + 4 * Math.sin(2 * t + seed * 2.1), (t * 180) / Math.PI); })), c);
  S('blob-1', 'כתם ראשון', 'Blob 1', blob(0.5));
  S('blob-2', 'כתם שני', 'Blob 2', blob(2.1));
  S('blob-3', 'כתם שלישי', 'Blob 3', blob(4));
  S('cross', 'צלב עבה', 'Thick cross', (c) => fillD(poly([[34, 6], [66, 6], [66, 34], [94, 34], [94, 66], [66, 66], [66, 94], [34, 94], [34, 66], [6, 66], [6, 34], [34, 34]]), c));
  S('half-circle', 'חצי עיגול', 'Half circle', (c) => fillD('M6 54A44 44 0 0 1 94 54Z', c), 1, 100, 60);
  S('half-ring', 'חצי טבעת', 'Half ring', (c) => strokeD('M12 54A38 38 0 0 1 88 54', c, 12), 1, 100, 60);
  S('quarter-circle', 'רבע עיגול', 'Quarter circle', (c) => fillD('M6 94L6 6A88 88 0 0 1 94 94Z', c));
  S('quarter-ring', 'רבע טבעת', 'Quarter ring', (c) => fillD('M6 6A88 88 0 0 1 94 94L58 94A52 52 0 0 0 6 42Z', c));
  S('parallelogram', 'מקבילית', 'Parallelogram', (c) => fillD(poly([[30, 10], [114, 10], [90, 70], [6, 70]]), c), 1, 120, 80);
  S('trapezoid', 'טרפז', 'Trapezoid', (c) => fillD(poly([[30, 10], [90, 10], [114, 70], [6, 70]]), c), 1, 120, 80);
}

// ================= badges =================
{
  const B = (slug: string, he: string, en: string, body: Body, colors: 1 | 2 = 1, w = 100, h = 100) => add('badge', slug, he, en, w, h, colors, body);
  const mir = (p: Pt[], W: number): Pt[] => p.map(([x, y]) => [W - x, y]);
  const tailL: Pt[] = [[6, 28], [40, 28], [40, 66], [6, 66], [20, 47]];
  B('ribbon-banner', 'סרט עם זנבות', 'Ribbon banner', (c, k) => fillD(poly(tailL), k) + fillD(poly(mir(tailL, 160)), k) + box(24, 14, 112, 40, c), 2, 160, 80);
  B('ribbon-flat', 'סרט שטוח', 'Flat ribbon', (c) => fillD(poly([[6, 24], [34, 24], [34, 10], [126, 10], [126, 24], [154, 24], [140, 44], [154, 64], [126, 64], [126, 50], [34, 50], [34, 64], [6, 64], [20, 44]]), c), 1, 160, 80);
  B('banner-swallowtail', 'באנר זנב סנונית', 'Swallowtail banner', (c) => fillD('M6 12H154L136 40L154 68H6L24 40Z', c), 1, 160, 80);
  B('banner-pointed', 'באנר מחודד', 'Pointed banner', (c) => fillD('M6 12H134L154 40L134 68H6Z', c), 1, 160, 80);
  B('banner-rounded', 'באנר מעוגל', 'Rounded banner', (c) => box(6, 12, 148, 56, c, 16), 1, 160, 80);
  B('banner-split', 'באנר מפוצל', 'Split banner', (c, k) => box(6, 12, 50, 56, k, 10) + box(60, 12, 94, 56, c, 10), 2, 160, 80);
  const waves = (R: number, amp: number, k: number, ph = 0): Pt[] => Array.from({ length: 72 }, (_, i): Pt => polar(50, 50, R + amp * Math.cos(k * rad((i * 360) / 72) + ph), (i * 360) / 72));
  B('seal', 'חותם', 'Seal', (c) => fillD(smoothClosed(waves(40, 4.5, 16)), c));
  B('seal-ring', 'חותם עם טבעת', 'Seal with ring', (c, k) => fillD(smoothClosed(waves(40, 4.5, 16)), c) + ringC(50, 50, 28, k, 4), 2);
  B('starburst-badge', 'תג התפרצות', 'Starburst badge', (c, k) => fillD(poly(star(50, 50, 47, 38, 16)), c) + disc(50, 50, 26, k), 2);
  B('starburst-ring', 'תג התפרצות עם טבעת', 'Starburst ring badge', (c) => fillD(`${poly(star(50, 50, 47, 38, 16))}M80 50A30 30 0 1 0 20 50A30 30 0 1 0 80 50ZM74 50A24 24 0 1 1 26 50A24 24 0 1 1 74 50Z`, c, ' fill-rule="evenodd"'));
  const tag = `${poly([[8, 50], [40, 14], [92, 14], [92, 86], [40, 86]])}M24 50A6 6 0 1 0 36 50A6 6 0 1 0 24 50Z`;
  B('tag-left', 'תווית מחיר שמאלה', 'Price tag left', (c) => fillD(tag, c, ' fill-rule="evenodd"'));
  B('tag-right', 'תווית מחיר ימינה', 'Price tag right', (c) => g(fillD(tag, c, ' fill-rule="evenodd"'), FLIPX));
  B('ticket', 'כרטיס', 'Ticket', (c) => fillD('M6 6H134V28A10 10 0 0 0 134 48V64H6V48A10 10 0 0 0 6 28Z', c), 1, 140, 70);
  B('ticket-outline', 'מסגרת כרטיס', 'Ticket outline', (c) => strokeD('M8 8H132V28A10 10 0 0 0 132 48V62H8V48A10 10 0 0 0 8 28Z', c, 5), 1, 140, 70);
  const shield = 'M50 6L88 20V50C88 74 70 88 50 96C30 88 12 74 12 50V20Z';
  B('shield', 'מגן', 'Shield', (c) => fillD(shield, c));
  B('shield-outline', 'מסגרת מגן', 'Shield outline', (c) => strokeD(shield, c, 7));
  B('shield-double', 'מגן כפול', 'Two-colour shield', (c, k) => fillD(shield, c) + g(fillD(shield, k), 'matrix(0.7 0 0 0.7 15 14)'), 2);
  B('hexagon-badge', 'תג משושה', 'Hexagon badge', (c, k) => fillD(poly(regular(50, 50, 46, 6)), c) + strokeD(poly(regular(50, 50, 34, 6)), k, 4), 2);
  B('circle-badge', 'תג עגול', 'Round badge', (c, k) => disc(50, 50, 44, c) + ringC(50, 50, 35, k, 3), 2);
  const medalTail: Pt[] = [[30, 56], [14, 96], [34, 88], [44, 100], [54, 62]];
  B('medal', 'מדליה', 'Medal', (c, k) => fillD(poly(medalTail.map(([x, y]) => [x, y - 4] as Pt)), k) + fillD(poly(mir(medalTail, 100).map(([x, y]) => [x, y - 4] as Pt)), k) + disc(50, 36, 30, c) + ringC(50, 36, 19, k, 4), 2);
  B('rosette', 'עיגול עם סרטים', 'Rosette', (c, k) => fillD(poly([[32, 56], [18, 96], [36, 88], [46, 98], [54, 62]]), k) + fillD(poly([[68, 56], [82, 96], [64, 88], [54, 98], [46, 62]]), k) + fillD(poly(star(50, 38, 36, 30, 16)), c), 2);
  B('bookmark', 'סימנייה', 'Bookmark', (c) => fillD('M24 6H76V94L50 72L24 94Z', c));
  B('pennant', 'דגלון', 'Pennant', (c, k) => box(6, 6, 7, 90, k, 3) + fillD(poly([[14, 12], [94, 38], [14, 64]]), c), 2);
}

// ================= speech and thought bubbles (120 x 100) =================
{
  const Bu = (slug: string, he: string, en: string, body: Body, colors: 1 | 2 = 1) => add('bubble', slug, he, en, 120, 100, colors, body);
  const sides: [string, string, string][] = [['bottom', 'זנב למטה', 'tail below'], ['top', 'זנב למעלה', 'tail above'], ['left', 'זנב שמאלה', 'tail left'], ['right', 'זנב ימינה', 'tail right']];
  const bubble = (side: string, r: number): string => {
    if (side === 'bottom') return rrPath(6, 6, 108, 66, r, { side, s1: 32, s2: 56, tip: [20, 96] });
    if (side === 'top') return rrPath(6, 28, 108, 66, r, { side, s1: 32, s2: 56, tip: [20, 4] });
    if (side === 'left') return rrPath(28, 6, 86, 88, r, { side, s1: 34, s2: 58, tip: [4, 78] });
    return rrPath(6, 6, 86, 88, r, { side: 'right', s1: 34, s2: 58, tip: [116, 78] });
  };
  for (const [s, he, en] of sides) Bu(`rect-${s}`, `בועת דיבור מלבנית, ${he}`, `Speech bubble, rounded, ${en}`, (c) => fillD(bubble(s, 14), c));
  for (const [s, he, en] of sides) Bu(`round-${s}`, `בועת דיבור עגולה, ${he}`, `Speech bubble, round, ${en}`, (c) => fillD(bubble(s, 28), c));
  for (const [s, he, en] of sides) Bu(`rect-${s}-outline`, `מסגרת בועת דיבור, ${he}`, `Speech bubble outline, rounded, ${en}`, (c) => strokeD(bubble(s, 14), c, 5));
  for (const [s, he, en] of sides) Bu(`round-${s}-outline`, `מסגרת בועה עגולה, ${he}`, `Speech bubble outline, round, ${en}`, (c) => strokeD(bubble(s, 28), c, 5));
  Bu('rect-bottom-framed', 'בועת דיבור עם מסגרת', 'Framed speech bubble', (c, k) => both(bubble('bottom', 14), c, k, 5), 2);
  Bu('round-bottom-framed', 'בועה עגולה עם מסגרת', 'Framed round bubble', (c, k) => both(bubble('bottom', 28), c, k, 5), 2);
  const shout = (k: number, R: number, r: number, wob: number): Pt[] => Array.from({ length: 2 * k }, (_, i): Pt => { const rr = (i % 2 ? r : R) + wob * Math.sin(i * 2.7); const a = rad(-90 + (180 * i) / k); return [60 + rr * 1.2 * Math.cos(a), 46 + rr * 0.92 * Math.sin(a)]; });
  Bu('shout-burst', 'בועת צעקה', 'Shout burst', (c) => fillD(poly(shout(9, 44, 28, 4)), c));
  Bu('shout-spiky', 'בועת צעקה חדה', 'Spiky shout', (c) => fillD(poly(shout(13, 46, 34, 3)), c));
  Bu('shout-outline', 'מסגרת בועת צעקה', 'Shout burst outline', (c) => strokeD(poly(shout(9, 42, 27, 4)), c, 5));
  const cloudBody = (c: string) => box(18, 34, 84, 32, c, 16) + disc(42, 34, 22, c) + disc(72, 28, 24, c) + disc(92, 44, 18, c);
  Bu('thought-cloud', 'בועת מחשבה ענן', 'Thought cloud', (c) => cloudBody(c) + disc(34, 82, 8, c) + disc(20, 93, 5, c));
  Bu('thought-cloud-right', 'בועת מחשבה ענן, זנב ימינה', 'Thought cloud, trail right', (c) => g(cloudBody(c) + disc(34, 82, 8, c) + disc(20, 93, 5, c), 'matrix(-1 0 0 1 120 0)'));
  Bu('thought-round', 'בועת מחשבה עגולה', 'Thought bubble, oval', (c) => `<ellipse cx="60" cy="38" rx="54" ry="32" fill="${c}"/>` + disc(36, 80, 8, c) + disc(22, 92, 5, c));
  Bu('thought-round-outline', 'מסגרת בועת מחשבה', 'Thought bubble outline', (c) => `<ellipse cx="60" cy="38" rx="52" ry="30" fill="none" stroke="${c}" stroke-width="5"/>` + ringC(36, 80, 7, c, 4) + ringC(22, 92, 4, c, 3));
}

// ================= frames (160 x 100 unless stated) =================
{
  const F = (slug: string, he: string, en: string, body: Body, colors: 1 | 2 = 1, w = 160, h = 100) => add('frame', slug, he, en, w, h, colors, body);
  F('rounded', 'מסגרת מעוגלת', 'Rounded frame', (c) => boxS(6, 6, 148, 88, c, 6, 14));
  F('rounded-thick', 'מסגרת מעוגלת עבה', 'Thick rounded frame', (c) => boxS(8, 8, 144, 84, c, 12, 18));
  F('square', 'מסגרת ישרה', 'Square frame', (c) => boxS(6, 6, 148, 88, c, 6));
  const brk = (len: number) => `M6 ${6 + len}V6H${6 + len}M${154 - len} 6H154V${6 + len}M154 ${94 - len}V94H${154 - len}M${6 + len} 94H6V${94 - len}`;
  F('brackets', 'סוגריים בפינות', 'Corner brackets', (c) => strokeD(brk(28), c, 7));
  F('brackets-thin', 'סוגריים דקים בפינות', 'Thin corner brackets', (c) => strokeD(brk(22), c, 3));
  F('brackets-long', 'סוגריים ארוכים בפינות', 'Long corner brackets', (c) => strokeD(brk(46), c, 6));
  F('brackets-rounded', 'סוגריים מעוגלים בפינות', 'Rounded corner brackets', (c) => strokeD('M6 40V22Q6 6 22 6H40M120 6H138Q154 6 154 22V40M154 60V78Q154 94 138 94H120M40 94H22Q6 94 6 78V60', c, 7));
  F('viewfinder', 'מכוון מצלמה', 'Viewfinder', (c) => strokeD(brk(24), c, 5) + strokeD('M70 50H90M80 40V60', c, 4));
  F('film', 'סרט צילום', 'Film frame', (c) => {
    const holes = Array.from({ length: 9 }, (_, i) => `M${14 + i * 16} 9h8v8h-8Z M${14 + i * 16} 83h8v8h-8Z`).join('');
    return fillD(`M4 4H156V96H4Z M10 24H150V76H10Z ${holes}`, c, ' fill-rule="evenodd"');
  });
  F('polaroid', 'מסגרת פולרואיד', 'Polaroid-style border', (c) => fillD('M6 6H94V114H6Z M14 14H86V86H14Z', c, ' fill-rule="evenodd"'), 1, 100, 120);
  F('polaroid-tilted', 'מסגרת פולרואיד מוטה', 'Tilted polaroid-style border', (c) => g(fillD('M12 10H88V106H12Z M19 17H81V79H19Z', c, ' fill-rule="evenodd"'), rot(-6, 50, 60)), 1, 100, 120);
  F('solid', 'מסגרת מלאה', 'Solid frame', (c) => fillD('M4 4H156V96H4Z M20 20H140V80H20Z', c, ' fill-rule="evenodd"'));
  F('solid-rounded', 'מסגרת מלאה מעוגלת', 'Solid rounded frame', (c) => fillD(rrPath(4, 4, 152, 92, 18) + rrPath(18, 18, 124, 64, 8), c, ' fill-rule="evenodd"'));
  F('dashed', 'מסגרת מקווקוות', 'Dashed frame', (c) => boxS(6, 6, 148, 88, c, 5, 8, ' stroke-dasharray="16 10"'));
  F('dotted', 'מסגרת מנוקדת', 'Dotted frame', (c) => boxS(6, 6, 148, 88, c, 6, 8, ' stroke-dasharray="0 12" stroke-linecap="round"'));
  F('double-line', 'מסגרת כפולה', 'Double-line frame', (c) => boxS(6, 6, 148, 88, c, 3) + boxS(16, 16, 128, 68, c, 3));
  F('double-line-two-colour', 'מסגרת כפולה בשני צבעים', 'Two-colour double frame', (c, k) => boxS(6, 6, 148, 88, c, 4) + boxS(16, 16, 128, 68, k, 3), 2);
  F('circle', 'מסגרת עגולה', 'Circle frame', (c) => ringC(50, 50, 42, c, 8), 1, 100, 100);
  F('circle-dashed', 'מסגרת עגולה מקווקוות', 'Dashed circle frame', (c) => ringC(50, 50, 42, c, 6, ' stroke-dasharray="14 9"'), 1, 100, 100);
  F('safe-area', 'אזור בטוח', 'Safe-area frame', (c, k) => boxS(6, 6, 148, 88, c, 4) + boxS(24, 17, 112, 66, k, 3, 0, ' stroke-dasharray="10 7"'), 2);
}

// ================= lower-third bars and title plates (400 x 100 unless stated) =================
{
  const Ba = (slug: string, he: string, en: string, body: Body, colors: 1 | 2 = 1, w = 400, h = 100) => add('bar', slug, he, en, w, h, colors, body);
  Ba('solid', 'פס מלא', 'Solid bar', (c) => box(4, 20, 392, 60, c));
  Ba('rounded', 'פס מעוגל', 'Rounded bar', (c) => box(4, 20, 392, 60, c, 14));
  Ba('pill', 'פס גלולה', 'Pill bar', (c) => box(4, 20, 392, 60, c, 30));
  Ba('accent-left', 'פס עם קצה צבעוני', 'Bar with left accent', (c, k) => box(4, 20, 24, 60, k) + box(28, 20, 368, 60, c), 2);
  Ba('accent-bottom', 'פס עם קו תחתון', 'Bar with bottom accent', (c, k) => box(4, 16, 392, 56, c) + box(4, 72, 392, 10, k), 2);
  Ba('accent-top', 'פס עם קו עליון', 'Bar with top accent', (c, k) => box(4, 18, 392, 10, k) + box(4, 28, 392, 56, c), 2);
  Ba('two-tier', 'פס דו-שכבתי', 'Two-tier bar', (c, k) => box(4, 10, 392, 46, c) + box(4, 60, 292, 30, k), 2);
  Ba('angled', 'פס אלכסוני', 'Angled bar', (c) => fillD(poly([[34, 20], [396, 20], [366, 80], [4, 80]]), c));
  Ba('arrow-end', 'פס עם חץ', 'Arrow-end bar', (c) => fillD(poly([[4, 20], [358, 20], [396, 50], [358, 80], [4, 80]]), c));
  Ba('notched', 'פס עם פינה חתוכה', 'Notched bar', (c) => fillD(poly([[34, 20], [396, 20], [396, 80], [4, 80], [4, 50]]), c));
  Ba('tabbed', 'פס עם לשונית', 'Tabbed bar', (c, k) => box(4, 36, 392, 52, c) + box(4, 8, 140, 28, k), 2);
  Ba('outline', 'מסגרת פס', 'Outlined bar', (c) => boxS(6, 22, 388, 56, c, 5));
  Ba('outline-accent', 'מסגרת פס עם קצה צבעוני', 'Outlined bar with accent', (c, k) => boxS(6, 22, 388, 56, c, 5) + box(6, 22, 36, 56, k), 2);
  Ba('split', 'פס מפוצל', 'Split bar', (c, k) => box(4, 20, 110, 60, k) + box(120, 20, 276, 60, c), 2);
  Ba('striped', 'פס עם פסים', 'Striped bar', (c, k) => box(4, 20, 392, 60, c) + [0, 1, 2].map((i) => fillD(poly([[20 + i * 22, 20], [34 + i * 22, 20], [14 + i * 22, 80], [0 + i * 22 + 6, 80]]), k)).join(''), 2);
  Ba('double-rule', 'שני קווים', 'Double rule', (c) => box(4, 14, 392, 6, c) + box(4, 80, 392, 6, c));
  Ba('rule-and-block', 'קו וגוש', 'Rule and block', (c, k) => box(4, 14, 392, 5, k) + box(4, 24, 300, 62, c), 2);
  Ba('plate-double-border', 'שלט עם מסגרת כפולה', 'Plate with double border', (c, k) => box(4, 4, 292, 112, c) + boxS(14, 14, 272, 92, k, 3), 2, 300, 120);
  Ba('plate-cut-corners', 'שלט עם פינות חתוכות', 'Plate with cut corners', (c) => fillD(poly([[24, 4], [276, 4], [296, 24], [296, 96], [276, 116], [24, 116], [4, 96], [4, 24]]), c), 1, 300, 120);
  Ba('plate-brackets', 'שלט בסוגריים', 'Bracket plate', (c) => strokeD('M30 8H8V112H30M270 8H292V112H270', c, 6), 1, 300, 120);
  Ba('plate-ribbon', 'שלט סרט', 'Ribbon plate', (c, k) => fillD(poly([[4, 30], [30, 30], [30, 110], [4, 110], [14, 70]]), k) + box(20, 10, 260, 80, c), 2, 300, 120);
}

// ================= lines (200 x 40 unless stated) =================
{
  const Li = (slug: string, he: string, en: string, body: Body, colors: 1 | 2 = 1, w = 200, h = 40) => add('line', slug, he, en, w, h, colors, body);
  Li('underline-straight', 'קו תחתון ישר', 'Straight underline', (c) => strokeD('M8 20H192', c, 6));
  Li('underline-thick', 'קו תחתון עבה', 'Thick underline', (c) => strokeD('M12 20H188', c, 14));
  Li('underline-double', 'קו תחתון כפול', 'Double underline', (c) => strokeD('M8 12H192M8 28H192', c, 5));
  const swoosh = 'M6 32C60 8 140 2 194 8C140 20 60 28 6 32Z';
  Li('underline-swoosh', 'קו תחתון מתנופף', 'Swoosh underline', (c) => fillD(swoosh, c));
  Li('underline-swoosh-reverse', 'קו תחתון מתנופף הפוך', 'Reverse swoosh underline', (c) => g(fillD(swoosh, c), 'matrix(-1 0 0 1 200 0)'));
  Li('underline-wobble', 'קו תחתון ביד חופשית', 'Hand-drawn underline', (c) => strokeD(smoothOpen(Array.from({ length: 14 }, (_, i) => [8 + i * 14.15, 20 + 3 * Math.sin(i * 1.1) + 2 * Math.sin(i * 2.9)] as Pt)), c, 6));
  Li('underline-scribble', 'קו תחתון משורבט', 'Scribble underline', (c) => strokeD('M10 26L186 12L24 26L190 20L40 30L180 26', c, 4));
  Li('zigzag', 'זיגזג', 'Zigzag', (c) => strokeD(poly(Array.from({ length: 13 }, (_, i) => [8 + i * 15.33, i % 2 ? 30 : 10] as Pt), false), c, 6));
  Li('wavy', 'גל', 'Wavy line', (c) => strokeD(poly(sine(8, 192, 20, 9, 46, 48), false), c, 6));
  Li('wavy-thick', 'גל עבה', 'Thick wavy line', (c) => strokeD(poly(sine(10, 190, 20, 8, 60, 48), false), c, 11));
  Li('dashed', 'קו מקווקו', 'Dashed line', (c) => `<line x1="8" y1="20" x2="192" y2="20" stroke="${c}" stroke-width="6" stroke-dasharray="18 12"/>`);
  Li('dotted', 'קו מנוקד', 'Dotted line', (c) => `<line x1="12" y1="20" x2="188" y2="20" stroke="${c}" stroke-width="8" stroke-linecap="round" stroke-dasharray="0 16"/>`);
  Li('dash-dot', 'קו נקודה-מקף', 'Dash-dot line', (c) => `<line x1="8" y1="20" x2="192" y2="20" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-dasharray="24 10 0 10"/>`);
  const brush = (ph: number, amp: number, bend: number) => (c: string) => {
    const xs = Array.from({ length: 24 }, (_, i) => 6 + (i * 188) / 23);
    const mid = (x: number) => 20 + bend * Math.sin(((x - 6) / 188) * Math.PI);
    const half = (x: number, i: number) => amp * Math.pow(Math.sin(((x - 6) / 188) * Math.PI), 0.5) * (1 + 0.08 * Math.sin(i * 1.3 + ph));
    const top = xs.map((x, i) => [x, mid(x) - half(x, i) + 1.5 * Math.sin(i * 1.7 + ph)] as Pt);
    const bot = xs.map((x, i) => [x, mid(x) + half(x, i) + 1.5 * Math.cos(i * 2.1 + ph)] as Pt).reverse();
    return fillD(poly([...top, ...bot]), c);
  };
  Li('brush-stroke', 'משיכת מכחול', 'Brush stroke', brush(0.4, 11, -2));
  Li('brush-stroke-curved', 'משיכת מכחול מעוקלת', 'Curved brush stroke', brush(2.2, 9, 5));
  Li('bracket-pair-square', 'זוג סוגריים מרובעים', 'Square bracket pair', (c) => strokeD('M16 4H6V36H16M184 4H194V36H184', c, 5));
  Li('bracket-pair-round', 'זוג סוגריים עגולים', 'Round bracket pair', (c) => strokeD('M24 4Q4 20 24 36M176 4Q196 20 176 36', c, 5));
  Li('bracket-curly', 'סוגר מסולסל', 'Curly brace', (c) => strokeD('M6 8Q6 18 20 18H84Q100 18 100 32Q100 18 116 18H180Q194 18 194 8', c, 5));
  Li('bracket-over', 'סוגר עליון', 'Over-bracket', (c) => strokeD('M6 36V10H194V36', c, 5));
  Li('bracket-under', 'סוגר תחתון', 'Under-bracket', (c) => strokeD('M6 4V30H194V4', c, 5));
  Li('divider-dot', 'מפריד עם נקודה', 'Divider with dot', (c) => strokeD('M6 20H86M114 20H194', c, 4) + disc(100, 20, 7, c));
  Li('divider-diamond', 'מפריד עם יהלום', 'Divider with diamond', (c) => strokeD('M6 20H82M118 20H194', c, 4) + fillD(poly([[100, 8], [112, 20], [100, 32], [88, 20]]), c));
  Li('divider-dot-two-colour', 'מפריד עם נקודה צבעונית', 'Divider with accent dot', (c, k) => strokeD('M6 20H86M114 20H194', c, 4) + disc(100, 20, 8, k), 2);
  Li('divider-three-dots', 'מפריד שלוש נקודות', 'Divider with three dots', (c) => disc(80, 20, 5, c) + disc(100, 20, 5, c) + disc(120, 20, 5, c) + strokeD('M6 20H62M138 20H194', c, 3));
  Li('highlight-marker', 'סימון מרקר', 'Highlighter swipe', (c) => fillD('M6 8L190 4L194 32L10 36Z', c, ' opacity="0.55"'));
  Li('scribble-circle', 'עיגול משורבט', 'Scribbled circle', (c) => strokeD(smoothOpen(Array.from({ length: 30 }, (_, i): Pt => { const t = (i / 24) * 2 * Math.PI + 0.3; const k = 1 + 0.05 * Math.sin(i * 1.3) + 0.06 * (i / 29); return [60 + 50 * k * Math.cos(t), 40 + 30 * k * Math.sin(t)]; })), c, 5), 1, 120, 80);
}

// ================= symbols (100 x 100) =================
{
  const Y = (slug: string, he: string, en: string, body: Body, colors: 1 | 2 = 1) => add('symbol', slug, he, en, 100, 100, colors, body);
  const CHECK = 'M22 54L42 74L78 28', XMARK = 'M26 26L74 74M74 26L26 74', PLUS = 'M50 16V84M16 50H84', MINUS = 'M16 50H84';
  const QMARK = (c: string) => strokeD('M34 34C34 12 68 12 68 34C68 48 50 48 50 64', c, 10) + disc(50, 83, 6.5, c);
  const EXCL = (c: string) => strokeD('M50 12V58', c, 12) + disc(50, 82, 7.5, c);
  const INFO = (c: string) => disc(50, 20, 8, c) + strokeD('M50 42V84', c, 12);
  const small = (b: string) => g(b, 'matrix(0.58 0 0 0.58 21 21)');
  const PLAY = poly([[30, 12], [88, 50], [30, 88]]);
  Y('check', 'סימן וי', 'Check mark', (c) => strokeD(CHECK, c, 12));
  Y('cross-mark', 'סימן איקס', 'Cross mark', (c) => strokeD(XMARK, c, 12));
  Y('plus', 'פלוס', 'Plus', (c) => strokeD(PLUS, c, 12));
  Y('minus', 'מינוס', 'Minus', (c) => strokeD(MINUS, c, 12));
  Y('question', 'סימן שאלה', 'Question mark', QMARK);
  Y('exclamation', 'סימן קריאה', 'Exclamation mark', EXCL);
  Y('info', 'סימן מידע', 'Info mark', INFO);
  Y('play', 'הפעלה', 'Play', (c) => both(PLAY, c, c, 8));
  Y('pause', 'השהיה', 'Pause', (c) => box(24, 14, 18, 72, c, 4) + box(58, 14, 18, 72, c, 4));
  Y('stop', 'עצירה', 'Stop', (c) => box(18, 18, 64, 64, c, 10));
  Y('lightning', 'ברק', 'Lightning bolt', (c) => both(poly([[58, 6], [22, 56], [46, 56], [38, 94], [80, 40], [54, 40]]), c, c, 4));
  Y('sun', 'שמש', 'Sun', (c) => disc(50, 50, 18, c) + strokeD(Array.from({ length: 8 }, (_, i) => { const a = polar(50, 50, 30, i * 45), b = polar(50, 50, 44, i * 45); return `M${n(a[0])} ${n(a[1])}L${n(b[0])} ${n(b[1])}`; }).join(''), c, 8));
  Y('moon', 'ירח', 'Crescent moon', (c) => fillD('M62 8A42 42 0 1 0 92 66A34 34 0 0 1 62 8Z', c));
  Y('drop', 'טיפה', 'Water drop', (c) => fillD('M50 8C50 8 20 44 20 62A30 30 0 0 0 80 62C80 44 50 8 50 8Z', c));
  const flame = 'M50 6C56 26 82 40 82 64A32 32 0 0 1 18 64C18 50 26 42 32 36C34 46 40 50 44 50C40 34 42 18 50 6Z';
  Y('flame', 'להבה', 'Flame', (c) => fillD(flame, c));
  Y('flame-two-colour', 'להבה בשני צבעים', 'Two-colour flame', (c, k) => fillD(flame, c) + fillD('M50 52C56 62 66 66 66 76A16 16 0 0 1 34 76C34 68 42 64 50 52Z', k), 2);
  Y('music-note', 'תו מוזיקלי', 'Music note', (c) => `<ellipse cx="34" cy="76" rx="15" ry="11" transform="rotate(-20 34 76)" fill="${c}"/>` + strokeD('M47 72V14', c, 8) + fillD('M47 14C60 20 78 28 74 52C70 38 58 36 47 34Z', c));
  Y('music-notes', 'תווים מחוברים', 'Beamed notes', (c) => `<ellipse cx="28" cy="78" rx="14" ry="10" transform="rotate(-20 28 78)" fill="${c}"/><ellipse cx="72" cy="70" rx="14" ry="10" transform="rotate(-20 72 70)" fill="${c}"/>` + strokeD('M40 74V24M84 66V16', c, 7) + fillD(poly([[38, 24], [86, 14], [86, 34], [38, 44]]), c));
  Y('location-pin', 'סיכת מיקום', 'Location pin', (c) => fillD('M50 94C50 94 18 58 18 38A32 32 0 0 1 82 38C82 58 50 94 50 94ZM62 38A12 12 0 1 0 38 38A12 12 0 1 0 62 38Z', c, ' fill-rule="evenodd"'));
  Y('bell', 'פעמון', 'Bell outline', (c) => strokeD('M50 12C30 12 26 30 26 46C26 62 18 70 14 76H86C82 70 74 62 74 46C74 30 70 12 50 12Z', c, 7) + strokeD('M41 86A10 10 0 0 0 59 86', c, 7));
  Y('eye', 'עין', 'Eye outline', (c) => strokeD('M6 50Q50 6 94 50Q50 94 6 50Z', c, 7) + ringC(50, 50, 15, c, 7));
  Y('lock', 'מנעול', 'Lock outline', (c) => boxS(22, 44, 56, 46, c, 7, 8) + strokeD('M34 44V32A16 16 0 0 1 66 32V44', c, 7));
  Y('magnifier', 'זכוכית מגדלת', 'Magnifier outline', (c) => ringC(42, 42, 28, c, 9) + strokeD('M63 63L90 90', c, 12));
  Y('sparkle', 'נצנוץ', 'Four-point sparkle', (c) => fillD('M50 4Q56 44 96 50Q56 56 50 96Q44 56 4 50Q44 44 50 4Z', c));
  Y('sparkles', 'נצנוצים', 'Sparkle cluster', (c) => g(fillD('M50 4Q56 44 96 50Q56 56 50 96Q44 56 4 50Q44 44 50 4Z', c), 'matrix(0.7 0 0 0.7 6 22)') + g(fillD('M50 4Q56 44 96 50Q56 56 50 96Q44 56 4 50Q44 44 50 4Z', c), 'matrix(0.3 0 0 0.3 62 4)') + g(fillD('M50 4Q56 44 96 50Q56 56 50 96Q44 56 4 50Q44 44 50 4Z', c), 'matrix(0.25 0 0 0.25 68 70)'));
  const eyes = (c: string) => disc(36, 40, 5.5, c) + disc(64, 40, 5.5, c);
  const mouths = { smile: 'M30 60Q50 82 70 60', neutral: 'M32 66H68', sad: 'M32 72Q50 54 68 72' };
  const faceNames: [keyof typeof mouths, string, string][] = [['smile', 'פרצוף מחייך', 'Smiling face'], ['neutral', 'פרצוף ניטרלי', 'Neutral face'], ['sad', 'פרצוף עצוב', 'Sad face']];
  for (const [m, he, en] of faceNames) Y(`face-${m}`, he, en, (c) => ringC(50, 50, 42, c, 6) + eyes(c) + strokeD(mouths[m], c, 6));
  for (const [m, he, en] of faceNames) Y(`face-${m}-filled`, `${he} מלא`, `${en}, filled`, (c, k) => disc(50, 50, 44, c) + eyes(k) + strokeD(mouths[m], k, 6), 2);
  Y('circle-check', 'וי בעיגול', 'Check in circle', (c, k) => disc(50, 50, 44, c) + g(strokeD(CHECK, k, 12), 'matrix(0.7 0 0 0.7 15 17)'), 2);
  Y('circle-cross', 'איקס בעיגול', 'Cross in circle', (c, k) => disc(50, 50, 44, c) + g(strokeD(XMARK, k, 12), 'matrix(0.7 0 0 0.7 15 15)'), 2);
  Y('circle-plus', 'פלוס בעיגול', 'Plus in circle', (c, k) => disc(50, 50, 44, c) + g(strokeD(PLUS, k, 12), 'matrix(0.7 0 0 0.7 15 15)'), 2);
  Y('circle-minus', 'מינוס בעיגול', 'Minus in circle', (c, k) => disc(50, 50, 44, c) + g(strokeD(MINUS, k, 12), 'matrix(0.7 0 0 0.7 15 15)'), 2);
  Y('circle-question', 'שאלה בעיגול', 'Question in circle', (c, k) => disc(50, 50, 44, c) + small(QMARK(k)), 2);
  Y('circle-exclamation', 'קריאה בעיגול', 'Exclamation in circle', (c, k) => disc(50, 50, 44, c) + small(EXCL(k)), 2);
  Y('circle-info', 'מידע בעיגול', 'Info in circle', (c, k) => disc(50, 50, 44, c) + small(INFO(k)), 2);
  Y('circle-play', 'הפעלה בעיגול', 'Play in circle', (c, k) => disc(50, 50, 44, c) + g(both(PLAY, k, k, 8), 'matrix(0.55 0 0 0.55 25 22.5)'), 2);
  Y('circle-pause', 'השהיה בעיגול', 'Pause in circle', (c, k) => disc(50, 50, 44, c) + box(36, 30, 10, 40, k, 3) + box(54, 30, 10, 40, k, 3), 2);
  Y('warning-triangle', 'משולש אזהרה', 'Warning triangle', (c, k) => both(poly([[50, 14], [88, 82], [12, 82]]), c, c, 14) + g(EXCL(k), 'matrix(0.45 0 0 0.45 27.5 34)'), 2);
  Y('home', 'בית', 'Home', (c) => fillD(poly([[50, 10], [92, 48], [80, 48], [80, 88], [58, 88], [58, 62], [42, 62], [42, 88], [20, 88], [20, 48], [8, 48]]), c));
  Y('gear', 'גלגל שיניים', 'Gear', (c) => fillD(poly(Array.from({ length: 8 }, (_, i) => [-17, -10, 10, 17].map((o, j) => polar(50, 50, j === 0 || j === 3 ? 34 : 46, i * 45 + o) as Pt)).flat()) + 'M64 50A14 14 0 1 0 36 50A14 14 0 1 0 64 50Z', c, ' fill-rule="evenodd"'));
  Y('target', 'מטרה', 'Target', (c) => ringC(50, 50, 42, c, 6) + ringC(50, 50, 26, c, 6) + disc(50, 50, 10, c));
  Y('crown', 'כתר', 'Crown', (c) => fillD(poly([[10, 74], [6, 28], [30, 50], [50, 20], [70, 50], [94, 28], [90, 74]]), c) + box(10, 80, 80, 10, c, 3));
  Y('hourglass', 'שעון חול', 'Hourglass', (c) => strokeD('M24 10H76M24 90H76M28 10C28 40 50 44 50 50C50 56 28 60 28 90M72 10C72 40 50 44 50 50C50 56 72 60 72 90', c, 7));
  Y('cursor', 'סמן עכבר', 'Pointer cursor', (c) => both(poly([[26, 8], [26, 76], [42, 62], [54, 90], [66, 84], [54, 58], [76, 56]]), c, c, 4));
  Y('flag', 'דגל', 'Flag', (c) => box(20, 8, 8, 86, c, 3) + fillD(poly([[28, 14], [86, 14], [72, 34], [86, 54], [28, 54]]), c));
}

// ---- public API ----
export const ELEMENTS: readonly ElementDef[] = TABLE.map(({ body: _body, ...def }) => def);
export const ELEMENT_IDS = ELEMENTS.map((e) => e.id) as [string, ...string[]];
export const ELEMENT_CATEGORIES: readonly ElementCategory[] = ['arrow', 'shape', 'badge', 'bubble', 'frame', 'bar', 'line', 'symbol'];

const COLOUR = /^#[0-9A-Fa-f]{6}$/;
const BY_ID = new Map(TABLE.map((e) => [e.id, e] as const));

/** Complete SVG document for the element. Throws RangeError for an unknown id or a colour that is not #RRGGBB. */
export function elementSvg(id: string, options: ElementOptions = {}): string {
  const e = BY_ID.get(id);
  if (!e) throw new RangeError(`unknown element "${id}"`);
  const c = options.color ?? '#FFFFFF', k = options.color2 ?? '#3DE0C8';
  if (!COLOUR.test(c)) throw new RangeError(`color must be #RRGGBB, got "${String(c)}"`);
  if (!COLOUR.test(k)) throw new RangeError(`color2 must be #RRGGBB, got "${String(k)}"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${e.width} ${e.height}" width="${e.width}" height="${e.height}">${e.body(c, k)}</svg>`;
}
