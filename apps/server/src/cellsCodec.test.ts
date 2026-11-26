/** Cells codec (ADR-0024): lossless on random frames (every bit pattern), compact on static stretches, refuses a damaged blob. */
import { describe, expect, it } from 'vitest';
import { flashCells, type FlashCells } from '@pulseframe/engine';
import { decodeCells, encodeCells } from './cellsCodec.ts';

/** Small seeded generator (mulberry32) so a failure reproduces. */
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const bitsOf = (c: FlashCells) => Array.from(new Uint32Array(c.rgb.buffer.slice(c.rgb.byteOffset, c.rgb.byteOffset + c.rgb.byteLength) as ArrayBuffer));

describe('cells codec', () => {
  it('is lossless on random frames, including NaN payloads, -0, ±Infinity and subnormals', () => {
    const r = rng(7);
    const cells: FlashCells[] = [];
    for (let f = 0; f < 40; f++) {
      const words = new Uint32Array(24 * 24 * 3);
      for (let i = 0; i < words.length; i++) words[i] = Math.floor(r() * 2 ** 32) >>> 0;
      words[0] = 0x7fc00001; words[1] = 0xffa00003; words[2] = 0x80000000; words[3] = 0x7f800000; words[4] = 0xff800000; words[5] = 0x00000001;
      cells.push({ cols: 24, rows: 24, rgb: new Float32Array(words.buffer) });
    }
    const back = decodeCells(encodeCells(cells));
    expect(back.length).toBe(40);
    for (let f = 0; f < 40; f++) {
      expect([back[f]!.cols, back[f]!.rows]).toEqual([24, 24]);
      expect(bitsOf(back[f]!)).toEqual(bitsOf(cells[f]!));
    }
  });

  it('is lossless on the cells of real RGBA frames and on a sub-view Float32Array', () => {
    const r = rng(3);
    const w = 48, h = 32;
    const cells = Array.from({ length: 10 }, () => { const px = new Uint8Array(w * h * 4); for (let i = 0; i < px.length; i++) px[i] = Math.floor(r() * 256); return flashCells(px, w, h); });
    const shared = new Float32Array(24 * 24 * 3 + 8);
    shared.set(cells[0]!.rgb, 4);
    cells.push({ cols: 24, rows: 24, rgb: shared.subarray(4, 4 + 24 * 24 * 3) });
    const back = decodeCells(encodeCells(cells));
    expect(back.map(bitsOf)).toEqual(cells.map(bitsOf));
  });

  it('stores a static stretch in a few bytes per frame (measured)', () => {
    const w = 64, h = 36;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i * 37) & 255;
    const one = flashCells(px, w, h);
    const frames = 60;
    const blob = encodeCells(Array.from({ length: frames }, () => one));
    const perFrame = blob.length / frames;
    console.log(`[cells codec] static stretch: ${blob.length} bytes for ${frames} frames = ${perFrame.toFixed(1)} bytes per frame (raw ${24 * 24 * 3 * 4})`);
    expect(perFrame).toBeLessThan(6912 / 10);
    expect(decodeCells(blob).map(bitsOf)).toEqual(Array.from({ length: frames }, () => bitsOf(one)));
  });

  it('round-trips no frames, and refuses mixed grids and damaged blobs', () => {
    expect(decodeCells(encodeCells([]))).toEqual([]);
    expect(() => encodeCells([{ cols: 2, rows: 2, rgb: new Float32Array(12) }, { cols: 3, rows: 2, rgb: new Float32Array(18) }])).toThrow(/grid/);
    const blob = encodeCells([{ cols: 2, rows: 2, rgb: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }]);
    const bad = blob.slice(); bad[bad.length - 2]! ^= 0x40;
    expect(() => decodeCells(bad)).toThrow(/damaged/);
    expect(() => decodeCells(blob.slice(0, 10))).toThrow();
    const wrongMagic = blob.slice(); wrongMagic[0] = 0;
    expect(() => decodeCells(wrongMagic)).toThrow(/not a cells blob/);
  });
});
