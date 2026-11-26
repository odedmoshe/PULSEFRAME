import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from './index.ts';

/** Per-credential request budget for agents (config.agentRequestsPerMinute). Uses a replaceable clock, so no waiting. */
describe('agent rate limit', () => {
  let s: RunningServer;
  let now = 1_000_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-rate-'));
  beforeAll(async () => {
    s = await startServer({ port: 0, dataDir: dir, agentRequestsPerMinute: 60 }); // 1 per second, bucket of 10
    s.auth.now = () => now;
  });
  afterAll(async () => { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const get = (headers: Record<string, string>, p = '/api/v1/projects') => fetch(`${s.url}${p}`, { headers: { connection: 'close', ...headers } });
  const agent = () => ({ authorization: `Bearer ${s.auth.tokens.agent}` });
  const observer = () => ({ authorization: `Bearer ${s.auth.tokens.observer}` });

  it('lets a burst of ten through, then answers 429 with a typed error and Retry-After; time refills the budget', async () => {
    const first: number[] = [];
    for (let i = 0; i < 10; i++) first.push((await get(agent())).status);
    expect(first.every((x) => x === 200)).toBe(true);
    const over = await get(agent());
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).toBe('1');
    const body = await over.json();
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.details).toMatchObject({ limitPerMinute: 60, retryAfterSeconds: 1 });
    now += 3000; // three seconds later: three more requests are available
    expect([(await get(agent())).status, (await get(agent())).status, (await get(agent())).status, (await get(agent())).status]).toEqual([200, 200, 200, 429]);
  });
  it('budgets are per credential, cover MCP as well as REST, and never apply to the owner session', async () => {
    // the agent credential is exhausted (previous test); another credential is unaffected
    expect((await get(observer())).status).toBe(200);
    const mcp = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { ...agent(), 'content-type': 'application/json', accept: 'application/json, text/event-stream', connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(mcp.status).toBe(429);
    const cookie = (await get({ origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner }, '/api/v1/session')).headers.get('set-cookie')!.split(';')[0]!;
    const owner: number[] = [];
    for (let i = 0; i < 25; i++) owner.push((await get({ cookie, origin: s.url })).status);
    expect(owner.every((x) => x === 200)).toBe(true);
    // a wrong token is 401, not 429, and does not consume anyone's budget
    expect((await get({ authorization: 'Bearer pfa_wrong' })).status).toBe(401);
  });
  it('a grant can carry its own budget: it applies where the server-wide limit is off, and replaces it where it is on', async () => {
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-rate-g-'));
    const open = await startServer({ port: 0, dataDir: dir3, agentRequestsPerMinute: 0 });
    try {
      let t = 50_000; open.auth.now = () => t;
      const cookie = (await fetch(`${open.url}/api/v1/session`, { headers: { origin: open.url, 'x-pf-owner-key': open.auth.tokens.owner, connection: 'close' } })).headers.get('set-cookie')!.split(';')[0]!;
      const mk = async (body: unknown) => (await fetch(`${open.url}/api/v1/grants`, { method: 'POST', headers: { cookie, origin: open.url, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify(body) }));
      const limited = await (await mk({ name: 'slow', mode: 'observe', requestsPerMinute: 12 })).json(); // bucket of 2, one more every 5 s
      const free = await (await mk({ name: 'free', mode: 'observe' })).json();
      expect(limited.grant.requestsPerMinute).toBe(12);
      expect(free.grant.requestsPerMinute).toBeNull();
      const hit = async (token: string) => (await fetch(`${open.url}/api/v1/projects`, { headers: { authorization: `Bearer ${token}`, connection: 'close' } })).status;
      expect([await hit(limited.token), await hit(limited.token), await hit(limited.token)]).toEqual([200, 200, 429]);
      t += 5000;
      expect([await hit(limited.token), await hit(limited.token)]).toEqual([200, 429]);
      const many: number[] = []; for (let i = 0; i < 30; i++) many.push(await hit(free.token));
      expect(many.every((x) => x === 200)).toBe(true); // no own budget and no server-wide limit
      expect((await mk({ name: 'bad', mode: 'observe', requestsPerMinute: 0 })).status).toBe(400);
    } finally { await open.close(); fs.rmSync(dir3, { recursive: true, force: true }); }
    // on the server with a 60/min limit, a grant with a larger budget is not held to 60
    const cookie = (await get({ origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner }, '/api/v1/session')).headers.get('set-cookie')!.split(';')[0]!;
    const big = await (await fetch(`${s.url}/api/v1/grants`, { method: 'POST', headers: { cookie, origin: s.url, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ name: 'fast', mode: 'observe', requestsPerMinute: 6000 }) })).json();
    const fast: number[] = []; for (let i = 0; i < 40; i++) fast.push((await get({ authorization: `Bearer ${big.token}` })).status);
    expect(fast.every((x) => x === 200)).toBe(true);
  });
  it('0 switches the limit off', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-rate0-'));
    const open = await startServer({ port: 0, dataDir: dir2, agentRequestsPerMinute: 0 });
    try {
      open.auth.now = () => 5;
      const all: number[] = [];
      for (let i = 0; i < 40; i++) all.push((await fetch(`${open.url}/api/v1/projects`, { headers: { authorization: `Bearer ${open.auth.tokens.agent}`, connection: 'close' } })).status);
      expect(all.every((x) => x === 200)).toBe(true);
    } finally { await open.close(); fs.rmSync(dir2, { recursive: true, force: true }); }
  });
});
