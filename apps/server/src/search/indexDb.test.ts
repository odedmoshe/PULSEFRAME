/**
 * The picture index file (search/indexDb.ts): permissions, one transaction per file, stillWanted checked INSIDE the write transaction,
 * and deletion that leaves no planted byte pattern in index.sqlite or its WAL. Rows here are synthetic bytes, not model output.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexPathOf, removeIndexFiles, SearchIndexDb, type Sample } from './indexDb.ts';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-searchB-idx-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const PATTERN = Int8Array.from({ length: 32 }, (_, i) => ((i * 37 + 11) % 251) - 125); // a planted, distinctive byte run
const sample = (frame: number, planted = false): Sample => {
  const q = new Int8Array(768);
  for (let i = 0; i < 768; i++) q[i] = ((frame * 13 + i * 7) % 200) - 100;
  if (planted) q.set(PATTERN, 600);
  return { frame, scale: 0.01, q };
};
const meta = (h: string, embedder = 'TEST-DOUBLE-embedder/1') => ({ contentHash: h, embedder, source: 'original' as const, frameCount: 90, rate: { num: 30, den: 1 } });
const fileBytes = (f: string) => Buffer.concat([f, `${f}-wal`].filter((x) => fs.existsSync(x)).map((x) => fs.readFileSync(x)));
const holds = (buf: Buffer, pat: Int8Array) => buf.includes(Buffer.from(pat.buffer, pat.byteOffset, pat.byteLength));

describe('the picture index file', () => {
  it('lives at <dataDir>/search/index.sqlite, folder 0700 and file 0600; reading never creates it', () => {
    expect(SearchIndexDb.openIfExists(dir)).toBeNull();
    expect(fs.existsSync(path.join(dir, 'search'))).toBe(false);
    const ix = SearchIndexDb.open(dir);
    expect(ix.file).toBe(indexPathOf(dir));
    expect(fs.statSync(path.join(dir, 'search')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(ix.file).mode & 0o777).toBe(0o600);
    ix.close();
  });
  it('a file is written whole in one transaction, and stillWanted runs synchronously INSIDE that transaction', () => {
    const ix = SearchIndexDb.open(dir);
    let seenInside: boolean | null = null;
    const wrote = ix.replaceFile(meta('sha256:a'), [sample(0), sample(30), sample(60)], () => { seenInside = (ix as unknown as { db: { inTransaction: boolean } }).db.inTransaction; return true; });
    expect({ wrote, seenInside }).toEqual({ wrote: true, seenInside: true });
    expect(ix.framesOf('sha256:a', 'TEST-DOUBLE-embedder/1')).toEqual([0, 30, 60]);
    expect(ix.hasFile('sha256:a', 'TEST-DOUBLE-embedder/1')).toBe(true);
    ix.close();
  });
  it('a hash no longer wanted at the write is never written, and its earlier rows go too (the scan that finishes after the removal)', () => {
    const ix = SearchIndexDb.open(dir);
    ix.replaceFile(meta('sha256:b', 'old-embedder'), [sample(0)], () => true);
    const wrote = ix.replaceFile(meta('sha256:b'), [sample(0, true), sample(30)], () => false);
    expect(wrote).toBe(false);
    expect(ix.sampleCount('sha256:b')).toBe(0);
    expect(ix.files(['sha256:b'])).toEqual([]);
    ix.close();
    expect(holds(fileBytes(indexPathOf(dir)), PATTERN)).toBe(false);
  });
  it('deleting a hash erases its bytes from index.sqlite and its WAL (planted pattern present before, absent after)', () => {
    const ix = SearchIndexDb.open(dir);
    ix.replaceFile(meta('sha256:c'), [sample(0, true), sample(30)], () => true);
    ix.replaceFile(meta('sha256:d'), [sample(0), sample(30)], () => true);
    expect(holds(fileBytes(ix.file), PATTERN)).toBe(true);
    expect(ix.deleteHashes(['sha256:c'])).toEqual({ files: 1, bytes: 2 * (768 + 8) });
    expect(holds(fileBytes(ix.file), PATTERN)).toBe(false);
    expect(ix.sampleCount('sha256:d')).toBe(2);
    ix.close();
    expect(holds(fileBytes(indexPathOf(dir)), PATTERN)).toBe(false);
  });
  it('vectors come back only for complete files of the asked embedder; removing the index files leaves nothing', () => {
    const ix = SearchIndexDb.open(dir);
    ix.replaceFile(meta('sha256:e'), [sample(0), sample(30)], () => true);
    ix.replaceFile(meta('sha256:e', 'other'), [sample(0)], () => true);
    expect(ix.vectors(['sha256:e'], 'TEST-DOUBLE-embedder/1').map((s) => s.frame)).toEqual([0, 30]);
    expect(ix.totals().files).toBe(2);
    ix.close();
    removeIndexFiles(dir);
    expect(fs.readdirSync(path.join(dir, 'search'))).toEqual([]);
  });
});
