/**
 * Curve maths of keyframe curves (ADR-0019, W1 bodies; the lead's contracts commit fixes the signatures). Pure and
 * deterministic: the same inputs give the same Float64 results on every host (packages/evals keyframes-proof P12 compares a
 * hash of 1e5 samples between Node and Chromium), so the bisection uses only + − × ÷ and comparisons, never Math.cbrt/acos.
 *
 * W1 (ADR-0019): the bodies are built and CURVES_BUILT is true. animation.ts samples the new curves through curveShape and
 * smoothValue (clamped to the channel's range there); splitSegment samples through animation.ts sampleKeyframes (a call-time
 * import: the two modules import each other, and neither uses the other while it is being evaluated).
 */
import * as T from '@pulseframe/time';
import { CURVES, NAMED_BEZIER, TURN_BACK_EASINGS, type CurveHandles, type Easing, type Keyframe, type V1Easing, type ValueRange } from './keyframe.ts';
import { sampleKeyframes } from './animation.ts';

/** True once W1 has built the curve maths, the sampler branches and the curve rules. Flipped by W1 only. */
export const CURVES_BUILT = true;
/** Exactly this many halvings of [0, 1] find s with X(s) = u in cubicBezierShape. */
export const BISECTION_STEPS = 48;

type Quad = readonly [number, number, number, number];
/** The parameter s of a cubic-bezier with X(s) = u: exactly BISECTION_STEPS halvings of [0, 1], then the midpoint (|error| ≤ 2^-49). */
function solveS(x1: number, x2: number, u: number): number {
  // X(s) = ((ax·s + bx)·s + cx)·s, the Bernstein form 3(1−s)²s·x1 + 3(1−s)s²·x2 + s³ in Horner order
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  let lo = 0, hi = 1;
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (lo + hi) * 0.5;
    if (((ax * mid + bx) * mid + cx) * mid < u) lo = mid; else hi = mid;
  }
  return (lo + hi) * 0.5;
}
/** Y(s) of a cubic-bezier with y handles y1, y2 (Horner). */
const bezierY = (y1: number, y2: number, s: number): number => {
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return ((ay * s + by) * s + cy) * s;
};

/** Y(s) where X(s) = u, s found by exactly BISECTION_STEPS halvings of [0, 1] (Horner evaluation). u ≤ 0 → 0, u ≥ 1 → 1. */
export function cubicBezierShape(h: Quad, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return bezierY(h[1], h[3], solveS(h[0], h[2], u));
}
const N1 = 7.5625, D1 = 2.75;
/** Penner ease-out-bounce: f(0.5) = 0.765625; |f(1/2.75) − 1| ≤ 2e-16. */
export function bounceShape(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (u < 1 / D1) return N1 * u * u;
  if (u < 2 / D1) { const x = u - 1.5 / D1; return N1 * x * x + 0.75; }
  if (u < 2.5 / D1) { const x = u - 2.25 / D1; return N1 * x * x + 0.9375; }
  const x = u - 2.625 / D1;
  return N1 * x * x + 0.984375;
}
/** 1 − (1−u)·e^(−4u)·cos(3πu): peaks at about 1.2059 near u = 0.278, three turns. */
export function springShape(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return 1 - (1 - u) * Math.exp(-4 * u) * Math.cos(3 * Math.PI * u);
}
/** The shape (0 at u = 0, 1 at u = 1, unclamped) of gentle, sharp, overshoot, anticipate, bounce, spring or bezier. */
export function curveShape(easing: Exclude<Easing, V1Easing | 'smooth'>, bezier: CurveHandles | undefined, u: number): number {
  switch (easing) {
    case 'bounce': return bounceShape(u);
    case 'spring': return springShape(u);
    // a 'bezier' key without handles never passes validation (keyframe_curve); drawn straight rather than not at all
    case 'bezier': return bezier ? cubicBezierShape(bezier, u) : u <= 0 ? 0 : u >= 1 ? 1 : u;
    default: return cubicBezierShape(NAMED_BEZIER[easing], u);
  }
}
/** Seconds from key i to key i + 1, from the exact rational gap. */
const gap = (keys: readonly Keyframe[], i: number): number => T.toSeconds(T.sub(keys[i + 1]!.time, keys[i]!.time));
/**
 * Steffen (1990) slope at key i in value units per second, from the exact rational gaps between keys. 0 at the first and last
 * key and where the neighbouring secants change sign, so 'smooth' never goes past a key value.
 */
export function steffenSlope(keys: readonly Keyframe[], i: number): number {
  if (i <= 0 || i >= keys.length - 1) return 0;
  const h0 = gap(keys, i - 1), h1 = gap(keys, i);
  const d0 = (keys[i]!.value - keys[i - 1]!.value) / h0, d1 = (keys[i + 1]!.value - keys[i]!.value) / h1;
  if (d0 === 0 || d1 === 0 || (d0 < 0) !== (d1 < 0)) return 0;
  const p = (d0 * h1 + d1 * h0) / (h0 + h1);
  const m = Math.min(Math.abs(d0), Math.abs(d1), 0.5 * Math.abs(p));
  return d0 < 0 ? -m : m;
}
/** The value of the 'smooth' segment keys[lo] → keys[lo + 1] at u (cubic Hermite with steffenSlope at both ends). Two resting keys give smoothstep. */
export function smoothValue(keys: readonly Keyframe[], lo: number, u: number): number {
  const a = keys[lo]!, b = keys[lo + 1]!;
  const h = gap(keys, lo);
  const s0 = steffenSlope(keys, lo), s1 = steffenSlope(keys, lo + 1);
  const uu = u * u, uuu = uu * u;
  // v0 + Δ·smoothstep(u) + h·(s0·h10(u) + s1·h11(u)): with resting ends exactly volume.ts's smoothstep
  const v = a.value + (b.value - a.value) * (u * u * (3 - 2 * u)) + h * (s0 * (uuu - 2 * uu + u) + s1 * (uuu - uu));
  // Steffen's slopes keep the segment monotone between its keys; this guards the last rounding bit
  const lo2 = a.value < b.value ? a.value : b.value, hi2 = a.value < b.value ? b.value : a.value;
  return v < lo2 ? lo2 : v > hi2 ? hi2 : v;
}
/** True for overshoot, anticipate, bounce, spring, and a 'bezier' whose y1 or y2 lies outside [0, 1]. */
export function turnsBack(easing: Easing, bezier?: CurveHandles): boolean {
  if (TURN_BACK_EASINGS.includes(easing)) return true;
  if (easing !== 'bezier' || !bezier) return false;
  return bezier[1] < 0 || bezier[1] > 1 || bezier[3] < 0 || bezier[3] > 1;
}
/** The exact cubic handles of a segment's easing, or null (hold, ease-in-out, smooth, bounce, spring). */
export function exactHandles(easing: Easing, bezier?: CurveHandles): Quad | null {
  if (easing === 'bezier') return bezier ?? null;
  return CURVES.find((c) => c.id === easing)?.handles ?? null;
}

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
export function splitSegment(keys: readonly Keyframe[], at: T.RationalTime, rate: T.Rate, range: ValueRange): SplitResult {
  let lo = -1;
  for (let i = 0; i + 1 < keys.length; i++) if (T.lt(keys[i]!.time, at) && T.lt(at, keys[i + 1]!.time)) { lo = i; break; }
  if (lo < 0) throw new Error('splitSegment: the time must lie strictly inside a segment of the keys');
  const a = keys[lo]!, b = keys[lo + 1]!;
  // the sampler's own u and value (animation.ts), so the new key sits exactly on the curve as drawn
  const u = T.toSeconds(T.sub(at, a.time)) / T.toSeconds(T.sub(b.time, a.time));
  const mid = sampleKeyframes(keys, at, range);
  const copy = (k: Keyframe): Keyframe => ({ time: k.time, value: k.value, easing: k.easing, ...(k.bezier ? { bezier: [...k.bezier] as CurveHandles } : {}) });
  let first: Keyframe = copy(a), added: Keyframe;
  let exact: boolean;
  const handles = a.easing === 'linear' || a.easing === 'hold' ? null : exactHandles(a.easing, a.bezier);
  if (a.easing === 'linear') { added = { time: at, value: mid, easing: 'linear' }; exact = true; }
  else if (a.easing === 'hold') { added = { time: at, value: a.value, easing: 'hold' }; exact = true; }
  else if (handles && a.value === b.value) { added = { ...copy(a), time: at }; exact = true; } // a flat segment stays flat whatever its curve
  else if (handles) {
    const [x1, y1, x2, y2] = handles;
    const s = solveS(x1, x2, u);
    const lerp = (p: number, q: number) => p + (q - p) * s;
    // de Casteljau: left half P0 A D M, right half M E C P3 (normalised x, y of the whole segment)
    const Ax = lerp(0, x1), Bx = lerp(x1, x2), Cx = lerp(x2, 1), Dx = lerp(Ax, Bx), Ex = lerp(Bx, Cx);
    const Ay = lerp(0, y1), By = lerp(y1, y2), Cy = lerp(y2, 1), Dy = lerp(Ay, By), Ey = lerp(By, Cy);
    const d = b.value - a.value;
    const raw = a.value + d * bezierY(y1, y2, s);
    exact = Object.is(raw, mid); // false when the sampler clamped the value to the channel's range
    // a curve that does not turn back never becomes one that does (the flash rule keeps holding after a split)
    const yLo = turnsBack(a.easing, a.bezier) ? -1 : 0, yHi = turnsBack(a.easing, a.bezier) ? 2 : 1;
    const fit = (v: number, min: number, max: number) => { if (!(v >= min && v <= max)) { exact = false; return v < min || Number.isNaN(v) ? min : max; } return v; };
    const half = (xs: Quad, change: number, from: number): Keyframe['bezier'] | null => {
      if (change === 0) return null;
      return [fit(xs[0], 0, 1), fit((a.value + d * xs[1] - from) / change, yLo, yHi), fit(xs[2], 0, 1), fit((a.value + d * xs[3] - from) / change, yLo, yHi)];
    };
    const left = half([Ax / u, Ay, Dx / u, Dy], mid - a.value, a.value);
    const right = half([(Ex - u) / (1 - u), Ey, (Cx - u) / (1 - u), Cy], b.value - mid, mid);
    // a half without a value change has no shape to keep: it is drawn flat
    if (!left || !right) exact = false;
    first = left ? { time: a.time, value: a.value, easing: 'bezier', bezier: left } : { time: a.time, value: a.value, easing: 'linear' };
    added = right ? { time: at, value: mid, easing: 'bezier', bezier: right } : { time: at, value: mid, easing: 'linear' };
  } else {
    // ease-in-out, smooth, bounce, spring: no cubic form; the new key takes the curve's value and the segment's curve
    added = { ...copy(a), time: at, value: mid };
    exact = false;
  }
  const out = [...keys.slice(0, lo).map(copy), first, added, ...keys.slice(lo + 1).map(copy)];
  // 'smooth' neighbours: their shape follows the slopes at a and b, which the new key may change
  if (lo > 0 && keys[lo - 1]!.easing === 'smooth' && !Object.is(steffenSlope(keys, lo), steffenSlope(out, lo))) exact = false;
  if (b.easing === 'smooth' && !Object.is(steffenSlope(keys, lo + 1), steffenSlope(out, lo + 2))) exact = false;
  // deviation over every frame whose value the insertion can touch: from the key before a to the key after b
  const w0 = keys[Math.max(0, lo - 1)]!.time, w1 = keys[Math.min(keys.length - 1, lo + 2)]!.time;
  let maxDeviation = 0;
  for (let f = T.frameIndexAt(w0, rate), end = T.frameIndexAt(w1, rate); f <= end; f++) {
    const t = T.frameTime(f, rate);
    const dv = Math.abs(sampleKeyframes(out, t, range) - sampleKeyframes(keys, t, range));
    if (dv > maxDeviation) maxDeviation = dv;
  }
  return { keys: out, exact, maxDeviation };
}
