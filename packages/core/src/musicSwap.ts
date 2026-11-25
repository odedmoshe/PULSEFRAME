/**
 * Swapping and ending the music of a clip (wave 7 musicfit; BUILDER B). No new op: one transaction of existing public ops
 * (decisions §2.1, §2.4). The assistant's prompt is unchanged because no op changed. Pure and exact (rationals only).
 *
 * planMusicSwap: refuses a clip that plays at another speed or backwards (notFollowable) itself; every other refusal is the steps' own.
 *   Steps: trim_clip end (only when the new file from sourceIn is shorter than the clip), replace_clip_media {clipId, assetId, sourceIn}
 *   (sourceIn default: the first bar start, else the first beat, through ownBeats on the file's own clock, else 0), then
 *   musicEndingSteps. Volume keys lost are counted by applying the steps to a draft and comparing.
 * musicEndingSteps: end = min(target, the file's end floored to a frame from the clip's start); a fade-out (set_clip_fades, today's
 *   fit_music default length: one second, at most half the clip) only when the file is cut by at least one frame, else fadeOut 0.
 *   Used when the asset has provenance.fitted, or is built-in music whose floored end is the target frame. Never reads params.end.
 * musicEndingFor: the same rule for a clip that a planner is about to place (add_clip with an explicit duration, then the fade).
 */
import * as T from '@pulseframe/time';
import { applyTransaction, findClip, OpError, type OpCall } from './ops.ts';
import type { Asset, MediaClip, ProjectDocument } from './schema.ts';
import { musicFitRefusal } from './musicFitContract.ts';
import { isFreeze, isRamped, speedOf } from './speed.ts';
import { ownBeats } from './lineage.ts';
import { isBuiltinMusic } from './musicStyles.ts';
import { clipEnd } from './validate.ts';

type RT = T.RationalTime;
type Rate = { num: number; den: number };

export interface MusicSwapPlan { steps: OpCall[]; droppedVolumeKeys: number; sourceIn: T.RationalTime; end: T.RationalTime; cut: boolean }

const floorFrame = (t: RT, rate: Rate): RT => T.frameTime(T.frameIndexAt(t, rate), rate);
/** True when the clip plays its file forwards at speed 1 (no ramp, no freeze): the only music a fit or a swap follows. */
export const followable = (c: MediaClip): boolean => {
  const s = speedOf(c);
  return !c.reverse && !isRamped(c) && !isFreeze(c) && s.num === s.den;
};

/**
 * The end, length and fade of a sound clip of `asset` placed at `start` from `sourceIn` (speed 1) that should end at `target`
 * (frame-aligned): end = min(target, the file's end floored to a frame); cut = the file goes on for at least one more frame;
 * fade = one second (round(fps) frames), at most half the clip floored to a frame, only when cut. Throws OpError out_of_bounds when
 * nothing of the file would remain.
 */
export function musicEndingFor(rate: Rate, asset: Pick<Asset, 'duration'>, start: RT, sourceIn: RT, target: RT): { end: RT; duration: RT; cut: boolean; fadeOut: RT } {
  const fileEnd = floorFrame(T.add(start, T.sub(asset.duration, sourceIn)), rate);
  const end = T.min(target, fileEnd);
  if (!T.lt(start, end)) throw new OpError('out_of_bounds', 'nothing of the music would remain before that end', { start, end, target, fileEnd }, 'Choose a later end, or a longer file.');
  const duration = T.sub(end, start);
  const cut = T.lt(end, fileEnd);
  const half = floorFrame(T.rt(BigInt(duration.value), duration.timescale * 2), rate);
  const fadeOut = cut ? T.min(T.frameTime(Math.round(rate.num / rate.den), rate), half) : T.ZERO;
  return { end, duration, cut, fadeOut };
}
/**
 * Whether a planner ends this music exactly (musicEndingFor) instead of on a beat (fit_music): a shortened song (provenance.fitted),
 * or built-in music whose file, placed at `start` from `sourceIn`, ends on the frame of `target` once floored. Never reads params.end.
 */
export function endsExactly(rate: Rate, asset: Pick<Asset, 'duration' | 'provenance'>, start: RT, sourceIn: RT, target: RT): boolean {
  if (asset.provenance.fitted) return true;
  return isBuiltinMusic(asset) && T.eq(floorFrame(T.add(start, T.sub(asset.duration, sourceIn)), rate), target);
}

function mustMusicClip(doc: ProjectDocument, clipId: string): { clip: MediaClip; partners: number } {
  const f = findClip(doc, clipId);
  if (!f) throw new OpError('not_found', `clip ${clipId} not found`, { clipId }, 'Call get_timeline to list clips.');
  if (f.clip.type !== 'media' || f.track.kind !== 'audio') throw new OpError('incompatible', 'music that fits the film is a sound clip on a sound track', { clipId });
  const clip = f.clip;
  if (!followable(clip)) throw musicFitRefusal('notFollowable', { clipId });
  const partners = clip.linkGroupId ? Object.values(doc.sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips)).filter((c) => c.id !== clip.id && c.type === 'media' && c.linkGroupId === clip.linkGroupId).length : 0;
  if (partners) throw new OpError('incompatible', 'this sound is linked to a picture; detach it first if it should be fitted on its own', { clipId }, 'Use unlink_clip.');
  return { clip, partners };
}

/** The steps that end a music clip with its file or at `target` (see the header). Empty when it already ends so. */
export function musicEndingSteps(doc: ProjectDocument, clipId: string, target: T.RationalTime): { steps: OpCall[]; end: T.RationalTime; cut: boolean } {
  const { clip } = mustMusicClip(doc, clipId);
  const rate = doc.settings.frameRate;
  if (!T.eq(floorFrame(target, rate), target)) throw new OpError('invalid_args', 'the end must lie on a frame', { target });
  const asset = Object.hasOwn(doc.assets, clip.assetId) ? doc.assets[clip.assetId]! : undefined;
  if (!asset) throw new OpError('not_found', `asset ${clip.assetId} not found`, { assetId: clip.assetId });
  const e = musicEndingFor(rate, asset, clip.start, clip.sourceIn, target);
  const steps: OpCall[] = [];
  if (!T.eq(clipEnd(clip), e.end)) steps.push({ op: 'trim_clip', args: { clipId, edge: 'end', to: e.end } });
  const fadeIn = clip.fadeIn ?? T.ZERO;
  const fade = T.max(T.ZERO, T.min(e.fadeOut, floorFrame(T.sub(e.duration, fadeIn), rate)));
  // trim_clip clamps fades into the new length: the fade the clip has after the trim is what is compared
  const had = clip.fadeOut ? T.min(clip.fadeOut, T.max(T.ZERO, T.sub(e.duration, fadeIn))) : T.ZERO;
  if (!T.eq(had, fade)) steps.push({ op: 'set_clip_fades', args: { clipId, fadeOut: fade } });
  return { steps, end: e.end, cut: e.cut };
}

/** The first bar start of a file, else its first beat (its own clock, inside the file), else 0. */
export function musicStartOf(doc: ProjectDocument, assetId: string): RT {
  const asset = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]! : undefined;
  const own = asset ? ownBeats(doc, assetId) : null;
  if (!asset || !own) return T.ZERO;
  const inFile = (b: RT) => !T.isNegative(b) && T.lt(b, asset.duration);
  const first = (list: readonly RT[]) => [...list].filter(inFile).sort(T.cmp)[0];
  return first(own.downbeats) ?? first(own.beats) ?? T.ZERO;
}

/** Volume keys inside the clip's length (clip-local times before its duration). */
const keysInside = (c: MediaClip | undefined) => (c?.volume ?? []).filter((k) => T.lt(k.time, c!.duration)).length;

/** The steps that make the music clip `clipId` play `assetId` from `sourceIn` and end at `to` (default its current end); see the header. */
export function planMusicSwap(doc: ProjectDocument, clipId: string, assetId: string, opts: { sourceIn?: T.RationalTime; to?: T.RationalTime } = {}): MusicSwapPlan {
  const { clip } = mustMusicClip(doc, clipId);
  const asset = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]! : undefined;
  if (!asset) throw new OpError('not_found', `asset ${assetId} not found`, { assetId }, 'Call get_summary to list assets.');
  const rate = doc.settings.frameRate;
  const sourceIn = opts.sourceIn ?? musicStartOf(doc, assetId);
  const to = opts.to ?? clipEnd(clip);
  const steps: OpCall[] = [];
  // the new file, from sourceIn, may be shorter than the clip: the clip is shortened first so that replace_clip_media accepts it
  const fileEnd = floorFrame(T.add(clip.start, T.sub(asset.duration, sourceIn)), rate);
  if (T.lt(fileEnd, clipEnd(clip))) steps.push({ op: 'trim_clip', args: { clipId, edge: 'end', to: fileEnd } });
  steps.push({ op: 'replace_clip_media', args: { clipId, assetId, sourceIn } });
  // the ending, worked out on the document as it is after those steps (its refusals are the steps' own)
  const mid = applyTransaction(doc, steps, { idSeed: 'swap_', actor: 'plan' }).doc;
  const ending = musicEndingSteps(mid, clipId, to);
  steps.push(...ending.steps);
  const after = applyTransaction(doc, steps, { idSeed: 'swap_', actor: 'plan' }).doc;
  const was = keysInside(clip), now = keysInside(findClip(after, clipId)?.clip as MediaClip | undefined);
  return { steps, droppedVolumeKeys: Math.max(0, was - now), sourceIn, end: ending.end, cut: ending.cut };
}
