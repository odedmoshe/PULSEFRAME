import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startServer } from './index.ts';

describe('server shutdown', () => {
  it('closes promptly even while a client still holds an event stream open', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-shutdown-'));
    const s = await startServer({ port: 8979, dataDir: dir });
    try {
      const h = { authorization: `Bearer ${s.auth.tokens.agent}` };
      const pid = ((await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'open stream' }) })).json()) as any).project.id;
      const stream = await fetch(`${s.url}/api/v1/projects/${pid}/events`, { headers: h }); // an SSE stream that is never closed by the client
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      await reader.read();
      const t = Date.now();
      await Promise.race([s.close(), new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown did not finish within 5 s')), 5000))]);
      expect(Date.now() - t).toBeLessThan(5000);
      await reader.cancel().catch(() => {});
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 20_000);
});
