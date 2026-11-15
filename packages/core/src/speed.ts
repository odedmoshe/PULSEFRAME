/**
 * Clip speed (SPEC §14): a media clip may play its source faster or slower by an exact ratio.
 * `speed = num/den` means one second of timeline shows num/den seconds of source. All conversions between timeline time and
 * source time go through these helpers, so every feature that maps between the two (cuts, captions, analysis markers,
 * transitions, audio) agrees. Sound follows the picture by resampling ("varispeed"): pitch rises and falls with speed.
 */
import * as T from '@pulseframe/time';
import type { Clip, MediaClip } from './schema.ts';

/**
 * Whole frames by which a video's picture starts after the file's time zero (nearest frame, so the error against the sound
 * is at most half a frame). Source frame k is shown at source time (k + this) / rate.
 */
export const startOffsetFrames = (video: { frameRate: { num: number; den: number }; startTime?: T.RationalTime }): number =>
  video.startTime ? Math.round((T.toSeconds(video.startTime) * video.frameRate.num) / video.frameRate.den) : 0;
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
 * A clip whose speed changes evenly over its length, from `speed` at its start to `speedEnd` at its end (a continuous ramp).
 * For such a clip the two span functions below are measured FROM THE START OF THE CLIP: `toSourceSpan(c, d)` is the source
 * played in the first `d` of the clip, v0·d + (v1 − v0)·d²/(2D). Before the start and past the end the clip is taken to
 * continue at its first and last speed. A ramped clip cannot be divided or trimmed (operations refuse it): the speed at
 * an arbitrary cut is generally not an exact ratio of small numbers.
 */
export const isRamped = (c: Clip): c is MediaClip & { speedEnd: Speed } => c.type === 'media' && !!c.speedEnd && !c.freeze;
/** Ramp results are rounded down to this many parts of a second: a multiple of the usual frame and sample rates, so times that fall exactly on a frame or sample stay exact. */
const RAMP_TIMESCALE = 35_280_000;
function rampSourceSpan(c: MediaClip & { speedEnd: Speed }, d: T.RationalTime): T.RationalTime {
  const v0 = speedOf(c), v1 = c.speedEnd, D = c.duration;
  if (T.isNegative(d)) return mul(d, v0.num, v0.den);
  if (T.lt(D, d)) return T.add(rampSourceSpan(c, D), mul(T.sub(d, D), v1.num, v1.den));
  const a = BigInt(d.value), b = BigInt(d.timescale), p = BigInt(D.value), q = BigInt(D.timescale);
  const n0 = BigInt(v0.num), d0 = BigInt(v0.den), n1 = BigInt(v1.num), d1 = BigInt(v1.den);
  // v0·d + (v1 − v0)·d²/(2D) over one denominator
  const den = d0 * d1 * b * b * 2n * p;
  const num = n0 * a * d1 * b * 2n * p + (n1 * d0 - n0 * d1) * a * a * q;
  return T.normalize({ value: ((num * BigInt(RAMP_TIMESCALE)) / den).toString(), timescale: RAMP_TIMESCALE });
}
/** Inverse of the above. It needs a square root, so it is approximate (to a microsecond); callers snap the result to frames. */
function rampTimelineSpan(c: MediaClip & { speedEnd: Speed }, sourceDuration: T.RationalTime): T.RationalTime {
  const v0 = speedOf(c).num / speedOf(c).den, v1 = c.speedEnd.num / c.speedEnd.den, D = T.toSeconds(c.duration), s = T.toSeconds(sourceDuration);
  const whole = ((v0 + v1) / 2) * D;
  const k = (v1 - v0) / (2 * D);
  const t = s < 0 ? s / v0 : s > whole ? D + (s - whole) / v1 : Math.abs(k) < 1e-12 ? s / v0 : (-v0 + Math.sqrt(v0 * v0 + 4 * k * s)) / (2 * k);
  return T.fromSeconds(t.toFixed(6));
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
 * Timeline time for which a clip could keep playing past its end before its source runs out (the "handle" a transition
 * into the next clip uses). A forward clip continues into later source; a reversed clip continues into earlier source.
 */
export const handleAfterEnd = (c: MediaClip, assetDuration: T.RationalTime): T.RationalTime =>
  isRamped(c) ? mul(T.sub(assetDuration, sourceEnd(c)), c.speedEnd.den, c.speedEnd.num) : c.reverse ? toTimelineSpan(c, c.sourceIn) : toTimelineSpan(c, T.sub(assetDuration, sourceEnd(c)));
/**
 * Timeline time at which source time `s` of the clip's stretch is played, whichever way the clip runs.
 * Forward: `timelineAt`. Reversed: the clip starts at the END of its stretch, so source time s is reached (sourceEnd − s) later.
 */
export const timelineOfSource = (c: MediaClip, s: T.RationalTime): T.RationalTime =>
  c.reverse ? T.add(c.start, toTimelineSpan(c, T.sub(sourceEnd(c), s))) : timelineAt(c, s);

