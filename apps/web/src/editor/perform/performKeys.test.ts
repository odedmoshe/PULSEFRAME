/**
 * Perform mode's keys (ADR-0025; performKeys.ts): pads collide with nothing in the command registry except multicam's angle
 * digits, which keep priority while multicam is live; Shift+7 is the mode and nothing else binds it; while a take is recorded
 * only Space acts among the registry's commands.
 */
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../commands.ts';
import { MULTICAM_KEYS } from '../multicam.keys.ts';
import { shortcutAllowed } from '../shortcutGate.ts';
import { PAD_CODES, PERFORM_MODE_CHORD, PERFORM_RECORDING_COMMANDS, padKeysLive, padOfKey } from './performKeys.ts';

const key = (code: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean }> = {}) => ({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, ...mods });

describe('perform keys', () => {
  it('pads are the plain number row and the numpad 1–8; modifiers and auto-repeat are never pads', () => {
    for (let i = 0; i < 8; i++) { expect(padOfKey(key(`Digit${i + 1}`))).toBe(i); expect(padOfKey(key(`Numpad${i + 1}`))).toBe(i); }
    for (const c of ['Digit9', 'Digit0', 'Numpad9', 'Numpad0', 'KeyA', 'Space']) expect(padOfKey(key(c))).toBeNull();
    for (const m of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'repeat'] as const) expect(padOfKey(key('Digit1', { [m]: true }))).toBeNull();
  });
  it('the pad codes are bound by no command except multicam\'s angles; Shift+7 (the mode) by none', () => {
    const padCodes = new Set(PAD_CODES.flat());
    const multicam = new Set(Object.values(MULTICAM_KEYS).flat());
    for (const c of COMMANDS) for (const k of c.keys) {
      if (padCodes.has(k)) expect(multicam.has(k) && c.id.startsWith('multicam.'), `${c.id} binds ${k}`).toBe(true);
      expect(k, c.id).not.toBe(PERFORM_MODE_CHORD);
    }
  });
  it('multicam live switching keeps the digits: pads then take no number keys', () => {
    const base = { performActive: true, multicamDigitsLive: false, typing: false, modalOpen: false };
    expect(padKeysLive(base)).toBe(true);
    expect(padKeysLive({ ...base, multicamDigitsLive: true })).toBe(false);
    expect(padKeysLive({ ...base, performActive: false })).toBe(false);
    expect(padKeysLive({ ...base, typing: true })).toBe(false);
    expect(padKeysLive({ ...base, modalOpen: true })).toBe(false);
  });
  it('while a take is recorded only Space acts among the registry\'s commands (multicam digits and edits are off)', () => {
    const ctx = { typing: false, paletteOpen: false, modalOpen: false, performRecording: true };
    const allowed = COMMANDS.filter((c) => shortcutAllowed(c.keys[0] ?? '', c, ctx)).map((c) => c.id);
    expect(allowed).toEqual([...PERFORM_RECORDING_COMMANDS]);
    expect(COMMANDS.find((c) => c.id === 'transport.toggle')!.keys).toContain('Space');
    // and without a take, nothing changes
    expect(COMMANDS.filter((c) => shortcutAllowed(c.keys[0] ?? '', c, { ...ctx, performRecording: false })).length).toBe(COMMANDS.length);
  });
});
