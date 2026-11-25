/**
 * Cleanup candidates (SPEC §16): turn ranges found in a SOURCE file (e.g. detected silence) into timeline cuts.
 * Pure. Candidates are suggestions: callers show them or submit them as a proposal; nothing here edits a document.
 */
import * as T from '@pulseframe/time';
import type { MediaClip, ProjectDocument } from './schema.ts';
import type { OpCall } from './ops.ts';
import { sourceEnd, timelineAt, timelineOfSource } from './speed.ts';
import { own } from './own.ts';
import { beatsFor, sceneCutsFor, timingRelations } from './lineage.ts';

export interface TimeRange { start: T.RationalTime; end: T.RationalTime }

const ceilFrame = (t: T.RationalTime, rate: { num: number; den: number }) => {
  const i = T.frameIndexAt(t, rate);
  return T.frameTime(T.isFrameAligned(t, rate) ? i : i + 1, rate);
};

/** A clip that shows a copy of a recording made by a derivation that records no time mapping (lineage.ts timingRelations 'untimed'). */
export interface UntimedCopy { clipId: string; assetId: string; madeFromAssetId: string }
/** A clip an edit by a recording's times left alone, named in the edit's answer (the editor shows it as a note). */
export interface SkippedClip { clipId: string; assetId: string; reason: 'untimed_copy' }
/**
 * How the clips of the sequence relate to `assetId`'s recording: `mapped` counts the clips that play it on a known clock (its own
 * and those of time-preserving copies); `untimed` lists the clips of moving pictures or sounds made from it without a recorded time
 * mapping (a reversed, stretched or generated rendition). Freeze frames play no time and are left out of both.
 * Edits by the recording's times skip the untimed ones, as they skip clips that play backwards, and name them (skippedClips); they
 * refuse (untimedCopyRefusal) only when nothing maps at all.
 */
export function timingCoverage(doc: ProjectDocument, assetId: string, sequenceId = doc.mainSequenceId): { mapped: number; untimed: UntimedCopy[] } {
  const seq = Object.hasOwn(doc.sequences, sequenceId) ? doc.sequences[sequenceId] : undefined;
  const out = { mapped: 0, untimed: [] as UntimedCopy[] };
  if (!seq) return out;
  const rel = timingRelations(doc, assetId);
  for (const track of seq.tracks)
    for (const c of track.clips) {
      if (c.type !== 'media' || c.freeze) continue;
      const r = rel(c.assetId);
      if (r?.kind === 'same') out.mapped++;
      else if (r?.kind === 'untimed') out.untimed.push({ clipId: c.id, assetId: c.assetId, madeFromAssetId: r.viaAssetId });
    }
  return out;
}
/** The clips of `untimedCopies` as an edit's answer names them. */
export const skippedClips = (copies: UntimedCopy[]): SkippedClip[] => copies.map((c) => ({ clipId: c.clipId, assetId: c.assetId, reason: 'untimed_copy' as const }));
/** The refusal when no clip maps and an untimed copy is the only place the moments could be (the caller raises it as its own error type, code 'untimed_copy'). */
export const untimedCopyRefusal = (copies: UntimedCopy[]) => ({
  code: 'untimed_copy' as const,
  message: `clip ${copies[0]!.clipId} shows a copy of this recording that does not keep its timing, so where these moments are in it is unknown`,
  hint: 'Give that clip the recording itself or a copy that keeps its timing (replace_clip_media), or remove it, and try again; or cut by time with cut_range.',
  details: { clipIds: copies.map((c) => c.clipId), assetIds: [...new Set(copies.map((c) => c.assetId))] },
});

/**
 * Timeline ranges where the given source ranges of `assetId` are currently playing.
 * Each source range is first shrunk by `keep` on both sides (breathing room), then mapped through every clip that plays that
 * recording: clips of the asset itself and of time-preserving copies of it or of its source (lineage.ts timingRelations: an
 * enhanced picture, a cleaned-up voice, a smoother slow motion, through replace_clip_asset or replace_clip_media), each on its own
 * clock. Clips of untimed copies are not mapped (see timingCoverage). Snapped INWARD to whole frames, so a cut never removes
 * material outside the source range. Result: merged, ascending.
 */
export function sourceRangesToTimeline(doc: ProjectDocument, assetId: string, ranges: TimeRange[], keep: T.RationalTime = T.ZERO, sequenceId = doc.mainSequenceId): TimeRange[] {
  const seq = own(doc.sequences, sequenceId);
  if (!seq) return [];
  const rate = doc.settings.frameRate;
  const rel = timingRelations(doc, assetId);
  const out: TimeRange[] = [];
  for (const r of ranges) {
    const s0 = T.add(r.start, keep), e0 = T.sub(r.end, keep);
    if (!T.lt(s0, e0)) continue;
    for (const track of seq.tracks)
      for (const c of track.clips) {
        if (c.type !== 'media') continue;
        const k = rel(c.assetId);
        if (k?.kind !== 'same') continue;
        const s = T.add(s0, k.delta), e = T.add(e0, k.delta); // on the clip's own file's clock
        const from = T.max(c.sourceIn, s), to = T.min(sourceEnd(c), e);
        if (!T.lt(from, to)) continue;
        // a reversed clip plays the later source first: the range's end comes first on the timeline
        const a = timelineOfSource(c, c.reverse ? to : from), b = timelineOfSource(c, c.reverse ? from : to);
        const start = ceilFrame(a, rate);
        const end = T.frameTime(T.frameIndexAt(b, rate), rate);
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
  const seq = own(doc.sequences, sequenceId);
  if (!seq) return [];
  const out: T.RationalTime[] = [];
  for (const track of seq.tracks)
    for (const c of track.clips) {
      if (c.type !== 'media' || c.assetId !== assetId) continue;
      const end = sourceEnd(c);
      for (const t of times) if (!T.lt(t, c.sourceIn) && T.lt(t, end)) out.push(timelineOfSource(c, t));
    }
  return out.sort(T.cmp).filter((t, i, a) => i === 0 || !T.eq(a[i - 1]!, t));
}
/**
 * Beats and scene cuts as they fall on the timeline right now (derived, never stored: they follow every edit). Each clip shows the
 * beats and scene cuts of its own file, or of the nearest time-preserving source of it that was measured (lineage.ts beatsFor,
 * sceneCutsFor: a cleaned-up or enhanced copy keeps its source's moments, moved exactly onto its own clock). A copy made without a
 * recorded time mapping (reversed, stretched, generated) has none of its source's: where they lie in it is unknown.
 */
export function timelineMarkers(doc: ProjectDocument) {
  const beats: T.RationalTime[] = [], scenes: T.RationalTime[] = [], downbeats: T.RationalTime[] = [];
  const own = (times: T.RationalTime[] | undefined, offset: T.RationalTime) => (!times ? [] : T.isZero(offset) ? times : times.map((t) => T.sub(t, offset)));
  // per file, on its own clock, found once however many clips show it
  const byAsset = new Map<string, { beats: T.RationalTime[]; downbeats: T.RationalTime[]; scenes: T.RationalTime[] }>();
  const timesOf = (assetId: string) => {
    let m = byAsset.get(assetId);
    if (!m) {
      const b = beatsFor(doc, assetId), s = sceneCutsFor(doc, assetId);
      m = { beats: b ? own(b.beats.beats, b.offset) : [], downbeats: b ? own(b.beats.downbeats, b.offset) : [], scenes: s ? own(s.cuts, s.offset) : [] };
      byAsset.set(assetId, m);
    }
    return m;
  };
  const through = (c: MediaClip, times: T.RationalTime[], out: T.RationalTime[]) => {
    if (!times.length) return;
    const end = sourceEnd(c);
    for (const t of times) if (!T.lt(t, c.sourceIn) && T.lt(t, end)) out.push(timelineOfSource(c, t));
  };
  for (const track of doc.sequences[doc.mainSequenceId]?.tracks ?? [])
    for (const c of track.clips) {
      if (c.type !== 'media') continue;
      const m = timesOf(c.assetId);
      through(c, m.beats, beats); through(c, m.downbeats, downbeats); through(c, m.scenes, scenes);
    }
  const uniq = (l: T.RationalTime[]) => l.sort(T.cmp).filter((t, i, x) => i === 0 || !T.eq(x[i - 1]!, t));
  return { beats: uniq(beats), sceneCuts: uniq(scenes), /** Beats that start a bar (a subset of `beats`). */ downbeats: uniq(downbeats) };
}
