import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from './index.ts';
import { dataDirBytes } from './storage.ts';

/** Optional storage ceiling (config.maxStorageBytes): uploads and exports are refused with a typed 507 once it would be passed. */
describe('storage ceiling', () => {
  let s: RunningServer;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-quota-'));
  const QUOTA = 3_000_000;
  let owner: Record<string, string> = {};
  let pid = '';
  const wav = (seconds: number) => { // minimal valid PCM WAV, mono 8 kHz 8-bit: 8000 bytes per second
    const n = 8000 * seconds, b = Buffer.alloc(44 + n, 128);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
    for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(60 * Math.sin(i * 0.3 + seconds));
    return b;
  };
  const upload = (bytes: Buffer, name: string) => fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...owner, 'x-filename': name, connection: 'close' }, body: new Uint8Array(bytes) });
  beforeAll(async () => {
    s = await startServer({ port: 8951, dataDir: dir, maxStorageBytes: QUOTA });
    const cookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner, connection: 'close' } })).headers.get('set-cookie')!.split(';')[0]!;
    owner = { cookie, origin: s.url };
    pid = (await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: { ...owner, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ name: 'quota' }) })).json()).project.id;
  });
  afterAll(async () => { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('accepts an upload that fits, reports total and ceiling, then refuses one that does not fit — before storing anything', async () => {
    const small = await upload(wav(10), 'small.wav'); // 80 kB
    expect(small.status).toBe(201);
    const rep = await (await fetch(`${s.url}/api/v1/storage`, { headers: { ...owner, connection: 'close' } })).json();
    expect(rep.quotaBytes).toBe(QUOTA);
    expect(rep.totalBytes).toBeGreaterThan(80_000);
    expect(rep.totalBytes).toBeLessThan(QUOTA);
    const before = dataDirBytes(dir);
    const big = await upload(wav(400), 'big.wav'); // 3.2 MB: larger than the whole ceiling
    expect(big.status).toBe(507);
    const body = await big.json();
    expect(body.error.code).toBe('storage_quota_exceeded');
    expect(body.error.details).toMatchObject({ quotaBytes: QUOTA });
    expect(body.error.details.neededBytes).toBeGreaterThan(3_000_000);
    expect(body.error.hint).toMatch(/clean-up/);
    expect(dataDirBytes(dir)).toBeLessThanOrEqual(before + 4096); // nothing of the refused upload was kept
    const assets = (await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: { ...owner, connection: 'close' } })).json()).project.assets;
    expect(Object.keys(assets)).toHaveLength(1);
  });
  it('once the ceiling is reached, exports and imports are refused too; editing still works', async () => {
    // fill the directory past the ceiling with a file the server does not manage (stands in for accumulated exports)
    fs.writeFileSync(path.join(dir, 'filler.bin'), Buffer.alloc(QUOTA));
    const exp = await fetch(`${s.url}/api/v1/projects/${pid}/exports`, { method: 'POST', headers: { ...owner, 'content-type': 'application/json', connection: 'close' }, body: '{}' });
    expect(exp.status).toBe(507);
    expect((await exp.json()).error.code).toBe('storage_quota_exceeded');
    expect((await upload(wav(1), 'tiny.wav')).status).toBe(507);
    const imp = await fetch(`${s.url}/api/v1/projects/import`, { method: 'POST', headers: { ...owner, connection: 'close' }, body: new Uint8Array(Buffer.from('not a real archive')) });
    expect(imp.status).toBe(507);
    const edit = await fetch(`${s.url}/api/v1/projects/${pid}/transactions`, { method: 'POST', headers: { ...owner, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ ops: [{ op: 'add_marker', args: { time: { value: '0', timescale: 30 } } }] }) });
    expect(edit.status).toBe(200);
    fs.rmSync(path.join(dir, 'filler.bin'));
    expect((await upload(wav(1), 'tiny.wav')).status).toBe(201);
  });

});
