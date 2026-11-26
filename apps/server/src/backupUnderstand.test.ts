/**
 * Wave 8 `understand` (plan §3.1, decisions «understand»): the settings of «מה יש בקליפ» (<dataDir>/understand.json: auto, density, the
 * chosen describing model; no secret) are the owner's choices and ARE backed up, copied by name every time (the file is rewritten in
 * place and may keep its length), and removed from a destination when the source has none. The footage notes themselves are rows of
 * the main database (understand/notesDb.ts), so the online SQLite copy holds them. Before this change backup.ts copied neither file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { UNDERSTAND_SETTINGS_FILE } from '@pulseframe/core';
import { backupDataDir, NEVER_BACKED_UP } from './backup.ts';
import { getNotes, putNotes } from './understand/notesDb.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
function dataDir(): string {
  const d = tmp('pf-bk-und-');
  const db = new Database(path.join(d, 'pulseframe.sqlite'));
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  db.close();
  return d;
}
const settings = (density: number) => JSON.stringify({ version: 1, auto: true, density, describer: { providerId: 'llamacpp', model: 'qwen3-vl', seeing: true } });

describe('backup and «מה יש בקליפ» (wave 8 understand)', () => {
  it('understand.json is copied every time, never left stale, and removed when the source has none', async () => {
    expect(NEVER_BACKED_UP as readonly string[]).not.toContain(UNDERSTAND_SETTINGS_FILE);
    const src = dataDir(), dest = path.join(tmp('pf-bk-und-dest-'), 'copy');
    fs.writeFileSync(path.join(src, UNDERSTAND_SETTINGS_FILE), settings(10));
    await backupDataDir(src, dest);
    expect(fs.readFileSync(path.join(dest, UNDERSTAND_SETTINGS_FILE), 'utf8')).toBe(settings(10));
    fs.writeFileSync(path.join(src, UNDERSTAND_SETTINGS_FILE), settings(30)); // the same length
    await backupDataDir(src, dest);
    expect(fs.readFileSync(path.join(dest, UNDERSTAND_SETTINGS_FILE), 'utf8')).toBe(settings(30));
    fs.rmSync(path.join(src, UNDERSTAND_SETTINGS_FILE));
    await backupDataDir(src, dest);
    expect(fs.existsSync(path.join(dest, UNDERSTAND_SETTINGS_FILE))).toBe(false);
  });
  it('the notes are rows of the main database, so the database copy holds them', async () => {
    const src = dataDir(), dest = path.join(tmp('pf-bk-und-dest-'), 'copy');
    const db = new Database(path.join(src, 'pulseframe.sqlite'));
    const hash = `sha256:${'a'.repeat(64)}`;
    const data = { format: 1 as const, contentHash: hash, producer: { id: '0123456789abcdef', describer: 'TEST-DOUBLE-describer' as const, providerId: 'test-double', model: 'TEST-DOUBLE-describer/1', modelFile: null, prompt: 'pf-describe/1' as const, longSide: 768, density: 10, framesPerSpan: 1, minSpanSeconds: 2 }, rate: null, frameCount: 1, cuts: `sha256:${'b'.repeat(64)}`, spans: [{ i: 0, shots: [0, 0] as [number, number], start: 0, end: 1, keys: [0], state: 'described' as const, caption: { en: 'TEST DOUBLE: a blue picture' } }] };
    const { digest } = putNotes(db, data);
    db.close();
    await backupDataDir(src, dest);
    const copy = new Database(path.join(dest, 'pulseframe.sqlite'), { readonly: true });
    try { expect(getNotes(copy, hash, '0123456789abcdef')).toEqual({ data, digest }); } finally { copy.close(); }
  });
});
