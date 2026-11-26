import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { startServer } from './index.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('startServer with port 0 (any free port)', () => {
  it('reports the bound port in url, ownerUrl and cfg, and the Host/Origin allowlist accepts it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-eph-')); dirs.push(dir);
    const s = await startServer({ port: 0, dataDir: dir });
    try {
      const port = Number(new URL(s.url).port);
      expect(port).toBeGreaterThan(0);
      expect(s.cfg.port).toBe(port);
      expect(s.ownerUrl.startsWith(`http://127.0.0.1:${port}/`)).toBe(true);
      const r = await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner, connection: 'close' } });
      expect(r.status).toBe(200);
      const other = await fetch(`${s.url}/api/v1/session`, { headers: { origin: 'http://127.0.0.1:1', 'x-pf-owner-key': s.auth.tokens.owner, connection: 'close' } });
      expect(other.status).toBe(403);
    } finally { await s.close(); }
  });
});
