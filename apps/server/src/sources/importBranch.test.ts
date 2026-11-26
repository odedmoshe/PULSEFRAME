/**
 * The import queue's SOURCE BRANCH (importQueue.ts; verify C7, C6 recovery), driven directly (no server, no port): receive's check
 * of the record and the bytes, the commit by use_source_item with provenance.source and no upload record, no duplicate short-cut,
 * the restart between commit and job update recognised by provider + itemId (ownCommit), and the clean-up of src_* temp files.
 * Labelled: `derivatives` is a counting fake, the free space is injected, use_source_item's body is the stand-in of
 * doubles/sources/standIns.ts until W1's is merged. Fixtures are synthetic (ffmpeg) and deleted.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Asset, SourceRecord } from '@pulseframe/core';
import { installUseSourceItemStandIn } from '../../../../packages/evals/src/doubles/sources/standIns.ts';
import type { ImportQueue } from '../importContracts.ts';
import { createImportQueue } from '../importQueue.ts';
import { FifoComputeLane } from '../lane.ts';
import { ApiError, Store, type JobRow } from '../store.ts';

let root = '', png = Buffer.alloc(0), png2 = Buffer.alloc(0);
let restore: () => void = () => {};
const stores: Store[] = [];
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
beforeAll(() => {
  restore = installUseSourceItemStandIn();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-src-branch-'));
  for (const [n, c] of [['a.png', 'red'], ['b.png', 'yellow']] as const) execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=${c}:s=32x32`, '-frames:v', '1', path.join(root, n)]);
  png = fs.readFileSync(path.join(root, 'a.png'));
  png2 = fs.readFileSync(path.join(root, 'b.png'));
}, 60_000);
afterAll(() => { for (const s of stores) { try { s.close(); } catch { /* closed */ } } restore(); fs.rmSync(root, { recursive: true, force: true }); });

function world(): { store: Store; queue: ImportQueue; pid: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(root, 'w-'));
  const store = new Store(dir);
  stores.push(store);
  const queue = createImportQueue({ store, lane: new FifoComputeLane(), maxUploadBytes: 1024 ** 3, reserveBytes: 0, homeZone: 'UTC', derivatives: { ensure: () => [] } /* labelled fake */, freeBytes: () => 100 * 1024 ** 3 /* labelled */ });
  return { store, queue, pid: store.createProject({ name: 'p' }).doc.id, dir };
}
const record = (bytes: Buffer, itemId = 'image:x1'): SourceRecord => ({
  provider: 'openverse', itemId, kind: 'photo', title: 'Red', author: 'Ann', fetchedAt: '2026-11-26T12:00:00.000Z', sha256: sha(bytes), byteSize: bytes.length,
  licence: { id: 'CC-BY-4.0', name: 'CC BY 4.0', from: 'item' }, credit: { text: '"Red" by Ann is licensed under CC BY 4.0.', placement: 'description', due: true }, flags: {},
});
const receive = (w: ReturnType<typeof world>, bytes: Buffer, src?: { record: SourceRecord; expect: { sha256: string }; fetchJobId: string }) =>
  w.queue.receive({ projectId: w.pid, actor: 'agent:local', body: fs.createReadStream(fileOf(bytes)), name: 'red.png', via: 'browser', declaredBytes: bytes.length, maxBytes: 1024 ** 2, commitKind: 'background', ...(src ? { source: src } : {}) });
const fileOf = (b: Buffer) => { const f = path.join(root, `${sha(b)}.bin`); if (!fs.existsSync(f)) fs.writeFileSync(f, b); return f; };
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof ApiError ? `${e.status} ${e.code}` : String(e); } };

describe('import queue: the source branch (C7)', () => {
  it('receive refuses a record that is not valid, does not name the bytes, or comes beside a library part; nothing is stored', async () => {
    const w = world();
    const r = record(png);
    expect(await code(receive(w, png, { record: { ...r, sha256: 'z' } as never, expect: { sha256: sha(png) }, fetchJobId: 'job_a' }))).toBe('400 invalid_request');
    expect(await code(receive(w, png, { record: r, expect: { sha256: sha(png2) }, fetchJobId: 'job_a' }))).toBe('400 invalid_request');
    expect(await code(receive(w, png, { record: { ...r, sha256: sha(png2) }, expect: { sha256: sha(png2) }, fetchJobId: 'job_a' }))).toBe('409 source_hash_mismatch');
    expect(await code(receive(w, png, { record: r, expect: { sha256: sha(png) }, fetchJobId: '../x' }))).toBe('400 invalid_request');
    expect(fs.readdirSync(path.join(w.dir, 'blobs'))).toEqual([]);
  });
  it('commits use_source_item: provenance.source, no upload record; the job input keeps the source part; the fetch job\'s temp files go when the import ends', async () => {
    const w = world();
    fs.mkdirSync(w.store.tmpDir, { recursive: true });
    for (const e of ['part', 'link']) fs.writeFileSync(path.join(w.store.tmpDir, `src_job_f1.${e}`), 'x');
    const row = await receive(w, png, { record: record(png), expect: { sha256: sha(png) }, fetchJobId: 'job_f1' });
    expect((row.input as any).source).toEqual({ record: record(png), expect: { sha256: sha(png) }, fetchJobId: 'job_f1' });
    const done = await w.queue.wait(row.id);
    expect([done.status, done.error]).toEqual(['succeeded', null]);
    const a = w.store.wholeProject(w.pid).doc.assets[(done.output as any).assetId] as Asset;
    expect(a.provenance).toMatchObject({ origin: 'upload', importedBy: 'agent:local', source: { provider: 'openverse', itemId: 'image:x1' } });
    expect(a.provenance.upload).toBeUndefined();
    const tx = w.store.db.prepare('SELECT ops FROM transactions WHERE project_id = ? ORDER BY revision DESC LIMIT 1').get(w.pid) as { ops: string };
    expect(JSON.parse(tx.ops)[0].op).toBe('use_source_item');
    expect(fs.readdirSync(w.store.tmpDir).filter((f) => f.startsWith('src_'))).toEqual([]);
  });
  it('no duplicate short-cut: bytes already imported by hand get the record (recordAttached), not a second asset', async () => {
    const w = world();
    const plain = await w.queue.wait((await receive(w, png2)).id);
    const done = await w.queue.wait((await receive(w, png2, { record: record(png2, 'image:x2'), expect: { sha256: sha(png2) }, fetchJobId: 'job_f2' })).id);
    expect(done.status).toBe('succeeded');
    expect((done.output as any)).toMatchObject({ assetId: (plain.output as any).assetId, deduplicated: true, recordAttached: true });
    expect(Object.keys(w.store.wholeProject(w.pid).doc.assets).length).toBe(1);
  });
  it('a restart between the commit and the job update finishes from its own commit (matched on provider + itemId): no second asset', async () => {
    const w = world();
    const row = await receive(w, png, { record: record(png), expect: { sha256: sha(png) }, fetchJobId: 'job_f3' });
    const done = await w.queue.wait(row.id);
    const assetId = (done.output as any).assetId;
    const revision = w.store.wholeProject(w.pid).revision;
    // the crash: the commit exists, the job row still says running
    w.store.db.prepare("UPDATE jobs SET status = 'running', output = NULL WHERE id = ?").run(row.id);
    await w.queue.stop();
    const q2 = createImportQueue({ store: w.store, lane: new FifoComputeLane(), maxUploadBytes: 1024 ** 3, reserveBytes: 0, homeZone: 'UTC', derivatives: { ensure: () => [] } /* labelled fake */, freeBytes: () => 100 * 1024 ** 3 });
    expect(q2.recover()).toBe(1);
    const again: JobRow = await q2.wait(row.id);
    expect([again.status, (again.output as any).assetId]).toEqual(['succeeded', assetId]);
    expect(w.store.wholeProject(w.pid).revision).toBe(revision);
    expect(Object.keys(w.store.wholeProject(w.pid).doc.assets)).toEqual([assetId]);
  });
  it('recovery removes the src_* files of a gone or finished download and keeps those of an open one', async () => {
    const w = world();
    const open = w.store.createJob(w.pid, 'source_fetch', 'agent:local', { route: 'direct' });
    const done = w.store.createJob(w.pid, 'source_fetch', 'agent:local', { route: 'direct' });
    w.store.updateJob(done.id, { status: 'failed' });
    fs.mkdirSync(w.store.tmpDir, { recursive: true });
    for (const id of [open.id, done.id, 'job_gone']) for (const e of ['part', 'link']) fs.writeFileSync(path.join(w.store.tmpDir, `src_${id}.${e}`), 'x');
    w.queue.recover();
    expect(fs.readdirSync(w.store.tmpDir).filter((f) => f.startsWith('src_')).sort()).toEqual([`src_${open.id}.link`, `src_${open.id}.part`]);
  });
});
