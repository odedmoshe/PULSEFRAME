/** The fixed test ids of «מאגר» / «חיבורים» are distinct, keep their prefixes, include the ones the proof names, and no other test-id table of the editor uses one. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOURCES_TESTIDS } from './sources.testids.ts';
import { MediaSourcesTabs, SOURCES_UI_BUILT } from './SourcesTab.tsx';

const all: unknown[] = Object.values(SOURCES_TESTIDS);
const fixed = (): string[] => all.filter((v): v is string => typeof v === 'string');
const made = (): string[] => all.filter((v): v is (x: string) => string => typeof v === 'function').map((f) => f('x'));

describe('sources test ids (wave 8 sources)', () => {
  it('are distinct, keep their prefixes, and no other test-id table of the editor uses one of them', () => {
    const ids = [...fixed(), ...made()];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(sources|media-tab|asset-source|settings-connections|connect)-[a-z0-9-]+$|^settings-connections$/);
    for (const id of ['media-tab-sources', 'sources-panel', 'sources-search', 'sources-results', 'sources-link-input', 'sources-link-import', 'settings-connections']) expect(ids).toContain(id);
    const editorDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const tables = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tables(path.join(dir, e.name)) : e.name.endsWith('.testids.ts') && e.name !== 'sources.testids.ts' ? [path.join(dir, e.name)] : []));
    for (const f of tables(editorDir)) { const text = fs.readFileSync(f, 'utf8'); for (const id of fixed()) expect(text.includes(`'${id}'`), `${id} in ${f}`).toBe(false); }
  });
  it.runIf(!SOURCES_UI_BUILT)('until built, the drawer shows exactly what it showed (no dead tab)', () => {
    expect(MediaSourcesTabs({ mine: 'mine' })).toBe('mine');
  });
});
