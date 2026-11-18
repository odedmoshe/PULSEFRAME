/**
 * The server-side contracts of the segmented export and render cache (ADR-0024) that the lead pre-pass owns: the four settings,
 * the export options, the blockers of the fast export, the render document shared by plan and export, the segmented render
 * session (runs and sink), the storage hooks (reclaim before refusing, purge with a deleted project, the owner's report) and the
 * bundle digest. The store, the codec and the segmented route are W2's (segmentStore.ts, cellsCodec.ts, exportSegments.ts);
 * nothing here calls them, and a fake sink or fake hooks stand in where a contract needs a counterpart.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { INCREMENTAL_NOT_BUILT_REASON, RENDER_CACHE_BLOCKERS, type ProjectDocument, type RenderCacheStatus } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { DEFAULT_RENDER_CACHE_BYTES, DEFAULT_RENDER_CACHE_MIN_FREE_BYTES, defaultSegmentThreads, loadConfig } from './config.ts';
import { ExportOptionsSchema, Exporter, incrementalBlockers, renderDocFor, variantDoc, type IncrementalRoute, type SegmentSink } from './export.ts';
import { bundleDigest, browserFingerprint, encoderIdOf, engineFingerprint } from './renderCacheEnv.ts';
import { assertStorageRoom, deleteProject, setStorageHooks, storageReport, type StorageHooks } from './storage.ts';
import { ApiError, Store } from './store.ts';

const R = { num: 30, den: 1 };
const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const dirs: string[] = [];
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : `other:${(e as Error).message}`; } return 'ok'; };
const status = (over: Partial<RenderCacheStatus> = {}): RenderCacheStatus => ({ enabled: true, capBytes: 1 << 30, usedBytes: 0, segments: 0, highWaterBytes: 0, autoClear: true, minFreeBytes: 1 << 30, ...over });
const route = (join: ReturnType<IncrementalRoute['join']>, over: Partial<RenderCacheStatus> = {}): IncrementalRoute => ({ status: () => status(over), join: () => join });

describe('render cache settings (config.ts)', () => {
  it('default to a 2 GiB cap, auto-clear on, 1 GiB kept free and min(cores, 8) encoder threads; each is read from its variable', () => {
    const c = loadConfig({});
    expect(c.renderCacheBytes).toBe(DEFAULT_RENDER_CACHE_BYTES);
    expect(DEFAULT_RENDER_CACHE_BYTES).toBe(2 * 1024 ** 3);
    expect(c.renderCacheAutoClear).toBe(true);
    expect(c.renderCacheMinFreeBytes).toBe(DEFAULT_RENDER_CACHE_MIN_FREE_BYTES);
    expect(c.segmentThreads).toBe(defaultSegmentThreads());
    expect(c.segmentThreads).toBeGreaterThanOrEqual(1);
    expect(c.segmentThreads).toBeLessThanOrEqual(8);
    const d = loadConfig({ PF_RENDER_CACHE_BYTES: '0', PF_RENDER_CACHE_AUTOCLEAR: '0', PF_RENDER_CACHE_MIN_FREE_BYTES: '5000', PF_SEGMENT_THREADS: '3' });
    expect([d.renderCacheBytes, d.renderCacheAutoClear, d.renderCacheMinFreeBytes, d.segmentThreads]).toEqual([0, false, 5000, 3]);
    expect(loadConfig({ PF_SEGMENT_THREADS: '0' }).segmentThreads).toBe(1);
    expect(loadConfig({ PF_RENDER_CACHE_BYTES: 'lots' }).renderCacheBytes).toBe(DEFAULT_RENDER_CACHE_BYTES);
  });
});

describe('export options of the fast export', () => {
  it('are optional without defaults, so the options of every earlier job parse to exactly what they were', () => {
    const old = ExportOptionsSchema.parse({});
    expect('mode' in old).toBe(false);
    expect('selfCheck' in old).toBe(false);
    expect(ExportOptionsSchema.parse({ mode: 'incremental', selfCheck: 'every-segment' })).toMatchObject({ mode: 'incremental', selfCheck: 'every-segment' });
    expect(ExportOptionsSchema.safeParse({ mode: 'segments' }).success).toBe(false);
    expect(ExportOptionsSchema.safeParse({ selfCheck: 'never' }).success).toBe(false);
  });
});

describe('blockers of the fast export (incrementalBlockers)', () => {
  const opts = (format: 'mp4-h264-aac' | 'webm-vp9-opus' | 'gif' | 'wav' | 'png', mode?: 'single-pass' | 'incremental') => ({ format, ...(mode ? { mode } : {}) });
  it('a single-pass export has none, whatever the cache', () => {
    expect(incrementalBlockers(opts('mp4-h264-aac'), null)).toEqual([]);
    expect(incrementalBlockers(opts('webm-vp9-opus', 'single-pass'), null)).toEqual([]);
  });
  it('MP4 only; then the route must exist, the cap be above 0 and the join self-test have passed — in that order', () => {
    expect(incrementalBlockers(opts('webm-vp9-opus', 'incremental'), route({ ok: true })).map((b) => b.code)).toEqual(['incremental_format_unsupported']);
    expect(incrementalBlockers(opts('mp4-h264-aac', 'incremental'), null)).toEqual([{ code: 'incremental_unavailable', message: RENDER_CACHE_BLOCKERS.unavailable.message(INCREMENTAL_NOT_BUILT_REASON), ids: [] }]);
    expect(incrementalBlockers(opts('mp4-h264-aac', 'incremental'), route({ ok: true }, { capBytes: 0, enabled: false })).map((b) => b.code)).toEqual(['render_cache_disabled']);
    expect(incrementalBlockers(opts('mp4-h264-aac', 'incremental'), route(null)).map((b) => b.code)).toEqual(['incremental_unavailable']);
    const old = incrementalBlockers(opts('mp4-h264-aac', 'incremental'), route({ ok: false, reason: 'this ffmpeg has no setts filter' }));
    expect(old).toEqual([{ code: 'incremental_unavailable', message: 'the fast export is not available on this machine: this ffmpeg has no setts filter', ids: [] }]);
    expect(incrementalBlockers(opts('mp4-h264-aac', 'incremental'), route({ ok: true }))).toEqual([]);
  });
  it('a full cache is never a blocker: a segment without room is joined from the work directory (notStored)', () => {
    expect(incrementalBlockers(opts('mp4-h264-aac', 'incremental'), route({ ok: true }, { autoClear: false, usedBytes: 1 << 30 }))).toEqual([]);
    expect(Object.values(RENDER_CACHE_BLOCKERS).map((b) => b.code)).not.toContain('render_cache_full');
  });
});

describe('the exporter with the fast export not wired yet', () => {
  let dir: string, store: Store, exporter: Exporter, pid = '';
  beforeAll(() => {
    dir = tmp('pf-sc-contracts-');
    store = new Store(dir);
    const web = path.join(dir, 'web');
    fs.mkdirSync(web, { recursive: true });
    fs.writeFileSync(path.join(web, 'render.html'), '<!doctype html><title>render</title>');
    exporter = new Exporter(store, null as never, () => 'http://127.0.0.1:1/render.html', web);
    pid = store.createProject({ name: 'cache', width: 64, height: 36, frameRate: R }).doc.id;
  });
  afterAll(() => store.close());

  it('plans a fast export with the honest blocker incremental_unavailable, and refuses to start it', () => {
    const p = store.getProject(pid);
    const plan = exporter.plan(p.doc, p.revision, { mode: 'incremental' });
    expect(plan.blockers.map((b) => b.code)).toContain('incremental_unavailable');
    expect(plan.blockers.find((b) => b.code === 'incremental_unavailable')!.message).toContain(INCREMENTAL_NOT_BUILT_REASON);
    expect(code(() => exporter.start(pid, 'user:local', { mode: 'incremental' }))).toBe('422:render_blocked');
    // a single-pass plan carries no trace of the new options
    expect('mode' in exporter.plan(p.doc, p.revision, {}).manifest.options).toBe(false);
  });

  it('renderDocFor is the projected variant with captions hidden for a clean picture, as the job snapshot always was', () => {
    const doc = store.getProject(pid).doc;
    const withCaptions: ProjectDocument = { ...doc, sequences: Object.fromEntries(Object.entries(doc.sequences).map(([id, s]) => [id, { ...s, tracks: [...s.tracks, { id: 'trk_cap', kind: 'caption', name: 'c', clips: [], locked: false, hidden: false, muted: false } as never] }])) };
    expect(renderDocFor(withCaptions, { captions: 'burned' })).toEqual(variantDoc(withCaptions));
    for (const captions of ['sidecar-srt', 'sidecar-vtt', 'none'] as const) {
      const out = renderDocFor(withCaptions, { captions });
      const caps = Object.values(out.sequences).flatMap((s) => s.tracks.filter((t) => t.kind === 'caption'));
      expect(caps.length).toBe(1);
      expect(caps.every((t) => t.hidden)).toBe(true);
    }
    expect(code(() => renderDocFor(doc, { captions: 'burned', variantId: 'var_missing' }))).toBe('404:not_found');
  });

  it('a segmented session counts the frames of its runs, hands them to its sink in stream order, and has no flash check of its own', async () => {
    const out = { width: 4, height: 2, firstFrame: 120, frames: 180 };
    const frameBytes = 4 * 2 * 4;
    const doc = store.getProject(pid).doc;
    expect(() => exporter.open(doc, 1, null, out, [{ first: 170, count: 11 }])).toThrow(/outside the range of 180 frames/);
    expect(() => exporter.open(doc, 1, null, out, [{ first: 0, count: 0 }])).toThrow(/outside the range/);
    const { token, session } = exporter.open(doc, 1, null, out, [{ first: 59, count: 1 }, { first: 60, count: 60 }]);
    expect(session.totalFrames).toBe(61);
    expect(session.runs).toEqual([{ first: 59, count: 1 }, { first: 60, count: 60 }]);
    expect(session.flash).toBeUndefined();
    // no sink attached yet: the page's frames find no session to take them
    await expect(exporter.acceptFrames(token, 0, new Uint8Array(frameBytes))).rejects.toMatchObject({ code: 'render_session_not_found' });
    const got: [number, number][] = [];
    const sink: SegmentSink = { accept: async (first, data) => { got.push([first, data.length / frameBytes]); }, kill: () => {}, failure: () => null };
    session.segments = sink;
    await exporter.acceptFrames(token, 0, new Uint8Array(frameBytes));
    await exporter.acceptFrames(token, 1, new Uint8Array(frameBytes * 40));
    await expect(exporter.acceptFrames(token, 0, new Uint8Array(frameBytes))).rejects.toMatchObject({ code: 'frame_out_of_order' });
    await expect(exporter.acceptFrames(token, 41, new Uint8Array(frameBytes * 21))).rejects.toMatchObject({ code: 'too_many_frames' });
    await exporter.acceptFrames(token, 41, new Uint8Array(frameBytes * 20));
    expect(got).toEqual([[0, 1], [1, 40], [41, 20]]);
    expect(session.nextFrame).toBe(61);
    exporter.sessions.delete(token);
  });

  it('a session without runs is unchanged: every frame of the range, no runs in its snapshot', () => {
    const { token, session } = exporter.open(store.getProject(pid).doc, 1, null, { width: 4, height: 2, firstFrame: 0, frames: 30 });
    expect(session.totalFrames).toBe(30);
    expect('runs' in session).toBe(false);
    expect('segments' in session).toBe(false);
    exporter.sessions.delete(token);
  });
});

describe('storage hooks of derived data (storage.ts)', () => {
  const fakeHooks = (store: Store, onReclaim: (needed: number) => void) => {
    const purged: string[] = [];
    const hooks: StorageHooks = { reclaim: onReclaim, purgeProject: (id) => { purged.push(id); }, status: () => status({ usedBytes: 7, segments: 1 }) };
    setStorageHooks(store, hooks);
    return { purged };
  };
  it('every ceiling check asks the cache for room first and measures again, so a full cache never refuses an upload', () => {
    const dir = tmp('pf-sc-room-');
    const store = new Store(dir, 0);
    const used = (() => { let n = 0; const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? (walk(p), 0) : fs.statSync(p).size; } }; walk(dir); return n; })();
    store.maxStorageBytes = used + 50_000;
    const cacheFile = path.join(dir, 'render-cache', 'ab', 'seg.mp4');
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, Buffer.alloc(40_000));
    // without hooks: refused
    expect(code(() => assertStorageRoom(store, 20_000, 'store this upload'))).toBe('507:storage_quota_exceeded');
    const asked: number[] = [];
    fakeHooks(store, (needed) => { asked.push(needed); fs.rmSync(cacheFile); });
    expect(assertStorageRoom(store, 20_000, 'store this upload')).toBeGreaterThanOrEqual(20_000);
    expect(asked).toEqual([20_000]);
    // a request that fits is not sent to the cache at all
    expect(assertStorageRoom(store, 1, 'store this upload')).toBeGreaterThan(0);
    expect(asked).toEqual([20_000]);
    // a cache that cannot free enough leaves the refusal as it was
    setStorageHooks(store, { reclaim: () => {}, purgeProject: () => {}, status: () => status() });
    expect(code(() => assertStorageRoom(store, 10_000_000, 'store this upload'))).toBe('507:storage_quota_exceeded');
    setStorageHooks(store, null);
    store.close();
  });
  it('deleting a project purges its segments; the owner\'s storage report shows the cache only when there is one', () => {
    const store = new Store(tmp('pf-sc-purge-'));
    const pid = store.createProject({ name: 'gone' }).doc.id;
    expect('renderCache' in storageReport(store, owner)).toBe(false);
    const { purged } = fakeHooks(store, () => {});
    expect(storageReport(store, owner)).toMatchObject({ renderCache: { usedBytes: 7, segments: 1 } });
    deleteProject(store, owner, pid, 'gone');
    expect(purged).toEqual([pid]);
    setStorageHooks(store, null);
    store.close();
  });
});

describe('engine fingerprint parts (renderCacheEnv.ts)', () => {
  it('the bundle digest covers render.html and every asset, recursively, independent of listing order; null before a build', () => {
    const web = tmp('pf-sc-web-');
    expect(bundleDigest(web)).toBeNull();
    fs.writeFileSync(path.join(web, 'render.html'), 'page');
    fs.mkdirSync(path.join(web, 'assets', 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(web, 'assets', 'b.js'), 'compositor 1');
    fs.writeFileSync(path.join(web, 'assets', 'fonts', 'a.woff2'), 'font');
    const a = bundleDigest(web)!;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(bundleDigest(web)).toBe(a);
    fs.writeFileSync(path.join(web, 'assets', 'b.js'), 'compositor 2!'); // a different size, so the (size, mtime) cache cannot hide it
    const b = bundleDigest(web)!;
    expect(b).not.toBe(a);
    fs.writeFileSync(path.join(web, 'assets', 'fonts', 'c.woff2'), 'x');
    expect(bundleDigest(web)).not.toBe(b);
    // files outside render.html and assets/ (the editor's index.html) do not count
    const c = bundleDigest(web);
    fs.writeFileSync(path.join(web, 'index.html'), 'editor');
    expect(bundleDigest(web)).toBe(c);
  });
  it('the browser part names the launch mode; the encoder id changes with the thread count', () => {
    expect(browserFingerprint({ version: '153.0.7000.0', launch: 'auto' })).toBe('153.0.7000.0|launch=auto');
    expect(engineFingerprint('b'.repeat(64), { version: '153', launch: 'window' }, 2)).toEqual({ bundle: 'b'.repeat(64), browser: '153|launch=window', schemaVersion: 2 });
    const v = 'ffmpeg version 6.1.1';
    expect(encoderIdOf(v, ['-threads', '4'])).not.toBe(encoderIdOf(v, ['-threads', '2']));
    expect(encoderIdOf(v, ['-threads', '4'])).toBe(encoderIdOf(v, ['-threads', '4']));
  });
});

describe('time of the grid is exact (ADR-0003)', () => {
  it('segment boundaries are frame indexes; their times come from the rational rate, never from rounded seconds', () => {
    const rate = { num: 30000, den: 1001 };
    // 2 s at 29.97 is 60 frames; frame 60 begins exactly at 1001/500 s
    expect(T.eq(T.frameTime(60, rate), T.rt(1001, 500))).toBe(true);
  });
});
