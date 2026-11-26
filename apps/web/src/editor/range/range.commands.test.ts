import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { COMMANDS, Keymap } from '../commands.ts';
import { RANGE_COMMAND_IDS, cutRange } from './range.commands.ts';
import { rangeStore } from './range.state.ts';

const R = { num: 30, den: 1 };
const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const byId = (id: string) => COMMANDS.find((c) => c.id === id)!;
/** The parts of the editor the range commands read; commits and notices are recorded. */
function fakeEditor(frame: number, opts: { locked?: boolean; selected?: boolean } = {}) {
  const commits: unknown[] = [], notices: { kind: string; title: string; undoes?: string }[] = [], seeks: number[] = [];
  const clip = { id: 'c', type: 'text', start: T.ZERO, duration: T.frameTime(90, R) };
  const doc = { id: 'prj_cmd', mainSequenceId: 's', sequences: { s: { tracks: [{ id: 't', name: 'T1', locked: !!opts.locked, clips: [clip] }] } } };
  let deselected = false;
  const e = {
    doc, rate: R, frame, player: { frameCount: 90 }, recordingSwitches: false, selected: opts.selected ? { clip } : null,
    getState: () => ({ lang: 'he', cutPending: [], paletteOpen: false, selection: [] }),
    notify: (n: { kind: string; title: string }) => notices.push(n), seek: (f: number) => seeks.push(f),
    commit: async (ops: unknown) => { commits.push(typeof ops === 'function' ? (ops as () => unknown)() : ops); return { transactionId: 'tx_1' }; },
    clearCut: () => {}, select: () => { deselected = true; },
  };
  return { e: e as never, commits, notices, seeks, deselected: () => deselected };
}

describe('range commands', () => {
  it('I, O and X are the range commands, each its chord alone; the ids WP1 calls exist', () => {
    const km = new Keymap(store());
    expect(km.lookupAll('KeyI').map((c) => c.id)).toEqual([RANGE_COMMAND_IDS.in]);
    expect(km.lookupAll('KeyO').map((c) => c.id)).toEqual([RANGE_COMMAND_IDS.out]);
    expect(km.lookupAll('KeyX').map((c) => c.id)).toEqual([RANGE_COMMAND_IDS.cut]);
    for (const id of ['range.in', 'range.out', 'range.cut', 'range.clear']) expect(byId(id)).toBeTruthy();
  });
  it('I at 10 and O at 39 mark [10, 40); X sends ONE commit of one cut_range, then the marks go and the playhead stands at the cut', async () => {
    rangeStore.clear();
    const a = fakeEditor(10);
    await byId('range.in').run(a.e);
    const b = fakeEditor(39);
    await byId('range.out').run(b.e);
    expect(rangeStore.get('prj_cmd')).toEqual({ in: 10, out: 40 });
    expect(byId('range.cut').enabled!(b.e)).toBe(true);
    await byId('range.cut').run(b.e);
    expect(b.commits).toEqual([[{ op: 'cut_range', args: { start: T.frameTime(10, R), end: T.frameTime(40, R) } }]]);
    expect(rangeStore.get('prj_cmd')).toEqual({ in: null, out: null });
    expect(b.seeks).toEqual([10]);
    expect(b.notices[0]).toMatchObject({ kind: 'undo', undoes: 'tx_1' });
  });
  it('a locked track: X refuses in words and commits nothing; the marks stay', async () => {
    rangeStore.set('prj_cmd', { in: 5, out: 20 });
    const a = fakeEditor(0, { locked: true });
    await cutRange(a.e);
    expect(a.commits).toEqual([]);
    expect(a.notices).toHaveLength(1);
    expect(a.notices[0]!.title).toContain('T1');
    expect(rangeStore.get('prj_cmd')).toEqual({ in: 5, out: 20 });
  });
  it('Escape (edit.deselect) clears the marks first and keeps the selection; the next Escape deselects', async () => {
    rangeStore.set('prj_cmd', { in: 5, out: 20 });
    const a = fakeEditor(0, { selected: true });
    const esc = byId('edit.deselect');
    expect(esc.enabled!(a.e)).toBe(true);
    await esc.run(a.e);
    expect(rangeStore.get('prj_cmd')).toEqual({ in: null, out: null });
    expect(a.deselected()).toBe(false);
    await esc.run(a.e);
    expect(a.deselected()).toBe(true);
  });
  it('with only a mark and nothing selected, Escape is enabled and clears it', async () => {
    rangeStore.set('prj_cmd', { in: 5, out: null });
    const a = fakeEditor(0);
    expect(byId('edit.deselect').enabled!(a.e)).toBe(true);
    await byId('edit.deselect').run(a.e);
    expect(rangeStore.get('prj_cmd')).toEqual({ in: null, out: null });
    expect(byId('edit.deselect').enabled!(a.e)).toBe(false);
  });
});
