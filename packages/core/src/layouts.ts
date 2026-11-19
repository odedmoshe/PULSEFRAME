/**
 * Multi-picture layouts: split screen, picture-in-picture, grids. Pure geometry, no project state.
 *
 * Formulas, taken from the renderer:
 * - engine/src/compositor2d.ts `drawGraph`: a picture layer of source size (sw, sh) in a frame (W, H) is drawn centred at
 *   its own origin with size  w0 = sw*f, h0 = sh*f,  f = min(W/sw, H/sh) for fit 'contain' or max(...) for 'cover'
 *   (project setting `settings.fit`, optionally overridden per variant; schema.ts SettingsSchema.fit, default 'contain').
 * - compositor2d.ts `withTransform`: origin = (W/2 + x*W, H/2 + y*H), then rotate, then scale(s). So the drawn picture
 *   is w0*s by h0*s centred on that origin.
 * - engine/src/look.ts `applyMask` + `inLayerSpace`: the mask rectangle is in the same space (before scale):
 *   width = mask.width*w0, height = mask.height*h0, centre = (mask.x*w0, mask.y*h0), corner radius = radius*min(width,height)/2,
 *   all then multiplied by s. (Feather is a blur of feather*H pixels; we use 0.)
 *
 * Placement of a cell (cx, cy, cw, ch in pixels):
 *   x = (cx - W/2)/W, y = (cy - H/2)/H
 *   fill:  s = max(cw/w0, ch/h0); mask.width = cw/(w0*s), mask.height = ch/(h0*s), mask centred (0,0)
 *   whole: s = min(cw/w0, ch/h0); no mask
 * Gaps: slots are static fractions, so the gap fraction is applied to both axes of the frame fraction (for a non-square
 * frame the pixel gap differs slightly per axis; `gap` is nominal).
 */

export interface LayoutSlot { /** cell in the frame, as fractions of frame width/height; x,y = top-left */ x: number; y: number; w: number; h: number }
export interface LayoutDef { id: string; name: { he: string; en: string }; /** how many pictures it takes */ count: number; /** cells, back to front (the last is drawn on top) */ slots: readonly LayoutSlot[]; /** pictures are cropped to fill their cell (true) or shown whole inside it (false) */ fill: boolean; /** gap between cells as a fraction of the frame's shorter side, already included in `slots` */ gap: number }

const G = 0.01;
const PIP = { size: 0.3, margin: 0.03, radius: 0.15 };

/** n equal cells along one axis with gaps, spanning 0..1. */
const spans = (n: number, g: number): [number, number][] => {
  const len = (1 - g * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => [i * (len + g), len] as [number, number]);
};
const grid = (cols: number, rows: number, g: number): LayoutSlot[] => {
  const cs = spans(cols, g), rs = spans(rows, g);
  return rs.flatMap(([y, h]) => cs.map(([x, w]) => ({ x, y, w, h })));
};
const split = (frac: number, vertical: boolean, g: number, firstBig: boolean): LayoutSlot[] => {
  const a = (1 - g) * frac, b = (1 - g) * (1 - frac);
  const [first, second] = firstBig ? [a, b] : [b, a];
  return vertical
    ? [{ x: 0, y: 0, w: first, h: 1 }, { x: first + g, y: 0, w: second, h: 1 }]
    : [{ x: 0, y: 0, w: 1, h: first }, { x: 0, y: first + g, w: 1, h: second }];
};
const pip = (right: boolean, bottom: boolean): LayoutSlot[] => {
  const { size, margin } = PIP;
  return [{ x: 0, y: 0, w: 1, h: 1 }, { x: right ? 1 - margin - size : margin, y: bottom ? 1 - margin - size : margin, w: size, h: size }];
};
const mainSide = (): LayoutSlot[] => {
  const w = (1 - G) * (2 / 3), side = 1 - G - w, h = (1 - G) / 2;
  return [{ x: 0, y: 0, w, h: 1 }, { x: w + G, y: 0, w: side, h }, { x: w + G, y: h + G, w: side, h }];
};
const mainBelow = (): LayoutSlot[] => {
  const h = (1 - G) * (2 / 3), low = 1 - G - h;
  return [{ x: 0, y: 0, w: 1, h }, ...spans(3, G).map(([x, w]) => ({ x, y: h + G, w, h: low }))];
};

const def = (id: string, en: string, he: string, slots: LayoutSlot[], fill: boolean, gap: number): LayoutDef =>
  ({ id: `layout.${id}`, name: { he, en }, count: slots.length, slots, fill, gap });

export const LAYOUTS: readonly LayoutDef[] = [
  def('side-by-side', 'Side by side', 'זה לצד זה', grid(2, 1, G), true, G),
  def('top-and-bottom', 'Top and bottom', 'למעלה ולמטה', grid(1, 2, G), true, G),
  def('three-columns', 'Three columns', 'שלושה טורים', grid(3, 1, G), true, G),
  def('three-rows', 'Three rows', 'שלוש שורות', grid(1, 3, G), true, G),
  def('grid-2x2', 'Grid 2×2', 'רשת 2×2', grid(2, 2, G), true, G),
  def('grid-3x3', 'Grid 3×3', 'רשת 3×3', grid(3, 3, G), true, G),
  def('main-and-two-side', 'Main with two on the side', 'ראשי ושניים בצד', mainSide(), true, G),
  def('main-and-three-below', 'Main with three below', 'ראשי ושלושה מתחת', mainBelow(), true, G),
  def('pip-top-left', 'Picture in picture, top left', 'תמונה בתמונה, שמאל למעלה', pip(false, false), true, 0),
  def('pip-top-right', 'Picture in picture, top right', 'תמונה בתמונה, ימין למעלה', pip(true, false), true, 0),
  def('pip-bottom-left', 'Picture in picture, bottom left', 'תמונה בתמונה, שמאל למטה', pip(false, true), true, 0),
  def('pip-bottom-right', 'Picture in picture, bottom right', 'תמונה בתמונה, ימין למטה', pip(true, true), true, 0),
  def('pip-centre', 'Centred window over background', 'חלון במרכז', [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }], true, 0),
  def('split-two-thirds-left', 'Two thirds and one third, vertical', 'שני שלישים ושליש, אנכי', split(2 / 3, true, G, true), true, G),
  def('split-one-third-left', 'One third and two thirds, vertical', 'שליש ושני שלישים, אנכי', split(2 / 3, true, G, false), true, G),
  def('split-two-thirds-top', 'Two thirds and one third, horizontal', 'שני שלישים ושליש, אופקי', split(2 / 3, false, G, true), true, G),
  def('split-one-third-top', 'One third and two thirds, horizontal', 'שליש ושני שלישים, אופקי', split(2 / 3, false, G, false), true, G),
];

export const LAYOUT_IDS = LAYOUTS.map((l) => l.id) as [string, ...string[]];
export function findLayout(id: string): LayoutDef | undefined { return LAYOUTS.find((l) => l.id === id); }

export interface LayoutInput { frame: { width: number; height: number }; /** 'contain' | 'cover' (settings.fit) */ fit: string; pictures: readonly { width: number; height: number }[] }
export interface LayoutPlacement { transform: { x: number; y: number; scale: number }; /** crop to the cell; null when the picture is shown whole */ mask: { shape: 'rect'; x: number; y: number; width: number; height: number; radius: number; feather: number; invert: false } | null }

const positive = (n: number) => Number.isFinite(n) && n > 0;
/** Size of the picture layer before `scale`, as drawn by compositor2d drawGraph. */
function baseSize(input: LayoutInput, pic: { width: number; height: number }) {
  if (input.fit !== 'contain' && input.fit !== 'cover') throw new RangeError(`unknown fit "${input.fit}"`);
  const { width: W, height: H } = input.frame;
  const f = (input.fit === 'cover' ? Math.max : Math.min)(W / pic.width, H / pic.height);
  return { w0: pic.width * f, h0: pic.height * f };
}
const inRange = (name: string, v: number, lo: number, hi: number) => {
  if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError(`${name} = ${v} is outside ${lo}..${hi}`);
  return v;
};

export function layoutPlacements(layoutId: string, input: LayoutInput): LayoutPlacement[] {
  const layout = findLayout(layoutId);
  if (!layout) throw new RangeError(`unknown layout "${layoutId}"`);
  const { width: W, height: H } = input.frame;
  if (!positive(W) || !positive(H)) throw new RangeError('frame size must be positive');
  if (input.pictures.length !== layout.count) throw new RangeError(`${layout.id} takes ${layout.count} pictures, got ${input.pictures.length}`);
  for (const p of input.pictures) if (!positive(p.width) || !positive(p.height)) throw new RangeError('picture size must be positive');
  const isPip = layout.id.startsWith('layout.pip-');
  return layout.slots.map((slot, i): LayoutPlacement => {
    const { w0, h0 } = baseSize(input, input.pictures[i]!);
    const cw = slot.w * W, ch = slot.h * H;
    const cx = (slot.x + slot.w / 2) * W, cy = (slot.y + slot.h / 2) * H;
    const s = layout.fill ? Math.max(cw / w0, ch / h0) : Math.min(cw / w0, ch / h0);
    const transform = {
      x: inRange(`${layout.id} transform.x`, (cx - W / 2) / W, -4, 4),
      y: inRange(`${layout.id} transform.y`, (cy - H / 2) / H, -4, 4),
      scale: inRange(`${layout.id} transform.scale`, s, 0.01, 20),
    };
    const windowed = isPip && i === 1;
    let mw = cw / (w0 * s), mh = ch / (h0 * s);
    const crops = layout.fill && (mw < 1 - 1e-9 || mh < 1 - 1e-9);
    if (!layout.fill || (!crops && !windowed)) return { transform, mask: null };
    mw = Math.min(mw, 1); mh = Math.min(mh, 1);
    return {
      transform,
      mask: {
        shape: 'rect', x: 0, y: 0,
        width: inRange(`${layout.id} mask.width`, mw, 0.01, 2),
        height: inRange(`${layout.id} mask.height`, mh, 0.01, 2),
        radius: windowed ? PIP.radius : 0, feather: 0, invert: false,
      },
    };
  });
}

export function visibleRect(input: LayoutInput, picture: { width: number; height: number }, p: LayoutPlacement): { x: number; y: number; w: number; h: number } {
  const { width: W, height: H } = input.frame;
  const { w0, h0 } = baseSize(input, picture);
  const s = p.transform.scale;
  const cx = W / 2 + p.transform.x * W, cy = H / 2 + p.transform.y * H;
  let l = cx - (w0 * s) / 2, t = cy - (h0 * s) / 2, r = cx + (w0 * s) / 2, b = cy + (h0 * s) / 2;
  if (p.mask) {
    const m = p.mask;
    const mcx = cx + m.x * w0 * s, mcy = cy + m.y * h0 * s, mw = m.width * w0 * s, mh = m.height * h0 * s;
    l = Math.max(l, mcx - mw / 2); r = Math.min(r, mcx + mw / 2);
    t = Math.max(t, mcy - mh / 2); b = Math.min(b, mcy + mh / 2);
  }
  return { x: l, y: t, w: Math.max(0, r - l), h: Math.max(0, b - t) };
}

