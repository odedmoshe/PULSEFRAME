/**
 * The number and path helpers the graphic elements are drawn with (elements.ts and the pack elements, packs/elements*.ts):
 * moved out of elements.ts unchanged so that both can use them (ADR-0022). Pure string builders: the same arguments always
 * give the same markup. They produce only path, rect, circle and g markup, so an element built from them can be rasterised by
 * ffmpeg's librsvg and shown inline in a browser. No text, no gradients, no references.
 * This file imports nothing: pack data files may import it at run time without a cycle.
 */
/** How an element is drawn: its markup inside the svg element, for a first colour `c` and a second colour `k` (both #RRGGBB). */
export type Body = (c: string, k: string) => string;

// ---- number and path helpers ----
export type Pt = [number, number];
export const r2 = (x: number): number => { const v = Math.round(x * 100) / 100; return v === 0 ? 0 : v; };
export const n = (x: number): string => String(r2(x));
export const poly = (p: Pt[], close = true): string => p.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('') + (close ? 'Z' : '');
export const fillD = (d: string, c: string, extra = ''): string => `<path d="${d}" fill="${c}"${extra}/>`;
export const strokeD = (d: string, c: string, w: number, extra = ''): string => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
export const both = (d: string, fill: string, stroke: string, w: number): string => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${n(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
export const disc = (cx: number, cy: number, r: number, c: string): string => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${c}"/>`;
export const ringC = (cx: number, cy: number, r: number, c: string, w: number, extra = ''): string => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${c}" stroke-width="${n(w)}"${extra}/>`;
export const box = (x: number, y: number, w: number, h: number, c: string, rx = 0): string => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx ? ` rx="${n(rx)}"` : ''} fill="${c}"/>`;
export const boxS = (x: number, y: number, w: number, h: number, c: string, sw: number, rx = 0, extra = ''): string => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${rx ? ` rx="${n(rx)}"` : ''} fill="none" stroke="${c}" stroke-width="${n(sw)}"${extra}/>`;
export const g = (body: string, tf: string): string => `<g transform="${tf}">${body}</g>`;
export const rot = (a: number, cx = 50, cy = 50): string => `rotate(${n(a)} ${n(cx)} ${n(cy)})`;
export const FLIPX = 'matrix(-1 0 0 1 100 0)', FLIPY = 'matrix(1 0 0 -1 0 100)', FLIPXY = 'matrix(-1 0 0 -1 100 100)';
export const rad = (deg: number): number => (deg * Math.PI) / 180;
export const polar = (cx: number, cy: number, R: number, deg: number): Pt => [cx + R * Math.cos(rad(deg)), cy + R * Math.sin(rad(deg))];
export const regular = (cx: number, cy: number, R: number, k: number, start = -90): Pt[] => Array.from({ length: k }, (_, i) => polar(cx, cy, R, start + (360 * i) / k));
export const star = (cx: number, cy: number, R: number, r: number, k: number, start = -90): Pt[] => Array.from({ length: 2 * k }, (_, i) => polar(cx, cy, i % 2 ? r : R, start + (180 * i) / k));
/** Closed Catmull-Rom curve through the points, as cubic Beziers. */
export const smoothClosed = (p: Pt[]): string => {
  const k = p.length; let d = `M${n(p[0]![0])} ${n(p[0]![1])}`;
  for (let i = 0; i < k; i++) {
    const p0 = p[(i + k - 1) % k]!, p1 = p[i]!, p2 = p[(i + 1) % k]!, p3 = p[(i + 2) % k]!;
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d + 'Z';
};
/** Open path through the points, smoothed. */
export const smoothOpen = (p: Pt[]): string => {
  const k = p.length; let d = `M${n(p[0]![0])} ${n(p[0]![1])}`;
  for (let i = 0; i < k - 1; i++) {
    const p0 = p[Math.max(0, i - 1)]!, p1 = p[i]!, p2 = p[i + 1]!, p3 = p[Math.min(k - 1, i + 2)]!;
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
};
/** Two short strokes forming an arrow head at (x, y) for travel in direction `ang` (radians). Returned as sub-paths. */
export const head = (x: number, y: number, ang: number, s = 24, spread = 0.75): string => {
  const a: Pt = [x + s * Math.cos(ang + Math.PI - spread), y + s * Math.sin(ang + Math.PI - spread)];
  const b: Pt = [x + s * Math.cos(ang + Math.PI + spread), y + s * Math.sin(ang + Math.PI + spread)];
  return `M${n(a[0])} ${n(a[1])}L${n(x)} ${n(y)}L${n(b[0])} ${n(b[1])}`;
};
export const sine = (x0: number, x1: number, y: number, amp: number, wl: number, steps: number): Pt[] =>
  Array.from({ length: steps + 1 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / steps; return [x, y + amp * Math.sin(((x - x0) / wl) * 2 * Math.PI)] as Pt; });
/** Rounded rectangle path, optionally with a triangular tail on one side. s1 < s2 are offsets along the edge. */
export function rrPath(x: number, y: number, w: number, h: number, r: number, tail?: { side: 'top' | 'right' | 'bottom' | 'left'; s1: number; s2: number; tip: Pt }): string {
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

// ---- the row a content pack writes for one element (ADR-0022; packs/elements*.ts) ----
/**
 * One original element of a content pack. elements.ts lists it as `element.<category>.<slug>` after its own elements.
 * Rules (packs/packs.test.ts and elements.test.ts hold every row to them): `slug` is lower-case words joined by hyphens and
 * unique within its category; names in Hebrew and English; at most two colours, and `colors: 2` exactly when the body paints
 * with its second colour; the markup of `body` uses only the helpers above (path, rect, circle, ellipse, line, polyline,
 * polygon, g), at most 6 KB, no text, no letters, no gradient, no reference; default colours are #RRGGBB. Never a six-point
 * star: the hexagram stays available as element.shape.star-6 and is never part of a pack.
 * `version` is the element's picture version (elements.ts ELEMENT_PICTURE_VERSION when left out); a changed drawing gets a
 * higher number, so stored pictures made by different recipes never share an identity.
 */
export interface PackElementEntry {
  slug: string; category: 'holiday' | 'party'; he: string; en: string; width: number; height: number; colors: 1 | 2;
  defaults: { color: string; color2?: string };
  version?: number;
  body: Body;
}
