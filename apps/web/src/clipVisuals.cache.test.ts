import { describe, expect, it } from 'vitest';
import { ClipDerivativeCache, clipDerivativeKey, type ClipDerivativeKey } from './clipVisuals.cache.ts';
import type { ThumbMeta } from './editor/mediaThumb.ts';

// ---- a labelled stand-in for the server and the browser (test only): derivative rows per asset, counted requests, countable pictures ----
interface FakeBitmap { n: number; closed: boolean; close(): void }
const META: ThumbMeta = { tileWidth: 160, tileHeight: 90, columns: 10, rows: 6, frameIndices: Array.from({ length: 60 }, (_, i) => i * 30) };
const WAVE = { sampleRate: 48000, totalSamples: 480000, levels: [{ samplesPerBucket: 256, buckets: 1875, byteOffset: 0 }] };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

function world(limit?: number) {
  const rows = new Map<string, string>(); // `${assetId}|${kind}` -> status
  const count = { list: 0, blob: 0, decoded: 0, closed: 0 };
  const timers: { fn: () => void; ms: number }[] = [];
  let listOk = true;
  let hold: Promise<void> | null = null;
  let decodeGate: Promise<void> | null = null;
  const bitmaps: FakeBitmap[] = [];
  const cache = new ClipDerivativeCache<FakeBitmap>({
    limit,
    fetch: async (url, signal) => {
      const m = /\/projects\/([^/]+)\/assets\/([^/]+)\/derivatives(?:\/(\w+))?$/.exec(url);
      if (!m) throw new Error(`unexpected url ${url}`);
      const asset = decodeURIComponent(m[2]!), kind = m[3];
      if (kind) count.blob++; else count.list++;
      const then = new Map(rows);
      const status = (k: string) => then.get(`${asset}|${k}`);
      await new Promise((r) => setImmediate(r));
      if (hold) await hold;
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (!kind) return { ok: listOk, status: listOk ? 200 : 503, json: async () => ({ derivatives: ['thumbnails', 'waveform'].filter((k) => status(k)).map((k) => ({ kind: k, status: status(k)!, meta: status(k) === 'ready' ? (k === 'thumbnails' ? META : WAVE) : null })) }), blob: async () => new Blob(), arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: status(kind) === 'ready', json: async () => ({}), blob: async () => new Blob(['jpeg']), arrayBuffer: async () => new ArrayBuffer(8) };
    },
    decode: async () => {
      await new Promise((r) => setImmediate(r));
      if (decodeGate) await decodeGate;
      const b: FakeBitmap = { n: ++count.decoded, closed: false, close() { if (this.closed) throw new Error('closed twice'); this.closed = true; count.closed++; } };
      bitmaps.push(b);
      return b;
    },
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (h) => { const i = timers.indexOf(h as (typeof timers)[number]); if (i >= 0) timers.splice(i, 1); },
  });
  const key = (assetId: string, kind: 'thumbnails' | 'waveform' = 'thumbnails', contentHash = `sha256:${assetId}`): ClipDerivativeKey => ({ projectId: 'p1', assetId, contentHash, kind });
  return {
    cache, rows, count, timers, bitmaps, key,
    peek: (k: ClipDerivativeKey) => cache.peek(clipDerivativeKey(k)),
    set: (assetId: string, status: string, kind: 'thumbnails' | 'waveform' = 'thumbnails') => void rows.set(`${assetId}|${kind}`, status),
    failLists: (fail: boolean) => { listOk = !fail; },
    holdRequests: () => { let open!: () => void; hold = new Promise<void>((r) => { open = r; }); return () => { hold = null; open(); }; },
    holdDecoding: () => { let open!: () => void; decodeGate = new Promise<void>((r) => { open = r; }); return () => { decodeGate = null; open(); }; },
    fireTimer: () => { const t = timers.shift(); if (!t) throw new Error('no timer pending'); t.fn(); return t.ms; },
  };
}

describe('timeline clip visuals: one derivative per file, loaded once', () => {
  it('twelve clips of one file make one list request, one download and one decode; re-renders, remounts, edits and playback ask nothing more', async () => {
    const w = world();
    w.set('a', 'ready');
    const ends = Array.from({ length: 12 }, () => w.cache.use(w.key('a')));
    await settle();
    expect(w.count).toEqual({ list: 1, blob: 1, decoded: 1, closed: 0 });
    const shown = w.peek(w.key('a'));
    expect(shown).toMatchObject({ state: 'ready', kind: 'thumbnails', meta: META });
    // what a re-render does (a playback tick, an unrelated edit): read the snapshot again. It is the same object, and asks nothing.
    for (let i = 0; i < 100; i++) expect(w.peek(w.key('a'))).toBe(shown);
    // a clip that is cut or moved to another track is mounted again: its derivative is still held
    ends[0]!(); const again = w.cache.use(w.key('a'));
    for (const end of ends) end(); again();
    const back = w.cache.use(w.key('a')); // an undo brings the clips back after all of them were gone
    await settle();
    expect(w.peek(w.key('a'))).toBe(shown);
    expect(w.count).toEqual({ list: 1, blob: 1, decoded: 1, closed: 0 });
    back();
  });

  it('a derivative event of another file costs nothing; one of this file costs nothing once it is held', async () => {
    const w = world();
    w.set('a', 'ready');
    const end = w.cache.use(w.key('a'));
    await settle();
    for (let i = 0; i < 50; i++) { w.cache.changed('p1', 'b'); w.cache.changed('p1', 'a'); w.cache.changed('p2', 'a'); }
    await settle();
    expect(w.count).toEqual({ list: 1, blob: 1, decoded: 1, closed: 0 });
    end();
  });

  it('a derivative being made is shown as such; it looks again on an event for its own file, a bounded number of times on a timer, and downloads only once ready', async () => {
    const w = world();
    w.set('v', 'running');
    const end = w.cache.use(w.key('v'));
    await settle();
    expect(w.peek(w.key('v'))).toEqual({ state: 'processing' });
    expect(w.count).toMatchObject({ list: 1, blob: 0 });
    w.cache.changed('p1', 'other');
    await settle();
    expect(w.count).toMatchObject({ list: 1, blob: 0 });
    // no event: it looks again after 1, 3 and 8 seconds, then waits for an event
    expect([w.fireTimer(), (await settle(), w.fireTimer()), (await settle(), w.fireTimer())]).toEqual([1000, 3000, 8000]);
    await settle();
    expect(w.timers).toEqual([]);
    expect(w.count).toMatchObject({ list: 4, blob: 0 });
    w.set('v', 'ready');
    w.cache.changed('p1', 'v');
    await settle();
    expect(w.peek(w.key('v'))).toMatchObject({ state: 'ready' });
    expect(w.count).toMatchObject({ list: 5, blob: 1, decoded: 1 });
    end();
  });

  it('an event that arrives while a look is in flight is not lost: one more look follows, not one per event', async () => {
    const w = world();
    w.set('v', 'running');
    const open = w.holdRequests();
    const end = w.cache.use(w.key('v'));
    await settle();
    w.set('v', 'ready'); // made while the first answer (which said "running") is on its way
    for (let i = 0; i < 5; i++) w.cache.changed('p1', 'v');
    open();
    await settle();
    expect(w.peek(w.key('v'))).toMatchObject({ state: 'ready' });
    expect(w.count).toMatchObject({ list: 2, blob: 1 });
    end();
  });

  it('a file that is imported twice shares its derivatives: the event names the first asset, the clips of the second look again too', async () => {
    const w = world();
    w.set('a1', 'running'); w.set('a2', 'running');
    const e1 = w.cache.use(w.key('a1', 'thumbnails', 'sha256:same')), e2 = w.cache.use(w.key('a2', 'thumbnails', 'sha256:same'));
    await settle();
    w.set('a1', 'ready'); w.set('a2', 'ready');
    w.cache.changed('p1', 'a1');
    await settle();
    expect(w.peek(w.key('a2', 'thumbnails', 'sha256:same'))).toMatchObject({ state: 'ready' });
    e1(); e2();
  });

  it('what does not apply, and what failed, is said as the server says it; a failed look is tried again by an event or a clip that comes back', async () => {
    const w = world();
    const none = w.cache.use(w.key('img'));
    w.set('s', 'ready', 'waveform');
    const wave = w.cache.use(w.key('s', 'waveform'));
    await settle();
    w.failLists(true);
    const broken = w.cache.use(w.key('x'));
    await settle();
    expect(w.peek(w.key('img'))).toEqual({ state: 'none' });
    expect(w.peek(w.key('s', 'waveform'))).toMatchObject({ state: 'ready', kind: 'waveform', meta: WAVE });
    expect(w.peek(w.key('x'))).toEqual({ state: 'failed' });
    expect(w.timers).toEqual([]); // a failure does not poll
    w.failLists(false); w.set('x', 'ready');
    const lists = w.count.list;
    const another = w.cache.use(w.key('x')); // a clip of that file is mounted
    await settle();
    expect(w.peek(w.key('x'))).toMatchObject({ state: 'ready' });
    expect(w.count.list).toBe(lists + 1);
    w.cache.changed('p1', 'img'); // settled as not applicable: asks nothing
    await settle();
    expect(w.count.list).toBe(lists + 1);
    none(); wave(); broken(); another();
  });

  it('is bounded: files no clip shows are dropped beyond the limit (oldest first) and their pictures closed; files on the timeline never are', async () => {
    const w = world(2);
    for (const a of ['a', 'b', 'c', 'd', 'e']) w.set(a, 'ready');
    // five files on the timeline at once, with a limit of two idle ones: all are kept while they are shown
    const ends = ['a', 'b', 'c', 'd', 'e'].map((a) => w.cache.use(w.key(a)));
    await settle();
    expect(w.count).toMatchObject({ list: 5, blob: 5, decoded: 5, closed: 0 });
    // a redraw of every clip (zoom) reads what is held: no download again (the old per-page cache of 24 thrashed here)
    for (const a of ['a', 'b', 'c', 'd', 'e']) expect(w.peek(w.key(a))).toMatchObject({ state: 'ready' });
    expect(w.count.blob).toBe(5);
    // the clips go away one after another: two idle files are kept, the older ones dropped and closed
    for (const end of ends) end();
    expect(w.cache.size).toBe(2);
    expect(w.count.closed).toBe(3);
    expect(w.bitmaps.filter((b) => b.closed).map((b) => b.n)).toEqual([1, 2, 3]);
    expect(w.peek(w.key('a'))).toBeUndefined();
    expect(w.peek(w.key('e'))).toMatchObject({ state: 'ready' });
    w.cache.clear();
    expect(w.count.closed).toBe(5);
  });

  it('a file dropped while its requests are on their way aborts them; one dropped while its picture is decoded closes that picture', async () => {
    const w = world(0);
    w.set('a', 'ready');
    const end = w.cache.use(w.key('a'));
    await new Promise((r) => setImmediate(r)); // the list request is on its way
    end(); // gone at once, nothing kept (limit 0)
    await settle();
    expect(w.cache.size).toBe(0);
    expect(w.count).toMatchObject({ decoded: 0, closed: 0 }); // the download that had started was aborted: nothing decoded
    const blobs = w.count.blob;
    const open = w.holdDecoding();
    const end2 = w.cache.use(w.key('a'));
    await settle(); // list and download done, the decode is waiting
    expect(w.count).toMatchObject({ blob: blobs + 1, decoded: 0 });
    end2();
    open();
    await settle();
    expect(w.count).toMatchObject({ decoded: 1, closed: 1 });
    expect(w.peek(w.key('a'))).toBeUndefined();
  });
});
