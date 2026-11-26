/**
 * Where the captions of a project come from, and the one edit that makes them show the transcript (owner report 2026-11-26:
 * a caption track added before the transcript existed is a manual track with no cues, so a look picked for it styled nothing
 * and nothing could ever be drawn). Pure: the panels («כתוביות», «תמלול») and the timeline's caption lane read it.
 */
import * as T from '@pulseframe/time';
import { captionCues } from '@pulseframe/engine';
import type { OpCall, ProjectDocument, Sequence, Track } from '@pulseframe/core';

export type CaptionSource =
  /** no caption track */
  | { kind: 'none' }
  /** the first caption track shows the transcript (hidden: its eye is closed on the timeline, so nothing is drawn) */
  | { kind: 'transcript'; trackId: string; hidden: boolean }
  /** the first caption track holds cues typed or imported by hand */
  | { kind: 'manual'; trackId: string; cues: number }
  /** a manual caption track with no cues while a transcript exists: it is not connected to the transcript and shows nothing */
  | { kind: 'unlinked'; trackId: string; locked: boolean };

const mainTracks = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]?.tracks ?? [];
/** The caption track the «כתוביות» tab works on: the first one of the main sequence. */
export const firstCaptionTrack = (doc: ProjectDocument): Track | undefined => mainTracks(doc).find((x) => x.kind === 'caption' && !!x.caption);
const hasTranscript = (doc: ProjectDocument) => Object.values(doc.transcripts).some((t) => t.segments.length > 0);

export function captionSource(doc: ProjectDocument): CaptionSource {
  const t = firstCaptionTrack(doc);
  if (!t?.caption) return { kind: 'none' };
  if (t.caption.mode === 'transcript') return { kind: 'transcript', trackId: t.id, hidden: t.hidden };
  const cues = t.clips.filter((c) => c.type === 'caption').length;
  if (cues === 0 && hasTranscript(doc)) return { kind: 'unlinked', trackId: t.id, locked: t.locked };
  return { kind: 'manual', trackId: t.id, cues };
}

/** True when the captions do not show the transcript and one press can make them (the «תמלול» tab's button). */
export const transcriptNotShown = (doc: ProjectDocument): boolean => {
  if (!hasTranscript(doc)) return false;
  const s = captionSource(doc);
  return s.kind === 'none' || s.kind === 'unlinked' || (s.kind === 'transcript' && s.hidden);
};

/**
 * The ops of ONE commit (one undo) that make the captions show the transcript, or null when there is nothing to do or it
 * cannot be done (a manual track with cues of its own is never replaced; a locked track is not changed). The empty manual
 * track is replaced by a transcript track with the same name and the same style (the look already picked is kept): a
 * caption track's mode is fixed when it is made, and remove_track + add_caption_track are the registered ops for this.
 */
export function showTranscriptOps(doc: ProjectDocument): OpCall[] | null {
  if (!hasTranscript(doc)) return null;
  const s = captionSource(doc);
  if (s.kind === 'none') return [{ op: 'add_caption_track', args: { mode: 'transcript' } }];
  if (s.kind === 'transcript') return s.hidden ? [{ op: 'update_track', args: { trackId: s.trackId, hidden: false } }] : null;
  if (s.kind !== 'unlinked' || s.locked) return null;
  const t = firstCaptionTrack(doc)!;
  return [
    { op: 'remove_track', args: { trackId: t.id } },
    { op: 'add_caption_track', args: { mode: 'transcript', style: { ...t.caption!.style }, name: t.name } },
  ];
}

/**
 * What a transcript caption track's lane on the timeline shows: the engine's own cues (captionCues: the same source tracks
 * and order as the picture, linked track or not, words cut out left out), in seconds for drawing and with the frame each
 * one starts on. Manual tracks draw their cue clips themselves and get nothing here.
 */
export function laneCues(doc: ProjectDocument, seq: Sequence, track: Track, rate: T.Rate): { key: string; start: number; end: number; text: string; frame: number }[] {
  if (track.kind !== 'caption' || track.caption?.mode !== 'transcript') return [];
  return captionCues(doc, seq, track).map((c, i) => ({ key: `${i}:${c.start.value}/${c.start.timescale}`, start: T.toSeconds(c.start), end: T.toSeconds(c.end), text: c.text, frame: T.frameIndexAt(c.start, rate) }));
}
