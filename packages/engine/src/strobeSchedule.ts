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
 * Light transitions (film-burn, light-leak: TransitionDef.light) join the same walk (ADR-0012, an amendment to ADR-0009
 * decision 1): each asks for one flash start, the first frame its light envelope is above 0, and is kept by the same rule.
 * A light transition whose start is not kept draws with light 0 (`lights`), so strobes and lights together never start
 * more than three flashes in a second.
 *
 * The schedule is a pure function of the document (cached per document object), so preview, stills and export agree and
 * any frame can be drawn on its own. What it does not cover: flashing a user builds by other means (keyframed opacity,
 * rapid cuts between bright and dark pictures, the legacy flash and dip transitions, ADR-0011): only the strobe effect and
 * the light transitions are limited here; the export's flash check (flashAnalysis.ts) reads everything else.
 */
import * as T from '@pulseframe/time';
import { beatSwitchFrame, flashGapFrames, followedBeats, lightStartFrame, switchFrame, transitionDef, type ProjectDocument } from '@pulseframe/core';
import { FLASH_SINCE, STROBE_FADE, thinnedHits } from './gpu.ts';
import type { RenderGraph } from './evaluate.ts';

/**
 * The flash start a light transition (film-burn, light-leak: TransitionDef.light) asks for (ADR-0012, an amendment to
 * ADR-0009 decision 1): the first frame its light envelope is above 0. It joins the strobe starts and is kept by the same
 * gap rule; a transition whose start is not kept draws its matte with light 0, and the editor says why.
 */
export interface LightPlan {
  /** Timeline frame the light would start on. */
  frame: number;
  kept: boolean;
  /** When held back: frames since the last kept start of any strobe or light; null when kept. */
  since: number | null;
}
/** Key of a light transition's start among the strobe keys of the walk (`clipId\neffectId`). */
export const lightKey = (clipId: string) => `${clipId}\ntransition`;

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
  /**
   * Per light transition, by the id of the clip that carries it: where its light would start and whether the schedule
   * kept that start (ADR-0012). Only light transitions that are drawn are listed (a media clip with a picture on a visible
   * video track, the start inside the clip); the evaluator gives any other light transition light 0.
   */
  lights: Map<string, LightPlan>;
}
const keyOf = (clipId: string, effectId: string) => `${clipId}\n${effectId}`;
const schedules = new WeakMap<ProjectDocument, Map<string, FlashSchedule>>();
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** The first frame that starts at or after a time: a clip is drawn from this frame of its start to the frame before this frame of its end. */
const firstFrameAt = (t: T.RationalTime, rate: T.Rate) => { const i = T.frameIndexAt(t, rate); return T.isFrameAligned(t, rate) ? i : i + 1; };

export { flashGapFrames }; // defined in core (flashSafety.ts), shared with the beat montage

export function flashSchedule(doc: ProjectDocument, sequenceId = doc.mainSequenceId): FlashSchedule {
  let bySequence = schedules.get(doc);
  if (!bySequence) schedules.set(doc, (bySequence = new Map()));
  const had = bySequence.get(sequenceId);
  if (had) return had;
  const rate = doc.settings.frameRate, fps = rate.num / rate.den, gapFrames = flashGapFrames(fps);
  const schedule: FlashSchedule = { fps, gapFrames, shown: new Map(), runOf: new Map(), lights: new Map() };
  bySequence.set(sequenceId, schedule);
  const seq = doc.sequences[sequenceId];
  if (!seq) return schedule;
  // every flash a strobe or a light transition would like to start, on the first frame that would show it
  const wanted: { frame: number; key: string; /** set for a light transition: the clip that carries it */ light?: string }[] = [];
  let beats: { t: number; index: number }[] | null = null;
  const thinned = new Map<number, number[]>(); // the beats a following strobe may flash on, per `every`
  for (const track of seq.tracks) {
    if (track.hidden || track.kind === 'audio' || track.kind === 'caption') continue;
    // effect id -> the run it currently belongs to on this track, the frame at which that run ends, and its settings
    const open = new Map<string, { key: string; end: number; settings: string }>();
    for (const clip of [...track.clips].sort((a, b) => T.cmp(a.start, b.start))) {
      // A light transition (ADR-0012): drawn as evaluate.ts draws it, on the clip's frames 0 … n−1 from the first frame that
      // shows the clip, on a visible video track, over a picture; its light starts on its first frame with light above 0.
      const tr = clip.type === 'media' && track.kind === 'video' ? clip.transition : undefined;
      if (clip.type === 'media' && tr && transitionDef(tr.type)?.light) {
        const asset = doc.assets[clip.assetId];
        const l0 = lightStartFrame(tr.frames, fps, switchFrame(tr.frames, beatSwitchFrame(doc, clip, sequenceId)));
        const first = firstFrameAt(clip.start, rate), end = firstFrameAt(T.add(clip.start, clip.duration), rate);
        if (asset && ((asset.kind === 'image' && asset.image) || asset.video) && l0 !== null && first + l0 < end) {
          wanted.push({ frame: first + l0, key: lightKey(clip.id), light: clip.id });
        }
      }
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
    for (; i < wanted.length && wanted[i]!.frame === frame; i++) {
      const { key: k, light } = wanted[i]!;
      // a light transition: kept, or held with the frames since the last kept start (of a strobe or another light)
      if (light !== undefined) { schedule.lights.set(light, { frame, kept: keep, since: keep ? null : frame - last }); continue; }
      if (keep) { let list = kept.get(k); if (!list) kept.set(k, (list = [])); if (list[list.length - 1] !== frame) list.push(frame); }
    }
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
 * The guard follows the light it lets through: the strongest strobe on the frame, as the GPU pass computes it, or the light
 * of a light transition (film-burn, light-leak: the envelope the schedule allowed, ADR-0012), whichever is stronger.
 * A flash on screen is a rise followed by a fall. A rise begins when the light goes more than SCREEN_FLASH_STEP above the
 * lowest it has been since the last fall, and a fall when it goes more than that below the highest since the rise began.
 * A rise that would begin less than SCREEN_FLASH_GAP after the last one began is not let through: every strobe and every
 * light transition on that frame draws no light (which is no rise), until enough real time has passed. So no second of real time shows more than
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
   * The graph to draw at real time `now` (seconds, any monotonic clock). The graph is not changed; when its strobes and
   * light transitions must not flash on this frame, a copy without their light is returned.
   */
  apply(graph: RenderGraph, now: number): RenderGraph {
    let light = 0;
    for (const layer of graph.layers) {
      for (const fx of effectsOf(layer)) if (fx.type === 'light.strobe') light = Math.max(light, strength(fx.params));
      light = Math.max(light, transitionLight(layer));
    }
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
type AnyLayer = RenderGraph['layers'][number];
const effectsOf = (l: AnyLayer) => ('effects' in l ? l.effects ?? [] : []);
/** The light a light transition adds on this frame (0 without one): the envelope the evaluator put on its incoming layer. */
const transitionLight = (l: AnyLayer) => ('transition' in l && l.transition?.light ? l.transition.light : 0);
/** The graph with no strobe flash and no transition light (the pictures and every other effect unchanged). */
const withoutFlash = (graph: RenderGraph): RenderGraph => ({
  ...graph,
  layers: graph.layers.map((l) => {
    let out: AnyLayer = l;
    if (effectsOf(l).some((fx) => fx.type === 'light.strobe')) out = { ...out, effects: effectsOf(l).map((fx) => (fx.type === 'light.strobe' ? { ...fx, params: { ...fx.params, [FLASH_SINCE]: Infinity } } : fx)) } as AnyLayer;
    if (transitionLight(l) && 'transition' in out && out.transition) out = { ...out, transition: { ...out.transition, light: 0 } } as AnyLayer;
    return out;
  }),
});
/** The light a strobe adds on a frame, as its GPU pass computes it (gpu.ts 'light.strobe'): 0 without a flash time. */
const strength = (p: Record<string, number | string | boolean>) => {
  const since = p[FLASH_SINCE], amount = typeof p.amount === 'number' ? p.amount : 0.6;
  if (typeof since !== 'number' || !(since * STROBE_FADE <= 12)) return 0;
  return amount * Math.exp(-Math.max(0, since) * STROBE_FADE);
};
