/**
 * Lead contracts of «למדו אותי פעם אחת» on the server (wave 8 teach; lessons/guard.ts, lessons/routes.ts).
 * 1. The governance rule of version 1 (teach-verify C12, decisions.md): an agent's apply_lesson is refused 403 lesson_owner_only on
 *    every path — REST commit, dry run, nested apply_transaction, proposal; MCP op tool, apply_transaction, propose_transaction —
 *    for every agent grant (edit, autopilot, propose); the owner's session reaches the op (422 unknown_op while not built). Nothing
 *    changes and no proposal is stored.
 * 2. The derive route: an agent is 403 owner_required before the clip is looked at; the owner gets 404 for an unknown clip and an
 *    honest 501 teach_not_built until W2 builds it.
 * W2 owns this file after the pre-pass and adds the rows of the built route (the todo rows at the end).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { LESSON_API_REFUSALS, LESSON_OPS_BUILT, LESSON_REFUSALS, type OpCall } from '@pulseframe/core';
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
import { holdsLessonCall } from './lessons/guard.ts';
import { LESSON_SERVER_BUILT } from './lessons/routes.ts';

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives, ownerCookie: string;
const base = () => `http://127.0.0.1:${cfg.port}`;
const headers = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const ownerHeaders = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body: unknown, h: Record<string, string>) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
};
let rpc = 0;
const mcpCall = async (method: string, params: Record<string, unknown>, t: string) => {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...headers(t), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method, params }) }));
  const text = await r.text();
  return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
};
const toolCode = (t: any): string | undefined => { const j = JSON.parse(t.result?.content?.[0]?.text ?? '{}'); return j.error?.code ?? j.code; };
let n = 1;
const grant = (input: Record<string, unknown>) => gov.createGrant({ name: `g${n++}`, ...input }, USER).token;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-teach-contracts-'));
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
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const R = { num: 30, den: 1 };
function seed(name: string) {
  const pid = store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
  const r = store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_text', args: { text: 'a', start: T.ZERO, duration: T.frameTime(30, R) } }, { op: 'add_text', args: { text: 'b', start: T.frameTime(30, R), duration: T.frameTime(30, R) } }] });
  const [a, b] = r.results.map((x) => x.output!.clipId as string) as [string, string];
  return { pid, a, b };
}
const lesson = (a: string, b: string): OpCall & { args: Record<string, unknown> } => ({ op: 'apply_lesson', args: { sourceClipId: a, targets: [b], parts: [{ key: 'transform', kind: 'transform', steps: [{ op: 'set_clip_transform', args: { clipId: { $slot: 'clip' }, transform: { scale: 1.2 } } }] }] } });
const proposals = (pid: string) => (store.db.prepare('SELECT COUNT(*) AS n FROM proposals WHERE project_id = ?').get(pid) as { n: number }).n;

describe('version 1: an agent\'s apply_lesson is refused (lessons/guard.ts)', () => {
  it('the walker finds apply_lesson at any depth and nothing else', () => {
    expect(holdsLessonCall([{ op: 'apply_lesson', args: {} }])).toBe(true);
    expect(holdsLessonCall([{ op: 'apply_transaction', args: { ops: [{ op: 'set_clip_gain', args: {} }, { op: 'apply_lesson', args: {} }] } }])).toBe(true);
    expect(holdsLessonCall([{ op: 'set_clip_gain', args: { clipId: 'apply_lesson' } }])).toBe(false);
  });
  it('REST: commit, dry run, nested apply_transaction and proposal are 403 lesson_owner_only for edit, autopilot and propose grants; nothing changes', async () => {
    const s = seed('teach-rest');
    const before = store.getProject(s.pid).revision;
    const call = lesson(s.a, s.b);
    for (const mode of ['edit', 'autopilot', 'propose']) {
      const t = grant({ mode });
      for (const [p, body] of [
        [`/projects/${s.pid}/transactions`, { ops: [call] }],
        [`/projects/${s.pid}/operations/validate`, { ops: [call] }],
        [`/projects/${s.pid}/transactions`, { ops: [{ op: 'apply_transaction', args: { ops: [call] } }] }],
        [`/projects/${s.pid}/proposals`, { ops: [call] }],
      ] as const) {
        const r = await rest('POST', p, body, headers(t));
        expect([r.status, r.body?.error?.code, r.body?.error?.message], `${mode} ${p}`).toEqual([403, LESSON_API_REFUSALS.agentRefused.code, LESSON_API_REFUSALS.agentRefused.message()]);
        expect(r.body.error.hint).toBe(LESSON_API_REFUSALS.agentRefused.hint);
      }
    }
    // the built-in agent token as well
    const r = await rest('POST', `/projects/${s.pid}/transactions`, { ops: [call] }, headers(auth.tokens.agent));
    expect([r.status, r.body?.error?.code]).toEqual([403, 'lesson_owner_only']);
    expect(store.getProject(s.pid).revision).toBe(before);
    expect(proposals(s.pid)).toBe(0);
  });
  it('MCP: the apply_lesson op tool, apply_transaction and propose_transaction are refused the same way', async () => {
    const s = seed('teach-mcp');
    const before = store.getProject(s.pid).revision;
    const call = lesson(s.a, s.b);
    const t = grant({ mode: 'edit' });
    const tries = [
      { name: 'apply_lesson', arguments: { projectId: s.pid, ...call.args } },
      { name: 'apply_transaction', arguments: { projectId: s.pid, ops: [call] } },
      { name: 'apply_transaction', arguments: { projectId: s.pid, dryRun: true, ops: [call] } },
      { name: 'propose_transaction', arguments: { projectId: s.pid, ops: [call] } },
    ];
    for (const x of tries) {
      const r = await mcpCall('tools/call', x, t);
      expect(r.result?.isError, x.name).toBe(true);
      expect(toolCode(r), x.name).toBe('lesson_owner_only');
    }
    expect(store.getProject(s.pid).revision).toBe(before);
    expect(proposals(s.pid)).toBe(0);
  });
  it('the owner\'s session reaches the op: its validation answers first, then not-built while lesson.ts is not built', async () => {
    const s = seed('teach-owner');
    const bad = await rest('POST', `/projects/${s.pid}/transactions`, { ops: [{ op: 'apply_lesson', args: { ...lesson(s.a, s.b).args, targets: [s.a] } }] }, ownerHeaders());
    expect([bad.status, bad.body?.error?.code, bad.body?.error?.message]).toEqual([422, 'invalid_args', LESSON_REFUSALS.sourceIsTarget.message(s.a)]);
    const forbidden = await rest('POST', `/projects/${s.pid}/transactions`, { ops: [{ op: 'apply_lesson', args: { ...lesson(s.a, s.b).args, parts: [{ key: 'g', kind: 'gain', steps: [{ op: 'add_person', args: { name: 'x' } }] }] } }] }, ownerHeaders());
    expect([forbidden.status, forbidden.body?.error?.code]).toEqual([403, 'forbidden_op']);
    if (!LESSON_OPS_BUILT) {
      const r = await rest('POST', `/projects/${s.pid}/transactions`, { ops: [lesson(s.a, s.b)] }, ownerHeaders());
      expect([r.status, r.body?.error?.code, r.body?.error?.message]).toEqual([422, 'unknown_op', LESSON_REFUSALS.notBuilt.message()]);
    }
  });
});

describe('GET …/clips/:clipId/lesson (lessons/routes.ts)', () => {
  it('an agent or observer is 403 owner_required before the clip is looked at; the owner gets 404 for an unknown clip and 501 teach_not_built until built', async () => {
    const s = seed('teach-derive');
    for (const t of [grant({ mode: 'edit' }), grant({ mode: 'autopilot' }), auth.tokens.agent, auth.tokens.observer]) {
      for (const clip of [s.a, 'clp_none']) {
        const r = await rest('GET', `/projects/${s.pid}/clips/${clip}/lesson`, undefined, headers(t));
        expect([r.status, r.body?.error?.code]).toEqual([403, 'owner_required']);
      }
    }
    const none = await rest('GET', `/projects/${s.pid}/clips/clp_none/lesson`, undefined, ownerHeaders());
    expect([none.status, none.body?.error?.code]).toEqual([404, 'not_found']);
    const inherited = await rest('GET', `/projects/${s.pid}/clips/constructor/lesson`, undefined, ownerHeaders());
    expect(inherited.status).toBe(404);
    if (!LESSON_SERVER_BUILT) {
      const r = await rest('GET', `/projects/${s.pid}/clips/${s.a}/lesson`, undefined, ownerHeaders());
      expect([r.status, r.body?.error?.code, r.body?.error?.hint]).toEqual([501, 'teach_not_built', LESSON_API_REFUSALS.notBuilt.hint]);
    }
  });
  it.todo('W2 (C3, C-cost): with 1,000 rows in the project the route reads at most the newest 400 (counted with a statement spy) and reads `changes` only for the rows whose ops name the clip or a partner');
  it.todo('W2 (proof check 2): a planted title word and a date-stamp text appear nowhere in the answer; the answer passes validateLessonArgs as apply_lesson args (lessonArgsOf)');
  it.todo('W2 (C1, C2): a version restore, a paste, a template run and an accepted agent proposal end the window as `restored`, `pasted`, `template`, `proposal`; an agent\'s own rows are never learned');
  it.todo('W2: the derive answer is the same for the same revision; a new revision that names the clip changes it');
});
