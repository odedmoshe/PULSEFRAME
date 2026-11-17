/**
 * Where a moment on the timeline falls in the beats of the music playing there.
 *
 * Effects that "follow the music" (a zoom pulse, a flash, a shake on every beat) read this instead of a tempo number, so
 * they land on the beats that were actually detected, through every cut, speed change and tempo drift of the music.
 * The music is the first sound clip (in track order, then by start) that plays at that moment on a track that is not
 * muted and whose file has a beat analysis with at least two beats.
 *
 * Besides the position in beats, the beats around the moment are listed as places on the timeline (`hits`), each placed
 * through the clip's own time mapping (speed.ts), so an effect can see how far apart its hits really are there.
 *
 * The result is a rendering quantity (fractions of a beat, seconds), computed in floating point from exact times; nothing here is stored.
 */
import * as T from '@pulseframe/time';
import type { Clip, MediaClip, ProjectDocument } from './schema.ts';
import { sourceAt, sourceEnd, timelineAt } from './speed.ts';

/** How far before and after a moment the beats around it are listed (seconds of timeline). */
export const BEAT_WINDOW_SECONDS = 2;

export interface BeatPosition {
  /** The sound clip whose beats these are. */
  clipId: string;
  /** Beats since the first analysed beat of that music, with a fraction (12.25 = a quarter of the way from beat 12 to beat 13). Negative before the first beat. */
  beat: number;
  /** Beats since the last bar start at or before this moment; equal to `beat` when the analysis has no bars or none has started yet. */
  sinceBar: number;
  /** Timeline seconds between the beat before this moment and the beat after it (through the clip's speed, trims and gradual speed changes). */
  period: number;
  /** Beats since the first bar start of the music (since its first beat when the analysis has no bars), with a fraction. Unlike `sinceBar` it does not start again at each bar: it is the running number that `hits[].index` counts. */
  sinceFirstBar: number;
  /** Timeline seconds of this moment. */
  at: number;
  /**
   * The analysed beats around this moment, in time order: every beat that falls inside the clip and within BEAT_WINDOW_SECONDS
   * before or after the moment. `t` is where the beat is on the timeline, in seconds, through the clip's place, trims, cuts,
   * speed and gradual speed changes (speed.ts `timelineAt`). `index` is its number counted from the first bar start
   * (0 = the first bar start; earlier beats are negative), or from the first beat when the analysis has no bars.
   * The same beat has the same `t` and `index` at every moment it is listed.
   */
  hits: { t: number; index: number }[];
  /**
   * The latest moment (timeline seconds) before this clip's present turn at which other analysed music was being followed:
   * another music clip that played before this one took over, whether it ended earlier or right at the take-over.
   * Null when no other music was followed before. A turn is the unbroken stretch of time for which this clip is the music.
   */
  musicBefore: number | null;
}

interface Grid { beats: Float64Array; bars: Float64Array; /** number of the beat that `index` 0 names */ anchor: number }
const grids = new WeakMap<object, Grid>();
const seconds = (times: readonly T.RationalTime[]) => Float64Array.from(times, (t) => T.toSeconds(t));
/** Index of the last entry <= x, or -1. */
function lastAtOrBefore(xs: Float64Array, x: number): number {
  let lo = 0, hi = xs.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (xs[mid]! <= x) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at;
}
/** Index of the first entry >= x (xs.length when there is none). */
function firstAtOrAfter(xs: Float64Array, x: number): number {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid]! < x) lo = mid + 1; else hi = mid; }
  return lo;
}

/** The beats of an analysis that fall inside a clip, placed on the timeline: beats `from`…`from + t.length - 1`, at `t` seconds. */
interface Placed { key: string; grid: Grid; from: number; t: Float64Array }
const placedByClip = new WeakMap<object, Placed>();
function placedBeats(clip: MediaClip, times: readonly T.RationalTime[], grid: Grid): Placed {
  // everything the place of a beat depends on; a clip object that is changed in place is noticed
  const key = JSON.stringify([clip.start, clip.duration, clip.sourceIn, clip.speed, clip.speedEnd, clip.rampWindow, clip.speedCurve, times.length]);
  const had = placedByClip.get(clip);
  if (had && had.key === key && had.grid === grid) return had;
  const from = firstAtOrAfter(grid.beats, T.toSeconds(clip.sourceIn)), to = firstAtOrAfter(grid.beats, T.toSeconds(sourceEnd(clip)));
  const start = T.toSeconds(clip.start), end = start + T.toSeconds(clip.duration);
  const t = new Float64Array(Math.max(0, to - from));
  let floor = start;
  for (let k = 0; k < t.length; k++) { floor = Math.min(end, Math.max(floor, T.toSeconds(timelineAt(clip, times[from + k]!)))); t[k] = floor; } // inside the clip, never out of order
  const placed = { key, grid, from, t };
  placedByClip.set(clip, placed);
  return placed;
}

/** Whether a clip is music that can be followed: a sound clip played forwards whose file has a beat analysis with at least two beats. Does not depend on the moment. */
const followable = (doc: ProjectDocument, clip: Clip): clip is MediaClip =>
  clip.type === 'media' && !clip.freeze && !clip.reverse && (doc.analyses?.[clip.assetId]?.beats?.beats.length ?? 0) >= 2; // a sound played backwards has no beat grid to follow here

export function beatPositionAt(doc: ProjectDocument, time: T.RationalTime, sequenceId = doc.mainSequenceId): BeatPosition | null {
  const seq = doc.sequences[sequenceId];
  if (!seq) return null;
  const now = T.toSeconds(time);
  // The music is the first followable clip, in track order, that plays at this moment. The others are remembered only for
  // when they stopped: `turnStart` is since when the chosen clip has been the music without a break, `before` the last
  // moment before that at which any other music was followed.
  let chosen: MediaClip | null = null, turnStart = 0, before: number | null = null;
  const others: { start: number; end: number }[] = [];
  for (const track of seq.tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const clip of track.clips) {
      if (!followable(doc, clip)) continue;
      const start = T.toSeconds(clip.start), end = T.toSeconds(T.add(clip.start, clip.duration));
      if (!chosen && !T.lt(time, clip.start) && T.lt(time, T.add(clip.start, clip.duration))) { chosen = clip; turnStart = start; for (const o of others) if (o.end <= now) turnStart = Math.max(turnStart, o.end); } // clips listed earlier that have ended were heard instead of this one
      else others.push({ start, end });
    }
  }
  if (!chosen) return null;
  for (const o of others) if (o.start < turnStart) before = Math.max(before ?? -Infinity, Math.min(o.end, turnStart));
  const clip = chosen, analysis = doc.analyses![clip.assetId]!.beats!;
  let grid = grids.get(analysis);
  if (!grid) {
    const beats = seconds(analysis.beats), bars = seconds(analysis.downbeats ?? []);
    grid = { beats, bars, anchor: bars.length ? Math.max(0, lastAtOrBefore(beats, bars[0]!)) : 0 };
    grids.set(analysis, grid);
  }
  const b = grid.beats, n = b.length;
  const s = T.toSeconds(sourceAt(clip, time));
  const i = Math.min(n - 2, Math.max(0, lastAtOrBefore(b, s))); // the interval used: the one around s, or the first/last one beyond the ends
  const d = b[i + 1]! - b[i]!;
  const beat = i + (d > 0 ? (s - b[i]!) / d : 0); // two beats at one instant are not a grid; validation refuses them
  const bar = lastAtOrBefore(grid.bars, s);
  const barIndex = bar >= 0 ? lastAtOrBefore(b, grid.bars[bar]! + 1e-9) : -1;
  const placed = placedBeats(clip, analysis.beats, grid);
  // where the two beats of that interval are on the timeline: from the placed beats when both are inside the clip, else computed here (the grid continues beyond the clip)
  const onTimeline = (k: number) => (k >= placed.from && k < placed.from + placed.t.length ? placed.t[k - placed.from]! : T.toSeconds(timelineAt(clip, analysis.beats[k]!)));
  const period = Math.max(1e-6, onTimeline(i + 1) - onTimeline(i));
  const hits: BeatPosition['hits'] = [];
  for (let k = firstAtOrAfter(placed.t, now - BEAT_WINDOW_SECONDS); k < placed.t.length && placed.t[k]! <= now + BEAT_WINDOW_SECONDS; k++) hits.push({ t: placed.t[k]!, index: placed.from + k - grid.anchor });
  return { clipId: clip.id, beat, sinceBar: barIndex >= 0 ? beat - barIndex : beat, period, sinceFirstBar: beat - grid.anchor, at: now, hits, musicBefore: before };
}
