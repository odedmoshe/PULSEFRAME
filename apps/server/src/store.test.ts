import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { ApiError, Store, type RevisionEvent } from './store.ts';
import { fieldIssues } from './preflight.fields.ts';

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-store-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const text = (n: number) => ({ op: 'add_text', args: { text: `t${n}`, start: T.frameTime(n * 30, { num: 30, den: 1 }), duration: T.rt(1, 1) } });
const status = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : String(e); } return 'ok'; };

describe('Store', () => {
  it('commits atomically, publishes each revision once, and replays from the op log', () => {
    const s = new Store(tmp());
    const seen: number[] = [];
    s.events.on('revision', (e: RevisionEvent) => seen.push(e.revision));
    const { doc } = s.createProject({ name: 'p' });
    const a = s.commit({ projectId: doc.id, actor: 'user:a', ops: [text(0), text(1)] });
    expect(a).toMatchObject({ committed: true, revision: 1 });
    expect(status(() => s.commit({ projectId: doc.id, actor: 'user:a', ops: [text(2), { op: 'delete_clip', args: { clipId: 'missing' } }] }))).toBe('404:not_found');
    expect(s.getProject(doc.id).revision).toBe(1); // failed batch left nothing behind
    s.commit({ projectId: doc.id, actor: 'agent:b', ops: [text(3)] });
    expect(seen).toEqual([1, 2]);
    expect(s.replay(doc.id).doc).toEqual(s.getProject(doc.id).doc);
    expect(s.replay(doc.id, 1).doc.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips.length).toBe(2);
    expect(status(() => s.replay(doc.id, 9))).toBe('404:revision_not_found');
    s.close();
  });
  it('enforces expectedRevision, idempotency keys and internal-op protection; dry run commits nothing', () => {
    const s = new Store(tmp());
    const { doc } = s.createProject({ name: 'p' });
    const first = s.commit({ projectId: doc.id, actor: 'u', ops: [text(0)], idempotencyKey: 'k1', expectedRevision: 0 });
    const again = s.commit({ projectId: doc.id, actor: 'u', ops: [text(0)], idempotencyKey: 'k1', expectedRevision: 0 });
    expect(again).toMatchObject({ replayed: true, revision: first.revision, transactionId: first.transactionId });
    // Same intent with different key order / an equivalent unreduced time (e.g. another transport) is still the same request.
    const reordered = { args: { duration: { timescale: 2, value: '2' }, start: text(0).args.start, text: 't0' }, op: 'add_text' };
    expect(s.commit({ projectId: doc.id, actor: 'u', ops: [reordered], idempotencyKey: 'k1' })).toMatchObject({ replayed: true, revision: first.revision });
    expect(status(() => s.commit({ projectId: doc.id, actor: 'u', ops: [text(5)], idempotencyKey: 'k1' }))).toBe('409:idempotency_key_reused');
    expect(status(() => s.commit({ projectId: doc.id, actor: 'u', ops: [text(5)], expectedRevision: 0 }))).toBe('409:stale_revision');
    expect(status(() => s.commit({ projectId: doc.id, actor: 'u', ops: [{ op: 'import_asset', args: {} }] }))).toBe('403:forbidden_op');
    expect(s.commit({ projectId: doc.id, actor: 'u', ops: [text(5)], dryRun: true })).toMatchObject({ committed: false, revision: 1 });
    expect(s.getProject(doc.id).revision).toBe(1);
    s.close();
  });
  it('recovers after a crash between commit and publish, and re-queues interrupted jobs', () => {
    const dir = tmp();
    const s1 = new Store(dir);
    const { doc } = s1.createProject({ name: 'p' });
    s1.drainOutbox = () => 0; // simulate the process dying right after the database commit
    s1.commit({ projectId: doc.id, actor: 'u', ops: [text(0)] });
    const job = s1.createJob(doc.id, 'export', 'u', { revision: 1 });
    s1.updateJob(job.id, { status: 'running', stage: 'rendering 3/10' });
    s1.close();

    const s2 = new Store(dir);
    const seen: number[] = [];
    s2.events.on('revision', (e: RevisionEvent) => seen.push(e.revision));
    expect(s2.getProject(doc.id).revision).toBe(1); // the commit itself was durable
    expect(s2.drainOutbox()).toBe(1);
    expect(s2.drainOutbox()).toBe(0); // published exactly once
    expect(seen).toEqual([1]);
    expect(s2.eventsSince(doc.id, 0).map((e) => e.revision)).toEqual([1]);
    expect(s2.recoverJobs().map((j) => [j.id, j.status])).toEqual([[job.id, 'queued']]);
    s2.close();
  });
});

describe('Store: a project stored before the age formats were fixed (159a301)', () => {
  it('an {age:<id>:<format>} outside AGE_FORMATS, stored through update_text in a title with live fields, keeps committing and replaying, and the preflight reports field_no_data', () => {
    const s = new Store(tmp());
    const { doc } = s.createProject({ name: 'old' });
    const made = s.commit({ projectId: doc.id, actor: 'user:a', ops: [{ op: 'add_text', args: { text: '{date}', start: T.ZERO, duration: T.rt(1, 1) } }] });
    const clipId = (made.results[0]!.output as { clipId: string }).clipId;
    s.commit({ projectId: doc.id, actor: 'user:a', ops: [{ op: 'set_text_fields', args: { clipId, enabled: true } }] });
    s.commit({ projectId: doc.id, actor: 'agent:b', ops: [{ op: 'update_text', args: { clipId, text: '{date} {age:per_x:years}' } }] });
    expect(s.commit({ projectId: doc.id, actor: 'user:a', ops: [text(2)] })).toMatchObject({ committed: true, revision: 4 }); // an unrelated edit
    expect(s.replay(doc.id).doc).toEqual(s.getProject(doc.id).doc);
    expect(s.replay(doc.id, 3).revision).toBe(3);
    const issues = fieldIssues(s.getProject(doc.id).doc).filter((i) => i.code === 'field_no_data');
    expect(issues.map((i) => i.message).join(' ')).toContain('{age:per_x:years}: the age field has a format that does not exist');
    s.close();
  });
});
