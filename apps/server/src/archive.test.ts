import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { importArchive, planArchive, writeArchive } from './archive.ts';
import { ApiError, Store } from './store.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
function world() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-arc-'));
  dirs.push(d);
  return new Store(d);
}
/** A project with two "media files" (arbitrary bytes are enough: the archive treats media as opaque blobs). */
function seeded(store: Store) {
  const pid = store.createProject({ name: 'פרויקט ארכיון' }).doc.id;
  const mk = (seed: number, size: number) => {
    const bytes = Buffer.from(Array.from({ length: size }, (_, i) => (i * 31 + seed) & 0xff));
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const tmp = path.join(store.tmpDir, `seed${seed}`);
    fs.writeFileSync(tmp, bytes);
    store.putBlob(hash, tmp, size, 'video/mp4');
    return { hash, size };
  };
  const a = mk(1, 5000), b = mk(2, 700);
  const asset = (x: { hash: string; size: number }, name: string) => ({ kind: 'video' as const, name, contentHash: x.hash, byteSize: x.size, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(4, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 120 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' } });
  const r = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: asset(a, 'a.mp4') } }, { op: 'import_asset', args: { asset: asset(b, 'b.mp4') } }] });
  const [idA, idB] = r.results.map((x) => x.output!.assetId as string);
  store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_clip', args: { assetId: idA, start: f(0) } }, { op: 'add_clip', args: { assetId: idB, start: f(120) } }, { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30) } }, { op: 'add_variant', args: { profileId: 'square-1x1' } }] });
  return { pid, blobs: [a, b] };
}
async function toFile(store: Store, pid: string, name = 'out.tar') {
  const plan = planArchive(store, pid);
  const chunks: Buffer[] = [];
  for await (const c of writeArchive(plan)) chunks.push(c);
  const buf = Buffer.concat(chunks);
  const file = path.join(store.tmpDir, name);
  fs.writeFileSync(file, buf);
  return { file, buf, plan };
}
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : `other:${e}`; } return 'ok'; };

describe('project archive', () => {
  it('round trip into a different store: same document (new id), media present and byte-identical, fresh history', async () => {
    const src = world(), dst = world();
    const { pid, blobs } = seeded(src);
    const { file, buf, plan } = await toFile(src, pid);
    expect(buf.length).toBe(plan.bytes); // the announced Content-Length is exact
    expect(buf.length % 512).toBe(0);
    const again = await toFile(src, pid, 'again.tar');
    expect(again.buf.equals(buf)).toBe(true); // deterministic
    const copy = path.join(dst.tmpDir, 'in.tar');
    fs.copyFileSync(file, copy);
    const r = importArchive(dst, copy);
    const before = src.getProject(pid).doc;
    expect(r.doc.id).not.toBe(before.id);
    expect({ ...r.doc, id: before.id }).toEqual(before);
    expect([r.revision, r.blobsAdded, r.blobsAlreadyPresent]).toEqual([0, 2, 0]);
    for (const b of blobs) expect(fs.readFileSync(dst.blobPath(b.hash)).equals(fs.readFileSync(src.blobPath(b.hash)))).toBe(true);
    // importing the same archive again reuses the media and makes another project
    fs.copyFileSync(file, copy);
    const r2 = importArchive(dst, copy);
    expect([r2.blobsAdded, r2.blobsAlreadyPresent]).toEqual([0, 2]);
    expect(dst.listProjects()).toHaveLength(2);
    // the imported project is a normal project: it accepts edits and undo
    const edited = dst.commit({ projectId: r.doc.id, actor: 'user:local', ops: [{ op: 'rename_project', args: { name: 'x' } }] });
    expect(edited.revision).toBe(1);
  });
  it('refuses damaged or hostile archives without adding anything', async () => {
    const src = world();
    const { pid } = seeded(src);
    const { buf } = await toFile(src, pid);
    const attempt = (mutate: (b: Buffer) => Buffer) => {
      const dst = world();
      const file = path.join(dst.tmpDir, 'bad.tar');
      fs.writeFileSync(file, mutate(Buffer.from(buf)));
      const result = code(() => importArchive(dst, file));
      return { result, projects: dst.listProjects().length, blobs: fs.readdirSync(path.join(dst.dataDir, 'blobs')).length, tmpLeft: fs.readdirSync(dst.tmpDir).filter((n) => n.startsWith('arc_')).length };
    };
    const clean = { projects: 0, blobs: 0, tmpLeft: 0 };
    // flip one byte inside the last media file
    expect(attempt((b) => { b[b.length - 1024 - 300] = b[b.length - 1024 - 300]! ^ 0xff; return b; })).toEqual({ result: '422:invalid_archive', ...clean });
    // rename an entry so it would escape the blob directory
    const rename = (b: Buffer, from: string, to: string) => { const i = b.indexOf(from); b.fill(0, i, i + 100); b.write(to, i, 'utf8'); let sum = 0; b.fill(' ', i + 148, i + 156); for (let k = i; k < i + 512; k++) sum += b[k]!; b.write(sum.toString(8).padStart(6, '0') + '\0 ', i + 148); return b; };
    expect(attempt((b) => rename(b, 'blobs/', '../../etc/passwd'))).toEqual({ result: '422:invalid_archive', ...clean });
    expect(attempt((b) => rename(b, 'project.json', 'project.jsox'))).toEqual({ result: '422:invalid_archive', ...clean });
    // truncated file, and something that is not a tar at all
    expect(attempt((b) => b.subarray(0, b.length - 3000))).toEqual({ result: '422:invalid_archive', ...clean });
    expect(attempt(() => Buffer.from('this is not an archive'.repeat(100)))).toEqual({ result: '422:invalid_archive', ...clean });
  });
  it('a project whose media is missing from the store cannot be archived (it would not be restorable)', () => {
    const src = world();
    const { pid, blobs } = seeded(src);
    fs.rmSync(src.blobPath(blobs[0]!.hash));
    expect(code(() => planArchive(src, pid))).toBe('409:missing_media');
  });
});
