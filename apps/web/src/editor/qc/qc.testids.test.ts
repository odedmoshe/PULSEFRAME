import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { QC_TESTIDS } from './qc.testids.ts';
import { SEND_TESTIDS } from '../send/send.testids.ts';

describe('qc test ids (wave 8)', () => {
  it('are unique, kebab-case, and none repeats a send id', () => {
    const ids = Object.values(QC_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)+$/);
    const send = new Set<string>(Object.values(SEND_TESTIDS));
    expect(ids.filter((id) => send.has(id))).toEqual([]);
  });
  it('the empty mounts are in place: the sheet mounts PreflightSummary and PreflightSound, the file card mounts ExplainedFindings', () => {
    const dir = path.resolve(import.meta.dirname, '..');
    expect(fs.readFileSync(path.join(dir, 'ExportSheet.tsx'), 'utf8')).toMatch(/<PreflightSummary[\s\S]*<PreflightSound/);
    expect(fs.readFileSync(path.join(dir, 'send/ChecksResult.tsx'), 'utf8')).toContain('<ExplainedFindings');
  });
  // B2 (qc-b2.md): the elements
  it.todo('every id is written on an element of the sheet or the file card (ExportSheet.tsx, send/*.tsx, qc/*.tsx), as send.testids.test.ts does');
});
