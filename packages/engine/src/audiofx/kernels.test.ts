/**
 * Contract suite of the sound-effect kernels (ADR-0010 plan section 9, W2 part) and the DSP measurements of plan section 4.
 * Every measurement is taken on the kernel itself (black box) through renderFx, the same harness the browser self-test runs.
 * Golden hashes: PF_UPDATE_GOLDEN=1 pnpm vitest run packages/engine/src/audiofx/kernels.test.ts rewrites golden.json
 * (only do that together with a version bump of every kernel whose output changed).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_EFFECTS, audioEffectParams, describeAudioCatalog, findAudioEffect, type AudioFxParams } from '@pulseframe/core';
import { kernelFor, WARM_EPS } from './index.ts';
import { FX_FIXTURE_SEED, FX_KERNELS, fxFixture, renderFx } from './kernels/index.ts';
import { highpass, msToSamples } from './design.ts';
import { Cascade } from './kernels/biquad.ts';
import { hash32, uniform } from './noise.ts';
import { carrierPhase, robotCarrier, robotDrive } from './kernels/robot.ts';
import { crackleAt } from './kernels/radio.ts';
import { holdLength } from './kernels/bitcrush.ts';
import { HORN_GAIN, HORN_MS } from './kernels/megaphone.ts';

const SR = 48000;
const RATES = [44100, 48000, 96000] as const;
const TYPES = AUDIO_EFFECTS.map((e) => e.id);
const P = (type: string, over: AudioFxParams = {}) => audioEffectParams(type, over);
/** Defaults, with the noise generators switched off (for measurements that need a clean signal). */
const quiet = (type: string, over: AudioFxParams = {}) => P(type, { ...(type === 'voice.telephone' ? { hiss: 0 } : type === 'voice.radio' ? { noise: 0 } : {}), ...over });
const kernel = (type: string) => kernelFor(type, findAudioEffect(type)!.version)!;
const reachOf = (type: string, p: AudioFxParams, sr = SR) => kernel(type).reach(p, sr);
const bytes = (x: Float32Array) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
const sameBytes = (a: Float32Array, b: Float32Array) => a.length === b.length && bytes(a).equals(bytes(b));

/** Deterministic test noise in [-amp, amp). */
function noise(frames: number, seed: number, amp: number): Float32Array {
  const x = new Float32Array(frames * 2);
  for (let i = 0; i < frames * 2; i++) x[i] = amp * (2 * uniform(hash32(seed, i, 9)) - 1);
  return x;
}
function sine(f: number, frames: number, amp: number, sr: number, right = 0): Float32Array {
  const x = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) { const v = amp * Math.sin((2 * Math.PI * f * i) / sr); x[i * 2] = v; x[i * 2 + 1] = right ? amp * Math.sin((2 * Math.PI * f * i) / sr + right) : v; }
  return x;
}
/** Amplitude of the `f` component of one channel over [from, from + len) frames (Hann-windowed Goertzel; a sine of amplitude A gives A). */
function amp(x: Float32Array, ch: 0 | 1, f: number, sr: number, from: number, len: number): number {
  const w = (2 * Math.PI * f) / sr, coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1));
    const s0 = x[(from + i) * 2 + ch]! * h + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))) / (len * 0.5);
}
const db = (v: number) => 20 * Math.log10(v);
/** Small-signal response of a kernel at f, in dB (a steady sine after the kernel has settled). */
function responseDb(type: string, params: AudioFxParams, f: number, sr = SR, level = 1e-3): number {
  const settle = Math.max(reachOf(type, params, sr).warm + 64, Math.round(0.05 * sr));
  const len = Math.max(Math.round(0.2 * sr), Math.round((40 * sr) / f));
  const y = renderFx(type, params, sine(f, settle + len, level, sr), { sampleRate: sr });
  return db(amp(y, 0, f, sr, settle, len) / level);
}
/** Frequency in [lo, hi] where fn crosses `target` (fn monotonic there), by bisection in log frequency. */
function crossing(fn: (f: number) => number, target: number, lo: number, hi: number): number {
  const up = fn(hi) > fn(lo);
  for (let i = 0; i < 22; i++) {
    const mid = Math.sqrt(lo * hi);
    if ((fn(mid) > target) === up) hi = mid; else lo = mid;
  }
  return Math.sqrt(lo * hi);
}
const peakOf = (x: ArrayLike<number>) => { let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]!)); return p; };
/** Run a filter cascade (design.ts sections) over a signal, as the kernels do. */
const filtered = (sections: ReturnType<typeof highpass>[], x: ArrayLike<number>) => { const c = new Cascade(sections), y = new Float64Array(x.length); for (let i = 0; i < x.length; i++) y[i] = c.tick(x[i]!, 0); return y; };
const rms = (x: Float32Array, ch: 0 | 1, from: number, to: number) => { let e = 0; for (let i = from; i < to; i++) e += x[i * 2 + ch]! ** 2; return Math.sqrt(e / (to - from)); };
const corr = (x: Float32Array, from: number, to: number) => {
  let sl = 0, sr = 0, slr = 0;
  for (let i = from; i < to; i++) { const l = x[i * 2]!, r = x[i * 2 + 1]!; sl += l * l; sr += r * r; slr += l * r; }
  return slr / Math.sqrt(sl * sr);
};
/** T30 reverberation time from Schroeder's backward integral of one channel, fitted between −5 and −35 dB. */
function t30(h: Float64Array | Float32Array, sr: number): number {
  const e = new Float64Array(h.length + 1);
  for (let i = h.length - 1; i >= 0; i--) e[i] = e[i + 1]! + h[i]! * h[i]!;
  const level = (i: number) => 10 * Math.log10(e[i]! / e[0]!);
  let a = -1, b = -1;
  for (let i = 0; i < h.length; i++) { if (a < 0 && level(i) <= -5) a = i; if (level(i) <= -35) { b = i; break; } }
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = a; i <= b; i++) { const t = i / sr, y = level(i); sx += t; sy += y; sxx += t * t; sxy += t * y; n++; }
  return -60 / ((n * sxy - sx * sy) / (n * sxx - sx * sx));
}
/** Every combination of the extremes of a type's parameters (numbers: min and max; enums: every value; booleans: both). */
function corners(type: string): AudioFxParams[] {
  const schema = describeAudioCatalog().audioEffects.find((e) => e.id === type)!.paramsSchema as unknown as { properties: Record<string, { type?: string; minimum?: number; maximum?: number; enum?: string[] }> };
  let out: AudioFxParams[] = [{}];
  for (const [key, s] of Object.entries(schema.properties)) {
    const values: (number | string | boolean)[] = s.enum ?? (s.type === 'boolean' ? [false, true] : [s.minimum!, s.maximum!]);
    out = out.flatMap((p) => values.map((v) => ({ ...p, [key]: v })));
  }
  return out.map((p) => P(type, p));
}

describe('registry and kernels agree', () => {
  it('every registry effect has a kernel with its version and stage, and no kernel is unregistered', () => {
    for (const e of AUDIO_EFFECTS) {
      const k = kernelFor(e.id, e.version);
      expect(k, e.id).toBeDefined();
      expect(k!.stage).toBe(e.stage);
    }
    expect(FX_KERNELS.map((k) => k.type).sort()).toEqual([...TYPES].sort());
  });
  it.each(RATES)('reach is integral and non-negative, window stages have no tail, and no tail exceeds the registry maximum at any corner of the parameters (%i Hz)', (sr) => {
    for (const type of TYPES) for (const p of corners(type)) {
      const r = reachOf(type, p, sr);
      expect(Number.isInteger(r.warm) && Number.isInteger(r.tail) && r.warm >= 0 && r.tail >= 0, type).toBe(true);
      if (findAudioEffect(type)!.stage <= 3) expect(r.tail, type).toBe(0);
      expect(r.tail / sr, `${type} ${JSON.stringify(p)}`).toBeLessThanOrEqual(findAudioEffect(type)!.maxTailSeconds);
    }
  });
});

describe.each(TYPES)('kernel contract: %s', (type) => {
  const def = findAudioEffect(type)!;
  const defaults = P(type);
  it('block sizes 1, 7, 128, 1024 and random give identical output', () => {
    const x = fxFixture(SR);
    const ref = renderFx(type, defaults, x, { block: 1024 });
    for (const block of [1, 7, 128]) expect(sameBytes(renderFx(type, defaults, x, { block }), ref), `block ${block}`).toBe(true);
    expect(sameBytes(renderFx(type, defaults, x, { block: (b) => 1 + (hash32(77, b, 0) % 3000) }), ref), 'random blocks').toBe(true);
  });
  it('two random histories that agree on the last `warm` samples give outputs within 2^-22', () => {
    const { warm } = reachOf(type, defaults);
    const H = 2401, M = 2400, total = H + warm + M;
    const common = noise(total, 5, 0.25);
    const a = common.slice(), b = common.slice();
    a.set(noise(H, 6, 0.25)); b.set(noise(H, 7, 0.25));
    const ya = renderFx(type, defaults, a), yb = renderFx(type, defaults, b);
    let worst = 0;
    for (let i = (H + warm) * 2; i < total * 2; i++) worst = Math.max(worst, Math.abs(ya[i]! - yb[i]!));
    expect(worst).toBeLessThanOrEqual(2 ** -22);
    // and the histories did matter before that point (the test is not vacuous), for kernels with memory
    if (warm > 0) { let before = 0; for (let i = H * 2; i < (H + warm) * 2; i++) before = Math.max(before, Math.abs(ya[i]! - yb[i]!)); expect(before).toBeGreaterThan(0); }
  });
  it('an impulse has died away (below 2^-24) after the declared reach: warm for window stages, tail for ring stages', () => {
    const p = quiet(type);
    const r = reachOf(type, p);
    const reach = def.stage <= 3 ? r.warm : r.tail;
    const frames = reach + 4800, x = new Float32Array(frames * 2);
    x[0] = 1; x[1] = 1;
    const y = renderFx(type, p, x);
    let worst = 0;
    for (let i = reach + 1; i < frames; i++) worst = Math.max(worst, Math.abs(y[i * 2]!), Math.abs(y[i * 2 + 1]!));
    expect(worst).toBeLessThanOrEqual(2 ** -24);
  });
  it('zero latency: a click changes nothing before it and the output by more than 1e-3 at its sample', () => {
    const at = type === 'texture.8bit' ? 4800 : 4801; // the 8-bit hold takes a new sample on its grid only
    const base = fxFixture(SR).subarray(0, 9600 * 2).map((v) => v * 0.1);
    const clicked = base.slice();
    clicked[at * 2] = clicked[at * 2]! + 1; clicked[at * 2 + 1] = clicked[at * 2 + 1]! + 1;
    const y0 = renderFx(type, defaults, base), y1 = renderFx(type, defaults, clicked);
    for (let i = 0; i < at * 2; i++) if (y0[i] !== y1[i]) throw new Error(`output changed at frame ${i >> 1}, before the click at ${at}`);
    expect(Math.max(Math.abs(y1[at * 2]! - y0[at * 2]!), Math.abs(y1[at * 2 + 1]! - y0[at * 2 + 1]!))).toBeGreaterThan(1e-3);
  });
  it('identity parameters give output identical to the input', () => {
    const p = P(type, type === 'utility.width' ? { stereoWidth: 1 } : { amount: 0 });
    expect(def.isIdentity(p)).toBe(true);
    const x = fxFixture(SR);
    expect(sameBytes(renderFx(type, p, x), x)).toBe(true);
  });
  it('silence gives exact zeros (with the noise generators off; with them on, telephone and radio hiss)', () => {
    const x = new Float32Array(SR * 2);
    const y = renderFx(type, quiet(type), x);
    expect(y.every((v) => v === 0)).toBe(true);
    if (type === 'voice.telephone' || type === 'voice.radio') expect(renderFx(type, defaults, x).some((v) => v !== 0)).toBe(true);
  });
  it('extreme parameters give finite output within the declared maximum gain', () => {
    const x = noise(12000, 11, 1);
    for (let i = 0; i < 12000; i += 997) { x[i * 2] = 1; x[i * 2 + 1] = -1; }
    for (const p of corners(type)) {
      const y = renderFx(type, p, x);
      const bound = FX_KERNELS.find((k) => k.type === type)!.bound(p, SR);
      let peak = 0;
      for (const v of y) { if (!Number.isFinite(v)) throw new Error(`${type} ${JSON.stringify(p)}: not finite`); peak = Math.max(peak, Math.abs(v)); }
      expect(peak, JSON.stringify(p)).toBeLessThanOrEqual(bound * (1 + 1e-6) + 1e-6);
    }
  });
});

describe('the same effect at 44.1, 48 and 96 kHz', () => {
  const edges = (type: string, sr: number, lo: [number, number], hi: [number, number], ref = 1000) => {
    const p = quiet(type), r0 = responseDb(type, p, ref, sr), fn = (f: number) => responseDb(type, p, f, sr) - r0;
    return [crossing(fn, -3, lo[0], lo[1]), crossing(fn, -3, hi[0], hi[1])] as const;
  };
  it.each([['voice.telephone', [150, 600], [2000, 6000]], ['voice.radio', [100, 400], [2500, 9000]]] as const)('%s: band edges within 2 %% of the 48 kHz ones', (type, lo, hi) => {
    const at48 = edges(type, 48000, [...lo], [...hi]);
    for (const sr of [44100, 96000]) {
      const e = edges(type, sr, [...lo], [...hi]);
      expect(Math.abs(e[0] / at48[0] - 1), `${sr} low`).toBeLessThan(0.02);
      expect(Math.abs(e[1] / at48[1] - 1), `${sr} high`).toBeLessThan(0.02);
    }
  });
  it('megaphone: band edges within 2 % of the 48 kHz ones', () => {
    const at = (sr: number) => { const fn = (f: number) => megaphoneShapeDb(f, sr); return [crossing(fn, -3, 200, 1000), crossing(fn, -3, 2500, 8000)]; };
    const ref = at(48000);
    for (const sr of [44100, 96000]) { const e = at(sr); expect(Math.abs(e[0]! / ref[0]! - 1)).toBeLessThan(0.02); expect(Math.abs(e[1]! / ref[1]! - 1)).toBeLessThan(0.02); }
  });
  it('bass boost: 30 Hz and 2 kHz gains within 0.3 dB of the 48 kHz ones', () => {
    const p = P('tone.bassboost');
    const ref = [responseDb('tone.bassboost', p, 30), responseDb('tone.bassboost', p, 2000)];
    for (const sr of [44100, 96000]) { expect(Math.abs(responseDb('tone.bassboost', p, 30, sr) - ref[0]!)).toBeLessThan(0.3); expect(Math.abs(responseDb('tone.bassboost', p, 2000, sr) - ref[1]!)).toBeLessThan(0.3); }
  });
  it('echo and reverb: tails equal in seconds (echo within one sample per repeat, reverb within 1 %)', () => {
    for (const p of [P('space.echo'), P('space.echo', { delayMs: 333, repeats: 8 })]) {
      const t48 = reachOf('space.echo', p, 48000).tail / 48000;
      for (const sr of [44100, 96000]) expect(Math.abs(reachOf('space.echo', p, sr).tail / sr - t48)).toBeLessThanOrEqual((p.repeats as number) / sr);
    }
    for (const room of ['room', 'hall', 'cave', 'bathroom']) {
      const p = P('space.reverb', { room }), t48 = reachOf('space.reverb', p, 48000).tail / 48000;
      for (const sr of [44100, 96000]) expect(Math.abs(reachOf('space.reverb', p, sr).tail / sr / t48 - 1), `${room} ${sr}`).toBeLessThan(0.01);
    }
  });
  it('reverb: the same decay time (T30) at every rate, within 10 %', () => {
    for (const sr of RATES) expect(Math.abs(t30(reverbIr(P('space.reverb', { damping: 0, decaySeconds: 1.2 }), sr), sr) / 1.2 - 1), String(sr)).toBeLessThan(0.1);
  });
  it('robot: the carrier is pitchHz at every rate; 8-bit: the held rate is within 10 % of rateKhz', () => {
    for (const sr of RATES) {
      const len = sr, y = renderFx('voice.robot', P('voice.robot', { metal: 0 }), sine(1000, len, 1e-3, sr), { sampleRate: sr });
      expect(amp(y, 0, 1090, sr, 0, len) / amp(y, 0, 1000, sr, 0, len)).toBeGreaterThan(100);
      const k = holdLength(8, sr);
      expect(Math.abs(sr / k / 8000 - 1)).toBeLessThan(0.1);
    }
  });
});

/** Megaphone response with the known horn comb and the drive's small-signal gain divided out (the filter shape alone). */
function megaphoneShapeDb(f: number, sr = SR, params = P('voice.megaphone')): number {
  const k = 1 + 9 * (params.drive as number), D = msToSamples(HORN_MS, sr), w = (2 * Math.PI * f * D) / sr;
  const comb = Math.hypot(1 + HORN_GAIN * Math.cos(w), HORN_GAIN * Math.sin(w));
  return responseDb('voice.megaphone', params, f, sr) - db(Math.sqrt(k)) - db(comb);
}
/** Wet impulse response (left channel) of a reverb with amount 1: the output for a unit impulse minus the dry impulse. */
function reverbIr(p: AudioFxParams, sr = SR, channel: 0 | 1 = 0): Float64Array {
  const q = { ...p, amount: 1 };
  const frames = reachOf('space.reverb', q, sr).tail + 1000, x = new Float32Array(frames * 2);
  x[0] = 1; x[1] = 1;
  const y = renderFx('space.reverb', q, x, { sampleRate: sr });
  const h = new Float64Array(frames);
  for (let i = 0; i < frames; i++) h[i] = y[i * 2 + channel]! - x[i * 2 + channel]!;
  return h;
}

describe('DSP measurements (plan section 4)', () => {
  it('bass boost: 30 Hz within 1 dB of gainDb·2/3, 2 kHz at −gainDb/3 ±0.3 dB, never above full scale', () => {
    for (const gainDb of [3, 8, 15]) {
      const p = P('tone.bassboost', { gainDb });
      expect(Math.abs(responseDb('tone.bassboost', p, 30) - (gainDb * 2) / 3), `${gainDb} dB at 30 Hz`).toBeLessThan(1);
      expect(Math.abs(responseDb('tone.bassboost', p, 2000) + gainDb / 3), `${gainDb} dB at 2 kHz`).toBeLessThan(0.3);
    }
    const y = renderFx('tone.bassboost', P('tone.bassboost', { gainDb: 15, freqHz: 150 }), sine(50, SR, 1, SR));
    expect(peakOf(y)).toBeLessThan(1);
  });
  it('telephone: −3 dB at 300 ±30 Hz and 3400 ±100 Hz, at least 24 dB down at 100 Hz and 8 kHz', () => {
    const p = quiet('voice.telephone'), r0 = responseDb('voice.telephone', p, 1000), fn = (f: number) => responseDb('voice.telephone', p, f) - r0;
    expect(Math.abs(crossing(fn, -3, 150, 600) - 300)).toBeLessThan(30);
    expect(Math.abs(crossing(fn, -3, 2000, 6000) - 3400)).toBeLessThan(100);
    expect(fn(100)).toBeLessThan(-24);
    expect(fn(8000)).toBeLessThan(-24);
  });
  it('telephone: hiss RMS on silence within ±1.5 dB of −60 + 24·hiss dBFS, at any grit; the same seed gives the same hiss, another seed another', () => {
    const x = new Float32Array(2 * SR * 2);
    for (const grit of [0, 0.4, 1]) for (const hiss of [0.25, 0.5, 1]) {
      const y = renderFx('voice.telephone', P('voice.telephone', { grit, hiss }), x);
      expect(Math.abs(db(rms(y, 0, 4800, 2 * SR)) - (-60 + 24 * hiss)), `grit ${grit} hiss ${hiss}`).toBeLessThan(1.5);
    }
    const p = P('voice.telephone');
    expect(sameBytes(renderFx('voice.telephone', p, x, { seed: 1 }), renderFx('voice.telephone', p, x, { seed: 1 }))).toBe(true);
    expect(sameBytes(renderFx('voice.telephone', p, x, { seed: 1 }), renderFx('voice.telephone', p, x, { seed: 2 }))).toBe(false);
  });
  it('megaphone: band edges at 500 and 4000 Hz ±10 %, the 1.8 kHz peak +6 ±1 dB at low level, THD of 1 kHz at −6 dBFS at least 10 % at drive 0.6', () => {
    const fn = (f: number) => megaphoneShapeDb(f);
    expect(Math.abs(crossing(fn, -3, 200, 1000) / 500 - 1)).toBeLessThan(0.1);
    expect(Math.abs(crossing(fn, -3, 2500, 8000) / 4000 - 1)).toBeLessThan(0.1);
    expect(Math.abs(fn(1800) - 6)).toBeLessThan(1);
    const settle = 4800, len = SR / 2, y = renderFx('voice.megaphone', P('voice.megaphone', { drive: 0.6 }), sine(1000, settle + len, 0.5, SR));
    const h1 = amp(y, 0, 1000, SR, settle, len);
    let e = 0;
    for (let h = 2; h <= 10; h++) e += amp(y, 0, 1000 * h, SR, settle, len) ** 2;
    expect(Math.sqrt(e) / h1).toBeGreaterThanOrEqual(0.1);
  });
  it('radio: band edges at 200 and 5000 Hz ±10 %, level wobble ±0.5 dB (±0.1 dB) at 0.3 Hz', () => {
    const p = quiet('voice.radio'), r0 = responseDb('voice.radio', p, 1000), fn = (f: number) => responseDb('voice.radio', p, f) - r0;
    expect(Math.abs(crossing(fn, -3, 100, 400) / 200 - 1)).toBeLessThan(0.1);
    expect(Math.abs(crossing(fn, -3, 2500, 9000) / 5000 - 1)).toBeLessThan(0.1);
    // phase 0.25 of the wobble (its peak) at t = 10·sr/12, phase 0.5 (no change) at 10·sr/6, phase 0.75 (trough) at 10·sr/4
    const y = renderFx('voice.radio', p, sine(1000, 3 * SR, 1e-3, SR));
    const level = (t: number) => amp(y, 0, 1000, SR, t - 480, 960);
    const mid = level((10 * SR) / 6);
    expect(Math.abs(db(level((10 * SR) / 12) / mid) - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(db(level((10 * SR) / 4) / mid) + 0.5)).toBeLessThan(0.1);
  });
  it('radio: about 3 crackles a second, and a render that starts later has its crackle exactly where the whole render has it', () => {
    let n = 0;
    for (let t = 0; t < 10 * SR; t++) if (crackleAt(FX_FIXTURE_SEED, t, SR)) n++;
    expect(n).toBeGreaterThan(12);
    expect(n).toBeLessThan(55);
    const p = P('voice.radio', { noise: 1 }), frames = 3 * SR, x = new Float32Array(frames * 2);
    const full = renderFx('voice.radio', p, x);
    const { warm } = reachOf('voice.radio', p), from = SR + 12345, start = from - warm;
    const part = renderFx('voice.radio', p, x.subarray(start * 2), { at: start });
    let worst = 0;
    for (let i = from; i < frames; i++) worst = Math.max(worst, Math.abs(part[(i - start) * 2]! - full[i * 2]!));
    expect(worst).toBeLessThanOrEqual(2 ** -22);
    // each crackle stands out of the hiss
    const hissRms = rms(full, 0, 4800, frames);
    let checked = 0;
    for (let t = 4800; t < frames - 64 && checked < 5; t++) if (crackleAt(FX_FIXTURE_SEED, t, SR)) { expect(peakOf(full.subarray(t * 2, (t + 64) * 2))).toBeGreaterThan(3 * hissRms); checked++; }
    expect(checked).toBeGreaterThan(0);
  });
  it('robot: a 1 kHz sine gives 1000 ± pitch Hz with the 1000 Hz line at least 40 dB down (metal 0, amount 1)', () => {
    const p = P('voice.robot', { metal: 0, amount: 1 }), pitch = p.pitchHz as number;
    const y = renderFx('voice.robot', p, sine(1000, SR, 0.5, SR));
    const lo = amp(y, 0, 1000 - pitch, SR, 0, SR), hi = amp(y, 0, 1000 + pitch, SR, 0, SR), mid = amp(y, 0, 1000, SR, 0, SR);
    expect(Math.abs(db(lo / hi))).toBeLessThan(0.5);
    expect(db(Math.min(lo, hi) / mid)).toBeGreaterThan(40);
  });
  it('robot: the carrier phase equals the closed form ((pitchHz·(at+n)) mod sr)/sr, also far along the timeline and before zero', () => {
    for (const at of [0, 1_000_000_017, -4801]) {
      const p = P('voice.robot', { metal: 0, amount: 1, pitchHz: 137 }), x = new Float32Array(5000 * 2).fill(0.5);
      const y = renderFx('voice.robot', p, x, { at });
      for (let n = 0; n < 5000; n++) {
        const want = Math.fround(robotDrive(0.5 * robotCarrier(137, SR, at + n)));
        if (y[n * 2] !== want) throw new Error(`at ${at} n ${n}: ${y[n * 2]} ≠ ${want} (phase ${carrierPhase(137, SR, at + n)})`);
      }
    }
  });
  it('robot and 8-bit (finite memory): a render started `warm` samples early equals the whole render bit for bit', () => {
    for (const type of ['voice.robot', 'texture.8bit']) {
      const p = P(type), x = fxFixture(SR), full = renderFx(type, p, x);
      const { warm } = reachOf(type, p), from = 33333, start = from - warm;
      const part = renderFx(type, p, x.subarray(start * 2), { n0: start });
      expect(sameBytes(part.subarray((from - start) * 2), full.subarray(from * 2)), type).toBe(true);
    }
  });
  it('8-bit: at most 2^bits distinct values per channel, held in runs aligned to the timeline grid', () => {
    for (const [bits, rateKhz, at] of [[6, 8, 0], [3, 3, 7], [10, 24, 123457]] as const) {
      const p = P('texture.8bit', { bits, rateKhz }), k = holdLength(rateKhz, SR);
      const y = renderFx('texture.8bit', p, noise(SR, 3, 1.2), { at });
      for (const ch of [0, 1]) {
        const values = new Set<number>();
        for (let n = 0; n < SR; n++) values.add(y[n * 2 + ch]!);
        expect(values.size).toBeLessThanOrEqual(2 ** bits);
      }
      for (let n = 1; n < SR; n++) if ((at + n) % k !== 0 && y[n * 2] !== y[(n - 1) * 2]) throw new Error(`value changed inside a hold at ${n}`);
    }
  });
  it('echo: an impulse gives exactly R repeats at j·D with gain amount·feedback^j (tone 0); ping-pong alternates sides', () => {
    const p = P('space.echo', { amount: 0.5, delayMs: 120, repeats: 5, feedback: 0.6, tone: 0 });
    const D = msToSamples(120, SR), frames = 6 * D + 10, x = new Float32Array(frames * 2);
    x[0] = 1; x[1] = 1;
    const y = renderFx('space.echo', p, x);
    for (let n = 1; n < frames; n++) {
      const j = n / D, want = Number.isInteger(j) && j <= 5 ? 0.5 * 0.6 ** j : 0;
      expect(Math.abs(y[n * 2]! - want), `frame ${n}`).toBeLessThanOrEqual(1e-6);
    }
    const pp = renderFx('space.echo', { ...p, pingPong: true }, x);
    for (let j = 1; j <= 5; j++) {
      const want = 0.5 * 0.6 ** j, l = pp[j * D * 2]!, r = pp[j * D * 2 + 1]!;
      expect(Math.abs((j % 2 ? l : r) - want)).toBeLessThanOrEqual(1e-6);
      expect(j % 2 ? r : l).toBe(0);
    }
  });
  it('echo: tone darkens the repeats (less high-frequency energy), not the dry sound', () => {
    const x = noise(SR, 4, 0.5);
    const hf = (y: Float32Array) => { const wet = new Float64Array(SR); for (let n = 0; n < SR; n++) wet[n] = y[n * 2]! - x[n * 2]!; const v = filtered([highpass(4000, 0.7, SR)], wet); let e = 0; for (let n = 300 * 48; n < SR; n++) e += v[n]! ** 2; return e; };
    expect(hf(renderFx('space.echo', P('space.echo', { tone: 1 }), x))).toBeLessThan(hf(renderFx('space.echo', P('space.echo', { tone: 0 }), x)) * 0.5);
  });
  it('reverb: T30 within ±10 % of the set decay (damping 0) for every room', () => {
    for (const [room, decaySeconds] of [['room', 0.6], ['hall', 1.8], ['cave', 3], ['bathroom', 0.9], ['hall', 0.3]] as const) {
      const rt = t30(reverbIr(P('space.reverb', { room, decaySeconds, damping: 0 })), SR);
      expect(Math.abs(rt / decaySeconds - 1), `${room} ${decaySeconds}: ${rt}`).toBeLessThan(0.1);
    }
  });
  it('reverb: the high-frequency decay is shorter at damping 1 than at damping 0', () => {
    const hfRt = (damping: number) => t30(filtered([highpass(4000, 0.7, SR), highpass(4000, 0.7, SR)], reverbIr(P('space.reverb', { damping, decaySeconds: 2 }))), SR);
    const d0 = hfRt(0), d1 = hfRt(1);
    expect(d1).toBeLessThan(d0 * 0.8);
  });
  it('reverb: left and right tails are decorrelated (below 0.5) at spread 1 and identical at spread 0', () => {
    const p = P('space.reverb', { spread: 1 });
    const l = reverbIr(p, SR, 0), r = reverbIr(p, SR, 1), both = new Float32Array(l.length * 2);
    for (let i = 0; i < l.length; i++) { both[i * 2] = l[i]!; both[i * 2 + 1] = r[i]!; }
    expect(Math.abs(corr(both, 0.1 * SR, SR))).toBeLessThan(0.5);
    const m0 = reverbIr(P('space.reverb', { spread: 0 }), SR, 0), m1 = reverbIr(P('space.reverb', { spread: 0 }), SR, 1);
    expect(m0.every((v, i) => v === m1[i])).toBe(true);
  });
  it('reverb, at the extremes: the impulse response is below 2^-24 after `tail` and its sum after `warm` is below 2^-24 (the reach model of design.ts holds with room to spare)', () => {
    const cases: AudioFxParams[] = [{ room: 'cave', decaySeconds: 3, damping: 0, predelayMs: 100 }, { room: 'cave', decaySeconds: 0.2, damping: 0 }, { room: 'bathroom', decaySeconds: 0.2, damping: 1 }, { room: 'hall', decaySeconds: 3, damping: 1, spread: 0 }];
    for (const sr of [44100, 96000]) for (const c of cases) {
      const p = P('space.reverb', { ...c, amount: 1 }), { warm, tail } = reachOf('space.reverb', p, sr), frames = warm + 2000, x = new Float32Array(frames * 2);
      x[0] = 1; x[1] = 1;
      const y = renderFx('space.reverb', p, x, { sampleRate: sr });
      let sum = 0, peak = 0;
      for (let i = warm; i < frames; i++) sum += Math.max(Math.abs(y[i * 2]!), Math.abs(y[i * 2 + 1]!));
      for (let i = tail + 1; i < frames; i++) peak = Math.max(peak, Math.abs(y[i * 2]!), Math.abs(y[i * 2 + 1]!));
      expect(sum, `${sr} ${JSON.stringify(c)}`).toBeLessThan(WARM_EPS / 16);
      expect(peak, `${sr} ${JSON.stringify(c)}`).toBeLessThan(WARM_EPS / 16);
    }
  });
  it('echo and reverb: the two parts of a cut sum to the whole within 2/32768', () => {
    const x = noise(SR, 8, 0.5), cut = 19200;
    for (const type of ['space.echo', 'space.reverb']) {
      const a = x.slice(), b = x.slice();
      a.fill(0, cut * 2); b.fill(0, 0, cut * 2);
      const whole = renderFx(type, P(type), x), ya = renderFx(type, P(type), a), yb = renderFx(type, P(type), b);
      let worst = 0;
      for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(ya[i]! + yb[i]! - whole[i]!));
      expect(worst, type).toBeLessThanOrEqual(2 / 32768);
    }
  });
  it('width: 0 gives L === R exactly; the L/R correlation falls steadily as the width grows', () => {
    const x = fxFixture(SR).subarray(0, SR * 2);
    const y0 = renderFx('utility.width', P('utility.width', { stereoWidth: 0 }), x);
    for (let i = 0; i < SR; i++) if (y0[i * 2] !== y0[i * 2 + 1]) throw new Error(`L ≠ R at ${i}`);
    const c = [0, 0.5, 1.5, 2].map((w) => corr(renderFx('utility.width', P('utility.width', { stereoWidth: w }), x), 0, SR));
    c.splice(2, 0, corr(x, 0, SR));
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeLessThan(c[i - 1]!);
  });
});

describe('golden hashes (type@version on the fixed fixture)', () => {
  const VARIANTS: Record<string, AudioFxParams> = {
    'tone.bassboost': { gainDb: 15, freqHz: 150 },
    'voice.telephone': { grit: 1, hiss: 1 },
    'voice.megaphone': { drive: 1, amount: 0.7 },
    'voice.radio': { noise: 1 },
    'voice.robot': { pitchHz: 200, metal: 1 },
    'texture.8bit': { bits: 3, rateKhz: 3 },
    'space.echo': { pingPong: true, tone: 0.6, repeats: 8, delayMs: 120 },
    'space.reverb': { room: 'cave', decaySeconds: 3, damping: 1, spread: 0.3, predelayMs: 100, amount: 1 },
    'utility.width': { stereoWidth: 0 },
  };
  const file = path.join(import.meta.dirname, 'golden.json');
  it('every kernel output matches its recorded hash; a changed output needs a version bump', () => {
    const x = fxFixture(SR), got: Record<string, string> = {};
    for (const e of AUDIO_EFFECTS) {
      const h = createHash('sha256');
      h.update(bytes(renderFx(e.id, P(e.id), x)));
      h.update(bytes(renderFx(e.id, P(e.id, VARIANTS[e.id] ?? {}), x)));
      got[`${e.id}@${e.version}`] = h.digest('hex');
    }
    if (process.env.PF_UPDATE_GOLDEN === '1') fs.writeFileSync(file, JSON.stringify(got, null, 1) + '\n');
    const want = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    for (const [key, hash] of Object.entries(got)) expect(want[key], `${key}: no recorded hash (bump the version or record it with PF_UPDATE_GOLDEN=1)`).toBe(hash);
  });
});
