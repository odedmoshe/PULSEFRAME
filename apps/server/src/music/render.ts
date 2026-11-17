/**
 * The synthesiser of built-in music (ADR-0022): the whole render path lives under apps/server/src/music/, so its source scan
 * (test M9) covers everything that makes a sample. music.ts only queues, validates, stores and commits.
 *
 * Rules (plan §4.4–4.6 with the verifier's corrections): 48 kHz stereo 16-bit PCM WAV written by this code; only + − × ÷,
 * Math.floor/round/abs/min/max/imul and typed arrays (a sine table from a polynomial, decays by multiplication, semitone ratios
 * as literals, mulberry32 for composition, xorshift32 for noise); no ffmpeg, clock, Math.random or crypto. Beat k at sample
 * k·samplesPerBeat; exactly layout.totalFrames frames; the form of musicLayout (core musicStyles.ts); the final chord on beat 1
 * of the last bar, nothing after it, the master multiplied by (1 − u)² over the last half bar, the last sample 0. Master:
 * clamp to [−1, 1], then x − x³/3, so the peak is at most 2/3. Denormals: a state below 1e-20 in magnitude is set to 0.
 * Yield to the event loop every beat or every 12,000 frames, whichever is shorter, and check `cancel` at each yield.
 *
 * CONTRACT FILE (lead pre-pass): the export and its signature are fixed; W3 writes the body (and the files beside it). Until
 * then it refuses: nothing is synthesised and nothing pretends to be.
 */
import type { MusicLayout } from '@pulseframe/core';

export interface RenderedMusic {
  /** The whole WAV file: 44-byte header + 4 · layout.totalFrames bytes. */
  wav: Buffer;
  layout: MusicLayout;
  /** largest |sample| / 32768 */ peak: number;
  /** RMS of both channels / 32768 */ rms: number;
  /** samples where the master clamp engaged (test: fewer than 0.1 %) */ clamped: number;
}
export interface RenderOptions {
  /** One click per beat (accented on bar starts) from the same scheduler, nothing else: the exact-onset test (M4). */
  clickOnly?: boolean;
  /** Checked at every yield; when it is true the render stops with MusicCancelled. */
  cancel?: { cancelled: boolean };
}
/** Thrown when a render is stopped through RenderOptions.cancel. */
export class MusicCancelled extends Error {
  constructor() { super('the music render was cancelled'); this.name = 'MusicCancelled'; }
}
/** Thrown while the synthesiser is not built. */
export class MusicNotBuilt extends Error {
  constructor() { super('built-in music is not built in this version yet: the synthesiser has no body'); this.name = 'MusicNotBuilt'; }
}
/**
 * Render `bars` bars of a style with a seed. Pure apart from yielding to the event loop. Rejects with RangeError for what
 * musicLayout refuses (unknown or rejected style, bars out of range).
 */
export async function renderMusic(_styleId: string, _bars: number, _seed: number, _opts: RenderOptions = {}): Promise<RenderedMusic> {
  throw new MusicNotBuilt();
}
