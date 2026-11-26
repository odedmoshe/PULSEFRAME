/**
 * MCP change notifications through a real MCP client over HTTP (subscriptions/listen, protocol revision 2026-07-28):
 * a listening client is told when a project resource it may read changes and when the list of projects changes,
 * and a credential limited to one project is never told about another.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@pulseframe/server';

let s: RunningServer;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-mcpnote-'));
const clients: Client[] = [];
const connect = async (token: string) => {
  const c = new Client({ name: 'mcp-notifications-test', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  clients.push(c);
  return c;
};
const rest = async (p: string, body: unknown, headers: Record<string, string>) => (await fetch(`${s.url}/api/v1${p}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify(body) })).json() as Promise<any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (pred: () => boolean, ms = 5000) => { const t = Date.now(); while (!pred() && Date.now() - t < ms) await sleep(25); return pred(); };
const f = (n: number) => ({ value: String(n), timescale: 30 });
let p1 = '', p2 = '', owner: Record<string, string> = {};

beforeAll(async () => {
  s = await startServer({ port: 0, dataDir: dir });
  const cookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner, connection: 'close' } })).headers.get('set-cookie')!.split(';')[0]!;
  owner = { cookie, origin: s.url };
  p1 = (await rest('/projects', { name: 'First' }, owner)).project.id;
  p2 = (await rest('/projects', { name: 'Second' }, owner)).project.id;
});
afterAll(async () => { await Promise.all(clients.map((c) => c.close().catch(() => {}))); await s.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('MCP change notifications', () => {
  it('a listening client hears about a commit to a project it subscribed to, not about others, and about a new project', async () => {
    const c = await connect(s.auth.tokens.agent);
    const updated: string[] = [];
    let listChanged = 0;
    c.setNotificationHandler('notifications/resources/updated', (n) => { updated.push(n.params.uri); });
    c.setNotificationHandler('notifications/resources/list_changed', () => { listChanged++; });
    const sub = await c.listen({ resourcesListChanged: true, resourceSubscriptions: [`pulseframe://projects/${p1}/timeline`, `pulseframe://projects/${p1}/summary`] });
    try {
      await rest(`/projects/${p2}/transactions`, { ops: [{ op: 'add_text', args: { text: 'other project', start: f(0), duration: f(30) } }] }, owner); // not subscribed
      await rest(`/projects/${p1}/transactions`, { ops: [{ op: 'add_text', args: { text: 'hello', start: f(0), duration: f(30) } }] }, owner);
      expect(await until(() => updated.length >= 2)).toBe(true);
      expect([...updated].sort()).toEqual([`pulseframe://projects/${p1}/summary`, `pulseframe://projects/${p1}/timeline`]);
      // the resource read after the notification shows the new revision
      const tl = JSON.parse(((await c.readResource({ uri: `pulseframe://projects/${p1}/timeline` })).contents[0] as { text: string }).text);
      expect(tl.revision).toBe(1);
      // an edit made through MCP itself notifies too
      await c.callTool({ name: 'apply_transaction', arguments: { projectId: p1, ops: [{ op: 'add_marker', args: { time: f(15) } }] } });
      expect(await until(() => updated.length >= 4)).toBe(true);
      const before = listChanged;
      await rest('/projects', { name: 'Third' }, owner);
      expect(await until(() => listChanged > before)).toBe(true);
    } finally { await sub.close(); }
    // after closing, nothing more arrives
    const n = updated.length;
    await rest(`/projects/${p1}/transactions`, { ops: [{ op: 'add_marker', args: { time: f(20) } }] }, owner);
    await sleep(400);
    expect(updated.length).toBe(n);
  }, 30_000);

  it('a credential limited to one project is not told that another project changed, even when it asks for that URI', async () => {
    const g = await rest('/grants', { name: 'only-first', mode: 'observe', projectIds: [p1] }, owner);
    const c = await connect(g.token);
    const updated: string[] = [];
    let listChanged = 0;
    c.setNotificationHandler('notifications/resources/updated', (n) => { updated.push(n.params.uri); });
    c.setNotificationHandler('notifications/resources/list_changed', () => { listChanged++; });
    const sub = await c.listen({ resourcesListChanged: true, resourceSubscriptions: [`pulseframe://projects/${p1}/timeline`, `pulseframe://projects/${p2}/timeline`] });
    try {
      await rest(`/projects/${p2}/transactions`, { ops: [{ op: 'add_marker', args: { time: f(40) } }] }, owner);
      await rest('/projects', { name: 'Fourth (outside the grant)' }, owner);
      await rest(`/projects/${p1}/transactions`, { ops: [{ op: 'add_marker', args: { time: f(40) } }] }, owner);
      expect(await until(() => updated.length >= 1)).toBe(true);
      await sleep(300);
      expect(updated).toEqual([`pulseframe://projects/${p1}/timeline`]);
      expect(listChanged).toBe(0);
    } finally { await sub.close(); }
  }, 30_000);
});
