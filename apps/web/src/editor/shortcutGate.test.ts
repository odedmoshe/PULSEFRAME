import { describe, expect, it } from 'vitest';
import { Keymap } from './commands.ts';
import { isTyping, shortcutAllowed, spaceBelongsToControl, takenFromBrowser, type FocusedControl } from './shortcutGate.ts';

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
  it('a command whose keys act only in one place (keysHere) is passed by elsewhere: I in another panel does not mark the timeline', () => {
    const cmd = { id: 'range.in', group: 'edit', keysHere: () => false };
    expect(shortcutAllowed('KeyI', cmd, { typing: false, paletteOpen: false, modalOpen: false })).toBe(false);
    expect(shortcutAllowed('KeyI', { ...cmd, keysHere: () => true }, { typing: false, paletteOpen: false, modalOpen: false })).toBe(true);
  });
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

describe('the craft chords (wave 7)', () => {
  it('Ctrl+S may run while typing (it opens the name field), never behind a modal or the palette; Ctrl+F likewise as a view command', () => {
    for (const c of ['Mod+KeyS', 'Mod+KeyF']) {
      expect(allowed(c, { typing: true }), c).toBe(true);
      expect(allowed(c, { modalOpen: true }), c).toBe(false);
      expect(allowed(c, { paletteOpen: true }), c).toBe(false);
    }
  });
  it('Q, W, D and Ctrl+Alt+V never act while typing or behind a modal', () => {
    for (const c of ['KeyQ', 'KeyW', 'KeyD', 'Mod+Alt+KeyV', 'KeyG']) {
      expect(allowed(c, { typing: true }), c).toBe(false);
      expect(allowed(c, { modalOpen: true }), c).toBe(false);
    }
  });
  it('Ctrl+S and Ctrl+F are taken from the browser (also after a rebind, by the chord bound now); other chords are not', () => {
    expect(takenFromBrowser('Mod+KeyS', (id) => km.keysFor(id))).toBe(true);
    expect(takenFromBrowser('Mod+KeyF', (id) => km.keysFor(id))).toBe(true);
    expect(takenFromBrowser('Mod+KeyP', (id) => km.keysFor(id))).toBe(false);
    expect(takenFromBrowser('KeyS', (id) => km.keysFor(id))).toBe(false);
    const other = new Keymap(storage());
    other.bind('file.saveVersion', ['Mod+Shift+KeyS']);
    expect(takenFromBrowser('Mod+KeyS', (id) => other.keysFor(id))).toBe(false);
    expect(takenFromBrowser('Mod+Shift+KeyS', (id) => other.keysFor(id))).toBe(true);
  });
});

describe('spaceBelongsToControl (Space on a control with keyboard focus presses it; otherwise it plays and pauses)', () => {
  const el = (tagName: string, more: Partial<FocusedControl> = {}): FocusedControl => ({ tagName, isContentEditable: false, focusVisible: true, ...more });
  it('keyboard focus on a button, switch, checkbox, link, summary or select: Space is the control\'s', () => {
    for (const e of [el('BUTTON'), el('DIV', { role: 'switch' }), el('BUTTON', { role: 'switch' }), el('DIV', { role: 'checkbox' }), el('SPAN', { role: 'button' }), el('A', { hasHref: true }), el('SPAN', { role: 'link' }), el('SUMMARY'), el('SELECT'), el('INPUT', { type: 'checkbox' }), el('INPUT', { type: 'submit' }), el('INPUT', { type: 'button' })])
      expect(spaceBelongsToControl(e, 'Space'), JSON.stringify(e)).toBe(true);
  });
  it('after a mouse click (focus without :focus-visible) Space still plays and pauses', () => {
    for (const e of [el('BUTTON', { focusVisible: false }), el('DIV', { role: 'switch', focusVisible: false }), el('SUMMARY', { focusVisible: false })]) expect(spaceBelongsToControl(e, 'Space')).toBe(false);
  });
  it('everywhere else Space plays and pauses: the page, a plain element, a link without href, a tab, a slider, nothing focused', () => {
    for (const e of [null, el('BODY'), el('DIV'), el('A'), el('DIV', { role: 'tab' }), el('DIV', { role: 'slider' }), el('CANVAS')]) expect(spaceBelongsToControl(e, 'Space'), JSON.stringify(e)).toBe(false);
  });
  it('only plain Space: other keys and chords on a focused button keep their commands', () => {
    for (const c of ['Shift+Space', 'Mod+Space', 'KeyS', 'Enter', 'ArrowLeft']) expect(spaceBelongsToControl(el('BUTTON'), c), c).toBe(false);
  });
  it('with the rule, Space on a keyboard-focused button counts as typing for the gate, so transport.toggle does not run', () => {
    const typing = isTyping({ tagName: 'BUTTON', isContentEditable: false }, 'Space') || spaceBelongsToControl(el('BUTTON'), 'Space');
    expect(allowed('Space', { typing })).toBe(false);
    expect(allowed('Space', { typing: isTyping({ tagName: 'BUTTON', isContentEditable: false }, 'Space') || spaceBelongsToControl(el('BUTTON', { focusVisible: false }), 'Space') })).toBe(true);
  });
});
