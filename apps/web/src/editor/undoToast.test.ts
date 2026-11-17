/**
 * An undo toast undoes the edit it reports, not the newest one (review: two deletes, Undo on the first toast brought back the
 * second clip). The delete command names its transaction in the notice; the toast's button undoes exactly that transaction.
 */
import { describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { COMMANDS, deleteNotice } from './commands.ts';
import { toastOf } from './undoToast.ts';
import type { Editor, Notice } from './store.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'beach.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1), video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, provenance };
function project() {
  let r = applyTransaction(createProject({ id: 'prj_u', name: 'U', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset: video } }], { idSeed: 'u0_', actor: 'test', allowInternal: true });
  const a = r.results[0]!.output!.assetId as string;
  r = applyTransaction(r.doc, [0, 1, 2].map((i): OpCall => ({ op: 'add_clip', args: { assetId: a, start: f(i * 30), duration: f(30) } })), { idSeed: 'u1_', actor: 'test' });
  return { doc: r.doc, ids: r.results.map((x) => x.output!.clipId as string) };
}
/** An editor with just what the delete command and the toast use; each commit is a new transaction tx_1, tx_2, … */
function fakeEditor(doc: ProjectDocument) {
  const notices: Notice[] = [];
  let selection: string[] = [];
  let tx = 0;
  const e = {
    doc, notices, select: (ids: string[]) => { selection = ids; },
    getState: () => ({ lang: 'he' as const, selection }),
    commit: async (ops: () => OpCall[] | null) => (ops() ? { transactionId: `tx_${++tx}`, revision: tx, committed: true, summary: '', affectedIds: [], results: [] } : null),
    notify: (n: Notice) => void notices.push(n),
    undoTransaction: vi.fn(async (_id: string) => {}),
    history: vi.fn(async (_m: 'undo' | 'redo') => {}),
  };
  return e;
}
const run = (id: string, e: ReturnType<typeof fakeEditor>) => COMMANDS.find((c) => c.id === id)!.run(e as unknown as Editor);

describe('the undo toast of a delete', () => {
  it('undoes the delete it reports even after a later edit, never the newest one', async () => {
    const { doc, ids } = project();
    const e = fakeEditor(doc);
    e.select([ids[0]!]); await run('edit.delete', e);
    e.select([ids[2]!]); await run('edit.delete', e);
    expect(e.notices.map((n) => n.undoes)).toEqual(['tx_1', 'tx_2']);
    const first = toastOf(e.notices[0]!, 'ביטול', e);
    expect(first.kind).toBe('undo');
    first.onAction!();
    expect(e.undoTransaction).toHaveBeenCalledWith('tx_1');
    expect(e.history).not.toHaveBeenCalled();
  });
  it('names the clip it deleted, or the count', async () => {
    const { doc, ids } = project();
    const e = fakeEditor(doc);
    e.select([ids[1]!]); await run('edit.delete', e);
    expect(e.notices[0]!.title).toBe('הקליפ "beach.mp4" נמחק');
    e.select([ids[0]!, ids[2]!]); await run('edit.deleteKeepGap', e);
    expect(e.notices[1]!.title).toBe('2 קליפים נמחקו');
  });
  it('offers no undo button when the commit made no transaction', () => {
    const n = deleteNotice('en', { moved: 0, deleted: 1, ripple: false, name: null }, null);
    expect(n.kind).toBe('info');
    const t = toastOf(n, 'Undo', { undoTransaction: vi.fn() });
    expect(t.action).toBeUndefined();
    expect(t.onAction).toBeUndefined();
    // an undo notice that names no transaction is shown without the button too
    expect(toastOf({ kind: 'undo', title: 'x' }, 'Undo', { undoTransaction: vi.fn() }).onAction).toBeUndefined();
  });
});
