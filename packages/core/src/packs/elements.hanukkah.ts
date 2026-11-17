/**
 * The elements of the Hanukkah pack, category 'holiday' (ADR-0022): drawn by formula with the helpers of elementKit.ts.
 * The symbols are the ones the owner approved (wave 5): the hanukkiah, the dreidel, sufganiyot, the oil jug and gelt, and
 * the things around them (candles, a latke, a gift, a garland). No letters on any of them (the dreidel's four faces carry a
 * lozenge, not a letter), no text, no gradient, no six-point star; at most two colours, the second one for the accents.
 * Pure: the same arguments always give the same markup.
 */
import { both, box, boxS, disc, fillD, g, n, poly, polar, regular, rot, smoothClosed, star, strokeD, type Body, type PackElementEntry, type Pt } from '../elementKit.ts';

const GOLD = '#F5C542', WAX = '#D6E6FF', BLUE = '#3A6BD8', CREAM = '#FFF4D6';
const EVENODD = ' fill-rule="evenodd"';

/** A flame (teardrop) whose base sits on y = yb; h is its height. With `core` a smaller flame in the second colour sits inside. */
const flame = (x: number, yb: number, h: number, c: string, core?: string): string => {
  const w = h * 0.32, r = w, top = yb - h;
  const d = `M${n(x)} ${n(top)}C${n(x + r * 0.45)} ${n(top + h * 0.3)} ${n(x + w)} ${n(yb - r * 1.15)} ${n(x + w)} ${n(yb - r * 0.7)}A${n(w)} ${n(w)} 0 0 1 ${n(x - w)} ${n(yb - r * 0.7)}C${n(x - w)} ${n(yb - r * 1.15)} ${n(x - r * 0.45)} ${n(top + h * 0.3)} ${n(x)} ${n(top)}Z`;
  return fillD(d, c) + (core ? g(fillD(d, core), `matrix(0.45 0 0 0.45 ${n(x * 0.55)} ${n(yb - (yb - top) * 0.45 - 1)})`) : '');
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
  const swish = strokeD('M10 30Q2 52 12 74', k, 3.6) + strokeD('M90 26Q99 50 88 72', k, 3.6) + strokeD('M18 40Q12 54 18 66', k, 2.6) + strokeD('M82 38Q88 52 82 64', k, 2.6) + strokeD('M24 98Q50 105 76 98', k, 3);
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
const LATKE: Pt[] = Array.from({ length: 14 }, (_, i) => polar(50, 52, 37 + [0, 3, -2, 4, 1, -3, 2, 4, -2, 1, 3, -3, 2, -1][i]!, (360 * i) / 14 + 8));
const latke: Body = (c, k) => {
  const rim = smoothClosed(LATKE.map(([x, y]) => [50 + (x - 50) * 0.84, 52 + (y - 52) * 0.84] as Pt));
  const shreds = [[28, 40, 38, 36], [44, 34, 56, 38], [62, 38, 72, 44], [24, 54, 36, 58], [46, 50, 58, 48], [64, 56, 76, 54], [30, 68, 42, 72], [52, 66, 62, 70], [68, 68, 74, 64], [38, 46, 44, 56]] as const;
  return fillD(smoothClosed(LATKE), k) + fillD(rim, c) + shreds.map(([a, b, x, y]) => strokeD(`M${a} ${b}Q${(a + x) / 2} ${(b + y) / 2 - 4} ${x} ${y}`, k, 3)).join('');
};
const oilJug: Body = (c, k) =>
  fillD('M38 12H62L60 25C78 31 86 48 84 66C82 82 72 92 50 92C28 92 18 82 16 66C14 48 22 31 40 25Z', c) +
  fillD('M35 6H65Q67 6 67 9V13Q67 14 65 14H35Q33 14 33 13V9Q33 6 35 6Z', c) +
  strokeD('M82 40C100 36 100 68 82 72', c, 6) +
  strokeD('M17 56Q50 66 83 56', k, 4) + strokeD('M18 72Q50 82 82 72', k, 4) +
  fillD('M12 12C15 19 20 23 20 28A8 8 0 0 1 4 28C4 23 9 19 12 12Z', k);
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

const e = (slug: string, he: string, en: string, width: number, height: number, colors: 1 | 2, defaults: { color: string; color2?: string }, body: Body): PackElementEntry => ({ slug, category: 'holiday', he, en, width, height, colors, defaults, body });

export const HANUKKAH_ELEMENTS: readonly PackElementEntry[] = [
  ...Array.from({ length: 8 }, (_, i) => e(`hanukkiah-${i + 1}`, `חנוכייה, ${['נר ראשון', 'שני נרות', 'שלושה נרות', 'ארבעה נרות', 'חמישה נרות', 'שישה נרות', 'שבעה נרות', 'שמונה נרות'][i]}`, `Hanukkiah, ${i + 1} ${i ? 'candles' : 'candle'} lit`, 120, 100, 2, { color: GOLD, color2: WAX }, hanukkiah(i + 1))),
  e('hanukkiah-outline', 'חנוכייה בקו מתאר', 'Hanukkiah outline', 120, 100, 1, { color: GOLD }, hanukkiahOutline),
  e('candle', 'נר', 'Candle', 60, 100, 2, { color: GOLD, color2: WAX }, (c, k) => candleBody(c, k, false)),
  e('candle-lit', 'נר דולק', 'Lit candle', 60, 100, 2, { color: GOLD, color2: WAX }, (c, k) => candleBody(c, k, true)),
  e('candle-row', 'שורת נרות', 'Row of candles', 160, 80, 2, { color: GOLD, color2: WAX }, candleRow),
  e('dreidel', 'סביבון', 'Dreidel', 80, 100, 1, { color: BLUE }, dreidelOne),
  e('dreidel-two-colour', 'סביבון בשני צבעים', 'Two-colour dreidel', 80, 100, 2, { color: BLUE, color2: GOLD }, dreidelTwo),
  e('dreidel-spinning', 'סביבון מסתובב', 'Spinning dreidel', 100, 100, 2, { color: BLUE, color2: GOLD }, dreidelSpin),
  e('sufganiya', 'סופגנייה', 'Sufganiya', 100, 100, 2, { color: '#E0A458', color2: CREAM }, sufganiya),
  e('sufganiya-bitten', 'סופגנייה עם נגיסה', 'Sufganiya with a bite out', 100, 100, 2, { color: '#E0A458', color2: CREAM }, sufganiyaBitten),
  e('sufganiyot-plate', 'צלחת סופגניות', 'Plate of sufganiyot', 140, 100, 2, { color: '#E0A458', color2: CREAM }, sufganiyotPlate),
  e('latke', 'לביבה', 'Latke', 100, 100, 2, { color: '#E8B64C', color2: '#B7721E' }, latke),
  e('oil-jug', 'פך שמן', 'Jug of oil', 100, 100, 2, { color: '#C96A2B', color2: CREAM }, oilJug),
  e('gelt-coin', 'דמי חנוכה, מטבע', 'Gelt coin', 100, 100, 2, { color: GOLD, color2: '#A9741A' }, geltCoin),
  e('gelt-stack', 'ערימת מטבעות', 'Stack of gelt', 100, 100, 2, { color: GOLD, color2: '#A9741A' }, geltStack),
  e('gift', 'מתנה', 'Gift', 100, 100, 2, { color: BLUE, color2: GOLD }, gift),
  e('lights-garland', 'שרשרת אורות', 'String of lights', 200, 60, 2, { color: GOLD, color2: '#8FA6C9' }, garland),
  e('frame-candles', 'מסגרת נרות', 'Frame with candles', 160, 100, 2, { color: GOLD, color2: WAX }, frameCandles),
];
// unused helpers are kept out of the build by the compiler's noUnusedLocals: nothing below this line
void both; void boxS; void regular; void rot;
