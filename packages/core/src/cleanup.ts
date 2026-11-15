/**
 * Cleanup candidates (SPEC §16): turn ranges found in a SOURCE file (e.g. detected silence) into timeline cuts.
 * Pure. Candidates are suggestions: callers show them or submit them as a proposal; nothing here edits a document.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument } from './schema.ts';
import type { OpCall } from './ops.ts';
import { sourceEnd, timelineAt } from './speed.ts';

export interface TimeRange { start: T.RationalTime; end: T.RationalTime }

const ceilFrame = (t: T.RationalTime, rate: { num: number; den: number }) => {
  const i = T.frameIndexAt(t, rate);
  return T.frameTime(T.isFrameAligned(t, rate) ? i : i + 1, rate);
};

/**
 * Timeline ranges where the given source ranges of `assetId` are currently playing.
 * Each source range is first shrunk by `keep` on both sides (breathing room), then mapped through every clip of the asset
 * and snapped INWARD to whole frames, so a cut never removes material outside the source range. Result: merged, ascending.
 */
export function sourceRangesToTimeline(doc: ProjectDocument, assetId: string, ranges: TimeRange[], keep: T.RationalTime = T.ZERO, sequenceId = doc.mainSequenceId): TimeRange[] {
  const seq = doc.sequences[sequenceId];
  if (!seq) return [];
  const rate = doc.settings.frameRate;
  const out: TimeRange[] = [];
  for (const r of ranges) {
    const s = T.add(r.start, keep), e = T.sub(r.end, keep);
    if (!T.lt(s, e)) continue;
    for (const track of seq.tracks)
      for (const c of track.clips) {
        if (c.type !== 'media' || c.assetId !== assetId) continue;
        const from = T.max(c.sourceIn, s), to = T.min(sourceEnd(c), e);
        if (!T.lt(from, to)) continue;
        const start = ceilFrame(timelineAt(c, from), rate);
        const end = T.frameTime(T.frameIndexAt(timelineAt(c, to), rate), rate);
        if (T.lt(start, end)) out.push({ start, end });
      }
  }
  out.sort((a, b) => T.cmp(a.start, b.start));
  const merged: TimeRange[] = [];
  for (const r of out) {
    const last = merged.at(-1);
    if (last && T.lte(r.start, last.end)) last.end = T.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/** One `cut_range` per range, latest first, so each cut leaves the earlier ranges where they were. Submit as ONE transaction. */
export const cutOps = (ranges: TimeRange[]): OpCall[] => [...ranges].sort((a, b) => T.cmp(b.start, a.start)).map((r) => ({ op: 'cut_range', args: { start: r.start, end: r.end } }));

/** Source times of an asset mapped to where they currently play on the timeline (every clip of the asset), ascending and unique. */
export function sourceTimesToTimeline(doc: ProjectDocument, assetId: string, times: T.RationalTime[], sequenceId = doc.mainSequenceId): T.RationalTime[] {
  const seq = doc.sequences[sequenceId];
  if (!seq) return [];
  const out: T.RationalTime[] = [];
  for (const track of seq.tracks)
    for (const c of track.clips) {
      if (c.type !== 'media' || c.assetId !== assetId) continue;
      const end = sourceEnd(c);
      for (const t of times) if (!T.lt(t, c.sourceIn) && T.lt(t, end)) out.push(timelineAt(c, t));
    }
  return out.sort(T.cmp).filter((t, i, a) => i === 0 || !T.eq(a[i - 1]!, t));
}
/** Beats and scene cuts as they fall on the timeline right now (derived, never stored: they follow every edit). */
export function timelineMarkers(doc: ProjectDocument) {
  const beats: T.RationalTime[] = [], scenes: T.RationalTime[] = [];
  for (const a of Object.values(doc.analyses ?? {})) {
    if (a.beats) beats.push(...sourceTimesToTimeline(doc, a.assetId, a.beats.beats));
    if (a.scenes) scenes.push(...sourceTimesToTimeline(doc, a.assetId, a.scenes.cuts));
  }
  const uniq = (l: T.RationalTime[]) => l.sort(T.cmp).filter((t, i, x) => i === 0 || !T.eq(x[i - 1]!, t));
  return { beats: uniq(beats), sceneCuts: uniq(scenes) };
}
