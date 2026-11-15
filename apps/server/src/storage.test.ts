import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { Principal } from './auth.ts';
import { collectGarbage, deleteProject, storageReport } from './storage.ts';
import { ApiError, Store } from './store.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const agent: Principal = { actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] };
const R = { num: 30, den: 1 };
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : `other:${e}`; } return 'ok'; };
const LATER = Date.now() + 60 * 60_000; // past the grace period

function world() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-gc-'));
  dirs.push(d);
  const store = new Store(d);
  const blob = (seed: number) => {
    const bytes = Buffer.from(Array.from({ length: 2000 + seed }, (_, i) => (i * 7 + seed) & 0xff));
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const tmp = path.join(store.tmpDir, `b${seed}`);
    fs.writeFileSync(tmp, bytes);
    store.putBlob(hash, tmp, bytes.length, 'video/mp4');
    return hash;
  };
  const project = (name: string, hashes: string[]) => {
    const pid = store.createProject({ name }).doc.id;
    store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: hashes.map((h, i) => ({ op: 'import_asset', args: { asset: { kind: 'video', name: `m${i}.mp4`, contentHash: h, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(4, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 120 }, provenance: { origin: 'fixture', importedAt: 'x', importedBy: 't' } } } })) });
    return pid;
  };
  const exists = (h: string) => fs.existsSync(store.blobPath(h));
  return { store, blob, project, exists };
}

describe('project deletion and storage clean-up', () => {
  it('only the owner can delete, the name must match exactly, and running jobs block it', () => {
    const w = world();
    const pid = w.project('פרויקט א', [w.blob(1)]);
    expect(code(() => deleteProject(w.store, agent, pid, 'פרויקט א'))).toBe('403:owner_required');
    expect(code(() => deleteProject(w.store, owner, pid, 'פרויקט'))).toBe('409:confirmation_mismatch');
    const job = w.store.createJob(pid, 'export', 'user:local', {});
    expect(code(() => deleteProject(w.store, owner, pid, 'פרויקט א'))).toBe('409:jobs_running');
    w.store.updateJob(job.id, { status: 'failed' });
    expect(w.store.listProjects()).toHaveLength(1);
    const r = deleteProject(w.store, owner, pid, 'פרויקט א');
    expect(r.deleted.id).toBe(pid);
    expect(w.store.listProjects()).toHaveLength(0);
    expect(code(() => w.store.getProject(pid))).toBe('404:project_not_found');
    for (const t of ['transactions', 'jobs', 'entity_versions', 'outbox']) expect((w.store.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE project_id = ?`).get(pid) as any).n).toBe(0);
  });
  it('clean-up keeps anything still referenced (other projects, history), is a dry run by default, respects the grace period, and is owner-only', () => {
    const w = world();
    const shared = w.blob(1), onlyA = w.blob(2), onlyB = w.blob(3), orphan = w.blob(4);
    const a = w.project('A', [shared, onlyA]);
    w.project('B', [shared, onlyB]);
    expect(code(() => storageReport(w.store, agent))).toBe('403:owner_required');
    // right now everything unreferenced is too new to judge
    expect(storageReport(w.store, owner).unreferenced).toMatchObject({ files: 0, tooNewToJudge: 1 });
    expect(storageReport(w.store, owner, LATER).unreferenced).toMatchObject({ files: 1, hashes: [orphan.slice(7)] });
    deleteProject(w.store, owner, a, 'A');
    const dry = collectGarbage(w.store, owner, false, LATER);
    expect(dry.applied).toBe(false);
    expect([shared, onlyA, onlyB, orphan].every(w.exists)).toBe(true); // a dry run removes nothing
    expect(code(() => collectGarbage(w.store, agent, true, LATER))).toBe('403:owner_required');
    const done = collectGarbage(w.store, owner, true, LATER);
    expect(done).toMatchObject({ applied: true, removed: { files: 2 } });
    expect([w.exists(shared), w.exists(onlyB), w.exists(onlyA), w.exists(orphan)]).toEqual([true, true, false, false]);
    expect(storageReport(w.store, owner, LATER)).toMatchObject({ projects: 1, media: { files: 2 }, unreferenced: { files: 0 } });
    // running it again is harmless
    expect(collectGarbage(w.store, owner, true, LATER)).toMatchObject({ removed: { files: 0 } });
  });
});
