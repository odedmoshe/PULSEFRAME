/** The imports store (imports.ts) against a labelled FAKE host: no network, no browser. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportJobView } from '@pulseframe/core';
import { ImportsStore, READY_LINGER_MS, REFETCH_DEBOUNCE_MS, setRelativePath, type ImportsHost } from './imports.ts';

const job = (id: string, over: Partial<ImportJobView> = {}): ImportJobView => ({
  jobId: id, projectId: 'p', name: `${id}.mp4`, byteSize: 10, via: 'browser', state: 'waiting', waitingFor: 'turn', percent: null, queuePosition: null, reasons: [], assetId: null, deduplicated: false, error: null,
  batchId: 'b', dropId: null, retryOf: null, attempt: 1, createdAt: 'x', updatedAt: 'x', ...over,
});
const file = (name: string) => ({ name, size: 10, lastModified: 1 }) as unknown as File;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

interface Up { name: string; resolve(j: ImportJobView): void; reject(e: unknown): void; progress(n: number, t: number): void; aborted: boolean; meta: { via: string; relativePath?: string } }
function fakeHost() {
  const ups: Up[] = [];
  const calls = { place: [] as [string, number, string | null][], provide: [] as string[], list: 0, retry: [] as string[], dismiss: [] as string[] };
  let listing: ImportJobView[] = [];
  let placeResult: (a: string) => number | null = () => null;
  const host: ImportsHost = {
    projectId: () => 'p',
    upload: (_p, f, meta, onProgress) => {
      const up = { name: f.name, aborted: false, meta } as unknown as Up;
      const done = new Promise<{ job: ImportJobView }>((res, rej) => { up.resolve = (j) => res({ job: j }); up.reject = rej; });
      up.progress = onProgress;
      ups.push(up);
      return { done, abort: () => { up.aborted = true; up.reject({ code: 'canceled' }); } };
    },
    list: async () => { calls.list++; return { imports: listing, room: { ceilingRoomBytes: null, freeDiskBytes: null, reserveBytes: 0, maxFileBytes: 1 } }; },
    retry: async (id) => { calls.retry.push(id); }, cancel: async () => {}, dismiss: async (id) => { calls.dismiss.push(id); },
    place: async (a, frame, track) => { calls.place.push([a, frame, track]); return placeResult(a); },
    provideLocal: (a) => { calls.provide.push(a); },
  };
  return { host, ups, calls, setListing: (l: ImportJobView[]) => { listing = l; }, setPlace: (f: (a: string) => number | null) => { placeResult = f; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ImportsStore', () => {
  it('uploads one file at a time, with progress, and a local card turns into the job', async () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    s.enqueueLocal([file('a.mp4'), file('b.mp4')], { via: 'browser' });
    expect(h.ups).toHaveLength(1);
    expect(s.snapshot().local.map((l) => l.state)).toEqual(['uploading', 'pending-upload']);
    h.ups[0]!.progress(5, 10);
    expect(s.snapshot().local[0]!.percent).toBe(50);
    expect(s.uploading).toBe(true);
    h.ups[0]!.resolve(job('j1'));
    await flush();
    expect(h.ups).toHaveLength(2);
    expect(s.snapshot().jobs.map((j) => j.jobId)).toEqual(['j1']);
    expect(s.snapshot().local.map((l) => l.name)).toEqual(['b.mp4']);
    h.ups[1]!.resolve(job('j2'));
    await flush();
    expect(s.snapshot().local).toEqual([]);
    expect(s.snapshot().jobs.map((j) => j.queuePosition)).toEqual([0, 1]);
    expect(s.uploading).toBe(false);
  });
  it('a failed upload is a not-uploaded card with its code, and the next file still goes', async () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    s.enqueueLocal([file('a.mp4'), file('b.mp4')], { via: 'browser' });
    h.ups[0]!.reject({ code: 'upload_too_large' });
    await flush();
    expect(s.snapshot().local[0]).toMatchObject({ state: 'not-uploaded', reason: 'upload_too_large' });
    expect(h.ups).toHaveLength(2);
    h.ups[1]!.reject(new Error('boom'));
    await flush();
    expect(s.snapshot().local[1]).toMatchObject({ state: 'not-uploaded', reason: 'network_error' });
    s.cancelLocal(s.snapshot().local[0]!.localId);
    expect(s.snapshot().local).toHaveLength(1);
  });
  it('cancelLocal stops the upload in flight and drops a waiting one', async () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    s.enqueueLocal([file('a.mp4'), file('b.mp4')], { via: 'browser' });
    const [a, b] = s.snapshot().local;
    s.cancelLocal(b!.localId);
    expect(s.snapshot().local).toHaveLength(1);
    s.cancelLocal(a!.localId);
    expect(h.ups[0]!.aborted).toBe(true);
    await flush();
    expect(s.snapshot().local[0]).toMatchObject({ state: 'not-uploaded', reason: 'canceled' });
    expect(h.ups).toHaveLength(1);
  });
  it('a folder upload sends the relative path; enqueueFolder plans, sorts and counts what was skipped', async () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    s.enqueueFolder([{ file: file('IMG_10.jpg'), relativePath: 't/IMG_10.jpg' }, { file: file('IMG_2.jpg'), relativePath: 't/IMG_2.jpg' }, { file: file('x.txt'), relativePath: 't/x.txt' }]);
    expect(h.ups[0]!.name).toBe('IMG_2.jpg');
    expect(h.ups[0]!.meta).toMatchObject({ via: 'folder', relativePath: 't/IMG_2.jpg' });
    expect(s.snapshot().skipped).toEqual({ count: 1, reason: 'not-media' });
    const f = file('q.jpg'); setRelativePath(f, 'z/q.jpg');
    const s2 = new ImportsStore(fakeHost().host); expect(s2.snapshot().skipped).toBeNull(); void f;
  });
  it('job events: progress, ready, then the card leaves after its linger; an unknown job refetches once after 250 ms', async () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    s.enqueueLocal([file('a.mp4')], { via: 'browser' });
    h.ups[0]!.resolve(job('j1')); await flush();
    s.onJobEvent({ id: 'j1', type: 'import', status: 'running', stage: 'converting:30', output: { reasons: ['rotation'] }, error: null });
    expect(s.snapshot().jobs[0]).toMatchObject({ state: 'converting', percent: 30, reasons: ['rotation'] });
    s.onJobEvent({ id: 'j1', type: 'import', status: 'succeeded', stage: null, output: { assetId: 'A1', deduplicated: false, converted: false }, error: null });
    expect(s.snapshot().jobs[0]).toMatchObject({ state: 'ready', assetId: 'A1' });
    expect(h.calls.provide).toEqual(['A1']);
    await vi.advanceTimersByTimeAsync(READY_LINGER_MS + 1);
    expect(s.snapshot().jobs).toEqual([]);
    // an event for a job this tab has never seen (a phone file) -> debounced refetch, once
    const base = h.calls.list; // entering converting already asked for a fresh list once
    h.setListing([job('ph1', { via: 'phone' })]);
    s.onJobEvent({ id: 'ph1', type: 'import', status: 'queued', stage: null, output: null, error: null });
    s.onJobEvent({ id: 'ph1', type: 'import', status: 'running', stage: 'probing', output: null, error: null });
    expect(h.calls.list).toBe(base);
    await vi.advanceTimersByTimeAsync(REFETCH_DEBOUNCE_MS);
    expect(h.calls.list).toBe(base + 1);
    expect(s.snapshot().jobs.map((j) => j.jobId)).toEqual(['ph1']);
    s.onJobEvent({ id: 'x', type: 'speech', status: 'queued', stage: null, output: null, error: null });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.calls.list).toBe(base + 1); // other job types are ignored
  });
  it('a converted file is not handed to the media pool; a failure shows its code and keeps retry rules from the server', async () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    s.enqueueLocal([file('a.mp4'), file('b.mp4')], { via: 'browser' });
    h.ups[0]!.resolve(job('j1')); await flush(); h.ups[1]!.resolve(job('j2')); await flush();
    s.onJobEvent({ id: 'j1', type: 'import', status: 'succeeded', stage: null, output: { assetId: 'A1', converted: true }, error: null });
    s.onJobEvent({ id: 'j2', type: 'import', status: 'failed', stage: null, output: null, error: { code: 'unsupported_media', message: 'no', retryable: false } });
    expect(h.calls.provide).toEqual([]);
    expect(s.snapshot().jobs[1]).toMatchObject({ state: 'failed', error: { code: 'unsupported_media', retryable: false } });
    // a late "running" event never moves a finished job back
    s.onJobEvent({ id: 'j2', type: 'import', status: 'running', stage: 'probing', output: null, error: null });
    expect(s.snapshot().jobs[1]!.state).toBe('failed');
  });
  it('refresh keeps a ready card through its linger and replaces the rest with the server list', async () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    s.enqueueLocal([file('a.mp4')], { via: 'browser' });
    h.ups[0]!.resolve(job('j1')); await flush();
    s.onJobEvent({ id: 'j1', type: 'import', status: 'succeeded', stage: null, output: { assetId: 'A1', converted: true }, error: null });
    h.setListing([job('j9', { state: 'failed', waitingFor: null })]);
    await s.refresh();
    expect(s.snapshot().jobs.map((j) => j.jobId).sort()).toEqual(['j1', 'j9']);
    expect(s.snapshot().room).not.toBeNull();
    await s.dismiss('j9');
    expect(h.calls.dismiss).toEqual(['j9']);
    expect(s.snapshot().jobs.map((j) => j.jobId)).toEqual(['j1']);
    await s.retry('j9');
    expect(h.calls.retry).toEqual(['j9']);
  });
  it('placement: files dropped on the timeline are placed in the order dropped, a failed one is skipped', async () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    h.setPlace((a) => ({ A1: 160, A3: 220 })[a] ?? null);
    s.enqueueLocal([file('1.mp4'), file('2.mp4'), file('3.mp4')], { via: 'browser', place: { frame: 100, trackId: 't1' } });
    h.ups[0]!.resolve(job('j1')); await flush(); h.ups[1]!.resolve(job('j2')); await flush(); h.ups[2]!.resolve(job('j3')); await flush();
    // finish out of order: 3, then 2 fails, then 1
    s.onJobEvent({ id: 'j3', type: 'import', status: 'succeeded', stage: null, output: { assetId: 'A3', converted: true }, error: null });
    await flush();
    expect(h.calls.place).toEqual([]);
    s.onJobEvent({ id: 'j2', type: 'import', status: 'failed', stage: null, output: null, error: { code: 'conform_failed', message: '', retryable: false } });
    s.onJobEvent({ id: 'j1', type: 'import', status: 'succeeded', stage: null, output: { assetId: 'A1', converted: true }, error: null });
    await flush();
    expect(h.calls.place).toEqual([['A1', 100, 't1'], ['A3', 160, 't1']]);
  });
  const ok = (id: string, assetId: string) => ({ id, type: 'import', status: 'succeeded', stage: null, output: { assetId, converted: false }, error: null });
  it('two overlapping timeline drops each keep their own placement chain', async () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    h.setPlace((a) => ({ A1: 10, A2: 20, B1: 1100, B2: 1200 })[a] ?? null);
    s.enqueueLocal([file('a1.mp4'), file('a2.mp4')], { via: 'browser', place: { frame: 0, trackId: 't' } });
    h.ups[0]!.resolve(job('ja1')); await flush(); h.ups[1]!.resolve(job('ja2')); await flush();
    s.enqueueLocal([file('b1.mp4'), file('b2.mp4')], { via: 'browser', place: { frame: 1000, trackId: 't' } });
    h.ups[2]!.resolve(job('jb1')); await flush(); h.ups[3]!.resolve(job('jb2')); await flush();
    for (const [id, a] of [['ja1', 'A1'], ['ja2', 'A2'], ['jb1', 'B1'], ['jb2', 'B2']] as const) { s.onJobEvent(ok(id, a)); await flush(); }
    expect(h.calls.place).toEqual([['A1', 0, 't'], ['A2', 10, 't'], ['B1', 1000, 't'], ['B2', 1100, 't']]);
  });
  it('a job that ended before its upload response arrived is applied when the upload returns it', async () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    h.setPlace(() => 50);
    s.enqueueLocal([file('a.mp4'), file('b.mp4')], { via: 'browser', place: { frame: 0, trackId: 't' } });
    s.onJobEvent(ok('j1', 'A1'));
    h.ups[0]!.resolve(job('j1')); await flush();
    h.ups[1]!.resolve(job('j2')); await flush();
    s.onJobEvent(ok('j2', 'A2')); await flush();
    expect(h.calls.provide).toEqual(['A1', 'A2']);
    expect(h.calls.place).toEqual([['A1', 0, 't'], ['A2', 50, 't']]);
  });
  it('a job of this tab missing from the list is asked for, not dropped, and settles the placement', async () => {
    const h = fakeHost(); const s = new ImportsStore({ ...h.host, getJob: async (id) => ok(id, 'A' + id) });
    h.setPlace(() => 50);
    s.enqueueLocal([file('a.mp4')], { via: 'browser', place: { frame: 0, trackId: 't' } });
    h.ups[0]!.resolve(job('j1')); await flush();
    h.setListing([]);
    await s.refresh(); await flush();
    expect(h.calls.place).toEqual([['Aj1', 0, 't']]);
    expect(h.calls.provide).toEqual(['Aj1']);
  });
  it('without a project nothing is uploaded and the cards say why; reset aborts the upload and forgets everything', async () => {
    const h = fakeHost();
    const s = new ImportsStore({ ...h.host, projectId: () => null });
    s.enqueueLocal([file('a.mp4')], { via: 'browser' });
    expect(h.ups).toHaveLength(0);
    expect(s.snapshot().local[0]).toMatchObject({ state: 'not-uploaded', reason: 'no_project' });
    const s2 = new ImportsStore(h.host);
    s2.enqueueLocal([file('a.mp4'), file('b.mp4')], { via: 'browser' });
    s2.reset();
    expect(h.ups[0]!.aborted).toBe(true);
    await flush();
    expect(s2.snapshot()).toMatchObject({ local: [], jobs: [], room: null, skipped: null });
    expect(h.ups).toHaveLength(1);
  });
  it('subscribers are told of every change and can leave', () => {
    const h = fakeHost(); const s = new ImportsStore(h.host);
    let n = 0; const off = s.subscribe(() => { n++; });
    const before = s.snapshot();
    s.enqueueLocal([file('a.mp4')], { via: 'browser' });
    expect(n).toBeGreaterThan(0);
    expect(s.snapshot()).not.toBe(before);
    const seen = n; off(); s.reset();
    expect(n).toBe(seen);
  });
});
