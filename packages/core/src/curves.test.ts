/**
 * The curve maths of ADR-0019 (curves.ts): the bezier solver against an independent root (U1), the exact handles of the v1
 * curves (U2), the shape table of the named curves (U5), Steffen's smooth curve (U4), and splitSegment (exact insertion of
 * a key into a curve, with the clamp rate and the worst deviation printed).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import {
  bounceShape, BISECTION_STEPS, cubicBezierShape, CURVES, CURVES_BUILT, curveShape, EASINGS, exactHandles, isV1Easing, NAMED_BEZIER, NO_RANGE,
  sampleKeyframes, smoothValue, splitSegment, springShape, cosDet, expDet, steffenSlope, turnsBack, TRANSFORM_RANGE, type CurveHandles, type Easing, type Keyframe,
} from './index.ts';

/** Deterministic random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
/** Direction changes of a sampled function (zero steps ignored). */
function turns(fn: (u: number) => number, n = 1e5): number {
  let prev = fn(0), dir = 0, count = 0;
  for (let i = 1; i <= n; i++) { const v = fn(i / n), d = Math.sign(v - prev); if (d !== 0) { if (dir !== 0 && d !== dir) count++; dir = d; } prev = v; }
  return count;
}
function extreme(fn: (u: number) => number, kind: 'max' | 'min', n = 1e5) {
  let best = kind === 'max' ? -Infinity : Infinity, at = 0;
  for (let i = 0; i <= n; i++) { const v = fn(i / n); if (kind === 'max' ? v > best : v < best) { best = v; at = i / n; } }
  return { value: best, at };
}

/** An independent solution of X(s) = u: Cardano's formula (Math.cbrt / Math.acos), polished by two Newton steps. */
function cardanoS(x1: number, x2: number, u: number): number {
  const a = 1 + 3 * x1 - 3 * x2, b = 3 * x2 - 6 * x1, c = 3 * x1, d = -u;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-12) roots.push(-d / c);
    else { const disc = c * c - 4 * b * d; const q = Math.sqrt(Math.max(0, disc)); roots.push((-c + q) / (2 * b), (-c - q) / (2 * b)); }
  } else {
    const p = (3 * a * c - b * b) / (3 * a * a), q = (2 * b * b * b - 9 * a * b * c + 27 * a * a * d) / (27 * a * a * a), shift = -b / (3 * a);
    const disc = (q * q) / 4 + (p * p * p) / 27;
    if (disc > 0) { const r = Math.sqrt(disc); roots.push(Math.cbrt(-q / 2 + r) + Math.cbrt(-q / 2 - r) + shift); }
    else { const r = Math.sqrt(-p / 3), phi = Math.acos(Math.max(-1, Math.min(1, (3 * q) / (2 * p * r)))); for (let k = 0; k < 3; k++) roots.push(2 * r * Math.cos(phi / 3 - (2 * Math.PI * k) / 3) + shift); }
  }
  let s = roots.reduce((best, r) => (Math.abs(Math.min(1, Math.max(0, r)) - r) < Math.abs(Math.min(1, Math.max(0, best)) - best) ? r : best), roots[0]!);
  for (let i = 0; i < 2; i++) { const x = ((a * s + b) * s + c) * s + d, dx = (3 * a * s + 2 * b) * s + c; if (dx !== 0) s -= x / dx; }
  return s;
}
const yOf = (y1: number, y2: number, s: number) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
/** min over [0, 1] of X'(s) = 3a s² + 2b s + c. */
function minSlope(x1: number, x2: number) {
  const a = 1 + 3 * x1 - 3 * x2, b = 3 * x2 - 6 * x1, c = 3 * x1;
  const d = (s: number) => 3 * a * s * s + 2 * b * s + c;
  const cand = [0, 1];
  if (a !== 0) { const v = -b / (3 * a); if (v > 0 && v < 1) cand.push(v); }
  return Math.min(...cand.map(d));
}

describe('curves.ts is built', () => {
  it('CURVES_BUILT is true and the solver halves exactly 48 times', () => {
    expect(CURVES_BUILT).toBe(true);
    expect(BISECTION_STEPS).toBe(48);
  });
});

describe('U1: the bezier solver against an independent Cardano root', () => {
  it('1000 random handles × 1e4 times: |Δ| ≤ 1e-12 wherever min X\' ≥ 1e-3', () => {
    const r = rng(19);
    let max = 0, compared = 0, handlesUsed = 0;
    for (let h = 0; h < 1000; h++) {
      const x1 = r(), y1 = r() * 3 - 1, x2 = r(), y2 = r() * 3 - 1;
      if (minSlope(x1, x2) < 1e-3) continue;
      handlesUsed++;
      for (let i = 0; i < 1e4; i++) {
        const u = (i + 0.5) / 1e4;
        const d = Math.abs(cubicBezierShape([x1, y1, x2, y2], u) - yOf(y1, y2, cardanoS(x1, x2, u)));
        if (d > max) max = d;
        compared++;
      }
    }
    console.log(`U1: max |bisection − Cardano| = ${max.toExponential(3)} over ${compared} samples of ${handlesUsed} handles (min X' ≥ 1e-3)`);
    expect(handlesUsed).toBeGreaterThan(300);
    expect(max).toBeLessThanOrEqual(1e-12);
  }, 120_000);
  it('the ends: u ≤ 0 is 0, u ≥ 1 is 1', () => {
    for (const h of Object.values(NAMED_BEZIER)) { expect(cubicBezierShape(h, 0)).toBe(0); expect(cubicBezierShape(h, -3)).toBe(0); expect(cubicBezierShape(h, 1)).toBe(1); expect(cubicBezierShape(h, 7)).toBe(1); }
  });
});

describe('U2: the exact handles of the v1 curves draw the v1 formulas', () => {
  const EASE: Record<string, (u: number) => number> = { linear: (u) => u, 'ease-in': (u) => u * u * u, 'ease-out': (u) => 1 - (1 - u) ** 3 };
  it('linear, ease-in and ease-out within 1e-14 over 1e4 values of u', () => {
    for (const e of ['linear', 'ease-in', 'ease-out'] as const) {
      const h = exactHandles(e)!;
      let max = 0;
      for (let i = 0; i <= 1e4; i++) { const u = i / 1e4; max = Math.max(max, Math.abs(cubicBezierShape(h, u) - EASE[e]!(u))); }
      expect(max, e).toBeLessThanOrEqual(1e-14);
    }
  });
  it('exactHandles: the cubic forms, the custom handles, and null where none exists', () => {
    expect(exactHandles('gentle')).toEqual(NAMED_BEZIER.gentle);
    expect(exactHandles('bezier', [0.1, 0.2, 0.3, 0.4])).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(exactHandles('bezier')).toBeNull();
    for (const e of ['hold', 'ease-in-out', 'smooth', 'bounce', 'spring'] as const) expect(exactHandles(e), e).toBeNull();
    for (const c of CURVES) expect(exactHandles(c.id) ?? undefined, c.id).toEqual(c.handles);
  });
});

describe('U5: the shape table of the named curves', () => {
  const shape = (e: Exclude<Easing, 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'smooth'>, h?: CurveHandles) => (u: number) => curveShape(e, h, u);
  it('overshoot peaks at 1.0978 near u = 0.573; anticipate dips to −0.0978; spring peaks at 1.2059 near u = 0.278', () => {
    const o = extreme(shape('overshoot'), 'max');
    expect(Math.abs(o.value - 1.0978)).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(o.at - 0.573)).toBeLessThan(0.005);
    const a = extreme(shape('anticipate'), 'min');
    expect(Math.abs(a.value + 0.0978)).toBeLessThanOrEqual(1e-4);
    const s = extreme(springShape, 'max');
    expect(Math.abs(s.value - 1.2059)).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(s.at - 0.278)).toBeLessThan(0.005);
    console.log(`U5: overshoot max ${o.value.toFixed(6)} at ${o.at}, anticipate min ${a.value.toFixed(6)} at ${a.at}, spring max ${s.value.toFixed(6)} at ${s.at}`);
  });
  it('spring uses no engine Math.exp or Math.cos (they differ between Node and Chromium), and stays within 4e-16 of them', () => {
    const { exp, cos } = Math;
    try {
      Math.exp = () => { throw new Error('Math.exp'); };
      Math.cos = () => { throw new Error('Math.cos'); };
      for (let i = 1; i < 1000; i++) springShape(i / 1000);
    } finally { Math.exp = exp; Math.cos = cos; }
    let worst = 0;
    for (let i = 0; i <= 100_000; i++) { const u = i / 100_000; worst = Math.max(worst, Math.abs(springShape(u) - (u <= 0 ? 0 : u >= 1 ? 1 : 1 - (1 - u) * exp(-4 * u) * cos(3 * Math.PI * u)))); }
    expect(worst).toBeLessThanOrEqual(4e-16);
    for (let i = 0; i <= 1000; i++) { const x = (i / 1000) * 8 * Math.PI; expect(Math.abs(cosDet(x) - cos(x)), `cos ${x}`).toBeLessThanOrEqual(4e-16); }
    for (let i = 0; i <= 1000; i++) { const x = -8 + (i / 1000) * 16; expect(Math.abs(expDet(x) - exp(x)) / exp(x), `exp ${x}`).toBeLessThanOrEqual(4.5e-16); }
  });
  it('bounce: f(0.5) === 0.765625 and |f(1/2.75) − 1| ≤ 2e-16', () => {
    expect(bounceShape(0.5)).toBe(0.765625);
    expect(Math.abs(bounceShape(1 / 2.75) - 1)).toBeLessThanOrEqual(2e-16);
  });
  it('turn counts over 1e5 points: 0 for the monotone curves, 1 for overshoot and anticipate, 3 for spring, 6 for bounce', () => {
    expect(turns(shape('gentle'))).toBe(0);
    expect(turns(shape('sharp'))).toBe(0);
    expect(turns(shape('overshoot'))).toBe(1);
    expect(turns(shape('anticipate'))).toBe(1);
    expect(turns(springShape)).toBe(3);
    expect(turns(bounceShape)).toBe(6);
    for (const h of [[0.2, 0, 0.8, 1], [0, 1, 1, 0], [1, 0, 0, 1], [0.5, 0.5, 0.5, 0.5]] as CurveHandles[]) expect(turns(shape('bezier', h)), String(h)).toBe(0);
  });
  it('every shape starts at 0 and ends at 1', () => {
    for (const e of EASINGS) {
      if (isV1Easing(e) || e === 'smooth') continue;
      const h: CurveHandles | undefined = e === 'bezier' ? [0.3, -0.5, 0.7, 1.5] : undefined;
      expect(curveShape(e, h, 0), e).toBe(0);
      expect(curveShape(e, h, 1), e).toBe(1);
    }
  });
  it('the y ∈ [−1, 2] extreme is 1.65685 (y1 = y2 = 2, x = 0.5)', () => {
    const m = extreme(shape('bezier', [0.5, 2, 0.5, 2]), 'max');
    expect(Math.abs(m.value - 1.65685)).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(extreme(shape('bezier', [0.5, -1, 0.5, -1]), 'min').value + 0.65685)).toBeLessThanOrEqual(1e-4);
  });
  it('turnsBack: the four named curves, and a custom curve with y outside [0, 1]', () => {
    for (const e of EASINGS) if (e !== 'bezier') expect(turnsBack(e), e).toBe(['overshoot', 'anticipate', 'bounce', 'spring'].includes(e));
    expect(turnsBack('bezier', [0.2, 0, 0.8, 1])).toBe(false);
    expect(turnsBack('bezier', [0.2, -0.01, 0.8, 1])).toBe(true);
    expect(turnsBack('bezier', [0.2, 0, 0.8, 1.01])).toBe(true);
    for (const c of CURVES) expect(turnsBack(c.id), c.id).toBe(c.turnsBack);
  });
});

describe('U4: smooth (Steffen monotone cubic)', () => {
  const keyList = fc.tuple(fc.integer({ min: -5, max: 5 }), fc.array(fc.tuple(fc.integer({ min: 1, max: 40 }), fc.integer({ min: -400, max: 400 })), { minLength: 2, maxLength: 8 }))
    .map(([start, xs]) => { let fr = start; return xs.map(([gap, v]) => { const k: Keyframe = { time: f(fr), value: v / 100, easing: 'smooth' }; fr += gap; return k; }); });
  it('exact at the keys and never outside [min, max] of its keys', () => {
    fc.assert(fc.property(keyList, (keys) => {
      for (const k of keys) if (!Object.is(sampleKeyframes(keys, k.time, NO_RANGE), k.value)) return false;
      const lo = Math.min(...keys.map((k) => k.value)), hi = Math.max(...keys.map((k) => k.value));
      const first = T.frameIndexAt(keys[0]!.time, R), last = T.frameIndexAt(keys[keys.length - 1]!.time, R);
      for (let i = first * 4; i <= last * 4; i++) { const v = sampleKeyframes(keys, T.frameTime(i, { num: 120, den: 1 }), NO_RANGE); if (v < lo || v > hi) return false; }
      // every segment stays between its own two keys
      for (let s = 0; s + 1 < keys.length; s++) for (let j = 0; j <= 50; j++) { const v = smoothValue(keys, s, j / 50); if (v < Math.min(keys[s]!.value, keys[s + 1]!.value) || v > Math.max(keys[s]!.value, keys[s + 1]!.value)) return false; }
      return true;
    }), { numRuns: 300 });
  });
  it('one-sided slopes at ±1e-6 s agree within 1e-4 relative at every inner key (fast-check, 2–8 keys)', () => {
    const eps = T.rt(1, 1_000_000), half = T.rt(1, 2_000_000);
    // one-sided difference quotients with Richardson's step (the error term in the step cancels; still one-sided)
    const slope = (keys: Keyframe[], t: T.RationalTime, side: 1 | -1) => {
      const at = (d: T.RationalTime) => sampleKeyframes(keys, side > 0 ? T.add(t, d) : T.sub(t, d), NO_RANGE);
      const v = sampleKeyframes(keys, t, NO_RANGE);
      const q1 = (at(eps) - v) / 1e-6, q2 = (at(half) - v) / 5e-7;
      return side * (2 * q2 - q1);
    };
    let worst = 0;
    fc.assert(fc.property(keyList, (keys) => {
      const scale = Math.max(1e-9, ...keys.slice(1).map((k, i) => Math.abs(k.value - keys[i]!.value) / T.toSeconds(T.sub(k.time, keys[i]!.time))));
      for (let i = 1; i + 1 < keys.length; i++) {
        const l = slope(keys, keys[i]!.time, -1), r = slope(keys, keys[i]!.time, 1);
        const rel = Math.abs(l - r) / Math.max(Math.abs(l), Math.abs(r), scale);
        worst = Math.max(worst, rel);
        if (rel > 1e-4) return false;
        if (Math.abs(r - steffenSlope(keys, i)) > 1e-4 * Math.max(Math.abs(r), scale)) return false;
      }
      return true;
    }), { numRuns: 300 });
    console.log(`U4: worst relative one-sided slope mismatch at a key ${worst.toExponential(3)}`);
  });
  it('two resting keys equal smoothstep within 1e-15; slopes are 0 at the end keys and at a turn', () => {
    const keys: Keyframe[] = [{ time: f(3), value: 0.2, easing: 'smooth' }, { time: f(33), value: 0.9, easing: 'linear' }];
    for (let i = 0; i <= 1000; i++) {
      const u = i / 1000;
      expect(Math.abs(smoothValue(keys, 0, u) - (0.2 + 0.7 * (u * u * (3 - 2 * u))))).toBeLessThanOrEqual(1e-15);
    }
    const turn: Keyframe[] = [{ time: f(0), value: 0, easing: 'smooth' }, { time: f(10), value: 1, easing: 'smooth' }, { time: f(20), value: 0, easing: 'smooth' }];
    expect([0, 1, 2].map((i) => steffenSlope(turn, i))).toEqual([0, 0, 0]);
    const rising: Keyframe[] = [{ time: f(0), value: 0, easing: 'smooth' }, { time: f(10), value: 1, easing: 'smooth' }, { time: f(20), value: 3, easing: 'smooth' }];
    expect(steffenSlope(rising, 1)).toBeGreaterThan(0);
    expect(steffenSlope(rising, 1)).toBeLessThanOrEqual(2 * Math.min(3, 6));
  });
});

describe('splitSegment', () => {
  const k = (fr: number, value: number, easing: Easing, bezier?: CurveHandles): Keyframe => ({ time: f(fr), value, easing, ...(bezier ? { bezier } : {}) });
  it('linear stays linear; hold holds; both exact', () => {
    const lin = splitSegment([k(0, 0, 'linear'), k(30, 3, 'linear')], f(10), R, NO_RANGE);
    expect(lin.exact).toBe(true);
    expect(lin.keys.map((x) => [x.value, x.easing])).toEqual([[0, 'linear'], [1, 'linear'], [3, 'linear']]);
    const hold = splitSegment([k(0, 2, 'hold'), k(30, 3, 'linear')], f(10), R, NO_RANGE);
    expect(hold.keys.map((x) => [x.value, x.easing])).toEqual([[2, 'hold'], [2, 'hold'], [3, 'linear']]);
    expect(hold.maxDeviation).toBe(0);
  });
  it('a curve with a cubic form becomes two exact bezier halves; the x = 1.333 case is clamped and approximate', () => {
    // overshoot before its turn halves exactly; after it, the right half's change is small and its handles leave y ∈ [−1, 2]
    const exactAt: number[] = [];
    for (let fr = 1; fr < 30; fr++) {
      const r = splitSegment([k(0, 0, 'overshoot'), k(30, 1, 'linear')], f(fr), R, TRANSFORM_RANGE.scale);
      expect(r.keys.map((x) => x.easing)).toEqual(['bezier', 'bezier', 'linear']);
      if (r.exact) { exactAt.push(fr); expect(r.maxDeviation).toBeLessThan(1e-12); } else expect(r.maxDeviation).toBeGreaterThan(0);
    }
    expect(exactAt).toEqual(expect.arrayContaining([2, 20]));
    const sharp = splitSegment([k(0, 2, 'sharp'), k(30, -1, 'linear')], f(13), R, NO_RANGE);
    expect(sharp.exact).toBe(true);
    expect(sharp.maxDeviation).toBeLessThan(1e-12);
    // x1 = 1, x2 = 0 split at s = 0.75 (u = 0.5625): the left half's x would be 1.333
    const odd = splitSegment([k(0, 0, 'bezier', [1, 0.2, 0, 0.8]), k(16, 1, 'linear')], f(9), R, NO_RANGE);
    expect(odd.exact).toBe(false);
    for (const x of odd.keys) if (x.bezier) for (const i of [0, 2]) expect(x.bezier[i]!).toBeLessThanOrEqual(1);
  });
  it('ease-in-out, smooth, bounce and spring take the sampled value and keep their curve, approximately', () => {
    for (const e of ['ease-in-out', 'smooth', 'bounce', 'spring'] as const) {
      const before = [k(0, 0, e), k(30, 1, 'linear')];
      const r = splitSegment(before, f(10), R, TRANSFORM_RANGE.x);
      expect(r.exact, e).toBe(false);
      expect(r.keys[1]).toEqual({ time: f(10), value: sampleKeyframes(before, f(10), TRANSFORM_RANGE.x), easing: e });
    }
  });
  it('a non-turning curve never becomes a turning one, and a smooth neighbour makes the insertion approximate', () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const h: CurveHandles = [r(), r(), r(), r()];
      const out = splitSegment([k(0, 0, 'bezier', h), k(40, 1, 'linear')], f(1 + Math.floor(r() * 39)), R, TRANSFORM_RANGE.opacity);
      for (const x of out.keys) expect(turnsBack(x.easing, x.bezier), String(h)).toBe(false);
    }
    const s = splitSegment([k(0, 0, 'smooth'), k(10, 1, 'gentle'), k(30, 3, 'linear')], f(20), R, NO_RANGE);
    expect(s.exact).toBe(false);
    expect(s.maxDeviation).toBeGreaterThan(0);
  });
  it('2000 random bezier insertions: unclamped cases stay within 1e-9·|Δv| on every frame (clamp rate and worst deviation printed)', () => {
    const r = rng(2026);
    let clamped = 0, worst = 0, worstClamped = 0;
    for (let i = 0; i < 2000; i++) {
      const len = 2 + Math.floor(r() * 120);
      const h: CurveHandles = [r(), r() * 3 - 1, r(), r() * 3 - 1];
      const v0 = r() * 4 - 2, v1 = r() * 4 - 2;
      const keys = [k(0, v0, 'bezier', h), k(len, v1, 'linear')];
      const at = f(1 + Math.floor(r() * (len - 1)));
      const out = splitSegment(keys, at, R, TRANSFORM_RANGE.x);
      let dev = 0;
      for (let fr = 0; fr <= len; fr++) dev = Math.max(dev, Math.abs(sampleKeyframes(out.keys, f(fr), TRANSFORM_RANGE.x) - sampleKeyframes(keys, f(fr), TRANSFORM_RANGE.x)));
      expect(dev).toBe(out.maxDeviation);
      if (!out.exact) { clamped++; worstClamped = Math.max(worstClamped, dev / Math.max(1e-300, Math.abs(v1 - v0))); continue; }
      worst = Math.max(worst, dev / Math.abs(v1 - v0));
      expect(dev, `${h} at ${T.toSeconds(at)}`).toBeLessThanOrEqual(1e-9 * Math.abs(v1 - v0));
    }
    console.log(`split: ${clamped}/2000 clamped (${((clamped / 2000) * 100).toFixed(1)}%); worst exact deviation ${worst.toExponential(3)}·|Δv|, worst clamped ${worstClamped.toFixed(4)}·|Δv|`);
    expect(clamped).toBeLessThan(2000);
  });
});
