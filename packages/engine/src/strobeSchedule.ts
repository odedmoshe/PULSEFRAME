/**
 * One flash schedule for a whole timeline.
 *
 * SAFETY RULE: the strobe effect must never start more than three flashes in any one-second period, whatever is on the
 * timeline: several strobes on one clip, on clips that overlap, on clips that follow one another, on the pieces of a cut
 * clip, at any rate, following any music at any speed. Faster flashing is a seizure risk for some viewers.
 *
 * So no strobe decides for itself when it flashes. For a document, every flash any strobe would like to start is listed
 * (a steady strobe: at k / rate on the timeline; a strobe that follows the music: on its beats, see gpu.ts thinnedHits),
 * each moved to the first frame that would show it. The list is then walked once from the start of the timeline: a flash
 * is kept only if the last kept flash, of ANY strobe, started at least `gapFrames` frames earlier; flashes wanted on the
 * same frame are one flash. `gapFrames` is a third of a second rounded up to whole frames, plus one frame. Kept flash
 * starts are therefore more than a third of a second apart, so no period of one second contains more than three.
 *
 * The schedule is a pure function of the document (cached per document object), so preview, stills and export agree and
 * any frame can be drawn on its own. What it does not cover: flashing a user builds by other means (keyframed opacity,
 * rapid cuts between bright and dark pictures, the flash transition): only the strobe effect is limited here.
 */
import * as T from '@pulseframe/time';
import { followedBeats, type ProjectDocument } from '@pulseframe/core';
import { FLASH_SINCE, STROBE_FADE, thinnedHits } from './gpu.ts';
import type { RenderGraph } from './evaluate.ts';

export interface FlashSchedule {
  /** Frames per second of the timeline. */
  fps: number;
  /** The least number of frames between two flash starts anywhere on the timeline. */
  gapFrames: number;
  /** Per strobe (clip id, effect id): the frames on which one of its flashes starts, ascending. */
  shown: Map<string, Float64Array>;
  /**
   * The pieces of a cut clip carry copies of the same strobe (the same effect id) and lie back to back on one track.
   * They flash as one: each piece is listed here under the first piece of its run, so a flash that starts just before
   * a cut fades on across it instead of being cut off. Copies that are not back to back, or whose settings differ, stay separate.
   */
  runOf: Map<string, string>;
}
const keyOf = (clipId: string, effectId: string) => `${clipId}\n${effectId}`;
const schedules = new WeakMap<ProjectDocument, Map<string, FlashSchedule>>();
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** The first frame that starts at or after a time: a clip is drawn from this frame of its start to the frame before this frame of its end. */
const firstFrameAt = (t: T.RationalTime, rate: T.Rate) => { const i = T.frameIndexAt(t, rate); return T.isFrameAligned(t, rate) ? i : i + 1; };

/** Frames between flash starts at a frame rate: a third of a second, up to whole frames, and one more. */
export const flashGapFrames = (fps: number) => Math.ceil(fps / 3 - 1e-9) + 1;

export function flashSchedule(doc: ProjectDocument, sequenceId = doc.mainSequenceId): FlashSchedule {
  let bySequence = schedules.get(doc);
  if (!bySequence) schedules.set(doc, (bySequence = new Map()));
  const had = bySequence.get(sequenceId);
  if (had) return had;
  const rate = doc.settings.frameRate, fps = rate.num / rate.den, gapFrames = flashGapFrames(fps);
  const schedule: FlashSchedule = { fps, gapFrames, shown: new Map(), runOf: new Map() };
  bySequence.set(sequenceId, schedule);
  const seq = doc.sequences[sequenceId];
  if (!seq) return schedule;
  // every flash a strobe would like to start, on the first frame that would show it
  const wanted: { frame: number; key: string }[] = [];
  let beats: { t: number; index: number }[] | null = null;
  const thinned = new Map<number, number[]>(); // the beats a following strobe may flash on, per `every`
  for (const track of seq.tracks) {
    if (track.hidden || track.kind === 'audio' || track.kind === 'caption') continue;
    // effect id -> the run it currently belongs to on this track, the frame at which that run ends, and its settings
    const open = new Map<string, { key: string; end: number; settings: string }>();
    for (const clip of [...track.clips].sort((a, b) => T.cmp(a.start, b.start))) {
      for (const fx of clip.type === 'caption' ? [] : clip.effects ?? []) {
        if (fx.type !== 'light.strobe' || !fx.enabled) continue;
        const first = firstFrameAt(clip.start, rate), end = firstFrameAt(T.add(clip.start, clip.duration), rate); // drawn on frames first … end - 1
        const from = T.toSeconds(clip.start), to = T.toSeconds(T.add(clip.start, clip.duration));
        let times: number[];
        if (fx.params.follow === 'music') {
          if (!beats) { let last = 0; for (const tr of seq.tracks) for (const c of tr.clips) last = Math.max(last, T.toSeconds(T.add(c.start, c.duration))); beats = followedBeats(doc, 0, last, sequenceId); }
          const step = Math.max(1, Math.round(num(fx.params.every, 1)));
          let all = thinned.get(step);
          if (!all) thinned.set(step, (all = thinnedHits(beats, step, gapFrames / fps)));
          times = all.filter((t) => t >= from && t < to);
        } else {
          // a steady strobe never asks for more than the limit allows, so its flashes stay evenly spaced
          const r = Math.min(fps / gapFrames, Math.max(0, num(fx.params.rate, 2)));
          times = [];
          if (r > 0) for (let k = Math.ceil(from * r - 1e-9); k / r < to; k++) if (k / r > from - 1e-6) times.push(k / r); // never a flash time from before the clip (a rate near zero has none inside it)
        }
        // Pieces join a run only with exactly the same settings: a later piece that shows the age of an earlier piece's flash
        // with a higher amount (or another colour) would make the light rise at the cut without a scheduled start.
        const settings = JSON.stringify([fx.params.amount, fx.params.color, fx.params.rate, fx.params.follow, fx.params.every]);
        const run = open.get(fx.id);
        const key = run && run.end === first && run.settings === settings ? run.key : keyOf(clip.id, fx.id);
        open.set(fx.id, { key, end, settings });
        schedule.runOf.set(keyOf(clip.id, fx.id), key);
        for (const t of times) { const frame = Math.max(first, Math.ceil(t * fps - 1e-6)); if (frame < end) wanted.push({ frame, key }); }
      }
    }
  }
  wanted.sort((a, b) => a.frame - b.frame);
  const kept = new Map<string, number[]>();
  let last = -Infinity;
  for (let i = 0; i < wanted.length; ) {
    const frame = wanted[i]!.frame;
    const keep = frame - last >= gapFrames;
    for (; i < wanted.length && wanted[i]!.frame === frame; i++) if (keep) { const k = wanted[i]!.key; let list = kept.get(k); if (!list) kept.set(k, (list = [])); if (list[list.length - 1] !== frame) list.push(frame); }
    if (keep) last = frame;
  }
  for (const [k, frames] of kept) schedule.shown.set(k, Float64Array.from(frames)); // whole numbers, exact up to 2^53 (an Int32Array wrapped at absurd frame rates)
  return schedule;
}

/** Seconds since the last flash of this strobe started, on a frame of the timeline; Infinity when none has. */
export function flashSince(schedule: FlashSchedule, clipId: string, effectId: string, frame: number): number {
  const frames = schedule.shown.get(schedule.runOf.get(keyOf(clipId, effectId)) ?? keyOf(clipId, effectId));
  if (!frames) return Infinity;
  let lo = 0, hi = frames.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (frames[mid]! <= frame) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at < 0 ? Infinity : (frame - frames[at]!) / schedule.fps;
}

/** The least real time between two flash starts shown on a screen: a hair over a third of a second. */
export const SCREEN_FLASH_GAP = 1 / 3 + 1e-3;
/** A change of the strobe light by this much (of full brightness) counts as a rise or a fall; smaller changes are not. */
export const SCREEN_FLASH_STEP = 0.02;

/**
 * SAFETY RULE, on the screen in real time. The schedule keeps flash starts apart on the TIMELINE. A preview that moves
 * through the timeline faster than real time (shuttle, held arrow keys, dragging the playhead), backwards, back and forth
 * across one flash, wraps around (loop), jumps (a seek during playback) or switches to a re-planned schedule mid-play
 * (an edit, another format) could show them closer together on screen. The editor's player passes every frame it is
 * about to draw through this guard with the real time of drawing.
 *
 * The guard follows the strobe light it lets through (the strongest strobe on the frame, as the GPU pass computes it).
 * A flash on screen is a rise followed by a fall. A rise begins when the light goes more than SCREEN_FLASH_STEP above the
 * lowest it has been since the last fall, and a fall when it goes more than that below the highest since the rise began.
 * A rise that would begin less than SCREEN_FLASH_GAP after the last one began is not let through: every strobe on that
 * frame draws nothing (which is no rise), until enough real time has passed. So no second of real time shows more than
 * three rises, whatever the transport does; ordinary playback at normal speed is not changed (the schedule's starts are
 * further apart than the gap).
 * Exported files, stills and frames rendered for agents do not pass through this guard: they are drawn at their own
 * frame rate, where the schedule alone keeps the rule.
 */
export class FlashGuard {
  private last = -Infinity;
  private rising = false;
  private low = 0;
  private high = 0;
  /** Frames on which a rise was held back (for tests and diagnostics). */
  leftOut = 0;
  constructor(private readonly gap = SCREEN_FLASH_GAP) {}
  /** Forget what was shown (a new player, another project). */
  reset() { this.last = -Infinity; this.rising = false; this.low = 0; this.high = 0; }
  /**
   * The graph to draw at real time `now` (seconds, any monotonic clock). The graph is not changed; when its strobes must
   * not flash on this frame, a copy without their light is returned.
   */
  apply(graph: RenderGraph, now: number): RenderGraph {
    let light = 0;
    for (const layer of graph.layers) for (const fx of effectsOf(layer)) if (fx.type === 'light.strobe') light = Math.max(light, strength(fx.params));
    let out = graph, shown = light;
    if (!this.rising && light > this.low + SCREEN_FLASH_STEP) {
      if (now - this.last >= this.gap) { this.last = now; this.rising = true; this.high = light; }
      else { this.leftOut++; shown = 0; out = withoutFlash(graph); }
    }
    if (this.rising) { this.high = Math.max(this.high, shown); if (shown < this.high - SCREEN_FLASH_STEP) { this.rising = false; this.low = shown; } }
    else this.low = Math.min(this.low, shown);
    return out;
  }
}
const effectsOf = (l: RenderGraph['layers'][number]) => ('effects' in l ? l.effects ?? [] : []);
const withoutFlash = (graph: RenderGraph): RenderGraph => ({
  ...graph,
  layers: graph.layers.map((l) => (effectsOf(l).some((fx) => fx.type === 'light.strobe') ? { ...l, effects: effectsOf(l).map((fx) => (fx.type === 'light.strobe' ? { ...fx, params: { ...fx.params, [FLASH_SINCE]: Infinity } } : fx)) } : l)) as RenderGraph['layers'],
});
/** The light a strobe adds on a frame, as its GPU pass computes it (gpu.ts 'light.strobe'): 0 without a flash time. */
const strength = (p: Record<string, number | string | boolean>) => {
  const since = p[FLASH_SINCE], amount = typeof p.amount === 'number' ? p.amount : 0.6;
  if (typeof since !== 'number' || !(since * STROBE_FADE <= 12)) return 0;
  return amount * Math.exp(-Math.max(0, since) * STROBE_FADE);
};
