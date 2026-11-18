/** The multicam commands (ADR-0020): digits, Escape and the tile order. A labelled stand-in editor (test only) answers what the commands ask of it. */
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, Keymap, type Command } from './commands.ts';
import { MULTICAM_ANGLE_COMMANDS, MULTICAM_CUT_COMMANDS } from './multicam.keys.ts';
import { angleForDigit, tilePositions } from './multicamSession.ts';
import type { Editor } from './store.ts';

const group = {
  id: 'mcg_1', wideAngleId: 'ang_w',
  angles: [{ id: 'ang_mic', kind: 'sound' }, { id: 'ang_w', kind: 'picture' }, { id: 'ang_a', kind: 'picture' }, { id: 'ang_b', kind: 'picture' }],
};
function editor(o: { program?: boolean; recording?: boolean; selected?: boolean } = {}) {
  const calls: string[] = [];
  const e = {
    doc: { multicam: { mcg_1: group } },
    recordingSwitches: !!o.recording,
    multicamProgram: () => (o.program === false ? null : { groupId: 'mcg_1', sequenceId: 'seq', trackId: 'trk' }),
    switchAngle: (id: string, at?: boolean) => { calls.push(`${id}${at ? '@playhead' : ''}`); },
    discardRecording: () => { calls.push('discard'); },
    stopRecording: () => { calls.push('stop'); },
    startRecording: () => { calls.push('start'); },
    selected: o.selected ? { clip: {} } : undefined,
    getState: () => ({ selection: o.selected ? ['c'] : [], cutPending: [], paletteOpen: false }),
  } as unknown as Editor;
  return { e, calls };
}
const cmd = (id: string): Command => COMMANDS.find((c) => c.id === id)!;
const enabled = (id: string, e: Editor) => { const c = cmd(id); return !c.enabled || c.enabled(e); };

describe('multicam digits', () => {
  it('are bound to Digit1..9 and Digit0, and enabled only on a program target (the video target track holds segments of a group)', () => {
    const km = new Keymap(null);
    expect(km.lookup('Digit1')?.id).toBe('multicam.angle1');
    expect(km.lookup('Digit0')?.id).toBe('multicam.wide');
    expect(enabled('multicam.angle1', editor().e)).toBe(true);
    expect(enabled('multicam.wide', editor().e)).toBe(true);
    for (const id of [...MULTICAM_ANGLE_COMMANDS, 'multicam.wide']) expect(enabled(id, editor({ program: false }).e), id).toBe(false);
  });
  it('name picture angles in tile order, 0 the wide angle; an angle the group lacks leaves its digit disabled', () => {
    expect(angleForDigit(group as never, 1)?.id).toBe('ang_w');
    expect(angleForDigit(group as never, 3)?.id).toBe('ang_b');
    expect(angleForDigit(group as never, 4)).toBeNull();
    expect(enabled('multicam.angle4', editor().e)).toBe(false);
    const { e, calls } = editor();
    void cmd('multicam.angle2').run(e);
    void cmd('multicam.wide').run(e);
    expect(calls).toEqual(['ang_a', 'ang_w']);
  });
  it('the cut-at-the-playhead commands have no default chord and are not available while recording', () => {
    for (const id of [...MULTICAM_CUT_COMMANDS, 'multicam.cutWide']) { expect(cmd(id).keys).toEqual([]); expect(enabled(id, editor({ recording: true }).e)).toBe(false); }
    const { e, calls } = editor();
    void cmd('multicam.cut1').run(e);
    expect(calls).toEqual(['ang_w@playhead']);
  });
});

describe('Escape', () => {
  it('discards only while recording; deselect is then off, and the other way round', () => {
    const idle = editor({ selected: true }).e, rec = editor({ recording: true, selected: true }).e;
    expect([enabled('multicam.discard', idle), enabled('edit.deselect', idle)]).toEqual([false, true]);
    expect([enabled('multicam.discard', rec), enabled('edit.deselect', rec)]).toEqual([true, false]);
    const km = new Keymap(null);
    const first = (e: Editor) => km.lookupAll('Escape').find((c) => !c.enabled || c.enabled(e))?.id;
    expect(first(rec)).toBe('multicam.discard');
    expect(first(idle)).toBe('edit.deselect');
  });
  it('the record toggle has no default chord and starts or stops', () => {
    expect(cmd('multicam.record').keys).toEqual([]);
    const a = editor(), b = editor({ recording: true });
    void cmd('multicam.record').run(a.e); void cmd('multicam.record').run(b.e);
    expect([a.calls, b.calls]).toEqual([['start'], ['stop']]);
    vi.restoreAllMocks();
  });
});

describe('tile order', () => {
  it('reading order: tile 1 top-left in LTR and top-right in RTL', () => {
    expect(tilePositions(4, 2, false)).toEqual([{ tile: 1, row: 0, col: 0 }, { tile: 2, row: 0, col: 1 }, { tile: 3, row: 1, col: 0 }, { tile: 4, row: 1, col: 1 }]);
    expect(tilePositions(4, 2, true)).toEqual([{ tile: 1, row: 0, col: 1 }, { tile: 2, row: 0, col: 0 }, { tile: 3, row: 1, col: 1 }, { tile: 4, row: 1, col: 0 }]);
  });
});
