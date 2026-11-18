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
import { EASINGS, pathPoints, sampleKeyframes, TRANSFORM_RANGE, type Clip, type CurveHandles, type Easing, type Keyframe } from '@pulseframe/core';

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

export interface CurveHashResult { sha256: string; samples: number; nsPerSample: number }
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
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buf));
  return { sha256: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(''), samples: CURVE_HASH_SAMPLES, nsPerSample: Number(((ms * 1e6) / CURVE_HASH_SAMPLES).toFixed(1)) };
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
