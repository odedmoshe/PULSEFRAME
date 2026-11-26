import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { startServer } from './index.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-sess-')); dirs.push(d); return d; };

describe('owner session cookie', () => {
  it('is HttpOnly, SameSite=Strict and not Secure by default; with secureCookie it is Secure, is issued to a listed https origin and refused to an unlisted one', async () => {
    const plain = await startServer({ port: 0, dataDir: tmp() });
    try {
      const r = await fetch(`${plain.url}/api/v1/session`, { headers: { origin: plain.url, 'x-pf-owner-key': plain.auth.tokens.owner, connection: 'close' } });
      const c = r.headers.get('set-cookie')!;
      expect(c).toMatch(/^pf_session=[\w-]+; HttpOnly; SameSite=Strict; Path=\/$/);
    } finally { await plain.close(); }
    const tls = await startServer({ port: 0, dataDir: tmp(), secureCookie: true, extraOrigins: ['https://studio.example'] });
    try {
      const key = { 'x-pf-owner-key': tls.auth.tokens.owner, connection: 'close' };
      const ok = await fetch(`${tls.url}/api/v1/session`, { headers: { ...key, origin: 'https://studio.example' } });
      expect(ok.status).toBe(200);
      const c = ok.headers.get('set-cookie')!;
      expect(c).toMatch(/^pf_session=[\w-]+; HttpOnly; SameSite=Strict; Path=\/; Secure$/);
      // the cookie works for that origin and not for another one
      const cookie = c.split(';')[0]!;
      expect((await fetch(`${tls.url}/api/v1/projects`, { headers: { cookie, origin: 'https://studio.example', connection: 'close' } })).status).toBe(200);
      expect((await fetch(`${tls.url}/api/v1/projects`, { headers: { cookie, origin: 'https://evil.example', connection: 'close' } })).status).toBe(403);
      expect((await fetch(`${tls.url}/api/v1/session`, { headers: { ...key, origin: 'https://evil.example' } })).status).toBe(403);
    } finally { await tls.close(); }
  });
});
