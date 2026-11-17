/**
 * Colour match «התאמת צבע» and automatic colour balance «איזון צבע אוטומטי» (ADR-0014): a model of the color.grade effect, picture
 * statistics in CIELAB and the fit of grade values. gradePixel is used to fit and to prove, never to render (ADR-0008 decision 2;
 * the digicamTone precedent, gpu.ts): the picture is always drawn by the WGSL pass. Deterministic: no randomness, fixed order.
 *
 * SKELETON of the lead's contracts pass (plan "Lead contracts" 11): W3 implements every body.
 */

export interface GradeParams { exposure: number; temperature: number; tint: number; contrast: number; saturation: number; shadows: number; highlights: number; fade: number }
/** The color.grade defaults (core effects.ts): no change. */
export const GRADE_DEFAULTS: GradeParams = Object.freeze({ exposure: 0, temperature: 0, tint: 0, contrast: 1, saturation: 1, shadows: 0, highlights: 0, fade: 0 });
/** color.grade on one straight non-linear RGB value 0..1, step for step as gpu.ts:295-302. A proof/fit model only, never rendered. */
export function gradePixel(_rgb: readonly [number, number, number], _p: Readonly<GradeParams>): [number, number, number] {
  throw new Error('not implemented: W3');
}
export interface PictureSample { rgb: Float64Array; count: number }
export function samplePicture(_rgba: Uint8Array | Uint8ClampedArray, _width: number, _height: number, _maxSamples = 4096): PictureSample {
  throw new Error('not implemented: W3');
}
export function mergeSamples(_parts: readonly PictureSample[]): PictureSample {
  throw new Error('not implemented: W3');
}
export interface PictureStats { count: number; lPct: [number, number, number, number, number]; meanA: number; meanB: number; meanC: number; rgbMedian: [number, number, number] }
/** CIELAB D65 from linearised sRGB. lPct = L* at 2/10/50/90/98 %; a*, b*, C* means over mid-tones (20 ≤ L* ≤ 85). */
export function pictureStats(_s: PictureSample): PictureStats {
  throw new Error('not implemented: W3');
}
/** Mid-tone ΔE76 plus the mean L* percentile error: the residual shown to users. */
export function statsDistance(_a: PictureStats, _b: PictureStats): number {
  throw new Error('not implemented: W3');
}
/** close: residual ≤ 2, noticeable: ≤ 5, else partial. */
export interface GradeFit { params: GradeParams; residual: number; verdict: 'close' | 'noticeable' | 'partial'; limitedBy: (keyof GradeParams)[] }
export function fitGrade(_target: PictureSample, _reference: PictureStats, _opts: { hold: Pick<GradeParams, 'shadows' | 'highlights' | 'fade'>; amount: number }): GradeFit {
  throw new Error('not implemented: W3');
}
export function balanceGrade(_target: PictureSample, _opts: { amount: number }): GradeFit {
  throw new Error('not implemented: W3');
}
