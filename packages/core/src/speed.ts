/**
 * Clip speed (SPEC §14): a media clip may play its source faster or slower by an exact ratio.
 * `speed = num/den` means one second of timeline shows num/den seconds of source. All conversions between timeline time and
 * source time go through these helpers, so every feature that maps between the two (cuts, captions, analysis markers,
 * transitions, audio) agrees. Sound follows the picture by resampling ("varispeed"): pitch rises and falls with speed.
 */
import * as T from '@pulseframe/time';
import type { Asset, Clip, MediaClip } from './schema.ts';

/**
 * Whole frames by which a video's picture starts after the file's time zero (nearest frame, so the error against the sound
 * is at most half a frame). Source frame k is shown at source time (k + this) / rate.
 */
export const startOffsetFrames = (video: { frameRate: { num: number; den: number }; startTime?: T.RationalTime }): number =>
  video.startTime ? Math.round((T.toSeconds(video.startTime) * video.frameRate.num) / video.frameRate.den) : 0;
/**
 * Source time at which source frame `frame` of an asset's picture is shown: (frame + startOffsetFrames) / rate, exact. The ONE
 * conversion from a frame of the video stream (motion tracks, measured moments, the family film's windows) to source time:
 * T.frameTime(frame, rate) alone is wrong for a file whose picture starts after its time zero (remuxed files, Matroska/TS,
 * B-frames without an edit list), whose sound is drawn from the file's own start (wave 5 family film, verifier finding).
 */
export const sourceTimeOfFrame = (asset: { video?: { frameRate: { num: number; den: number }; startTime?: T.RationalTime } | null }, frame: number): T.RationalTime => {
  if (!asset.video) throw new RangeError('sourceTimeOfFrame: the asset has no video stream');
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError(`sourceTimeOfFrame: ${frame} is not a source frame`);
  return T.frameTime(frame + startOffsetFrames(asset.video), asset.video.frameRate);
};
/** The source frame shown at source time `t` (the inverse of sourceTimeOfFrame, flooring; frames before the first picture are 0). */
export const sourceFrameOfTime = (asset: { video?: { frameRate: { num: number; den: number }; startTime?: T.RationalTime } | null }, t: T.RationalTime): number => {
  if (!asset.video) throw new RangeError('sourceFrameOfTime: the asset has no video stream');
  return Math.max(0, T.frameIndexAt(t, asset.video.frameRate) - startOffsetFrames(asset.video));
};
/** The file's own start time in seconds (0 for most files; see Asset.timeOrigin). Raw timestamps minus this are the asset's times. */
export const timeOriginSeconds = (asset: { timeOrigin?: T.RationalTime } | undefined): number => (asset?.timeOrigin ? T.toSeconds(asset.timeOrigin) : 0);
/** A freeze-frame clip shows one source picture for its whole length: it covers no stretch of source time. */
export const isFreeze = (c: Clip): boolean => c.type === 'media' && c.freeze === true;
export interface Speed { num: number; den: number }
export const UNIT_SPEED: Speed = { num: 1, den: 1 };
export const speedOf = (c: Clip): Speed => (c.type === 'media' && c.speed ? c.speed : UNIT_SPEED);
export const speedValue = (c: Clip): number => { const s = speedOf(c); return s.num / s.den; };
const mul = (t: T.RationalTime, num: number, den: number): T.RationalTime => (num === den ? t : T.normalize({ value: (BigInt(t.value) * BigInt(num)).toString(), timescale: t.timescale * den }));
/**
 * A clip with a continuous speed ramp: its speed changes from `speed` to `speedEnd` over a stretch of time called the ramp
 * — evenly, or eased in and out with `speedCurve: 'smooth'`. A whole ramp is the clip itself. After a trim or a cut the
 * clip is a WINDOW of the ramp: `rampWindow.total` is the length of the whole ramp and `rampWindow.offset` where in it
 * this clip starts (it can be negative or reach past the total after an extending trim; outside the ramp the speed is
 * the first or last one). Every part of a divided ramp therefore shows exactly the frames the undivided clip showed.
 *
 * With x the time since the start of the ramp and T its length, the source played is
 *   even:  F(x) = v0·x + (v1 − v0)·x²/(2T)
 *   eased: F(x) = v0·x + (v1 − v0)·(x³/T² − x⁴/(2T³))        (speed v0 + (v1 − v0)·(3u² − 2u³), u = x/T)
 * and the two span functions below are measured from the start of the clip: toSourceSpan(c, d) = F(offset + d) − F(offset),
 * each F computed exactly in integers and rounded down to 1/35,280,000 s.
 */
export const isRamped = (c: Clip): c is MediaClip & { speedEnd: Speed } => c.type === 'media' && !!c.speedEnd && !c.freeze;
/** Where in its ramp a ramped clip sits: the offset of its start and the length of the whole ramp. */
export const rampWindowOf = (c: MediaClip): { offset: T.RationalTime; total: T.RationalTime } => c.rampWindow ?? { offset: T.ZERO, total: c.duration };
/** The window of the part of `c` that starts `fromOffset` into it (for operations that divide or trim a ramped clip). Call before changing `c`. */
export const rampWindowOfPart = (c: MediaClip, fromOffset: T.RationalTime): { offset: T.RationalTime; total: T.RationalTime } | undefined => {
  if (!isRamped(c)) return undefined;
  const w = rampWindowOf(c);
  return { offset: T.add(w.offset, fromOffset), total: w.total };
};
/** Ramp results are rounded down to this many parts of a second: a multiple of the usual frame and sample rates, so times that fall exactly on a frame or sample stay exact. */
const RAMP_TIMESCALE = 35_280_000;
const floorDiv = (a: bigint, b: bigint) => { const q = a / b; return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q; };
/** F(x) of the ramp of `c` (see above), rounded down to RAMP_TIMESCALE; x is measured from the start of the ramp. */
function rampF(c: MediaClip & { speedEnd: Speed }, x: T.RationalTime, total: T.RationalTime): T.RationalTime {
  const v0 = speedOf(c), v1 = c.speedEnd;
  if (T.isNegative(x)) return mul(x, v0.num, v0.den);
  if (T.lt(total, x)) return T.add(rampF(c, total, total), mul(T.sub(x, total), v1.num, v1.den));
  const a = BigInt(x.value), b = BigInt(x.timescale), p = BigInt(total.value), q = BigInt(total.timescale);
  const n0 = BigInt(v0.num), d0 = BigInt(v0.den), n1 = BigInt(v1.num), d1 = BigInt(v1.den);
  const dv = n1 * d0 - n0 * d1; // (v1 − v0) × d0·d1
  let num: bigint, den: bigint;
  if (c.speedCurve === 'smooth') {
    // v0·a/b + (dv/(d0·d1)) · (2·a³·q²·b·p − a⁴·q³) / (2·b⁴·p³)
    den = d0 * d1 * 2n * b ** 4n * p ** 3n;
    num = n0 * a * d1 * 2n * b ** 3n * p ** 3n + dv * (2n * a ** 3n * q * q * b * p - a ** 4n * q ** 3n);
  } else {
    den = d0 * d1 * b * b * 2n * p;
    num = n0 * a * d1 * b * 2n * p + dv * a * a * q;
  }
  return T.normalize({ value: floorDiv(num * BigInt(RAMP_TIMESCALE), den).toString(), timescale: RAMP_TIMESCALE });
}
function rampSourceSpan(c: MediaClip & { speedEnd: Speed }, d: T.RationalTime): T.RationalTime {
  const w = rampWindowOf(c);
  return T.sub(rampF(c, T.add(w.offset, d), w.total), rampF(c, w.offset, w.total));
}
/** The same F in floating point (seconds), for the inverse and for sound. */
export function rampSourceSeconds(v0: number, v1: number, total: number, x: number, curve?: 'smooth'): number {
  if (x < 0) return v0 * x;
  if (x > total) return ((v0 + v1) / 2) * total + v1 * (x - total);
  return curve === 'smooth' ? v0 * x + (v1 - v0) * ((x * x * x) / (total * total) - (x * x * x * x) / (2 * total * total * total)) : v0 * x + ((v1 - v0) * x * x) / (2 * total);
}
/** Inverse of rampSourceSpan, by bisection: approximate (to a microsecond); callers snap the result to frames. */
function rampTimelineSpan(c: MediaClip & { speedEnd: Speed }, sourceDuration: T.RationalTime): T.RationalTime {
  const v0 = speedOf(c).num / speedOf(c).den, v1 = c.speedEnd.num / c.speedEnd.den, w = rampWindowOf(c);
  const total = T.toSeconds(w.total), off = T.toSeconds(w.offset), s = T.toSeconds(sourceDuration);
  const f = (d: number) => rampSourceSeconds(v0, v1, total, off + d, c.speedCurve) - rampSourceSeconds(v0, v1, total, off, c.speedCurve);
  const slowest = Math.min(v0, v1);
  let lo = -Math.abs(s) / slowest - 1, hi = Math.abs(s) / slowest + 1; // f is increasing with slope at least `slowest`
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (f(mid) < s) lo = mid; else hi = mid; }
  return T.fromSeconds(((lo + hi) / 2).toFixed(6));
}
/** Timeline duration -> source duration for this clip (for a ramped clip: measured from the clip's start, see isRamped). */
export const toSourceSpan = (c: Clip, timelineDuration: T.RationalTime): T.RationalTime => { if (isFreeze(c)) return T.ZERO; if (isRamped(c)) return rampSourceSpan(c, timelineDuration); const s = speedOf(c); return mul(timelineDuration, s.num, s.den); };
/** Source duration -> timeline duration for this clip (for a ramped clip: measured from the clip's start, approximate). */
export const toTimelineSpan = (c: Clip, sourceDuration: T.RationalTime): T.RationalTime => { if (isFreeze(c)) return T.ZERO; if (isRamped(c)) return rampTimelineSpan(c, sourceDuration); const s = speedOf(c); return mul(sourceDuration, s.den, s.num); };
/** Speed at the end of the clip as a number (its one speed, for a clip that is not ramped). */
export const speedEndValue = (c: Clip): number => (isRamped(c) ? c.speedEnd.num / c.speedEnd.den : speedValue(c));
/** Source time shown at the end of the clip. */
export const sourceEnd = (c: MediaClip): T.RationalTime => T.add(c.sourceIn, toSourceSpan(c, c.duration));
/** Source time shown at timeline time `t` (no clamping). */
export const sourceAt = (c: MediaClip, t: T.RationalTime): T.RationalTime => T.add(c.sourceIn, toSourceSpan(c, T.sub(t, c.start)));
/** Timeline time at which source time `s` is shown (no clamping). */
export const timelineAt = (c: MediaClip, s: T.RationalTime): T.RationalTime => T.add(c.start, toTimelineSpan(c, T.sub(s, c.sourceIn)));
/** A decimal speed such as 0.5 or 1.25 as an exact ratio (three decimals at most). */
export function speedFromNumber(x: number): Speed {
  const num = Math.round(x * 1000), den = 1000;
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const k = g(num, den);
  return { num: num / k, den: den / k };
}

/** True for a clip that plays its source backwards. */
export const isReverse = (c: Clip): boolean => c.type === 'media' && c.reverse === true;
/**
 * `sourceIn` of the part of a clip that covers timeline offsets [fromOffset, fromOffset + length) of it, as the clip is now.
 * Forward: the stretch starts `fromOffset` later. Reversed: the clip shows the END of its stretch first, so the part's stretch
 * starts where the material shown at the part's last frame is. Call it before changing the clip.
 */
export const sourceInOfPart = (c: MediaClip, fromOffset: T.RationalTime, length: T.RationalTime): T.RationalTime =>
  c.reverse ? T.add(c.sourceIn, toSourceSpan(c, T.sub(T.sub(c.duration, fromOffset), length))) : T.add(c.sourceIn, toSourceSpan(c, fromOffset));
/**
 * Source time of the PICTURE a clip shows at timeline time `t`. Same as `sourceAt` for a forward clip. A reversed clip shows,
 * at its i-th frame, what the forward clip shows at its i-th frame from the end; `frame` is the length of one project frame.
 */
export const pictureSourceAt = (c: MediaClip, t: T.RationalTime, frame: T.RationalTime): T.RationalTime =>
  c.reverse ? sourceAt(c, T.sub(T.sub(T.add(T.add(c.start, c.start), c.duration), frame), t)) : sourceAt(c, t);
/**
 * Source frame index a media clip's picture shows at `time` (the barePicture rule, evaluate.ts): floor(pictureSourceAt·rate)
 * − startOffsetFrames, clamped to [0, last]. Frames are counted from the first picture in the file; when that picture does not
 * sit at time 0 it is shown that many frames later (and held until then), which keeps it in step with the sound.
 * Motion tracks (ADR-0015) are stored per this index.
 */
export function sourceFrameIndexAt(asset: Pick<Asset, 'duration'> & { video: NonNullable<Asset['video']> }, clip: MediaClip, time: T.RationalTime, projectRate: { num: number; den: number }): number {
  const rate = asset.video.frameRate;
  const idx = Math.max(0, T.frameIndexAt(pictureSourceAt(clip, time, T.frameTime(1, projectRate)), rate) - startOffsetFrames(asset.video));
  const last = asset.video.frameCount !== null ? asset.video.frameCount - 1 : Math.max(0, T.frameIndexAt(asset.duration, rate) - 1);
  return Math.min(idx, last);
}
/**
 * Timeline time for which a clip could keep playing past its end before its source runs out (the "handle" a transition
 * into the next clip uses). A forward clip continues into later source; a reversed clip continues into earlier source.
 */
export const handleAfterEnd = (c: MediaClip, assetDuration: T.RationalTime): T.RationalTime =>
  isRamped(c) ? T.sub(toTimelineSpan(c, T.sub(assetDuration, c.sourceIn)), c.duration) : c.reverse ? toTimelineSpan(c, c.sourceIn) : toTimelineSpan(c, T.sub(assetDuration, sourceEnd(c)));
/**
 * THE rule for the spare source a transition into the next picture plays over after `prev` (ADR-0012), in whole project frames
 * (frameIndexAt of handleAfterEnd, not clamped: a caller that shows the number clamps it at 0). null = that side never runs out:
 * a still image, or a freeze frame (wave 8 growing, verifier C1). A freeze shows its sourceIn at every time (toSourceSpan is 0),
 * and the evaluator draws the outgoing side with clipLayer at times past its end (evaluate.ts), so it holds the same picture for
 * the whole transition, exactly as a still does. Every check of that handle goes through here: set_transition and
 * set_transition_options (ops.ts transitionSource, so velocityLimit and preflight follow), replace_clip_media, the template
 * planner's handleBefore and the editor's cut and transition rooms (inspector.model.ts, gallery.pick.ts).
 */
export const spareAfter = (prev: MediaClip, asset: Pick<Asset, 'kind' | 'duration'>, rate: { num: number; den: number }): number | null =>
  asset.kind === 'image' || isFreeze(prev) ? null : T.frameIndexAt(handleAfterEnd(prev, asset.duration), rate);
/** Timeline time a forward, constant-speed clip could start earlier before its source runs out (the head a velocity ramp reads, ADR-0012). */
export const handleBeforeStart = (c: MediaClip): T.RationalTime => toTimelineSpan(c, c.sourceIn);
/**
 * Timeline time at which source time `s` of the clip's stretch is played, whichever way the clip runs.
 * Forward: `timelineAt`. Reversed: the clip starts at the END of its stretch, so source time s is reached (sourceEnd − s) later.
 */
export const timelineOfSource = (c: MediaClip, s: T.RationalTime): T.RationalTime =>
  c.reverse ? T.add(c.start, toTimelineSpan(c, T.sub(sourceEnd(c), s))) : timelineAt(c, s);

