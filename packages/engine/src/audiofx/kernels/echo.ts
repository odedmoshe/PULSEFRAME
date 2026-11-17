/**
 * space.echo «הד» (ADR-0010 plan section 4), stage 4 (space): linear and time-invariant, so a cut clip's parts sum to the whole.
 * wet = Σ_{j=1..R} feedback^j · x[n − j·D], D = round(delayMs·sr/1000), R = repeats (a finite sum: exactly R repeats, no
 * recirculation). Ping-pong sends the odd repeats of the mid signal to the left and the even ones to the right. With tone > 0 a
 * one-pole low-pass darkens the wet sound. y = x + amount·wet. Tail = R·D (plus the low-pass ring when tone > 0).
 */
import type { AudioFxParams } from '@pulseframe/core';
import type { FxContext, FxProcessor } from '../kernel.ts';
import { DRY, echoToneHz, fxParams, msToSamples, onePoleCoef, onePoleWarm, type BoundedKernel } from '../design.ts';

const TYPE = 'space.echo';
function design(p: Readonly<AudioFxParams>, sampleRate: number) {
  const q = fxParams(TYPE, p);
  const D = Math.max(1, msToSamples(q.num('delayMs'), sampleRate)), R = Math.round(q.num('repeats')), fb = q.num('feedback'), tone = q.num('tone');
  const gains = new Float64Array(R + 1);
  let g = 1;
  for (let j = 1; j <= R; j++) { g *= fb; gains[j] = g; }
  const c = tone > 0 ? onePoleCoef(echoToneHz(tone), sampleRate) : 1;
  return { q, D, R, gains, c, reach: R * D + (c < 1 ? onePoleWarm(c) : 0) };
}

export const echo: BoundedKernel = {
  type: TYPE, version: 1, stage: 4,
  reach(p, sampleRate) {
    const d = design(p, sampleRate);
    return d.q.identity ? { warm: 0, tail: 0 } : { warm: d.reach, tail: d.reach };
  },
  bound(p, sampleRate) {
    const d = design(p, sampleRate);
    let s = 0;
    for (let j = 1; j <= d.R; j++) s += d.gains[j]!;
    return 1 + d.q.num('amount') * s;
  },
  create(p, ctx: FxContext): FxProcessor {
    const d = design(p, ctx.sampleRate);
    if (d.q.identity) return DRY;
    const { D, R, gains, c } = d, size = R * D + 1, hist = new Float32Array(size * 2);
    const pingPong = d.q.bool('pingPong'), amount = d.q.num('amount'), lowpass = c < 1;
    let pos = 0, lpl = 0, lpr = 0;
    return {
      process(buf, frames) {
        for (let i = 0, j = 0; i < frames; i++, j += 2) {
          const xl = buf[j]!, xr = buf[j + 1]!;
          hist[pos * 2] = xl; hist[pos * 2 + 1] = xr; // the input is Float32 already: stored exactly
          let wl = 0, wr = 0;
          for (let r = 1; r <= R; r++) {
            let q = pos - r * D;
            if (q < 0) q += size;
            const g = gains[r]!;
            if (pingPong) { const m = (hist[q * 2]! + hist[q * 2 + 1]!) * 0.5; if (r & 1) wl += g * m; else wr += g * m; }
            else { wl += g * hist[q * 2]!; wr += g * hist[q * 2 + 1]!; }
          }
          if (lowpass) {
            lpl += c * (wl - lpl); lpr += c * (wr - lpr);
            if (lpl < 1e-30 && lpl > -1e-30) lpl = 0;
            if (lpr < 1e-30 && lpr > -1e-30) lpr = 0;
            wl = lpl; wr = lpr;
          }
          pos = pos + 1 === size ? 0 : pos + 1;
          buf[j] = xl + amount * wl;
          buf[j + 1] = xr + amount * wr;
        }
      },
    };
  },
};
