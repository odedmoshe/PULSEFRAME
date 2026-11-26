import { describe, expect, it } from 'vitest';
import { dictionaries } from '@pulseframe/i18n';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject } from '@pulseframe/core';
import { COMMANDS, Keymap, chordLabel, chordOf, type Command } from './commands.ts';
import { MULTICAM_SHARED_CHORDS } from './multicam.keys.ts';

const ev = (code: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m });
const fakeStorage = (initial?: string) => {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set('pf.keymap.v1', initial);
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};

describe('chordOf', () => {
  it('plain key', () => expect(chordOf(ev('KeyS'))).toBe('KeyS'));
  it('Shift', () => expect(chordOf(ev('ArrowLeft', { shiftKey: true }))).toBe('Shift+ArrowLeft'));
  it('Ctrl and Meta both map to Mod', () => {
    expect(chordOf(ev('KeyZ', { ctrlKey: true }))).toBe('Mod+KeyZ');
    expect(chordOf(ev('KeyZ', { metaKey: true }))).toBe('Mod+KeyZ');
  });
  it('orders Mod, Alt, Shift', () => {
    expect(chordOf(ev('ArrowLeft', { shiftKey: true, altKey: true }))).toBe('Alt+Shift+ArrowLeft');
    expect(chordOf(ev('KeyZ', { shiftKey: true, ctrlKey: true, altKey: true }))).toBe('Mod+Alt+Shift+KeyZ');
  });
});

describe('chordLabel', () => {
  it('formats for non-mac and mac', () => {
    expect(chordLabel('Mod+Shift+KeyZ', false)).toBe('Ctrl+Shift+Z');
    expect(chordLabel('Mod+KeyK', true)).toBe('⌘+K');
    expect(chordLabel('Alt+ArrowLeft', false)).toBe('Alt+←');
    expect(chordLabel('BracketLeft', false)).toBe('[');
  });
});

describe('Keymap', () => {
  it('resolves defaults', () => {
    const km = new Keymap(fakeStorage());
    expect(km.lookup('Space')?.id).toBe('transport.toggle');
    expect(km.lookup('Mod+KeyZ')?.id).toBe('history.undo');
    expect(km.lookup('KeyY')).toBeUndefined(); // KeyQ is ripple trim since wave 7 (craft)
    expect(km.isCustom('transport.toggle')).toBe(false);
  });
  it('bind moves a chord, reports displaced commands, persists and is restored', () => {
    const st = fakeStorage();
    const km = new Keymap(st);
    const displaced = km.bind('edit.addText', ['KeyS']);
    expect(displaced).toEqual(['edit.split']);
    expect(km.lookup('KeyS')?.id).toBe('edit.addText');
    expect(km.keysFor('edit.split')).toEqual([]);
    expect(km.isCustom('edit.addText')).toBe(true);
    expect(st.data.has('pf.keymap.v1')).toBe(true);
    const km2 = new Keymap(st);
    expect(km2.lookup('KeyS')?.id).toBe('edit.addText');
    expect(km2.keysFor('edit.split')).toEqual([]);
  });
  it('reset restores defaults and clears storage', () => {
    const st = fakeStorage();
    const km = new Keymap(st);
    km.bind('edit.addText', ['KeyS']);
    km.reset();
    expect(km.lookup('KeyS')?.id).toBe('edit.split');
    expect(km.isCustom('edit.addText')).toBe(false);
    expect(st.data.has('pf.keymap.v1')).toBe(false);
  });
  it('falls back to defaults on corrupt storage', () => {
    expect(new Keymap(fakeStorage('{not json')).lookup('Space')?.id).toBe('transport.toggle');
    expect(new Keymap(fakeStorage('42')).lookup('Space')?.id).toBe('transport.toggle');
  });
});

describe('COMMANDS registry', () => {
  it('has unique ids', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('has no default chord shared by two commands, except a cut command ahead of one that acts when no cut is chosen', () => {
    const seen = new Map<string, Command>();
    const dupes: string[] = [];
    for (const c of COMMANDS) for (const k of c.keys) {
      const prev = seen.get(k);
      // the cut's keys (, . while a cut is chosen) come first in the registry, so the dispatcher tries them first
      // Escape is shared on purpose by edit.deselect and multicam.discard: never enabled at the same time (multicam.commands.test.ts)
      if (prev && !(prev.context === 'cut' && c.context !== 'cut') && !(k === 'Escape' && c.id === 'multicam.discard')) dupes.push(`${k}: ${prev.id} / ${c.id}`);
      if (!prev) seen.set(k, c);
    }
    expect(dupes).toEqual([]);
  });
  it('lists every command bound to a chord in registry order, the cut first', () => {
    const km = new Keymap(fakeStorage());
    expect(km.lookupAll('Comma').map((c) => c.id)).toEqual(['cut.rollEarlier', 'keyframe.prev']);
    expect(km.lookupAll('Period').map((c) => c.id)).toEqual(['cut.rollLater', 'keyframe.next']);
    expect(km.lookupAll('Shift+KeyB').map((c) => c.id)).toEqual(['cut.toBeat']);
    expect(km.lookupAll('Shift+Delete').map((c) => c.id)).toEqual(['edit.deleteKeepGap']);
  });
  it('has every label key in both dictionaries', () => {
    for (const c of COMMANDS) {
      expect(dictionaries.he[c.label], `he ${c.label}`).toBeTruthy();
      expect(dictionaries.en[c.label], `en ${c.label}`).toBeTruthy();
    }
  });
});

describe('keyframe curve commands (ADR-0019)', () => {
  const byId = (id: string) => COMMANDS.find((c) => c.id === id);
  it('registers every new command in its group, and view.motionPath in view', () => {
    for (const id of ['keyframe.focus', 'keyframe.smooth', 'keyframe.linear', 'keyframe.curve', 'keyframe.copy', 'keyframe.paste']) expect(byId(id)?.group, id).toBe('keyframe');
    expect(byId('view.motionPath')?.group).toBe('view');
  });
  it('keyframe.focus is Alt+K and no other chord is shared with it', () => {
    const km = new Keymap(fakeStorage());
    expect(km.lookupAll('Alt+KeyK').map((c) => c.id)).toEqual(['keyframe.focus']);
    for (const id of ['keyframe.smooth', 'keyframe.linear', 'keyframe.curve', 'keyframe.copy', 'keyframe.paste', 'view.motionPath']) expect(km.keysFor(id)).toEqual([]);
    // every chord outside the cut context has one command, except the one shared on purpose (multicam.keys.ts
    // MULTICAM_SHARED_CHORDS: Escape is multicam.discard while recording and edit.deselect otherwise, never both enabled)
    const chords = COMMANDS.filter((c) => c.context !== 'cut').flatMap((c) => c.keys.filter((k) => !(Object.hasOwn(MULTICAM_SHARED_CHORDS, k) && c.id.startsWith('multicam.'))));
    expect(new Set(chords).size).toBe(chords.length);
    expect(COMMANDS.filter((c) => c.keys.includes('Escape')).map((c) => c.id).sort()).toEqual(['edit.deselect', 'multicam.discard']);
    // the sharing is safe only because the two are never enabled together: recording or not, with or without a selection
    const deselect = byId('edit.deselect')!, discard = byId('multicam.discard')!;
    for (const recordingSwitches of [false, true]) for (const selected of [null, { clip: { id: 'c' } }]) for (const cutPending of [[], ['x']]) {
      const e = { recordingSwitches, selected, getState: () => ({ cutPending, paletteOpen: false }) } as never;
      const on = [deselect, discard].filter((c) => !c.enabled || c.enabled(e)).map((c) => c.id);
      expect(on.length, JSON.stringify({ recordingSwitches, selected, cutPending, on })).toBeLessThanOrEqual(1);
      if (recordingSwitches) expect(on).toEqual(['multicam.discard']);
    }
  });
  it('keyframe.smooth and keyframe.linear (S and L) set the curve on both sides of the selected key', async () => {
    const R = { num: 30, den: 1 };
    let r = applyTransaction(createProject({ id: 'prj_sl', name: 'sl', width: 640, height: 360, frameRate: R }), [{ op: 'add_text', args: { text: 'א', start: T.frameTime(0, R), duration: T.frameTime(60, R) } }], { idSeed: 'sl_', actor: 'test' });
    const clipId = r.results[0]!.output!.clipId as string;
    r = applyTransaction(r.doc, [{ op: 'replace_clip_keyframes', args: { clipId, property: 'x', keys: [0, 15, 30].map((k, i) => ({ time: T.frameTime(k, R), value: [-0.3, 0.1, 0.3][i]!, easing: 'linear' as const })) } }], { idSeed: 'sl2_', actor: 'test' });
    const doc = r.doc;
    const run = async (id: string) => {
      const sent: { op: string; args: { side?: string; easing?: string } }[][] = [];
      const e = {
        doc, rate: R,
        getState: () => ({ selection: [clipId], viewVariantId: null, keySel: { clipId, keys: [{ channel: { property: 'x' }, frame: 15 }] } }),
        commit: (make: () => never) => { sent.push(make()); return Promise.resolve(null); },
      };
      await byId(id)!.run(e as never);
      return sent[0]!.map((o) => [o.op, o.args.side, o.args.easing]);
    };
    expect(await run('keyframe.smooth')).toEqual([['set_keyframe_curve', 'both', 'smooth']]);
    expect(await run('keyframe.linear')).toEqual([['set_keyframe_curve', 'both', 'linear']]);
  });
  it('K on an adjustment clip emits only opacity ops; on a picture clip all five channels', async () => {
    const run = async (clip: object, kind: string) => {
      const sent: { op: string; args: { property: string } }[][] = [];
      const e = {
        selected: { clip, track: { id: 't', kind, locked: false } },
        getState: () => ({ selection: ['c'], viewVariantId: null }),
        transformNow: () => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }),
        playhead: { value: '0', timescale: 1 },
        player: undefined,
        commit: (ops: never) => { sent.push(ops); return Promise.resolve(null); },
      };
      await byId('keyframe.add')!.run(e as never);
      return sent[0]!.map((o) => o.args.property);
    };
    const base = { id: 'c', start: { value: '0', timescale: 1 }, duration: { value: '3', timescale: 1 } };
    expect(await run({ ...base, type: 'adjustment' }, 'adjustment')).toEqual(['opacity']);
    expect(await run({ ...base, type: 'text' }, 'text')).toEqual(['x', 'y', 'scale', 'rotation', 'opacity']);
  });
});
