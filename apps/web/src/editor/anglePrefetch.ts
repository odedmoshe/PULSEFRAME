/**
 * Which decoders the program pool keeps warm while a multicam program plays (MediaPool.warm; ADR-0020 live switching, ADR-0005).
 * Pure and testable without a browser. In order of how likely each is to be shown next:
 *   1. the next segment of the program, when it starts within the horizon (a planned cut): its asset at its first frame;
 *   2. while switches are being recorded, every other picture angle at the frame on screen, the angles the program showed most
 *      recently first, then the rest in digit order (1..9). The angle on air is not warmed: its decoder is the one drawing.
 * Each request asks for the frame BEFORE the one that would be shown, so a warm decoder is never past the picture it will be
 * asked for (it then decodes forward one frame instead of seeking). The budget (MediaPool.warm with fitWarmBudget) decides how
 * many of these are kept; nothing here decides what any frame shows.
 */
import * as T from '@pulseframe/time';
import { clipEnd, fromGroupExact, groupGrid, groupTimeAt, isPlaced, multicamGroupOf, pieceCoverage, quantise, sourceFrameIndexAt, type Asset, type MediaClip, type ProjectDocument } from '@pulseframe/core';
import type { WarmRequest } from '../media.ts';

export interface AngleWarm extends WarmRequest { angleId: string | null; why: 'next_in_program' | 'live_angle' }
export interface AnglePrefetchOptions {
  quality: 'draft' | 'full';
  /** True while switches are recorded: every other picture angle is a candidate. */
  live: boolean;
  /** How far ahead (frames) the next segment is warmed; default one second. */
  horizonFrames?: number;
}

type VideoAsset = Asset & { video: NonNullable<Asset['video']> };
const videoAsset = (doc: ProjectDocument, id: string): VideoAsset | null => { const a = Object.hasOwn(doc.assets, id) ? doc.assets[id] : undefined; return a?.video ? (a as VideoAsset) : null; };
/** sourceSeekSeconds (evaluate.ts) of the frame before the one `clip` shows at `t`, never before the first. */
function warmSeconds(asset: VideoAsset, clip: MediaClip, t: T.RationalTime, rate: { num: number; den: number }): number {
  const idx = Math.max(0, sourceFrameIndexAt(asset, clip, t, rate) - 1);
  return ((idx + 0.5) * asset.video.frameRate.den) / asset.video.frameRate.num;
}

export function anglePrefetchPlan(doc: ProjectDocument, prog: { sequenceId: string; trackId: string }, frame: number, o: AnglePrefetchOptions): AngleWarm[] {
  const seq = Object.hasOwn(doc.sequences, prog.sequenceId) ? doc.sequences[prog.sequenceId] : undefined;
  const track = seq?.tracks.find((x) => x.id === prog.trackId);
  if (!track || track.kind !== 'video') return [];
  const rate = doc.settings.frameRate, t = T.frameTime(Math.max(0, frame), rate);
  const i = track.clips.findIndex((c) => T.lte(c.start, t) && T.lt(t, clipEnd(c)));
  const cur = i >= 0 ? track.clips[i]! : undefined;
  const out: AngleWarm[] = [];
  // 1. the next segment, when it starts within the horizon
  const horizon = T.frameTime(o.horizonFrames ?? Math.max(1, Math.round(rate.num / rate.den)), rate);
  const next = track.clips[i >= 0 ? i + 1 : track.clips.findIndex((c) => T.lt(t, c.start))];
  if (next && next.type === 'media' && T.lte(next.start, T.add(t, horizon)) && T.lt(t, next.start)) {
    const a = videoAsset(doc, next.assetId);
    if (a) out.push({ assetId: a.id, quality: o.quality, seconds: warmSeconds(a, next, next.start, rate), width: a.video.width, height: a.video.height, angleId: next.multicam?.angleId ?? null, why: 'next_in_program' });
  }
  // 2. live: the other picture angles at the frame on screen
  if (!o.live || !cur || cur.type !== 'media' || !cur.multicam) return out;
  const group = multicamGroupOf(doc, cur.multicam.groupId);
  const gt = groupTimeAt(doc, prog.sequenceId, prog.trackId, t);
  if (!group || !gt || gt.groupId !== group.id) return out;
  const grid = groupGrid(doc, group);
  const recent: string[] = [];
  for (let k = i - 1; k >= 0; k--) { const c = track.clips[k]!; if (c.type === 'media' && c.multicam?.groupId === group.id && !recent.includes(c.multicam.angleId)) recent.push(c.multicam.angleId); }
  const pictures = group.angles.filter((a) => a.kind === 'picture');
  const order = [...recent.map((id) => pictures.find((a) => a.id === id)).filter((a) => !!a), ...pictures.filter((a) => !recent.includes(a.id))];
  for (const angle of order) {
    if (angle.id === cur.multicam.angleId) continue;
    for (const piece of angle.pieces) {
      const a = videoAsset(doc, piece.assetId);
      if (!a || !isPlaced(piece)) continue;
      const cov = pieceCoverage(piece, a.duration, grid);
      if (!cov || T.lt(gt.g, cov.start) || !T.lt(gt.g, cov.end)) continue;
      // the segment a cut here would make: this piece from the source time it shows at this group time (switch_angles' one rounding)
      const probe: MediaClip = { id: 'warm_probe', type: 'media', assetId: a.id, start: t, duration: T.frameTime(1, rate), sourceIn: quantise(fromGroupExact(piece, gt.g), grid), gain: 0, linkGroupId: null, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } };
      out.push({ assetId: a.id, quality: o.quality, seconds: warmSeconds(a, probe, t, rate), width: a.video.width, height: a.video.height, angleId: angle.id, why: 'live_angle' });
      break;
    }
  }
  return out;
}
