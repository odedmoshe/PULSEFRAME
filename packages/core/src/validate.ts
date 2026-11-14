import * as T from '@pulseframe/time';
import type { Clip, ProjectDocument, Track } from './schema.ts';

export interface Issue { code: string; message: string; ids: string[] }

export const clipEnd = (c: Clip) => T.add(c.start, c.duration);

/** Tracks whose clips may not overlap in time. Audio overlaps are intentional and allowed (SPEC §5). */
export const forbidsOverlap = (t: Track) => t.kind !== 'audio';

export function sequenceDuration(doc: ProjectDocument, sequenceId = doc.mainSequenceId): T.RationalTime {
  let end = T.ZERO;
  for (const tr of doc.sequences[sequenceId]?.tracks ?? []) for (const c of tr.clips) end = T.max(end, clipEnd(c));
  return end;
}

/** Semantic validation beyond the zod shape: references, bounds, frame alignment, overlap policy, sorted clips, id uniqueness. */
export function validateProject(doc: ProjectDocument): Issue[] {
  const issues: Issue[] = [];
  const rate = doc.settings.frameRate;
  const seen = new Set<string>();
  const uniq = (id: string) => {
    if (seen.has(id)) issues.push({ code: 'duplicate_id', message: `duplicate id ${id}`, ids: [id] });
    seen.add(id);
  };
  if (!doc.sequences[doc.mainSequenceId]) issues.push({ code: 'missing_sequence', message: 'mainSequenceId does not exist', ids: [doc.mainSequenceId] });
  for (const [key, a] of Object.entries(doc.assets)) {
    if (key !== a.id) issues.push({ code: 'key_mismatch', message: `asset key ${key} != id ${a.id}`, ids: [key] });
    uniq(a.id);
  }
  for (const [key, seq] of Object.entries(doc.sequences)) {
    if (key !== seq.id) issues.push({ code: 'key_mismatch', message: `sequence key ${key} != id ${seq.id}`, ids: [key] });
    uniq(seq.id);
    for (const tr of seq.tracks) {
      uniq(tr.id);
      let prev: Clip | undefined;
      for (const c of tr.clips) {
        uniq(c.id);
        if (T.isNegative(c.start)) issues.push({ code: 'negative_start', message: `clip ${c.id} starts before 0`, ids: [c.id] });
        if (!T.lt(T.ZERO, c.duration)) issues.push({ code: 'empty_clip', message: `clip ${c.id} has non-positive duration`, ids: [c.id] });
        if (!T.isFrameAligned(c.start, rate) || !T.isFrameAligned(c.duration, rate))
          issues.push({ code: 'not_frame_aligned', message: `clip ${c.id} is not aligned to ${rate.num}/${rate.den} fps frames`, ids: [c.id] });
        if (prev && T.lt(c.start, prev.start)) issues.push({ code: 'unsorted_clips', message: `track ${tr.id} clips are not sorted by start`, ids: [tr.id] });
        if (prev && forbidsOverlap(tr) && T.lt(c.start, clipEnd(prev)))
          issues.push({ code: 'overlap', message: `clips ${prev.id} and ${c.id} overlap on ${tr.kind} track ${tr.id}`, ids: [prev.id, c.id] });
        prev = c;
        if (c.type === 'text') {
          if (tr.kind !== 'text') issues.push({ code: 'incompatible_track', message: `text clip ${c.id} on ${tr.kind} track`, ids: [c.id, tr.id] });
          continue;
        }
        const asset = doc.assets[c.assetId];
        if (!asset) { issues.push({ code: 'missing_asset', message: `clip ${c.id} references missing asset ${c.assetId}`, ids: [c.id, c.assetId] }); continue; }
        if (tr.kind === 'text') issues.push({ code: 'incompatible_track', message: `media clip ${c.id} on text track`, ids: [c.id, tr.id] });
        if (tr.kind === 'video' && !asset.video && asset.kind !== 'image') issues.push({ code: 'incompatible_track', message: `asset ${asset.id} has no picture for video track`, ids: [c.id, tr.id] });
        if (tr.kind === 'audio' && !asset.audio) issues.push({ code: 'incompatible_track', message: `asset ${asset.id} has no audio for audio track`, ids: [c.id, tr.id] });
        if (T.isNegative(c.sourceIn)) issues.push({ code: 'source_out_of_bounds', message: `clip ${c.id} sourceIn < 0`, ids: [c.id] });
        if (asset.kind !== 'image' && T.lt(asset.duration, T.add(c.sourceIn, c.duration)))
          issues.push({ code: 'source_out_of_bounds', message: `clip ${c.id} reads past the end of asset ${asset.id}`, ids: [c.id, asset.id] });
      }
    }
  }
  return issues;
}
