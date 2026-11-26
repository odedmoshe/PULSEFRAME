/**
 * Wave 8 `sources` (verify C1, C2; decisions «sources» Keys, D8): the connectors' keys folder is NEVER in a backup (removed
 * recursively from a destination, like the agent's folder), and `<dataDir>/connectors.json` (settings, no secret) IS copied by name
 * every time. Before this change backup.ts knew neither: the keys folder would have been left in a destination copied by hand,
 * and a restore lost the download limit.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { backupDataDir, NEVER_BACKED_UP } from './backup.ts';
import { CONNECTORS_DIR, CONNECTORS_FILE, ConnectorKeyStore, readConnectorSettings, writeConnectorSettings } from './connectors/keys.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
function dataDir(): string {
  const d = tmp('pf-bk-con-');
  const db = new Database(path.join(d, 'pulseframe.sqlite'));
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  db.close();
  return d;
}

describe('backup and the connectors (C1, C2, D8)', () => {
  it('the keys folder is never backed up, even one left in the destination by hand; connectors.json is copied every time', async () => {
    expect(NEVER_BACKED_UP as readonly string[]).toContain(CONNECTORS_DIR);
    expect(NEVER_BACKED_UP as readonly string[]).not.toContain(CONNECTORS_FILE);
    const src = dataDir(), dest = path.join(tmp('pf-bk-con-dest-'), 'copy');
    new ConnectorKeyStore(src).write('source.pixabay', 'k-123');
    writeConnectorSettings(src, { version: 1, sources: { maxDownloadBytes: 100_000 } });
    fs.mkdirSync(path.join(dest, CONNECTORS_DIR, 'keys'), { recursive: true });
    fs.writeFileSync(path.join(dest, CONNECTORS_DIR, 'keys', 'source.pixabay.key'), 'old');
    await backupDataDir(src, dest);
    expect(fs.existsSync(path.join(dest, CONNECTORS_DIR))).toBe(false);
    expect(readConnectorSettings(dest).sources.maxDownloadBytes).toBe(100_000);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dest, CONNECTORS_FILE)).mode & 0o777).toBe(0o600);
    // rewritten with the same length: copied again (never by copyTree's size test)
    writeConnectorSettings(src, { version: 1, sources: { maxDownloadBytes: 200_000 } });
    await backupDataDir(src, dest);
    expect(readConnectorSettings(dest).sources.maxDownloadBytes).toBe(200_000);
    // gone at the source: gone in the destination
    fs.rmSync(path.join(src, CONNECTORS_FILE));
    await backupDataDir(src, dest);
    expect(fs.existsSync(path.join(dest, CONNECTORS_FILE))).toBe(false);
  });
});

describe('the connector key store (complete)', () => {
  it('writes 0600 under connectors/keys, states keySet without the value, refuses ids outside the list and control characters', () => {
    const d = tmp('pf-con-keys-');
    const ks = new ConnectorKeyStore(d);
    expect(ks.state('source.pixabay')).toEqual({ keySet: false, keyAddedAt: null });
    const st = ks.write('source.pixabay', '  abc-123  ');
    expect(st.keySet).toBe(true);
    expect(JSON.stringify(st)).not.toContain('abc-123');
    expect(ks.read('source.pixabay')).toBe('abc-123');
    const file = path.join(d, CONNECTORS_DIR, 'keys', 'source.pixabay.key');
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(ks.redactor()('the key abc-123 was refused')).toBe('the key [redacted] was refused');
    expect(() => ks.write('source.pixabay', 'a\nb')).toThrow(/not the form/);
    expect(() => ks.write('../x' as never, 'v')).toThrow(/no such connector key/);
    expect(ks.delete('source.pixabay')).toEqual({ keySet: false, keyAddedAt: null });
  });
});
