/**
 * Impact sync planning (wave 7 musicfit; built by builder A). Pure and exact; the op sync_impact (impactOps.ts) and the editor's
 * read-out use the same function, so the line «הרגע 4 פריימים אחרי הפעימה» and the edit agree. Rules (decisions §2.10, C8):
 * - The moment's position is speed.ts timelineOfSource (reverse-aware). The frame that SHOWS it: for a forward clip the frame whose
 *   half-open interval holds that time (floor); for a reversed clip the interval runs the other way, (t − 1 frame, t], so it is
 *   ceil − 1 (a moment at the start of a source frame is shown by the frame that ends there).
 * - The music is musicGrid.ts musicAt under the moment, never the clip itself or a clip linked to it. A beat's frame is the NEAREST
 *   frame (ties up, as the cut read-out, apps/web/src/editor/inspector.model.ts); only beats whose frame lies inside the clip.
 * - pick: nearest (ties to the earlier), earlier (the last beat frame before the moment's), later (the first after). The nearest
 *   frame equal to the moment's → alreadyOnBeat. When the file (or a linked clip's) has no material that far, the next beat in the
 *   same order that it can reach is used (`wanted` and `used` differ); none → noRoom with maxEarlier and maxLater.
 * - by = f_m − f_b frames for a forward clip, f_b − f_m for a reversed one (slip_clip: positive shows later source). offsetBefore is
 *   f_m − f_b (positive: the moment is after the beat); residualMs = the beat's exact time minus the start of its frame (signed, at
 *   most half a frame).
 */
import * as T from '@pulseframe/time';
import type { MediaClip, ProjectDocument } from './schema.ts';
import type { MusicFitRefusalKey } from './musicFitContract.ts';
import { findClip, OpError, partnersOf } from './ops.ts';
import { musicAtExcept } from './musicGrid.ts';
import { sourceEnd, timelineOfSource, toSourceSpan, toTimelineSpan } from './speed.ts';

export interface ImpactPlan {
  clipId: string; moment: T.RationalTime;
  /** The frame that shows the moment now, and the frame of the chosen beat. */
  momentFrame: number; targetFrame: number;
  /** The slip for slip_clip (timeline amount; sign per the clip's direction). */
  by: T.RationalTime;
  offsetBefore: { frames: number; ms: number }; residualMs: number;
  musicClipId: string; viaAssetId: string; wanted: T.RationalTime; used: T.RationalTime;
}
type Refused = { refusal: MusicFitRefusalKey; details: Record<string, unknown> };

/** The frame (project rate) that shows source moment `s` of a media clip. */
export function frameShowing(clip: MediaClip, s: T.RationalTime, rate: { num: number; den: number }): number {
  const t = timelineOfSource(clip, s);
  if (!clip.reverse) return T.frameIndexAt(t, rate);
  const f = T.frameIndexAt(t, rate);
  return T.isFrameAligned(t, rate) ? f - 1 : f;
}
/** Can this clip hold a marked moment at all? (set_clip_impact and sync_impact: impactNoMoment otherwise.) */
export function canHoldMoment(doc: ProjectDocument, clipId: string): boolean {
  const f = findClip(doc, clipId);
  if (!f || f.clip.type !== 'media' || f.clip.freeze || (f.track.kind !== 'video' && f.track.kind !== 'audio')) return false;
  const asset = Object.hasOwn(doc.assets, f.clip.assetId) ? doc.assets[f.clip.assetId] : undefined;
  return !!asset && asset.kind !== 'image';
}
const ms1 = (x: number) => Math.round(x * 10) / 10;

/** What sync_impact would do, or the refusal it would give (key and its details). Throws OpError not_found for an unknown clip. */
export function planImpact(doc: ProjectDocument, clipId: string, moment: T.RationalTime | undefined, to: 'beat' | 'bar', pick: 'nearest' | 'earlier' | 'later' = 'nearest'): ImpactPlan | Refused {
  const found = findClip(doc, clipId);
  if (!found) throw new OpError('not_found', `clip ${clipId} not found`, { clipId }, 'Call get_timeline to list current clip ids.');
  if (!canHoldMoment(doc, clipId)) return { refusal: 'impactNoMoment', details: { clipId } };
  const clip = found.clip as MediaClip;
  const asset = doc.assets[clip.assetId]!;
  const m = moment ?? clip.impact;
  if (m === undefined) return { refusal: 'noImpact', details: { clipId } };
  if (T.isNegative(m) || !T.lt(m, asset.duration)) return { refusal: 'impactOutsideFile', details: { clipId, moment: m, fileDuration: asset.duration } };
  if (T.lt(m, clip.sourceIn) || !T.lt(m, sourceEnd(clip))) return { refusal: 'impactOutside', details: { clipId, moment: m, shownFrom: clip.sourceIn, shownTo: sourceEnd(clip) } };
  const rate = doc.settings.frameRate;
  const fm = frameShowing(clip, m, rate);
  const tm = T.frameTime(fm, rate);
  const exclude = new Set([clip.id, ...partnersOf(doc, clip).map((p) => p.clip.id)]);
  const music = musicAtExcept(doc, timelineOfSource(clip, m), found.seq.id, exclude);
  const list = music ? (to === 'bar' ? music.bars : music.beats) : [];
  if (!music || list.length === 0) return { refusal: 'noMusic', details: { clipId, at: tm, to } };
  // beat frames inside the clip, one beat per frame (the first)
  const first = T.frameIndexAt(clip.start, rate), end = T.frameIndexAt(T.add(clip.start, clip.duration), rate);
  const cands: { f: number; t: T.RationalTime }[] = [];
  for (const t of list) { const f = T.nearestFrameIndex(t, rate); if (f >= first && f < end && !cands.some((c) => c.f === f)) cands.push({ f, t }); }
  const ordered = pick === 'earlier' ? cands.filter((c) => c.f < fm).sort((a, b) => b.f - a.f)
    : pick === 'later' ? cands.filter((c) => c.f > fm).sort((a, b) => a.f - b.f)
    : [...cands].sort((a, b) => Math.abs(a.f - fm) - Math.abs(b.f - fm) || a.f - b.f);
  if (pick === 'nearest' && ordered[0]?.f === fm) return { refusal: 'alreadyOnBeat', details: { clipId, frame: fm, beat: ordered[0].t } };
  // the room of the clip and of every clip linked to it (slip_clip moves them together)
  let earlier: T.RationalTime | null = null, later: T.RationalTime | null = null;
  for (const c of [clip, ...partnersOf(doc, clip).map((p) => p.clip)]) {
    const a = Object.hasOwn(doc.assets, c.assetId) ? doc.assets[c.assetId]! : null;
    if (!a) continue;
    const used = c.freeze ? T.ZERO : toSourceSpan(c, c.duration);
    const e = toTimelineSpan(c, c.sourceIn), l = toTimelineSpan(c, T.sub(T.sub(a.duration, c.sourceIn), used));
    earlier = earlier === null ? e : T.min(earlier, e);
    later = later === null ? l : T.min(later, l);
  }
  const room = { maxEarlier: earlier ?? T.ZERO, maxLater: later ?? T.ZERO };
  const slipOf = (fb: number) => (clip.reverse ? fb - fm : fm - fb);
  const fits = (k: number) => (k < 0 ? T.lte(T.frameTime(-k, rate), room.maxEarlier) : T.lte(T.frameTime(k, rate), room.maxLater));
  const chosen = ordered.find((c) => c.f !== fm && fits(slipOf(c.f)));
  if (!chosen) return { refusal: 'noRoom', details: { clipId, to, pick, ...room, ...(ordered[0] ? { wanted: ordered[0].t } : {}) } };
  const frames = fm - chosen.f;
  const fps = rate.num / rate.den;
  return {
    clipId, moment: m, momentFrame: fm, targetFrame: chosen.f, by: T.frameTime(slipOf(chosen.f), rate),
    offsetBefore: { frames, ms: ms1((frames * 1000) / fps) },
    residualMs: Math.round(T.toSeconds(T.sub(chosen.t, T.frameTime(chosen.f, rate))) * 1e6) / 1e3,
    musicClipId: music.clip.id, viaAssetId: music.viaAssetId, wanted: ordered[0]!.t, used: chosen.t,
  };
}
