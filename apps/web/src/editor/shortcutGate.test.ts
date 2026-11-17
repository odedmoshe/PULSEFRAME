import { describe, expect, it } from 'vitest';
import { Keymap } from './commands.ts';
import { shortcutAllowed } from './shortcutGate.ts';

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
