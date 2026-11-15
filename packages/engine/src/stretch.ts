/**
 * Time-stretch that keeps the pitch (SPEC §14, clip speed with "keep pitch"): the sound is played `speed` times as fast
 * without the pitch rising or falling with it. Waveform-similarity overlap-add (WSOLA): short windows of the source are
 * laid down at a fixed spacing in the output while they are taken from the source `speed` times as far apart, each one
 * shifted by up to ±12 ms to where it best continues the previous window, so the waveform stays in phase.
 *
 * Pure and deterministic. It works as a stream (bounded memory) and gives the same output whatever sizes the input
 * arrives in, so the server export, the browser export and the preview can share it. Interleaved stereo float in and out.
 *
 * Limits: one method for all material (no transient detection), so strong slow-downs smear drum hits and strong
 * speed-ups can drop short sounds; it is intended for speech and music between about 0.5× and 2×.
 */
export class PitchStretcher {
  private readonly n: number;      // window length (even)
  private readonly hop: number;    // output spacing of windows = n / 2
  private readonly reach: number;  // search range in frames
  private readonly win: Float32Array;
  private input = new Float32Array(0); // interleaved stereo, starting at absolute source frame `base`
  private base = 0;
  private have = 0;                // source frames received so far (absolute end)
  private k = 0;                   // next window index
  private prev = 0;                // source position of the previous window
  private tail: Float32Array;      // second half of the previous window, already windowed (interleaved)
  private ended = false;

  constructor(readonly speed: number, sampleRate: number) {
    if (!(speed > 0) || !Number.isFinite(speed)) throw new Error('speed must be positive');
    this.n = 2 * Math.round(0.02 * sampleRate);
    this.hop = this.n / 2;
    this.reach = Math.round(0.012 * sampleRate);
    this.win = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / this.n); // halves sum to exactly 1
    this.tail = new Float32Array(this.hop * 2);
  }

  /** Feed more source (interleaved stereo). Returns the output that is now final (interleaved stereo, possibly empty). */
  push(chunk: Float32Array): Float32Array {
    if (chunk.length) {
      const merged = new Float32Array(this.input.length + chunk.length);
      merged.set(this.input);
      merged.set(chunk, this.input.length);
      this.input = merged;
      this.have += chunk.length >> 1;
    }
    return this.run();
  }
  /** The source has ended: the rest is treated as silence. Returns the remaining output for the source received. */
  finish(): Float32Array {
    this.ended = true;
    return this.run();
  }

  private at(frame: number, ch: number): number {
    const i = (frame - this.base) * 2 + ch;
    return i >= 0 && i < this.input.length ? this.input[i]! : 0; // before the start and after the end: silence
  }
  private run(): Float32Array {
    const { n, hop, reach } = this;
    const out: Float32Array[] = [];
    for (;;) {
      const ideal = Math.round(this.k * hop * this.speed);
      // Everything a window might read must have arrived (or the source must be over).
      const need = Math.max(ideal + reach + n, this.prev + hop + n);
      if (!this.ended && this.have < need) break;
      if (this.ended && ideal >= this.have) break; // nothing of the source is left under this window
      let pos = ideal;
      if (this.k > 0) {
        // The natural continuation of the previous window starts at prev + hop. Choose the shift whose first half is most like it.
        const want = this.prev + hop;
        let best = -Infinity;
        const lo = Math.max(0, ideal - reach), hi = ideal + reach;
        // coarse search on every second frame and lag, then the neighbours of the best coarse lag
        const score = (cand: number) => {
          let s = 0, e = 0;
          for (let i = 0; i < hop; i += 2) {
            const a = this.at(want + i, 0) + this.at(want + i, 1), b = this.at(cand + i, 0) + this.at(cand + i, 1);
            s += a * b; e += b * b;
          }
          return s / Math.sqrt(e + 1e-9); // normalised by the candidate's level, so loud passages do not win by level alone
        };
        for (let cand = lo; cand <= hi; cand += 2) { const v = score(cand); if (v > best) { best = v; pos = cand; } }
        for (const cand of [pos - 1, pos + 1]) if (cand >= lo && cand <= hi) { const v = score(cand); if (v > best) { best = v; pos = cand; } }
      }
      // First half of this window overlaps the stored second half of the previous one; that sum is final output.
      const block = new Float32Array(hop * 2);
      for (let i = 0; i < hop; i++) {
        const w = this.k === 0 ? 1 : this.win[i]!; // the very first window starts at full level: no fade-in at the start of a clip
        block[i * 2] = this.tail[i * 2]! + w * this.at(pos + i, 0);
        block[i * 2 + 1] = this.tail[i * 2 + 1]! + w * this.at(pos + i, 1);
      }
      for (let i = 0; i < hop; i++) {
        const w = this.win[hop + i]!;
        this.tail[i * 2] = w * this.at(pos + hop + i, 0);
        this.tail[i * 2 + 1] = w * this.at(pos + hop + i, 1);
      }
      out.push(block);
      this.prev = pos;
      this.k++;
      // Source before anything a later window can read is no longer needed.
      const keepFrom = Math.max(this.base, Math.min(Math.round(this.k * hop * this.speed) - reach, this.prev + hop));
      if (keepFrom - this.base > 1 << 15) { this.input = this.input.slice((keepFrom - this.base) * 2); this.base = keepFrom; }
    }
    if (out.length === 0) return new Float32Array(0);
    const joined = new Float32Array(out.length * hop * 2);
    out.forEach((b, i) => joined.set(b, i * hop * 2));
    return joined;
  }
}

/** Stretch a whole piece of sound at once: `frames` output frames (padded with silence or cut to that length). */
export function stretchKeepingPitch(source: Float32Array, speed: number, sampleRate: number, frames: number): Float32Array {
  const s = new PitchStretcher(speed, sampleRate);
  const a = s.push(source), b = s.finish();
  const out = new Float32Array(frames * 2);
  out.set(a.subarray(0, Math.min(a.length, out.length)));
  if (a.length < out.length) out.set(b.subarray(0, Math.min(b.length, out.length - a.length)), a.length);
  return out;
}

/** Source frames played in the first `n` output frames of a ramped clip of `total` output frames: v0·n + (v1 − v0)·n²/(2·total). */
export const rampSourceFrames = (v0: number, v1: number, total: number, n: number): number => v0 * n + ((v1 - v0) * n * n) / (2 * total);

/**
 * Variable-rate resampler for a clip whose speed changes evenly from `v0` to `v1` over `total` output frames (a continuous
 * speed ramp): output frame n is the source at position rampSourceFrames(n), read with a four-point cubic. The pitch glides
 * with the speed, as with a constant speed change. Same stream interface as PitchStretcher (interleaved stereo in and out),
 * and the same output whatever sizes the input arrives in.
 * `startFrame`: the first output frame wanted; the source given must then begin at source frame floor(position of that frame).
 * Limit: no low-pass filter before reading faster than normal, so speeds well above 1 can alias high frequencies.
 */
export class RampResampler {
  private input = new Float32Array(0);
  private base: number;   // absolute source frame of input[0]
  private have: number;   // absolute source frame after the last one received
  private n: number;      // next output frame
  private ended = false;
  constructor(readonly v0: number, readonly v1: number, readonly total: number, startFrame = 0) {
    this.n = startFrame;
    this.base = Math.floor(rampSourceFrames(v0, v1, total, startFrame));
    this.have = this.base;
  }
  /** Source frames needed in all for a clip read from its start (what a caller should feed before finish()). */
  static sourceFrames(v0: number, v1: number, total: number): number { return Math.ceil(rampSourceFrames(v0, v1, total, total)) + 3; }
  push(chunk: Float32Array): Float32Array {
    if (chunk.length) {
      const merged = new Float32Array(this.input.length + chunk.length);
      merged.set(this.input);
      merged.set(chunk, this.input.length);
      this.input = merged;
      this.have += chunk.length >> 1;
    }
    return this.run();
  }
  finish(): Float32Array { this.ended = true; return this.run(); }
  private at(frame: number, ch: number): number {
    const i = (frame - this.base) * 2 + ch;
    return i >= 0 && i < this.input.length ? this.input[i]! : 0;
  }
  private run(): Float32Array {
    const out: number[] = [];
    while (this.n < this.total) {
      const pos = rampSourceFrames(this.v0, this.v1, this.total, this.n);
      const i = Math.floor(pos), f = pos - i;
      if (!this.ended && i + 2 >= this.have) break; // the four points around this position have not all arrived
      for (let ch = 0; ch < 2; ch++) {
        const a = this.at(i - 1, ch), b = this.at(i, ch), c = this.at(i + 1, ch), d = this.at(i + 2, ch);
        // Catmull-Rom through b and c
        out.push(b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a))));
      }
      this.n++;
    }
    const keepFrom = Math.floor(rampSourceFrames(this.v0, this.v1, this.total, Math.min(this.n, this.total))) - 1;
    if (keepFrom - this.base > 1 << 15) { this.input = this.input.slice((keepFrom - this.base) * 2); this.base = keepFrom; }
    return Float32Array.from(out);
  }
}
