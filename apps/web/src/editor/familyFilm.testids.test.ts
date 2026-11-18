/** The fixed test ids of the family film (familyFilm.testids.ts) are distinct, keep their prefix, include the ones the plan names, and no other test-id table uses one of them. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILM_TESTIDS } from './familyFilm.testids.ts';

describe('family film test ids (ADR-0026)', () => {
  it('are distinct, start with film-, cover the plan\'s list, and no other test-id table of the editor uses one of them', () => {
    const ids: string[] = Object.values(FILM_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^film-[a-z0-9-]+$/);
    for (const id of ['film-open', 'film-dialog', 'film-length-30', 'film-length-60', 'film-length-90', 'film-music-none', 'film-measure-progress', 'film-measure-cancel', 'film-plan-row', 'film-reason', 'film-swap-window', 'film-swap-clip', 'film-remove', 'film-excluded', 'film-apply', 'film-bar', 'film-why']) expect(ids).toContain(id);
    const dir = path.dirname(new URL(import.meta.url).pathname);
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.testids.ts') && n !== 'familyFilm.testids.ts')) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const id of ids) expect(text.includes(`'${id}'`), `${id} in ${f}`).toBe(false);
    }
  });
});
