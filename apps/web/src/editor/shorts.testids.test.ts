/**
 * The fixed test ids of shorts (ADR-0018; shorts.testids.ts) are unique, use the shorts-/sequence- prefixes and do not clash
 * with any other fixed test id table of the editor.
 */
import { describe, expect, it } from 'vitest';
import { SHORTS_TESTIDS } from './shorts.testids.ts';
import { RENDER_CACHE_TESTIDS } from './renderCache.testids.ts';
import { PEOPLE_TESTIDS } from './lifeline/people.testids.ts';

describe('shorts test ids', () => {
  it('are unique and prefixed', () => {
    const ids = Object.values(SHORTS_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(shorts|sequence)-[a-z-]+$/);
  });
  it('do not clash with other fixed tables', () => {
    const others = new Set<string>([...Object.values(RENDER_CACHE_TESTIDS), ...(Object.values(PEOPLE_TESTIDS) as unknown[]).filter((v): v is string => typeof v === 'string')]);
    expect(Object.values(SHORTS_TESTIDS).filter((id) => others.has(id))).toEqual([]);
  });
});
