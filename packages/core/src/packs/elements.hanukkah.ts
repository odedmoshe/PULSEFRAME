/**
 * The elements of the Hanukkah pack, category 'holiday' (ADR-0022): drawn by formula with the helpers of elementKit.ts.
 * The symbols are the ones the owner approved (wave 5): the hanukkiah, the dreidel, sufganiyot, the oil jug and gelt, and
 * the things around them (candles, a latke, a gift, a garland). No letters on any of them (the dreidel's four faces carry a
 * lozenge, not a letter), no text, no gradient, no six-point star; at most two colours, the second one for the accents.
 * Pure: the same arguments always give the same markup.
 */
import { both, box, boxS, disc, fillD, g, n, poly, polar, smoothClosed, star, strokeD, type Body, type PackElementEntry, type Pt } from '../elementKit.ts';

/**
 * WAX: the candles' blue. It was a pale #D6E6FF that vanished on a light picture (contrast 1.1:1 on cream); this blue reads on
 * light and on dark pictures alike (about 3.4:1 on cream #F3EFE6 and 4.2:1 on night blue #16202C), and the flame's inner core,
 * drawn in the same colour, is the blue base of a real flame.
 */
const GOLD = '#F5C542', WAX = '#4F7FE0', BLUE = '#3A6BD8', CREAM = '#FFF4D6';
/** Picture version of the drawings changed on 2026-11-18 (the candles' colour, the oil jug and the latke): elements.ts ELEMENT_PICTURE_VERSION + 1. */
const REDRAWN = 3;
const EVENODD = ' fill-rule="evenodd"';

/**
 * A flame (teardrop) whose base sits on y = yb; h is its height. With `core` a smaller flame in the second colour sits in its lower
 * part, as the blue base of a real flame (scaled about a point just above the base; until 2026-11-18 it was scaled about the
 * origin and landed below the flame, on the candle or under the frame).
 */
const flame = (x: number, yb: number, h: number, c: string, core?: string): string => {
  const w = h * 0.32, r = w, top = yb - h;
  const d = `M${n(x)} ${n(top)}C${n(x + r * 0.45)} ${n(top + h * 0.3)} ${n(x + w)} ${n(yb - r * 1.15)} ${n(x + w)} ${n(yb - r * 0.7)}A${n(w)} ${n(w)} 0 0 1 ${n(x - w)} ${n(yb - r * 0.7)}C${n(x - w)} ${n(yb - r * 1.15)} ${n(x - r * 0.45)} ${n(top + h * 0.3)} ${n(x)} ${n(top)}Z`;
  const k = 0.45, py = yb - h * 0.1; // the core: the flame scaled by k about (x, py)
  return fillD(d, c) + (core ? g(fillD(d, core), `matrix(${k} 0 0 ${k} ${n(x * (1 - k))} ${n(py * (1 - k))})`) : '');
};
/** The outline of a flame, for the outlined hanukkiah. */
const flameLine = (x: number, yb: number, h: number, c: string, w: number): string => {
  const f = h * 0.3;
  return strokeD(`M${n(x)} ${n(yb - h)}C${n(x + f * 0.5)} ${n(yb - h * 0.7)} ${n(x + f)} ${n(yb - f * 1.1)} ${n(x + f)} ${n(yb - f * 0.7)}A${n(f)} ${n(f)} 0 0 1 ${n(x - f)} ${n(yb - f * 0.7)}C${n(x - f)} ${n(yb - f * 1.1)} ${n(x - f * 0.5)} ${n(yb - h * 0.7)} ${n(x)} ${n(yb - h)}Z`, c, w);
};

// ---------------------------------------------------------------- the hanukkiah: nine branches, the shamash raised in the middle
/** Candle positions from the right: the first night lights the rightmost one, each night adds the next to its left. */
const SIDE_X = [108, 96, 84, 72, 48, 36, 24, 12] as const;
const CUP_Y = 62, CANDLE_H = 20, SHAMASH_TOP = 28, SHAMASH_CUP = 49;
const cup = (x: number, y: number) => `<path d="M${n(x - 5.5)} ${n(y)}H${n(x + 5.5)}L${n(x + 3.5)} ${n(y + 4.5)}H${n(x - 3.5)}Z"/>`;
/** The branches and foot of the hanukkiah, drawn with stroke `c`. */
const frame = (c: string): string => {
  let d = '';
  for (const [i, x] of [72, 84, 96, 108].entries()) {
    const dx = x - 60, y0 = 71 + i * 5, r = Math.min(dx, y0 - CUP_Y - 3);
    d += `M60 ${n(y0)}H${n(x - r)}Q${n(x)} ${n(y0)} ${n(x)} ${n(y0 - r)}V${CUP_Y + 3}`;
    d += `M60 ${n(y0)}H${n(60 - dx + r)}Q${n(60 - dx)} ${n(y0)} ${n(60 - dx)} ${n(y0 - r)}V${CUP_Y + 3}`;
  }
  return strokeD(`M60 92V${SHAMASH_CUP + 3}${d}`, c, 4.4) + fillD('M36 98H84Q80 90 60 90Q40 90 36 98Z', c)
    + `<g fill="${c}">${cup(60, SHAMASH_CUP)}${SIDE_X.map((x) => cup(x, CUP_Y)).join('')}</g>`;
};
/** Hanukkiah for night `night`: the shamash and the `night` rightmost candles are lit. Second colour: the wax. */
const hanukkiah = (night: number): Body => (c, k) => {
  let body = frame(c);
  body += box(57, SHAMASH_TOP, 6, SHAMASH_CUP - SHAMASH_TOP, k, 1.2) + flame(60, SHAMASH_TOP - 1.5, 14, c, k);
  for (const [i, x] of SIDE_X.entries()) {
    body += box(x - 3, CUP_Y - CANDLE_H, 6, CANDLE_H, k, 1.2);
    if (i < night) body += flame(x, CUP_Y - CANDLE_H - 1.5, 13, c, k);
  }
  return body;
};
const hanukkiahOutline: Body = (c) => {
  let body = frame(c);
  const stroke = 2.6;
  body += `<rect x="57.5" y="${SHAMASH_TOP}" width="5" height="${SHAMASH_CUP - SHAMASH_TOP}" rx="1.2" fill="none" stroke="${c}" stroke-width="2.4"/>` + flameLine(60, SHAMASH_TOP - 3, 13, c, stroke);
  for (const x of SIDE_X) body += `<rect x="${n(x - 2.5)}" y="${CUP_Y - CANDLE_H}" width="5" height="${CANDLE_H}" rx="1.2" fill="none" stroke="${c}" stroke-width="2.4"/>`;
  return body;
};

// ---------------------------------------------------------------- candles
const candleBody = (c: string, k: string, flameOn: boolean): string => {
  const dish = fillD('M6 94Q8 82 30 82Q52 82 54 94Z', c);
  const cupPath = fillD('M20 82H40L38 72H22Z', c);
  const wax = box(22, 36, 16, 36, k, 2) + fillD('M22 38Q22 34 30 34Q38 34 38 38Z', k) + fillD('M38 44Q43 44 43 50Q43 55 40 55L38 55Z', k);
  const wick = strokeD('M30 35V29', c, 2.4);
  return dish + cupPath + wax + wick + (flameOn ? flame(30, 27, 22, c, k) : '');
};
/** Eight candles of the row, as they stand on a Hanukkah table. */
const candleRow: Body = (c, k) => {
  let body = box(4, 70, 152, 7, c, 3.5);
  for (let i = 0; i < 9; i++) {
    const x = 14 + i * 16.5, h = i === 4 ? 44 : 30 + (i % 2) * 4, top = 70 - h;
    body += box(x - 4, top, 8, h, k, 1.5) + flame(x, top - 1, 14, c, k);
  }
  return body;
};

// ---------------------------------------------------------------- the dreidel (a lozenge on each face, never a letter)
const lozenge = (cx: number, cy: number, r: number): string => `M${n(cx)} ${n(cy - r)}L${n(cx + r * 0.78)} ${n(cy)}L${n(cx)} ${n(cy + r)}L${n(cx - r * 0.78)} ${n(cy)}Z`;
const dreidelOne: Body = (c) =>
  box(36, 4, 8, 20, c, 3) +
  fillD('M28 26H52L64 36H16Z', c) +
  fillD(`M14 39H66V70H14Z${lozenge(40, 54.5, 11)}`, c, EVENODD) +
  fillD('M14 73H66L40 97Z', c);
const dreidelTwo: Body = (c, k) =>
  box(36, 4, 8, 20, k, 3) +
  fillD('M28 26H52L64 36H16Z', k) +
  box(14, 39, 52, 31, c, 2) + fillD(lozenge(40, 54.5, 11), k) +
  fillD('M14 73H66L40 97Z', k);
const dreidelSpin: Body = (c, k) => {
  const tilted = g(box(36, 6, 8, 18, c, 3) + fillD('M28 26H52L64 36H16Z', c) + box(14, 39, 52, 31, c, 2) + fillD(lozenge(40, 54.5, 10), k) + fillD('M14 73H66L40 97Z', c), 'rotate(12 40 97) translate(10 -2)');
  const swish = strokeD('M10 30Q2 52 12 74', k, 3.6) + strokeD('M90 26Q99 50 88 72', k, 3.6) + strokeD('M18 40Q12 54 18 66', k, 2.6) + strokeD('M82 38Q88 52 82 64', k, 2.6) + strokeD('M24 95Q50 101 76 95', k, 3);
  return swish + tilted;
};

// ---------------------------------------------------------------- sufganiyot
const bun = 'M50 30C70 30 91 40 92 60C93 78 72 86 50 86C28 86 7 78 8 60C9 40 30 30 50 30Z';
const sugarCap = 'M19 55C20 42 34 35 50 35C66 35 80 42 81 55Q76 61 71 55Q65 62 59 55Q54 62 48 55Q42 62 36 55Q30 61 25 56Z';
const sufganiya: Body = (c, k) => fillD(bun, c) + fillD(sugarCap, k) + disc(33, 72, 2, k) + disc(50, 77, 2, k) + disc(67, 71, 2, k) + disc(78, 66, 1.6, k) + disc(22, 66, 1.6, k);
const sufganiyaBitten: Body = (c, k) => {
  const bitten = 'M50 30C64 30 78 33 85 41A10 10 0 0 0 82 58A10 10 0 0 0 86 74C78 82 64 86 50 86C28 86 7 78 8 60C9 40 30 30 50 30Z';
  const cap = 'M19 55C20 42 34 35 50 35C62 35 71 38 76 43A8 8 0 0 0 74 56Q70 60 66 56Q61 62 55 56Q50 62 45 56Q40 62 35 56Q30 61 25 56Z';
  return fillD(bitten, c) + fillD(cap, k) + disc(34, 72, 2, k) + disc(52, 78, 2, k) + disc(66, 78, 1.6, k) + disc(21, 68, 1.6, k)
    + fillD('M88 46A6 6 0 0 1 90 58A6 6 0 0 1 88 46Z', k);
};
const sufganiyotPlate: Body = (c, k) => {
  const small = (cx: number, cy: number, s: number) => g(fillD(bun, c) + fillD(sugarCap, k), `matrix(${n(s)} 0 0 ${n(s)} ${n(cx - 50 * s)} ${n(cy - 58 * s)})`);
  return fillD('M4 70Q70 60 136 70Q130 88 70 88Q10 88 4 70Z', k) + small(34, 54, 0.46) + small(106, 54, 0.46) + small(70, 48, 0.55)
    + fillD('M14 72Q70 64 126 72', c, ' opacity="0"').replace(/<path[^>]*\/>/, '') + strokeD('M22 76Q70 84 118 76', c, 2.6);
};

// ---------------------------------------------------------------- latke, oil, gelt
/** A stack of three latkes seen from the side, the top one from above: a crisp brown edge, a golden face and its shreds of potato. */
const latkeTop = (cx: number, cy: number, rx: number, ry: number, seed: number): string => {
  const edge: Pt[] = Array.from({ length: 16 }, (_, i) => { const a = (2 * Math.PI * i) / 16, j = [0, 1.8, -1.2, 2.2, 0.4, -1.4, 1.4, 2.2, -0.8, 0.6, 1.8, -1.2, 1, -0.6, 2, -1.6][(i + seed) % 16]!; return [cx + (rx + j) * Math.cos(a), cy + (ry + j * 0.5) * Math.sin(a)]; });
  return smoothClosed(edge);
};
const latke: Body = (c, k) => {
  let body = '';
  // the two lower latkes: a brown crisp edge (k) with a sliver of golden face (c)
  for (const [cy, dx] of [[74, -3], [62, 4]] as const) body += fillD(latkeTop(50 + dx, cy + 3, 40, 12, cy), k) + fillD(latkeTop(50 + dx, cy - 1, 36, 9, cy + 5), c);
  // the top latke: a thick brown rim, a golden face, shreds of potato in two directions and a few crisp specks
  body += fillD(latkeTop(50, 47, 41, 15, 3), k) + fillD(latkeTop(50, 44, 35, 11, 9), c);
  const shreds = [[24, 42, 34, 39], [36, 37, 47, 40], [52, 36, 62, 39], [66, 40, 75, 44], [28, 49, 38, 52], [44, 45, 55, 47], [60, 47, 71, 50], [40, 51, 49, 54], [56, 52, 64, 53]] as const;
  body += shreds.map(([a, b, x, y]) => strokeD(`M${a} ${b}Q${(a + x) / 2} ${(b + y) / 2 - 2.5} ${x} ${y}`, k, 2.2)).join('');
  body += disc(31, 45, 1.4, k) + disc(58, 42, 1.4, k) + disc(68, 47, 1.2, k);
  // steam
  body += strokeD('M38 24Q34 18 38 13Q42 8 38 3', k, 2.4) + strokeD('M52 25Q48 18 52 12Q56 6 52 1', k, 2.4) + strokeD('M66 24Q62 18 66 13Q70 8 66 3', k, 2.4);
  return body;
};
/**
 * The jug of oil of the story: a small clay jug with a narrow neck, a lip, a handle, a band, the round seal on its shoulder, and
 * a drop of oil at the spout. The drop and the band are in the oil's colour with a rim of clay, so they show on light pictures too.
 */
const oilJug: Body = (c, k) =>
  // body and neck
  fillD('M41 16H59L58 30C75 36 85 50 84 66C83 82 70 94 50 94C30 94 17 82 16 66C15 50 25 36 42 30Z', c) +
  // the lip, with a spout on the left
  fillD('M37 9H63Q67 9 67 12.5Q67 16 63 16H38Q35 16 33 14L28 10.5Q27 9 29 9Z', c) +
  // the handle
  strokeD('M59 24C76 20 86 30 80 46', c, 6) +
  // a band of oil colour round the belly, with a row of small diamonds of clay on it
  fillD('M18.5 58Q50 66 81.5 58L82.5 66Q50 74 17.5 66Z', k) +
  [26, 38, 50, 62, 74].map((x) => fillD(`M${x} ${x === 50 ? 63.2 : x === 38 || x === 62 ? 62.8 : 61.6}l2.6 3l-2.6 3l-2.6-3Z`, c)).join('') +
  // the seal on the shoulder: a ring of oil colour with a dot
  `<circle cx="50" cy="44" r="7.5" fill="none" stroke="${k}" stroke-width="2.6"/>` + disc(50, 44, 2.6, k) +
  // a shine on the clay, above the band
  strokeD('M30 42Q25 47 23 53', k, 2.6) +
  // the drop of oil leaving the spout: oil colour with a clay rim
  both('M22 17C24 23 27 26 27 30A5 5 0 0 1 17 30C17 26 20 23 22 17Z', k, c, 2);
const geltCoin: Body = (c, k) => {
  const ticks = Array.from({ length: 28 }, (_, i) => { const a = polar(50, 50, 38.5, (360 * i) / 28), b = polar(50, 50, 43, (360 * i) / 28); return `M${n(a[0])} ${n(a[1])}L${n(b[0])} ${n(b[1])}`; }).join('');
  return disc(50, 50, 45, c) + strokeD(ticks, k, 2.2) + `<circle cx="50" cy="50" r="33" fill="none" stroke="${k}" stroke-width="3"/>` + fillD(poly(star(50, 50, 24, 12, 8)), k) + disc(50, 50, 6, c);
};
const geltStack: Body = (c, k) => {
  const coin = (cx: number, cy: number, rx: number) => box(cx - rx, cy, rx * 2, 8, k) + `<ellipse cx="${n(cx)}" cy="${n(cy + 8)}" rx="${n(rx)}" ry="${n(rx * 0.28)}" fill="${k}"/>` + `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(rx * 0.28)}" fill="${c}"/>`;
  let body = '';
  for (let i = 0; i < 3; i++) body += coin(74, 77 - i * 9, 20);
  for (let i = 0; i < 5; i++) body += coin(36, 82 - i * 9, 26);
  return body + `<ellipse cx="36" cy="${82 - 4 * 9}" rx="14" ry="4" fill="none" stroke="${k}" stroke-width="2"/>`;
};

// ---------------------------------------------------------------- gift, garland, frame
const gift: Body = (c, k) =>
  box(14, 42, 72, 46, c, 4) + box(8, 30, 84, 16, c, 4) + box(44, 30, 12, 58, k) +
  fillD('M50 30C34 12 14 14 22 26C28 32 42 30 50 30Z', k) + fillD('M50 30C66 12 86 14 78 26C72 32 58 30 50 30Z', k) + disc(50, 30, 5, c);
const garland: Body = (c, k) => {
  let body = strokeD('M4 8Q100 52 196 8', k, 2.4);
  for (let i = 0; i < 8; i++) {
    const t = (i + 0.5) / 8, x = 4 + 192 * t, y = 8 + 2 * 44 * t * (1 - t);
    body += box(x - 3, y - 1, 6, 5, k, 1) + `<ellipse cx="${n(x)}" cy="${n(y + 12)}" rx="5.5" ry="8" fill="${c}"/>`;
  }
  return body;
};
const frameCandles: Body = (c, k) => {
  let body = boxS(5, 5, 150, 90, c, 3.4, 10);
  for (let i = 0; i < 9; i++) {
    const x = 20 + i * 15, h = i === 4 ? 24 : 14 + (i % 2) * 3, top = 90 - h;
    body += box(x - 3.2, top, 6.4, h, k, 1.2) + flame(x, top - 1, 11, c, k);
  }
  return body;
};

const e = (slug: string, he: string, en: string, width: number, height: number, colors: 1 | 2, defaults: { color: string; color2?: string }, body: Body, version?: number): PackElementEntry => ({ slug, category: 'holiday', he, en, width, height, colors, defaults, body, ...(version !== undefined ? { version } : {}) });

export const HANUKKAH_ELEMENTS: readonly PackElementEntry[] = [
  ...Array.from({ length: 8 }, (_, i) => e(`hanukkiah-${i + 1}`, `חנוכייה, ${['נר ראשון', 'שני נרות', 'שלושה נרות', 'ארבעה נרות', 'חמישה נרות', 'שישה נרות', 'שבעה נרות', 'שמונה נרות'][i]}`, `Hanukkiah, ${i + 1} ${i ? 'candles' : 'candle'} lit`, 120, 100, 2, { color: GOLD, color2: WAX }, hanukkiah(i + 1), REDRAWN)),
  e('hanukkiah-outline', 'חנוכייה בקו מתאר', 'Hanukkiah outline', 120, 100, 1, { color: GOLD }, hanukkiahOutline),
  e('candle', 'נר', 'Candle', 60, 100, 2, { color: GOLD, color2: WAX }, (c, k) => candleBody(c, k, false), REDRAWN),
  e('candle-lit', 'נר דולק', 'Lit candle', 60, 100, 2, { color: GOLD, color2: WAX }, (c, k) => candleBody(c, k, true), REDRAWN),
  e('candle-row', 'שורת נרות', 'Row of candles', 160, 80, 2, { color: GOLD, color2: WAX }, candleRow, REDRAWN),
  e('dreidel', 'סביבון', 'Dreidel', 80, 100, 1, { color: BLUE }, dreidelOne),
  e('dreidel-two-colour', 'סביבון בשני צבעים', 'Two-colour dreidel', 80, 100, 2, { color: BLUE, color2: GOLD }, dreidelTwo),
  e('dreidel-spinning', 'סביבון מסתובב', 'Spinning dreidel', 100, 100, 2, { color: BLUE, color2: GOLD }, dreidelSpin, REDRAWN),
  e('sufganiya', 'סופגנייה', 'Sufganiya', 100, 100, 2, { color: '#E0A458', color2: CREAM }, sufganiya),
  e('sufganiya-bitten', 'סופגנייה עם נגיסה', 'Sufganiya with a bite out', 100, 100, 2, { color: '#E0A458', color2: CREAM }, sufganiyaBitten),
  e('sufganiyot-plate', 'צלחת סופגניות', 'Plate of sufganiyot', 140, 100, 2, { color: '#E0A458', color2: CREAM }, sufganiyotPlate),
  e('latke', 'לביבות', 'Latkes', 100, 100, 2, { color: '#E8B64C', color2: '#8A4E14' }, latke, REDRAWN),
  e('oil-jug', 'פך שמן', 'Jug of oil', 100, 100, 2, { color: '#B4582A', color2: '#F2B634' }, oilJug, REDRAWN),
  e('gelt-coin', 'דמי חנוכה, מטבע', 'Gelt coin', 100, 100, 2, { color: GOLD, color2: '#A9741A' }, geltCoin),
  e('gelt-stack', 'ערימת מטבעות', 'Stack of gelt', 100, 100, 2, { color: GOLD, color2: '#A9741A' }, geltStack),
  e('gift', 'מתנה', 'Gift', 100, 100, 2, { color: BLUE, color2: GOLD }, gift),
  e('lights-garland', 'שרשרת אורות', 'String of lights', 200, 60, 2, { color: GOLD, color2: '#5A6F94' }, garland, REDRAWN),
  e('frame-candles', 'מסגרת נרות', 'Frame with candles', 160, 100, 2, { color: GOLD, color2: WAX }, frameCandles, REDRAWN),
];
