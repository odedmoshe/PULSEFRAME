/**
 * Tap calibration (ADR-0025, plan 4.1): 16 clicks at 100 BPM, the person taps along (any pad key, Space or a pointer), the first
 * four are dropped, the median offset (tap time minus the time the click is heard) of the rest is stored; a run whose median
 * absolute deviation exceeds 40 ms is rejected. The offset is what the capture subtracts from a tap. Pure statistics here (tested on
 * synthetic taps) plus the click scheduling on a context. What this does NOT establish: the true latency by ear or eye, or a
 * hardware adapter's; nothing is ever called "in sync" (perform.notCalibrated until a calibration is stored).
 */
import { CALIBRATION } from './contract.ts';

export const median = (xs: readonly number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
/** Median absolute deviation from the median. */
export const mad = (xs: readonly number[]): number => { const m = median(xs); return median(xs.map((x) => Math.abs(x - m))); };

/** Click times, ms, from `startMs` at `bpm`. */
export const clickTimesMs = (startMs: number, clicks: number = CALIBRATION.clicks, bpm: number = CALIBRATION.bpm): number[] =>
  Array.from({ length: clicks }, (_, i) => startMs + (i * 60000) / bpm);

export type CalibrationFailure = 'too_few' | 'unsteady';
export type CalibrationResult =
  | { ok: true; offsetMs: number; madMs: number; used: number }
  | { ok: false; reason: CalibrationFailure; madMs: number; used: number };
/** At least this many of the 12 counted clicks need a tap. */
export const MIN_COUNTED_TAPS = 8;

/**
 * `clicks` and `taps` in one timebase (ms): when each click was HEARD and when each tap's event happened. A tap belongs to the
 * nearest click if it is within half a beat of it; a click keeps its nearest tap. Clicks 5 to 16 count (CALIBRATION.dropFirst).
 * offset = median(tap − click): positive when the person taps late (the capture subtracts it).
 */
export function analyseCalibration(clicks: readonly number[], taps: readonly number[], maxMadMs: number = CALIBRATION.maxMadMs): CalibrationResult {
  const half = (60000 / CALIBRATION.bpm) / 2;
  const best = new Map<number, number>(); // click index -> tap − click with the smallest magnitude
  for (const t of taps) {
    let ci = -1, d = Infinity;
    clicks.forEach((c, i) => { const x = Math.abs(t - c); if (x < d) { d = x; ci = i; } });
    if (ci < 0 || d > half) continue;
    const off = t - clicks[ci]!;
    const have = best.get(ci);
    if (have === undefined || Math.abs(off) < Math.abs(have)) best.set(ci, off);
  }
  const offsets = [...best.entries()].filter(([i]) => i >= CALIBRATION.dropFirst).map(([, o]) => o);
  if (offsets.length < MIN_COUNTED_TAPS) return { ok: false, reason: 'too_few', madMs: offsets.length ? mad(offsets) : 0, used: offsets.length };
  const madMs = mad(offsets);
  if (madMs > maxMadMs) return { ok: false, reason: 'unsteady', madMs, used: offsets.length };
  return { ok: true, offsetMs: median(offsets), madMs, used: offsets.length };
}

/** The part of an AudioContext this file touches (a stand-in implements it in tests). */
export interface ClickContext {
  currentTime: number; outputLatency?: number; baseLatency?: number;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
  createOscillator(): { frequency: { value: number }; connect(n: unknown): unknown; start(when: number): void; stop(when: number): void };
  createGain(): { gain: { setValueAtTime(v: number, t: number): unknown; exponentialRampToValueAtTime(v: number, t: number): unknown }; connect(n: unknown): unknown };
  destination: unknown;
}
/** Schedules the clicks on the context's clock, `lead` seconds from now; returns their context times. */
export function scheduleClicks(ctx: ClickContext, lead = 0.8, clicks: number = CALIBRATION.clicks, bpm: number = CALIBRATION.bpm): number[] {
  const times = Array.from({ length: clicks }, (_, i) => ctx.currentTime + lead + (i * 60) / bpm);
  times.forEach((at, i) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = i % 4 === 0 ? 1200 : 880; // the bar's first click is higher
    g.gain.setValueAtTime(0.5, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(at); osc.stop(at + 0.08);
  });
  return times;
}
/** The `performance` time (ms) at which a context time is HEARD, by the same mapping the player uses for a tap (Player.timelineSecondsAt). */
export function heardPerfMs(ctx: ClickContext, ctxTime: number, nowPerfMs: number = performance.now()): number {
  const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
  if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0) return ts.performanceTime + (ctxTime - ts.contextTime) * 1000;
  return nowPerfMs + (ctxTime - (ctx.currentTime - (ctx.outputLatency || 0))) * 1000;
};
/** The context's output latency as the player's syncStats states it (outputLatency + baseLatency, ms): what the stored calibration is compared with. */
export const outputLatencyMs = (ctx: Pick<ClickContext, 'outputLatency' | 'baseLatency'>): number => +(((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000).toFixed(2);
