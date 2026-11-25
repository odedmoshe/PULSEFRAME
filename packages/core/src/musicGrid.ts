/**
 * The music under a moment, exact (wave 7 musicfit; built by builder A).
 * Rules: the music is the first followable sound clip in track order under `time` (the rule of beatgrid.ts: a media clip on a sound
 * track that is not muted, played forwards, not a freeze frame, whose file has at least two beats of its own or of a time-preserving
 * source — lineage.ts ownBeats, so a copy reads its source's beats with the copy's offset); a clip with a gradual speed change is not
 * followed here, because its time mapping is not exact (speed.ts says so). Its beats are placed on the timeline with speed.ts
 * timelineOfSource; only beats the clip shows (source time in [sourceIn, sourceEnd)). Rationals only; the same in Node and Chromium.
 */
import * as T from '@pulseframe/time';
import type { MediaClip, ProjectDocument } from './schema.ts';
import type { CutStats } from './musicFitContract.ts';
import { ownBeats } from './lineage.ts';
import { isRamped, sourceEnd, timelineOfSource } from './speed.ts';

export interface MusicUnder {
  clip: MediaClip; trackId: string;
  /** Timeline times of the beats and bar starts this clip shows, ascending, exact. */
  beats: T.RationalTime[]; bars: T.RationalTime[];
  /** The asset whose analysis the beats are read from (the clip's file or the measured source of a copy). */
  viaAssetId: string; method: string; confidence: number | null; edited: boolean;
}
/** The music under `time` in a sequence (default the main one), or null when no followable music with beats plays there. */
export function musicAt(doc: ProjectDocument, time: T.RationalTime, sequenceId?: string): MusicUnder | null {
  return musicAtExcept(doc, time, sequenceId, EMPTY);
}
const EMPTY: ReadonlySet<string> = new Set();
/** musicAt leaving out the clips named in `exclude` (impact.ts: a clip is never brought to its own beats or its linked sound's). */
export function musicAtExcept(doc: ProjectDocument, time: T.RationalTime, sequenceId: string | undefined, exclude: ReadonlySet<string>): MusicUnder | null {
  const seq = doc.sequences[sequenceId ?? doc.mainSequenceId];
  if (!seq || !Object.hasOwn(doc.sequences, sequenceId ?? doc.mainSequenceId)) return null;
  for (const track of seq.tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const clip of track.clips) {
      if (clip.type !== 'media' || exclude.has(clip.id) || clip.freeze || clip.reverse || isRamped(clip)) continue;
      if (T.lt(time, clip.start) || !T.lt(time, T.add(clip.start, clip.duration))) continue;
      const own = ownBeats(doc, clip.assetId);
      if (!own || own.beats.length < 2) continue;
      const from = clip.sourceIn, to = sourceEnd(clip);
      const place = (list: readonly T.RationalTime[]) => list.filter((s) => !T.lt(s, from) && T.lt(s, to)).map((s) => timelineOfSource(clip, s));
      const a = own.analysis;
      return { clip, trackId: track.id, beats: place(own.beats), bars: place(own.downbeats), viaAssetId: own.assetId, method: a.origin.method, confidence: a.confidence ?? null, edited: a.origin.edited === true };
    }
  }
  return null;
}
/**
 * Statistics of cut frames (start frames of picture clips on all picture tracks, merged): the number of distinct cut frames, the
 * shortest gap between two of them in frames (null with fewer than two), and the most that fall in one second (any window of
 * `fps` frames: frames f with first ≤ f < first + fps).
 */
export function cutStats(frames: readonly number[], fps: number): CutStats {
  const f = [...new Set(frames)].sort((a, b) => a - b);
  let minGapFrames: number | null = null, maxInOneSecond = 0;
  for (let i = 1; i < f.length; i++) { const g = f[i]! - f[i - 1]!; if (minGapFrames === null || g < minGapFrames) minGapFrames = g; }
  for (let i = 0, j = 0; i < f.length; i++) {
    while (j < f.length && f[j]! - f[i]! < fps) j++;
    if (j - i > maxInOneSecond) maxInOneSecond = j - i;
  }
  return { cuts: f.length, minGapFrames, maxInOneSecond };
}
