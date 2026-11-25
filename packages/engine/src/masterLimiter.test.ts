/**
 * The master limiter's rules (send-decisions C11), each with a test that fails when the rule is broken:
 *  1. no output sample passes limiterCeilingLinear(ceiling) (property test over random signals, ceilings, rates and block sizes);
 *  2. output samples more than lookahead + release after the last limited sample equal the delayed input bit for bit;
 *  3. the block size changes nothing; a stream started later (a range export) equals the full stream 125 ms after its start;
 *  4. the public worklet file (apps/web/public/pf-master-limiter.js), run here with stand-ins for the AudioWorklet globals, gives
 *     the same bits as the kernel (the same check runs in Chromium in proof:send L6).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { limiterCeilingLinear, limiterFixture, limiterRun, limiterWindow, MasterLimiter } from './masterLimiter.ts';

/** a small seeded generator for the property tests */
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const sha = (x: Float32Array) => createHash('sha256').update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)).digest('hex');

/** Random stereo: quiet noise with loud bursts of random length, level and position. */
function randomSignal(r: () => number, n: number) {
  const left = new Float32Array(n), right = new Float32Array(n);
  let level = 0.1;
  for (let i = 0; i < n; i++) {
    if (r() < 0.002) level = r() < 0.5 ? r() * 0.3 : 0.5 + r() * 4;
    left[i] = (r() - 0.5) * 2 * level;
    right[i] = (r() - 0.5) * 2 * level * (r() < 0.01 ? 3 : 1);
  }
  return { left, right };
}

describe('master limiter kernel', () => {
  it('property: no output sample exceeds the ceiling on the 16-bit grid (random signals, ceilings, rates, block sizes and start samples)', () => {
    const r = rng(7);
    for (let trial = 0; trial < 40; trial++) {
      const rate = [44100, 48000, 32000, 96000][trial % 4]!;
      const ceilingDb = -(Math.round(r() * 90) / 10); // −9 … 0 in tenths
      const n = 2000 + Math.floor(r() * 20000), block = 1 + Math.floor(r() * 700);
      const x = randomSignal(r, n);
      const { out } = limiterRun(x, rate, ceilingDb, block, Math.floor(r() * 1e6));
      const c = limiterCeilingLinear(ceilingDb);
      let peak = 0;
      for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]!); if (a > peak) peak = a; }
      expect(peak, `trial ${trial}`).toBeLessThanOrEqual(c);
      // the 16-bit value the writer makes (round half to even of x·32768) never passes ⌊10^(c/20)·32767⌋
      expect(Math.round(peak * 32768)).toBeLessThanOrEqual(Math.floor(10 ** (ceilingDb / 20) * 32767));
    }
  });

  it('samples more than lookahead + release after the last limited sample equal the delayed input bit for bit', () => {
    const rate = 48000, { lookahead, release } = limiterWindow(rate);
    const x = limiterFixture(rate, 2);
    const { out, stats } = limiterRun(x, rate, -1, 128);
    const lat = lookahead - 1;
    expect(stats.limitedSamples).toBeGreaterThan(0);
    // inside the fixture's silent-ish and under-ceiling sections far from any burst, output i is input i − latency exactly
    let checked = 0, last = -Infinity;
    // find every input index whose peak is over the ceiling (r < 1): those are the only places the gain may move
    const c = limiterCeilingLinear(-1), over: number[] = [];
    for (let i = 0; i < x.left.length; i++) if (Math.max(Math.abs(x.left[i]!), Math.abs(x.right[i]!)) > c) over.push(i);
    let oi = 0;
    for (let o = lat; o < x.left.length; o++) {
      const src = o - lat; // the input sample output o carries
      while (oi < over.length && over[oi]! <= o) { last = over[oi]!; oi++; }
      // the gain of output o averages q over [o − M + 1, o]; each q_j sees r over [j − M + 1, j] and releases within `release`: untouched when the last r < 1 is older than 2M + release
      if (o - last > 2 * lookahead + release) {
        expect(Object.is(out[o * 2], x.left[src]) && Object.is(out[o * 2 + 1], x.right[src]), `output ${o}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(rate / 4);
  });

  it('the release reaches exactly 1 within 120 ms from the deepest hold', () => {
    const rate = 48000, { lookahead, release } = limiterWindow(rate);
    const n = lookahead + release + 2000;
    const left = new Float32Array(n), right = new Float32Array(n);
    left[0] = 1000; // one huge sample: q falls to ~c/1000 and must climb back
    const lim = new MasterLimiter(rate, -1);
    lim.process(left, right, new Float32Array(n), new Float32Array(n));
    const s = lim.stats();
    expect(s.maxReductionDb).toBeLessThan(-60);
    // the last output with a gain below 1 lies within M − 1 (latency) + M (window) + release of the click
    expect(s.lastLimitedSample! + lookahead - 1).toBeLessThanOrEqual(2 * lookahead + release);
    expect(lim.reductionDb()).toBe(0);
  });

  it('the block size changes nothing, and a stream started later equals the full stream 125 ms after its start', () => {
    const rate = 48000, x = limiterFixture(rate, 2);
    const a = limiterRun(x, rate, -2, 128).out, b = limiterRun(x, rate, -2, 1).out, c = limiterRun(x, rate, -2, 4801).out;
    expect(sha(a)).toBe(sha(b));
    expect(sha(a)).toBe(sha(c));
    const { lookahead } = limiterWindow(rate);
    for (const start of [24_000 + 17, 30_011, 36_000]) { // inside the loudest burst (the 2.4 × section is 24000–36000)
      const sub = { left: x.left.subarray(start), right: x.right.subarray(start) };
      const part = limiterRun(sub, rate, -2, 128, start).out;
      const from = Math.round(0.125 * rate);
      // part output j is input start + j − latency; full output start + j is the same input sample
      let diff = 0;
      for (let j = from; j < sub.left.length; j++) if (!Object.is(part[j * 2], a[(start + j) * 2]) || !Object.is(part[j * 2 + 1], a[(start + j) * 2 + 1])) diff++;
      expect(diff, `start ${start}`).toBe(0);
      void lookahead;
    }
  });

  it('the public worklet file gives the same bits as the kernel (Node run of apps/web/public/pf-master-limiter.js)', () => {
    const rate = 48000, ceilingDb = -1, x = limiterFixture(rate, 2);
    const kernel = limiterRun(x, rate, ceilingDb, 128).out;
    const out = runWorkletFile(x, rate, ceilingDb);
    expect(sha(out)).toBe(sha(kernel));
    // the meter messages say how much is held back, only while it is
    expect(lastMessages.some((m) => m.reductionDb < -3)).toBe(true);
    expect(lastMessages.some((m) => m.reductionDb === 0)).toBe(true);
  });
});

let lastMessages: { t: number; reductionDb: number }[] = [];
/** Load the static worklet file with stand-ins for registerProcessor, AudioWorkletProcessor, sampleRate and currentFrame. */
function runWorkletFile(x: { left: Float32Array; right: Float32Array }, rate: number, ceilingDb: number): Float32Array {
  const file = path.resolve(import.meta.dirname, '../../../apps/web/public/pf-master-limiter.js');
  let Proc: any = null;
  const messages: { t: number; reductionDb: number }[] = [];
  class AudioWorkletProcessor { port = { postMessage: (m: any) => messages.push(m) }; }
  const ctx = vm.createContext({ registerProcessor: (_name: string, cls: unknown) => { Proc = cls; }, AudioWorkletProcessor, sampleRate: rate, currentFrame: 0, Float64Array, Math, Infinity, NaN });
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  const p = new Proc({ processorOptions: { ceiling: limiterCeilingLinear(ceilingDb), lookahead: limiterWindow(rate).lookahead } });
  const n = x.left.length, out = new Float32Array(n * 2);
  for (let a = 0; a < n; a += 128) {
    const b = Math.min(n, a + 128);
    ctx.currentFrame = a;
    const ol = new Float32Array(b - a), or = new Float32Array(b - a);
    p.process([[x.left.subarray(a, b), x.right.subarray(a, b)]], [[ol, or]]);
    for (let i = 0; i < b - a; i++) { out[(a + i) * 2] = ol[i]!; out[(a + i) * 2 + 1] = or[i]!; }
  }
  lastMessages = messages;
  return out;
}
