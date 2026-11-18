/**
 * The render cache's segment store (ADR-0024 §6): file layout and sidecar, integrity on open, LRU eviction, pins, the three
 * limits of trim (cap, ceiling, minimum free) with numbers, put's null for lack of room, reconcile, purgeProject, the clean
 * self-check counter per engine fingerprint. The "videos" here are plain bytes: the store never decodes them.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { FlashCells } from '@pulseframe/engine';
import { SEGMENT_SIDECAR_MAGIC, SegmentStore, type SegmentStoreOptions } from './segmentStore.ts';

const dirs: string[] = [];
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
const stores: SegmentStore[] = [];
afterAll(() => { for (const s of stores) { try { s.close(); } catch { /* closed */ } } for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const key = (name: string) => sha(`key:${name}`);
const cellsOf = (frames: number, v = 0.25): FlashCells[] => Array.from({ length: frames }, () => ({ cols: 2, rows: 2, rgb: new Float32Array(12).fill(v) }));

function makeStore(over: Partial<SegmentStoreOptions> = {}) {
  const root = tmp('pf-segstore-');
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  let t = 1000;
  const clock = { now: () => t, tick: (n = 1) => { t += n; } };
  const opts: SegmentStoreOptions = { dir: path.join(root, 'render-cache'), capBytes: 1 << 30, autoClear: true, minFreeBytes: 0, quota: () => ({ quotaBytes: 0, otherBytes: 0 }), freeDiskBytes: () => 1e15, now: clock.now, ...over };
  const store = new SegmentStore(opts);
  stores.push(store);
  let n = 0;
  /** Puts a segment of `frames` frames whose video is `bytes` bytes; returns its key. */
  const put = async (name: string, o: { bytes?: number; frames?: number; projectId?: string; renderMs?: number; pin?: ReturnType<SegmentStore['pin']> } = {}) => {
    const frames = o.frames ?? 3;
    const file = path.join(work, `v${n++}.mp4`);
    fs.writeFileSync(file, Buffer.alloc(o.bytes ?? 1000, n & 255));
    const pin = o.pin ?? store.pin([]);
    const k = key(name);
    const h = await store.put(k, { videoFile: file, frames, width: 64, height: 36, rgbaSha256: Array.from({ length: frames }, (_, i) => sha(`${name}:${i}`)), ptsOffsetTicks: 2002, cells: cellsOf(frames), renderMs: o.renderMs ?? 30 * frames, projectId: o.projectId ?? 'prj_a' }, pin);
    if (!o.pin) pin.release();
    clock.tick();
    return { k, h, file };
  };
  return { store, opts, root, work, clock, put };
}
const keysIn = (s: SegmentStore, names: string[]) => names.filter((n) => s.has(key(n)));

describe('SegmentStore: put and open', () => {
  it('round-trips a segment through <dir>/<key[0..2]>/<key>.mp4 and .side (magic, u32le header length, meta JSON, cells)', async () => {
    const { store, opts, put } = makeStore();
    const { k, h, file } = await put('a', { bytes: 5000, frames: 4 });
    expect(h).not.toBeNull();
    expect(fs.existsSync(file)).toBe(false); // moved in, not copied
    const video = path.join(opts.dir, k.slice(0, 2), `${k}.mp4`);
    expect(h!.videoPath).toBe(video);
    expect(fs.statSync(video).size).toBe(5000);
    const side = fs.readFileSync(path.join(opts.dir, k.slice(0, 2), `${k}.side`));
    expect(side.toString('latin1', 0, 7)).toBe(SEGMENT_SIDECAR_MAGIC);
    const n = side.readUInt32LE(7);
    const meta = JSON.parse(side.toString('utf8', 11, 11 + n));
    expect(meta).toMatchObject({ v: 1, key: k, frames: 4, width: 64, height: 36, videoBytes: 5000, ptsOffsetTicks: 2002, cellsBytes: side.length - 11 - n });
    expect(meta.videoSha256).toBe(sha256Bytes(fs.readFileSync(video)));
    const o = await store.open(k, { verify: true });
    expect(o?.meta).toEqual(h!.meta);
    const cells = await store.readCells(k);
    expect(cells.length).toBe(4);
    expect(Array.from(cells[3]!.rgb)).toEqual(Array(12).fill(0.25));
    expect(store.status()).toMatchObject({ enabled: true, segments: 1, usedBytes: 5000 + side.length });
    expect(fs.readdirSync(path.join(opts.dir, k.slice(0, 2))).sort()).toEqual([`${k}.mp4`, `${k}.side`]); // no temp files left
  });

  it('a flipped byte in the video makes open({verify:true}) return null and removes the entry', async () => {
    const { store, put } = makeStore();
    const { k, h } = await put('a', { bytes: 4000 });
    const fd = fs.openSync(h!.videoPath, 'r+');
    const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, 1234); b[0]! ^= 0x01; fs.writeSync(fd, b, 0, 1, 1234); fs.closeSync(fd);
    expect(await store.open(k, { verify: false })).not.toBeNull(); // sizes still agree: only the hash sees it
    expect(await store.open(k, { verify: true })).toBeNull();
    expect(store.has(k)).toBe(false);
    expect(fs.existsSync(h!.videoPath)).toBe(false);
    expect(store.status().segments).toBe(0);
  });

  it('a stale entry (sidecar header of another key) or an unknown key is a miss', async () => {
    const { store, put } = makeStore();
    const a = await put('a');
    const b = await put('b');
    fs.copyFileSync(a.h!.videoPath.replace(/\.mp4$/, '.side'), b.h!.videoPath.replace(/\.mp4$/, '.side'));
    expect(await store.open(b.k, { verify: false })).toBeNull();
    expect(store.has(b.k)).toBe(false);
    expect(await store.open(key('never'), { verify: true })).toBeNull();
    expect(store.has('not-a-key')).toBe(false);
    expect(await store.open(a.k, { verify: true })).not.toBeNull();
  });

  it('put of a key already stored keeps the stored entry and pins it', async () => {
    const { store, put } = makeStore();
    const a = await put('a', { bytes: 1000 });
    const pin = store.pin([]);
    const again = await put('a', { bytes: 1000, pin });
    expect(again.h?.meta.videoSha256).toBe(a.h?.meta.videoSha256);
    expect(pin.keys.has(a.k)).toBe(true);
    expect(store.status().segments).toBe(1);
    pin.release();
  });
});

const sha256Bytes = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('SegmentStore: eviction', () => {
  it('evicts least recently used first (last_used_at, then created_at, then key)', async () => {
    const { store, put, clock } = makeStore();
    for (const n of ['a', 'b', 'c', 'd']) await put(n);
    store.touch([key('a')], 'prj_a'); clock.tick();
    const E = store.status().usedBytes / 4;
    // Shrink the cap by reopening on the same directory: 2.5 entries.
    const small = new SegmentStore({ dir: (store as any).opts.dir, capBytes: Math.floor(2.5 * E), autoClear: true, minFreeBytes: 0, quota: () => ({ quotaBytes: 0, otherBytes: 0 }), freeDiskBytes: () => 1e15, now: clock.now });
    stores.push(small);
    expect(small.trim(0)).toEqual({ evicted: 2, bytes: 2 * E });
    expect(keysIn(small, ['a', 'b', 'c', 'd'])).toEqual(['a', 'd']);
  });

  it('breaks ties of last use by creation time, then by key', async () => {
    const { store, opts, put, clock } = makeStore();
    for (const n of ['p', 'q', 'r']) await put(n);
    store.touch([key('p'), key('q'), key('r')], 'prj_a'); // one instant: all three last used at the same time
    clock.tick();
    const E = store.status().usedBytes / 3;
    const s2 = new SegmentStore({ ...opts, capBytes: Math.floor(2.5 * E) });
    stores.push(s2);
    s2.trim(0);
    expect(keysIn(s2, ['p', 'q', 'r'])).toEqual(['q', 'r']); // p was created first
  });

  it('never evicts pinned keys, and trim stops at the pinned bytes', async () => {
    const { store, opts, put } = makeStore();
    for (const n of ['a', 'b', 'c']) await put(n);
    const E = store.status().usedBytes / 3;
    const s2 = new SegmentStore({ ...opts, capBytes: 0 });
    stores.push(s2);
    const pin = s2.pin([key('a'), key('c')]);
    expect(s2.trim(0)).toEqual({ evicted: 1, bytes: E });
    expect(keysIn(s2, ['a', 'b', 'c'])).toEqual(['a', 'c']);
    expect(s2.clear()).toEqual({ removed: 0, bytes: 0, keptPinned: 2 });
    pin.release();
    expect(s2.clear()).toEqual({ removed: 2, bytes: 2 * E, keptPinned: 0 });
  });

  it('trim holds the cap, the ceiling and the minimum-free rule (numbers)', async () => {
    const base = makeStore();
    for (const n of ['a', 'b', 'c', 'd', 'e']) await base.put(n, { bytes: 10_000 });
    const B = base.store.status().usedBytes;
    const E = B / 5;
    expect(Number.isInteger(E)).toBe(true);
    const reopen = (o: Partial<SegmentStoreOptions>) => { const s = new SegmentStore({ ...base.opts, ...o }); stores.push(s); return s; };

    // Cap 3.5 E: 3 entries stay (3 E <= 3.5 E < 4 E).
    let s = reopen({ capBytes: Math.floor(3.5 * E) });
    expect(s.trim(0).evicted).toBe(2);
    expect(s.status().usedBytes).toBe(3 * E);
    s.close();

    // No ceiling (quota 0): a huge reserve evicts nothing (the term is ∞, never negative).
    s = reopen({ quota: () => ({ quotaBytes: 0, otherBytes: 123_456_789 }) });
    expect(s.trim(1e12)).toEqual({ evicted: 0, bytes: 0 });
    expect(s.status().segments).toBe(3);

    // Ceiling: quota − other − reserve = 2 E + 1 → 2 entries stay.
    const other = 50_000, reserve = 7_000;
    s = reopen({ quota: () => ({ quotaBytes: other + reserve + 2 * E + 1, otherBytes: other }) });
    expect(s.trim(reserve)).toEqual({ evicted: 1, bytes: E });
    expect(s.status().usedBytes).toBe(2 * E);
    expect(other + s.status().usedBytes + reserve).toBeLessThanOrEqual(other + reserve + 2 * E + 1);
    s.close();
  });

  it('the minimum-free rule evicts only with auto-clear on: bytes + free − minFree', async () => {
    const base = makeStore();
    for (const n of ['a', 'b', 'c', 'd', 'e']) await base.put(n, { bytes: 10_000 });
    const E = base.store.status().usedBytes / 5;
    // free = 0.5 E, minFree = 2 E: limit = 5 E + 0.5 E − 2 E = 3.5 E → 3 entries stay, free becomes 2.5 E >= 2 E.
    const off = new SegmentStore({ ...base.opts, autoClear: false, freeDiskBytes: () => Math.floor(0.5 * E), minFreeBytes: 2 * E });
    stores.push(off);
    expect(off.trim(0).evicted).toBe(0);
    off.close();
    const on = new SegmentStore({ ...base.opts, autoClear: true, freeDiskBytes: () => Math.floor(0.5 * E), minFreeBytes: 2 * E });
    stores.push(on);
    expect(on.trim(0)).toEqual({ evicted: 2, bytes: 2 * E });
    expect(on.status().usedBytes).toBe(3 * E);
  });

  it('put evicts to make room within the cap, and returns null (never throws) when no room can be made', async () => {
    const first = makeStore();
    await first.put('probe', { bytes: 10_000 });
    const E = first.store.status().usedBytes;
    const { store, put, work } = makeStore({ capBytes: Math.floor(2.5 * E) });
    for (const n of ['a', 'b', 'c']) await put(n, { bytes: 10_000 });
    expect(keysIn(store, ['a', 'b', 'c'])).toEqual(['b', 'c']);
    expect(store.status().highWaterBytes).toBe(2 * E);
    expect(store.status().highWaterBytes).toBeLessThanOrEqual(Math.floor(2.5 * E));
    // Everything pinned: no room for a third.
    const pin = store.pin([key('b'), key('c')]);
    const r = await put('d', { bytes: 10_000 });
    expect(r.h).toBeNull();
    expect(fs.existsSync(r.file)).toBe(true); // the caller keeps its file and joins from the work directory
    pin.release();
    // Larger than the cap: null.
    const big = await put('e', { bytes: 3 * E });
    expect(big.h).toBeNull();
    expect(fs.readdirSync(work)).toContain(path.basename(big.file));
  });

  it('put respects the ceiling and the minimum free disk', async () => {
    const first = makeStore();
    await first.put('probe', { bytes: 10_000 });
    const E = first.store.status().usedBytes;
    const ceiling = makeStore({ quota: () => ({ quotaBytes: 100_000 + E - 1, otherBytes: 100_000 }) });
    expect((await ceiling.put('a', { bytes: 10_000 })).h).toBeNull();
    const fits = makeStore({ quota: () => ({ quotaBytes: 100_000 + E, otherBytes: 100_000 }) });
    expect((await fits.put('a', { bytes: 10_000 })).h).not.toBeNull();
    const disk = makeStore({ autoClear: false, minFreeBytes: 1_000_000, freeDiskBytes: () => 1_000_000 + E - 1 });
    expect((await disk.put('a', { bytes: 10_000 })).h).toBeNull();
    const off = makeStore({ capBytes: 0 });
    expect((await off.put('a', { bytes: 10 })).h).toBeNull();
    expect(off.store.status().enabled).toBe(false);
  });
});

describe('SegmentStore: reconcile, purge, history', () => {
  it('reconcile removes files without rows, rows without files and stale temp files', async () => {
    const { store, opts, put } = makeStore();
    const a = await put('a');
    const b = await put('b');
    fs.rmSync(b.h!.videoPath); // row without its video
    const stray = key('stray');
    fs.mkdirSync(path.join(opts.dir, stray.slice(0, 2)), { recursive: true });
    fs.writeFileSync(path.join(opts.dir, stray.slice(0, 2), `${stray}.mp4`), 'x'); // file without a row
    fs.writeFileSync(path.join(opts.dir, a.k.slice(0, 2), '.tmp-abc.mp4'), 'partial'); // a crash mid-put
    expect(store.reconcile()).toEqual({ orphanFiles: 3, orphanRows: 1 }); // stray, temp, b's sidecar; b's row
    expect(keysIn(store, ['a', 'b'])).toEqual(['a']);
    expect(store.reconcile()).toEqual({ orphanFiles: 0, orphanRows: 0 });
    // At construction too.
    fs.writeFileSync(path.join(opts.dir, a.k.slice(0, 2), '.tmp-def.side'), 'partial');
    store.close();
    const again = new SegmentStore(opts);
    stores.push(again);
    expect(fs.readdirSync(path.join(opts.dir, a.k.slice(0, 2))).sort()).toEqual([`${a.k}.mp4`, `${a.k}.side`]);
    expect(await again.open(a.k, { verify: true })).not.toBeNull();
  });

  it('purgeProject removes segments only that project references and keeps shared ones', async () => {
    const { store, put } = makeStore();
    await put('mine', { projectId: 'prj_a' });
    await put('shared', { projectId: 'prj_a' });
    await put('theirs', { projectId: 'prj_b' });
    store.touch([key('shared')], 'prj_b');
    const E = store.status().usedBytes / 3;
    expect(store.purgeProject('prj_a')).toEqual({ removed: 1, bytes: E });
    expect(keysIn(store, ['mine', 'shared', 'theirs'])).toEqual(['shared', 'theirs']);
    expect(store.purgeProject('prj_b')).toEqual({ removed: 2, bytes: 2 * E });
    expect(store.status().segments).toBe(0);
  });

  it('purgeProject removes pinned segments too (privacy over speed)', async () => {
    const { store, put } = makeStore();
    const a = await put('a', { projectId: 'prj_a' });
    const pin = store.pin([a.k]);
    expect(store.purgeProject('prj_a').removed).toBe(1);
    expect(store.has(a.k)).toBe(false);
    pin.release();
  });

  it('verifyOrder: least recently verified first, ties by key; markVerified moves a key back', async () => {
    const { store, put, clock } = makeStore();
    for (const n of ['a', 'b', 'c']) await put(n);
    const ks = [key('a'), key('b'), key('c')];
    const byKey = [...ks].sort();
    expect(store.verifyOrder(ks)).toEqual(byKey);
    store.markVerified([byKey[0]!]); clock.tick();
    store.markVerified([byKey[2]!]); clock.tick();
    expect(store.verifyOrder(ks)).toEqual([byKey[1], byKey[0], byKey[2]]);
  });

  it('medianRenderMsPerFrame needs 3 entries of that size', async () => {
    const { store, put } = makeStore();
    await put('a', { frames: 3, renderMs: 30 });
    await put('b', { frames: 3, renderMs: 90 });
    expect(store.medianRenderMsPerFrame(64, 36)).toBeNull();
    await put('c', { frames: 6, renderMs: 120 });
    expect(store.medianRenderMsPerFrame(64, 36)).toBe(20); // 10, 20, 30 ms per frame
    expect(store.medianRenderMsPerFrame(1920, 1080)).toBeNull();
    expect(store.medianBytesPerFrame(64, 36)).not.toBeNull();
  });

  it('counts clean self-checks per engine fingerprint, and a reset sets that one back to 0', () => {
    const { store, opts } = makeStore();
    const e1 = { bundle: 'b1', browser: '131|launch=plain', schemaVersion: 2 };
    const e2 = { bundle: 'b1', browser: '131|launch=gpu', schemaVersion: 2 };
    for (let i = 0; i < 3; i++) store.noteCleanSelfCheck(e1);
    store.noteCleanSelfCheck(e2);
    expect([store.cleanSelfChecks(e1), store.cleanSelfChecks(e2)]).toEqual([3, 1]);
    store.resetCleanSelfChecks(e1);
    expect([store.cleanSelfChecks(e1), store.cleanSelfChecks(e2)]).toEqual([0, 1]);
    store.close();
    const again = new SegmentStore(opts);
    stores.push(again);
    expect(again.cleanSelfChecks(e2)).toBe(1); // kept in the store's own index
  });
});
