/** The fixed test ids of «מה יש בקליפ» are distinct, keep their prefixes, and no other test-id table of the editor uses one. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNDERSTAND_TESTIDS } from './understand.testids.ts';
import { NotesSection, ShotNotes, UNDERSTAND_UI_BUILT, UnderstandSettings } from './ShotNotes.tsx';

const all: unknown[] = Object.values(UNDERSTAND_TESTIDS);
const fixed = (): string[] => all.filter((v): v is string => typeof v === 'string');
const made = (): string[] => all.filter((v): v is (x: string) => string => typeof v === 'function').map((f) => f('x'));

describe('understand test ids (wave 8 understand)', () => {
  it('are distinct, keep their prefixes, and no other test-id table of the editor uses one of them', () => {
    const ids = [...fixed(), ...made()];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(understand|footage-section-notes|footage-notes-state|settings-understand)(-[a-z0-9-]+)?$/);
    const editorDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const tables = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tables(path.join(dir, e.name)) : e.name.endsWith('.testids.ts') && e.name !== 'understand.testids.ts' ? [path.join(dir, e.name)] : []));
    for (const f of tables(editorDir)) { const text = fs.readFileSync(f, 'utf8'); for (const id of fixed()) expect(text.includes(`'${id}'`), `${id} in ${f}`).toBe(false); }
  });
  it.runIf(!UNDERSTAND_UI_BUILT)('until built, the mounts draw nothing (no dead button)', () => {
    expect(ShotNotes({ assetId: 'a', onSeek: () => {} })).toBeNull();
    expect(UnderstandSettings()).toBeNull();
    expect(NotesSection({ query: 'x', onView: () => {} })).toBeNull();
  });
});
