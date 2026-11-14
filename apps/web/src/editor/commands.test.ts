import { describe, expect, it } from 'vitest';
import { dictionaries } from '@pulseframe/i18n';
import { COMMANDS, Keymap, chordLabel, chordOf } from './commands.ts';

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
    expect(km.lookup('KeyQ')).toBeUndefined();
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
  it('has no default chord shared by two commands', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const c of COMMANDS) for (const k of c.keys) {
      const prev = seen.get(k);
      if (prev) dupes.push(`${k}: ${prev} / ${c.id}`);
      seen.set(k, c.id);
    }
    expect(dupes).toEqual([]);
  });
  it('has every label key in both dictionaries', () => {
    for (const c of COMMANDS) {
      expect(dictionaries.he[c.label], `he ${c.label}`).toBeTruthy();
      expect(dictionaries.en[c.label], `en ${c.label}`).toBeTruthy();
    }
  });
});
