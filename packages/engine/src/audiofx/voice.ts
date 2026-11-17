/**
 * The sound of one clip through its effects (ADR-0010, plan section 2): the one runtime every route uses.
 *
 *   x = time map of the playing-order source P (timemap.ts)
 *   w = window stages 1–3 over x, from windowStart
 *   r[i] = w[i]·vol(i)·fade(i)  for 0 ≤ i < length; 0 otherwise
 *   y = ring stages 4–6 over r, from ringStart, up to length + tail
 *   out[i] = y[i]·gain·duck(i)·(gl, gr)·cut(i)   for from ≤ i < end
 *
 * Seek rule (ADR-0010 D3): ringStart = max(0, from − warmRing), windowStart = ringStart − warmWindow. Window stages read real
 * source before the clip start (silence outside the file). Work is done in blocks of BLOCK frames laid out from the first frame
 * computed, and a block is computed only once all of its input is there, so the output never depends on how the input is pushed.
 *
 * Look-ahead (ADR-0010 D4, ADR-0013): A = aheadWindow, the summed look-ahead of the window stages. The time map runs A samples
 * ahead of the block (block slot f holds x[bs + f + A]); window kernel j is called with n0 = bs + S_j, S_j = its own look-ahead
 * plus that of every later window kernel, so the last one hands back w[bs .. bs + w). A block waits for the input of x up to
 * wHi − 1 + A, and the source is read up to A samples past the clip end. Net latency 0; with A = 0 nothing changes.
 */
import type { PlannedAudioClip, EnvPoint } from '../audio.ts';
import type { FxProcessor } from './kernel.ts';
import { kernelFor } from './registry.ts';
import { SourceTimeMap, timeMapOrigin } from './timemap.ts';

/**
 * Playing-order source the voice reads, at the decoder rate. Forward: P[k] = native[origin + k]; reversed: P[k] = native[origin - 1 - k]
 * (native = the file's samples counted from its own time zero; silence outside the file). Output i reads P at phase0 + i·step.
 */
export interface VoiceInput { origin: number; /** first and last (exclusive) k needed, from the warm-up start to the end; first may be negative */ first: number; last: number; reverse: boolean }
export interface ClipVoice {
  /** First clip-local output frame produced (the `from` it was opened with). */
  readonly from: number;
  /** Clip-local frame after the last one produced: min(to, length + tail). */
  readonly end: number;
  readonly input: VoiceInput;
  /** Next playing-order frames, starting at P[input.first], interleaved stereo (mono given as L = R). Returns the output now final, interleaved stereo, continuing from the last output: gain, duck, balance and the tail cut are already applied. */
  push(pcm: Float32Array): Float32Array;
  /** The source ended (frames not given count as silence): the rest of the output up to `end`. */
  finish(): Float32Array;
}

/** Frames per processing block. */
export const VOICE_BLOCK = 1024;
const EMPTY = new Float32Array(0);

/** Piecewise-linear envelope read at increasing clip-local samples, with exactly the arithmetic of mixClip (audio.ts). */
class EnvCursor {
  private i = 0;
  constructor(private env: EnvPoint[]) {}
  at(local: number): number {
    const e = this.env;
    while (this.i < e.length - 2 && local > e[this.i + 1]!.s) this.i++;
    const a = e[this.i]!, b = e[this.i + 1] ?? a;
    return b.s === a.s ? b.g : a.g + ((b.g - a.g) * Math.min(Math.max(local - a.s, 0), b.s - a.s)) / (b.s - a.s);
  }
}

/** Growable window of the playing-order input: holds P[base .. base + count). */
class InputWindow {
  buf = new Float32Array(0);
  head = 0; // frame offset in buf of P[base]
  count = 0;
  constructor(public base: number) {}
  private room(frames: number) {
    if ((this.head + this.count + frames) * 2 <= this.buf.length) return;
    const need = (this.count + frames) * 2;
    if (need <= this.buf.length && this.head > 0) { this.buf.copyWithin(0, this.head * 2, (this.head + this.count) * 2); this.head = 0; return; }
    const next = new Float32Array(Math.max(need, this.buf.length * 2, 8192));
    next.set(this.buf.subarray(this.head * 2, (this.head + this.count) * 2));
    this.buf = next;
    this.head = 0;
  }
  append(pcm: Float32Array, frames: number) {
    this.room(frames);
    this.buf.set(pcm.subarray(0, frames * 2), (this.head + this.count) * 2);
    this.count += frames;
  }
  /** Silence up to P index `k` (exclusive). */
  zeroUntil(k: number) {
    const n = k - (this.base + this.count);
    if (n <= 0) return;
    this.room(n);
    this.buf.fill(0, (this.head + this.count) * 2, (this.head + this.count + n) * 2);
    this.count += n;
  }
  /** Forget everything before P index `k`. */
  dropBefore(k: number) {
    const n = Math.min(this.count, k - this.base);
    if (n <= 0) return;
    this.head += n; this.base += n; this.count -= n;
  }
  /** P index of buf frame 0. */
  get srcFirst() { return this.base - this.head; }
  get end() { return this.base + this.count; }
}

/** `from`, `to`: clip-local output range; `from` may lie in the tail. Output for sample n does not depend on push sizes; it equals the full render bit-exactly when from <= voice.warmRing, else within 2^-17 of the clip's output peak. */
export function openClipVoice(clip: PlannedAudioClip, planRate: number, sourceRate: number, from: number, to: number): ClipVoice {
  const v = clip.voice;
  if (!v) throw new Error(`openClipVoice: clip ${clip.clipId} has no sound effects in the plan`);
  if (!Number.isInteger(from) || !(Number.isInteger(to) || to === Infinity)) throw new RangeError('openClipVoice: from and to are whole samples (to may be Infinity: up to the end of the tail)');
  const length = clip.length, E = length + v.tail;
  from = Math.max(0, from);
  const end = Math.max(from, Math.min(to, E));
  const ringStart = Math.max(0, from - v.warmRing);
  const windowStart = ringStart - v.warmWindow;
  const windowEnd = Math.min(end, length); // window stages are needed for i < windowEnd only: r is 0 from length on
  const needWindow = ringStart < windowEnd;
  const procStart = needWindow ? windowStart : ringStart;

  const A = v.aheadWindow, speed = v.speed.num / v.speed.den;
  const map = new SourceTimeMap(timeMapOrigin({ sourceIn: v.sourceIn, sourceEnd: v.sourceEnd, speed: v.speed, reverse: v.reverse, sourceRate, planRate }), procStart + A);
  const origin = map.map.origin;
  const first = needWindow ? map.firstInput(windowStart + A) : 0;
  const last = needWindow ? map.endInput(windowEnd - 1 + A) : first;
  const input: VoiceInput = { origin, first, last, reverse: v.reverse };

  const kernelOf = (fx: (typeof v.chain)[number]) => {
    const k = kernelFor(fx.type, fx.version);
    if (!k) throw new Error(`openClipVoice: no kernel for ${fx.type}@${fx.version}`);
    return k;
  };
  const make = (stageWindow: boolean): FxProcessor[] => v.chain.filter((fx) => (fx.stage <= 3) === stageWindow).map((fx) =>
    kernelOf(fx).create(fx.params, { sampleRate: planRate, at: clip.at, length, seed: fx.seed, speed }));
  const windowFx = make(true), ringFx = make(false);
  // n0 offset of window kernel j: its own look-ahead plus that of every later window kernel (S_j); S_0 must equal A
  const wchain = v.chain.filter((fx) => fx.stage <= 3);
  const aheads = wchain.map((fx) => kernelOf(fx).reach(fx.params, planRate, speed).ahead ?? 0);
  const offs = aheads.map((_, j) => aheads.slice(j).reduce((sum, a) => sum + a, 0));
  if ((offs[0] ?? 0) !== A) throw new Error(`openClipVoice: clip ${clip.clipId} was planned with ${A} samples of look-ahead, its kernels at ${planRate} Hz declare ${offs[0] ?? 0} (plan and voice rates differ?)`);
  const vol = clip.vol ? new EnvCursor(clip.vol) : null, fade = new EnvCursor(clip.fade), duck = new EnvCursor(clip.duck);
  const [gl, gr] = [Math.min(1, 1 - clip.pan), Math.min(1, 1 + clip.pan)]; // panGains (audio.ts)
  const gain = clip.gain;
  const cutFrom = v.cutFrom;
  const inWin = new InputWindow(first);
  const blk = new Float32Array(VOICE_BLOCK * 2);
  let next = procStart; // next frame to compute
  let finished = false;

  /** Compute whole blocks while their input is there (or, after finish, all of them); returns the output frames made. */
  const run = (all: boolean): Float32Array => {
    const parts: Float32Array[] = [];
    let total = 0;
    while (next < end) {
      const bs = next, be = Math.min(bs + VOICE_BLOCK, end);
      const wHi = needWindow ? Math.min(be, windowEnd) : bs;
      if (wHi > bs) {
        const need = map.endInput(wHi - 1 + A);
        if (inWin.end < need) { if (!all) break; inWin.zeroUntil(need); }
      } else if (!all) break; // a block of pure tail needs no input: it is made by finish()
      const n = be - bs;
      blk.fill(0, 0, n * 2);
      if (wHi > bs) {
        const w = wHi - bs;
        map.render(inWin.buf, inWin.srcFirst, blk, w);
        for (let j = 0; j < windowFx.length; j++) windowFx[j]!.process(blk, w, bs + offs[j]!);
        // × volume keys × fades: zero outside [0, length)
        for (let f = 0, i = bs; f < w; f++, i++) {
          if (i < 0 || i >= length) { blk[f * 2] = 0; blk[f * 2 + 1] = 0; continue; }
          const g = (vol ? vol.at(i) : 1) * fade.at(i);
          blk[f * 2] = blk[f * 2]! * g;
          blk[f * 2 + 1] = blk[f * 2 + 1]! * g;
        }
        inWin.dropBefore(wHi < windowEnd ? map.firstInput(wHi + A) : inWin.end);
      }
      const rs = Math.max(bs, ringStart);
      if (be > rs && ringFx.length) {
        const view = rs === bs ? blk : blk.subarray((rs - bs) * 2);
        for (const p of ringFx) p.process(view, be - rs, rs);
      }
      const os = Math.max(bs, from);
      if (be > os) {
        const out = new Float32Array((be - os) * 2);
        for (let f = 0, i = os; i < be; f++, i++) {
          let g = gain * duck.at(i);
          if (cutFrom !== undefined && i >= cutFrom) g = (g * (E - i)) / (E - cutFrom);
          const b = (i - bs) * 2;
          out[f * 2] = blk[b]! * g * gl;
          out[f * 2 + 1] = blk[b + 1]! * g * gr;
        }
        parts.push(out);
        total += be - os;
      }
      next = be;
    }
    if (parts.length === 0) return EMPTY;
    if (parts.length === 1) return parts[0]!;
    const out = new Float32Array(total * 2);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };

  return {
    from, end, input,
    push(pcm: Float32Array): Float32Array {
      if (finished) throw new Error('ClipVoice.push after finish');
      // frames beyond `last` are not needed and are ignored
      const frames = Math.max(0, Math.min(pcm.length >> 1, last - inWin.end));
      if (frames > 0) inWin.append(pcm, frames);
      return run(false);
    },
    finish(): Float32Array {
      if (finished) return EMPTY;
      finished = true;
      return run(true);
    },
  };
}

/** Copy the overlap of one decoded native piece (start = native index of its first frame, interleaved stereo) into a playing-order buffer that holds P[dstFirst ...]. */
export function fillPlayingOrder(dst: Float32Array, dstFirst: number, input: VoiceInput, piece: { start: number; data: Float32Array }): void {
  const D = dst.length >> 1, n = piece.data.length >> 1, o = input.origin, src = piece.data;
  if (!input.reverse) {
    // P[k] = native[o + k]
    const k0 = Math.max(dstFirst, piece.start - o), k1 = Math.min(dstFirst + D, piece.start + n - o);
    if (k1 <= k0) return;
    dst.set(src.subarray((o + k0 - piece.start) * 2, (o + k1 - piece.start) * 2), (k0 - dstFirst) * 2);
    return;
  }
  // P[k] = native[o − 1 − k]
  const k0 = Math.max(dstFirst, o - piece.start - n), k1 = Math.min(dstFirst + D, o - piece.start);
  for (let k = k0; k < k1; k++) {
    const j = (o - 1 - k - piece.start) * 2, d = (k - dstFirst) * 2;
    dst[d] = src[j]!;
    dst[d + 1] = src[j + 1]!;
  }
}
