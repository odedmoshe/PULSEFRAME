/**
 * Curve maths of keyframe curves (ADR-0019, W1 bodies; the lead's contracts commit fixes the signatures). Pure and
 * deterministic: the same inputs give the same Float64 results on every host (packages/evals keyframes-proof P12 compares a
 * hash of 1e5 samples between Node and Chromium), so the bisection uses only + − × ÷ and comparisons, never Math.cbrt/acos.
 *
 * PLACEHOLDERS of the lead's contracts commit: every function below refuses (throws "… is not built yet") until W1 fills it,
 * and CURVES_BUILT is false. While it is false, no key with a new curve can enter a document: the operations refuse them
 * (ops.ts refuseUnbuiltCurve) and validation reports them (validate.ts 'keyframe_curve'), so the sampler never meets one.
 */
import type * as T from '@pulseframe/time';
import type { CurveHandles, Easing, Keyframe, V1Easing, ValueRange } from './keyframe.ts';

/** True once W1 has built the curve maths, the sampler branches and the curve rules. Flipped by W1 only. */
export const CURVES_BUILT = false;
/** Exactly this many halvings of [0, 1] find s with X(s) = u in cubicBezierShape. */
export const BISECTION_STEPS = 48;

const notBuilt = (what: string): never => { throw new Error(`${what} is not built yet (ADR-0019 W1)`); };

/** Y(s) where X(s) = u, s found by exactly BISECTION_STEPS halvings of [0, 1] (Horner evaluation). u ≤ 0 → 0, u ≥ 1 → 1. */
export function cubicBezierShape(h: readonly [number, number, number, number], u: number): number { void h; void u; return notBuilt('cubicBezierShape'); }
/** Penner ease-out-bounce: f(0.5) = 0.765625; |f(1/2.75) − 1| ≤ 2e-16. */
export function bounceShape(u: number): number { void u; return notBuilt('bounceShape'); }
/** 1 − (1−u)·e^(−4u)·cos(3πu): peaks at about 1.2059 near u = 0.278, three turns. */
export function springShape(u: number): number { void u; return notBuilt('springShape'); }
/** The shape (0 at u = 0, 1 at u = 1, unclamped) of gentle, sharp, overshoot, anticipate, bounce, spring or bezier. */
export function curveShape(easing: Exclude<Easing, V1Easing | 'smooth'>, bezier: CurveHandles | undefined, u: number): number { void easing; void bezier; void u; return notBuilt('curveShape'); }
/**
 * Steffen (1990) slope at key i in value units per second, from the exact rational gaps between keys. 0 at the first and last
 * key and where the neighbouring secants change sign, so 'smooth' never goes past a key value.
 */
export function steffenSlope(keys: readonly Keyframe[], i: number): number { void keys; void i; return notBuilt('steffenSlope'); }
/** The value of the 'smooth' segment keys[lo] → keys[lo + 1] at u (cubic Hermite with steffenSlope at both ends). Two resting keys give smoothstep. */
export function smoothValue(keys: readonly Keyframe[], lo: number, u: number): number { void keys; void lo; void u; return notBuilt('smoothValue'); }
/** True for overshoot, anticipate, bounce, spring, and a 'bezier' whose y1 or y2 lies outside [0, 1]. */
export function turnsBack(easing: Easing, bezier?: CurveHandles): boolean { void easing; void bezier; return notBuilt('turnsBack'); }
/** The exact cubic handles of a segment's easing, or null (hold, ease-in-out, smooth, bounce, spring). */
export function exactHandles(easing: Easing, bezier?: CurveHandles): readonly [number, number, number, number] | null { void easing; void bezier; return notBuilt('exactHandles'); }

export interface SplitResult { keys: Keyframe[]; exact: boolean; maxDeviation: number }
/**
 * Insert a key at `at`, strictly inside the span of `keys` and not on an existing key, at the curve's own value:
 * - linear → linear; hold → the held value, with 'hold';
 * - every curve with exactHandles → both halves become 'bezier' (de Casteljau at s* where X(s*) = u, each half renormalised).
 *   Exact unless a renormalised handle leaves CurveHandlesSchema (x outside [0, 1], e.g. 1.333 for x1 = 1, x2 = 0 split at
 *   s = 0.75; or y outside [−1, 2]) or a half's value change is 0: then the handle is clamped and exact = false;
 * - ease-in-out, smooth, bounce, spring → the sampled value; the new key takes the segment's easing; exact = false.
 * maxDeviation = max |after − before| in value units over the segment's frames at `rate`, sampled with `range`.
 * Callers use it only where the segment's start key has a NEW curve (keyframe.ts: v1 segments keep today's insertion rule).
 */
export function splitSegment(keys: readonly Keyframe[], at: T.RationalTime, rate: T.Rate, range: ValueRange): SplitResult { void keys; void at; void rate; void range; return notBuilt('splitSegment'); }
