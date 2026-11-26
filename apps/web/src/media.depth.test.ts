/**
 * How the media pool supplies a photo's drawn depth (MediaPool.depth, wave 8 living, verifier C14 d): rasterised once per record and
 * shown size, never per frame; the same strip for the full and the draft provider (and so for the render page, which uses the
 * pool's `frames`); a texture key that starts with `depth:` and names the grid size; a failure not kept.
 * TEST STAND-IN, labelled: core depthGrid is replaced by a counting function that returns a grid of the documented size
 * (depthGridSize) filled with one value, because its body is W1's (built in a sibling worktree). Only the caching is checked here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipDepth } from '@pulseframe/core';

const calls: { shown: { width: number; height: number } }[] = [];
let fail = false;
vi.mock('@pulseframe/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/core')>();
  return {
    ...real,
    depthGrid: (_d: ClipDepth, shown: { width: number; height: number }) => {
      calls.push({ shown });
      if (fail) throw new Error('stand-in failure');
      const s = real.depthGridSize(shown);
      return { ...s, data: new Uint8Array(s.width * s.height).fill(200) };
    },
  };
});
const { MediaPool } = await import('./media.ts');
const { depthKey } = await import('@pulseframe/core');

const DAB: ClipDepth = { v: 1, base: { kind: 'flat' }, strokes: [{ layer: 'near', size: 300, pts: [500, 500] }] };
const layer = (depth: ClipDepth | undefined, w = 640, h = 360) => ({ kind: 'image' as const, clipId: 'c1', trackId: 't1', assetId: 'a1', sourceWidth: w, sourceHeight: h, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, ...(depth ? { depth } : {}) });
const pool = () => new MediaPool({ assetUrl: (id) => `/stub/${id}` });
beforeEach(() => { calls.length = 0; fail = false; });

describe('MediaPool.depth', () => {
  it('rasterises once per record: 90 frames, both providers, one call; RGBA8 with nearness in R; key = depthKey @ grid size', async () => {
    const p = pool();
    let last = null as Awaited<ReturnType<typeof p.depth>>;
    for (let i = 0; i < 90; i++) last = await (i % 2 ? p.frames : p.draftFrames).depth!(layer(DAB));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.shown).toEqual({ width: 640, height: 360 });
    expect(last).toMatchObject({ width: 256, height: 144, key: `${depthKey(DAB)}@256x144` });
    expect(last!.key.startsWith('depth:')).toBe(true);
    expect(Array.from(last!.data.subarray(0, 8))).toEqual([200, 0, 0, 0, 200, 0, 0, 0]);
  });
  it('another drawing or another picture shape is another grid; an equal record is the same one', async () => {
    const p = pool();
    await p.depth(layer(DAB));
    await p.depth(layer(structuredClone(DAB)));
    expect(calls).toHaveLength(1);
    const portrait = await p.depth(layer(DAB, 360, 640));
    expect(portrait).toMatchObject({ width: 144, height: 256 });
    await p.depth(layer({ ...DAB, strokes: [{ layer: 'far', size: 300, pts: [500, 500] }] }));
    expect(calls).toHaveLength(3);
  });
  it('no depth: null without rasterising; a failure rejects and is tried again on the next frame (not kept)', async () => {
    const p = pool();
    expect(await p.depth(layer(undefined))).toBeNull();
    expect(calls).toHaveLength(0);
    fail = true;
    await expect(p.depth(layer(DAB))).rejects.toThrow('stand-in failure');
    fail = false;
    await expect(p.depth(layer(DAB))).resolves.toMatchObject({ width: 256 });
    expect(calls).toHaveLength(2);
  });
  it('keeps at most MAX_DEPTHS records; the least recently used goes first; dispose empties it', async () => {
    const { MAX_DEPTHS } = await import('./media.ts');
    const p = pool();
    const rec = (i: number): ClipDepth => ({ v: 1, base: { kind: 'ramp', horizon: i }, strokes: [] });
    for (let i = 0; i < MAX_DEPTHS; i++) await p.depth(layer(rec(i)));
    await p.depth(layer(rec(0))); // used again: now the most recent
    await p.depth(layer(rec(MAX_DEPTHS))); // pushes out rec(1)
    const before = calls.length;
    await p.depth(layer(rec(0)));
    expect(calls.length).toBe(before);
    await p.depth(layer(rec(1)));
    expect(calls.length).toBe(before + 1);
    await p.dispose();
    await p.depth(layer(rec(0)));
    expect(calls.length).toBe(before + 2);
  });
});
