/** Every fixed test id of the family film is used exactly once in the film components (a repeated element repeats its id through one place in the source). */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILM_TESTIDS } from './familyFilm.testids.ts';

const dir = path.dirname(new URL(import.meta.url).pathname);
const files = ['FamilyFilmDialog.tsx', 'FamilyFilmEntry.tsx', 'FilmBar.tsx', 'FilmWhy.tsx', 'MomentsStrip.tsx'];
describe('family film components', () => {
  it('use every test id exactly once, and only those', () => {
    const text = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    for (const key of Object.keys(FILM_TESTIDS)) expect((text.match(new RegExp(`TID\\.${key}\\b`, 'g')) ?? []).length, key).toBe(1);
    const used = [...text.matchAll(/TID\.([A-Za-z0-9]+)/g)].map((m) => m[1]!);
    for (const k of used) expect(Object.keys(FILM_TESTIDS), k).toContain(k);
    for (const f of files) expect(text.includes('data-testid="film-'), f).toBe(false);
  });
});
