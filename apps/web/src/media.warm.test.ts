/**
 * Prefetch in the media pool (MediaPool.warm, fitWarmBudget, prefetchBudget): warm decoders stay inside one byte budget and are
 * evicted when the plan or the budget no longer holds them; a picture that appears takes a warm decoder of its asset and quality
 * over instead of opening one; warm decoders give their slot first and never take one a drawing holds or used lately; a
 * low-memory device keeps nothing warm. The decoders are stubs (labelled: MediaPoolOptions.openDecoder is the test-only seam;
 * no Mediabunny, no browser).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import type { VideoLayer } from '@pulseframe/engine';
import { fitWarmBudget, MediaPool, prefetchBudget, warmCostBytes, type PoolDecoder, type WarmRequest } from './media.ts';

const MB = 1 << 20;
/** A stub pool: a byte cache of 1 MB, so a 640x360 warm decoder counts 1 MB + 640·360·4·8 bytes (about 8 MB). */
function stubPool(maxDecoders: number, previewUrl?: (id: string) => Promise<string | null>) {
  const opened: { name: string; src: string | Blob }[] = [];
  const disposed: string[] = [];
  const asked: { name: string; seconds: number }[] = [];
  let hold: Promise<void> | null = null;
  const pool = new MediaPool({
    assetUrl: (id) => `/stub/${id}`,
    ...(previewUrl ? { previewUrl } : {}),
    maxDecoders,
    decoderByteCache: MB,
    openDecoder: async (src, w) => {
      const name = `${w.clipId}:${w.quality}:${w.lane}`;
      opened.push({ name, src });
      const dec: PoolDecoder = {
        frame: async (seconds) => { asked.push({ name, seconds }); if (hold) await hold; return { draw: () => {}, seconds } as never; },
        dispose: async () => { disposed.push(name); },
      };
      return dec;
    },
  });
  return { pool, opened, disposed, asked, block: () => { let open!: () => void; hold = new Promise((r) => { open = () => { hold = null; r(); }; }); return () => open(); } };
}
const layer = (clipId: string, assetId: string, frame = 0): VideoLayer => ({
  kind: 'video', clipId, trackId: 'trk', assetId, sourceTime: T.frameTime(frame, { num: 30, den: 1 }), sourceFrameIndex: frame, sourceSeekSeconds: (frame + 0.5) / 30,
  sourceWidth: 640, sourceHeight: 360, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
});
const req = (assetId: string, seconds = 1, quality: 'draft' | 'full' = 'full', width = 640, height = 360): WarmRequest => ({ assetId, quality, seconds, width, height });
const draw = async (pool: MediaPool, layers: VideoLayer[], draft = false) => {
  const frames = draft ? pool.draftFrames : pool.frames;
  const token = frames.begin!();
  try { return await Promise.all(layers.map((l) => frames(l))); } finally { frames.end!(token); }
};
const settle = () => new Promise((r) => setTimeout(r, 0));
const ONE = warmCostBytes(640, 360, MB);

afterEach(() => vi.restoreAllMocks());

describe('fitWarmBudget (the eviction rule)', () => {
  const cost = (r: WarmRequest) => warmCostBytes(r.width, r.height, MB);
  it('keeps requests in order while they fit, skips one that does not, and lets a cheaper later one in', () => {
    const big = req('ast_4k', 1, 'full', 3840, 2160);
    const { keep, over } = fitWarmBudget([req('ast_a'), big, req('ast_b'), req('ast_c')], 2 * ONE + 1, cost);
    expect(keep.map((r) => r.assetId)).toEqual(['ast_a', 'ast_b']);
    expect(over.map((r) => r.assetId)).toEqual(['ast_4k', 'ast_c']);
    expect(keep.reduce((a, r) => a + cost(r), 0)).toBeLessThanOrEqual(2 * ONE + 1);
  });
  it('one decoder per asset and quality: the first request of each wins', () => {
    const { keep } = fitWarmBudget([req('ast_a', 3), req('ast_a', 9), req('ast_a', 9, 'draft')], 10 * ONE, cost);
    expect(keep.map((r) => [r.assetId, r.quality, r.seconds])).toEqual([['ast_a', 'full', 3], ['ast_a', 'draft', 9]]);
  });
  it('a budget of 0 keeps nothing', () => {
    expect(fitWarmBudget([req('ast_a')], 0, cost).keep).toEqual([]);
  });
});

describe('prefetchBudget (the device\'s budget and the low-memory fallback)', () => {
  it('under 2 GB nothing is kept warm, and says why', () => {
    expect(prefetchBudget(1)).toEqual({ bytes: 0, off: 'low_memory' });
    expect(prefetchBudget(0.5)).toEqual({ bytes: 0, off: 'low_memory' });
  });
  it('2–4 GB and an unreported size get a small budget; 4 GB and more a larger one', () => {
    expect(prefetchBudget(2)).toEqual({ bytes: 64 * MB, off: null });
    expect(prefetchBudget(undefined)).toEqual({ bytes: 64 * MB, off: null });
    expect(prefetchBudget(8)).toEqual({ bytes: 160 * MB, off: null });
  });
});

describe('MediaPool.warm', () => {
  it('opens a warm decoder per kept request on the source a fresh decoder would read, decodes up to the time asked, and stays within the budget', async () => {
    const { pool, opened, asked } = stubPool(10, async (id) => (id === 'ast_b' ? `/proxy/${id}` : null));
    const st = pool.warm([req('ast_a', 2), req('ast_b', 3, 'draft'), req('ast_c', 4)], 2 * ONE);
    await settle();
    expect(opened.map((o) => [o.name, o.src])).toEqual([['warm:ast_a:full:0', '/stub/ast_a'], ['warm:ast_b:draft:0', '/proxy/ast_b']]);
    expect(asked).toEqual([{ name: 'warm:ast_a:full:0', seconds: 2 }, { name: 'warm:ast_b:draft:0', seconds: 3 }]);
    expect(st).toMatchObject({ decoders: 2, bytes: 2 * ONE, budgetBytes: 2 * ONE, overBudget: 1, opened: 2, off: null });
    expect(pool.stats().opened).toBe(0); // no decoder of a drawing was opened
  });

  it('evicts (disposes) a warm decoder the next plan no longer holds, and keeps the ones it still does', async () => {
    const { pool, opened, disposed } = stubPool(10);
    pool.warm([req('ast_a'), req('ast_b')], 3 * ONE);
    pool.warm([req('ast_b', 2), req('ast_c')], 3 * ONE);
    await settle();
    expect(disposed).toEqual(['warm:ast_a:full:0']);
    expect(opened.map((o) => o.name)).toEqual(['warm:ast_a:full:0', 'warm:ast_b:full:0', 'warm:ast_c:full:0']);
    expect(pool.stats().warm).toMatchObject({ decoders: 2, evicted: 1 });
    // a smaller budget evicts the least wanted first
    pool.warm([req('ast_b', 3), req('ast_c', 3)], ONE);
    await settle();
    expect(disposed).toEqual(['warm:ast_a:full:0', 'warm:ast_c:full:0']);
    expect(pool.stats().warm.bytes).toBeLessThanOrEqual(ONE);
    // nothing to warm (paused): everything goes
    pool.warm([], 160 * MB);
    await settle();
    expect(disposed).toEqual(['warm:ast_a:full:0', 'warm:ast_c:full:0', 'warm:ast_b:full:0']);
    expect(pool.stats().warm).toMatchObject({ decoders: 0, bytes: 0 });
  });

  it('a low-memory budget keeps nothing and reports why', async () => {
    const { pool, opened } = stubPool(10);
    const b = prefetchBudget(1);
    const st = pool.warm([req('ast_a')], b.bytes, b.off);
    await settle();
    expect(opened).toEqual([]);
    expect(st).toMatchObject({ decoders: 0, budgetBytes: 0, off: 'low_memory', overBudget: 1 });
  });

  it('a clip that appears takes over the warm decoder of its asset and quality instead of opening one; another quality does not', async () => {
    const { pool, opened, asked } = stubPool(10);
    pool.warm([req('ast_a', (59 + 0.5) / 30)], 4 * ONE);
    await settle();
    const [pic] = await draw(pool, [layer('clp_new', 'ast_a', 60)]);
    expect(pic).not.toBeNull();
    expect(opened.map((o) => o.name)).toEqual(['warm:ast_a:full:0']); // nothing new was opened for clp_new
    expect(asked.at(-1)).toEqual({ name: 'warm:ast_a:full:0', seconds: (60 + 0.5) / 30 }); // and it was asked for the clip's own frame
    expect(pool.stats()).toMatchObject({ decoders: 1, opened: 0, warm: { decoders: 0, adopted: 1 } });
    await draw(pool, [layer('clp_new', 'ast_a', 61)], true); // draft: a different source, so a decoder of its own
    expect(opened.map((o) => o.name)).toEqual(['warm:ast_a:full:0', 'clp_new:draft:0']);
  });

  it('warm decoders give their slot first: a drawing never gets decode_budget because of them', async () => {
    const { pool, disposed } = stubPool(3);
    pool.warm([req('ast_x'), req('ast_y'), req('ast_z')], 10 * ONE);
    await settle();
    expect(pool.stats().warm.decoders).toBe(3);
    const got = await draw(pool, [layer('clp_1', 'ast_a'), layer('clp_2', 'ast_b')]);
    await settle();
    expect(got.every((x) => x !== null)).toBe(true);
    expect(pool.stats()).toMatchObject({ refused: 0, decoders: 2, warm: { decoders: 1, gaveRoom: 2 } });
    expect(disposed).toEqual(['warm:ast_z:full:0', 'warm:ast_y:full:0']); // the least wanted first
    expect(pool.stats().peakDecoders).toBeLessThanOrEqual(3);
  });

  it('a decoder no drawing used lately gives its slot to a new picture before a warm one does', async () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const { pool, disposed } = stubPool(3);
    await draw(pool, [layer('clp_old', 'ast_old')]);
    t += MediaPool.STALE_MS;
    pool.warm([req('ast_x'), req('ast_y')], 10 * ONE);
    await settle();
    expect(pool.stats()).toMatchObject({ decoders: 1, warm: { decoders: 2 } });
    await draw(pool, [layer('clp_new', 'ast_new')]);
    await settle();
    expect(disposed).toEqual(['clp_old:full:0']);
    expect(pool.stats()).toMatchObject({ refused: 0, decoders: 1, warm: { decoders: 2, gaveRoom: 0 } });
    // with nothing stale left, a warm decoder gives its slot rather than a picture being refused
    await draw(pool, [layer('clp_new', 'ast_new', 1), layer('clp_two', 'ast_two')]);
    await settle();
    expect(pool.stats()).toMatchObject({ refused: 0, decoders: 2, warm: { decoders: 1, gaveRoom: 1 } });
    expect(disposed).toEqual(['clp_old:full:0', 'warm:ast_y:full:0']);
  });

  it('never takes the slot of a decoder a drawing used lately; a stale one gives its slot, or becomes the warm decoder of its own asset', async () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const { pool, opened, disposed } = stubPool(2);
    await draw(pool, [layer('clp_1', 'ast_a'), layer('clp_2', 'ast_b')]);
    let st = pool.warm([req('ast_c')], 10 * ONE);
    expect(st).toMatchObject({ decoders: 0, noRoom: 1 }); // both slots were used this very moment
    t += MediaPool.STALE_MS;
    await draw(pool, [layer('clp_2', 'ast_b', 1)]); // clp_2 is still drawn; clp_1 is not
    st = pool.warm([req('ast_c')], 10 * ONE);
    await settle();
    expect(st).toMatchObject({ decoders: 1, noRoom: 0 });
    expect(disposed).toEqual(['clp_1:full:0']); // the stale one gave its slot
    t += MediaPool.STALE_MS;
    // clp_2 left the screen: as a warm decoder of ast_b it is taken over, not reopened
    st = pool.warm([req('ast_b', 5), req('ast_c')], 10 * ONE);
    expect(st).toMatchObject({ decoders: 2, reused: 1 });
    expect(opened.map((o) => o.name)).toEqual(['clp_1:full:0', 'clp_2:full:0', 'warm:ast_c:full:0']);
    expect(pool.stats().decoders).toBe(0);
  });

  it('does not queue warm decodes: a decode still running is not asked for again', async () => {
    const { pool, asked, block } = stubPool(4);
    pool.warm([req('ast_a', 1)], 4 * ONE);
    await settle();
    const release = block();
    pool.warm([req('ast_a', 1.1)], 4 * ONE);
    await settle();
    for (let i = 0; i < 20; i++) pool.warm([req('ast_a', 1.2 + i / 30)], 4 * ONE);
    await settle();
    expect(asked.map((a) => a.seconds)).toEqual([1, 1.1]);
    release();
    await settle();
    pool.warm([req('ast_a', 2)], 4 * ONE);
    await settle();
    expect(asked.map((a) => a.seconds)).toEqual([1, 1.1, 2]);
  });

  it('an asset made invalid (its proxy became ready, or it was replaced) loses its warm decoder too', async () => {
    const { pool, disposed } = stubPool(4);
    pool.warm([req('ast_a')], 4 * ONE);
    pool.invalidate('ast_a');
    await settle();
    expect(disposed).toEqual(['warm:ast_a:full:0']);
    expect(pool.stats().warm.decoders).toBe(0);
  });

  it('never holds more decoders than its budget, and refuses a picture only when one drawing needs more than the budget (random warm plans and drawings)', async () => {
    const { pool } = stubPool(5);
    let s = 7;
    const rnd = (n: number) => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 8) % n;
    for (let i = 0; i < 300; i++) {
      if (rnd(2)) pool.warm(Array.from({ length: rnd(5) }, () => req(`ast_${rnd(6)}`, rnd(100) / 30, rnd(3) ? 'full' : 'draft')), rnd(6) * ONE);
      const need = Array.from({ length: 1 + rnd(4) }, () => layer(`clp_${rnd(8)}`, `ast_${rnd(6)}`, rnd(100)));
      const refusedBefore = pool.stats().refused;
      await draw(pool, need, rnd(2) === 1);
      const st = pool.stats();
      expect(st.decoders + st.warm.decoders).toBeLessThanOrEqual(5);
      expect(st.warm.bytes).toBeLessThanOrEqual(st.warm.budgetBytes);
      if (st.refused > refusedBefore) expect(new Set(need.map((l) => l.clipId)).size).toBeGreaterThan(5);
    }
    expect(pool.stats().peakDecoders).toBeLessThanOrEqual(5);
  });
});
