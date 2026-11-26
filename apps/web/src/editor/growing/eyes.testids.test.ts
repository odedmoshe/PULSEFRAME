/** The fixed test ids of «הציעו עיניים» are distinct, keep their prefix, and no other test-id table of the editor uses one. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EYES_TESTIDS } from './eyes.testids.ts';

describe('eyes test ids (wave 8 picmodels)', () => {
  it('are distinct, start with eyes-, and no other test-id table of the editor uses one of them', () => {
    const ids: string[] = Object.values(EYES_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^eyes-[a-z0-9-]+$/);
    for (const id of ['eyes-suggest', 'eyes-stop', 'eyes-state', 'eyes-proposal', 'eyes-ring', 'eyes-accept', 'eyes-privacy']) expect(ids).toContain(id);
    const editorDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const tables = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tables(path.join(dir, e.name)) : e.name.endsWith('.testids.ts') && e.name !== 'eyes.testids.ts' ? [path.join(dir, e.name)] : []));
    for (const f of tables(editorDir)) { const text = fs.readFileSync(f, 'utf8'); for (const id of ids) expect(text.includes(`'${id}'`), `${id} in ${f}`).toBe(false); }
  });
});
