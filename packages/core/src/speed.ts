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
/** Timeline duration -> source duration for this clip. */
export const toSourceSpan = (c: Clip, timelineDuration: T.RationalTime): T.RationalTime => { if (isFreeze(c)) return T.ZERO; const s = speedOf(c); return mul(timelineDuration, s.num, s.den); };
/** Source duration -> timeline duration for this clip. */
export const toTimelineSpan = (c: Clip, sourceDuration: T.RationalTime): T.RationalTime => { if (isFreeze(c)) return T.ZERO; const s = speedOf(c); return mul(sourceDuration, s.den, s.num); };
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

