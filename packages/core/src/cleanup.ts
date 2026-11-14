/**
 * Cleanup candidates (SPEC §16): turn ranges found in a SOURCE file (e.g. detected silence) into timeline cuts.
 * Pure. Candidates are suggestions: callers show them or submit them as a proposal; nothing here edits a document.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument } from './schema.ts';
import type { OpCall } from './ops.ts';

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
        const from = T.max(c.sourceIn, s), to = T.min(T.add(c.sourceIn, c.duration), e);
        if (!T.lt(from, to)) continue;
        const start = ceilFrame(T.add(c.start, T.sub(from, c.sourceIn)), rate);
        const end = T.frameTime(T.frameIndexAt(T.add(c.start, T.sub(to, c.sourceIn)), rate), rate);
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
