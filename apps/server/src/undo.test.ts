import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { creativeProjection, type OpCall } from '@pulseframe/core';
import { ApiError, Store } from './store.ts';

const dirs: string[] = [];
const open = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-undo-')); dirs.push(d); return new Store(d); };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? e.code : `non-api:${e}`; } return 'ok'; };
const asset = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: { origin: 'fixture' as const, importedAt: 'x', importedBy: 'x' } };
function setup() {
  const s = open();
  const pid = s.createProject({ name: 'p' }).doc.id;
  const assetId = s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
  return { s, pid, assetId };
}
const proj = (s: Store, pid: string) => creativeProjection(s.getProject(pid).doc);

describe('compensating undo / redo', () => {
  it('undo restores the creative state and redo restores it again; both are new revisions', () => {
    const { s, pid, assetId } = setup();
    const p0 = proj(s, pid);
    const add = s.commit({ projectId: pid, actor: 'u', ops: [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(60) } }] });
    const p1 = proj(s, pid);
    s.commit({ projectId: pid, actor: 'u', ops: [{ op: 'split_clip', args: { clipId: add.results[0]!.output!.clipId, at: f(30) } }] });
    const p2 = proj(s, pid);
    const u1 = s.undo(pid, 'u', 'undo');
    expect(u1).toMatchObject({ committed: true, kind: 'undo', revision: 4 });
    expect(proj(s, pid)).toBe(p1);
    s.undo(pid, 'u', 'undo');
    expect(proj(s, pid)).toBe(p0);
    expect(code(() => s.undo(pid, 'u', 'undo'))).toBe('nothing_to_undo'); // the import belongs to another actor
    s.undo(pid, 'u', 'redo');
    expect(proj(s, pid)).toBe(p1);
    s.undo(pid, 'u', 'redo');
    expect(proj(s, pid)).toBe(p2);
    expect(code(() => s.undo(pid, 'u', 'redo'))).toBe('nothing_to_redo');
    expect(s.getProject(pid).revision).toBe(7); // history only grows
    expect(s.replay(pid).doc).toEqual(s.getProject(pid).doc); // undo/redo are replayable from the op log
  });
  it('a new edit after undo abandons the redo branch', () => {
    const { s, pid } = setup();
    s.commit({ projectId: pid, actor: 'u', ops: [{ op: 'add_text', args: { text: 'a', start: f(0), duration: f(30) } }] });
    s.undo(pid, 'u', 'undo');
    s.commit({ projectId: pid, actor: 'u', ops: [{ op: 'add_text', args: { text: 'b', start: f(0), duration: f(30) } }] });
    expect(code(() => s.undo(pid, 'u', 'redo'))).toBe('nothing_to_redo');
  });
  it("one actor's undo keeps another actor's unrelated later edit", () => {
    const { s, pid } = setup();
    const a = s.commit({ projectId: pid, actor: 'user:a', ops: [{ op: 'add_text', args: { text: 'A', start: f(0), duration: f(30) } }] });
    const b = s.commit({ projectId: pid, actor: 'agent:b', ops: [{ op: 'add_text', args: { text: 'B', start: f(60), duration: f(30) } }] });
    s.undo(pid, 'user:a', 'undo');
    const clips = s.getProject(pid).doc.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips;
    expect(clips.map((c) => c.id)).toEqual([b.results[0]!.output!.clipId]);
    expect(clips.some((c) => c.id === a.results[0]!.output!.clipId)).toBe(false);
  });
  it('refuses an undo whose items were changed later, names them, and changes nothing', () => {
    const { s, pid } = setup();
    const a = s.commit({ projectId: pid, actor: 'user:a', ops: [{ op: 'add_text', args: { text: 'A', start: f(0), duration: f(30) } }] });
    const clipId = a.results[0]!.output!.clipId as string;
    s.commit({ projectId: pid, actor: 'agent:b', ops: [{ op: 'update_text', args: { clipId, text: 'changed by B' } }] });
    const before = proj(s, pid);
    let err: ApiError | undefined;
    try { s.undo(pid, 'user:a', 'undo'); } catch (e) { err = e as ApiError; }
    expect(err?.code).toBe('undo_conflict');
    expect((err!.details.conflicts as any[])[0]).toMatchObject({ entityId: clipId, revision: 3, actor: 'agent:b' });
    expect(proj(s, pid)).toBe(before);
    expect(s.getProject(pid).revision).toBe(3);
    // B undoes their change; now A's undo is safe again.
    s.undo(pid, 'agent:b', 'undo');
    expect(s.undo(pid, 'user:a', 'undo').committed).toBe(true);
  });
  it('refuses an undo that would recreate an overlap (space taken by a later clip)', () => {
    const { s, pid, assetId } = setup();
    const a = s.commit({ projectId: pid, actor: 'a', ops: [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(60), trackId: 'trk_video', withLinkedAudio: false } }] });
    s.commit({ projectId: pid, actor: 'a', ops: [{ op: 'delete_clip', args: { clipId: a.results[0]!.output!.clipId } }] });
    s.commit({ projectId: pid, actor: 'b', ops: [{ op: 'add_clip', args: { assetId, start: f(30), duration: f(60), trackId: 'trk_video', withLinkedAudio: false } }] });
    expect(code(() => s.undo(pid, 'a', 'undo'))).toBe('undo_conflict');
  });
});

describe('semantic rebase with entity versions', () => {
  it('accepts a stale base when untouched items are edited, rejects when a dependency changed, and reports who changed it', () => {
    const { s, pid } = setup();
    const x = s.commit({ projectId: pid, actor: 'u', ops: [{ op: 'add_text', args: { text: 'X', start: f(0), duration: f(30) } }] }).results[0]!.output!.clipId as string;
    const y = s.commit({ projectId: pid, actor: 'u', ops: [{ op: 'add_text', args: { text: 'Y', start: f(60), duration: f(30) } }] }).results[0]!.output!.clipId as string;
    const base = s.getProject(pid).revision; // 3
    s.commit({ projectId: pid, actor: 'agent', ops: [{ op: 'update_text', args: { clipId: y, text: 'Y2' } }] });
    const ok = s.commit({ projectId: pid, actor: 'u', baseRevision: base, ops: [{ op: 'update_text', args: { clipId: x, text: 'X2' } }] });
    expect(ok).toMatchObject({ committed: true, rebasedFrom: base, revision: 5 });
    let err: ApiError | undefined;
    try { s.commit({ projectId: pid, actor: 'u', baseRevision: base, ops: [{ op: 'update_text', args: { clipId: y, text: 'mine' } }] }); } catch (e) { err = e as ApiError; }
    expect(err?.code).toBe('conflict');
    expect(err!.details.conflicts).toEqual([{ entityId: y, changedAtRevision: 4, by: 'agent', deleted: false }]);
    // Deleted dependency -> conflict (not a bare not_found), and explicit dependsOn is honoured.
    s.commit({ projectId: pid, actor: 'agent', ops: [{ op: 'delete_clip', args: { clipId: y } }] });
    expect(code(() => s.commit({ projectId: pid, actor: 'u', baseRevision: 5, ops: [{ op: 'split_clip', args: { clipId: y, at: f(70) } }] }))).toBe('conflict');
    expect(code(() => s.commit({ projectId: pid, actor: 'u', baseRevision: 5, dependsOn: [y], ops: [{ op: 'rename_project', args: { name: 'n' } }] }))).toBe('conflict');
    expect(code(() => s.commit({ projectId: pid, actor: 'u', baseRevision: 99, ops: [{ op: 'rename_project', args: { name: 'n' } }] }))).toBe('invalid_request');
    expect(s.entityVersion(pid, y)).toMatchObject({ revision: 6, deleted: true });
    expect(s.entityVersion(pid, 'trk_video')).toBeNull();
  });
  it('strict expectedRevision still rejects any movement', () => {
    const { s, pid } = setup();
    expect(code(() => s.commit({ projectId: pid, actor: 'u', expectedRevision: 0, ops: [{ op: 'rename_project', args: { name: 'n' } }] }))).toBe('stale_revision');
  });
});

describe('undo-all / redo-all (property, single actor)', () => {
  it('restores the exact creative projection at every step, including rejected operations', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(6), fc.nat(200), fc.nat(200), fc.nat(40)), { minLength: 3, maxLength: 25 }), (steps) => {
        const { s, pid, assetId } = setup();
        const states = [proj(s, pid)];
        for (const [kind, a, b, pick] of steps) {
          const ids = s.getProject(pid).doc.sequences.seq_main!.tracks.flatMap((t) => t.clips.map((c) => c.id));
          const clipId = ids.length ? ids[pick % ids.length]! : 'none';
          const op: OpCall = [
            { op: 'add_clip', args: { assetId, start: f(a), sourceIn: f(b % 200), duration: f(1 + (pick % 39)) } },
            { op: 'add_text', args: { text: `שלום ${a}`, start: f(a), duration: f(1 + (b % 60)) } },
            { op: 'move_clip', args: { clipId, start: f(a) } },
            { op: 'trim_clip', args: { clipId, edge: b % 2 ? 'start' : 'end', to: f(a) } },
            { op: 'split_clip', args: { clipId, at: f(a) } },
            { op: 'delete_clip', args: { clipId } },
            { op: 'set_clip_transform', args: { clipId, transform: { x: (a - 100) / 400, scale: 1 + b / 400 } } },
          ][kind]!;
          try {
            if (s.commit({ projectId: pid, actor: 'u', ops: [op] }).committed) states.push(proj(s, pid));
          } catch (e) {
            if (!(e instanceof ApiError)) throw e;
            if (proj(s, pid) !== states.at(-1)) throw new Error('rejected op changed state');
          }
        }
        for (let i = states.length - 2; i >= 0; i--) { s.undo(pid, 'u', 'undo'); if (proj(s, pid) !== states[i]) throw new Error(`undo to state ${i} differs`); }
        for (let i = 1; i < states.length; i++) { s.undo(pid, 'u', 'redo'); if (proj(s, pid) !== states[i]) throw new Error(`redo to state ${i} differs`); }
        const ok = JSON.stringify(s.replay(pid).doc) === JSON.stringify(s.getProject(pid).doc);
        s.close();
        return ok;
      }),
      { numRuns: Number(process.env.PF_PROPERTY_RUNS ?? 60) },
    );
  }, 120_000);
});
