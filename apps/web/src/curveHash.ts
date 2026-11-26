/**
 * The cross-host curve hash (ADR-0019, keyframes-plan.md §8 "graft from A"; keyframes-proof P12): the SHA-256 of 100 000
 * samples of the ONE sampler (core animation.ts sampleKeyframes) over every easing of keyframe.ts EASINGS (the v1 five, the
 * named curves, smooth, bounce, spring and a custom bezier that turns back) at whole frames and at the shutter taps of 8 and 16
 * samples a frame, clamped with the channel range as transformAt does. Each sample is written as little-endian IEEE-754
 * Float64, so the hash is equal on two hosts exactly when every sample is bit-identical. Pure apart from the timing; Node
 * (keyframes-proof.ts) and the browser (selftest.ts window.__pfCurveHash) run this same module.
 * Also measured here, the same way on both hosts: the sampler's cost per sample and pathPoints for a 600-frame clip.
 */
import * as T from '@pulseframe/time';
import { EASINGS, pathPoints, sampleKeyframes, TRANSFORM_RANGE, v1Shape, type Clip, type CurveHandles, type Easing, type Keyframe, type V1Easing } from '@pulseframe/core';

export const CURVE_HASH_SAMPLES = 100_000;
const R = { num: 30, den: 1 };
/** A custom curve whose handles leave [0, 1] on both y (it turns back): the clamp and the solver are both exercised. */
const CUSTOM: CurveHandles = [0.2, -0.4, 0.7, 1.5];
const KEYS = [[0, -0.4], [7, 0.35], [31, 0.35], [32, -0.95], [61, 0.2], [90, 0.95]] as const;
/** The key list of one easing: every segment uses it (a flat segment and a one-frame segment included). */
export const curveHashKeys = (easing: Easing): Keyframe[] => KEYS.map(([fr, value]) => (easing === 'bezier' ? { time: T.frameTime(fr, R), value, easing, bezier: [...CUSTOM] as CurveHandles } : { time: T.frameTime(fr, R), value, easing }));
/** Sample i: easing EASINGS[i mod 13]; time: frame −5..94 plus tap k of n (n = 8 or 16), in a fixed order. */
export function curveHashTime(i: number): T.RationalTime {
  const j = Math.floor(i / EASINGS.length);
  const n = j % 2 ? 16 : 8;
  const fr = (Math.floor(j / 16) % 100) - 5;
  return T.add(T.frameTime(fr, R), T.rt(j % n, 30 * n));
}

/** sha256: all samples; byEasing: the SHA-256 of each easing's samples alone, so a difference names the curve it is in. */
export interface CurveHashResult { sha256: string; samples: number; nsPerSample: number; byEasing: Record<string, string> }
/** Every sample of the hash, in its order (sample i is easing EASINGS[i mod 13]): for measuring a difference in ulps across hosts. */
export function curveSamples(): number[] {
  const lists = EASINGS.map(curveHashKeys), range = TRANSFORM_RANGE.x;
  return Array.from({ length: CURVE_HASH_SAMPLES }, (_, i) => sampleKeyframes(lists[i % EASINGS.length]!, curveHashTime(i), range));
}
/** One ulp of |x|: the gap from |x| to the next double above it (2^(exponent − 52); the smallest subnormal for 0). */
export function ulpOf(x: number): number {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, Math.abs(x));
  const e = (v.getUint16(0) >> 4) & 0x7ff;
  return e === 0 ? 2 ** -1074 : 2 ** (e - 1075);
}
/**
 * The cross-host bound of sample i for the v1 easings (keyframes-proof P12): one ulp of max(|a|, |b|), a and b the key values
 * of the segment the sample falls in (the easing's shape may differ by 2^-52, which moves a + (b − a)·shape by about that).
 * Outside the keys the value is a key's own: the bound is 0 there (it must be bit-identical).
 */
/** Sample i's segment: its easing, the key values a and b, and u exactly as sampleKeyframes computes it; null outside the keys. */
export function curveSampleSegment(i: number): { easing: Easing; a: number; b: number; u: number } | null {
  const t = curveHashTime(i), easing = EASINGS[i % EASINGS.length]!, keys = curveHashKeys(easing);
  for (let k = 0; k + 1 < keys.length; k++) {
    const A = keys[k]!, B = keys[k + 1]!;
    if (T.lte(A.time, t) && T.lt(t, B.time)) return { easing, a: A.value, b: B.value, u: T.toSeconds(T.sub(t, A.time)) / T.toSeconds(T.sub(B.time, A.time)) };
  }
  return null;
}
/** The v1 easing shapes at the given (easing, u) pairs, on this host (selftest window.__pfV1Shapes). */
export const v1Shapes = (pairs: readonly [V1Easing, number][]): number[] => pairs.map(([e, u]) => v1Shape(e, u));
export function curveSampleBound(i: number): number {
  const t = curveHashTime(i), keys = curveHashKeys(EASINGS[i % EASINGS.length]!);
  for (let k = 0; k + 1 < keys.length; k++) if (T.lte(keys[k]!.time, t) && T.lt(t, keys[k + 1]!.time)) return ulpOf(Math.max(Math.abs(keys[k]!.value), Math.abs(keys[k + 1]!.value)));
  return 0;
}
/** The distance in ulps between two finite doubles (0 when bit-identical; +0 and −0 are 1 apart). */
export function ulpDistance(a: number, b: number): number {
  const v = new DataView(new ArrayBuffer(8));
  const ord = (x: number) => { v.setFloat64(0, x); const n = v.getBigInt64(0); return n < 0n ? -(n & 0x7fffffffffffffffn) - 1n : n; };
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
}
/** The hash of the samples, and the sampler's cost per sample on this host (sampling only, not the hash). */
export async function curveHash(): Promise<CurveHashResult> {
  const lists = EASINGS.map(curveHashKeys);
  const times = Array.from({ length: CURVE_HASH_SAMPLES }, (_, i) => curveHashTime(i));
  const buf = new ArrayBuffer(CURVE_HASH_SAMPLES * 8);
  const view = new DataView(buf);
  const range = TRANSFORM_RANGE.x;
  const t0 = performance.now();
  for (let i = 0; i < CURVE_HASH_SAMPLES; i++) view.setFloat64(i * 8, sampleKeyframes(lists[i % EASINGS.length]!, times[i]!, range), true);
  const ms = performance.now() - t0;
  const hex = async (b: ArrayBuffer) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', b)), (x) => x.toString(16).padStart(2, '0')).join('');
  const byEasing: Record<string, string> = {};
  for (let e = 0; e < EASINGS.length; e++) {
    const n = Math.ceil((CURVE_HASH_SAMPLES - e) / EASINGS.length), own = new DataView(new ArrayBuffer(n * 8));
    for (let i = e, m = 0; i < CURVE_HASH_SAMPLES; i += EASINGS.length, m++) own.setFloat64(m * 8, view.getFloat64(i * 8, true), true);
    byEasing[EASINGS[e]!] = await hex(own.buffer);
  }
  return { sha256: await hex(buf), samples: CURVE_HASH_SAMPLES, nsPerSample: Number(((ms * 1e6) / CURVE_HASH_SAMPLES).toFixed(1)), byEasing };
}

/** A 600-frame title with x and y keyed on new curves (only the fields pathPoints reads matter). */
export function pathTimingClip(): Clip {
  const xs: Keyframe[] = [[0, -0.4, 'overshoot'], [120, 0.3, 'smooth'], [300, -0.1, 'bounce'], [450, 0.2, 'spring'], [599, 0.4, 'linear']].map(([fr, value, easing]) => ({ time: T.frameTime(fr as number, R), value: value as number, easing: easing as Easing }));
  const ys: Keyframe[] = [[0, 0.3, 'smooth'], [200, -0.3, 'gentle'], [400, 0.1, 'bezier'], [599, 0, 'linear']].map(([fr, value, easing]) => ({ time: T.frameTime(fr as number, R), value: value as number, easing: easing as Easing, ...(easing === 'bezier' ? { bezier: [...CUSTOM] as CurveHandles } : {}) }));
  return {
    id: 'clip_path_timing', type: 'text', start: T.ZERO, duration: T.frameTime(600, R), text: 'path', transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: { x: xs, y: ys },
  } as unknown as Clip;
}
/** pathPoints for the 600-frame clip: the median of `runs` timings, in ms. */
export function pathPointsMs(runs = 15): { ms: number; points: number } {
  const clip = pathTimingClip();
  let points = 0;
  const times: number[] = [];
  for (let r = 0; r < runs; r++) { const t0 = performance.now(); points = pathPoints(clip, R).length; times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  return { ms: Number(times[Math.floor(runs / 2)]!.toFixed(3)), points };
}
