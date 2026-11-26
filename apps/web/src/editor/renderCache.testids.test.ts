/** The fixed test ids of the fast export and the render cache (renderCache.testids.ts) are distinct, keep their prefix and do not collide with another table's. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RENDER_CACHE_TESTIDS } from './renderCache.testids.ts';

describe('render cache test ids (ADR-0024)', () => {
  it('are distinct, start with cache-, and no other test-id table of the editor uses one of them', () => {
    const ids = Object.values(RENDER_CACHE_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^cache-[a-z0-9-]+$/);
    const dir = path.dirname(new URL(import.meta.url).pathname);
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.testids.ts') && n !== 'renderCache.testids.ts')) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const id of ids) expect(text.includes(`'${id}'`), `${id} in ${f}`).toBe(false);
    }
  });
});
