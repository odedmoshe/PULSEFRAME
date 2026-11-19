/**
 * Perform mode's web contract (ADR-0025; perform/contract.ts): the editor implements PerformHost (checked by the type checker
 * through `host` below), perform is a workspace of its own, and the preference key is fixed. The player side
 * (PerformPlayerPort) is W3's: its tests are todo here.
 */
import { describe, expect, it } from 'vitest';
import type { Editor } from '../store.ts';
import { WORKSPACES } from '../store.ts';
import { pagesFor } from '../inspector.model.ts';
import { CALIBRATION, PERFORM_PREFS_KEY, type PerformHost } from './contract.ts';

/** Compile-time: Editor carries every member of PerformHost with its type. */
export const host = (e: Editor): PerformHost => e;

describe('perform web contract', () => {
  it('perform is a workspace whose inspector keeps the selection; the preference key is fixed', () => {
    expect(WORKSPACES).toContain('perform');
    expect(pagesFor('perform', { custom: [], waiting: 0, flat: false })).toEqual(['clip']);
    expect(PERFORM_PREFS_KEY).toBe('pf.perform.v1');
    expect(CALIBRATION).toEqual({ clicks: 16, bpm: 100, dropFirst: 4, maxMadMs: 40 });
    expect(typeof host).toBe('function');
  });
  it.todo('W3 player.perform.test.ts: timelineSecondsAt on a fake audio clock; monitorSound plays outside the mix; setPictureDoc of a live take does not restart the sound');
});
