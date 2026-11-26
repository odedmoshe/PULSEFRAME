/**
 * Store.undoActor — «ביטול הכול» (wave 8 autonomy Part 2; verifier C6): every edit of one actor since a revision reversed as ONE
 * revision, composed over all its kinds (its own undos and redos included), never erasing an edit another actor made in between,
 * every reversed transaction marked in the same SQLite transaction, and a redo of the composite that restores the actor's states and
 * clears every mark.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { canonical, entityMap } from '@pulseframe/core';
import { Store } from './store.ts';

let dir: string, store: Store, pid: string;
const RUN = 'agent:run_testrun01';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-undo-actor-'));
  store = new Store(dir);
  pid = store.createProject({ name: 'undo actor', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
});
afterEach(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const addText = (actor: string, text: string, at: number) => {
  const r = store.commit({ projectId: pid, actor, ops: [{ op: 'add_text', args: { text, start: T.rt(at, 1), duration: T.rt(1, 1) } }] });
  return { ...r, clipId: r.results[0]!.output!.clipId as string };
};
const setText = (actor: string, clipId: string, text: string) => store.commit({ projectId: pid, actor, ops: [{ op: 'update_text', args: { clipId, text } }] });
const textOf = (clipId: string) => { const e = entityMap(store.wholeProject(pid).doc).get(clipId) as any; return e ? (e.clip.text as string) : null; };
const digest = () => canonical([...entityMap(store.wholeProject(pid).doc)].filter(([, e]) => e.kind !== 'project'));
const undoneBy = (id: string) => (store.db.prepare('SELECT undone_by FROM transactions WHERE id = ?').get(id) as { undone_by: string | null }).undone_by;

describe('Store.undoActor', () => {
  it('reverses every edit of the actor since a revision as ONE revision and marks each reversed transaction', () => {
    const owner = addText('user:local', 'של הבעלים', 0);
    const start = store.wholeProject(pid).revision;
    const before = digest();
    const a = addText(RUN, 'א', 2);
    const b = setText(RUN, a.clipId, 'א2');
    const c = addText(RUN, 'ב', 4);
    const r = store.undoActor(pid, RUN, start, { byActor: 'user:local' });
    expect(r.transactionId).toBeTruthy();
    expect(r.revision).toBe(start + 4);
    expect(r.undoes).toEqual([a.transactionId, b.transactionId, c.transactionId]);
    expect(r.entities).toBe(2);
    expect(digest()).toBe(before);
    expect(textOf(owner.clipId)).toBe('של הבעלים');
    for (const t of r.undoes) expect(undoneBy(t)).toBe(r.transactionId);
    const stored = store.db.prepare('SELECT actor, kind, undoes, result FROM transactions WHERE id = ?').get(r.transactionId) as any;
    expect([stored.actor, stored.kind, stored.undoes]).toEqual(['user:local', 'undo', a.transactionId]);
    expect(JSON.parse(stored.result).undoesAll).toEqual(r.undoes);
    // nothing left: a second call is not an error and commits nothing
    const again = store.undoActor(pid, RUN, start, { byActor: 'user:local' });
    expect([again.transactionId, again.undoes, again.revision]).toEqual([null, [], r.revision]);
  });

  it('C6 interleaved: run edits X, the owner edits X, the run edits X again → 409 listing X by the owner, nothing applied; partial undoes the rest and X keeps the owner\'s state', () => {
    const start = store.wholeProject(pid).revision;
    const x = addText(RUN, 'run 1', 0); // r1
    const y = addText(RUN, 'other', 3); // r2
    setText('user:local', x.clipId, 'owner'); // r3
    setText(RUN, x.clipId, 'run 2'); // r4: the current state equals the run's last after — the old check would pass and erase r3
    const rev = store.wholeProject(pid).revision;
    let err: any = null;
    try { store.undoActor(pid, RUN, start, { byActor: 'user:local' }); } catch (e) { err = e; }
    expect(err?.status).toBe(409);
    expect(err?.code).toBe('undo_conflict');
    expect(err.details.conflicts).toEqual([{ entityId: x.clipId, changedAtRevision: 3, by: 'user:local' }]);
    expect(store.wholeProject(pid).revision).toBe(rev);
    const dry = store.undoActor(pid, RUN, start, { byActor: 'user:local', dryRun: true });
    expect([dry.transactionId, dry.entities, dry.conflicts.length]).toEqual([null, 1, 1]);
    expect(store.wholeProject(pid).revision).toBe(rev);
    const part = store.undoActor(pid, RUN, start, { byActor: 'user:local', partial: true });
    expect(part.transactionId).toBeTruthy();
    expect(textOf(y.clipId)).toBeNull();
    expect(textOf(x.clipId)).toBe('run 2'); // kept: the owner's edit in between is never overwritten
  });

  it('composes the actor\'s own undo and redo (no false conflict, no wrong state)', () => {
    const start = store.wholeProject(pid).revision;
    const before = digest();
    const x = addText(RUN, 'one', 0);
    setText(RUN, x.clipId, 'two');
    store.undo(pid, RUN, 'undo'); // back to 'one'
    store.undo(pid, RUN, 'redo'); // 'two' again
    store.undo(pid, RUN, 'undo'); // 'one'
    expect(textOf(x.clipId)).toBe('one');
    const r = store.undoActor(pid, RUN, start, { byActor: 'user:local' });
    expect(r.conflicts).toEqual([]);
    expect(digest()).toBe(before);
    expect(r.undoes).toHaveLength(5);
  });

  it('redo of the composite restores the run\'s states and clears every undone_by mark; undoing again works', () => {
    const start = store.wholeProject(pid).revision;
    const x = addText(RUN, 'one', 0);
    const s = setText(RUN, x.clipId, 'two');
    const after = digest();
    const r = store.undoActor(pid, RUN, start, { byActor: 'user:local' });
    expect(textOf(x.clipId)).toBeNull();
    const redo = store.undo(pid, 'user:local', 'redo');
    expect(redo.undoes).toBe(r.transactionId);
    expect(digest()).toBe(after);
    expect(undoneBy(x.transactionId!)).toBeNull();
    expect(undoneBy(s.transactionId!)).toBeNull();
    expect(undoneBy(r.transactionId!)).toBe(redo.transactionId);
    expect(JSON.parse((store.db.prepare('SELECT result FROM transactions WHERE id = ?').get(redo.transactionId) as any).result).redoesAll).toEqual(r.undoes);
    // the composite and its redo are not read as another actor's conflicting edits
    const again = store.undoActor(pid, RUN, start, { byActor: 'user:local' });
    expect(again.transactionId).toBeTruthy();
    expect(textOf(x.clipId)).toBeNull();
  });

  it('Ctrl+Z on the redo of the composite marks the run\'s transactions again, and the next redo clears them again (lead decision 5)', () => {
    const start = store.wholeProject(pid).revision;
    const x = addText(RUN, 'one', 0);
    const s = setText(RUN, x.clipId, 'two');
    const before = digest();
    const r = store.undoActor(pid, RUN, start, { byActor: 'user:local' });
    const undone = digest();
    store.undo(pid, 'user:local', 'redo');
    expect(digest()).toBe(before);
    const z = store.undo(pid, 'user:local', 'undo'); // Ctrl+Z: the redo is reversed
    expect(digest()).toBe(undone);
    expect([undoneBy(x.transactionId!), undoneBy(s.transactionId!)]).toEqual([z.transactionId, z.transactionId]);
    expect(JSON.parse((store.db.prepare('SELECT result FROM transactions WHERE id = ?').get(z.transactionId) as any).result).undoesAll).toEqual(r.undoes);
    const y = store.undo(pid, 'user:local', 'redo'); // Ctrl+Shift+Z again
    expect(digest()).toBe(before);
    expect([undoneBy(x.transactionId!), undoneBy(s.transactionId!)]).toEqual([null, null]);
    expect(undoneBy(z.transactionId!)).toBe(y.transactionId);
  });

  it('an edit the owner already undid on its own is not reversed twice', () => {
    const start = store.wholeProject(pid).revision;
    const x = addText(RUN, 'one', 0);
    const y = addText(RUN, 'two', 3);
    store.undo(pid, 'user:local', 'undo', x.transactionId!, undefined, true);
    const r = store.undoActor(pid, RUN, start, { byActor: 'user:local' });
    expect(r.undoes).toEqual([y.transactionId]);
    expect([textOf(x.clipId), textOf(y.clipId)]).toEqual([null, null]);
  });

  it('a guard refusal rolls the whole composite back (no mark left)', () => {
    const start = store.wholeProject(pid).revision;
    const x = addText(RUN, 'one', 0);
    expect(() => store.undoActor(pid, RUN, start, { byActor: 'agent:x', guard: () => { throw new Error('refused'); } })).toThrow('refused');
    expect(undoneBy(x.transactionId!)).toBeNull();
    expect(textOf(x.clipId)).toBe('one');
  });
});
