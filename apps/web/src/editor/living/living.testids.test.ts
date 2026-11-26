/** The fixed test ids of «תמונה חיה» are distinct, keep their prefixes, include the ones the proof names, and no other test-id table uses one. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIVING_TESTIDS } from './living.testids.ts';

describe('living test ids (wave 8)', () => {
  it('are distinct, start with living- or depth-, and no other test-id table of the editor uses one of them', () => {
    const ids: string[] = Object.values(LIVING_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(living|depth)-[a-z0-9-]+$/);
    for (const id of ['living-block', 'living-apply', 'living-move-push', 'living-move-slide', 'living-amount', 'living-depth-open', 'living-gpu-note', 'living-compute-state', 'depth-dialog', 'depth-canvas', 'depth-tool-horizon', 'depth-tool-near', 'depth-tool-far', 'depth-undo-stroke', 'depth-save', 'depth-cancel']) expect(ids).toContain(id);
    for (const cut of ['living-move-peek', 'living-move-orbit', 'living-side', 'depth-tool-mid', 'depth-stroke-list']) expect(ids).not.toContain(cut);
    const editorDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const tables = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tables(path.join(dir, e.name)) : e.name.endsWith('.testids.ts') && e.name !== 'living.testids.ts' ? [path.join(dir, e.name)] : []));
    for (const f of tables(editorDir)) { const text = fs.readFileSync(f, 'utf8'); for (const id of ids) expect(text.includes(`'${id}'`), `${id} in ${f}`).toBe(false); }
  });
});
