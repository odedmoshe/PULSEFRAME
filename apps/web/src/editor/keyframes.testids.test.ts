/**
 * The fixed test ids of keyframe curves and motion paths (ADR-0019; keyframes.testids.ts) are unique, use the key-strip-,
 * curve-, motion-path- and keyframes- prefixes and do not clash with any other fixed test id table of the editor or with the
 * speed curves' own ids (speed-curve-*).
 */
import { describe, expect, it } from 'vitest';
import { EASINGS } from '@pulseframe/core';
import { keyframeTestIds } from './keyframes.testids.ts';
import { SHORTS_TESTIDS } from './shorts.testids.ts';
import { RENDER_CACHE_TESTIDS } from './renderCache.testids.ts';
import { PEOPLE_TESTIDS } from './lifeline/people.testids.ts';

describe('keyframe curve test ids', () => {
  const ids = keyframeTestIds(EASINGS, ['x', 'y', 'scale', 'rotation', 'opacity', 'fx_1:radius']);
  it('are unique and prefixed', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(key-strip|curve|motion-path|keyframes)(-[a-z0-9_:-]+)?$/);
  });
  it('do not clash with other fixed tables', () => {
    const others = new Set<string>([...Object.values(SHORTS_TESTIDS), ...Object.values(RENDER_CACHE_TESTIDS), ...(Object.values(PEOPLE_TESTIDS) as unknown[]).filter((v): v is string => typeof v === 'string')]);
    expect(ids.filter((id) => others.has(id) || id.startsWith('speed-curve'))).toEqual([]);
  });
});
