import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { backupDataDir, backupWithHistory, BackupScheduler, listSnapshots } from './backup.ts';
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

  it('backups with history keep the newest dated snapshots, never lose media an older snapshot needs, and an older snapshot restores', async () => {
    const src = tmp('pf-bk3-src-'), dest = path.join(tmp('pf-bk3-dest-'), 'copy');
    const a = await startServer({ port: 8964, dataDir: src });
    const h = { authorization: `Bearer ${a.auth.tokens.agent}`, connection: 'close' };
    const post = async (url: string, p: string, body: unknown) => (await fetch(`${url}/api/v1${p}`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
    let b: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      const pid = (await post(a.url, '/projects', { name: 'history' })).project.id;
      const t0 = Date.UTC(2026, 0, 1, 3, 0, 0);
      const revs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await post(a.url, `/projects/${pid}/transactions`, { ops: [{ op: 'add_marker', args: { time: f(i * 10), label: `m${i}` } }] });
        revs.push(r.revision);
        const out = await backupWithHistory(src, dest, 3, t0 + i * 3600_000);
        expect(out.snapshots.length).toBe(Math.min(3, i + 1));
        expect(out.removed.length).toBe(i >= 3 ? 1 : 0);
      }
      expect(listSnapshots(dest)).toEqual(['pulseframe-20260101T050000Z.sqlite', 'pulseframe-20260101T060000Z.sqlite', 'pulseframe-20260101T070000Z.sqlite']);
      // each retained snapshot is a complete database at the revision of its run
      for (const [i, n] of listSnapshots(dest).entries()) {
        const db = new Database(path.join(dest, 'snapshots', n), { readonly: true });
        try { expect(db.pragma('integrity_check', { simple: true })).toBe('ok'); expect(JSON.stringify(db.prepare('select * from projects').all())).toContain(`m${i + 2}`); expect(JSON.stringify(db.prepare('select * from projects').all())).not.toContain(`m${i + 3}`); } finally { db.close(); }
      }
      // going back: the oldest retained snapshot over the copy's database starts as a working server at that revision
      fs.copyFileSync(path.join(dest, 'snapshots', 'pulseframe-20260101T050000Z.sqlite'), path.join(dest, 'pulseframe.sqlite'));
      b = await startServer({ port: 8965, dataDir: dest });
      const restored: any = await (await fetch(`${b.url}/api/v1/projects/${pid}`, { headers: h })).json();
      expect(restored.revision).toBe(revs[2]);
      expect(Object.keys(restored.project.markers ?? {}).length || restored.project.markers.length).toBe(3);
    } finally { await b?.close(); await a.close(); }
  });

  it('the scheduler runs on its interval, reports status over the API, lets only the owner start a run, records a failure without stopping, and is off unless configured', async () => {
    const src = tmp('pf-bk4-src-'), dest = path.join(tmp('pf-bk4-dest-'), 'auto');
    expect(() => new BackupScheduler(src, path.join(src, 'in'), 1, 3)).toThrow(/outside/);
    const a = await startServer({ port: 8966, dataDir: src, backupDir: dest, backupEveryHours: 24, backupKeep: 2 });
    const agent = { authorization: `Bearer ${a.auth.tokens.agent}`, connection: 'close' };
    const ownerOf = async (srv: typeof a) => ({ origin: srv.url, connection: 'close', cookie: (await fetch(`${srv.url}/api/v1/session`, { headers: { origin: srv.url, 'x-pf-owner-key': srv.auth.tokens.owner, connection: 'close' } })).headers.get('set-cookie')!.split(';')[0]! });
    const ownerH = await ownerOf(a);
    try {
      let st: any = await (await fetch(`${a.url}/api/v1/backup`, { headers: agent })).json();
      expect(st).toMatchObject({ enabled: true, everyHours: 24, keep: 2, lastAt: null, snapshots: 0 });
      expect(st.nextAt).toBeGreaterThan(Date.now() - 1000); // no snapshot yet: the first run is due at once
      expect(st.nextAt).toBeLessThan(Date.now() + 5000);
      for (let i = 0; i < 100 && !(st.lastAt && !st.running); i++) { await new Promise((r) => setTimeout(r, 100)); st = await (await fetch(`${a.url}/api/v1/backup`, { headers: agent })).json(); }
      expect(st).toMatchObject({ lastOk: true, lastError: null, snapshots: 1 });
      expect(st.nextAt).toBeGreaterThan(Date.now() + 23 * 3600_000); // then one interval later
      expect(fs.existsSync(path.join(dest, 'pulseframe.sqlite'))).toBe(true);
      expect((await fetch(`${a.url}/api/v1/backup`, { method: 'POST', headers: agent })).status).toBe(403);
      expect((await fetch(`${a.url}/api/v1/backup`, { method: 'POST' })).status).toBe(401);
      // a failing run is reported and the server keeps working
      fs.rmSync(dest, { recursive: true, force: true }); fs.writeFileSync(dest, 'a file where the directory should be');
      const failed = await fetch(`${a.url}/api/v1/backup`, { method: 'POST', headers: ownerH });
      expect(failed.status).toBe(500);
      expect(await failed.json()).toMatchObject({ lastOk: false });
      expect((await fetch(`${a.url}/api/v1/projects`, { headers: agent })).status).toBe(200);
      fs.rmSync(dest);
      const ok = await fetch(`${a.url}/api/v1/backup`, { method: 'POST', headers: ownerH });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ lastOk: true, lastError: null });
    } finally { await a.close(); }
    // a restart with a fresh snapshot present waits for the interval instead of running at once
    const a2 = await startServer({ port: 8966, dataDir: src, backupDir: dest, backupEveryHours: 24, backupKeep: 2 });
    try { expect(a2.backup.status().nextAt!).toBeGreaterThan(Date.now() + 23 * 3600_000); } finally { await a2.close(); }
    const off = await startServer({ port: 8967, dataDir: tmp('pf-bk5-src-') });
    try {
      expect(await (await fetch(`${off.url}/api/v1/backup`, { headers: { authorization: `Bearer ${off.auth.tokens.agent}` } })).json()).toMatchObject({ enabled: false, nextAt: null });
      expect((await fetch(`${off.url}/api/v1/backup`, { method: 'POST', headers: await ownerOf(off) })).status).toBe(409);
    } finally { await off.close(); }
  });
});
