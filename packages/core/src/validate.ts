import * as T from '@pulseframe/time';
import { findEffect } from './effects.ts';
import { ANIMATABLE, TransformSchema, type Clip, type ProjectDocument, type Track } from './schema.ts';

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
      if ((tr.kind === 'caption') !== !!tr.caption) issues.push({ code: 'caption_config', message: `track ${tr.id}: caption settings must exist exactly on caption tracks`, ids: [tr.id] });
      if (tr.audio && tr.kind !== 'audio') issues.push({ code: 'audio_config', message: `track ${tr.id}: audio settings belong to audio tracks`, ids: [tr.id] });
      for (const src of tr.audio?.duck?.sourceTrackIds ?? []) {
        const st = seq.tracks.find((t) => t.id === src);
        if (!st || st.kind !== 'audio' || st.id === tr.id) issues.push({ code: 'duck_source', message: `track ${tr.id} ducks under ${src}, which is missing, not an audio track, or itself`, ids: [tr.id] });
      }
      if (tr.caption?.linkedTrackId) {
        const linked = seq.tracks.find((t) => t.id === tr.caption!.linkedTrackId);
        if (!linked || (linked.kind !== 'audio' && linked.kind !== 'video')) issues.push({ code: 'caption_link', message: `caption track ${tr.id} is linked to a missing or non-media track`, ids: [tr.id] });
      }
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
        for (const prop of ANIMATABLE) {
          const keys = c.keyframes?.[prop];
          if (!keys) continue;
          if (keys.length === 0) issues.push({ code: 'empty_keyframes', message: `clip ${c.id} has an empty ${prop} keyframe list`, ids: [c.id] });
          keys.forEach((k, i) => {
            if (i > 0 && !T.lt(keys[i - 1]!.time, k.time)) issues.push({ code: 'unsorted_keyframes', message: `clip ${c.id} ${prop} keyframes are not strictly increasing in time`, ids: [c.id] });
            if (!T.isFrameAligned(k.time, rate)) issues.push({ code: 'not_frame_aligned', message: `clip ${c.id} ${prop} keyframe is not on a frame boundary`, ids: [c.id] });
            if (!TransformSchema.shape[prop].safeParse(k.value).success) issues.push({ code: 'keyframe_out_of_range', message: `clip ${c.id} ${prop} keyframe value ${k.value} is out of range`, ids: [c.id] });
          });
        }
        const seenFx = new Set<string>();
        for (const fx of c.effects ?? []) {
          const d = findEffect(fx.type);
          if (!d) issues.push({ code: 'unknown_effect', message: `clip ${c.id} uses effect "${fx.type}", which this build does not have`, ids: [c.id] });
          else if (!d.params.safeParse(fx.params).success) issues.push({ code: 'effect_params', message: `clip ${c.id} effect ${fx.type} has invalid parameters`, ids: [c.id] });
          if (seenFx.has(fx.id)) issues.push({ code: 'duplicate_id', message: `clip ${c.id} has two effects with id ${fx.id}`, ids: [c.id] });
          seenFx.add(fx.id);
        }
        if ((c.effects?.length || c.blend) && (tr.kind === 'audio' || tr.kind === 'caption')) issues.push({ code: 'incompatible_track', message: `clip ${c.id} on a ${tr.kind} track cannot carry picture effects`, ids: [c.id, tr.id] });
        if (c.type === 'media' && (c.mask || c.transition) && tr.kind !== 'video') issues.push({ code: 'incompatible_track', message: `clip ${c.id}: masks and transitions belong to picture clips`, ids: [c.id, tr.id] });
        if (c.type === 'text' || c.type === 'caption') {
          if (tr.kind !== c.type) issues.push({ code: 'incompatible_track', message: `${c.type} clip ${c.id} on ${tr.kind} track`, ids: [c.id, tr.id] });
          continue;
        }
        if (tr.kind === 'caption') issues.push({ code: 'incompatible_track', message: `media clip ${c.id} on caption track`, ids: [c.id, tr.id] });
        const asset = doc.assets[c.assetId];
        if (!asset) { issues.push({ code: 'missing_asset', message: `clip ${c.id} references missing asset ${c.assetId}`, ids: [c.id, c.assetId] }); continue; }
        if (tr.kind === 'text') issues.push({ code: 'incompatible_track', message: `media clip ${c.id} on text track`, ids: [c.id, tr.id] });
        if (tr.kind === 'video' && !asset.video && !(asset.kind === 'image' && asset.image)) issues.push({ code: 'incompatible_track', message: `asset ${asset.id} has no picture for video track`, ids: [c.id, tr.id] });
        if (tr.kind === 'audio' && !asset.audio) issues.push({ code: 'incompatible_track', message: `asset ${asset.id} has no audio for audio track`, ids: [c.id, tr.id] });
        if ((c.fadeIn || c.fadeOut) && tr.kind !== 'audio') issues.push({ code: 'incompatible_track', message: `clip ${c.id}: audio fades belong to clips on audio tracks`, ids: [c.id] });
        if ((c.fadeIn && T.isNegative(c.fadeIn)) || (c.fadeOut && T.isNegative(c.fadeOut)) || T.lt(c.duration, T.add(c.fadeIn ?? T.ZERO, c.fadeOut ?? T.ZERO))) issues.push({ code: 'fade_out_of_bounds', message: `clip ${c.id}: fades are negative or longer than the clip`, ids: [c.id] });
        if (T.isNegative(c.sourceIn)) issues.push({ code: 'source_out_of_bounds', message: `clip ${c.id} sourceIn < 0`, ids: [c.id] });
        if (asset.kind !== 'image' && T.lt(asset.duration, T.add(c.sourceIn, c.duration)))
          issues.push({ code: 'source_out_of_bounds', message: `clip ${c.id} reads past the end of asset ${asset.id}`, ids: [c.id, asset.id] });
      }
    }
  }
  for (const [key, an] of Object.entries(doc.analyses ?? {})) {
    if (key !== an.assetId || !doc.assets[an.assetId]) issues.push({ code: 'missing_asset', message: `analysis ${key} refers to a missing asset`, ids: [key] });
    for (const [name, list] of [['scene cuts', an.scenes?.cuts], ['beats', an.beats?.beats]] as const)
      if (list?.some((t, i) => T.isNegative(t) || (i > 0 && !T.lt(list[i - 1]!, t)))) issues.push({ code: 'analysis_order', message: `${name} of asset ${key} must be non-negative and strictly ascending`, ids: [key] });
  }
  for (const [key, tr] of Object.entries(doc.transcripts ?? {})) {
    if (key !== tr.assetId) issues.push({ code: 'key_mismatch', message: `transcript key ${key} != assetId ${tr.assetId}`, ids: [key] });
    if (!doc.assets[tr.assetId]?.audio) issues.push({ code: 'missing_asset', message: `transcript refers to asset ${tr.assetId}, which is missing or has no audio`, ids: [tr.assetId] });
    let prevEnd = T.ZERO;
    for (const seg of tr.segments) {
      uniq(seg.id);
      const end = T.add(seg.start, seg.duration);
      if (T.lt(seg.start, prevEnd) || !T.lt(T.ZERO, seg.duration)) issues.push({ code: 'transcript_order', message: `segment ${seg.id} overlaps the previous one or has no duration`, ids: [seg.id] });
      prevEnd = end;
      let w = seg.start;
      for (const word of seg.words) {
        uniq(word.id);
        if (T.lt(word.start, w) || T.lt(end, T.add(word.start, word.duration)) || T.isNegative(word.duration)) issues.push({ code: 'transcript_order', message: `word ${word.id} is out of order or outside its segment`, ids: [word.id, seg.id] });
        w = T.add(word.start, word.duration);
      }
    }
  }
  return issues;
}
