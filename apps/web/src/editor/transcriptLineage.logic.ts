/**
 * Which transcript the transcript and filler panels show for the selected clip, and where its words play (pure; unit-tested in
 * transcriptLineage.logic.test.ts). A clip that shows a time-preserving copy (an enhanced picture, a cleaned-up voice) has the
 * transcript of the recording it was made from, found through the same lineage as the server's edits (core transcriptFor), and
 * its words are placed on the timeline through every clip that plays that recording on a known clock (core timingRelations).
 */
import * as T from '@pulseframe/time';
import { sourceAt, sourceEnd, timelineAt, timingRelations, transcriptFor, type Clip, type ProjectDocument } from '@pulseframe/core';

type MediaClip = Extract<Clip, { type: 'media' }>;
type Transcript = ProjectDocument['transcripts'][string];
/** A clip that plays the transcribed recording: moment t of the recording is moment t + delta of the clip's own file. */
export interface SpeechClip { clip: MediaClip; delta: T.RationalTime }

/**
 * The transcript for the selected clip's file: its own, or that of the recording a time-preserving copy was made from; with nothing
 * selected, the first transcript of the project. `assetId` is the transcribed recording (the id the transcript ops take).
 */
export function transcriptOfSelection(doc: ProjectDocument, selectedAssetId: string | null): { assetId: string; transcript: Transcript } | null {
  if (selectedAssetId === null) {
    const first = Object.keys(doc.transcripts)[0];
    return first === undefined ? null : { assetId: first, transcript: doc.transcripts[first]! };
  }
  const found = transcriptFor(doc, selectedAssetId);
  return found ? { assetId: found.transcript.assetId, transcript: found.transcript } : null;
}

/** The picture and sound clips of the main timeline that play `assetId`'s recording forwards (its own and time-preserving copies'). */
export function speechClipsOf(doc: ProjectDocument, assetId: string): SpeechClip[] {
  const rel = timingRelations(doc, assetId);
  const out: SpeechClip[] = [];
  for (const tr of doc.sequences[doc.mainSequenceId]?.tracks ?? []) {
    if (tr.kind !== 'video' && tr.kind !== 'audio') continue;
    for (const c of tr.clips) {
      if (c.type !== 'media' || c.reverse) continue;
      const k = rel(c.assetId);
      if (k?.kind === 'same') out.push({ clip: c, delta: k.delta });
    }
  }
  return out;
}

/** Timeline time of a moment of the recording, or null when no clip plays it. */
export function recordingToTimeline(clips: SpeechClip[], s: T.RationalTime): T.RationalTime | null {
  for (const { clip, delta } of clips) {
    const own = T.add(s, delta);
    if (T.lte(clip.sourceIn, own) && T.lt(own, sourceEnd(clip))) return timelineAt(clip, own);
  }
  return null;
}

/** The moment of the recording that plays at timeline time `t`, or null when no clip of it plays there. */
export function recordingAt(clips: SpeechClip[], t: T.RationalTime): T.RationalTime | null {
  const playing = clips.find(({ clip }) => T.lte(clip.start, t) && T.lt(t, T.add(clip.start, clip.duration)));
  return playing ? T.sub(sourceAt(playing.clip, t), playing.delta) : null;
}

/** The editor's notes for the clips an edit by the recording's times left alone (skippedClips of the op, route or recipe answer). */
export function skippedNotes(doc: ProjectDocument, skipped: readonly { clipId: string; assetId: string }[] | undefined, template: string): string[] {
  // a picture and its linked sound are one note
  return [...new Set((skipped ?? []).map((s) => template.replace('{name}', doc.assets[s.assetId]?.name ?? s.clipId)))];
}
