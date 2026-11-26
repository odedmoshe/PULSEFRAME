/**
 * The samples of the keys baseline (ADR-0019 step 0; keys-baseline.ts records and checks them). Pure.
 * The five v1 easings, each on a fixed key list (values of both signs and a flat segment), at 2000 rational times: whole
 * frames at five frame rates, the shutter taps of time.shutter at 8 and 16 samples a frame, and times on an odd timescale
 * from before the first key to after the last. Each sample is its IEEE-754 bits in hex.
 */
import * as T from '@pulseframe/time';
import { sampleKeyframes, TRANSFORM_RANGE, V1_EASINGS, type Keyframe, type V1Easing } from '@pulseframe/core';

const RATES = [{ num: 24000, den: 1001 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }];
const KEY_RATE = { num: 30, den: 1 };

/** The key list of one easing: every segment uses it; frames 0, 7, 31, 32 (a one-frame segment), 90; values of both signs, one flat segment. */
export const baselineKeys = (easing: V1Easing): Keyframe[] => ([[0, -0.4], [7, 0.35], [31, 0.35], [32, -1.25], [90, 2.5]] as const).map(([fr, v]) => ({ time: T.frameTime(fr, KEY_RATE), value: v, easing }));
/** 2000 times, in a fixed order: 500 whole frames (−5..94 at five rates), 320 + 640 shutter taps, 540 on timescale 997. */
export function baselineTimes(): T.RationalTime[] {
  const out: T.RationalTime[] = [];
  for (const rate of RATES) for (let fr = -5; fr < 95; fr++) out.push(T.frameTime(fr, rate));
  for (const n of [8, 16]) for (let fr = 0; fr < 40; fr++) for (let k = 0; k < n; k++) out.push(T.add(T.frameTime(fr, KEY_RATE), T.rt(k, 30 * n)));
  for (let i = 0; out.length < 2000; i++) out.push(T.rt(-7 + i * 7, 997));
  return out;
}
export const float64Hex = (v: number) => { const b = Buffer.alloc(8); b.writeDoubleBE(v); return b.toString('hex'); };
export interface KeysBaseline { proof: 'keys-baseline'; adr: 'ADR-0019'; count: number; times: T.RationalTime[]; samples: Record<V1Easing, string[]> }
/** The baseline record of this tree's sampler. */
export function keysBaseline(): KeysBaseline {
  const times = baselineTimes();
  return { proof: 'keys-baseline', adr: 'ADR-0019', count: times.length, times, samples: Object.fromEntries(V1_EASINGS.map((e) => { const keys = baselineKeys(e); return [e, times.map((t) => float64Hex(sampleKeyframes(keys, t, TRANSFORM_RANGE.x)))]; })) as Record<V1Easing, string[]> };
}
