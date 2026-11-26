import { describe, expect, it } from 'vitest';
import { rt } from '@pulseframe/time';
import { peaksForColumns, pickWaveformLevel, sampleIndexNearest, thumbnailIndexForSlot, type WaveformLevel } from './clipVisuals.math.ts';

const R30 = { num: 30, den: 1 };
const tens = Array.from({ length: 10 }, (_, i) => i * 30); // 0,30,...,270 over a 10 s / 300 frame source

describe('thumbnailIndexForSlot', () => {
  const whole = { sourceIn: rt(0, 1), duration: rt(10, 1), widthPx: 900, frameRate: R30, frameIndices: tens };
  it('clip showing the whole source', () => {
    expect(thumbnailIndexForSlot({ ...whole, slotCentrePx: 450 })).toBe(5); // 5 s = frame 150
    expect(thumbnailIndexForSlot({ ...whole, slotCentrePx: 135 })).toBe(1); // 1.5 s = frame 45: 30 (15) vs 60 (15) tie -> lower
    expect(thumbnailIndexForSlot({ ...whole, slotCentrePx: 45 })).toBe(0); // frame 15: 0 vs 30 tie -> lower
    expect(thumbnailIndexForSlot({ ...whole, slotCentrePx: 855 })).toBe(9); // frame 285 -> 270
  });
  it('clip with sourceIn mid-source', () => {
    const p = { sourceIn: rt(5, 1), duration: rt(2, 1), widthPx: 200, frameRate: R30, frameIndices: tens };
    expect(thumbnailIndexForSlot({ ...p, slotCentrePx: 0 })).toBe(5); // frame 150
    expect(thumbnailIndexForSlot({ ...p, slotCentrePx: 100 })).toBe(6); // 6 s = frame 180
    expect(thumbnailIndexForSlot({ ...p, slotCentrePx: 190 })).toBe(7); // 6.9 s = frame 207 -> 210
  });
  it('slot beyond available frames clamps', () => {
    const p = { sourceIn: rt(0, 1), duration: rt(10, 1), widthPx: 900, frameRate: R30, frameIndices: [0, 30] };
    expect(thumbnailIndexForSlot({ ...p, slotCentrePx: 800 })).toBe(1);
    expect(thumbnailIndexForSlot({ ...p, slotCentrePx: 5000 })).toBe(1);
    expect(thumbnailIndexForSlot({ ...p, slotCentrePx: -50 })).toBe(0);
  });
  it('30000/1001 uses exact frame boundaries', () => {
    const rate = { num: 30000, den: 1001 };
    const base = { duration: rt(1, 1), widthPx: 100, slotCentrePx: 0, frameRate: rate, frameIndices: [28, 31] };
    // exactly frame 30 (30 * 1001 / 30000 s): nearest is 31
    expect(thumbnailIndexForSlot({ ...base, sourceIn: rt(30030, 30000) })).toBe(1);
    // one tick earlier is still inside frame 29: nearest is 28
    expect(thumbnailIndexForSlot({ ...base, sourceIn: rt(30029, 30000) })).toBe(0);
  });
});

describe('waveform peaks', () => {
  // L0: 4 samples/bucket, 6 buckets. L1: 8 samples/bucket, 3 buckets (exact folds of L0).
  const l0: WaveformLevel = { samplesPerBucket: 4, buckets: 6, byteOffset: 0 };
  const l1: WaveformLevel = { samplesPerBucket: 8, buckets: 3, byteOffset: 24 };
  const pairs0 = [[-1, 1], [-2, 3], [-5, 2], [0, 4], [-3, -1], [7, 9]];
  const pairs1 = [[-2, 3], [-5, 4], [-3, 9]];
  const buf = new ArrayBuffer(24 + 12);
  const view = new DataView(buf);
  [...pairs0, ...pairs1].forEach(([mn, mx], i) => { view.setInt16(i * 4, mn!, true); view.setInt16(i * 4 + 2, mx!, true); });

  it('aggregates exact min/max per column', () => {
    expect([...peaksForColumns({ view, level: l0, firstSample: 0, sampleCount: 24, columns: 3 })]).toEqual([-2, 3, -5, 4, -3, 9]);
    expect([...peaksForColumns({ view, level: l1, firstSample: 0, sampleCount: 24, columns: 3 })]).toEqual([-2, 3, -5, 4, -3, 9]);
    expect([...peaksForColumns({ view, level: l0, firstSample: 0, sampleCount: 24, columns: 1 })]).toEqual([-5, 9]);
  });
  it('range starting mid-bucket includes the partially covered buckets', () => {
    // samples 6..9 touch buckets 1,2; samples 9..12 touch bucket 2
    expect([...peaksForColumns({ view, level: l0, firstSample: 6, sampleCount: 6, columns: 2 })]).toEqual([-5, 3, -5, 2]);
  });
  it('zoomed in past one bucket per column repeats the bucket', () => {
    expect([...peaksForColumns({ view, level: l0, firstSample: 4, sampleCount: 2, columns: 2 })]).toEqual([-2, 3, -2, 3]);
  });
  it('range past the end yields zero columns', () => {
    expect([...peaksForColumns({ view, level: l0, firstSample: 20, sampleCount: 16, columns: 4 })]).toEqual([7, 9, 0, 0, 0, 0, 0, 0]);
    expect([...peaksForColumns({ view, level: l0, firstSample: -16, sampleCount: 16, columns: 2 })]).toEqual([0, 0, 0, 0]);
  });
});

describe('pickWaveformLevel', () => {
  const levels: WaveformLevel[] = [
    { samplesPerBucket: 256, buckets: 10, byteOffset: 0 },
    { samplesPerBucket: 1024, buckets: 3, byteOffset: 40 },
    { samplesPerBucket: 4096, buckets: 1, byteOffset: 52 },
  ];
  it('chooses the coarsest level with >= 1 bucket per device pixel', () => {
    expect(pickWaveformLevel(levels, 480000, 100).samplesPerBucket).toBe(4096); // 4800/px
    expect(pickWaveformLevel(levels, 480000, 400).samplesPerBucket).toBe(1024); // 1200/px
    expect(pickWaveformLevel(levels, 480000, 900).samplesPerBucket).toBe(256); // 533/px
    expect(pickWaveformLevel(levels, 102400, 100).samplesPerBucket).toBe(1024); // exactly 1024/px
    expect(pickWaveformLevel(levels, 1000, 1000).samplesPerBucket).toBe(256); // finer than any level: finest
  });
});

describe('sampleIndexNearest', () => {
  it('is exact from rational time', () => {
    expect(sampleIndexNearest(rt(1, 2), 48000)).toBe(24000);
    expect(sampleIndexNearest(rt(1001, 30000), 48000)).toBe(1602); // 1601.6
    expect(sampleIndexNearest(rt(0, 1), 48000)).toBe(0);
  });
});
