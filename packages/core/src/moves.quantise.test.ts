/**
 * Perform mode W1 (ADR-0025): the grid a take snaps to (performGrid, on followedBeats) and quantise. Music at 120 BPM
 * (a beat every 0.5 s), bars every four beats; taps carry seeded ±60 ms jitter.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, defaultBank, frameOfSeconds, MOVES, PAD_COUNT, performGrid, quantiseTaps, type OpCall, type PadBank, type ProjectDocument, type QuantiseSettings, type Tap } from './index.ts';

const provenance = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const song = (c: string) => ({ kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance });
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `q${n++}_`, actor: 'test', allowInternal: true });
/** 120 BPM music from source 0 (beats every 0.5 s, bars from `barAt`), placed on the timeline at each of `places` [start, seconds]. */
function music(rate: T.Rate, places: [number, number][] = [[0, 40]], barAt = 0) {
  let doc = createProject({ id: 'prj_q', name: 'q', frameRate: rate });
  const r = tx(doc, [{ op: 'import_asset', args: { asset: song('a') } }]);
  const assetId = r.results[0]!.output!.assetId as string;
  doc = tx(r.doc, [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-18T00:00:00Z', times: Array.from({ length: 120 }, (_, i) => T.rt(i * 500, 1000)), bpm: 120, downbeats: Array.from({ length: 30 }, (_, i) => T.rt(barAt * 1000 + i * 2000, 1000)), meter: 4 } }]).doc;
  for (const [start, seconds] of places) doc = tx(doc, [{ op: 'add_clip', args: { assetId, start: T.snapToFrame(T.fromSeconds(start), rate), duration: T.snapToFrame(T.fromSeconds(seconds), rate) } }]).doc;
  return doc;
}
const S = (o: Partial<QuantiseSettings> = {}): QuantiseSettings => ({ snap: 'beat', tempo: 'normal', strength: 1, parity: 0, ...o });
const EMPTY: PadBank = Array(PAD_COUNT).fill(null);
/** mulberry32: a seeded jitter, the same on every run */
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const RATES: [string, T.Rate][] = [['24', { num: 24, den: 1 }], ['25', { num: 25, den: 1 }], ['29.97', { num: 30000, den: 1001 }], ['30', { num: 30, den: 1 }], ['60', { num: 60, den: 1 }]];

describe('frameOfSeconds', () => {
  it('is one conversion of the absolute time to the nearest frame (ties up), through an exact rational', () => {
    const r30 = { num: 30, den: 1 }, ntsc = { num: 30000, den: 1001 };
    expect(frameOfSeconds(0, r30)).toBe(0);
    expect(frameOfSeconds(1, r30)).toBe(30);
    expect(frameOfSeconds(1 / 60, r30)).toBe(1); // half a frame rounds up
    expect(frameOfSeconds(0.016, r30)).toBe(0);
    expect(frameOfSeconds(1001, ntsc)).toBe(30000);
    expect(frameOfSeconds(3600.5, ntsc)).toBe(T.nearestFrameIndex(T.fromSeconds('3600.5'), ntsc));
  });
});

describe('performGrid', () => {
  const r30 = { num: 30, den: 1 };
  it('is the followed beats; empty with snap off or without analysed music', () => {
    const doc = music(r30, [[0, 10]]);
    expect(performGrid(doc, S())).toEqual(Array.from({ length: 21 }, (_, i) => i * 0.5).filter((t) => t < 10));
    expect(performGrid(doc, S({ snap: 'off' }))).toEqual([]);
    expect(performGrid(createProject({ id: 'prj_e', name: 'e' }), S())).toEqual([]);
  });
  it('÷2 keeps every other beat by running index parity, anchored to the first bar start; parity 1 takes the other half', () => {
    const doc = music(r30, [[0, 10]], 1.5); // the first bar starts on beat 3
    const half = performGrid(doc, S({ tempo: 'half' }));
    expect(half).toContain(1.5);
    expect(half).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]);
    expect(performGrid(doc, S({ tempo: 'half', parity: 1 }))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('×2 and half beat insert midpoints, but never across a break wider than twice the median period', () => {
    const doc = music(r30, [[0, 4], [10, 4]]); // music 0–4 s and 10–14 s
    const double = performGrid(doc, S({ tempo: 'double' }));
    expect(double).toContain(3.25);
    expect(double.filter((t) => t > 3.5 && t < 10)).toEqual([]);
    expect(double.slice(0, 4)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(performGrid(doc, S({ snap: 'half' }))).toEqual(double);
    // ×2 then half beat: quarter beats
    expect(performGrid(doc, S({ tempo: 'double', snap: 'half' })).slice(0, 3)).toEqual([0, 0.125, 0.25]);
  });
});

describe('quantiseTaps', () => {
  for (const [name, rate] of RATES) {
    it(`at ${name} fps: 64 taps with ±60 ms jitter land on frameOfSeconds(beat), on the beat and on the half beat`, () => {
      const doc = music(rate, [[0, 55]]);
      for (const snap of ['beat', 'half'] as const) {
        const grid = performGrid(doc, S({ snap }));
        const step = snap === 'beat' ? 0.5 : 0.25;
        const jitter = rng(snap === 'beat' ? 7 : 11);
        const targets = Array.from({ length: 64 }, (_, i) => 1 + i * step * 1.5 - ((i * step * 1.5) % step));
        const taps: Tap[] = targets.map((t, i) => { const d = t + (jitter() * 2 - 1) * 0.06; return { pad: i % 8, down: d, up: d + 0.1 }; });
        const hits = quantiseTaps(taps, grid, S({ snap }), rate, defaultBank('canvas'));
        expect(hits).toHaveLength(64);
        for (const h of hits) {
          expect(h.frame, `tap ${h.tap}`).toBe(frameOfSeconds(targets[h.tap]!, rate));
          expect(h.snapped).toBe(true);
          expect(Math.abs(h.movedMs)).toBeLessThanOrEqual(60);
        }
      }
    });
  }
  it('strength 0, 0.5 and 1 move a tap that far toward its grid point', () => {
    const rate = { num: 30, den: 1 };
    const grid = performGrid(music(rate), S());
    const tap: Tap = { pad: 0, down: 2.05, up: 2.1 };
    const at = (strength: number) => quantiseTaps([tap], grid, S({ strength }), rate, EMPTY)[0]!;
    expect([at(0).frame, at(0).movedMs]).toEqual([frameOfSeconds(2.05, rate), 0]);
    expect([at(0.5).frame, at(0.5).movedMs]).toEqual([frameOfSeconds(2.025, rate), -25]);
    expect([at(1).frame, at(1).movedMs]).toEqual([60, -50]);
  });
  it('a tap outside the grid by more than half a period keeps its time and is flagged; snap off flags every tap', () => {
    const rate = { num: 30, den: 1 };
    const doc = music(rate, [[2, 4], [20, 4]]); // beats 2–6 s and 20–24 s
    const grid = performGrid(doc, S());
    const taps: Tap[] = [{ pad: 0, down: 1.6, up: 1.7 }, { pad: 0, down: 1.8, up: 1.9 }, { pad: 0, down: 12, up: 12.1 }, { pad: 0, down: 5.7, up: 5.8 }, { pad: 0, down: 30, up: 30.1 }];
    const hits = quantiseTaps(taps, grid, S(), rate, EMPTY);
    expect(hits.map((h) => [h.tap, h.snapped, h.frame])).toEqual([[0, false, 48], [1, true, 60], [3, true, 165], [2, false, 360], [4, false, 900]]);
    expect(quantiseTaps(taps, grid, S({ snap: 'off' }), rate, EMPTY).every((h) => !h.snapped && h.movedMs === 0)).toBe(true);
  });
  it('ties go to the earlier point; frames are never negative; hits are sorted by (frame, pad, tap)', () => {
    const rate = { num: 30, den: 1 };
    const grid = performGrid(music(rate, [[0, 10]]), S());
    const hits = quantiseTaps([{ pad: 3, down: 1.25, up: 1.3 }, { pad: 1, down: 1.2, up: 1.3 }, { pad: 1, down: 0, up: 0 }, { pad: 0, down: 1.1, up: 1.2 }], grid, S(), rate, EMPTY);
    expect(hits.map((h) => [h.tap, h.frame])).toEqual([[2, 0], [3, 30], [1, 30], [0, 30]]);
    expect(quantiseTaps([{ pad: 0, down: 0.01, up: 0.02 }], [0.5, 1, 1.5], S({ strength: 0 }), rate, EMPTY)[0]!.frame).toBe(0);
  });
  it('a hit lasts the hold, at least the pad\'s shortest length; a hold of 0.75 of a step or more ends on the grid', () => {
    const rate = { num: 30, den: 1 };
    const grid = performGrid(music(rate, [[0, 10]]), S());
    const bank: PadBank = [MOVES.find((m) => m.id === 'move.punch')!, ...Array(PAD_COUNT - 1).fill(null)]; // 0.1 s = 3 frames
    const [short, held, beat] = [{ pad: 0, down: 2.02, up: 2.03 }, { pad: 0, down: 3.02, up: 3.2 }, { pad: 0, down: 4.02, up: 4.43 }].map((t) => quantiseTaps([t], grid, S(), rate, bank)[0]!);
    expect([short!.frame, short!.frames]).toEqual([60, 3]);
    expect([held!.frame, held!.frames]).toEqual([90, 5]); // 3.2 − 0.02 = 3.18 s → frame 95
    expect([beat!.frame, beat!.frames]).toEqual([120, 15]); // a 0.41 s hold ends on the next beat, 4.5 s
  });
});
