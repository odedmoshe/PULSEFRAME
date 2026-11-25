import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEND_TESTIDS } from './send.testids.ts';

describe('send test ids (wave 7)', () => {
  it('are unique, kebab-case, and the ones the proofs name', () => {
    const ids = Object.values(SEND_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)+$/);
    expect(SEND_TESTIDS.checkJump).toBe('export-check-jump');
    expect(SEND_TESTIDS.limiterSwitch).toBe('master-limiter-switch');
  });
  it('every id is written on an element of the send UI (the sources are read; the rows S13, K6 and L7 of editor-interactions-proof use them)', () => {
    const dir = path.resolve(import.meta.dirname, '..');
    const files = ['ExportSheet.tsx', 'DeliverPanel.tsx', 'Timeline.tsx', 'StatusBar.tsx', 'SoundPanel.tsx', ...fs.readdirSync(path.join(dir, 'send')).filter((f) => f.endsWith('.tsx')).map((f) => `send/${f}`)];
    const text = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const keyed = (k: string) => new RegExp(`(?:ID|SEND_ID|SEND_TESTIDS)\\.${k}\\b`).test(text);
    const missing = Object.entries(SEND_TESTIDS).filter(([k, id]) => !text.includes(`"${id}"`) && !text.includes(`'${id}'`) && !keyed(k)).map(([, id]) => id);
    expect(missing).toEqual([]);
  });
});
