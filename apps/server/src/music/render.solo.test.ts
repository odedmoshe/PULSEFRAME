/**
 * The render seam of kit:check (RenderOptions.solo and RenderOptions.bus; packages/evals/src/kit-check.ts, laptop check L6).
 * - Absent, nothing changes: the goldens (music.golden.json, instruments.golden.json) are checked by music.determinism.test.ts and
 *   sampler.test.ts; here a render with `bus` given has the same bytes as one without.
 * - The master's input before the clamp is linear in the notes: the bus of a full render equals the sum of the buses of solo renders of
 *   a partition of its parts (to float rounding), synthesised and sampled. The calm style's pitched voices draw nothing from the shared
 *   noise generator, so each kit part can be its own group; the rest (bass, drums) is one group.
 * - The finished samples are NOT such a sum (the soft clip x − x³/3 and 16-bit rounding): the test measures how far they are apart
 *   and only bounds it, which is why kit:check works its gains out on the bus.
 * The bank is the in-memory SYNTHETIC TEST BANK of the sampler proof (sines and decays written by code; not any instrument).
 */
import { describe, expect, it } from 'vitest';
import { musicLayout } from '@pulseframe/core';
import { samplerTestBank } from '../../../../packages/evals/src/instruments-proof.sampler.ts';
import { arrange } from './arrange.ts';
import { compose } from './compose.ts';
import { renderMusic, type RenderOptions } from './render.ts';
import { styleSpec } from './styles.ts';
import { readWavSamples } from './wav.ts';

const STYLE = 'music.calm', BARS = 4, SEED = 1;
async function busOf(opts: RenderOptions): Promise<{ L: Float64Array; R: Float64Array; wav: Buffer }> {
  const frames = musicLayout(STYLE, BARS).totalFrames;
  const L = new Float64Array(frames), R = new Float64Array(frames);
  const r = await renderMusic(STYLE, BARS, SEED, { ...opts, bus: (n, l, rr) => { L[n] = l; R[n] = rr; } });
  return { L, R, wav: r.wav };
}
const partsOf = () => {
  const L = musicLayout(STYLE, BARS), spec = styleSpec(STYLE);
  return [...new Set(arrange(spec, L, compose(spec, L, SEED), SEED).map((n) => n.part))];
};

describe('RenderOptions.solo and .bus (kit:check only)', () => {
  it('a bus callback does not change the bytes', async () => {
    const a = await renderMusic(STYLE, BARS, SEED);
    const b = await busOf({});
    expect(b.wav.equals(a.wav)).toBe(true);
    const bank = samplerTestBank();
    expect((await busOf({ bank })).wav.equals((await renderMusic(STYLE, BARS, SEED, { bank: samplerTestBank() })).wav)).toBe(true);
  }, 120_000);
  it.each([['synthesised', false], ['sampled', true]] as const)('%s: the full bus is the sum of the solo buses of pad, double, arp, lead and the rest', async (_n, sampled) => {
    const kitParts = ['pad', 'double', 'arp', 'lead'];
    const rest = partsOf().filter((p) => !kitParts.includes(p));
    expect(rest.length).toBeGreaterThan(0);
    const opt = (): RenderOptions => (sampled ? { bank: samplerTestBank() } : {});
    const full = await busOf(opt());
    const sumL = new Float64Array(full.L.length), sumR = new Float64Array(full.R.length);
    let pcmSum: Int32Array | null = null;
    for (const group of [...kitParts.map((p) => [p]), rest]) {
      const s = await busOf({ ...opt(), solo: group });
      let e = 0;
      for (let i = 0; i < s.L.length; i++) { sumL[i]! += s.L[i]!; sumR[i]! += s.R[i]!; e += Math.abs(s.L[i]!); }
      expect(e, `${group.join('+')} sounds`).toBeGreaterThan(0);
      const pcm = readWavSamples(s.wav);
      if (!pcmSum) pcmSum = new Int32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) pcmSum[i]! += pcm[i]!;
    }
    let worst = 0, scale = 0;
    for (let i = 0; i < full.L.length; i++) { worst = Math.max(worst, Math.abs(full.L[i]! - sumL[i]!), Math.abs(full.R[i]! - sumR[i]!)); scale = Math.max(scale, Math.abs(full.L[i]!)); }
    expect(scale).toBeGreaterThan(0.01);
    expect(worst).toBeLessThan(1e-9);
    // the finished samples are not the sum (soft clip, rounding): measured, bounded, never equal
    const pcm = readWavSamples(full.wav);
    let diff = 0;
    for (let i = 0; i < pcm.length; i++) diff = Math.max(diff, Math.abs(pcm[i]! - pcmSum![i]!));
    expect(diff).toBeGreaterThan(0);
  }, 120_000);
});
