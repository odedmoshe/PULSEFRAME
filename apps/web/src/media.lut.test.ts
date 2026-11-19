/**
 * How the media pool supplies colour tables (MediaPool.lut): parsed once, a failure neither kept for good nor repeated for
 * every drawn frame, a file that was put right picked up again, an oversized file never read into memory.
 * The server is a stub of `fetch` (labelled as such: no real route is involved here).
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LUT_MAX_TEXT_LENGTH, LutError, identityLut, lutStrip, serializeCube } from '@pulseframe/core';
import { MediaPool } from './media.ts';

const table = serializeCube({ ...identityLut(5), title: 'stub' });
let now = 0;
let served: () => Response;
let requests: RequestInit[] = [];
let reads = 0;
const pool = () => new MediaPool({ assetUrl: (id) => `/stub/${id}` });
/** Ask as a player would: once per drawn frame, `frames` times, with `ms` between frames. Returns how each request ended. */
async function frames(p: MediaPool, count: number, ms = 33) {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(await p.frames.lut!('ast_table').then(() => 'ok', (e) => String((e as Error).message)));
    now += ms;
  }
  return out;
}

beforeEach(() => {
  now = 1000; requests = []; reads = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { requests.push(init); return served(); });
  const read = Blob.prototype.arrayBuffer;
  vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) { reads++; return read.call(this); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('MediaPool.lut', () => {
  it('gives core lutStrip of the file text, keyed by the content hash, read and parsed once however often it is asked; both frame providers give the same table', async () => {
    served = () => new Response(table);
    const p = pool();
    const a = await p.frames.lut!('ast_table');
    expect(a).toEqual({ ...lutStrip(table), key: `sha256:${createHash('sha256').update(table).digest('hex')}` });
    expect(await frames(p, 20)).toEqual(Array(20).fill('ok'));
    expect(await p.draftFrames.lut!('ast_table')).toBe(a);
    expect([requests.length, reads]).toEqual([1, 1]);
  });

  it('a server error is not asked for again with every drawn frame: one request, then the same reason until a second has passed, then one more try', async () => {
    served = () => new Response('no', { status: 500 });
    const p = pool();
    const first = await frames(p, 30); // one second of playback
    expect(new Set(first)).toEqual(new Set(['asset ast_table: HTTP 500']));
    expect(requests.length).toBe(1);
    now += 100; // past the first wait
    expect(await frames(p, 30)).toEqual(first);
    expect(requests.length).toBe(2); // one more try, and the wait is now two seconds
    now += 1100;
    await frames(p, 1);
    expect(requests.length).toBe(3);
    // over a minute of playback against a server that keeps failing: a handful of requests, not one per frame
    await frames(p, 1800);
    expect(requests.length).toBeLessThanOrEqual(8);
    // the server recovers: the next try after the wait succeeds and the failure is forgotten
    served = () => new Response(table);
    now += 31_000;
    expect(await frames(p, 5)).toEqual(Array(5).fill('ok'));
  });

  it('bytes that do not parse are read once, not once per frame, and are not kept; when the stored file is put right the table loads without a new pool, asking past the browser cache', async () => {
    served = () => new Response('<html>not a table</html>');
    const p = pool();
    const bad = await frames(p, 6);
    expect(bad).toEqual(Array(6).fill('Data before LUT_3D_SIZE')); // the parser's reason, the same for every frame
    expect([requests.length, reads]).toEqual([1, 1]);
    expect(requests[0]).not.toHaveProperty('cache');
    served = () => new Response(table); // repaired on the server
    expect(await frames(p, 6)).toEqual(bad); // still inside the wait: nothing is asked or read
    expect([requests.length, reads]).toEqual([1, 1]);
    now += 1000;
    expect(await frames(p, 6)).toEqual(Array(6).fill('ok'));
    expect([requests.length, reads]).toEqual([2, 2]);
    expect(requests[1]).toMatchObject({ cache: 'reload' }); // not the copy the browser cached for an hour
  });

  it('a file larger than a .cube may be is refused before it is read into memory', async () => {
    served = () => new Response(new Uint8Array(LUT_MAX_TEXT_LENGTH + 1));
    const p = pool();
    const e = await p.lut('ast_table').then(() => null, (x) => x);
    expect(e).toBeInstanceOf(LutError);
    expect(e.code).toBe('too_large');
    expect(reads).toBe(0);
  });
});
