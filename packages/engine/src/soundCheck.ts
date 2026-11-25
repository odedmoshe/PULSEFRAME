/**
 * Sound checks of an export (wave 7, track send; send-decisions C9): one pass over the WRITTEN 16-bit sound, in blocks of 0.1 s.
 *   clipped = a block holding at least 3 samples (counted over every channel) at −32768 or 32767; consecutive clipped blocks are
 *             one run;
 *   silence = consecutive blocks whose RMS (over every channel, relative to 32768) is under −60 dBFS, lasting at least 2 s.
 * Block k covers sample frames [⌊k·rate/10⌋, ⌊(k+1)·rate/10⌋): integer arithmetic, exact at every rate, no accumulated rounding.
 * The last block may be shorter; it is judged on its own samples. Positions are sample indices of the export; the server adds the
 * range's first sample, so findings are timeline times { value: sample, timescale: sampleRate }.
 *
 * The silence test is made without a logarithm: mean square < (10^(−60/20))² · 32768² ⇔ Σs² · 10^6 < N · 2^30 (N = samples
 * counted). Σs² is an integer below 2^53 for a 0.1 s block; the product is exact wherever it is near the threshold (Σs² ≈ N·1074,
 * so Σs²·10^6 < 2^53) and only loses digits far above it, where the answer cannot change.
 */
import { CHECK_LIMITS } from '@pulseframe/core';

export interface SoundRun { kind: 'silence' | 'clipped'; fromSample: number; toSample: number; measured: Record<string, number> }
export const SOUND_CHECK_BUILT = true;
const FULL = 32768;
const TWO30 = 2 ** 30;
const r1 = (x: number) => Number(x.toFixed(1));
/** the loudest block's RMS in dBFS; a run of pure digital zero says so instead (a number, never −Infinity, so it survives JSON) */
const loudest = (meanSquare: number): Record<string, number> => (meanSquare > 0 ? { loudestBlockRmsDbfs: r1(10 * Math.log10(meanSquare / (FULL * FULL))) } : { digitalSilence: 1 });

export class SoundCheck {
  private frame = 0; // frames pushed so far
  private block = 0; // index of the current block
  private blockStart = 0;
  private blockEnd: number;
  private ch = 0; // channel of the next sample
  private sumSq = 0; private full = 0; private peak = 0; private count = 0;
  private clip: { from: number; to: number; blocks: number; full: number; peak: number } | null = null;
  private quiet: { from: number; to: number; blocks: number; loudestMs: number } | null = null;
  private out: SoundRun[] = [];
  private done = false;
  constructor(readonly sampleRate: number, readonly channels: number) {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels <= 0) throw new RangeError('SoundCheck: a whole positive rate and channel count');
    this.blockEnd = this.edge(1);
  }
  /** first frame of block k (exact) */
  private edge(k: number): number { return Math.floor((k * this.sampleRate * CHECK_LIMITS.blockSeconds.num) / CHECK_LIMITS.blockSeconds.den); }
  /** Interleaved 16-bit samples, in order (a push may end in the middle of a frame or of a block). */
  push(samples: Int16Array): void {
    if (this.done) throw new Error('SoundCheck.push after runs()');
    const C = this.channels;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!;
      this.sumSq += s * s;
      if (s === 32767 || s === -32768) this.full++;
      const a = s < 0 ? -s : s;
      if (a > this.peak) this.peak = a;
      this.count++;
      if (++this.ch === C) { this.ch = 0; this.frame++; if (this.frame === this.blockEnd) this.closeBlock(); }
    }
  }
  private closeBlock() {
    const from = this.blockStart, to = this.frame, n = this.count;
    if (n > 0) {
      const clipped = this.full >= CHECK_LIMITS.clippedSamplesPerBlock;
      // −60 dBFS: (10^(−60/20))² = 10^−6; mean square / 32768² < 10^−6 ⇔ Σs²·10^6 < N·2^30
      const silent = this.sumSq * 1_000_000 < n * TWO30;
      if (clipped) {
        if (this.clip) { this.clip.to = to; this.clip.blocks++; this.clip.full += this.full; if (this.peak > this.clip.peak) this.clip.peak = this.peak; }
        else this.clip = { from, to, blocks: 1, full: this.full, peak: this.peak };
      } else this.endClip();
      if (silent) {
        const ms = this.sumSq / n;
        if (this.quiet) { this.quiet.to = to; this.quiet.blocks++; if (ms > this.quiet.loudestMs) this.quiet.loudestMs = ms; }
        else this.quiet = { from, to, blocks: 1, loudestMs: ms };
      } else this.endQuiet();
    }
    this.block++;
    this.blockStart = this.frame;
    this.blockEnd = this.edge(this.block + 1);
    this.sumSq = 0; this.full = 0; this.peak = 0; this.count = 0;
  }
  private endClip() {
    const c = this.clip;
    if (!c) return;
    this.out.push({ kind: 'clipped', fromSample: c.from, toSample: c.to, measured: { blocks: c.blocks, fullScaleSamples: c.full, peakSample: c.peak } });
    this.clip = null;
  }
  private endQuiet() {
    const q = this.quiet;
    if (!q) return;
    // at least 2 s: (to − from) / rate ≥ 2 ⇔ (to − from)·den ≥ num·rate
    const S = CHECK_LIMITS.silenceSeconds;
    if ((q.to - q.from) * S.den >= S.num * this.sampleRate) this.out.push({ kind: 'silence', fromSample: q.from, toSample: q.to, measured: { blocks: q.blocks, seconds: Number(((q.to - q.from) / this.sampleRate).toFixed(3)), ...loudest(q.loudestMs) } });
    this.quiet = null;
  }
  /** The runs found, in order of their start (the last, partial block is judged on its own samples). Call once, at the end. */
  runs(): SoundRun[] {
    if (!this.done) {
      if (this.count > 0) this.closeBlock();
      this.endClip();
      this.endQuiet();
      this.out.sort((a, b) => a.fromSample - b.fromSample || (a.kind < b.kind ? -1 : 1));
      this.done = true;
    }
    return this.out.map((r) => ({ ...r, measured: { ...r.measured } }));
  }
}
