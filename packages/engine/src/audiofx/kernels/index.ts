/**
 * Registers every wave-1 sound-effect kernel (ADR-0010) and holds the fixed test harness that the golden hashes, the browser
 * self-test (window.__pfFxRun) and the preview proof share, so Node and Chromium run exactly the same input through the same code.
 */
import { findAudioEffect, type AudioFxParams } from '@pulseframe/core';
import { kernelFor, registerKernel } from '../registry.ts';
import { hash32, uniform } from '../noise.ts';
import type { BoundedKernel } from '../design.ts';
import { bassboost } from './bassboost.ts';
import { telephone } from './telephone.ts';
import { megaphone } from './megaphone.ts';
import { radio } from './radio.ts';
import { robot } from './robot.ts';
import { bitcrush } from './bitcrush.ts';
import { echo } from './echo.ts';
import { reverb } from './reverb.ts';
import { width } from './width.ts';

/** The nine wave-1 kernels, in registry order. */
export const FX_KERNELS: readonly BoundedKernel[] = [bassboost, telephone, megaphone, radio, robot, bitcrush, echo, reverb, width];
for (const k of FX_KERNELS) registerKernel(k);

export const FX_FIXTURE_SECONDS = 3;
export const FX_FIXTURE_SEED = 0x5eed;
/** A sine from arithmetic only (a parabola refined once; about 0.1 % off a true sine), so the fixture is the same on any runtime. */
const fsin = (phase: number): number => {
  const x = (phase - Math.floor(phase)) * 2 - 1;
  const y = 4 * x * (1 - Math.abs(x));
  return 0.225 * (y * Math.abs(y) - y) + y;
};
/**
 * The fixed test signal (interleaved stereo, FX_FIXTURE_SECONDS long): 0–1.5 s a sweep 50 Hz → 15 kHz at 0.5 (right a quarter
 * cycle ahead of left), 1.5–2 s a seeded noise burst at ±0.4, 2–2.5 s a click train (0.9 left, 0.6 right, every 50 ms), then silence.
 */
export function fxFixture(sampleRate = 48000): Float32Array {
  const frames = Math.round(FX_FIXTURE_SECONDS * sampleRate), out = new Float32Array(frames * 2);
  const N = 1.5 * sampleRate, noiseEnd = 2 * sampleRate, clickEnd = 2.5 * sampleRate, every = Math.round(0.05 * sampleRate);
  for (let n = 0; n < frames; n++) {
    let l = 0, r = 0;
    if (n < N) {
      // instantaneous frequency 50 + 14950·(n/N)² Hz: phase in cycles, closed form
      const ph = (50 * n + (14950 / 3) * ((n * n * n) / (N * N))) / sampleRate;
      l = 0.5 * fsin(ph); r = 0.5 * fsin(ph + 0.25);
    } else if (n < noiseEnd) {
      l = 0.8 * (uniform(hash32(FX_FIXTURE_SEED, n, 0)) - 0.5); r = 0.8 * (uniform(hash32(FX_FIXTURE_SEED, n, 1)) - 0.5);
    } else if (n < clickEnd && (n - noiseEnd) % every === 0) { l = 0.9; r = 0.6; }
    out[n * 2] = l; out[n * 2 + 1] = r;
  }
  return out;
}

export interface RenderFxOptions { sampleRate?: number; /** timeline sample of the first frame */ at?: number; seed?: number; /** frames per process() call */ block?: number | ((i: number) => number); /** clip-local index of the first frame */ n0?: number }
/** Run one kernel (registry version) over a copy of `input` in blocks, as a voice would; returns the processed copy. */
export function renderFx(type: string, params: AudioFxParams, input: Float32Array, opts: RenderFxOptions = {}): Float32Array {
  const def = findAudioEffect(type);
  if (!def) throw new Error(`unknown audio effect ${type}`);
  const k = kernelFor(type, def.version);
  if (!k) throw new Error(`no kernel for ${type}@${def.version}`);
  const sampleRate = opts.sampleRate ?? 48000, frames = input.length >> 1, n0 = opts.n0 ?? 0;
  const proc = k.create(params, { sampleRate, at: opts.at ?? 0, length: frames, seed: opts.seed ?? FX_FIXTURE_SEED });
  const buf = input.slice();
  const block = opts.block ?? 1024;
  for (let i = 0, b = 0; i < frames; b++) {
    const n = Math.max(1, Math.min(frames - i, typeof block === 'number' ? block : block(b)));
    proc.process(buf.subarray(i * 2, (i + n) * 2), n, n0 + i);
    i += n;
  }
  return buf;
}
