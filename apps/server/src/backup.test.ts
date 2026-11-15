import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { backupDataDir } from './backup.ts';
import { startServer } from './index.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
const wav = () => { // minimal valid PCM WAV, mono 8 kHz 8-bit, 2 s
  const n = 16000, b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(60 * Math.sin(i * 0.2));
  return b;
};
const f = (n: number) => ({ value: String(n), timescale: 30 });

describe('backup of a running server and restore', () => {
  it('a backup taken while the server runs restores to exactly the state at that moment: project, history, media bytes and credentials', async () => {
    const src = tmp('pf-bk-src-'), dest = path.join(tmp('pf-bk-dest-'), 'copy');
    const a = await startServer({ port: 8961, dataDir: src });
    const h = { authorization: `Bearer ${a.auth.tokens.agent}`, connection: 'close' };
    const post = async (url: string, p: string, body: unknown) => (await fetch(`${url}/api/v1${p}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
    const get = async (url: string, p: string) => (await fetch(`${url}/api/v1${p}`, { headers: h })).json() as Promise<any>;
    let b: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      const pid = (await post(a.url, '/projects', { name: 'backup me' })).project.id;
      const bytes = wav();
      const up: any = await (await fetch(`${a.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'tone.wav' }, body: new Uint8Array(bytes) })).json();
      await post(a.url, `/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }, { op: 'add_marker', args: { time: f(15), label: 'סמן' } }] });
      await post(a.url, `/projects/${pid}/transactions`, { ops: [{ op: 'add_text', args: { text: 'before backup', start: f(0), duration: f(30) } }] });
      const atBackup = await get(a.url, `/projects/${pid}`);
      const historyAtBackup = await get(a.url, `/projects/${pid}/history?since=0`);

      const r1 = await backupDataDir(src, dest); // server A is still running and has an open WAL
      expect(r1.databaseBytes).toBeGreaterThan(0);
      expect(r1.filesCopied).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(dest, 'tmp'))).toBe(false); // scratch is not backed up
      expect(fs.statSync(path.join(dest, 'tokens.json')).mode & 0o777).toBe(0o600);

      // work continues after the backup; it must not appear in the copy
      await post(a.url, `/projects/${pid}/transactions`, { ops: [{ op: 'add_text', args: { text: 'after backup', start: f(60), duration: f(30) } }] });
      expect((await get(a.url, `/projects/${pid}`)).revision).toBe(atBackup.revision + 1);

      b = await startServer({ port: 8962, dataDir: dest });
      expect(b.auth.tokens).toEqual(a.auth.tokens); // same credentials: the same token works
      const restored = await get(b.url, `/projects/${pid}`);
      expect(restored.revision).toBe(atBackup.revision);
      expect(restored.project).toEqual(atBackup.project);
      expect(JSON.stringify(restored.project)).not.toContain('after backup');
      expect(await get(b.url, `/projects/${pid}/history?since=0`)).toEqual(historyAtBackup);
      const media = Buffer.from(await (await fetch(`${b.url}/api/v1/projects/${pid}/assets/${up.assetId}/content`, { headers: h })).arrayBuffer());
      expect(createHash('sha256').update(media).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
      // the restored copy is a working server: edit and undo
      const edit = await post(b.url, `/projects/${pid}/transactions`, { ops: [{ op: 'add_marker', args: { time: f(45) } }] });
      expect(edit.revision).toBe(atBackup.revision + 1);
      expect((await post(b.url, `/projects/${pid}/undo`, {})).revision).toBe(atBackup.revision + 2);
    } finally { await b?.close(); await a.close(); }
  });

  it('a second backup into the same place copies only what is new; a destination inside the data directory or a wrong source is refused', async () => {
    const src = tmp('pf-bk2-src-'), dest = path.join(tmp('pf-bk2-dest-'), 'copy');
    const a = await startServer({ port: 8963, dataDir: src });
    const h = { authorization: `Bearer ${a.auth.tokens.agent}`, connection: 'close' };
    try {
      const pid = (await (await fetch(`${a.url}/api/v1/projects`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'inc' }) })).json()).project.id;
      await fetch(`${a.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'tone.wav' }, body: new Uint8Array(wav()) });
      const first = await backupDataDir(src, dest);
      const second = await backupDataDir(src, dest);
      expect(first.filesCopied).toBeGreaterThan(0);
      expect(second.filesCopied).toBe(0);
      expect(second.filesSkipped).toBe(first.filesCopied);
      await expect(backupDataDir(src, path.join(src, 'inside'))).rejects.toThrow(/outside/);
      await expect(backupDataDir(tmp('pf-bk-empty-'), path.join(dest, 'x'))).rejects.toThrow(/not a PULSEFRAME data directory/);
    } finally { await a.close(); }
  });
});
