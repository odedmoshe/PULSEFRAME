/**
 * Flash safety on the screen while the editor shuttles (ADR-0009, FlashGuard): the measurement gpu-proof makes, and its verdict.
 *
 * What is measured, on every animation frame of the page, with its real time: the mean brightness of the preview canvas, the
 * number of the timeline frame it shows (data-frame) and the guard's count of frames it held back (data-flashes-held).
 * A flash on screen is a rise of the mean brightness by more than 8 of 255 above the lowest since the last fall (a fall:
 * the same below the highest since the rise).
 *
 * THE SCREEN WITHOUT THE GUARD, AND THROUGH ANOTHER GUARD. The frames that were on screen, with the real times they came on
 * it, are worked out again here from the document: the strobe pass mixes its colour into the picture by the strobe's light,
 * so a frame's brightness without the guard is the picture's own brightness with every strobe on a picture mixed in, and a
 * frame the guard holds shows the picture's own brightness. This is checked on every run against the screen itself: each
 * frame that was on screen must show one of the two (within 4 of 255); on the recorded run in the unit test all 45 do,
 * within 1. From that record the same paints are replayed through the rule with any gap (`replayGuard`, the rule restated
 * here, not the product's class): the right gap of a third of a second, and deliberately wrong ones (0.2, 0.25, 0.3 s).
 *
 * THE VERDICT, in this order; only `ok` passes.
 *  1. `unsafe`: some second of real time holds more than three flashes on screen.
 *  2. `not-measured`: too few samples, not at 8x, or the screen is not what the document says with or without the guard.
 *  3. `not-flashing`: the preview shows fewer than half the flashes the right guard would have let through on the same
 *     paints. A guard that holds back nearly everything fails here at any paint rate.
 *  4. `blocked`: the run cannot tell the right guard from a wrong one. It can only when the paints had a MARGIN of need:
 *     without the guard the screen would have flashed at least MARGIN_FLASHES (5) times in some second (more than three is
 *     the bare need), AND the same paints replayed through deliberately wrong guards with a gap of 0.25 s and of 0.2 s
 *     (MARGIN_GAPS) would each have been judged `unsafe` (more than three flashes in some second). Otherwise nothing is
 *     shown about the guard: a wrong gap would have looked the same. The words say "too few paints for the guard to be needed" with the
 *     paint rate; the cause is not judged here (the run records the 1-minute load and the CPU seconds per paint apart).
 *  5. `too-close`: two rises on screen closer than the rule's third of a second (less half a 60 Hz refresh, the sampling).
 *     Since 2026-11-18: a guard with a wrong gap can stay at three a second on a short run and pass everything else.
 *  6. `guard-idle`: the guard's counter says it held nothing.
 *  7. `not-flashing` again, on a run that could pass: fewer than the floor, 1 + FLOOR_PER_SECOND x the window in seconds
 *     (rounded up), and never under three.
 *  8. `ok`.
 *
 * WHY A MARGIN. A rise needs a darker frame and then a brighter one, so a preview that paints six frames a second or fewer
 * cannot show more than three rises a second whatever the timeline holds. Just above that, the unguarded screen reaches
 * four in a second once in a while, and a run that stops there (as this check did) passes the right guard and also guards
 * with a gap of 0.25 s or 0.2 s: on the recorded run (5.7 paints a second; four in a second without the guard as the check
 * measured it then, three as this module measures it) all three were `ok`. So the shuttle goes on for a fixed `afterNeedMs` after the guard was first needed and until the paints have
 * the margin, up to `deadlineMs`; without the margin by then the verdict is `blocked`, which fails the proof. A gap of
 * 0.25 s judged unsafe needs four flashes that rule lets through inside one second, which the right gap (a third of a
 * second) never allows: that replay is what tells a wrong guard from the right one on the paints of this very run.
 * Why five and not six without the guard: on the quiet machine of 2026-11-18 (load 1.7, 18.3 paints a second, 1010 paints
 * in 55 s) the screen without the guard never rose more than five times in a second (five in 23 places), because the
 * strobes at 8x (20 and 24 a second) are sampled by the paints and alias; six was never reached there, while the replays
 * through gaps of 0.25 s and 0.2 s were unsafe 37 and 80 times (in seven shorter runs that day six was reached in three).
 * So the replays carry the margin, and five is what this editor shows here on every run.
 *
 * WHY THESE FLOORS. The right guard lets through up to three flashes a second; under load (5 to 10 paints a second) the
 * screen showed 0.9 to 1.5 a second, on the quiet machine 1.4 to 2.6 (17 to 18.5 paints a second, 6 to 55 s). Half of
 * what the right gap gives on the same paints (step 3) follows the paint rate by itself and fails a gap of about two thirds of a second or more when the editor paints fast.
 * The floor of step 6 is 1 + 0.6 a second of the window: 0.6 is two thirds of the least measured with the right guard
 * (0.9 a second), and the 1 is the flash a guard may let through at the very start of the window. A guard with a gap of
 * g seconds shows at most 1 + window/g flashes, so any gap above 1/0.6 = 1.67 s fails the floor whatever the window and
 * the paint rate: one flash every 2 s or every 10 s is not "keeps flashing" in a window of 5 s or of 55 s.
 */
import fs from 'node:fs';
import os from 'node:os';
import type { Page } from 'playwright';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { evaluate, GPU_EFFECTS, type RenderGraph } from '@pulseframe/engine';

/** One animation frame of the page: real time (seconds), mean brightness of the preview (0..255), the timeline frame on it. */
export type ShuttleSample = [t: number, mean: number, frame: number];

/** A change of the mean brightness by more than this (of 255) is a rise or a fall on screen. */
export const SCREEN_STEP = 8;
/** The rule (ADR-0009): flash starts on screen at least a third of a second apart, and the step of light the guard counts as a rise. Stated here, not read from the product. */
export const RIGHT_GAP = 1 / 3 + 1e-3, GUARD_STEP = 0.02;
/** The rule (FlashGuard.shown): a rise not yet this far above the light before it is timed again from a further step up through frames that jump. Stated here, not read from the product. */
export const GUARD_SEEN = 0.1;
/** Gaps a wrong guard could have, replayed on every run and recorded. */
export const WRONG_GAPS = [0.2, 0.25, 0.3] as const;
/** Margin of need: this many flashes in some second without the guard (more than 3 is the bare need) … */
export const MARGIN_FLASHES = 5;
/** … and the same paints through guards with these (wrong) gaps each judged `unsafe`. */
export const MARGIN_GAPS = [0.25, 0.2] as const;
/** Keeps flashing: at least this share of the flashes the right guard lets through on the same paints, and at least 1 + this many a second of the window (and three). */
export const KEEP_SHARE = 0.5, KEEP_SLACK = 2, FLOOR_PER_SECOND = 0.6;
/**
 * Two rises on screen closer than RIGHT_GAP less this are a fault of the guard (`too-close`): half a refresh of a 60 Hz
 * display, for the samples are taken once a refresh (a guard that times rises by the frames' real times can show them a
 * refresh apart less than its gap on the samples: 20 refreshes for its 0.334 s; a gap of 0.25 s shows 19 or fewer).
 */
export const SPACING_SLACK = 1 / 120;
/** A frame on screen is explained when it shows what the document gives with or without the guard, within this (of 255). */
export const MODEL_TOLERANCE = 4;

/** Real times at which `value` starts a rise: more than `step` above its lowest since the last fall. The first value is no rise. */
export function riseTimes(points: readonly (readonly [number, number])[], step: number): number[] {
  const rises: number[] = [];
  let rising = false, low = Infinity, high = 0;
  for (const [t, v] of points) {
    if (!rising && v > low + step) { rises.push(t); rising = true; high = v; }
    else if (rising && v < high - step) { rising = false; low = v; }
    if (rising) high = Math.max(high, v); else low = Math.min(low, v);
  }
  return rises;
}
/** The most of `times` that lie within `span` seconds of each other (one second: the rule). */
export function mostInOneSecond(times: readonly number[], span = 1): number {
  let most = 0;
  for (let i = 0, j = 0; i < times.length; i++) { while (times[i]! - times[j]! > span) j++; most = Math.max(most, i - j + 1); }
  return most;
}

/** What a frame of the timeline carries, read from `evaluate` as the passes compute it (not from the guard's bookkeeping). */
export interface FrameLight {
  /** The light the guard follows, per layer (its kind and clip): the layer's strobes mixed, 1 − (1 − a)(1 − b)…, with its light transition's light (0..1), layers without light left out; and under '*' the strongest of them. */
  layers: (readonly [layer: string, light: number])[];
  /** The strongest of them (0..1). */
  guard: number;
  /** The strobes on pictures (video, image, adjustment: they cover the frame), in drawing order: [brightness of the strobe's colour 0..255, its light 0..1]. */
  picture: (readonly [colour: number, light: number])[];
}
export function frameLight(g: RenderGraph): FrameLight {
  let guard = 0;
  const picture: [number, number][] = [], layers: [string, number][] = [];
  g.layers.forEach((l, i) => {
    let dark = 1;
    for (const fx of 'effects' in l ? l.effects ?? [] : []) {
      if (fx.type !== 'light.strobe') continue;
      const [r, gr, b, light] = GPU_EFFECTS['light.strobe']!.params(fx.params, { width: g.width, height: g.height, seconds: T.toSeconds(g.time), beat: null }) as [number, number, number, number];
      dark *= 1 - light;
      if (l.kind !== 'text') picture.push([(255 * (r + gr + b)) / 3, light]); // a title's strobe lights its letters only: under 2 of 255 of the mean
    }
    if ('transition' in l && l.transition) dark *= 1 - (l.transition.light ?? 0);
    if (dark < 1) { layers.push(['clipId' in l ? `${l.kind}\n${l.clipId}` : `#${i}`, 1 - dark]); guard = Math.max(guard, 1 - dark); }
  });
  if (layers.length) layers.push(['*', guard]); // the strongest light, followed as one more layer (FlashGuard: layerLights)
  return { layers, guard, picture };
}
/** The light the strobes and light transitions of a graph add (0..1), as the guard follows it. */
export const graphLight = (g: RenderGraph): number => frameLight(g).guard;
const lights = new WeakMap<ProjectDocument, Map<number, FrameLight>>();
/** What a timeline frame carries when nothing holds it back. */
export function unguarded(doc: ProjectDocument, frame: number): FrameLight {
  let byFrame = lights.get(doc);
  if (!byFrame) lights.set(doc, (byFrame = new Map()));
  let v = byFrame.get(frame);
  if (!v) byFrame.set(frame, (v = frameLight(evaluate(doc, T.frameTime(frame, doc.settings.frameRate)))));
  return v;
}
/** The mean brightness of a frame with its strobes mixed in (the pass: mix(picture, colour, light)), over a picture of mean brightness `base`. */
export const litBrightness = (base: number, f: FrameLight): number => f.picture.reduce((m, [colour, light]) => m * (1 - light) + colour * light, base);

/** One frame coming on screen: when, which (and its second on the timeline), how bright it was, and what the document gives for it. */
export interface Paint { t: number; frame: number; seconds: number; mean: number; light: FrameLight }
/** Each time another frame came on screen. */
export function paintsOf(samples: readonly ShuttleSample[], doc: ProjectDocument): Paint[] {
  const out: Paint[] = [];
  const { num, den } = doc.settings.frameRate;
  for (let i = 0; i < samples.length; i++) if (i === 0 || samples[i]![2] !== samples[i - 1]![2]) out.push({ t: samples[i]![0], frame: samples[i]![2], seconds: (samples[i]![2] * den) / num, mean: samples[i]![1], light: unguarded(doc, samples[i]![2]) });
  return out;
}
/**
 * The rule of the player's guard with any gap, on recorded paints drawn and shown at their time: a rise of the light that
 * would begin less than `gap` seconds after the last rise is held back (the frame is drawn without its light). While the
 * light is rising and not yet GUARD_SEEN above the light before it, a further step up through frames that jump (not the
 * next frames at about the pace of real time) times the rise from there (FlashGuard.shown, 2026-11-18). Returns, per paint,
 * whether it is held.
 * The rule is restated here so that a wrong guard can be replayed without touching the product.
 */
export function replayGuard(paints: readonly Pick<Paint, 't' | 'light' | 'frame' | 'seconds'>[], gap: number): boolean[] {
  let last = -Infinity;
  const lamps = new Map<string, { rising: boolean; low: number; high: number }>();
  let on: { tl: number; frame: number; at: number } | null = null;
  return paints.map(({ t, light, frame, seconds }) => {
    const lights = new Map(light.layers), keys = new Set([...lamps.keys(), ...lights.keys()]);
    let rise = false, further = false;
    for (const k of keys) {
      const lamp = lamps.get(k) ?? { rising: false, low: 0, high: 0 }, v = lights.get(k) ?? 0;
      if (!lamp.rising && v > lamp.low + GUARD_STEP) rise = true;
      else if (lamp.rising && lamp.high - lamp.low < GUARD_SEEN && v > lamp.high + GUARD_STEP) further = true;
    }
    if (!rise && further) {
      const real = t - (on?.at ?? -Infinity), step = seconds - (on?.tl ?? Infinity);
      further = !(on !== null && real >= 0 && real <= 0.25 && step > 0 && step <= 1.25 * real + 1.01 * on.frame);
    } else further = false;
    const held = rise && t - last < gap;
    if (!held && (rise || further)) last = t;
    on = { tl: seconds, frame: frame > 0 ? seconds / frame : 1 / 24, at: t };
    for (const k of keys) {
      const lamp = { ...(lamps.get(k) ?? { rising: false, low: 0, high: 0 }) }, v = held ? 0 : lights.get(k) ?? 0;
      if (!lamp.rising && v > lamp.low + GUARD_STEP) { lamp.rising = true; lamp.high = v; }
      else if (lamp.rising) { lamp.high = Math.max(lamp.high, v); if (v < lamp.high - GUARD_STEP) { lamp.rising = false; lamp.low = v; } }
      else lamp.low = Math.min(lamp.low, v);
      if (!lamp.rising && lamp.low <= 0) lamps.delete(k); else lamps.set(k, lamp);
    }
    return held;
  });
}
export interface Replay { gap: number; flashes: number; mostInOneSecond: number; /** Judged as the screen is: more than three flashes in some second. */ unsafe: boolean }
/** What the screen would have shown had these paints gone through a guard with this gap. */
export function replayScreen(paints: readonly Paint[], base: number, gap: number): Replay {
  const held = replayGuard(paints, gap);
  const rises = riseTimes(paints.map((p, i) => [p.t, held[i] ? base : litBrightness(base, p.light)] as const), SCREEN_STEP);
  const most = mostInOneSecond(rises);
  return { gap, flashes: rises.length, mostInOneSecond: most, unsafe: most > 3 };
}

export interface ShuttleMeasure {
  samples: number;
  /** Seconds from the first sample to the last. */
  windowSeconds: number;
  /** Changes of the frame on screen, and how many of them a second from the first to the last. */
  paints: number;
  paintsPerSecond: number;
  /** Rises of the brightness on screen, how many a second of the window, and the most within one second. */
  flashesOnScreen: number;
  flashesPerSecond: number;
  mostInOneSecond: number;
  /**
   * Seconds between the two closest rises on screen (null with fewer than two). Judged since 2026-11-18 (`too-close`): until
   * then it could be shorter than the guard's third of a second without the guard counting a fault, because the guard timed
   * a rise that builds over several paints from its first step of 0.02 of the light and this measure from the first step of
   * 8 of 255 (measured: 0.246 s where the guard's own starts were 0.33 s apart on screen), and from its decision before the
   * draw rather than from the frame reaching the screen. The guard now times a rise from the paint where a viewer can see it
   * (FlashGuard.shown, `further`) and from the frame reaching the screen.
   */
  closestOnScreen: number | null;
  /** The picture's own brightness: the median of the frames on screen that carry no light (under 0.004); the lowest brightness seen when there is none. */
  pictureBrightness: number;
  /** Frames on screen that show neither what the document gives without the guard nor the picture alone (within MODEL_TOLERANCE). */
  unexplained: number;
  /** Frames on screen that show the picture alone where the document gives a visible light: held back, as the screen tells it. */
  heldOnScreen: number;
  /** Rises the same frames at the same times would have shown without the guard, and the most within one second. */
  flashesWithoutGuard: number;
  mostInOneSecondWithoutGuard: number;
  /** More than three in a second without the guard: the guard had work to do. */
  guardNeeded: boolean;
  /** Rises the same paints show through the rule with the right gap: what "keeps flashing" is measured against. */
  flashesWithRightGuard: number;
  /** The same paints through guards with a wrong gap. */
  wrongGuards: Replay[];
  /** The wrong gaps this run tells from the right one: their replay on the same paints is judged unsafe. */
  wrongGapsCaught: number[];
  /** The margin of need: MARGIN_FLASHES in some second without the guard, and the replays with every gap of MARGIN_GAPS unsafe. */
  margin: boolean;
  /** The least number of flashes on screen for a run that passes: 1 + FLOOR_PER_SECOND x the window (rounded up), and three. */
  flashFloor: number;
}
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[s.length >> 1]! : NaN; };
/** The frames that were on screen with the times they came on it, and what they show with the guard, without it and with a wrong one. */
export function measureShuttle(samples: readonly ShuttleSample[], doc: ProjectDocument): ShuttleMeasure {
  const onScreen = riseTimes(samples.map(([t, m]) => [t, m] as const), SCREEN_STEP);
  const paints = paintsOf(samples, doc);
  const dark = paints.filter((p) => litBrightness(0, p.light) < 1 && p.light.guard < 0.004).map((p) => p.mean);
  const base = dark.length ? median(dark) : Math.min(Infinity, ...samples.map(([, m]) => m));
  let unexplained = 0, heldOnScreen = 0;
  for (const p of paints) {
    const lit = litBrightness(base, p.light), alone = Math.abs(p.mean - base) <= MODEL_TOLERANCE;
    if (!alone && Math.abs(p.mean - lit) > MODEL_TOLERANCE) unexplained++;
    if (alone && lit - base > SCREEN_STEP) heldOnScreen++;
  }
  const without = riseTimes(paints.map((p) => [p.t, litBrightness(base, p.light)] as const), SCREEN_STEP);
  const span = paints.length > 1 ? paints[paints.length - 1]!.t - paints[0]!.t : 0;
  const windowSeconds = samples.length > 1 ? samples[samples.length - 1]![0] - samples[0]![0] : 0;
  const most = mostInOneSecond(without);
  const wrongGuards = WRONG_GAPS.map((gap) => replayScreen(paints, base, gap));
  const wrongGapsCaught = wrongGuards.filter((r) => r.unsafe).map((r) => r.gap);
  return {
    samples: samples.length, windowSeconds: Number(windowSeconds.toFixed(2)),
    paints: Math.max(0, paints.length - 1), paintsPerSecond: span > 0 ? Number(((paints.length - 1) / span).toFixed(1)) : 0,
    flashesOnScreen: onScreen.length, flashesPerSecond: windowSeconds > 0 ? Number((onScreen.length / windowSeconds).toFixed(2)) : 0, mostInOneSecond: mostInOneSecond(onScreen),
    closestOnScreen: onScreen.length > 1 ? Number(Math.min(...onScreen.slice(1).map((t, i) => t - onScreen[i]!)).toFixed(3)) : null,
    pictureBrightness: Number.isFinite(base) ? Number(base.toFixed(1)) : 0, unexplained, heldOnScreen,
    flashesWithoutGuard: without.length, mostInOneSecondWithoutGuard: most, guardNeeded: most > 3,
    flashesWithRightGuard: replayScreen(paints, base, RIGHT_GAP).flashes,
    wrongGuards, wrongGapsCaught,
    margin: most >= MARGIN_FLASHES && MARGIN_GAPS.every((gap) => wrongGapsCaught.includes(gap)),
    flashFloor: Math.max(3, 1 + Math.ceil(FLOOR_PER_SECOND * windowSeconds)),
  };
}

export type ShuttleVerdict =
  /** Safe on screen, it kept flashing, the paints had a margin of need, and the guard held frames back. */
  | 'ok'
  /** More than three flashes in a second of real time on the screen. */
  | 'unsafe'
  /** No more than three in a second, but two rises on screen closer than the guard's rule allows (RIGHT_GAP less SPACING_SLACK). */
  | 'too-close'
  /** The paints had the margin of need and the guard's counter says it held nothing. */
  | 'guard-idle'
  /** The measurement did not happen as set up: too few samples, not at 8x, or the screen is not what the document gives with or without the guard. */
  | 'not-measured'
  /** The preview does not keep flashing: under half of what the right guard lets through on the same paints, or (on a run that could pass) under the floor for the window. */
  | 'not-flashing'
  /** Safe and flashing, but too few paints for the guard to be needed with a margin: a wrong guard would have looked the same, so nothing is shown about the guard. */
  | 'blocked';
export function judgeShuttle(m: ShuttleMeasure, held: number, shuttleShown: string): ShuttleVerdict {
  if (m.mostInOneSecond > 3) return 'unsafe';
  if (!(m.samples > 30) || !shuttleShown.includes('8')) return 'not-measured';
  if (m.unexplained > m.paints / 20) return 'not-measured';
  if (m.flashesOnScreen + KEEP_SLACK < KEEP_SHARE * m.flashesWithRightGuard) return 'not-flashing';
  if (!m.margin) return 'blocked';
  if (m.closestOnScreen !== null && m.closestOnScreen < RIGHT_GAP - SPACING_SLACK) return 'too-close';
  if (!(held > 0)) return 'guard-idle';
  if (m.flashesOnScreen < m.flashFloor) return 'not-flashing';
  return 'ok';
}

/** CPU seconds used so far by every process below this one (the browser, its GPU process and its renderers among them); null where /proc is not there. */
export function childCpuSeconds(): number | null {
  try {
    const procs = new Map<number, { ppid: number; ticks: number }>();
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try { const s = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); const rest = s.slice(s.lastIndexOf(')') + 2).split(' '); procs.set(Number(d), { ppid: Number(rest[1]), ticks: Number(rest[11]) + Number(rest[12]) }); } catch { /* the process is gone */ }
    }
    let ticks = 0;
    for (const p of procs.values()) { let a = p.ppid, n = 0; while (a > 1 && a !== process.pid && n++ < 50) a = procs.get(a)?.ppid ?? 1; if (a === process.pid) ticks += p.ticks; }
    return ticks / 100; // USER_HZ
  } catch { return null; }
}

export interface ShuttleRun {
  verdict: ShuttleVerdict; shuttle: string; seconds: number; held: number; measure: ShuttleMeasure; samples: ShuttleSample[];
  /** What the machine was doing, recorded and not judged: the 1-minute load average before and after, its CPUs, and the CPU time this process's children (the browsers) used during the shuttle, per second and per paint. */
  machine: { load1Before: number; load1After: number; cpus: number; childCpuPerSecond: number | null; childCpuSecondsPerPaint: number | null };
  /** With `blocked`: what was missing, in words. */
  blocked?: string;
}
/** The words of a `blocked` verdict: what the paints lacked. The cause is not stated: it is for the machine's numbers to tell. */
export function blockedText(m: ShuttleMeasure, seconds: number, held: number): string {
  const missing = !m.guardNeeded
    ? `the frames it showed would not have flashed more than three times in a second without the guard either (${m.mostInOneSecondWithoutGuard}), so the guard had nothing it must hold (it held ${held})`
    : `the frames it showed would have flashed ${m.mostInOneSecondWithoutGuard} times in a second without the guard (the margin asks for ${MARGIN_FLASHES}), and of guards with a wrong gap of ${MARGIN_GAPS.join(' s and ')} s the same paints would have shown ${MARGIN_GAPS.filter((g) => m.wrongGapsCaught.includes(g)).map((g) => `${g} s`).join(' and ') || 'neither'} to be unsafe: a wrong guard could have looked the same (the guard held ${held})`;
  return `blocked, not a pass: too few paints for the guard to be needed${m.guardNeeded ? ' with a margin' : ''} (${m.paintsPerSecond} paints a second) in ${seconds} s at 8x: ${missing}.`;
}
/**
 * In an editor page that shows `doc` paused: sample the preview on every animation frame, put the playhead at the start,
 * shuttle forwards at 8x (L four times), and stop (K) once `minMs` have passed, `afterNeedMs` have passed since the guard
 * was first needed and the paints have the margin of need; or at `deadlineMs`; or when the shuttle reaches the end of the timeline.
 */
export async function shuttleAt8(page: Page, doc: ProjectDocument, { minMs = 2500, afterNeedMs = 5000, deadlineMs = 30_000 }: { minMs?: number; afterNeedMs?: number; deadlineMs?: number } = {}): Promise<ShuttleRun> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // (a string, not a function: the TypeScript runner would wrap named functions in a helper the page does not have)
  await page.evaluate(`(() => {
    const c = document.querySelector('canvas[data-testid=preview]');
    const small = document.createElement('canvas'); small.width = 16; small.height = 16;
    const sx = small.getContext('2d', { willReadFrequently: true });
    const out = []; window.__pfFlashSamples = out;
    const loop = () => { sx.drawImage(c, 0, 0, 16, 16); const d = sx.getImageData(0, 0, 16, 16).data; let m = 0; for (let i = 0; i < d.length; i += 4) m += (d[i] + d[i + 1] + d[i + 2]) / 3; out.push([performance.now() / 1000, m / 256, Number(c.dataset.frame)]); if (out.length < 200000) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  })()`);
  const ruler = (await page.getByTestId('ruler').boundingBox())!;
  await page.mouse.click(ruler.x + 3, ruler.y + 5); // the playhead to the start; the keys go to the editor
  await page.waitForFunction(() => (window as unknown as { __pfFlashSamples: unknown[] }).__pfFlashSamples.length > 0, undefined, { timeout: 10_000 });
  // the window starts with the paused picture that is on screen as the shuttle begins
  const from = await page.evaluate(() => (window as unknown as { __pfFlashSamples: unknown[] }).__pfFlashSamples.length - 1);
  const load1Before = os.loadavg()[0]!, cpu0 = childCpuSeconds(), wall0 = Date.now();
  await page.keyboard.press('l');
  await page.waitForFunction(() => document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'true', undefined, { timeout: 10_000 });
  for (let i = 0; i < 3; i++) { await page.keyboard.press('l'); await sleep(60); }
  const shuttle = ((await page.getByTestId('shuttle').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
  const t0 = Date.now();
  const read = () => page.evaluate((n) => (window as unknown as { __pfFlashSamples: ShuttleSample[] }).__pfFlashSamples.slice(n), from);
  let neededAt: number | null = null;
  for (;;) {
    await sleep(250);
    const elapsed = Date.now() - t0;
    if (elapsed >= deadlineMs) break;
    const m = measureShuttle(await read(), doc);
    if (m.guardNeeded && neededAt === null) neededAt = elapsed;
    if (neededAt !== null && m.margin && elapsed >= Math.max(minMs, neededAt + afterNeedMs)) break;
    if ((await page.getByTestId('play').getAttribute('data-playing')) !== 'true') break; // the end of the timeline
  }
  const held = Number(await page.locator('canvas[data-testid=preview]').getAttribute('data-flashes-held')); // before the stop: the frame it stops on passes the guard too
  await page.keyboard.press('k');
  const cpu1 = childCpuSeconds(), wall = (Date.now() - wall0) / 1000;
  const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  const samples = await read();
  const measure = measureShuttle(samples, doc);
  const verdict = judgeShuttle(measure, held, shuttle);
  const cpu = cpu0 !== null && cpu1 !== null ? cpu1 - cpu0 : null;
  return {
    verdict, shuttle, seconds, held, measure, samples,
    machine: {
      load1Before: Number(load1Before.toFixed(2)), load1After: Number(os.loadavg()[0]!.toFixed(2)), cpus: os.cpus().length,
      childCpuPerSecond: cpu === null ? null : Number((cpu / wall).toFixed(2)), childCpuSecondsPerPaint: cpu === null || !measure.paints ? null : Number((cpu / measure.paints).toFixed(3)),
    },
    ...(verdict === 'blocked' ? { blocked: blockedText(measure, seconds, held) } : {}),
  };
}
