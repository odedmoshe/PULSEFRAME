import { describe, expect, it } from 'vitest';
import { Keymap } from './commands.ts';
import { isTyping, shortcutAllowed } from './shortcutGate.ts';

const storage = () => { const d = new Map<string, string>(); return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k) }; };
const km = new Keymap(storage());
const allowed = (chord: string, ctx: { typing?: boolean; paletteOpen?: boolean; modalOpen?: boolean }) => {
  const cmd = km.lookup(chord);
  if (!cmd) throw new Error(`no command for ${chord}`);
  return shortcutAllowed(chord, cmd, { typing: false, paletteOpen: false, modalOpen: false, ...ctx });
};
/** The shortcuts that acted on the timeline behind the effects gallery (focus on the page body, gallery open). */
const EDITING = ['Delete', 'Backspace', 'KeyS', 'KeyT', 'KeyM', 'Space', 'Mod+KeyZ', 'Mod+Shift+KeyZ', 'Escape', 'Mod+KeyX', 'Mod+KeyV', 'Mod+KeyD', 'ArrowLeft', 'Mod+KeyE'];

describe('shortcutAllowed', () => {
  it('runs every shortcut when nothing is in the way', () => {
    for (const c of [...EDITING, 'Mod+KeyK']) expect(allowed(c, {}), c).toBe(true);
  });
  it('no shortcut acts behind a modal dialog, whichever dialog it is', () => {
    for (const c of [...EDITING, 'Mod+KeyK', 'Equal', 'Minus']) expect(allowed(c, { modalOpen: true }), c).toBe(false);
  });
  it('with the palette open (itself a modal dialog) only its own toggle runs', () => {
    expect(allowed('Mod+KeyK', { paletteOpen: true, modalOpen: true })).toBe(true);
    for (const c of EDITING) expect(allowed(c, { paletteOpen: true, modalOpen: true }), c).toBe(false);
  });
  it('while typing only Mod+ view shortcuts run, and not behind a modal dialog', () => {
    expect(allowed('Mod+KeyK', { typing: true })).toBe(true);
    expect(allowed('KeyS', { typing: true })).toBe(false);
    expect(allowed('Mod+KeyZ', { typing: true })).toBe(false);
    expect(allowed('Equal', { typing: true })).toBe(false);
    expect(allowed('Mod+KeyK', { typing: true, modalOpen: true })).toBe(false);
    expect(allowed('Mod+KeyK', { typing: true, paletteOpen: true, modalOpen: true })).toBe(true);
  });
});

describe('isTyping', () => {
  const input = (type: string) => ({ tagName: 'INPUT', isContentEditable: false, type });
  it('text fields, selects and editable text keep every key, Mod+Z included (their own undo)', () => {
    for (const el of [input('text'), input('number'), input('search'), { tagName: 'TEXTAREA', isContentEditable: false }, { tagName: 'SELECT', isContentEditable: false }, { tagName: 'DIV', isContentEditable: true }]) {
      for (const c of ['Mod+KeyZ', 'Mod+Shift+KeyZ', 'KeyS', 'Space', 'ArrowLeft']) expect(isTyping(el, c), `${el.tagName} ${c}`).toBe(true);
    }
  });
  it('a radio, checkbox or slider keeps its own keys (Space, the arrows) but lets the Mod+ chords through: Ctrl+Z after a click on a radio undoes', () => {
    for (const t of ['radio', 'checkbox', 'range', 'RADIO']) {
      expect(isTyping(input(t), 'Mod+KeyZ'), t).toBe(false);
      expect(isTyping(input(t), 'Mod+Shift+KeyZ'), t).toBe(false);
      for (const c of ['Space', 'ArrowLeft', 'ArrowRight', 'KeyS', 'Delete']) expect(isTyping(input(t), c), `${t} ${c}`).toBe(true);
    }
    expect(allowed('Mod+KeyZ', { typing: isTyping(input('radio'), 'Mod+KeyZ') })).toBe(true);
    expect(allowed('Space', { typing: isTyping(input('checkbox'), 'Space') })).toBe(false);
  });
  it('a button or the page body is not typing', () => {
    expect(isTyping({ tagName: 'BUTTON', isContentEditable: false }, 'Mod+KeyZ')).toBe(false);
    expect(isTyping({ tagName: 'BODY', isContentEditable: false }, 'Space')).toBe(false);
    expect(isTyping(null, 'Space')).toBe(false);
  });
});
