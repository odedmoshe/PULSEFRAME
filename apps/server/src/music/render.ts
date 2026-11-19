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
 * Files beside it: dsp.ts (arithmetic building blocks), voices.ts (instruments), styles.ts (recipes), compose.ts (chords and
 * the lead), arrange.ts (notes by level and the ending), wav.ts (the file).
 */
import { MUSIC_MAX_SEED, musicLayout, type MusicLayout } from '@pulseframe/core';
import { arrange, clicks } from './arrange.ts';
import { compose, hashId } from './compose.ts';
import { flush, Noise, Reverb, SR, sqrtOf } from './dsp.ts';
import { styleSpec } from './styles.ts';
import { renderNote } from './voices.ts';
import { allocWav, wavSampleWriter } from './wav.ts';

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
/** Kept for callers that still name it; the synthesiser is built, so nothing throws it any more. */
export class MusicNotBuilt extends Error {
  constructor() { super('built-in music is not built in this version yet: the synthesiser has no body'); this.name = 'MusicNotBuilt'; }
}
/** Rendering work (samples of notes) between two yields when no beat boundary comes first. */
const WORK_PER_YIELD = 120_000;
/** The longest a note may sound (8 s), and the ring buffers that hold every note still sounding: a power of two above it plus a block. */
const MAX_NOTE = 8 * SR;
const RING = 1 << 19, MASK = RING - 1;
const pause = async (cancel: RenderOptions['cancel']): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (cancel?.cancelled) throw new MusicCancelled();
};
/**
 * Render `bars` bars of a style with a seed. Pure apart from yielding to the event loop. Rejects with RangeError for what
 * musicLayout refuses (unknown or rejected style, bars out of range) and for a seed outside 0..MUSIC_MAX_SEED.
 */
export async function renderMusic(styleId: string, bars: number, seed: number, opts: RenderOptions = {}): Promise<RenderedMusic> {
  const layout = musicLayout(styleId, bars);
  if (!Number.isInteger(seed) || seed < 0 || seed > MUSIC_MAX_SEED) throw new RangeError(`a seed is a whole number from 0 to ${MUSIC_MAX_SEED}; got ${seed}`);
  if (opts.cancel?.cancelled) throw new MusicCancelled();
  const spec = styleSpec(layout.styleId);
  const notes = opts.clickOnly ? clicks(layout) : arrange(spec, layout, compose(spec, layout, seed), seed);
  notes.sort((a, b) => a.at - b.at); // stable: notes that start together keep the arranger's order
  const total = layout.totalFrames, S = layout.samplesPerBeat;
  const noise = new Noise((Math.imul(seed ^ 0x5bd1e995, 0x27d4eb2d) ^ hashId(layout.styleId)) >>> 0);
  const reverb = new Reverb(spec.mix.room, spec.mix.feedback, spec.mix.damp);
  // Streaming in blocks of one beat or 12,000 frames, whichever is shorter, with a yield after each: every note that starts
  // inside a block is rendered whole into ring buffers, after which the block itself is final (later notes start later), so
  // its reverb and master are worked out, written to the file, and its ring slots cleared. A note sounds at most MAX_NOTE.
  const step = Math.min(S, 12_000);
  const tmp = new Float64Array(Math.min(total, MAX_NOTE));
  const L = new Float64Array(RING), R = new Float64Array(RING), send = new Float64Array(RING);
  const wav = allocWav(total), put = wavSampleWriter(wav);
  const gain = spec.mix.gain, fadeFrom = total - 2 * S, fadeLen = total - fadeFrom;
  let x1L = 0, y1L = 0, x1R = 0, y1R = 0, clamped = 0, peak = 0, sum = 0;
  let ni = 0, work = 0;
  for (let from = 0; from < total; from += step) {
    const to = Math.min(total, from + step);
    for (; ni < notes.length && notes[ni]!.at < to; ni++) {
      const note = notes[ni]!;
      if (work > WORK_PER_YIELD) { await pause(opts.cancel); work = 0; }
      const room = Math.min(tmp.length, total - note.at);
      if (room <= 0) continue;
      const n = renderNote(note.voice, note.midi, note.vel, note.gate, noise, tmp.subarray(0, room));
      const gl = Math.min(1, 1 - note.pan), gr = Math.min(1, 1 + note.pan), gs = note.send;
      for (let i = 0, k = note.at; i < n; i++, k++) {
        const v = tmp[i]!, r = k & MASK;
        L[r] = L[r]! + v * gl;
        R[r] = R[r]! + v * gr;
        send[r] = send[r]! + v * gs;
      }
      work += n;
    }
    // the room: one reverb for the whole mix, fed by every note's send
    reverb.process(send, L, R, from, to, spec.mix.wet, MASK);
    // the master: a DC blocker, the style's gain, a clamp to [−1, 1] and the soft clip x − x³/3 (at most 2/3), the ending's
    // (1 − u)² over the last half bar (u reaches 1 on the last sample, so it is 0), then 16 bits without dither
    for (let n = from; n < to; n++) {
      const r = n & MASK;
      const xl = L[r]!, xr = R[r]!;
      L[r] = 0; R[r] = 0; send[r] = 0;
      y1L = flush(xl - x1L + 0.9995 * y1L); x1L = xl;
      y1R = flush(xr - x1R + 0.9995 * y1R); x1R = xr;
      let fade = 1;
      if (n >= fadeFrom) { const u = 1 - (n - fadeFrom + 1) / fadeLen; fade = u * u; }
      for (let ch = 0; ch < 2; ch++) {
        const g = (ch === 0 ? y1L : y1R) * gain;
        const c = g > 1 ? 1 : g < -1 ? -1 : g;
        if (c !== g) clamped++;
        const v = Math.round((c - (c * c * c) / 3) * fade * 32767);
        put(2 * n + ch, v);
        const a = Math.abs(v);
        if (a > peak) peak = a;
        sum += v * v;
      }
    }
    work = 0;
    await pause(opts.cancel);
  }
  return { wav, layout, peak: peak / 32768, rms: sqrtOf(sum / (2 * total)) / 32768, clamped };
}
