/**
 * The viewer's choice of the playing picture in the real Editor (pictureSize.ts; Settings «התמונה בזמן ניגון»): kept in this
 * browser's storage like the editor's other per-viewer switches, never in the project. localStorage, window and the player
 * are stand-ins (labelled); the Editor is real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@pulseframe/core';
import { api } from '../api.ts';
import { PLAY_SHARPNESS_KEY } from '../pictureSize.ts';
import type { Player } from '../player.ts';

// ---- labelled stand-ins (test only) ----
const stored = new Map<string, string>();
let refuse = false;
vi.stubGlobal('localStorage', { getItem: (k: string) => { if (refuse) throw new Error('blocked'); return stored.get(k) ?? null; }, setItem: (k: string, v: string) => { if (refuse) throw new Error('blocked'); stored.set(k, v); }, removeItem: (k: string) => { stored.delete(k); } });
vi.stubGlobal('window', globalThis);
const { Editor } = await import('./store.ts');
// ---- end of stand-ins ----

afterEach(() => { stored.clear(); refuse = false; vi.restoreAllMocks(); });

describe('playSharpness (a preference of this browser)', () => {
  it('starts smooth; a stored «חד יותר» is read at start; any other stored value is smooth', () => {
    expect(new Editor().getState().playSharpness).toBe('smooth');
    stored.set(PLAY_SHARPNESS_KEY, 'sharper');
    expect(new Editor().getState().playSharpness).toBe('sharper');
    stored.set(PLAY_SHARPNESS_KEY, 'very sharp');
    expect(new Editor().getState().playSharpness).toBe('smooth');
  });
  it('setPlaySharpness: the state, the storage and the player follow; nothing is sent to the server and the document is untouched', () => {
    const ed = new Editor();
    const doc = createProject({ id: 'prj_ps', name: 'PS', width: 1920, height: 1080 });
    ed.set({ doc, rawDoc: doc, revision: 7 });
    const player = { sharpness: 'smooth' } as unknown as Player; // stand-in: only the field the editor sets
    ed.player = player;
    const commit = vi.spyOn(api, 'commit');
    const seen: string[] = [];
    const off = ed.subscribe(() => seen.push(ed.getState().playSharpness));
    ed.setPlaySharpness('sharper');
    expect(ed.getState().playSharpness).toBe('sharper');
    expect(stored.get(PLAY_SHARPNESS_KEY)).toBe('sharper');
    expect(player.sharpness).toBe('sharper');
    expect(seen.at(-1)).toBe('sharper'); // subscribers (the Settings dialog, the source viewer) are told
    ed.setPlaySharpness('smooth');
    expect(stored.get(PLAY_SHARPNESS_KEY)).toBe('smooth');
    expect(player.sharpness).toBe('smooth');
    expect(commit).not.toHaveBeenCalled();
    expect(ed.getState().doc).toBe(doc);
    expect(ed.getState().revision).toBe(7);
    expect(new Editor().getState().playSharpness).toBe('smooth'); // the next visit reads what was stored
    off();
  });
  it('a browser that refuses storage: the choice holds for this visit, and a blocked read is the default', () => {
    const ed = new Editor();
    refuse = true;
    expect(() => ed.setPlaySharpness('sharper')).not.toThrow();
    expect(ed.getState().playSharpness).toBe('sharper');
    expect(stored.has(PLAY_SHARPNESS_KEY)).toBe(false);
  });
  it('no player yet (the project is still opening): the choice is kept in the state for the player to take', () => {
    const ed = new Editor();
    expect(ed.player).toBeNull();
    expect(() => ed.setPlaySharpness('sharper')).not.toThrow();
    expect(ed.getState().playSharpness).toBe('sharper');
  });
});
