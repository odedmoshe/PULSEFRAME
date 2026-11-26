/**
 * Size-fit plan (wave 7, track send; send-decisions §2.1, C4). Pure, and integer arithmetic only: every quantity is a BigInt, every
 * ratio is an integer over 100, and durations are carried as frames·den/num multiplied out, so no float rounding can move a
 * decision (BigInt also removes any 2^53 bound for the schema limits). The server (apps/server/src/sizeFit.ts) runs the encodes;
 * this file only plans.
 *
 * Rule (C4): for scale in [1, 1/2, 1/4] (never above maxScale), for audio in [96, 64, 48] kb/s, the FIRST pair whose video rate
 * meets the floor wins. For a fixed pair the video rate grows with the target, so each pair passes for every B at or above its
 * own threshold; the accepted targets are therefore [minBytes, ∞) where minBytes is the smallest threshold, the one of the
 * smallest picture with the lowest audio rate (quarter size, 48 kb/s). sizeFitMinBytes finds it exactly by bisection on that
 * monotone predicate (sizeFit.test.ts: minBytes passes and minBytes − 1 does not, over random films).
 *
 * The floor (3/100 video bits per pixel per frame) is a HEURISTIC — the "draft" figure of the export's size estimate — and is
 * labelled as one in `basis` and shown as a number (bitsPerPixelFrame).
 */
import { SEND_FIT, type SizeFitInput, type SizeFitPlan, type SizeFitRefusal, type SizeFitScale } from './sendContract.ts';

/** True: the plan is built; the export refuses a target size only by size_fit_format / size_fit_too_small. */
export const SIZE_FIT_BUILT = true;

const B = BigInt;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b; // a ≥ 0, b > 0
/** 1/scale as an integer (scales are 1, 1/2, 1/4). */
const inverseOf = (s: SizeFitScale): bigint => (s === 1 ? 1n : s === 0.5 ? 2n : 4n);
/**
 * One side at a scale exactly as the export rounds it (export.ts plan: max(2, round(n·scale/2)·2)), in integers:
 * round(n/(2k)) for n, k > 0 is ⌊(n + k)/(2k)⌋ (Math.round rounds halves up).
 */
export function sideAtScale(n: number, scale: SizeFitScale): number {
  const k = inverseOf(scale);
  return Math.max(2, Number(((B(n) + k) / (2n * k)) * 2n));
}

interface Film { frames: bigint; num: bigint; den: bigint; sampleRate: bigint }
const film = (i: Omit<SizeFitInput, 'targetBytes'>): Film => {
  for (const [k, v] of [['frames', i.frames], ['rate.num', i.rate.num], ['rate.den', i.rate.den], ['sampleRate', i.sampleRate], ['width', i.width], ['height', i.height]] as const)
    if (!Number.isSafeInteger(v) || v <= 0) throw new Error(`planSizeFit: ${k} must be a positive integer, got ${v}`);
  return { frames: B(i.frames), num: B(i.rate.num), den: B(i.rate.den), sampleRate: B(i.sampleRate) };
};
/** Container allowance O = base + perVideoFrame·frames + perAudioFrame·⌈samples/1024⌉, samples = ⌈sampleRate·frames·den/num⌉ (an upper estimate). */
function overheadBytes(f: Film): bigint {
  const o = SEND_FIT.overhead;
  const samples = ceilDiv(f.sampleRate * f.frames * f.den, f.num);
  return B(o.base) + B(o.perVideoFrame) * f.frames + B(o.perAudioFrame) * ceilDiv(samples, B(o.audioFrameSamples));
}
/**
 * The video rate (bits per second, floored) a target leaves for a given audio rate, or 0 when nothing is left:
 *   stream bits = ⌊(B − O)·8·97/100⌋, audio bits = ⌈audio·frames·den/num⌉, v = ⌊(stream − audio bits)·num/(frames·den)⌋.
 * Non-decreasing in B for every fixed audio rate (the monotonicity the plan's minimum rests on).
 */
function videoRate(f: Film, targetBytes: bigint, audioBps: bigint, overhead: bigint): bigint {
  if (targetBytes <= overhead) return 0n;
  const s = SEND_FIT.streamShare;
  const streamBits = ((targetBytes - overhead) * 8n * B(s.num)) / B(s.den);
  const audioBits = ceilDiv(audioBps * f.frames * f.den, f.num);
  if (streamBits <= audioBits) return 0n;
  return ((streamBits - audioBits) * f.num) / (f.frames * f.den);
}
/** The floor, exactly: v / (w·h·num/den) ≥ 3/100  ⇔  v·den·100 ≥ 3·w·h·num. */
function meetsFloor(f: Film, v: bigint, w: number, h: number): boolean {
  const fl = SEND_FIT.floorBitsPerPixelFrame;
  return v > 0n && v * f.den * B(fl.den) >= B(fl.num) * B(w) * B(h) * f.num;
}
const scalesUpTo = (maxScale: SizeFitScale) => SEND_FIT.scales.filter((s) => s <= maxScale);
const BASIS = 'HEURISTIC: the largest picture (full, half, quarter size, never above the asked scale) whose video rate reaches 3/100 bits per pixel per frame (the "draft" figure of the size estimate), trying 96, 64, then 48 kb/s sound at each size; stream share 97/100 of the target after a container allowance. Integer arithmetic. The bytes are then measured, not promised by this plan.';

/** The fit for a target, or the refusal with the smallest target that works. */
export function planSizeFit(input: SizeFitInput): SizeFitPlan | SizeFitRefusal {
  const f = film(input);
  if (!Number.isSafeInteger(input.targetBytes) || input.targetBytes <= 0) throw new Error(`planSizeFit: targetBytes must be a positive integer, got ${input.targetBytes}`);
  const target = B(input.targetBytes), overhead = overheadBytes(f);
  for (const scale of scalesUpTo(input.maxScale)) {
    const w = sideAtScale(input.width, scale), h = sideAtScale(input.height, scale);
    for (const audio of SEND_FIT.audioBps) {
      const v = videoRate(f, target, B(audio), overhead);
      if (!meetsFloor(f, v, w, h)) continue;
      // display only (never used for a decision): v·den/(w·h·num), rounded to 1e-4
      const bitsPerPixelFrame = Math.round(Number((v * f.den * 10_000n) / (B(w) * B(h) * f.num))) / 10_000;
      return { ok: true, scale, width: w, height: h, videoBitrate: Number(v), audioBitrate: audio, overheadBytes: Number(overhead), bitsPerPixelFrame, basis: BASIS };
    }
  }
  return { ok: false, code: 'size_fit_too_small', minBytes: sizeFitMinBytes(input) };
}

/**
 * The smallest target planSizeFit accepts for this film: the threshold of (quarter size, 48 kb/s), the cheapest pair, found by
 * bisection on its monotone predicate between the container allowance (never passes) and a doubling upper bound (passes).
 * Independent of maxScale (the quarter size is always tried).
 */
export function sizeFitMinBytes(input: Omit<SizeFitInput, 'targetBytes'>): number {
  const f = film(input), overhead = overheadBytes(f);
  const smallest = SEND_FIT.scales[SEND_FIT.scales.length - 1]!, audio = B(SEND_FIT.audioBps[SEND_FIT.audioBps.length - 1]!);
  const w = sideAtScale(input.width, smallest), h = sideAtScale(input.height, smallest);
  const passes = (b: bigint) => meetsFloor(f, videoRate(f, b, audio, overhead), w, h);
  let lo = overhead, hi = overhead * 2n + 1n; // passes(lo) is false: nothing is left for the streams
  while (!passes(hi)) { lo = hi; hi *= 2n; }
  while (hi - lo > 1n) { const mid = (lo + hi) / 2n; if (passes(mid)) hi = mid; else lo = mid; }
  return Number(hi);
}

/** The one retry's video rate: ⌊v·target·97 / (got·100)⌋ (integers). */
export function retryBitrate(videoBitrate: number, targetBytes: number, gotBytes: number): number {
  for (const [k, v] of [['videoBitrate', videoBitrate], ['targetBytes', targetBytes], ['gotBytes', gotBytes]] as const)
    if (!Number.isSafeInteger(v) || v <= 0) throw new Error(`retryBitrate: ${k} must be a positive integer, got ${v}`);
  const r = SEND_FIT.retryShare;
  return Number((B(videoBitrate) * B(targetBytes) * B(r.num)) / (B(gotBytes) * B(r.den)));
}
