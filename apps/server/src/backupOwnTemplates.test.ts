/**
 * Wave 8 owntemplate, verifier C1: `<dataDir>/own-templates.json` (the owner's templates saved from their films) IS backed up, and
 * copied EVERY time: copyTree skips a file whose size has not changed, so a file rewritten in place with the same length would go
 * stale. Before this step backup.ts copied only the database, blobs/, out/ and tokens.json, and a restore lost every own template.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { backupDataDir, NEVER_BACKED_UP } from './backup.ts';
import { OWN_TEMPLATES_FILE } from './ownTemplates.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
/** A data directory with an empty but valid database (the backup reads its project count). */
function dataDir(): string {
  const d = tmp('pf-bk-own-');
  const db = new Database(path.join(d, 'pulseframe.sqlite'));
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  db.close();
  return d;
}

describe('backup copies the own templates file every time (C1)', () => {
  it('copies own-templates.json, 0600, and a rewrite of the same length reaches the next backup', async () => {
    const src = dataDir(), dest = path.join(tmp('pf-bk-own-dest-'), 'copy');
    expect(OWN_TEMPLATES_FILE).toBe('own-templates.json');
    expect(NEVER_BACKED_UP as readonly string[]).not.toContain(OWN_TEMPLATES_FILE);
    const file = path.join(src, OWN_TEMPLATES_FILE);
    fs.writeFileSync(file, JSON.stringify({ version: 1, templates: [{ def: { id: 'tpl.own-aaaaaaaaaaaa' } }] }), { mode: 0o600 });
    await backupDataDir(src, dest);
    const copy = path.join(dest, OWN_TEMPLATES_FILE);
    expect(fs.readFileSync(copy, 'utf8')).toBe(fs.readFileSync(file, 'utf8'));
    if (process.platform !== 'win32') expect(fs.statSync(copy).mode & 0o777).toBe(0o600);
    // rewritten in place with exactly the same length: the size skip of copyTree would keep the old bytes
    const next = JSON.stringify({ version: 1, templates: [{ def: { id: 'tpl.own-bbbbbbbbbbbb' } }] });
    expect(next.length).toBe(fs.statSync(file).size);
    fs.writeFileSync(file, next);
    await backupDataDir(src, dest);
    expect(fs.readFileSync(copy, 'utf8')).toBe(next);
    expect(fs.readdirSync(dest).filter((n) => n.endsWith('.tmp') || n.endsWith('.part'))).toEqual([]);
  });
  it('a data directory without the file backs up without one (and leaves no stale copy)', async () => {
    const src = dataDir(), dest = path.join(tmp('pf-bk-own-dest-'), 'copy');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, OWN_TEMPLATES_FILE), '{"stale":true}');
    await backupDataDir(src, dest);
    expect(fs.existsSync(path.join(dest, OWN_TEMPLATES_FILE))).toBe(false);
  });
});
