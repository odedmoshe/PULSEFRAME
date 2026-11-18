/**
 * The wire contracts of the segmented export and render cache (ADR-0024): no schema fields and no operations (the cache is
 * derived data), fixed codes, and the constants the workers build against. Nothing here pins a worker's stub.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_SELF_CHECK_CLEAN_EXPORTS, describeOps, EVERY_SEGMENT_FRAMES, EXPORT_MODES, MIN_SEGMENT_FRAMES, RENDER_CACHE_BLOCKERS, RENDER_CACHE_BLOCKER_CODES, RENDER_CACHE_JOB_ERRORS,
  SCHEMA_VERSION, SEGMENT_SECONDS, SEGMENTED_STAGES, SELF_CHECK_MODES, UNCACHEABLE_CODES,
} from './index.ts';

describe('render cache contracts (ADR-0024)', () => {
  it('add no schema version and no operation: the cache is derived data, Store.commit stays the only authority', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(describeOps({ includeInternal: true }).map((o) => o.name).filter((n) => /cache|segment/i.test(n))).toEqual([]);
  });
  it('fix the grid constants: 2-second cells, no segment under 3 frames unless alone, 3 frames per segment in every-segment mode, 20 clean exports', () => {
    expect([SEGMENT_SECONDS, MIN_SEGMENT_FRAMES, EVERY_SEGMENT_FRAMES, AUTO_SELF_CHECK_CLEAN_EXPORTS]).toEqual([2, 3, 3, 20]);
    expect(EXPORT_MODES).toEqual(['single-pass', 'incremental']);
    expect(SELF_CHECK_MODES).toEqual(['auto', 'sample', 'every-segment']);
    expect(SEGMENTED_STAGES).toContain('self-check');
  });
  it('codes are distinct snake_case words; a full cache is not a blocker; every job error may be retried', () => {
    const codes = [...RENDER_CACHE_BLOCKER_CODES, ...Object.values(RENDER_CACHE_JOB_ERRORS).map((e) => e.code), ...UNCACHEABLE_CODES];
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(RENDER_CACHE_BLOCKER_CODES).toEqual(['incremental_format_unsupported', 'render_cache_disabled', 'incremental_unavailable']);
    for (const b of Object.values(RENDER_CACHE_BLOCKERS)) expect(b.hint.length).toBeGreaterThan(10);
    for (const e of Object.values(RENDER_CACHE_JOB_ERRORS)) expect(e.retryable).toBe(true);
    expect(UNCACHEABLE_CODES).toContain('gpu_not_reproducible');
  });
});
