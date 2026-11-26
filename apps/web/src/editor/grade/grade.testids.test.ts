/** The test ids of colour curves and the scope additions are distinct, keep their prefixes (never `curve-`: C1), and no other table uses one. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRADE_TESTIDS, SCOPE_TESTIDS } from './grade.testids.ts';

describe('grade test ids (wave 8)', () => {
  it('are distinct, prefixed, and no other test-id table of the editor uses one of them', () => {
    const ids: string[] = [...Object.values(GRADE_TESTIDS), ...Object.values(SCOPE_TESTIDS)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of Object.values(GRADE_TESTIDS)) expect(id).toMatch(/^grade-curve-[a-z0-9-]+$/);
    for (const id of Object.values(SCOPE_TESTIDS)) expect(id).toMatch(/^(scope|exposure)-[a-z0-9-]+$/);
    for (const id of ids) expect(id.startsWith('curve-')).toBe(false);
    const editorDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const tables = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tables(path.join(dir, e.name)) : e.name.endsWith('.testids.ts') && e.name !== 'grade.testids.ts' ? [path.join(dir, e.name)] : []));
    for (const f of tables(editorDir)) { const text = fs.readFileSync(f, 'utf8'); for (const id of ids) expect(text.includes(`'${id}'`), `${id} in ${f}`).toBe(false); }
  });
});
