/**
 * Words for the refusals the wave-5 builders added without words (lead wiring): shutting_down (the import queue while the server
 * stops, ADR-0023) and render_cache_purged (a privacy purge while a fast export runs, and the retry of such an export, ADR-0024).
 * Each is PROVOKED through the real code — a stopped queue, a purged segment store, Exporter.retry — and its code must have a
 * headline in Hebrew and English that differ, and its sentence a Hebrew detail (translateRefusal). Every pattern of the table is used.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { dictionaries, translateRefusal, WAVE5_REFUSAL_PATTERNS } from '../../i18n/src/index.ts';
import { Exporter } from '../../../apps/server/src/export.ts';
import { createImportQueue } from '../../../apps/server/src/importQueue.ts';
import { FifoComputeLane } from '../../../apps/server/src/lane.ts';
import { SegmentStore } from '../../../apps/server/src/segmentStore.ts';
import { ApiError, Store } from '../../../apps/server/src/store.ts';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-w5-wording-')); dirs.push(d); return d; };
const closers: (() => void)[] = [];
afterAll(() => { for (const c of closers) c(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const caught = async (fn: () => unknown): Promise<ApiError> => { try { await fn(); } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error('no refusal'); };

async function provoked(): Promise<ApiError[]> {
  const dir = tmp();
  const store = new Store(dir);
  closers.push(() => store.close());
  const p = store.createProject({ name: 'wording' });
  const projectId = p.doc.id;
  // shutting_down: receive, wait and retry of a stopped queue (labelled: no ffmpeg runs, nothing is converted)
  const queue = createImportQueue({ store, lane: new FifoComputeLane(), derivatives: { ensure: () => [] as never }, maxUploadBytes: 1 << 20, reserveBytes: 0, homeZone: 'Asia/Jerusalem', freeBytes: () => null });
  const job = store.createJob(projectId, 'import', 'user:local', { originalHash: 'sha256:' + '0'.repeat(64), byteSize: 1, name: 'a.mp4', via: 'browser', receivedAt: new Date().toISOString(), commitKind: 'background' });
  store.updateJob(job.id, { status: 'failed', error: { code: 'internal_error', message: 'x', status: 500, retryable: true } });
  const running = store.createJob(projectId, 'import', 'user:local', { originalHash: 'sha256:' + '1'.repeat(64), byteSize: 1, name: 'b.mp4', via: 'browser', receivedAt: new Date().toISOString(), commitKind: 'edit' });
  store.updateJob(running.id, { status: 'running' });
  const waiting = queue.wait(running.id);
  await queue.stop();
  const stopped = await caught(() => waiting);
  const receive = await caught(() => queue.receive({ projectId, actor: 'user:local', body: Readable.from([Buffer.from('x')]), name: 'c.mp4', via: 'browser', declaredBytes: 1, maxBytes: 1 << 20, commitKind: 'background' }));
  const retry = await caught(() => queue.retry(job.id, 'user:local'));
  const waitAfter = await caught(() => queue.wait(running.id));
  // render_cache_purged: a put of an export whose project was purged meanwhile
  const seg = new SegmentStore({ dir: path.join(dir, 'render-cache'), capBytes: 1 << 20, autoClear: false, minFreeBytes: 0, quota: () => ({ quotaBytes: 0, otherBytes: 0 }), freeDiskBytes: () => 1e12 });
  closers.push(() => seg.close());
  const pin = seg.pin([], { projectId, revision: 1 });
  seg.purgeProject(projectId, { revision: 2 });
  const video = path.join(dir, 'v.bin');
  fs.writeFileSync(video, Buffer.alloc(10));
  const purged = await caught(() => seg.put('a'.repeat(64), { videoFile: video, frames: 1, width: 2, height: 2, rgbaSha256: ['b'.repeat(64)], ptsOffsetTicks: 0, cells: [{ cols: 1, rows: 1, rgb: new Float32Array(3) }], renderMs: 1, projectId }, pin));
  // ... and the retry of the export that failed so
  const exporter = new Exporter(store, {} as never, () => 'http://127.0.0.1/render.html', path.join(dir, 'no-web'));
  const failedExport = store.createJob(projectId, 'export', 'user:local', { revision: 1, snapshot: p.doc, manifest: { options: { format: 'mp4-h264-aac', mode: 'incremental' } } });
  store.updateJob(failedExport.id, { status: 'failed', error: { ...purged.toJSON().error, retryable: false } });
  const retryExport = await caught(() => exporter.retry(failedExport.id, 'user:local'));
  return [stopped, receive, retry, waitAfter, purged, retryExport];
}

describe('wave-5 refusals have words (ADR-0023, ADR-0024)', () => {
  it('each new refusal, provoked for real, has a headline in both languages that differ, and a Hebrew detail; every pattern is used', async () => {
    const errors = await provoked();
    expect(errors.map((e) => e.code)).toEqual(['shutting_down', 'shutting_down', 'shutting_down', 'shutting_down', 'render_cache_purged', 'render_cache_purged']);
    const used = new Set<RegExp>();
    for (const e of errors) {
      const he = dictionaries.he[`error.code.${e.code}` as keyof typeof dictionaries.he], en = dictionaries.en[`error.code.${e.code}` as keyof typeof dictionaries.en];
      expect(he, e.code).toMatch(/[֐-׿]/);
      expect(en, e.code).toBeTruthy();
      expect(he).not.toBe(en);
      const detail = translateRefusal('he', e.message);
      expect(detail, e.message).toMatch(/[֐-׿]/);
      for (const re of WAVE5_REFUSAL_PATTERNS) if (re.test(e.message)) used.add(re);
    }
    expect(used.size).toBe(WAVE5_REFUSAL_PATTERNS.length);
  });
  it('the purge says what to do next in the interface: a new export, not a retry', () => {
    for (const lang of ['he', 'en'] as const) expect(dictionaries[lang]['cache.failed.purged']?.length).toBeGreaterThan(40);
    expect(dictionaries.he['cache.failed.newExport']).toBe('ייצוא חדש');
  });
});
