/**
 * voice.radio «רדיו» (ADR-0010 plan section 4), stage 3 (texture), exclusive voice, seeded.
 * Static first (mono, band-limited with the voice): hiss measuring noise·(−42 dBFS) RMS at the output, plus crackle about 3
 * times a second, each decided per sample by a hash threshold on (seed, timeline sample) and shaped by a 16-sample click.
 * Then the band 200–5000 Hz (4th-order Butterworth each side), the Padé drive with k = 3, and a slow level wobble at 0.3 Hz of
 * ±0.5 dB from the sine table with an integer timeline phase. Mixed with the dry sound by amount.
 * Everything random or periodic is keyed on the timeline sample, so any range of a render has the crackle where the whole has it.
 */
import type { AudioFxParams } from '@pulseframe/core';
import type { FxContext, FxProcessor } from '../kernel.ts';
import { amDepth, butterworth4, calibratedNoise, cascadeWarm, DRY, fxParams, type BoundedKernel } from '../design.ts';
import { gaussOf, hashBase, hashLane, uniform } from '../noise.ts';
import { CLICK, CLICK_LENGTH, sineAt } from '../tables.ts';
import { Cascade } from './biquad.ts';
import { makeDrive, pade } from './drive.ts';

const TYPE = 'voice.radio';
export const CRACKLES_PER_SECOND = 3;
/** Wobble: 3 steps of a phase that wraps at 10·sampleRate per sample = 0.3 Hz exactly. */
const AM_STEP = 3, AM_PERIOD_PER_SR = 10;
const AM_M = amDepth(0.5), AM_MAX = (1 + AM_M) / (1 - AM_M);
const DRIVE = makeDrive(3);
/** Crackle at timeline sample t (base = hashBase(seed, t)): its signed amplitude before the band filter, or 0. */
const crackle = (base: number, t: number, thr: number, level: number): number => {
  const h = hashLane(base, t, 4);
  if (h >= thr) return 0;
  return (h & 1 ? 1 : -1) * level * (0.15 + 0.35 * uniform(hashLane(base, t, 5)));
};
/** The threshold below which a 32-bit hash means "a crackle starts here": CRACKLES_PER_SECOND on average. */
export const crackleThreshold = (sampleRate: number): number => Math.round((CRACKLES_PER_SECOND / sampleRate) * 4294967296);
/** Whether a crackle starts at timeline sample t (for tests and proofs: the same decision the kernel makes). */
export const crackleAt = (seed: number, t: number, sampleRate: number): boolean => hashLane(hashBase(seed, t), t, 4) < crackleThreshold(sampleRate);

function design(p: Readonly<AudioFxParams>, sampleRate: number) {
  const q = fxParams(TYPE, p);
  const sections = [...butterworth4('high', 200, sampleRate), ...butterworth4('low', 5000, sampleRate)];
  const noise = q.num('noise');
  return { q, sections, noise, hissAmp: noise > 0 ? noise * calibratedNoise(-42, sections, DRIVE.lipschitz) : 0 };
}

export const radio: BoundedKernel = {
  type: TYPE, version: 1, stage: 3,
  reach(p, sampleRate) {
    const d = design(p, sampleRate);
    return { warm: d.q.identity ? 0 : cascadeWarm(d.sections, DRIVE.lipschitz * AM_MAX), tail: 0 };
  },
  bound: () => 1,
  create(p, ctx: FxContext): FxProcessor {
    const d = design(p, ctx.sampleRate);
    if (d.q.identity) return DRY;
    const f = new Cascade(d.sections), k = DRIVE.k, post = DRIVE.post;
    const seed = ctx.seed, at = ctx.at, hiss = d.hissAmp, level = d.noise, thr = crackleThreshold(ctx.sampleRate);
    const period = AM_PERIOD_PER_SR * ctx.sampleRate;
    const wet = d.q.num('amount'), dry = 1 - wet;
    // crackles that started at t − 15 … t, by t mod 16; `active` counts the nonzero ones
    const ring = new Float64Array(CLICK_LENGTH);
    let active = 0, nextT = Number.NaN;
    const put = (t: number, v: number) => { const s = t & (CLICK_LENGTH - 1); if (ring[s] !== 0) active--; ring[s] = v; if (v !== 0) active++; };
    return {
      process(buf, frames, n0) {
        const t0 = at + n0;
        if (level > 0 && t0 !== nextT) for (let j = CLICK_LENGTH - 1; j >= 1; j--) put(t0 - j, crackle(hashBase(seed, t0 - j), t0 - j, thr, level));
        nextT = t0 + frames;
        let ph = (((AM_STEP * t0) % period) + period) % period;
        for (let i = 0, j = 0; i < frames; i++, j += 2) {
          const t = t0 + i;
          let nz = 0;
          if (level > 0) {
            const b = hashBase(seed, t);
            put(t, crackle(b, t, thr, level));
            nz = gaussOf(b, t) * hiss;
            if (active > 0) for (let c = 0; c < CLICK_LENGTH; c++) nz += ring[(t - c) & (CLICK_LENGTH - 1)]! * CLICK[c]!;
          }
          const s = sineAt(ph / period);
          const g = (1 + AM_M * s) / (1 - AM_M * s);
          ph += AM_STEP;
          if (ph >= period) ph -= period;
          const xl = buf[j]!, xr = buf[j + 1]!;
          buf[j] = dry * xl + wet * pade(k * f.tick(xl + nz, 0)) * post * g;
          buf[j + 1] = dry * xr + wet * pade(k * f.tick(xr + nz, 1)) * post * g;
        }
      },
    };
  },
};
