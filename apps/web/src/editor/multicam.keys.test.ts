/** The multicam chords (multicam.keys.ts, ADR-0020) collide with nothing in the command registry or the shell, except Escape, shared on purpose with edit.deselect. */
import { describe, expect, it } from 'vitest';
import { COMMANDS } from './commands.ts';
import { MULTICAM_KEYS, MULTICAM_SHARED_CHORDS, SHELL_DIGIT_CHORDS } from './multicam.keys.ts';

describe('multicam chords', () => {
  it('digits 0–9 are the angles; nothing else binds them; cut at the playhead has no default chord', () => {
    const taken = new Map<string, string>();
    for (const c of COMMANDS) for (const k of c.keys) taken.set(k, c.id);
    for (const k of SHELL_DIGIT_CHORDS) taken.set(k, 'shell');
    for (const [id, keys] of Object.entries(MULTICAM_KEYS)) for (const k of keys) {
      const other = taken.get(k);
      if (other && !id.startsWith(other)) expect(MULTICAM_SHARED_CHORDS[k], `${id} ${k} collides with ${other}`).toBe(other);
    }
    expect([...Array(10).keys()].map((d) => Object.entries(MULTICAM_KEYS).find(([, ks]) => ks.includes(`Digit${d}`))?.[0])).toEqual(['multicam.wide', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `multicam.angle${d}`)]);
    expect(Object.entries(MULTICAM_KEYS).filter(([id]) => id.startsWith('multicam.cut')).every(([, ks]) => ks.length === 0)).toBe(true);
  });
});
