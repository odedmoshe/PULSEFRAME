/**
 * The music under a moment, exact (wave 7 musicfit; BUILDER A). Final signatures; bodies throw MusicFitNotBuilt until built.
 * Rules: the music is the first followable sound clip in track order under `time` (the rule of beatgrid.ts, muted tracks skipped);
 * its beats come from lineage.ts beatsFor (a time-preserving copy reads its source's beats with the copy's offset), placed on the
 * timeline with speed.ts timelineOfSource; only beats the clip shows. Rationals only; the same in Node and Chromium.
 */
import type * as T from '@pulseframe/time';
import type { MediaClip, ProjectDocument } from './schema.ts';
import { MusicFitNotBuilt, type CutStats } from './musicFitContract.ts';

export interface MusicUnder {
  clip: MediaClip; trackId: string;
  /** Timeline times of the beats and bar starts this clip shows, ascending, exact. */
  beats: T.RationalTime[]; bars: T.RationalTime[];
  /** The asset whose analysis the beats are read from (the clip's file or the measured source of a copy). */
  viaAssetId: string; method: string; confidence: number | null; edited: boolean;
}
/** The music under `time` in a sequence (default the main one), or null when no followable music with beats plays there. */
export function musicAt(doc: ProjectDocument, time: T.RationalTime, sequenceId?: string): MusicUnder | null {
  void doc; void time; void sequenceId;
  throw new MusicFitNotBuilt('musicAt');
}
/** Statistics of cut frames (start frames of picture clips on all picture tracks, merged): count, the shortest gap, the most in one second. */
export function cutStats(frames: readonly number[], fps: number): CutStats {
  void frames; void fps;
  throw new MusicFitNotBuilt('cutStats');
}
