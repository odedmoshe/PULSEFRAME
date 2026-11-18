/**
 * Lead contracts of perform mode on the server (ADR-0025): POST /api/v1/projects/:id/takes and the MCP tool perform_take, the
 * refusals that come BEFORE any planning (permission, propose mode, limited grants, a malformed body), and a take committed
 * the way the route commits it (one internal apply_take): one history entry, exact undo and redo, replay equality.
 * The planner is W1's (core moves.ts): its success path through the route is todo; nothing here pins the stub.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { creativeProjection, PAD_COUNT, PERFORM_PLANNER_BUILT, PERFORM_RECIPE_ID, type OpCall } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
const R = { num: 30, den: 1 };
let n = 1;
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
const headers = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body: unknown, t: string) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers(t), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
};
let rpc = 0;
const tool = async (name: string, args: Record<string, unknown>, t: string) => {
  const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { ...headers(t), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, body: JSON.parse(msg.result.content[0].text) as any };
};
const grant = (input: Record<string, unknown>) => gov.createGrant({ name: `g${n++}`, ...input }, USER).token;
const revision = (pid: string) => store.getProject(pid).revision;
const body = (extra: Record<string, unknown> = {}) => ({ taps: [{ pad: 0, down: 1, up: 1.2 }, { pad: 1, down: 2, up: 2.1 }], bank: Array(PAD_COUNT).fill(null), assets: Array(PAD_COUNT).fill(null), settings: { snap: 'beat', tempo: 'normal', strength: 1, parity: 0 }, gpu: false, ...extra });
const f = (k: number) => T.frameTime(k, R);
function seed(name: string) {
  const pid = store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
  store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: f(300) } }] });
  return pid;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-perform-contracts-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  gov = new Governance(store);
  auth.resolveGrant = (t) => gov.principalForToken(t);
  const speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, speech);
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('POST /takes and perform_take: refusals before planning (wired by the lead)', () => {
  it('a malformed body is 400 (an extra key, a pad outside 0..7, a tap that ends before it starts, seven pads)', async () => {
    const pid = seed('t-body');
    for (const b of [body({ extra: 1 }), body({ taps: [{ pad: 8, down: 1, up: 2 }] }), body({ taps: [{ pad: 0, down: 2, up: 1 }] }), body({ bank: Array(7).fill(null) })]) {
      expect((await rest('POST', `/projects/${pid}/takes`, b, auth.tokens.agent)).status).toBe(400);
    }
  });
  it('refuses an observe-only credential, a propose-mode agent and a limited grant (REST and MCP); nothing changes', async () => {
    const pid = seed('t-perm');
    const before = revision(pid);
    expect((await rest('POST', `/projects/${pid}/takes`, body(), auth.tokens.observer)).status).toBe(403);
    const propose = grant({ mode: 'propose' });
    const pr = await rest('POST', `/projects/${pid}/takes`, body(), propose);
    expect([pr.status, pr.body.error?.code]).toEqual([403, 'insufficient_scope']);
    expect(pr.body.error.message).toMatch(/a performance take cannot be proposed/);
    const limited = grant({ mode: 'edit', trackIds: ['trk_none'] });
    const lr = await rest('POST', `/projects/${pid}/takes`, body(), limited);
    expect([lr.status, lr.body.error?.code]).toEqual([403, 'out_of_scope']);
    const pt = await tool('perform_take', { projectId: pid, ...body() }, propose);
    expect(pt.isError).toBe(true);
    expect(revision(pid)).toBe(before);
  });
  it.runIf(!PERFORM_PLANNER_BUILT)('while the planner is not built: 501 take_not_built after the permission checks, for a take and a dry run; nothing changes', async () => {
    const pid = seed('t-501');
    const before = revision(pid);
    for (const b of [body(), body({ dryRun: true })]) {
      const r = await rest('POST', `/projects/${pid}/takes`, b, auth.tokens.agent);
      expect([r.status, r.body.error?.code]).toEqual([501, 'take_not_built']);
    }
    const t = await tool('perform_take', { projectId: pid, ...body() }, auth.tokens.agent);
    expect(t.isError).toBe(true);
    expect(revision(pid)).toBe(before);
  });
  it.todo('W1: a seeded take through POST /takes commits ONE revision with one perform:take run; dryRun gives the same args as the browser (perform W1)');
  it.todo('W1: a take whose every tap is held answers 409 take_empty with the chips, and nothing changes');
});

describe('a take committed as the route commits it (one internal apply_take)', () => {
  it('is one history entry; undo restores the document exactly, redo the take, and the log replays to the stored document', () => {
    const pid = seed('t-undo');
    const before = creativeProjection(store.getProject(pid).doc);
    const rev = revision(pid);
    const call: OpCall = { op: 'apply_take', args: { take: { snap: 'beat', tempo: 'normal', parity: 0, strength: 1, taps: 3, hits: 3, held: 0, summary: ['3 hits'] }, steps: [
      { op: 'add_track', args: { kind: 'text', name: 'הופעה' }, bind: 'lane' },
      { op: 'add_text', args: { text: 'הופ', start: f(30), duration: f(15), trackId: { $ref: 'lane', out: 'trackId' } } },
      { op: 'add_adjustment', args: { span: { start: f(90), duration: f(20) }, effects: [{ type: 'color.grayscale' }] } },
      { op: 'add_adjustment', args: { span: { start: f(150), duration: f(3) }, effects: [{ type: 'blur.gaussian' }] } },
    ] } };
    const r = gov.commitAs(USER, { projectId: pid, expectedRevision: rev, allowInternal: true, label: 'Performance take', ops: [call] }) as { revision: number };
    expect(r.revision).toBe(rev + 1);
    const after = creativeProjection(store.getProject(pid).doc);
    expect(Object.values(store.getProject(pid).doc.recipeRuns).filter((x) => x.recipeId === PERFORM_RECIPE_ID).length).toBe(1);
    store.undo(pid, 'user:owner', 'undo');
    expect(creativeProjection(store.getProject(pid).doc)).toBe(before);
    store.undo(pid, 'user:owner', 'redo');
    expect(creativeProjection(store.getProject(pid).doc)).toBe(after);
    expect(JSON.stringify(store.replay(pid).doc)).toBe(JSON.stringify(store.getProject(pid).doc));
  });
  it('a client cannot send apply_take itself (it is internal): POST /transactions refuses it', async () => {
    const pid = seed('t-internal');
    const r = await rest('POST', `/projects/${pid}/transactions`, { expectedRevision: revision(pid), ops: [{ op: 'apply_take', args: { take: { snap: 'off', tempo: 'normal', parity: 0, strength: 0, taps: 1, hits: 1, held: 0, summary: [] }, steps: [{ op: 'add_text', args: { text: 'x', start: T.ZERO, duration: f(15) } }] } }] }, auth.tokens.agent);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.error?.code).toBe('forbidden_op');
  });
});
