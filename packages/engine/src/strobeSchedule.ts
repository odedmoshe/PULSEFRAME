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
 * Transitions that are themselves a flash (TransitionDef.flashes: flash, dip to black or white, the colour blocks, the page
 * turn; measured, engine flashTransitions.test.ts) are never held or changed (ADR-0011:80), but they reserve their frames
 * (ADR-0009 amendment 2026-11-26). Such a transition counts as `flashes` flashes in every one-second period that touches any
 * of its frames (its own rise and fall may be anywhere in them). A strobe or light start is kept only if, besides the gap
 * after the last kept start, (a) it is at least `gapFrames` from the first and from the last frame of every such transition
 * (it is held back exactly as a strobe start holds back another), and (b) no one-second period (⌈fps⌉ frames) holding it
 * would then hold more than three flashes: kept starts, this one, and the flashes of the transitions it touches. The
 * transitions are always drawn; only starts give way. So strobes, lights and these transitions together never make more
 * than three flashes in a second, unless the transitions alone already do (two flash transitions close together: not
 * limited, see below).
 *
 * The schedule is a pure function of the document (cached per document object), so preview, stills and export agree and
 * any frame can be drawn on its own. What it does not cover: flashing a user builds by other means (keyframed opacity,
 * rapid cuts between bright and dark pictures, the footage's own flashing, two flashing transitions close together,
 * ADR-0011): only the strobe effect and the light transitions are limited here; the export's flash check
 * (flashAnalysis.ts) reads everything else.
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
  /**
   * The transitions that are themselves a flash (TransitionDef.flashes), as drawn: the carrying clip, the timeline frames the
   * transition covers (first … last) and how many flashes it counts for. Drawn as they are; they only hold back starts.
   * Ascending by first frame.
   */
  flashing: FlashingTransition[];
}
export interface FlashingTransition { clipId: string; type: string; first: number; last: number; flashes: number }
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
  const schedule: FlashSchedule = { fps, gapFrames, shown: new Map(), runOf: new Map(), lights: new Map(), flashing: [] };
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
      // A transition that is itself a flash: drawn by evaluate.ts on the clip's frames 0 … frames − 1 from its first frame (a
      // media clip on a visible video track whose asset has a picture); it reserves those frames.
      const m = tr ? transitionDef(tr.type)?.flashes : undefined;
      if (clip.type === 'media' && tr && m) {
        const asset = doc.assets[clip.assetId];
        const first = firstFrameAt(clip.start, rate), last = Math.min(first + tr.frames, firstFrameAt(T.add(clip.start, clip.duration), rate)) - 1;
        if (asset && ((asset.kind === 'image' && asset.image) || asset.video) && last >= first) schedule.flashing.push({ clipId: clip.id, type: tr.type, first, last, flashes: m });
      }
      for (const fx of clip.type === 'caption' ? [] : clip.effects ?? []) {
        if (fx.type !== 'light.strobe' || !fx.enabled) continue;
        const first = firstFrameAt(clip.start, rate), end = firstFrameAt(T.add(clip.start, clip.duration), rate); // drawn on frames first … end - 1
        const from = T.toSeconds(clip.start), to = T.toSeconds(T.add(clip.start, clip.duration));
        // Pieces join a run only with exactly the same settings: a later piece that shows the age of an earlier piece's flash
        // with a higher amount (or another colour) would make the light rise at the cut without a scheduled start.
        const settings = JSON.stringify([fx.params.amount, fx.params.color, fx.params.rate, fx.params.follow, fx.params.every]);
        const run = open.get(fx.id);
        const continues = !!run && run.end === first && run.settings === settings;
        const key = continues ? run.key : keyOf(clip.id, fx.id);
        open.set(fx.id, { key, end, settings });
        schedule.runOf.set(keyOf(clip.id, fx.id), key);
        // A piece that continues a run takes every time that its frames show: a time in the frame before the cut is shown on
        // the piece's first frame, as in the uncut clip (the piece before ends there). It used to be dropped by both pieces.
        // Any other clip takes no time from before its start (a strobe does not begin with the rest of a flash it never showed).
        const inside = (t: number) => (continues ? Math.ceil(t * fps - 1e-6) >= first : t > from - 1e-6);
        let times: number[];
        if (fx.params.follow === 'music') {
          if (!beats) { let last = 0; for (const tr of seq.tracks) for (const c of tr.clips) last = Math.max(last, T.toSeconds(T.add(c.start, c.duration))); beats = followedBeats(doc, 0, last, sequenceId); }
          const step = Math.max(1, Math.round(num(fx.params.every, 1)));
          let all = thinned.get(step);
          if (!all) thinned.set(step, (all = thinnedHits(beats, step, gapFrames / fps)));
          times = all.filter((t) => (continues ? inside(t) : t >= from) && t < to);
        } else {
          // a steady strobe never asks for more than the limit allows, so its flashes stay evenly spaced
          const r = Math.min(fps / gapFrames, Math.max(0, num(fx.params.rate, 2)));
          const lo = continues ? Math.min(from, (first - 1) / fps) : from;
          times = [];
          if (r > 0) for (let k = Math.ceil(lo * r - 1e-9); k / r < to; k++) if (inside(k / r)) times.push(k / r); // never a flash time from before the clip (a rate near zero has none inside it)
        }
        for (const t of times) { const frame = Math.max(first, Math.ceil(t * fps - 1e-6)); if (frame < end) wanted.push({ frame, key }); }
      }
    }
  }
  wanted.sort((a, b) => a.frame - b.frame);
  schedule.flashing.sort((a, b) => a.first - b.first || a.last - b.last);
  const second = Math.ceil(fps - 1e-9); // frames of one second, up to a whole frame
  const starts: number[] = []; // every kept start, ascending
  /**
   * Whether the flashing transitions hold back a start on `frame`: null when not; otherwise the frames between it and the
   * nearest such transition (0 inside one), or, when only a full second holds it, the frames since the last kept start.
   */
  const reserved = (frame: number): number | null => {
    let near: number | null = null;
    for (const h of schedule.flashing) {
      const d = frame < h.first ? h.first - frame : frame > h.last ? frame - h.last : 0;
      if (d < gapFrames) near = near === null ? d : Math.min(near, d);
    }
    if (near !== null) return near;
    // every one-second period [s, s + second − 1] that holds `frame`: kept starts in it, this start, and its transitions' flashes
    for (let s = frame - second + 1; s <= frame; s++) {
      const e = s + second - 1;
      let n = 1;
      for (const h of schedule.flashing) if (h.last >= s && h.first <= e) n += h.flashes;
      if (n <= 1) continue; // no transition touches it: the gap rule alone keeps it at three
      for (let k = starts.length - 1; k >= 0 && starts[k]! >= s; k--) n++;
      if (n > 3) return frame - (starts[starts.length - 1] ?? -Infinity);
    }
    return null;
  };
  const kept = new Map<string, number[]>();
  let last = -Infinity;
  for (let i = 0; i < wanted.length; ) {
    const frame = wanted[i]!.frame;
    const near = schedule.flashing.length ? reserved(frame) : null;
    const keep = frame - last >= gapFrames && near === null;
    for (; i < wanted.length && wanted[i]!.frame === frame; i++) {
      const { key: k, light } = wanted[i]!;
      // a light transition: kept, or held with the frames since the last kept start (of a strobe or another light), or, when a
      // flashing transition holds it, the frames between it and that transition's nearest frame
      if (light !== undefined) { schedule.lights.set(light, { frame, kept: keep, since: keep ? null : near !== null && frame - last >= gapFrames ? near : frame - last }); continue; }
      if (keep) { let list = kept.get(k); if (!list) kept.set(k, (list = [])); if (list[list.length - 1] !== frame) list.push(frame); }
    }
    if (keep) { last = frame; starts.push(frame); }
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
 * A rise that has gone this far above the light before it (of full brightness) is taken to have been seen: a tenth, the
 * least change WCAG 2.3.1 counts as part of a flash, and more than the 8 of 255 by which gpu-proof counts a rise on its
 * picture of 127 (a white light of 0.0625 there). Until then a further step up through frames that jump times the rise
 * from there (FlashGuard: `further`). A viewer who needs more than this to see a rise (a white light over a picture
 * brighter than 175 of 255 needs more than 0.1 to brighten it by 8) can see it begin later than the guard timed it.
 */
export const SCREEN_FLASH_SEEN = 0.1;

/**
 * SAFETY RULE, on the screen in real time. The schedule keeps flash starts apart on the TIMELINE. A preview that moves
 * through the timeline faster than real time (shuttle, held arrow keys, dragging the playhead), backwards, back and forth
 * across one flash, wraps around (loop), jumps (a seek during playback) or switches to a re-planned schedule mid-play
 * (an edit, another format) could show them closer together on screen. The editor's player passes every frame it draws
 * through this guard, and tells it when the frame reached the screen and with what light.
 *
 * The guard follows the light a frame puts on screen, per layer (layerLights): the strobes on it mixed as the GPU passes
 * mix them, with the light of its light transition (film-burn, light-leak: the envelope the schedule allowed, ADR-0012);
 * and the strongest light of the frame as one more layer. A flash on screen is a rise followed by a fall. A rise begins
 * when a layer's light goes more than SCREEN_FLASH_STEP above the lowest it has been since its last fall, and a fall when
 * it goes more than that below the highest since its rise began; a rise of any layer is a rise of the screen.
 * A rise that would reach the screen less than SCREEN_FLASH_GAP after the last rise reached it is not let through: every
 * strobe and every light transition on that frame draws no light (which is no rise), until enough real time has passed.
 * While a layer's light is rising but not yet SCREEN_FLASH_SEEN above its low, a further step up through frames that jump
 * moves the time of the rise to that frame (`further`, never held). So no second of real time shows more than three rises,
 * whatever the transport does. Ordinary playback at normal speed holds nothing (the schedule's starts are further apart
 * than the gap), but a rise can be copied a few hundredths of a second late: draws that take different times bring two
 * scheduled starts closer on screen than on the timeline, and at 60 fps on a 60 Hz display the schedule's 21 frames are
 * exactly the 21 refreshes the gap needs, so one late rise keeps the next as late (measured in flashGuard.test.ts: up to
 * the spread of the draws and two refreshes).
 *
 * WHAT IS ON SCREEN, AND WHEN. A frame is drawn off screen, which takes time (decoding, GPU passes), and then copied to the
 * visible canvas. The guard's bookkeeping is the screen's, not the decisions': it is advanced only by `shown`, with the light
 * the frame really carries as painted (an effect or a layer that could not be drawn adds none: a paused frame drawn before
 * the GPU was ready shows no light, whatever the graph said) and the real time of the copy; a rise is then timed from the
 * next animation frame (`presented`), when the page hands it to the display. So:
 *  1. `decide(graph, now)` before drawing: the frame's light relative to the light ON SCREEN. A rise that could not reach the
 *     screen in time, even if this draw is as slow as the recent ones, is held back at once (drawn without its light).
 *  2. Draw the returned graph off screen.
 *  3. `wait(decision, now, painted)` just before the copy: seconds to wait before this frame may be shown (0: at once). A rise
 *     is never copied less than the gap after the last rise reached the screen; the wait is about one draw at most (it is
 *     bounded by how far ahead `decide` looked, SCREEN_FLASH_AHEAD_MAX, and a refresh).
 *  4. Copy, then `shown(decision, now, painted)`; for a rise, `presented(rise, now)` on the next animation frame.
 * Holding back (a frame without its light) is preferred to waiting long, and waiting is preferred to an extra rise.
 * `apply` is all of it at one instant, for callers that draw synchronously (tests, measurements).
 * Exported files, stills and frames rendered for agents do not pass through this guard: they are drawn at their own
 * frame rate, where the schedule alone keeps the rule.
 */
export interface FlashDecision {
  /** The graph to draw: the one given, or a copy without strobe and transition light (a rise held back). */
  readonly graph: RenderGraph;
  /** True when the light was taken out. */
  readonly held: boolean;
  /** Real time of the decision (seconds). */
  readonly at: number;
}
/** What drawing the frame reported (drawGraph's result): GPU effects and transitions it could not run, clips whose picture was missing. */
export interface FlashPainted { readonly unavailableEffects?: readonly string[]; readonly missing?: readonly string[] }
/** What `FlashGuard.paint` needs from its caller. */
export interface FlashPaintIO<R extends FlashPainted> {
  /** Real time in seconds (monotonic; never an audio clock, which can stand still). */
  now(): number;
  /** Draw this graph off screen; resolves with what drawing reported. */
  draw(graph: RenderGraph): Promise<R>;
  /** Put the frame drawn off screen on the screen, in one step. */
  copy(): void;
  sleep(seconds: number): Promise<void>;
  /** Run this on the next animation frame (requestAnimationFrame); without it a rise is timed from its copy. */
  nextFrame?(run: () => void): void;
}
/** The most a decision looks ahead: a draw slower than this is held back rather than waited for. */
export const SCREEN_FLASH_AHEAD_MAX = 0.25;
/** What the guard keeps per layer of the screen: whether its light is rising, the lowest since its last fall, the highest since its rise. */
interface Lamp { rising: boolean; low: number; high: number }
const AT_REST: Lamp = { rising: false, low: 0, high: 0 };
export class FlashGuard {
  /** Real time at which the last rise reached the screen. */
  private last = -Infinity;
  /** Per layer on screen (by layerKey): its light's bookkeeping. A layer that is not listed shows no light and is not rising. */
  private lamps = new Map<string, Lamp>();
  /** Counts rises shown; `presented` only moves the time of the latest. */
  private rises = 0;
  /** Seconds from decision to screen of the latest frames: how far ahead a decision must look. */
  private leads: number[] = [];
  /** The frame on screen: its timeline second, its frame duration and the real time it was decided (null before the first). */
  private onScreen: { tl: number; frame: number; at: number } | null = null;
  /** Frames on which a rise was held back (for tests and diagnostics). */
  leftOut = 0;
  /** Times a copy to the screen waited for the gap (`paint`), and the longest such wait in seconds (diagnostics). */
  waited = 0;
  longestWait = 0;
  constructor(private readonly gap = SCREEN_FLASH_GAP) {}
  /** Forget what was shown (a new player, another project). */
  reset() { this.last = -Infinity; this.lamps.clear(); this.leads = []; this.onScreen = null; }
  /**
   * Something this guard did not draw came on screen (another tile of the effect gallery starts to animate over its still):
   * its light is not known, so the next light counts as a rise. The time of the last rise is kept.
   */
  screenUnknown() { this.lamps.clear(); this.onScreen = null; }
  /**
   * What a frame with these lights (by layer), decided at real time `at`, would do on screen: 'rise' when the light of some
   * layer goes more than SCREEN_FLASH_STEP above the lowest it has been since its last fall; 'further' when it does not, but
   * the light of a layer that is rising, and not yet SCREEN_FLASH_SEEN above the light before its rise, steps up again by
   * more than SCREEN_FLASH_STEP through frames that jump (see `continues`); null otherwise.
   */
  private change(lights: ReadonlyMap<string, number>, g: RenderGraph, at: number): 'rise' | 'further' | null {
    let further = false;
    for (const key of new Set([...this.lamps.keys(), ...lights.keys()])) {
      const lamp = this.lamps.get(key) ?? AT_REST, light = lights.get(key) ?? 0;
      if (!lamp.rising && light > lamp.low + SCREEN_FLASH_STEP) return 'rise';
      if (lamp.rising && lamp.high - lamp.low < SCREEN_FLASH_SEEN && light > lamp.high + SCREEN_FLASH_STEP) further = true;
    }
    return further && !this.continues(g, at) ? 'further' : null;
  }
  /** Whether a frame must keep the gap from the last rise: it begins a rise. */
  private needsGap(lights: ReadonlyMap<string, number>, g: RenderGraph, at: number) { return this.change(lights, g, at) === 'rise'; }
  /**
   * While the light of a layer is rising and has not yet gone SCREEN_FLASH_SEEN above the light before it, a further step
   * up of more than SCREEN_FLASH_STEP through frames that jump (a shuttle, a seek, a loop, a pause: another flash seen part
   * way, a weak light followed by a strong one) is where a viewer who needs a bigger step than this guard's sees the rise
   * begin: the rise is timed from it (`shown`), so the next rise waits a gap from there. It is never held: it comes after
   * the rise began, so more than a gap after the rise before. Measured without this: a weak light (+4 of 255) began the
   * guard's rise, a strong one (+27) came a paint later, and the next rise a viewer saw came 0.27 s after it. Frames that
   * follow the one on screen at about the pace of real time are the light of one flash rising over several frames (a
   * transition's light at normal speed) and do not move the time.
   * `g`, decided at real time `at`, is one of the next frames after the one on screen at about real-time pace.
   */
  private continues(g: RenderGraph, at: number) {
    const on = this.onScreen;
    if (!on) return false;
    const real = at - on.at, step = T.toSeconds(g.time) - on.tl;
    return real >= 0 && real <= 0.25 && step > 0 && step <= 1.25 * real + 1.01 * on.frame;
  }
  /** How long the frames take from decision to screen, a little more than the slowest of the latest, never more than SCREEN_FLASH_AHEAD_MAX. */
  private ahead() { return this.leads.length ? Math.min(SCREEN_FLASH_AHEAD_MAX, Math.max(...this.leads) + 0.05) : 0; }
  /** Before drawing: the graph to draw at real time `now`. The graph is not changed; a copy without light is returned when held. */
  decide(graph: RenderGraph, now: number): FlashDecision {
    if (this.needsGap(layerLights(graph), graph, now) && now + this.ahead() - this.last < this.gap) { this.leftOut++; return { graph: withoutFlash(graph), held: true, at: now }; }
    return { graph, held: false, at: now };
  }
  /** Just before the copy: seconds to wait from `now` before the drawn frame may reach the screen (0: at once). */
  wait(d: FlashDecision, now: number, painted?: FlashPainted): number {
    return !this.needsGap(layerLights(d.graph, painted), d.graph, d.at) || now - this.last >= this.gap ? 0 : Math.max(1e-6, this.last + this.gap - now);
  }
  /**
   * The drawn frame reached the screen at real time `at` (right after the copy), with what drawing reported. Returns the
   * number of the rise it began (for `presented`), or 0 when it began none.
   */
  shown(d: FlashDecision, at: number, painted?: FlashPainted): number {
    const lights = layerLights(d.graph, painted);
    this.leads.push(Math.max(0, at - d.at));
    if (this.leads.length > 8) this.leads.shift();
    const change = this.change(lights, d.graph, d.at);
    const seconds = T.toSeconds(d.graph.time);
    this.onScreen = { tl: seconds, frame: d.graph.frameIndex > 0 ? seconds / d.graph.frameIndex : 1 / 24, at: d.at };
    for (const key of new Set([...this.lamps.keys(), ...lights.keys()])) {
      const lamp = { ...(this.lamps.get(key) ?? AT_REST) }, light = lights.get(key) ?? 0;
      if (!lamp.rising && light > lamp.low + SCREEN_FLASH_STEP) { lamp.rising = true; lamp.high = light; }
      else if (lamp.rising) { lamp.high = Math.max(lamp.high, light); if (light < lamp.high - SCREEN_FLASH_STEP) { lamp.rising = false; lamp.low = light; } }
      else lamp.low = Math.min(lamp.low, light);
      if (!lamp.rising && lamp.low <= 0) this.lamps.delete(key); else this.lamps.set(key, lamp);
    }
    if (change) { this.last = at; return ++this.rises; }
    return 0;
  }
  /** A later real time at which rise `rise` (from `shown`) is known to be on its way to the display: it is timed from then. */
  presented(rise: number, at: number) { if (rise > 0 && rise === this.rises && at > this.last) this.last = at; }
  /**
   * The whole path of one frame to the screen, as the editor's player and the effect gallery take it: decide, draw off
   * screen, wait for the gap if this frame begins a rise, copy, record what is on screen, and time a rise from the next
   * animation frame. Resolves to what drawing reported.
   */
  async paint<R extends FlashPainted>(graph: RenderGraph, io: FlashPaintIO<R>): Promise<R> {
    const decision = this.decide(graph, io.now());
    const drawn = await io.draw(decision.graph);
    for (let w = this.wait(decision, io.now(), drawn); w > 0; w = this.wait(decision, io.now(), drawn)) {
      this.waited++; this.longestWait = Math.max(this.longestWait, w);
      await io.sleep(w);
    }
    io.copy();
    const rise = this.shown(decision, io.now(), drawn);
    if (rise && io.nextFrame) io.nextFrame(() => this.presented(rise, io.now()));
    return drawn;
  }
  /** Decide, draw and show at one instant `now` (a synchronous drawing): the graph to draw. */
  apply(graph: RenderGraph, now: number): RenderGraph {
    let d = this.decide(graph, now);
    if (this.wait(d, now) > 0) { this.leftOut++; d = { graph: withoutFlash(graph), held: true, at: now }; }
    this.shown(d, now);
    return d.graph;
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
/** The key of a layer of the screen for the guard's bookkeeping: its kind and clip. */
const layerKey = (l: AnyLayer, i: number) => ('clipId' in l ? `${l.kind}\n${l.clipId}` : `#${i}`);
/**
 * The light each layer of a graph puts on screen, as the guard follows it, by layer: its strobes mixed into each other as
 * their passes mix them into the picture (1 − (1 − a)(1 − b)…, the GPU pass's strength for each) and with the light of its
 * light transition; and, under '*', the strongest of them. Layers without light are left out. Followed per layer because a
 * frame's strongest light alone hides a rise: a title strobe at full strength on top of a picture whose own two strobes go
 * from 0.8 to 0.96 (229 to 250 of 255 on screen) leaves the strongest light at 1. With `painted`, only what was really drawn: nothing from a GPU effect
 * or transition drawing reported unavailable, nor from a layer whose picture was missing (its effects were not drawn either).
 */
export function layerLights(graph: RenderGraph, painted?: FlashPainted): Map<string, number> {
  const off = new Set(painted?.unavailableEffects ?? []), gone = new Set(painted?.missing ?? []);
  const out = new Map<string, number>();
  graph.layers.forEach((layer, i) => {
    if ('clipId' in layer && layer.kind !== 'text' && gone.has(layer.clipId)) return;
    let dark = 1;
    if (!off.has('light.strobe')) for (const fx of effectsOf(layer)) if (fx.type === 'light.strobe') dark *= 1 - strength(fx.params);
    if (!('transition' in layer && layer.transition && off.has(layer.transition.type))) dark *= 1 - transitionLight(layer);
    if (dark < 1) out.set(layerKey(layer, i), 1 - dark);
  });
  // and the strongest of them, followed as one more layer: a rise of either kind counts (one layer's light can fall while
  // another's, still rising, edges up: the strongest light then rises again although no layer's own light rose anew)
  if (out.size) out.set(STRONGEST, Math.max(...out.values()));
  return out;
}
/** The key under which layerLights lists the strongest light of the frame. */
const STRONGEST = '*';
/** The strongest light any layer of a graph puts on screen (see layerLights). */
export function screenLight(graph: RenderGraph, painted?: FlashPainted): number {
  return layerLights(graph, painted).get(STRONGEST) ?? 0;
}
/** The light a strobe adds on a frame, as its GPU pass computes it (gpu.ts 'light.strobe'): 0 without a flash time. */
const strength = (p: Record<string, number | string | boolean>) => {
  const since = p[FLASH_SINCE], amount = typeof p.amount === 'number' ? p.amount : 0.6;
  if (typeof since !== 'number' || !(since * STROBE_FADE <= 12)) return 0;
  return amount * Math.exp(-Math.max(0, since) * STROBE_FADE);
};
