/**
 * Where a moment on the timeline falls in the beats of the music playing there.
 *
 * Effects that "follow the music" (a zoom pulse, a flash, a shake on every beat) read this instead of a tempo number, so
 * they land on the beats that were actually detected, through every cut, speed change and tempo drift of the music.
 * The music is the first sound clip (in track order, then by start) that plays at that moment on a track that is not
 * muted and whose file has a beat analysis with at least two beats.
 *
 * Besides the position in beats, the beats around the moment are listed as places on the timeline (`hits`), each placed
 * through its clip's own time mapping (speed.ts), so an effect can see how far apart its hits really are there. The list
 * does not stop at the clip: where the music is in several pieces (a cut, a speed change in steps) or other music is
 * followed just before or after, those beats are listed too, each for the time its own clip is the music.
 *
 * The result is a rendering quantity (fractions of a beat, seconds), computed in floating point from exact times; nothing here is stored.
 */
import * as T from '@pulseframe/time';
import type { Clip, MediaClip, ProjectDocument } from './schema.ts';
import { sourceAt, sourceEnd, timelineAt } from './speed.ts';
import { own } from './own.ts';

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
   * The analysed beats that are followed around this moment, in time order: within BEAT_WINDOW_SECONDS before or after it,
   * every beat of every music clip that falls on a moment at which that clip is the music (the rule at the top of this
   * file), so the beats of the pieces of a cut clip follow one another here as they are heard. `t` is where the beat is on
   * the timeline, in seconds, through its clip's place, trims, cuts, speed and gradual speed changes (speed.ts `timelineAt`).
   * `index` is its number in its own music, counted from the first bar start (0 = the first bar start; earlier beats are
   * negative), or from the first beat when the analysis has no bars. Whether a beat is listed, and its `t` and `index`,
   * do not depend on the moment asked about.
   */
  hits: { t: number; index: number }[];
  /**
   * Since when (timeline seconds) analysed music has been followed without a break up to this moment, through every
   * change of clip on the way. -Infinity when that is BEAT_WINDOW_SECONDS ago or longer.
   */
  followedFrom: number;
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

const gridOf = (analysis: { beats: readonly T.RationalTime[]; downbeats?: readonly T.RationalTime[] | undefined }): Grid => {
  let grid = grids.get(analysis);
  if (!grid) {
    const beats = seconds(analysis.beats), bars = seconds(analysis.downbeats ?? []);
    grid = { beats, bars, anchor: bars.length ? Math.max(0, lastAtOrBefore(beats, bars[0]!)) : 0 };
    grids.set(analysis, grid);
  }
  return grid;
};

/**
 * The analysed beats that are followed between two moments of a timeline (seconds), in time order, placed exactly as
 * `BeatPosition.hits` places them: every beat of every music clip that falls on a moment at which that clip is the music.
 * A pure function of the document, used to plan things for a whole timeline at once (the flash schedule of the strobes).
 */
export function followedBeats(doc: ProjectDocument, from: number, to: number, sequenceId = doc.mainSequenceId): { t: number; index: number }[] {
  const seq = own(doc.sequences, sequenceId);
  if (!seq) return [];
  const near: { clip: MediaClip; start: number; end: number }[] = [];
  for (const track of seq.tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const clip of track.clips) {
      if (!followable(doc, clip)) continue;
      const start = T.toSeconds(clip.start), end = T.toSeconds(T.add(clip.start, clip.duration));
      if (end <= from || start > to) continue;
      near.push({ clip, start, end });
    }
  }
  const hits: { t: number; index: number }[] = [];
  near.forEach((c, order) => {
    const a = doc.analyses![c.clip.assetId]!.beats!, g = gridOf(a), p = placedBeats(c.clip, a.beats, g);
    for (let k = firstAtOrAfter(p.t, from); k < p.t.length && p.t[k]! <= to; k++) {
      const t = p.t[k]!;
      if (t < c.end && !near.some((o, at) => at < order && o.start <= t && t < o.end)) hits.push({ t, index: p.from + k - g.anchor });
    }
  });
  return hits.sort((x, y) => x.t - y.t);
}

export function beatPositionAt(doc: ProjectDocument, time: T.RationalTime, sequenceId = doc.mainSequenceId): BeatPosition | null {
  const seq = own(doc.sequences, sequenceId);
  if (!seq) return null;
  const now = T.toSeconds(time), from = now - BEAT_WINDOW_SECONDS, to = now + BEAT_WINDOW_SECONDS;
  // Every followable clip that plays within the window, in the order in which they are preferred: at each moment the
  // music is the first of them that plays then.
  let chosen: MediaClip | null = null;
  const near: { clip: MediaClip; start: number; end: number }[] = [];
  for (const track of seq.tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const clip of track.clips) {
      if (!followable(doc, clip)) continue;
      const start = T.toSeconds(clip.start), end = T.toSeconds(T.add(clip.start, clip.duration));
      if (end <= from || start > to) continue;
      near.push({ clip, start, end });
      if (!chosen && !T.lt(time, clip.start) && T.lt(time, T.add(clip.start, clip.duration))) chosen = clip;
    }
  }
  if (!chosen) return null;
  const clip = chosen, analysis = doc.analyses![clip.assetId]!.beats!, grid = gridOf(analysis);
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
  // the beats of each clip near the moment, for the time that clip is the music: not while a clip listed before it plays
  const hits: BeatPosition['hits'] = [];
  near.forEach((c, order) => {
    const a = doc.analyses![c.clip.assetId]!.beats!, g = gridOf(a), p = placedBeats(c.clip, a.beats, g);
    for (let k = firstAtOrAfter(p.t, from); k < p.t.length && p.t[k]! <= to; k++) {
      const t = p.t[k]!;
      if (t < c.end && !near.some((o, at) => at < order && o.start <= t && t < o.end)) hits.push({ t, index: p.from + k - g.anchor });
    }
  });
  hits.sort((x, y) => x.t - y.t);
  // since when music has been followed without a break: back through every clip that was still playing when the next one began
  let followedFrom = T.toSeconds(clip.start);
  for (const c of [...near].sort((x, y) => y.start - x.start)) if (c.start < followedFrom && c.end >= followedFrom) followedFrom = c.start;
  return { clipId: clip.id, beat, sinceBar: barIndex >= 0 ? beat - barIndex : beat, period, sinceFirstBar: beat - grid.anchor, at: now, hits, followedFrom: followedFrom <= from ? -Infinity : followedFrom };
}
