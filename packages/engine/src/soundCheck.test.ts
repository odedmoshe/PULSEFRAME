/**
 * Sound checks (send-decisions C9): the limits are exact at their edges — 3 full-scale samples in a 0.1 s block are clipped and 2
 * are not; RMS under −60 dBFS for 2.0 s is silence and for 1.9 s is not — and the result does not depend on how the samples were
 * pushed.
 */
import { describe, expect, it } from 'vitest';
import { SoundCheck } from './soundCheck.ts';

const SR = 48000, BLOCK = SR / 10;
/** Interleaved stereo 16-bit: `seconds` of a ±a square wave (RMS exactly a/32768). */
function square(seconds: number, a: number): Int16Array {
  const n = Math.round(seconds * SR), x = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) { const v = i % 2 ? a : -a; x[i * 2] = v; x[i * 2 + 1] = v; }
  return x;
}
const cat = (...parts: Int16Array[]) => { const out = new Int16Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const runsOf = (x: Int16Array, pushSize = x.length, sr = SR) => { const c = new SoundCheck(sr, 2); for (let a = 0; a < x.length; a += pushSize) c.push(x.subarray(a, a + pushSize)); return c.runs(); };
const LOUD = 3000; // about −21 dBFS RMS
const QUIET = 29; // 29/32768 → −61.06 dBFS RMS: under −60
const EDGE = 33; // 33/32768 → −59.94 dBFS: over −60

describe('SoundCheck', () => {
  it('3 full-scale samples in a 0.1 s block are clipped, 2 are not; the run is placed on its block', () => {
    const x = square(1, LOUD);
    x[(5 * BLOCK + 10) * 2] = 32767; x[(5 * BLOCK + 11) * 2 + 1] = -32768; x[(5 * BLOCK + 4000) * 2] = 32767; // block 5: three
    x[(8 * BLOCK + 1) * 2] = 32767; x[(8 * BLOCK + 2) * 2] = -32768; // block 8: two
    const r = runsOf(x);
    expect(r).toEqual([{ kind: 'clipped', fromSample: 5 * BLOCK, toSample: 6 * BLOCK, measured: { blocks: 1, fullScaleSamples: 3, peakSample: 32768 } }]);
  });
  it('consecutive clipped blocks are one run', () => {
    const x = square(1, LOUD);
    for (let i = 2 * BLOCK; i < 4 * BLOCK; i += 100) x[i * 2] = 32767;
    const r = runsOf(x);
    expect(r.map((q) => [q.kind, q.fromSample, q.toSample, q.measured.blocks])).toEqual([['clipped', 2 * BLOCK, 4 * BLOCK, 2]]);
  });
  it('RMS under −60 dBFS for 2.0 s is silence, for 1.9 s is not; at −59.9 dBFS it is not silence', () => {
    const two = runsOf(cat(square(1, LOUD), square(2, QUIET), square(1, LOUD)));
    expect(two.map((q) => [q.kind, q.fromSample, q.toSample])).toEqual([['silence', SR, 3 * SR]]);
    expect(two[0]!.measured).toEqual({ blocks: 20, seconds: 2, loudestBlockRmsDbfs: -61.1 });
    expect(runsOf(cat(square(1, LOUD), square(1.9, QUIET), square(1, LOUD)))).toEqual([]);
    expect(runsOf(cat(square(1, LOUD), square(3, EDGE), square(1, LOUD)))).toEqual([]);
    // digital zero says so (a number that survives JSON, never −Infinity)
    expect(runsOf(cat(square(1, LOUD), square(2, 0)))[0]!.measured).toEqual({ blocks: 20, seconds: 2, digitalSilence: 1 });
  });
  it('a silence at the end counts, including a last partial block; a silence that started mid-block starts on the next block', () => {
    const r = runsOf(cat(square(1.05, LOUD), square(2.08, QUIET)));
    // block 10 (1.0–1.1 s) holds loud sound, so the quiet run starts at block 11 and ends at the last sample (a partial block)
    expect(r.map((q) => [q.kind, q.fromSample, q.toSample])).toEqual([['silence', 11 * BLOCK, Math.round(3.13 * SR)]]);
  });
  it('how the samples are pushed (odd sizes, half frames) changes nothing', () => {
    const x = cat(square(0.73, LOUD), square(2.4, QUIET), square(0.5, LOUD));
    for (let i = 300; i < 900; i++) x[i * 2 + 1] = -32768;
    const whole = runsOf(x);
    expect(whole.length).toBe(2);
    expect(runsOf(x, 1)).toEqual(whole);
    expect(runsOf(x, 4801)).toEqual(whole);
  });
  it('blocks are exact at a rate that is not a multiple of 10 (block k = [⌊k·rate/10⌋, ⌊(k+1)·rate/10⌋))', () => {
    const sr = 22051, n = sr * 3, x = new Int16Array(n * 2).fill(LOUD);
    const b7 = Math.floor((7 * sr) / 10);
    x[(b7 + 1) * 2] = 32767; x[(b7 + 2) * 2] = 32767; x[(b7 + 3) * 2] = 32767;
    expect(runsOf(x, 999, sr).map((q) => [q.fromSample, q.toSample])).toEqual([[b7, Math.floor((8 * sr) / 10)]]);
  });
});
