/**
 * Where a moment on the timeline falls in the beats of the music playing there.
 *
 * Effects that "follow the music" (a zoom pulse, a flash, a shake on every beat) read this instead of a tempo number, so
 * they land on the beats that were actually detected, through every cut, speed change and tempo drift of the music.
 * The music is the first sound clip (in track order, then by start) that plays at that moment on a track that is not
 * muted and whose file has a beat analysis with at least two beats.
 *
 * The result is a rendering quantity (fractions of a beat), computed in floating point from exact times; nothing here is stored.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument } from './schema.ts';
import { sourceAt, speedEndValue, speedValue } from './speed.ts';

export interface BeatPosition {
  /** The sound clip whose beats these are. */
  clipId: string;
  /** Beats since the first analysed beat of that music, with a fraction (12.25 = a quarter of the way from beat 12 to beat 13). Negative before the first beat. */
  beat: number;
  /** Beats since the last bar start at or before this moment; equal to `beat` when the analysis has no bars or none has started yet. */
  sinceBar: number;
  /** Timeline seconds between the beat before this moment and the beat after it (at the clip's speed here). */
  period: number;
}

const cache = new WeakMap<object, { beats: Float64Array; bars: Float64Array }>();
const seconds = (times: readonly T.RationalTime[]) => Float64Array.from(times, (t) => T.toSeconds(t));
/** Index of the last entry <= x, or -1. */
function lastAtOrBefore(xs: Float64Array, x: number): number {
  let lo = 0, hi = xs.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (xs[mid]! <= x) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at;
}

export function beatPositionAt(doc: ProjectDocument, time: T.RationalTime, sequenceId = doc.mainSequenceId): BeatPosition | null {
  const seq = doc.sequences[sequenceId];
  if (!seq) return null;
  for (const track of seq.tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const clip of track.clips) {
      if (clip.type !== 'media' || clip.freeze || clip.reverse) continue; // a sound played backwards has no beat grid to follow here
      if (T.lt(time, clip.start) || !T.lt(time, T.add(clip.start, clip.duration))) continue;
      const analysis = doc.analyses?.[clip.assetId]?.beats;
      if (!analysis || analysis.beats.length < 2) continue;
      let c = cache.get(analysis);
      if (!c) { c = { beats: seconds(analysis.beats), bars: seconds(analysis.downbeats ?? []) }; cache.set(analysis, c); }
      const b = c.beats, n = b.length;
      const s = T.toSeconds(sourceAt(clip, time));
      const i = Math.min(n - 2, Math.max(0, lastAtOrBefore(b, s))); // the interval used: the one around s, or the first/last one beyond the ends
      const d = b[i + 1]! - b[i]!;
      if (!(d > 0)) continue; // two beats at one instant: not a grid
      const beat = i + (s - b[i]!) / d;
      const bar = lastAtOrBefore(c.bars, s);
      const barIndex = bar >= 0 ? lastAtOrBefore(b, c.bars[bar]! + 1e-9) : -1;
      // speed here: one speed, or part-way between the two speeds of a gradual change (close enough for a period estimate)
      const along = T.toSeconds(T.sub(time, clip.start)) / Math.max(1e-9, T.toSeconds(clip.duration));
      const speed = Math.max(0.05, speedValue(clip) + (speedEndValue(clip) - speedValue(clip)) * along);
      return { clipId: clip.id, beat, sinceBar: barIndex >= 0 ? beat - barIndex : beat, period: d / speed };
    }
  }
  return null;
}
