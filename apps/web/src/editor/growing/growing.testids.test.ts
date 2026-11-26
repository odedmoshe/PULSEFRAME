/** The fixed test ids of «גדלים מול העיניים» are distinct, keep their prefix, include the ones the proofs name, and no other test-id table uses one. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GROWING_TESTIDS } from './growing.testids.ts';

describe('growing test ids (wave 8)', () => {
  it('are distinct, start with growing-, and no other test-id table of the editor uses one of them', () => {
    const ids: string[] = Object.values(GROWING_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^growing-[a-z0-9-]+$/);
    for (const id of ['growing-open', 'growing-dialog', 'growing-mark-view', 'growing-mark-swap', 'growing-preview', 'growing-privacy', 'growing-create', 'growing-bar', 'growing-close-ask']) expect(ids).toContain(id);
    const editorDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const tables = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tables(path.join(dir, e.name)) : e.name.endsWith('.testids.ts') && e.name !== 'growing.testids.ts' ? [path.join(dir, e.name)] : []));
    for (const f of tables(editorDir)) { const text = fs.readFileSync(f, 'utf8'); for (const id of ids) expect(text.includes(`'${id}'`), `${id} in ${f}`).toBe(false); }
  });
});
