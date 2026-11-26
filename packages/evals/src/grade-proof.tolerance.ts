/**
 * The SLOPE-AWARE tolerance of proof:grade's model checks G5, G6 and G6b (grade-verify C6), written by the lead in the pre-pass so that
 * nobody loosens it later. A builder who meets a failure here REPORTS it (adapter, worst value, the pixel, S, δ₀); the numbers below
 * are not changed to make a run pass, here or on the laptop (L1).
 *
 * Why it depends on the slope: model-vs-pass error after a curve ≈ 0.5 + S·(δ + e_in) codes, S = the table's local step at the
 * pixel's input, δ = the f32/`pow` discrepancy of the slider stage in codes, e_in = the straight colour lost in the premultiplied 8-bit
 * layer (up to 1/(2a) codes, ≈ 1 code at alpha 128, then ×a on output). At alpha 128 and S = 4 that is about 2.5 codes: a fixed 2/255
 * would fail on an ordinary contrast curve for reasons that are not the curve's.
 *  - gentle-opaque: every step of the curve ≤ GENTLE_STEP_MAX, alpha 255: within 2 codes (the grade's own model tolerance, M1).
 *  - gentle-translucent: every step ≤ GENTLE_STEP_MAX, alpha < 255: within 3 codes of T[…]·α (the LUT precedent, gpu-proof.ts).
 *  - steep-opaque (G6b): S ≥ STEEP_STEP_MIN, alpha 255: within 0.5 + S·δ₀ codes, with δ₀ = the worst |model − pass| of the SAME
 *    sliders WITHOUT curves, measured in the SAME run on the SAME adapter (in codes), and recorded beside the result.
 *  - anything else (a translucent pixel on a steep curve, or 3 < S < 40) is NOT a check: curveTolerance throws, so no fixture may
 *    put pixels there and call the result a pass.
 * The model takes the pixel the pass reads: the 8-bit PREMULTIPLIED value un-premultiplied (straightFromPremultiplied, the LUT proof's
 * way), not the fixture's straight colour.
 */
/** G5's opaque bands with NEUTRAL sliders: the input is an exact code and f = 0, so the pass reads T[v] itself: within 1 code (≥ 99 % of columns exact). */
export const NEUTRAL_OPAQUE_CODES = 1;
export const GENTLE_STEP_MAX = 3;
export const STEEP_STEP_MIN = 40;
export const GENTLE_OPAQUE_CODES = 2;
export const GENTLE_TRANSLUCENT_CODES = 3;
export const STEEP_BASE_CODES = 0.5;

export type ToleranceBand = 'gentle-opaque' | 'gentle-translucent' | 'steep-opaque';
export class NotACheck extends Error { constructor(why: string) { super(`not a check of proof:grade: ${why}`); } }

/** The largest step of a table between neighbouring entries (a curve is "gentle" when this is ≤ GENTLE_STEP_MAX everywhere). */
export function maxStep(table: ArrayLike<number>): number {
  let s = 0;
  for (let i = 1; i < table.length; i++) s = Math.max(s, Math.abs(table[i]! - table[i - 1]!));
  return s;
}
/** The local step S at a straight input o (0..1) the way the pass reads it: i = min(floor(255·o), 254), S = max(|T[i+1] − T[i]|, |T[i] − T[i−1]|). */
export function localStep(table: ArrayLike<number>, o: number): number {
  const i = Math.min(Math.floor(255 * Math.min(1, Math.max(0, o))), 254);
  return Math.max(Math.abs(table[i + 1]! - table[i]!), i > 0 ? Math.abs(table[i]! - table[i - 1]!) : 0);
}
/** The straight value 0..1 the pass sees for an 8-bit premultiplied channel `pre` at alpha `a` (1..255): min(1, pre / a). */
export function straightFromPremultiplied(pre: number, a: number): number {
  if (!(a >= 1 && a <= 255) || !Number.isInteger(a)) throw new RangeError(`alpha ${a} is not 1..255`);
  return Math.min(1, pre / a);
}
/**
 * The tolerance in codes (0..255) of one pixel. `S` is the curve's step that applies (maxStep of the whole curve for the gentle bands,
 * localStep at the pixel for steep-opaque); `delta0` is required for steep-opaque and must be a measured finite number ≥ 0.
 */
export function curveTolerance(band: ToleranceBand, S: number, delta0?: number): number {
  if (!(S >= 0) || !Number.isFinite(S)) throw new RangeError(`step ${S}`);
  if (band === 'gentle-opaque' || band === 'gentle-translucent') {
    if (S > GENTLE_STEP_MAX) throw new NotACheck(`a ${band} pixel on a curve with step ${S} > ${GENTLE_STEP_MAX}`);
    return band === 'gentle-opaque' ? GENTLE_OPAQUE_CODES : GENTLE_TRANSLUCENT_CODES;
  }
  if (S < STEEP_STEP_MIN) throw new NotACheck(`a steep-opaque pixel needs a local step ≥ ${STEEP_STEP_MIN}, this one has ${S}`);
  if (delta0 === undefined || !Number.isFinite(delta0) || delta0 < 0) throw new NotACheck('δ₀ (the same sliders without curves, measured in this run) is missing');
  return STEEP_BASE_CODES + S * delta0;
}
