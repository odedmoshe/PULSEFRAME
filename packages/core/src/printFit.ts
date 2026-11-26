/**
 * Paper shapes and pixels per inch for «שמירת התמונה» (wave 8 cover, version 1; cover-plan §3.2 with verify C13's divisor). Lead
 * pre-pass: constants and signatures; W2 builds the bodies (pure, integers). The ppi line is a RULE OF THUMB from the pixel count
 * only («כלל אצבע לפי מספר הפיקסלים בלבד»): blur, noise and compression are not counted, and no tier is ever called good.
 *
 * Formula: a paper of W × H tenths of a millimetre (portrait; landscape swaps them) holding a crop of w × h source pixels:
 * ppi = floor(min(w · 254 / W, h · 254 / H)). Examples (formula, not measured): 1920×1080 → 10×15 landscape crop 1620×1080 →
 * 270 ppi 'usual'; A4 landscape 1527×1080 → 130 'soft'; 3840×2160 → A4 landscape 261 'usual'.
 */
import { stillsRefusal, type Orientation, type PaperId, type StillCrop } from './stillsContract.ts';

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

/** Pixels per inch of `crop` printed on `paper` in `orientation`, and its tier. W2. */
export function printFit(crop: Pick<StillCrop, 'w' | 'h'>, paper: PaperId, orientation: Orientation): PrintFit {
  void crop; void paper; void orientation;
  throw stillsRefusal('stillNotBuilt', []);
}
/** The largest centred rectangle of the paper's shape inside a w × h picture, integer pixels. W2. */
export function defaultCrop(width: number, height: number, paper: PaperId, orientation: Orientation): StillCrop {
  void width; void height; void paper; void orientation;
  throw stillsRefusal('stillNotBuilt', []);
}
/**
 * `crop` moved or resized by the owner, brought back inside the picture and to the paper's shape within one pixel (the size is
 * kept as far as it fits; the centre is kept as far as the picture allows). W2.
 */
export function snapCrop(crop: StillCrop, width: number, height: number, paper: PaperId, orientation: Orientation): StillCrop {
  void crop; void width; void height; void paper; void orientation;
  throw stillsRefusal('stillNotBuilt', []);
}
/** Whether `crop` has the paper's shape within one pixel (the export's still_options check, the same rule as snapCrop). W2. */
export function cropFitsPaper(crop: Pick<StillCrop, 'w' | 'h'>, paper: PaperId, orientation: Orientation): boolean {
  void crop; void paper; void orientation;
  throw stillsRefusal('stillNotBuilt', []);
}
