/**
 * space.reverb «הדהוד» (rooms חדר, אולם, מערה, מקלחת) (ADR-0010 plan section 4), stage 4 (space): linear, time-invariant.
 * The mid signal goes through a predelay, then four series all-pass diffusers (g = 0.6), into an 8-line feedback delay network
 * with a normalised Hadamard butterfly, per-line gains g_i = 10^(−3·len_i/(sr·decay)) and per-line one-pole damping.
 * 12 early reflections per room are read from the predelayed signal. Left and right come from orthogonal output taps; spread
 * scales the side signal of the wet sound. y = x + amount·wet. Reach comes from design.ts reverbDesign (decay at most 3 s).
 */
import type { AudioFxParams } from '@pulseframe/core';
import type { FxContext, FxProcessor } from '../kernel.ts';
import { DRY, fxParams, reverbDesign, type BoundedKernel } from '../design.ts';
import { DIFFUSER_GAIN, FDN_IN, type RoomId } from '../tables.ts';

const TYPE = 'space.reverb';
const S8 = 0.35355339059327373; // 1/√8: Hadamard normalisation and tap gains
function design(p: Readonly<AudioFxParams>, sampleRate: number) {
  const q = fxParams(TYPE, p);
  return { q, d: reverbDesign(q.str('room') as RoomId, q.num('decaySeconds'), q.num('predelayMs'), q.num('damping'), sampleRate) };
}

export const reverb: BoundedKernel = {
  type: TYPE, version: 1, stage: 4,
  reach(p, sampleRate) {
    const { q, d } = design(p, sampleRate);
    return q.identity ? { warm: 0, tail: 0 } : { warm: d.warm, tail: d.tail };
  },
  bound(p, sampleRate) {
    const { q, d } = design(p, sampleRate);
    let er = 0;
    for (let j = 0; j < d.erL.length; j++) er += Math.max(Math.abs(d.erL[j]!), Math.abs(d.erR[j]!));
    return 1 + q.num('amount') * (er + d.bound / (1 - d.rate));
  },
  create(p, ctx: FxContext): FxProcessor {
    const { q, d } = design(p, ctx.sampleRate);
    if (q.identity) return DRY;
    const amount = q.num('amount'), spread = q.num('spread');
    const pre = d.predelay, erTaps = d.erTaps, erL = d.erL, erR = d.erR, nEr = erTaps.length;
    let erMax = 0;
    for (const t of erTaps) erMax = Math.max(erMax, t);
    const inSize = pre + erMax + 1, inBuf = new Float64Array(inSize);
    let inPos = 0;
    const aps = Array.from(d.diffusers, (m) => new Float64Array(m)), apPos = new Int32Array(aps.length);
    const lines = Array.from(d.lines, (len) => new Float64Array(len)), pos = new Int32Array(8);
    const g = d.gains, a = d.damp, b = 1 - a, damp = new Float64Array(8), o = new Float64Array(8);
    const inG = Float64Array.from(FDN_IN, (s) => s * S8), outG = d.fdnGain * S8;
    return {
      process(buf, frames) {
        for (let i = 0, j = 0; i < frames; i++, j += 2) {
          const xl = buf[j]!, xr = buf[j + 1]!;
          inBuf[inPos] = (xl + xr) * 0.5;
          let rp = inPos - pre;
          if (rp < 0) rp += inSize;
          let el = 0, er = 0;
          for (let k = 0; k < nEr; k++) {
            let qq = rp - erTaps[k]!;
            if (qq < 0) qq += inSize;
            const v = inBuf[qq]!;
            el += erL[k]! * v; er += erR[k]! * v;
          }
          let x = inBuf[rp]!;
          inPos = inPos + 1 === inSize ? 0 : inPos + 1;
          for (let k = 0; k < aps.length; k++) {
            const ln = aps[k]!, pp = apPos[k]!, out = ln[pp]!;
            const v = x + DIFFUSER_GAIN * out;
            x = out - DIFFUSER_GAIN * v;
            ln[pp] = v < 1e-30 && v > -1e-30 ? 0 : v;
            apPos[k] = pp + 1 === ln.length ? 0 : pp + 1;
          }
          // the network: line outputs, the two output taps, damping and gain, the butterfly, the new line inputs
          for (let k = 0; k < 8; k++) o[k] = lines[k]![pos[k]!]!;
          const o0 = o[0]!, o1 = o[1]!, o2 = o[2]!, o3 = o[3]!, o4 = o[4]!, o5 = o[5]!, o6 = o[6]!, o7 = o[7]!;
          const fl = o0 - o1 + o2 - o3 + o4 - o5 + o6 - o7; // FDN_OUT_L
          const fr = o0 + o1 - o2 - o3 + o4 + o5 - o6 - o7; // FDN_OUT_R
          for (let k = 0; k < 8; k++) {
            let f = b * o[k]! + a * damp[k]!;
            if (f < 1e-30 && f > -1e-30) f = 0;
            damp[k] = f;
            o[k] = g[k]! * f;
          }
          const a0 = o[0]! + o[1]!, a1 = o[0]! - o[1]!, a2 = o[2]! + o[3]!, a3 = o[2]! - o[3]!, a4 = o[4]! + o[5]!, a5 = o[4]! - o[5]!, a6 = o[6]! + o[7]!, a7 = o[6]! - o[7]!;
          const c0 = a0 + a2, c2 = a0 - a2, c1 = a1 + a3, c3 = a1 - a3, c4 = a4 + a6, c6 = a4 - a6, c5 = a5 + a7, c7 = a5 - a7;
          o[0] = c0 + c4; o[4] = c0 - c4; o[1] = c1 + c5; o[5] = c1 - c5; o[2] = c2 + c6; o[6] = c2 - c6; o[3] = c3 + c7; o[7] = c3 - c7;
          for (let k = 0; k < 8; k++) {
            const ln = lines[k]!, pp = pos[k]!;
            const v = o[k]! * S8 + inG[k]! * x;
            ln[pp] = v < 1e-30 && v > -1e-30 ? 0 : v;
            pos[k] = pp + 1 === ln.length ? 0 : pp + 1;
          }
          const wl = el + outG * fl, wr = er + outG * fr;
          const mid = (wl + wr) * 0.5, side = (wl - wr) * 0.5 * spread;
          buf[j] = xl + amount * (mid + side);
          buf[j + 1] = xr + amount * (mid - side);
        }
      },
    };
  },
};
