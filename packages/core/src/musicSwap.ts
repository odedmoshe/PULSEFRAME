/**
 * Swapping and ending the music of a clip (wave 7 musicfit; BUILDER B). Final signatures; bodies throw MusicFitNotBuilt until built.
 * No new op: one transaction of existing public ops (decisions §2.1, §2.4). The assistant's prompt is unchanged because no op changed.
 *
 * planMusicSwap: refuses a clip that plays at another speed or backwards (notFollowable) itself; every other refusal is the steps' own.
 *   Steps: trim_clip end (only when the new file from sourceIn is shorter than the clip), replace_clip_media {clipId, assetId, sourceIn}
 *   (sourceIn default: the first bar start, else the first beat, through beatsFor, else 0), then musicEndingSteps. Volume keys lost are
 *   counted by applying the steps to a draft and comparing.
 * musicEndingSteps: end = min(target, the file's end floored to a frame from the clip's start); a fade-out (set_clip_fades, today's
 *   fit_music default length: one second, at most half the clip) only when the file is cut by at least one frame, else fadeOut 0.
 *   Used when the asset has provenance.fitted, or is built-in music whose floored end is the target frame. Never reads params.end.
 */
import type * as T from '@pulseframe/time';
import type { OpCall } from './ops.ts';
import type { ProjectDocument } from './schema.ts';
import { MusicFitNotBuilt } from './musicFitContract.ts';

export interface MusicSwapPlan { steps: OpCall[]; droppedVolumeKeys: number; sourceIn: T.RationalTime; end: T.RationalTime; cut: boolean }
export function planMusicSwap(doc: ProjectDocument, clipId: string, assetId: string, opts: { sourceIn?: T.RationalTime; to?: T.RationalTime } = {}): MusicSwapPlan {
  void doc; void clipId; void assetId; void opts;
  throw new MusicFitNotBuilt('planMusicSwap');
}
/** The steps that end a music clip with its file or at `target` (see the header). */
export function musicEndingSteps(doc: ProjectDocument, clipId: string, target: T.RationalTime): { steps: OpCall[]; end: T.RationalTime; cut: boolean } {
  void doc; void clipId; void target;
  throw new MusicFitNotBuilt('musicEndingSteps');
}
