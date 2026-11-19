/**
 * The segment grid and the segment key (ADR-0024, plan §3 with the verifier's merge rule and the contracts repair:
 * segFrames = max(MIN_SEGMENT_FRAMES, round(2·num/den)); a 1–2 frame head or tail joins its neighbour). The lead's
 * segmentGrid.contract.test.ts states the contract over fixed rates; this file adds random rates and ranges with fast-check,
 * the comparison with the full grid, the exact examples and the segment key.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MIN_SEGMENT_FRAMES, SEGMENT_SECONDS } from '@pulseframe/core';
import { canonicalJson } from './frameKey.ts';
import { SEGMENT_KEY_PREFIX, segmentFrames, segmentGrid, segmentKey, type Segment, type SegmentKeyParams } from './segmentGrid.ts';
import { sha256 } from './frameKey.testDocs.ts';

const NAMED_RATES = [[30000, 1001], [24000, 1001], [25, 1], [30, 1], [60, 1], [60000, 1001], [25, 2], [5, 4], [6, 5], [1, 1], [1, 2], [1, 3], [3, 4], [1, 1000]] as const;
const rate = fc.oneof(
  fc.constantFrom(...NAMED_RATES.map(([num, den]) => ({ num, den }))),
  fc.record({ num: fc.integer({ min: 1, max: 240_000 }), den: fc.integer({ min: 1, max: 1001 }) }),
);

/** The checks every grid must pass (plain comparisons: this runs over thousands of segments); returns the segments' absolute [start, end). */
function checkGrid(firstFrame: number, frames: number, seg: number, g: Segment[]) {
  const fail = (why: string) => { throw new Error(`grid ${firstFrame}+${frames} at segFrames ${seg}: ${why} in ${JSON.stringify(g.slice(0, 6))}${g.length > 6 ? '…' : ''}`); };
  let at = 0;
  for (const s of g) {
    if (s.first !== at) fail(`segment at ${s.first}, expected ${at}`); // in order, no gap, no overlap
    if (!(s.frames > 0)) fail('an empty segment');
    if (s.index !== Math.floor((firstFrame + s.first) / seg)) fail(`index ${s.index} is not the cell of its first frame`);
    if (g.length > 1 && s.frames < MIN_SEGMENT_FRAMES) fail(`a ${s.frames}-frame segment that is not alone`);
    if (s.frames > seg + 4) fail(`${s.frames} frames, over segFrames + 4`);
    // more than segFrames + 2 only when one whole cell took a short head and a short tail
    if (s.frames > seg + 2 && !(g.length === 1 && firstFrame % seg > seg - MIN_SEGMENT_FRAMES)) fail(`${s.frames} frames without a short head and tail`);
    at += s.frames;
  }
  if (at !== frames) fail(`covers ${at} frames`); // exact cover
  if (frames > 0 && frames < MIN_SEGMENT_FRAMES && g.length !== 1) fail('a 1-2 frame range is not one segment');
  return g.map((s) => [firstFrame + s.first, firstFrame + s.first + s.frames] as const);
}

describe('segmentFrames', () => {
  it('is two seconds of frames with a floor of MIN_SEGMENT_FRAMES', () => {
    expect([[30000, 1001], [24000, 1001], [25, 1], [60, 1], [5, 4], [6, 5], [1, 1], [1, 2], [1, 1000]].map(([num, den]) => segmentFrames({ num: num!, den: den! }))).toEqual([60, 48, 50, 120, 3, 3, 3, 3, 3]);
    expect(segmentFrames({ num: 30, den: 1 }, 1)).toBe(30);
    fc.assert(fc.property(rate, ({ num, den }) => { expect(segmentFrames({ num, den })).toBe(Math.max(MIN_SEGMENT_FRAMES, Math.round((SEGMENT_SECONDS * num) / den))); }), { numRuns: 500 });
  });
  it('refuses a rate or a length that is not positive', () => {
    for (const r of [{ num: 0, den: 1 }, { num: 30, den: 0 }, { num: -30, den: 1 }, { num: 29.97, den: 1 }]) expect(() => segmentFrames(r)).toThrow(RangeError);
    for (const s of [0, -2, NaN, Infinity]) expect(() => segmentFrames({ num: 30, den: 1 }, s)).toThrow(RangeError);
  });
});

describe('segmentGrid', () => {
  it('exact examples: cells, partial ends, the merge of 1–2 frame heads and tails, a lone short range', () => {
    expect(segmentGrid(0, 180, 60)).toEqual([{ index: 0, first: 0, frames: 60 }, { index: 1, first: 60, frames: 60 }, { index: 2, first: 120, frames: 60 }]);
    expect(segmentGrid(0, 137, 60)).toEqual([{ index: 0, first: 0, frames: 60 }, { index: 1, first: 60, frames: 60 }, { index: 2, first: 120, frames: 17 }]);
    expect(segmentGrid(0, 121, 60)).toEqual([{ index: 0, first: 0, frames: 60 }, { index: 1, first: 60, frames: 61 }]); // 1801-frame style tail
    expect(segmentGrid(0, 122, 60)).toEqual([{ index: 0, first: 0, frames: 60 }, { index: 1, first: 60, frames: 62 }]);
    expect(segmentGrid(59, 63, 60)).toEqual([{ index: 0, first: 0, frames: 63 }]); // 1 + 60 + 2 frames: one segment
    expect(segmentGrid(58, 64, 60)).toEqual([{ index: 0, first: 0, frames: 64 }]); // 2 + 60 + 2 = segFrames + 4
    expect(segmentGrid(58, 125, 60)).toEqual([{ index: 0, first: 0, frames: 62 }, { index: 2, first: 62, frames: 60 }, { index: 3, first: 122, frames: 3 }]);
    expect(segmentGrid(58, 124, 60)).toEqual([{ index: 0, first: 0, frames: 62 }, { index: 2, first: 62, frames: 62 }]);
    expect(segmentGrid(57, 6, 60)).toEqual([{ index: 0, first: 0, frames: 3 }, { index: 1, first: 3, frames: 3 }]);
    expect(segmentGrid(59, 2, 60)).toEqual([{ index: 0, first: 0, frames: 2 }]); // a 2-frame range across a grid line is one segment
    expect(segmentGrid(100, 1, 60)).toEqual([{ index: 1, first: 0, frames: 1 }]);
    expect(segmentGrid(0, 7, segmentFrames({ num: 1, den: 1 })).map((s) => s.frames)).toEqual([3, 4]);
    expect(segmentGrid(5, 0, 60)).toEqual([]);
  });

  it('refuses bad arguments, and a cell shorter than MIN_SEGMENT_FRAMES', () => {
    expect(() => segmentGrid(-1, 10, 60)).toThrow(RangeError);
    expect(() => segmentGrid(0, -1, 60)).toThrow(RangeError);
    expect(() => segmentGrid(0.5, 10, 60)).toThrow(RangeError);
    expect(() => segmentGrid(0, 10, 2)).toThrow(RangeError);
    expect(() => segmentGrid(0, 10, 60.5)).toThrow(RangeError);
  });

  it('over random rates and ranges: exact cover in order, 3 frames or more unless alone, at most segFrames + 4, and the cells of a range equal the full grid\'s', () => {
    fc.assert(fc.property(rate, fc.nat({ max: 20_000 }), fc.nat({ max: 3_000 }), ({ num, den }, firstFrame, frames) => {
      const seg = segmentFrames({ num, den });
      const g = segmentGrid(firstFrame, frames, seg);
      const spans = checkGrid(firstFrame, frames, seg, g);
      // the full export: from programme frame 0 to two whole cells past the range, so its own tail merge cannot touch these cells
      const total = (Math.ceil((firstFrame + frames) / seg) + 2) * seg;
      const full = segmentGrid(0, total, seg);
      const fullSpans = new Map(full.map((s) => [s.first, s] as const));
      spans.forEach(([a, b], i) => {
        // every segment of the range that starts and ends on grid lines is exactly that cell of the full export (same index, same frames)
        if (a % seg === 0 && b % seg === 0) { const c = fullSpans.get(a); if (!c || c.index !== g[i]!.index || c.frames !== seg || b - a !== seg) throw new Error(`${firstFrame}+${frames}/${seg}: [${a},${b}) is not the full grid's cell ${JSON.stringify(c)}`); }
        // and every segment but the first and the last of the range is such a whole cell
        if (i > 0 && i < spans.length - 1 && (a % seg !== 0 || b - a !== seg)) throw new Error(`${firstFrame}+${frames}/${seg}: interior segment [${a},${b}) is not a whole cell`);
      });
    }), { numRuns: 1000 });
    // the full grids themselves (from programme frame 0) at every named rate
    for (const [num, den] of NAMED_RATES) { const seg = segmentFrames({ num, den }); for (let n = 0; n < 4 * seg + 3; n++) checkGrid(0, n, seg, segmentGrid(0, n, seg)); }
  }, 120_000);

  it('ranges starting and ending 1 and 2 frames off the grid, at the named low rates too (proof I15 shapes)', () => {
    for (const [num, den] of NAMED_RATES) {
      const seg = segmentFrames({ num, den });
      for (const off of [-2, -1, 0, 1, 2]) for (const tail of [-2, -1, 0, 1, 2]) for (const cells of [0, 1, 2, 5]) {
        const firstFrame = 3 * seg + off, frames = cells * seg + tail - off;
        if (frames < 0) continue;
        checkGrid(firstFrame, frames, seg, segmentGrid(firstFrame, frames, seg));
      }
    }
  });
});

describe('segmentKey', () => {
  const params: SegmentKeyParams = { engine: { bundle: 'b'.repeat(64), browser: '131.0.6778.85|launch=headless', schemaVersion: 2 }, encoder: 'e'.repeat(64), output: { width: 640, height: 360, frameRate: { num: 30000, den: 1001 } } };
  const frames = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)];

  it('is the digest of the prefix and canonicalJson({ ...params, frames }), whatever the member order', () => {
    expect(segmentKey(frames, params, sha256)).toBe(sha256(SEGMENT_KEY_PREFIX + canonicalJson({ ...params, frames })));
    const reordered: SegmentKeyParams = { output: { frameRate: { den: 1001, num: 30000 }, height: 360, width: 640 }, encoder: params.encoder, engine: { schemaVersion: 2, browser: params.engine.browser, bundle: params.engine.bundle } };
    expect(segmentKey(frames, reordered, sha256)).toBe(segmentKey(frames, params, sha256));
    expect(SEGMENT_KEY_PREFIX).toBe('pf-seg/1\n');
  });

  it('changes with every part: each frame key, their order and count, the bundle, the browser and its launch mode, the schema, the encoder, the output size and rate', () => {
    const base = segmentKey(frames, params, sha256);
    const variants: [string, string[], SegmentKeyParams][] = [
      ['a frame key', [frames[0]!, '4'.repeat(64), frames[2]!], params],
      ['the order', [frames[1]!, frames[0]!, frames[2]!], params],
      ['one frame fewer', frames.slice(0, 2), params],
      ['bundle', frames, { ...params, engine: { ...params.engine, bundle: 'c'.repeat(64) } }],
      ['browser launch mode', frames, { ...params, engine: { ...params.engine, browser: '131.0.6778.85|launch=gpu-headed' } }],
      ['schema', frames, { ...params, engine: { ...params.engine, schemaVersion: 3 } }],
      ['encoder', frames, { ...params, encoder: 'f'.repeat(64) }],
      ['width', frames, { ...params, output: { ...params.output, width: 1280 } }],
      ['height', frames, { ...params, output: { ...params.output, height: 720 } }],
      ['rate', frames, { ...params, output: { ...params.output, frameRate: { num: 30, den: 1 } } }],
    ];
    const keys = new Set([base]);
    for (const [name, fk, p] of variants) { const k = segmentKey(fk, p, sha256); expect(k, name).not.toBe(base); keys.add(k); }
    expect(keys.size).toBe(variants.length + 1);
    fc.assert(fc.property(fc.array(fc.stringMatching(/^[0-9a-f]{64}$/), { minLength: 1, maxLength: 8 }), fc.array(fc.stringMatching(/^[0-9a-f]{64}$/), { minLength: 1, maxLength: 8 }), (a, b) => {
      expect(segmentKey(a, params, sha256) === segmentKey(b, params, sha256)).toBe(a.join() === b.join());
    }), { numRuns: 300 });
  });

  it('refuses an empty segment', () => {
    expect(() => segmentKey([], params, sha256)).toThrow(RangeError);
  });
});
