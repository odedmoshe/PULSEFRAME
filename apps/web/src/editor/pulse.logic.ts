/**
 * What the timeline's tempo head says about the music on it, apart from React (unit-tested in pulse.logic.test.ts). A clip follows
 * the beats of its own file, or of the nearest time-preserving source of it that was measured (core beatsFor: the same lineage the
 * beat markers of core timelineMarkers use), so a cleaned-up copy of measured music counts as music with a known tempo and is not
 * offered for measuring again. A copy made without a recorded time mapping has no beats of its source's: it is offered for measuring.
 */
import * as T from '@pulseframe/time';
import { beatsFor, type ProjectDocument } from '@pulseframe/core';

/** Whether the file has measured beats, its own or its time-preserving source's. */
export const assetHasBeats = (doc: ProjectDocument, assetId: string): boolean => !!beatsFor(doc, assetId)?.beats.beats.length;

/**
 * bpm: the analysis's own estimate for the music on the main timeline (the measured file with the most beats there; never guessed).
 * analysable: what "analyse the beat" would measure, the longest sound on a sound track that has no beats by lineage; null when none.
 */
export function timelineTempo(doc: ProjectDocument): { bpm: number | null; analysable: string | null } {
  const all = (doc.sequences[doc.mainSequenceId]?.tracks ?? []).flatMap((tr) => tr.clips.map((c) => ({ c, tr })));
  let best: { beats: number; bpm: number | null } | null = null;
  let music: { assetId: string; duration: T.RationalTime } | null = null;
  for (const { c, tr } of all) {
    if (c.type !== 'media') continue;
    const found = beatsFor(doc, c.assetId);
    if (found?.beats.beats.length) { if (!best || found.beats.beats.length > best.beats) best = { beats: found.beats.beats.length, bpm: found.beats.bpm ?? null }; }
    if (!found && tr.kind === 'audio' && doc.assets[c.assetId]?.audio && (!music || T.lt(music.duration, c.duration))) music = { assetId: c.assetId, duration: c.duration };
  }
  return { bpm: best?.bpm ?? null, analysable: music?.assetId ?? null };
}
