/** The fixed test ids of the agent tab are distinct, keep their prefix, include the ones the proofs name, and no other test-id table uses one. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_TESTIDS } from './agent.testids.ts';

describe('agent test ids (wave 8 autonomy Part 2)', () => {
  it('are distinct, start with agent-, and no other test-id table of the editor uses one of them', () => {
    const ids: string[] = Object.values(AGENT_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^agent-[a-z0-9-]+$/);
    for (const id of ['agent-tab', 'agent-goal', 'agent-plan', 'agent-step', 'agent-undo-all', 'agent-connect', 'agent-sent-line', 'agent-not-undone']) expect(ids).toContain(id);
    const editorDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const tables = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tables(path.join(dir, e.name)) : e.name.endsWith('.testids.ts') && e.name !== 'agent.testids.ts' ? [path.join(dir, e.name)] : []));
    for (const f of tables(editorDir)) { const text = fs.readFileSync(f, 'utf8'); for (const id of ids) expect(text.includes(`'${id}'`), `${id} in ${f}`).toBe(false); }
  });
});
