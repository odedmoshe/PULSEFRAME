/**
 * Lead contracts of the Hebrew command bar in the editor (ADR-0027): the strict commit sends exactly the given ops with
 * expectedRevision and the given idempotency key (no rebase, no second injection) and reports a stale revision; the activity
 * list marks what an undo reversed; the export sheet opens with a destination chosen as by its tile; the moved edit helpers
 * are the very functions the commands use; the fixed test ids; and the palette's bar slot placeholder offers no option, so
 * the palette is unchanged until W3. The Editor is real; localStorage and fetch are labelled stand-ins.
 */
import { describe, expect, it, vi } from 'vitest';
import * as core from '@pulseframe/core';
import { applyTransaction, createProject, EXPORT_DESTINATION_IDS, type OpCall } from '@pulseframe/core';
import * as T from '@pulseframe/time';

// ---- labelled stand-ins (test only) ----
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { Editor, withRevisionEvent } = await import('../store.ts');
const { api, ApiFailure } = await import('../../api.ts');
// ---- end of stand-ins ----
import { BEHAVIOUR_OP, deleteOps, editEnd, mainTrackId, rippleDeleteOn } from '../commands.ts';
import { trackRole } from '../inspector.model.ts';
import { DESTINATIONS, destinationPick, type ExportTarget } from '../exportSheet.logic.ts';
import { BAR_DOM_IDS, BAR_KEYS, COMMAND_BAR_TESTIDS } from './commandBar.testids.ts';
import { PERFORM_TESTIDS } from '../perform/perform.testids.ts';
import { SHORTS_TESTIDS } from '../shorts.testids.ts';
import { MULTICAM_TESTIDS } from '../multicam.testids.ts';
import { RENDER_CACHE_TESTIDS } from '../renderCache.testids.ts';

const R = { num: 30, den: 1 };
const two = applyTransaction(createProject({ id: 'prj_cb', name: 'CB', width: 1920, height: 1080, frameRate: R }), [{ op: 'add_sequence', args: { name: 'Short', tracks: 'empty' } }], { idSeed: 'cb_', actor: 't' }).doc;
const other = Object.keys(two.sequences).find((k) => k !== two.mainSequenceId)!;

describe('Editor.commitExact (contract (b))', () => {
  it('sends the ops as given (no second injection), strict at the given revision, with the given key and label; queued like commit', async () => {
    const seen: unknown[][] = [];
    const commit = vi.spyOn(api, 'commitExact').mockImplementation(async (...a: unknown[]) => { seen.push(a); return { revision: 8, committed: true, transactionId: 'tx_1', summary: '', affectedIds: [], results: [], replayed: false }; });
    const ed = new Editor();
    const load = vi.spyOn(ed, 'load').mockResolvedValue(undefined as never);
    ed.set({ doc: two, rawDoc: two, activeSequenceId: other, revision: 7, lang: 'en' });
    const ops: OpCall[] = [{ op: 'add_marker', args: { time: T.frameTime(3, R), label: '' } }]; // no sequenceId: it must stay without one
    const r = await ed.commitExact(ops, 'Command bar: add_marker', 7, 'bar:abc');
    expect(seen).toEqual([['prj_cb', 7, ops, 'Command bar: add_marker', 'bar:abc']]);
    expect(r).toMatchObject({ kind: 'committed', replayed: false, result: { transactionId: 'tx_1' } });
    commit.mockRestore(); load.mockRestore();
  });
  it('a stale revision is reported (and the document reloaded), never retried or rebased', async () => {
    const commit = vi.spyOn(api, 'commitExact').mockRejectedValue(new ApiFailure(409, 'stale_revision', 'stale', { expectedRevision: 7, currentRevision: 9 }));
    const ed = new Editor();
    const load = vi.spyOn(ed, 'load').mockResolvedValue(undefined as never);
    ed.set({ doc: two, rawDoc: two, revision: 7, lang: 'en' });
    expect(await ed.commitExact([{ op: 'close_gaps', args: {} }], 'Command bar: close_gaps', 7, 'bar:def')).toEqual({ kind: 'stale', currentRevision: 9 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalled();
    commit.mockRejectedValue(new ApiFailure(422, 'overlap', 'no room'));
    expect(await ed.commitExact([{ op: 'close_gaps', args: {} }], 'Command bar: close_gaps', 9, 'bar:ghi')).toMatchObject({ kind: 'failed', code: 'overlap' });
    expect(ed.getState().error).toBeNull(); // the bar says it, not the error bar
    commit.mockRestore(); load.mockRestore();
  });
  it('api.commitExact posts expectedRevision and the key, never baseRevision', async () => {
    const bodies: unknown[] = [];
    const fetchStub = vi.fn(async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ revision: 2, committed: true, summary: '', affectedIds: [], results: [] }), { headers: { 'content-type': 'application/json' } }); });
    vi.stubGlobal('fetch', fetchStub); // labelled stand-in
    await api.commitExact('prj_cb', 1, [{ op: 'close_gaps', args: {} }], 'Command bar: close_gaps', 'bar:k');
    expect(bodies).toEqual([{ expectedRevision: 1, idempotencyKey: 'bar:k', label: 'Command bar: close_gaps', ops: [{ op: 'close_gaps', args: {} }] }]);
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal('window', globalThis);
  });
});

describe('the undo state reaches the activity list (contract (c))', () => {
  it('an undo event marks what it reversed; other events change nothing else', () => {
    const ev = (revision: number, transactionId: string, extra: object = {}) => ({ projectId: 'p', revision, transactionId, actor: 'user:local', label: null, summary: '', affectedIds: [], at: '', kind: 'edit', undoes: null, undoneBy: null, ...extra });
    let a = withRevisionEvent([], ev(1, 'tx_a'));
    a = withRevisionEvent(a, ev(2, 'tx_b'));
    a = withRevisionEvent(a, ev(3, 'tx_u', { kind: 'undo', undoes: 'tx_b' }));
    expect(a.map((e) => [e.transactionId, e.undoneBy])).toEqual([['tx_u', null], ['tx_b', 'tx_u'], ['tx_a', null]]);
  });
});

describe('the export sheet opens with a destination (contract (d))', () => {
  it('the bar\'s destinations are the sheet\'s, and choosing one is exactly a click on its tile', () => {
    expect([...EXPORT_DESTINATION_IDS].sort()).toEqual(DESTINATIONS.map((d) => d.id).filter((id) => id !== 'custom').sort());
    const targets = [{ key: 'master', profileId: null, width: 1920, height: 1080 }] as unknown as ExportTarget[];
    const wa = DESTINATIONS.find((d) => d.id === 'whatsapp')!;
    expect(destinationPick(wa, targets, { quality: 'standard', captions: 'burned', format: 'mp4-h264-aac', scale: 0.5, targetBytes: null })).toEqual({ dest: 'whatsapp', keys: ['master'], choices: { quality: 'high', captions: 'burned', format: 'mp4-h264-aac', scale: 1, targetBytes: null } });
  });
  it('editor.openExportSheet(destination) asks the sheet host to open with it (and without one, the sheet\'s own default)', () => {
    const ed = new Editor();
    ed.openExportSheet('whatsapp');
    expect(ed.getState()).toMatchObject({ exportSheet: 1, exportSheetDestination: 'whatsapp' });
    ed.openExportSheet();
    expect(ed.getState()).toMatchObject({ exportSheet: 2, exportSheetDestination: null });
  });
});

describe('the edit helpers moved to core are the ones the editor uses (contract (e))', () => {
  it('commands.ts and inspector.model.ts re-export the core functions themselves', () => {
    expect(deleteOps).toBe(core.deleteOps);
    expect(rippleDeleteOn).toBe(core.rippleDeleteOn);
    expect(mainTrackId).toBe(core.mainTrackId);
    expect(editEnd).toBe(core.editEnd);
    expect(BEHAVIOUR_OP).toBe(core.BEHAVIOUR_OP);
    expect(trackRole).toBe(core.trackRole);
  });
});

describe('fixed test ids and DOM ids', () => {
  const flat = (t: Record<string, unknown>): string[] => Object.values(t).flatMap((v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? flat(v as Record<string, unknown>) : []));
  it('are unique, prefixed, and do not clash with the other fixed tables', () => {
    const ids = Object.values(COMMAND_BAR_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(bar-[a-z-]+|assistant-[a-z-]+|palette-assistant)$/);
    const others = new Set<string>([...flat(PERFORM_TESTIDS), ...flat(SHORTS_TESTIDS), ...flat(MULTICAM_TESTIDS), ...flat(RENDER_CACHE_TESTIDS)]);
    expect(ids.filter((id) => others.has(id))).toEqual([]);
  });
  it('the result row is the palette option of key "bar"; choices and nearest rows follow the palette\'s option ids', () => {
    const optionDomId = (id: string) => `pf-palette-opt-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`; // CommandPalette.tsx
    expect(optionDomId(BAR_KEYS.result)).toBe(BAR_DOM_IDS.result);
    expect(optionDomId(BAR_KEYS.choice(2))).toBe(BAR_DOM_IDS.choice(2));
    expect(optionDomId(BAR_KEYS.nearest(4))).toBe(BAR_DOM_IDS.nearest(4));
  });
});
