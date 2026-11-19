/** Every intent's commandId in the contract's map exists in COMMANDS (the bar lists these as nearest commands and runs them by id). */
import { describe, expect, it, vi } from 'vitest';
import { BAR_OPEN_COMMANDS, INTENT_COMMANDS, INTENT_IDS } from '@pulseframe/core';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('window', globalThis);
const { COMMANDS } = await import('../commands.ts');

describe('INTENT_COMMANDS', () => {
  const ids = new Set(COMMANDS.map((c) => c.id));
  it('covers every intent', () => { expect(Object.keys(INTENT_COMMANDS).sort()).toEqual([...INTENT_IDS].sort()); });
  it('names only commands that exist in COMMANDS', () => {
    for (const [intent, id] of Object.entries(INTENT_COMMANDS)) if (id !== null) expect(ids.has(id), `${intent} -> ${id}`).toBe(true);
  });
  it('the commands the open intent may run and the ones the actions use exist', () => {
    for (const id of [...BAR_OPEN_COMMANDS, 'view.zoomIn', 'view.zoomOut', 'view.openTemplates']) expect(ids.has(id), id).toBe(true);
  });
});
