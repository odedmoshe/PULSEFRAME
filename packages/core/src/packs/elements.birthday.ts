/**
 * The elements of the birthday pack, category 'party' (ADR-0022): drawn by formula with the helpers of elementKit.ts.
 * No letters, no digits, no text on any of them (the badge and the banner are empty on purpose: the title goes on top), no
 * gradient; at most two colours, the second one for the accents. Pure: the same arguments always give the same markup.
 */
import { box, boxS, disc, fillD, g, n, poly, polar, ringC, smoothClosed, star, strokeD, type Body, type PackElementEntry, type Pt } from '../elementKit.ts';

const PINK = '#FF4D8D', WHITE = '#FFFFFF', SUN = '#FFC83D', SKY = '#35B6FF', MINT = '#3DDC97', CREAMY = '#FFF1D0', INK = '#3B2A12';
const EVENODD = ' fill-rule="evenodd"';
const ell = (cx: number, cy: number, rx: number, ry: number, c: string): string => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${c}"/>`;
const flame = (x: number, yb: number, h: number, c: string): string => {
  const w = h * 0.32;
  return fillD(`M${n(x)} ${n(yb - h)}C${n(x + w * 0.45)} ${n(yb - h * 0.7)} ${n(x + w)} ${n(yb - w * 1.15)} ${n(x + w)} ${n(yb - w * 0.7)}A${n(w)} ${n(w)} 0 0 1 ${n(x - w)} ${n(yb - w * 0.7)}C${n(x - w)} ${n(yb - w * 1.15)} ${n(x - w * 0.45)} ${n(yb - h * 0.7)} ${n(x)} ${n(yb - h)}Z`, c);
};
const BALLOON = 'M30 4C50 4 57 22 57 38C57 56 42 68 30 70C18 68 3 56 3 38C3 22 10 4 30 4Z';
const knot = (c: string) => fillD('M25 78L30 69L35 78Z', c);
const string = (k: string, x = 30, y = 78, y2 = 98) => strokeD(`M${n(x)} ${n(y)}Q${n(x - 9)} ${n(y + 7)} ${n(x)} ${n(y + 12)}T${n(x)} ${n(y2)}`, k, 2.2);

const balloon: Body = (c, k) => fillD(BALLOON, c) + knot(c) + string(k) + strokeD('M14 32Q14 20 22 14', k, 3.4);
const balloonShine: Body = (c, k) =>
  fillD('M30 3C52 3 58 24 57 40C56 58 42 69 30 70C18 69 4 58 3 40C2 24 8 3 30 3Z', c) + knot(c) + string(k) +
  fillD('M12 36C10 24 14 14 22 10C16 18 15 28 18 38C16 40 13 40 12 36Z', k) + disc(25, 8.5, 1.6, k);
const balloonHeart: Body = (c, k) =>
  fillD('M30 72C6 52 -1 36 6 22C13 10 26 12 30 24C34 12 47 10 54 22C61 36 54 52 30 72Z', c) + fillD('M25 80L30 71L35 80Z', c) + string(k, 30, 80, 100) +
  strokeD('M12 28Q12 20 19 18', k, 3.2);
const balloonsBunch: Body = (c, k) => {
  const b = (x: number, y: number, s: number) => g(fillD(BALLOON, c) + `<path d="${BALLOON}" fill="none" stroke="${k}" stroke-width="${n(2.4 / s)}"/>`, `matrix(${n(s)} 0 0 ${n(s)} ${n(x)} ${n(y)})`);
  return strokeD('M40 70Q46 84 50 98M70 66Q60 84 50 98M96 70Q80 84 50 98', k, 2) + b(8, 4, 0.9) + b(64, 6, 0.84) + b(34, 14, 0.9)
    + fillD('M45 62L40 72L50 72Z', c) + fillD('M80 58L74 67L86 67Z', c) + fillD('M52 74L57 64L62 74Z', c);
};

// ---- cakes
const dripBand = (x0: number, x1: number, y: number, k: string, drops: number[]): string => {
  const w = (x1 - x0) / drops.length;
  let d = `M${n(x0)} ${n(y - 6)}H${n(x1)}V${n(y)}`;
  for (let i = drops.length - 1; i >= 0; i--) { const xa = x0 + (i + 1) * w, xb = x0 + i * w, dp = drops[i]!; d += `Q${n(xa - w * 0.05)} ${n(y + dp)} ${n(xa - w / 2)} ${n(y + dp)}Q${n(xb + w * 0.05)} ${n(y + dp)} ${n(xb)} ${n(y)}`; }
  return fillD(d + 'Z', k);
};
const cakeBase = (c: string, k: string): string =>
  ell(50, 90, 44, 6, k) + box(12, 58, 76, 30, c, 4) + dripBand(12, 88, 64, k, [6, 3, 8, 3, 6, 4]) + box(26, 36, 48, 24, c, 4) + dripBand(26, 74, 42, k, [5, 8, 4, 7]);
const cake: Body = (c, k) => cakeBase(c, k) + disc(50, 30, 6, c) + strokeD('M50 24Q52 18 56 16', c, 2);
const cakeCandles: Body = (c, k) => {
  let body = cakeBase(c, k);
  for (const x of [36, 50, 64]) body += box(x - 2.6, 20, 5.2, 16, k, 1) + flame(x, 19, 11, c);
  return body;
};
const cupcake: Body = (c, k) => {
  const pleats = [24, 34, 44, 54, 64, 74].map((x) => `M${x} 62L${x + (x - 50) * 0.1} 92`).join('');
  return fillD('M16 56H84L74 94H26Z', c) + strokeD(pleats, k, 2.4) +
    fillD('M14 58C10 46 22 42 26 42C22 30 38 28 42 32C44 20 62 20 64 32C72 28 84 34 76 44C88 46 90 58 84 60Z', k) +
    disc(52, 18, 6, c) + strokeD('M52 12Q54 6 58 5', c, 2.4) + strokeD('M30 48Q50 56 70 48', c, 2.4);
};
const candleBirthday: Body = (c, k) => {
  let stripes = '';
  for (let i = 0; i < 5; i++) { const y = 34 + i * 12; stripes += fillD(`M14 ${n(y)}L36 ${n(y - 8)}V${n(y - 3)}L14 ${n(y + 5)}Z`, c); }
  return box(14, 26, 22, 70, k, 3) + stripes + strokeD('M25 26V18', c, 2.6) + flame(25, 17, 16, c);
};

// ---- hats and crowns
const partyHat: Body = (c, k) => {
  const x0 = (y: number) => 50 - (y - 14) * (36 / 74), x1 = (y: number) => 50 + (y - 14) * (36 / 74);
  let bands = '';
  for (const [a, b] of [[34, 42], [54, 62], [74, 82]] as const) bands += fillD(`M${n(x0(a))} ${n(a)}H${n(x1(a))}L${n(x1(b))} ${n(b)}H${n(x0(b))}Z`, k);
  return fillD('M50 14L86 88H14Z', c) + bands + ell(50, 88, 38, 6, k) + disc(50, 12, 9, k);
};
const crownParty: Body = (c, k) =>
  fillD('M8 80L8 36L30 56L50 22L70 56L92 36L92 80Z', c) + box(8, 78, 84, 12, k, 4) +
  disc(8, 33, 5, k) + disc(50, 19, 5.5, k) + disc(92, 33, 5, k) + disc(30, 68, 4, k) + disc(50, 68, 4, k) + disc(70, 68, 4, k);

// ---- gifts
const giftBox: Body = (c, k) => box(14, 44, 72, 46, c, 4) + box(8, 32, 84, 16, c, 4) + box(44, 32, 12, 58, k) + box(14, 40, 72, 3, k);
const bowLoops = (cx: number, cy: number, s: number, c: string, k: string): string =>
  g(fillD('M0 0C-14 -22 -34 -20 -30 -6C-27 4 -12 2 0 0Z', c) + fillD('M0 0C14 -22 34 -20 30 -6C27 4 12 2 0 0Z', c) + fillD('M0 0L-14 24L-4 22L0 12L4 22L14 24Z', k) + disc(0, 0, 5, k), `matrix(${n(s)} 0 0 ${n(s)} ${n(cx)} ${n(cy)})`);
const giftBow: Body = (c, k) => bowLoops(50, 48, 1.55, c, k);

// ---- strings of things
const bunting: Body = (c, k) => {
  let body = strokeD('M4 8Q100 40 196 8', c, 2.2);
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9, x = 4 + 192 * t, y = 8 + 2 * 32 * t * (1 - t), dy = 0.0 + (1 - 2 * t) * 8;
    body += fillD(`M${n(x - 10)} ${n(y - dy * 0.15 - 1)}L${n(x + 10)} ${n(y + dy * 0.15 - 1)}L${n(x)} ${n(y + 26)}Z`, i % 2 ? k : c);
  }
  return body;
};
const streamer: Body = (c, k) =>
  strokeD('M16 4C60 18 -10 34 30 48C70 62 -4 78 40 96', c, 9) + strokeD('M62 4C96 22 40 40 80 56C100 64 84 84 70 96', k, 7);
const confettiBurst: Body = (c, k) => {
  let body = '';
  const ring = (R: number, count: number, off: number, size: number) => {
    for (let i = 0; i < count; i++) {
      const a = off + (360 * i) / count, [x, y] = polar(50, 50, R, a) as Pt, col = i % 2 ? k : c;
      if (i % 3 === 0) body += disc(x, y, size * 0.6, col);
      else if (i % 3 === 1) body += g(box(-size, -size * 0.45, size * 2, size * 0.9, col, 1), `translate(${n(x)} ${n(y)}) rotate(${n(a + 40)})`);
      else body += g(fillD(poly([[0, -size], [size * 0.9, size * 0.7], [-size * 0.9, size * 0.7]]), col), `translate(${n(x)} ${n(y)}) rotate(${n(a)})`);
    }
  };
  ring(16, 8, 10, 4); ring(30, 12, 0, 4.6); ring(43, 14, 12, 4.2);
  return body;
};
const partyPopper: Body = (c, k) => {
  const cone = fillD('M6 94L26 34L66 74Z', c);
  const bands = fillD('M16 66L32 50L40 58L26 74Z', k) + fillD('M9 86L21 72L28 79L15 91Z', k);
  const rim = strokeD('M26 34L66 74', k, 5);
  const burst = strokeD('M44 40Q50 22 66 20Q80 18 82 6M52 48Q74 40 82 50Q90 58 96 54M58 58Q66 40 88 30', k, 2.6) + disc(66, 20, 3.6, c) + disc(86, 50, 3.6, c) + disc(80, 6, 3, c) + disc(92, 28, 3.2, k) + disc(52, 22, 3, c);
  return cone + bands + rim + burst;
};
const blower: Body = (c, k) => {
  const turn = Array.from({ length: 40 }, (_, i) => polar(72, 40, 18 - i * 0.37, 90 - i * 9) as Pt).map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('');
  return box(4, 52, 26, 14, k, 6) + strokeD('M30 59H72', c, 14) + strokeD(turn, c, 8) + strokeD('M40 52V66M50 52V66M60 52V66', k, 3);
};
const starBurst: Body = (c, k) => fillD(poly(star(50, 50, 48, 36, 16)), c) + ringC(50, 50, 26, k, 5) + disc(50, 50, 10, k) +
  fillD(poly(star(50, 50, 10, 4, 8)), c);

// ---- badges and banners
const numberBadge: Body = (c, k) => {
  const scallops = Array.from({ length: 18 }, (_, i) => polar(50, 44, 40, (360 * i) / 18 - 90) as Pt);
  return fillD('M28 66L18 98L34 90L42 100L50 70Z', k) + fillD('M72 66L82 98L66 90L58 100L50 70Z', k) +
    scallops.map(([x, y]) => disc(x, y, 8, c)).join('') + disc(50, 44, 38, c) + ringC(50, 44, 28, k, 4);
};
const ribbonBanner: Body = (c, k) =>
  fillD('M2 18H34V62H2L12 40Z', k) + fillD('M158 18H126V62H158L148 40Z', k) +
  fillD('M26 66V56H40V66L33 62Z', k) + fillD('M134 66V56H120V66L127 62Z', k) +
  fillD('M26 10H134Q128 18 134 22V56Q128 62 134 66H26Q32 60 26 56V22Q32 16 26 10Z', c) +
  strokeD('M40 20H120M40 56H120', k, 2.4);

// ---- frames
const framePolaroid: Body = (c, k) =>
  fillD(`M6 6H94V114H6Z M16 14H84V84H16Z`, c, EVENODD) + fillD('M34 0H66L62 12H38Z', k) + strokeD('M30 98Q50 106 70 98', k, 3);
const frameBunting: Body = (c, k) => {
  let body = boxS(6, 6, 148, 88, c, 3.4, 8);
  for (let i = 0; i < 8; i++) { const x = 18 + i * 17.7; body += fillD(`M${n(x - 8)} 9L${n(x + 8)} 9L${n(x)} 29Z`, i % 2 ? k : c); }
  return body;
};

// ---- sweets and faces
const lollipop: Body = (c, k) => {
  const spiral = Array.from({ length: 60 }, (_, i) => polar(50, 38, 2 + i * 0.56, i * 28) as Pt).map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('');
  return box(46, 64, 8, 34, k, 4) + disc(50, 38, 34, c) + strokeD(spiral, k, 4.4);
};
const iceCream: Body = (c, k) =>
  fillD('M26 54H74L50 98Z', k) + strokeD('M34 64L58 80M42 58L66 74M66 58L42 74M58 58L34 74M50 98L34 74M50 98L66 74', c, 1.8) +
  fillD('M18 56C14 40 26 32 36 34C34 22 46 14 58 18C68 12 80 22 74 34C84 38 86 52 82 56Q76 62 70 56Q64 64 58 56Q52 64 46 56Q40 64 34 56Q26 62 18 56Z', c) + disc(54, 12, 5, k) + strokeD('M54 8Q56 2 61 2', k, 2);
const partyFace: Body = (c, k) =>
  disc(50, 62, 34, c) + disc(38, 58, 4.6, k) + disc(62, 58, 4.6, k) + strokeD('M33 72Q50 88 67 72', k, 4.6) +
  g(fillD('M0 -26L14 8H-14Z', k) + disc(0, -28, 5, c), 'translate(52 32) rotate(-14)') ;

const e = (slug: string, he: string, en: string, width: number, height: number, colors: 1 | 2, color: string, color2: string | undefined, body: Body): PackElementEntry =>
  ({ slug, category: 'party', he, en, width, height, colors, defaults: { color, ...(color2 ? { color2 } : {}) }, body });

export const BIRTHDAY_ELEMENTS: readonly PackElementEntry[] = [
  e('balloon', 'בלון', 'Balloon', 60, 100, 2, PINK, WHITE, balloon),
  e('balloon-shine', 'בלון מבריק', 'Shiny balloon', 60, 100, 2, SKY, WHITE, balloonShine),
  e('balloons-bunch', 'צרור בלונים', 'Bunch of balloons', 120, 100, 2, SUN, WHITE, balloonsBunch),
  e('balloon-heart', 'בלון לב', 'Heart balloon', 60, 100, 2, PINK, WHITE, balloonHeart),
  e('cake', 'עוגה', 'Cake', 100, 100, 2, PINK, CREAMY, cake),
  e('cake-candles', 'עוגה עם נרות', 'Cake with candles', 100, 100, 2, PINK, CREAMY, cakeCandles),
  e('cupcake', 'קאפקייק', 'Cupcake', 100, 100, 2, SKY, WHITE, cupcake),
  e('candle-birthday', 'נר יום הולדת', 'Birthday candle', 50, 100, 2, PINK, WHITE, candleBirthday),
  e('party-hat', 'כובע מסיבה', 'Party hat', 100, 100, 2, MINT, SUN, partyHat),
  e('crown-party', 'כתר מסיבה', 'Party crown', 100, 100, 2, SUN, PINK, crownParty),
  e('gift-box', 'קופסת מתנה', 'Gift box', 100, 100, 2, SKY, SUN, giftBox),
  e('gift-bow', 'פפיון מתנה', 'Gift bow', 100, 100, 2, PINK, SUN, giftBow),
  e('bunting', 'שרשרת דגלונים', 'Bunting', 200, 60, 2, PINK, SUN, bunting),
  e('streamer', 'סרט קשקשים', 'Streamer', 100, 100, 2, PINK, SKY, streamer),
  e('confetti-burst', 'התפוצצות קונפטי', 'Confetti burst', 100, 100, 2, PINK, SUN, confettiBurst),
  e('party-popper', 'מפוצץ קונפטי', 'Party popper', 100, 100, 2, SUN, PINK, partyPopper),
  e('blower', 'חצוצרת מסיבה', 'Party blower', 100, 100, 2, PINK, SUN, blower),
  e('star-burst', 'התפרצות כוכב', 'Star burst', 100, 100, 2, SUN, PINK, starBurst),
  e('number-badge', 'תג ריק למספר', 'Empty badge for a number', 100, 100, 2, SUN, PINK, numberBadge),
  e('ribbon-banner', 'סרט כותרת', 'Ribbon banner', 160, 80, 2, PINK, '#C21D63', ribbonBanner),
  e('frame-polaroid', 'מסגרת פולארויד', 'Polaroid frame', 100, 120, 2, WHITE, SUN, framePolaroid),
  e('frame-bunting', 'מסגרת דגלונים', 'Frame with bunting', 160, 100, 2, PINK, SUN, frameBunting),
  e('lollipop', 'סוכריה על מקל', 'Lollipop', 100, 100, 2, PINK, WHITE, lollipop),
  e('ice-cream', 'גלידה', 'Ice cream', 100, 100, 2, '#FF8FB1', '#E8B66E', iceCream),
  e('party-face', 'פרצוף חוגג', 'Party face', 100, 100, 2, SUN, INK, partyFace),
];
void smoothClosed; void box;
