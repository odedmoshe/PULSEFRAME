/**
 * Flash safety on the screen while the editor shuttles (ADR-0009, FlashGuard): the measurement gpu-proof makes, and its verdict.
 *
 * What is measured, on every animation frame of the page, with its real time: the mean brightness of the preview canvas, the
 * number of the timeline frame it shows (data-frame) and the guard's count of frames it held back (data-flashes-held).
 *
 * The verdict has two halves and each can fail on its own.
 *  1. SAFE: a flash on screen is a rise of the mean brightness by more than 8 of 255 above the lowest since the last fall
 *     (a fall: the same below the highest since the rise). No second of real time holds more than three rises.
 *  2. THE GUARD WAS NEEDED AND WORKED: the frames that were on screen, with the real times they were on it, are drawn again
 *     here from the document WITHOUT the guard (the light the strobe pass and a light transition add, read from `evaluate`,
 *     not from the guard's own bookkeeping). If that light rises more than three times in some second, the screen would have
 *     broken the rule without the guard: the guard was needed. Then it must have held frames back (its counter above 0).
 *
 * The second half needs the editor to paint often enough. A rise needs a darker frame and then a brighter one, so a preview
 * that paints six frames a second or fewer cannot show more than three rises a second whatever the timeline holds: the guard
 * has nothing to do, and that is correct. On a machine busy with other work the software WebGPU adapter paints that slowly
 * (measured: 4 to 6 paints a second at a load of 6 to 8 on 4 CPUs, where the guard held 0 or 1 frames in 2.5 s). A fixed
 * window of 2.5 s then says nothing about the guard. So the shuttle runs until the guard was needed (and at least `minMs`),
 * up to `deadlineMs`. If the guard was never needed by then the verdict is `blocked` with the paint rate: not a pass.
 * A guard that is switched off (new FlashGuard(0)) gives `unsafe` or `guard-idle` when the editor paints fast enough and
 * `blocked` when it does not; it never gives `ok`, because its counter stays 0.
 */
import type { Page } from 'playwright';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { evaluate, GPU_EFFECTS, type RenderGraph } from '@pulseframe/engine';

/** One animation frame of the page: real time (seconds), mean brightness of the preview (0..255), the timeline frame on it. */
export type ShuttleSample = [t: number, mean: number, frame: number];

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
/** The most of `times` that lie within one second of each other. */
export function mostInOneSecond(times: readonly number[]): number {
  let most = 0;
  for (let i = 0, j = 0; i < times.length; i++) { while (times[i]! - times[j]! > 1) j++; most = Math.max(most, i - j + 1); }
  return most;
}
/** The light the strobes and light transitions of a graph add (0..1), as the passes compute it: read here, not from the guard. */
export function graphLight(g: RenderGraph): number {
  let most = 0;
  for (const l of g.layers) {
    for (const fx of 'effects' in l ? l.effects ?? [] : [])
      if (fx.type === 'light.strobe') most = Math.max(most, GPU_EFFECTS['light.strobe']!.params(fx.params, { width: g.width, height: g.height, seconds: T.toSeconds(g.time), beat: null })[3]!);
    if ('transition' in l && l.transition) most = Math.max(most, l.transition.light ?? 0);
  }
  return most;
}
const lights = new WeakMap<ProjectDocument, Map<number, number>>();
/** The light a timeline frame adds when nothing holds it back. */
export function unguardedLight(doc: ProjectDocument, frame: number): number {
  let byFrame = lights.get(doc);
  if (!byFrame) lights.set(doc, (byFrame = new Map()));
  let v = byFrame.get(frame);
  if (v === undefined) byFrame.set(frame, (v = graphLight(evaluate(doc, T.frameTime(frame, doc.settings.frameRate)))));
  return v;
}

export interface ShuttleMeasure {
  samples: number;
  /** Changes of the frame on screen, and how many of them a second from the first to the last. */
  paints: number;
  paintsPerSecond: number;
  /** Rises of the brightness on screen, and the most within one second. */
  flashesOnScreen: number;
  mostInOneSecond: number;
  /** Rises the same frames at the same times would have shown without the guard, and the most within one second. */
  flashesWithoutGuard: number;
  mostInOneSecondWithoutGuard: number;
  /** More than three in a second without the guard: the guard had work to do. */
  guardNeeded: boolean;
}
/** The frames that were on screen with the times they came on it, and what they show with and without the guard. */
export function measureShuttle(samples: readonly ShuttleSample[], doc: ProjectDocument): ShuttleMeasure {
  const onScreen = riseTimes(samples.map(([t, m]) => [t, m] as const), 8);
  const shown: [number, number][] = []; // [real time, timeline frame] each time another frame came on screen
  for (let i = 0; i < samples.length; i++) if (i === 0 || samples[i]![2] !== samples[i - 1]![2]) shown.push([samples[i]![0], samples[i]![2]]);
  const without = riseTimes(shown.map(([t, f]) => [t, unguardedLight(doc, f)] as const), 0.02);
  const span = shown.length > 1 ? shown[shown.length - 1]![0] - shown[0]![0] : 0;
  const most = mostInOneSecond(without);
  return {
    samples: samples.length, paints: Math.max(0, shown.length - 1), paintsPerSecond: span > 0 ? Number(((shown.length - 1) / span).toFixed(1)) : 0,
    flashesOnScreen: onScreen.length, mostInOneSecond: mostInOneSecond(onScreen),
    flashesWithoutGuard: without.length, mostInOneSecondWithoutGuard: most, guardNeeded: most > 3,
  };
}

export type ShuttleVerdict =
  /** Safe on screen, the guard was needed and held frames back. */
  | 'ok'
  /** More than three flashes in a second of real time on the screen. */
  | 'unsafe'
  /** The guard was needed (more than three a second without it) and its counter says it held nothing. */
  | 'guard-idle'
  /** The measurement did not happen as set up: too few samples, not at 8x, or the preview did not flash. */
  | 'not-measured'
  /** Safe, but the editor painted too few frames for the guard to be needed before the deadline: nothing is shown about the guard. */
  | 'blocked';
export function judgeShuttle(m: ShuttleMeasure, held: number, shuttleShown: string): ShuttleVerdict {
  if (m.mostInOneSecond > 3) return 'unsafe';
  if (!(m.samples > 30) || !shuttleShown.includes('8')) return 'not-measured';
  if (!m.guardNeeded) return 'blocked';
  if (!(held > 0)) return 'guard-idle';
  if (m.flashesOnScreen < 3) return 'not-measured';
  return 'ok';
}

export interface ShuttleRun { verdict: ShuttleVerdict; shuttle: string; seconds: number; held: number; measure: ShuttleMeasure; samples: ShuttleSample[]; blockedByLoad?: string }
/**
 * In an editor page that shows `doc` paused: sample the preview on every animation frame, put the playhead at the start,
 * shuttle forwards at 8x (L four times), and stop (K) once the guard was needed and `minMs` have passed, or at `deadlineMs`,
 * or when the shuttle reaches the end of the timeline.
 */
export async function shuttleAt8(page: Page, doc: ProjectDocument, { minMs = 2500, deadlineMs = 30_000 }: { minMs?: number; deadlineMs?: number } = {}): Promise<ShuttleRun> {
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
  await page.keyboard.press('l');
  await page.waitForFunction(() => document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'true', undefined, { timeout: 10_000 });
  for (let i = 0; i < 3; i++) { await page.keyboard.press('l'); await sleep(60); }
  const shuttle = ((await page.getByTestId('shuttle').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
  const t0 = Date.now();
  const read = () => page.evaluate(() => (window as unknown as { __pfFlashSamples: ShuttleSample[] }).__pfFlashSamples.slice());
  for (;;) {
    await sleep(250);
    const elapsed = Date.now() - t0;
    if (elapsed >= deadlineMs) break;
    if (elapsed >= minMs && measureShuttle(await read(), doc).guardNeeded) break;
    if ((await page.getByTestId('play').getAttribute('data-playing')) !== 'true') break; // the end of the timeline
  }
  const held = Number(await page.locator('canvas[data-testid=preview]').getAttribute('data-flashes-held')); // before the stop: the frame it stops on passes the guard too
  await page.keyboard.press('k');
  const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  const samples = await read();
  const measure = measureShuttle(samples, doc);
  const verdict = judgeShuttle(measure, held, shuttle);
  return {
    verdict, shuttle, seconds, held, measure, samples,
    ...(verdict === 'blocked' ? { blockedByLoad: `blocked by load, not a pass: in ${seconds} s at 8x the editor painted ${measure.paintsPerSecond} frames a second, and the frames it showed would not have flashed more than three times a second without the guard either (${measure.mostInOneSecondWithoutGuard}); a preview needs more than six paints a second to show more than three flashes, so the guard had nothing to hold (it held ${held}). Run the proof on a quieter machine.` } : {}),
  };
}
