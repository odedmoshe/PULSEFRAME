/**
 * Decode lanes of the media pool (ADR-0011): one decoder per clip, quality and lane; the decoders a drawing uses are pinned
 * until the next one begins; a frame that needs more decoders than the budget gets null for the extra pictures with the
 * reason `decode_budget`, never a rejection; the pool never holds more decoders than its budget.
 * The decoders are stubs (labelled as such: MediaPoolOptions.openDecoder is a test-only seam; no Mediabunny, no browser).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { isDecodeBudgetReason, type VideoLayer } from '@pulseframe/engine';
import { MediaPool, type PoolDecoder } from './media.ts';

/** A stub decoder: answers every request with a picture that names its key and the time asked for. */
function stubPool(maxDecoders: number) {
  const opened: string[] = [];
  const disposed: string[] = [];
  const asked: { key: string; seconds: number }[] = [];
  const pool = new MediaPool({
    assetUrl: (id) => `/stub/${id}`,
    maxDecoders,
    openDecoder: async (src, w) => {
      const key = `${w.clipId}:${w.quality}:${w.lane}`;
      expect(src).toBe(`/stub/${w.assetId}`);
      opened.push(key);
      const dec: PoolDecoder = {
        frame: async (seconds) => { asked.push({ key, seconds }); return { draw: () => {}, key, seconds } as never; },
        dispose: async () => { disposed.push(key); },
      };
      return dec;
    },
  });
  return { pool, opened, disposed, asked };
}
const layer = (clipId: string, lane = 0, frame = 0, assetId = 'ast_v'): VideoLayer => ({
  kind: 'video', clipId, trackId: 'trk', assetId, sourceTime: T.frameTime(frame, { num: 30, den: 1 }), sourceFrameIndex: frame, sourceSeekSeconds: (frame + 0.5) / 30,
  sourceWidth: 640, sourceHeight: 360, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, ...(lane ? { lane } : {}),
});
/** One drawing as drawGraph makes it: begin, then every picture asked for at once. */
const draw = (pool: MediaPool, layers: VideoLayer[], draft = false) => {
  const frames = draft ? pool.draftFrames : pool.frames;
  frames.begin!();
  return Promise.all(layers.map((l) => frames(l)));
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('decode lanes', () => {
  it('every lane of a clip has its own decoder, at each quality; asking again reuses it', async () => {
    const { pool, opened, asked } = stubPool(12);
    const lanes = [0, 1, 2, 3, 4].map((k) => layer('clp_a', k, 30 - 3 * k));
    const got = await draw(pool, lanes);
    expect(got.every((x) => x !== null)).toBe(true);
    expect(opened).toEqual(['clp_a:full:0', 'clp_a:full:1', 'clp_a:full:2', 'clp_a:full:3', 'clp_a:full:4']);
    // each lane's decoder was asked for its own picture
    expect(asked.map((a) => [a.key, a.seconds])).toEqual(lanes.map((l, k) => [`clp_a:full:${k}`, l.sourceSeekSeconds]));
    await draw(pool, lanes.map((l) => ({ ...l, sourceFrameIndex: l.sourceFrameIndex + 1, sourceSeekSeconds: l.sourceSeekSeconds + 1 / 30 })));
    expect(opened.length).toBe(5);
    await draw(pool, [layer('clp_a', 0)], true);
    expect(opened.at(-1)).toBe('clp_a:draft:0');
    expect(pool.stats()).toMatchObject({ decoders: 6, maxDecoders: 12, opened: 6, disposed: 0, refused: 0 });
  });

  it('decoders in use by the current drawing are pinned: the budget refuses an extra picture with decode_budget (null, not a rejection) instead of disposing one under the frame', async () => {
    const { pool, opened, disposed } = stubPool(3);
    const four = [0, 1, 2, 3].map((k) => layer('clp_a', k, 20 - k));
    const got = await draw(pool, four);
    expect(got.map((x) => x !== null)).toEqual([true, true, true, false]);
    expect(pool.frames.refusal!(four[3]!)).toBe('decode_budget: this frame needs more than 3 video decoders');
    expect(isDecodeBudgetReason(pool.frames.refusal!(four[3]!))).toBe(true); // how a view tells it from a load failure
    expect(isDecodeBudgetReason('colour table ast_x could not be loaded: 404')).toBe(false);
    expect(pool.frames.refusal!(four[0]!)).toBeNull();
    expect(pool.frames.refusal!({ kind: 'image', clipId: 'clp_i', trackId: 'trk', assetId: 'ast_i', sourceWidth: 1, sourceHeight: 1, transform: four[0]!.transform })).toBeNull();
    await settle();
    expect(disposed).toEqual([]);
    expect(pool.stats()).toMatchObject({ decoders: 3, peakDecoders: 3, refused: 1 });
    // the next drawing needs lanes 1–3: lane 0 is no longer pinned and is the least recently used, so it makes room
    const next = await draw(pool, [1, 2, 3].map((k) => layer('clp_a', k, 21 - k)));
    expect(next.every((x) => x !== null)).toBe(true);
    await settle();
    expect(disposed).toEqual(['clp_a:full:0']);
    expect(opened).toEqual(['clp_a:full:0', 'clp_a:full:1', 'clp_a:full:2', 'clp_a:full:3']);
    expect(pool.frames.refusal!(four[3]!)).toBeNull(); // the reason is for the last request only
    expect(pool.stats().decoders).toBe(3);
  });

  it('three overlapping clips with five lanes each do not fit a budget of 12: the layers\' own pictures come first and the refused ones are the extra lanes', async () => {
    const { pool } = stubPool(12);
    const clips = ['clp_a', 'clp_b', 'clp_c'];
    // drawGraph asks for every layer's own picture first, then the taps
    const order = [...clips.map((c) => layer(c, 0)), ...clips.flatMap((c) => [1, 2, 3, 4].map((k) => layer(c, k, 10 - k)))];
    const got = await draw(pool, order);
    expect(got.filter((x) => x === null).length).toBe(3);
    expect(got.slice(0, 3).every((x) => x !== null)).toBe(true);
    const refusedLayers = order.filter((_, i) => got[i] === null);
    expect(refusedLayers.map((l) => `${l.clipId}:${l.lane}`)).toEqual(['clp_c:2', 'clp_c:3', 'clp_c:4']);
    expect(refusedLayers.every((l) => /^decode_budget: /.test(pool.frames.refusal!(l)!))).toBe(true);
    expect(pool.stats()).toMatchObject({ decoders: 12, peakDecoders: 12 });
  });

  it('never holds more decoders than its budget, however the drawings come (random lanes, clips and qualities)', async () => {
    const { pool } = stubPool(6);
    let s = 3;
    const rnd = (n: number) => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) % n;
    for (let i = 0; i < 300; i++) {
      const need = Array.from({ length: 1 + rnd(8) }, () => layer(`clp_${rnd(4)}`, rnd(5), rnd(100)));
      const got = await draw(pool, need, rnd(2) === 1);
      expect(pool.stats().decoders).toBeLessThanOrEqual(6);
      // whatever was refused was refused because the drawing needed more than six different decoders
      const distinct = new Set(need.map((l) => `${l.clipId}:${l.lane ?? 0}`)).size;
      if (got.some((x) => x === null)) expect(distinct).toBeGreaterThan(6);
      else expect(distinct).toBeLessThanOrEqual(6);
    }
    expect(pool.stats().peakDecoders).toBeLessThanOrEqual(6);
  });

  it('a lane whose clip now shows another asset gets a new decoder; the old one is disposed', async () => {
    const { pool, opened, disposed } = stubPool(4);
    await draw(pool, [layer('clp_a', 1, 5, 'ast_one')]);
    await draw(pool, [layer('clp_a', 1, 5, 'ast_two')]);
    await settle();
    expect(opened).toEqual(['clp_a:full:1', 'clp_a:full:1']);
    expect(disposed).toEqual(['clp_a:full:1']);
    expect(pool.stats()).toMatchObject({ decoders: 1, opened: 2, disposed: 1 });
  });

  it('the editor\'s default budget is 10 decoders', () => {
    expect(new MediaPool({ assetUrl: (id) => id }).stats().maxDecoders).toBe(10);
  });
});
