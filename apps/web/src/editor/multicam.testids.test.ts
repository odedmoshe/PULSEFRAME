/** The fixed test ids of multicam (multicam.testids.ts, ADR-0020) are distinct, start with multicam-, and no other test-id table of the editor uses one of them. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MULTICAM_TESTIDS } from './multicam.testids.ts';

describe('multicam test ids', () => {
  it('are distinct, prefixed and not in another table', () => {
    const ids = Object.values(MULTICAM_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^multicam-[a-z-]+$/);
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const tables = [...fs.readdirSync(dir).filter((n) => n.endsWith('.testids.ts') && n !== 'multicam.testids.ts').map((n) => path.join(dir, n)), ...fs.readdirSync(path.join(dir, 'lifeline')).filter((n) => n.endsWith('.testids.ts')).map((n) => path.join(dir, 'lifeline', n))];
    for (const f of tables) { const text = fs.readFileSync(f, 'utf8'); for (const id of ids) expect(text.includes(`'${id}'`), `${id} in ${f}`).toBe(false); }
  });
});
