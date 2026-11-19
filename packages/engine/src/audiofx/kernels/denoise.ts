/**
 * cleanup.denoise «הפחתת רעש» (ADR-0013), stage 2: a spectral gate driven by a FIXED noise profile (core voiceClean.ts; measured
 * by measure_voice, voiceMeasure.ts). No AI model, no adaptation: steady noise only.
 *
 * STFT (fft.ts): N = stftSize(sr) (1024 at 44.1/48 kHz, 2048 at 88.2/96 kHz), hop H = N/4, periodic sqrt-Hann analysis and
 * synthesis windows, overlap-add scaled by 1/2. Frames sit on the TIMELINE grid: a frame starts where (ctx.at + n) % H === 0, so
 * the two parts of a split clip share one grid (ADR-0013). Stereo is packed into one complex transform (Z = L + iR) and one real,
 * symmetric gain per bin is applied to both channels.
 *
 *   P_k(t)  = (|Z_k|² + |Z_{N−k}|²)/4                   per-channel power (mean of L and R)
 *   P̄_k(t)  = mean of P over frames t−2..t+1 and bins k−1..k+1
 *   G_k(t)  = max(floor, sqrt(max(0, 1 − β·λ_k / P̄_k)))  λ_k from the profile and the clip speed, β = 2·10^(sensitivityDb/10),
 *                                                       floor = 10^(−reductionDb/20); every dB → linear in design.ts, at create
 *   G′      = max(G(t), 0.7·G(t−1), 0.49·G(t−2))       hold (finite memory)
 *   G″_k    = (G′_{k−1} + 2·G′_k + G′_{k+1})/4          3-tap smoothing across bins
 *   gain    = 1 − amount·(1 − G″)
 *
 * Finite memory, so warm (N − 1 + 4H) is exact; look-ahead N + H − 1 (26.6 ms at 48 kHz, ≤ 50 ms at every rate): process()
 * receives the input of clip-local [n0, n0 + frames) and writes the output of [n0 − ahead, n0 + frames − ahead) in place. Every
 * sum runs in a fixed order relative to the frame (never by ring slot), so the output does not depend on where the stream started
 * once `warm` samples of history are in. Measured on synthetic signals; nobody has listened to it yet.
 */
import type { FxContext, FxProcessor } from '../kernel.ts';
import { DENOISE_BOUND, DENOISE_HOLD1, DENOISE_HOLD2, denoiseDesign, denoiseFraming, DRY, fxParams, type BoundedKernel, type DenoiseDesign } from '../design.ts';
import { fftOf, type Fft } from '../fft.ts';

const TYPE = 'cleanup.denoise';

class DenoiseProcessor implements FxProcessor {
  private readonly n: number; private readonly hop: number; private readonly half: number; private readonly mask: number; private readonly ahead: number;
  private readonly fft: Fft;
  private readonly win: Float64Array; private readonly syn: Float64Array; private readonly noise: Float64Array;
  private readonly floor: number; private readonly amount: number;
  /** Input and overlap-add rings (2N, indexed by samples received, modulo 2N). */
  private readonly inL: Float64Array; private readonly inR: Float64Array; private readonly accL: Float64Array; private readonly accR: Float64Array;
  /** Spectrum of the newest frame and of the pending one (whose gain needs the newest frame's power). */
  private curRe: Float64Array; private curIm: Float64Array; private penRe: Float64Array; private penIm: Float64Array;
  /** Power of frames t−2, t−1, t, t+1 in ring slots (slot of frame t+1 = newest). */
  private readonly pow: Float64Array[];
  private slot = 3;
  /** Raw gains of the last two frames, and scratch rows. */
  private g1: Float64Array; private g2: Float64Array; private graw: Float64Array;
  private readonly sum: Float64Array; private readonly held: Float64Array; private readonly gain: Float64Array;
  private pos = 0;
  private untilFrame = -1;
  constructor(d: DenoiseDesign, private readonly at: number) {
    this.n = d.n; this.hop = d.hop; this.half = d.n / 2; this.mask = 2 * d.n - 1; this.ahead = d.ahead;
    this.fft = fftOf(d.n);
    this.win = d.window; this.syn = d.synth; this.noise = d.noise; this.floor = d.floor; this.amount = d.amount;
    const R = 2 * d.n, B = this.half + 1;
    this.inL = new Float64Array(R); this.inR = new Float64Array(R); this.accL = new Float64Array(R); this.accR = new Float64Array(R);
    this.curRe = new Float64Array(d.n); this.curIm = new Float64Array(d.n); this.penRe = new Float64Array(d.n); this.penIm = new Float64Array(d.n);
    this.pow = [new Float64Array(B), new Float64Array(B), new Float64Array(B), new Float64Array(B)];
    this.g1 = new Float64Array(B); this.g2 = new Float64Array(B); this.graw = new Float64Array(B);
    this.sum = new Float64Array(B); this.held = new Float64Array(B); this.gain = new Float64Array(B);
  }
  process(buf: Float32Array, frames: number, n0: number): void {
    if (this.untilFrame < 0) {
      // the first sample received is timeline t0; frames end where (t + 1) % H === 0
      const t0 = this.at + n0, H = this.hop;
      this.untilFrame = (((-(t0 + 1)) % H) + H) % H;
    }
    const inL = this.inL, inR = this.inR, accL = this.accL, accR = this.accR, mask = this.mask, ahead = this.ahead;
    let pos = this.pos, until = this.untilFrame;
    for (let i = 0, j = 0; i < frames; i++, j += 2) {
      inL[pos] = buf[j]!; inR[pos] = buf[j + 1]!;
      if (until === 0) { this.pos = pos; this.frame(); until = this.hop - 1; } else until--;
      const o = (pos - ahead) & mask;
      buf[j] = accL[o]!; buf[j + 1] = accR[o]!;
      accL[o] = 0; accR[o] = 0;
      pos = (pos + 1) & mask;
    }
    this.pos = pos; this.untilFrame = until;
  }
  /** The sample at `pos` ended a frame: transform it, then gain, synthesise and overlap-add the pending (previous) frame. */
  private frame(): void {
    const n = this.n, half = this.half, mask = this.mask, win = this.win;
    const re = this.curRe, im = this.curIm, inL = this.inL, inR = this.inR;
    const start = (this.pos - n + 1) & mask;
    for (let i = 0; i < n; i++) { const k = (start + i) & mask, w = win[i]!; re[i] = inL[k]! * w; im[i] = inR[k]! * w; }
    this.fft.forward(re, im);
    const slot = (this.slot + 1) & 3, P = this.pow[slot]!;
    P[0] = (re[0]! * re[0]! + im[0]! * im[0]!) * 0.5;
    P[half] = (re[half]! * re[half]! + im[half]! * im[half]!) * 0.5;
    for (let k = 1; k < half; k++) { const m = n - k; P[k] = (re[k]! * re[k]! + im[k]! * im[k]! + re[m]! * re[m]! + im[m]! * im[m]!) * 0.25; }
    this.slot = slot;
    // the pending frame t: power of t−2, t−1, t, t+1 summed oldest first
    const p0 = this.pow[(slot + 1) & 3]!, p1 = this.pow[(slot + 2) & 3]!, p2 = this.pow[(slot + 3) & 3]!, p3 = P;
    const S = this.sum;
    for (let k = 0; k <= half; k++) S[k] = p0[k]! + p1[k]! + p2[k]! + p3[k]!;
    const noise = this.noise, floor = this.floor, graw = this.graw, g1 = this.g1, g2 = this.g2, held = this.held;
    for (let k = 0; k <= half; k++) {
      // bins k−1..k+1, mirrored at DC and Nyquist (the power spectrum of a real pair is symmetric there)
      const a = S[k === 0 ? 1 : k - 1]!, c = S[k === half ? half - 1 : k + 1]!;
      const pbar = (a + S[k]! + c) * (1 / 12), lam = noise[k]!;
      let g = pbar > lam ? Math.sqrt(1 - lam / pbar) : 0;
      if (g < floor) g = floor;
      graw[k] = g;
      let h = g;
      const h1 = DENOISE_HOLD1 * g1[k]!, h2 = DENOISE_HOLD2 * g2[k]!;
      if (h1 > h) h = h1;
      if (h2 > h) h = h2;
      held[k] = h;
    }
    // rotate the raw gains: t−1 → t−2, t → t−1
    this.g2 = g1; this.g1 = graw; this.graw = g2;
    const G = this.gain, amount = this.amount;
    for (let k = 0; k <= half; k++) {
      const a = held[k === 0 ? 1 : k - 1]!, c = held[k === half ? half - 1 : k + 1]!;
      const s = 0.25 * a + 0.5 * held[k]! + 0.25 * c;
      G[k] = amount === 1 ? s : 1 - amount * (1 - s);
    }
    const pr = this.penRe, pi = this.penIm;
    pr[0] = pr[0]! * G[0]!; pi[0] = pi[0]! * G[0]!;
    pr[half] = pr[half]! * G[half]!; pi[half] = pi[half]! * G[half]!;
    for (let k = 1; k < half; k++) { const g = G[k]!, m = n - k; pr[k] = pr[k]! * g; pi[k] = pi[k]! * g; pr[m] = pr[m]! * g; pi[m] = pi[m]! * g; }
    this.fft.backward(pr, pi);
    const syn = this.syn, accL = this.accL, accR = this.accR, ps = (start - this.hop) & mask;
    for (let i = 0; i < n; i++) { const k = (ps + i) & mask, w = syn[i]!; accL[k] = accL[k]! + pr[i]! * w; accR[k] = accR[k]! + pi[i]! * w; }
    // the newest frame becomes the pending one
    this.penRe = re; this.penIm = im; this.curRe = pr; this.curIm = pi;
  }
}

export const denoise: BoundedKernel = {
  type: TYPE, version: 1, stage: 2,
  reach(p, sampleRate) {
    if (fxParams(TYPE, p).identity) return { warm: 0, tail: 0, ahead: 0 };
    const f = denoiseFraming(sampleRate);
    return { warm: f.warm, tail: 0, ahead: f.ahead };
  },
  bound: () => DENOISE_BOUND,
  create(p, ctx: FxContext): FxProcessor {
    const d = denoiseDesign(p, ctx.sampleRate, ctx.speed);
    if (d.identity) return DRY;
    return new DenoiseProcessor(d, ctx.at);
  },
};
