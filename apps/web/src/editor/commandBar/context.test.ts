/** buildBarContext: the exact undo and redo targets from the activity list, and the injected ops. */
import { describe, expect, it, vi } from 'vitest';
import { applyTransaction, createProject } from '@pulseframe/core';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { Editor } = await import('../store.ts');
const { buildBarContext, contextFrom, redoTargetOf, undoTargetOf } = await import('./context.ts');

const R = { num: 30, den: 1 };
const base = createProject({ id: 'prj_c', name: 'C', width: 1920, height: 1080, frameRate: R });
const two = applyTransaction(base, [{ op: 'add_sequence', args: { name: 'Short', tracks: 'empty' } }], { idSeed: 'c_', actor: 't' }).doc;
const other = Object.keys(two.sequences).find((k) => k !== two.mainSequenceId)!;
const ev = (revision: number, transactionId: string, extra: object = {}) => ({ projectId: 'p', revision, transactionId, actor: 'user:local', label: null, summary: '', affectedIds: [], at: '', kind: 'edit', ops: ['split_clip'], undoes: null, undoneBy: null, ...extra });

describe('undo and redo targets', () => {
  it('the undo target is the owner\'s newest edit or redo not yet undone; others\' edits are skipped', () => {
    const a = [ev(5, 'tx_agent', { actor: 'agent:x' }), ev(4, 'tx_b'), ev(3, 'tx_a')];
    expect(undoTargetOf(a, 'user:local')).toEqual({ transactionId: 'tx_b', ops: ['split_clip'] });
    expect(undoTargetOf([ev(4, 'tx_b', { undoneBy: 'tx_u' }), ev(3, 'tx_a')], 'user:local')?.transactionId).toBe('tx_a');
    expect(undoTargetOf([ev(4, 'tx_r', { kind: 'redo' })], 'user:local')?.transactionId).toBe('tx_r');
    expect(undoTargetOf([], 'user:local')).toBeNull();
    expect(undoTargetOf(a, null)).toBeNull();
  });
  it('the redo target is the owner\'s newest undo, gone once the owner edits after it or it was undone', () => {
    const undo = ev(6, 'tx_u', { kind: 'undo', undoes: 'tx_b' });
    expect(redoTargetOf([undo, ev(4, 'tx_b', { undoneBy: 'tx_u' })], 'user:local')?.transactionId).toBe('tx_u');
    expect(redoTargetOf([ev(7, 'tx_new'), undo], 'user:local')).toBeNull();
    expect(redoTargetOf([{ ...undo, undoneBy: 'tx_r' }], 'user:local')).toBeNull();
  });
});

describe('buildBarContext', () => {
  it('is null without a project', () => { expect(buildBarContext(new Editor())).toBeNull(); });
  it('carries the editor state, and inject is the editor\'s own sequence injection', () => {
    const ed = new Editor();
    ed.set({ doc: two, rawDoc: two, activeSequenceId: other, revision: 7, lang: 'en', selection: ['clp_x'], actor: 'user:local', activity: [ev(7, 'tx_z')], workspace: 'sound', cutClipId: null, viewVariantId: null });
    const ctx = buildBarContext(ed)!;
    expect(ctx).toMatchObject({ revision: 7, lang: 'en', selection: ['clp_x'], activeSequenceId: other, workspace: 'sound', performRecording: false, playheadFrame: 0 });
    expect(ctx.undoTarget?.transactionId).toBe('tx_z');
    const injected = ctx.inject({ op: 'close_gaps', args: {} });
    expect((injected.args as { sequenceId?: string }).sequenceId).toBe(other);
    expect(contextFrom(ed.getState(), 12)!.playheadFrame).toBe(12);
  });
});
