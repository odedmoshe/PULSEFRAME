/**
 * Paper shapes and pixels per inch for «שמירת התמונה» (wave 8 cover, version 1; cover-plan §3.2 with verify C13's divisor). Lead
 * pre-pass: constants and signatures; W2 builds the bodies (pure, integers). The ppi line is a RULE OF THUMB from the pixel count
 * only («כלל אצבע לפי מספר הפיקסלים בלבד»): blur, noise and compression are not counted, and no tier is ever called good.
 *
 * Formula: a paper of W × H tenths of a millimetre (portrait; landscape swaps them) holding a crop of w × h source pixels:
 * ppi = floor(min(w · 254 / W, h · 254 / H)). Examples (formula, not measured): 1920×1080 → 10×15 landscape crop 1620×1080 →
 * 270 ppi 'usual'; A4 landscape 1527×1080 → 130 'soft'; 3840×2160 → A4 landscape 261 'usual'.
 */
import { type Orientation, type PaperId, type StillCrop } from './stillsContract.ts';

/** Paper sizes in tenths of a millimetre, portrait (w < h). 10×15 is 4×6 in, 13×18 is 5×7 in. */
export const PAPERS: Readonly<Record<PaperId, { w: number; h: number; he: string; en: string }>> = {
  '10x15': { w: 1016, h: 1524, he: '10×15 ס״מ', en: '10×15 cm' },
  '13x18': { w: 1270, h: 1778, he: '13×18 ס״מ', en: '13×18 cm' },
  a4: { w: 2100, h: 2970, he: 'A4', en: 'A4' },
};
/** Tenths of a millimetre per inch. */
export const TENTHS_PER_INCH = 254;
/** Rule-of-thumb tiers, highest first: the first whose `min` the ppi reaches. Words: i18n cover.tier.<key> (never «טוב»). */
export const PPI_TIERS = [{ min: 300, key: 'dense' }, { min: 200, key: 'usual' }, { min: 150, key: 'borderline' }, { min: 0, key: 'soft' }] as const;
export type PpiTier = (typeof PPI_TIERS)[number]['key'];
export interface PrintFit { ppi: number; tier: PpiTier }

/** The paper's sides in tenths of a millimetre as the crop sees them: portrait as stored (w < h), landscape swapped. */
function sides(paper: PaperId, orientation: Orientation): { pw: number; ph: number } {
  const p = PAPERS[paper];
  return orientation === 'landscape' ? { pw: p.h, ph: p.w } : { pw: p.w, ph: p.h };
}
const whole = (n: number, what: string) => { if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`${what} must be a whole number of pixels above 0, not ${n}`); };

/**
 * Pixels per inch of `crop` printed on `paper` in `orientation`, and its tier: ppi = floor(min(w · 254 / PW, h · 254 / PH)) with
 * PW × PH the paper's sides in tenths of a millimetre as printed (landscape swaps them). Integers only. A rule of thumb from the
 * pixel count; the first tier whose `min` the ppi reaches.
 */
export function printFit(crop: Pick<StillCrop, 'w' | 'h'>, paper: PaperId, orientation: Orientation): PrintFit {
  whole(crop.w, 'crop width'); whole(crop.h, 'crop height');
  const { pw, ph } = sides(paper, orientation);
  const ppi = Math.min(Math.floor((crop.w * TENTHS_PER_INCH) / pw), Math.floor((crop.h * TENTHS_PER_INCH) / ph));
  const tier = PPI_TIERS.find((t) => ppi >= t.min)!.key;
  return { ppi, tier };
}
/**
 * THE ONE-PIXEL RULE (used by cropFitsPaper, snapCrop and defaultCrop): a w × h crop has the shape of a PW × PH paper when
 * |w · PH − h · PW| ≤ max(PW, PH) — in words, at least one of its sides is within one pixel of the exact side the other one asks
 * for (|w − h·PW/PH| ≤ 1 or |h − w·PH/PW| ≤ 1, whichever is the looser for this paper). Integers, no rounding of fractions.
 */
function shapeError(w: number, h: number, pw: number, ph: number): number { return Math.abs(w * ph - h * pw); }
/** Whether `crop` has the paper's shape within one pixel (the export's still_options check, the same rule as snapCrop). */
export function cropFitsPaper(crop: Pick<StillCrop, 'w' | 'h'>, paper: PaperId, orientation: Orientation): boolean {
  if (!Number.isSafeInteger(crop.w) || !Number.isSafeInteger(crop.h) || crop.w < 1 || crop.h < 1) return false;
  const { pw, ph } = sides(paper, orientation);
  return shapeError(crop.w, crop.h, pw, ph) <= Math.max(pw, ph);
}
/** round(a / b) for positive integers, halves up (exact). */
const roundDiv = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));
/** The paper-shaped size with width w (h from w), or with height h (w from h), each side nearest the exact value. */
const fromW = (w: number, pw: number, ph: number) => ({ w, h: roundDiv(w * ph, pw) });
const fromH = (h: number, pw: number, ph: number) => ({ w: roundDiv(h * pw, ph), h });
/** The largest paper-shaped size inside width × height (the longer fitting side kept whole, the other nearest; never outside). */
function largest(width: number, height: number, pw: number, ph: number): { w: number; h: number } {
  // the picture is at least as wide as the paper's shape: the height is kept, the width follows; otherwise the reverse
  if (width * ph >= height * pw) { const s = fromH(height, pw, ph); return s.w <= width ? s : { w: Math.floor((height * pw) / ph), h: height }; }
  const s = fromW(width, pw, ph);
  return s.h <= height ? s : { w: width, h: Math.floor((width * ph) / pw) };
}
/** The largest centred rectangle of the paper's shape inside a w × h picture, integer pixels (left/top take the odd pixel). */
export function defaultCrop(width: number, height: number, paper: PaperId, orientation: Orientation): StillCrop {
  whole(width, 'picture width'); whole(height, 'picture height');
  const { pw, ph } = sides(paper, orientation);
  const s = largest(width, height, pw, ph);
  return { x: Math.floor((width - s.w) / 2), y: Math.floor((height - s.h) / 2), w: s.w, h: s.h };
}
/**
 * `crop` moved or resized by the owner, brought back inside the picture and to the paper's shape within one pixel (the size is
 * kept as far as it fits; the centre is kept as far as the picture allows). The side that leads is the one the crop is relatively
 * longer in (so a crop already of the paper's shape keeps its size exactly, and a moved crop only moves); the other side is the
 * nearest whole pixel. A crop larger than the picture becomes defaultCrop's size; a side under 16 pixels (the export's least) is
 * raised to 16 when the picture allows it.
 */
export function snapCrop(crop: StillCrop, width: number, height: number, paper: PaperId, orientation: Orientation): StillCrop {
  whole(width, 'picture width'); whole(height, 'picture height');
  const { pw, ph } = sides(paper, orientation);
  const max = largest(width, height, pw, ph);
  const cw = Math.max(1, Math.round(crop.w)), chh = Math.max(1, Math.round(crop.h));
  let s = cw * ph >= chh * pw ? fromW(Math.min(cw, max.w), pw, ph) : fromH(Math.min(chh, max.h), pw, ph);
  if (s.w > width || s.h > height || s.w < 1 || s.h < 1) s = max;
  // the export's least side (StillCropSchema): raise the shorter side to 16 when the picture has room
  const MIN = 16;
  if (Math.min(s.w, s.h) < MIN) {
    const up = s.w <= s.h ? fromW(MIN, pw, ph) : fromH(MIN, pw, ph);
    const fixed = up.w < MIN ? fromH(MIN, pw, ph) : up.h < MIN ? fromW(MIN, pw, ph) : up;
    if (fixed.w <= width && fixed.h <= height) s = fixed;
  }
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  // keep the centre: x = round(cx − w/2) with cx = crop.x + crop.w/2, in integers
  const x = clamp(Math.floor((2 * Math.round(crop.x) + cw - s.w + 1) / 2), 0, width - s.w);
  const y = clamp(Math.floor((2 * Math.round(crop.y) + chh - s.h + 1) / 2), 0, height - s.h);
  return { x, y, w: s.w, h: s.h };
}
