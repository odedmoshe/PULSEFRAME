/**
 * The fixed test ids of perform mode (ADR-0025; perform.testids.ts) are unique, use the perform- prefix and do not clash with
 * any other fixed test id table of the editor.
 */
import { describe, expect, it } from 'vitest';
import { PERFORM_TESTIDS } from './perform.testids.ts';
import { SHORTS_TESTIDS } from '../shorts.testids.ts';
import { MULTICAM_TESTIDS } from '../multicam.testids.ts';
import { RENDER_CACHE_TESTIDS } from '../renderCache.testids.ts';

const flat = (t: Record<string, unknown>): string[] => Object.values(t).flatMap((v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? flat(v as Record<string, unknown>) : []));
describe('perform test ids', () => {
  it('are unique and prefixed', () => {
    const ids = Object.values(PERFORM_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^perform-[a-z-]+$/);
  });
  it('do not clash with other fixed tables (the mode button is workspace-perform)', () => {
    const others = new Set<string>([...flat(SHORTS_TESTIDS), ...flat(MULTICAM_TESTIDS), ...flat(RENDER_CACHE_TESTIDS), 'workspace-perform']);
    expect(Object.values(PERFORM_TESTIDS).filter((id) => others.has(id))).toEqual([]);
  });
});
