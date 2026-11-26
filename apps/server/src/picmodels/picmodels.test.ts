/**
 * The picmodels routes through the real app (wave 8 picmodels pre-pass):
 * - POST …/eyes/propose answers 403 owner_required to every agent credential BEFORE the body is read (a body that would be invalid
 *   proves it), and the owner's own session gets 501 eyes_not_built while PICMODELS_SERVER_BUILT is false;
 * - GET /api/v1/picture-models is a read-only report: the owner sees every row with its sentence, an agent sees codes and numbers and
 *   never the yunet row;
 * - no MCP tool of this track exists; no job type for eyes exists;
 * - NOTHING OF EYES IS STORED: searchEverywhere (below) looks for a planted value in every table of the database, every event, every
 *   job row, every file under the data directory, everything the server printed and every answer, as the growing track's privacy test
 *   does. The row stays when W1 builds the route: it is the privacy rule. W1 turns the todos into tests with the labelled fake.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PICTURE_MODEL_IDS } from '@pulseframe/core';
import { Auth } from '../auth.ts';
import { Capabilities } from '../capabilities.ts';
import { loadConfig, type Config } from '../config.ts';
import { Derivatives } from '../derive.ts';
import { Exporter } from '../export.ts';
import { Governance, type Principal } from '../governance.ts';
import { createApp } from '../http.ts';
import { createMcp } from '../mcp.ts';
import { Presence } from '../presence.ts';
import { Speech } from '../speech.ts';
import { Store } from '../store.ts';
import { PICMODELS_SERVER_BUILT } from './contract.ts';

const PLANTED = 0.1234567;
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let ownerCookie = '', fullGrant = '', proposeGrant = '', pid = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const AGENTS: [string, Who][] = [['the agent token', bearer(() => auth.tokens.agent)], ['an edit grant with people full', bearer(() => fullGrant)], ['a propose grant', bearer(() => proposeGrant)]];
const answers: string[] = [];
const rest = async (who: Who, method: string, p: string, body?: unknown, raw?: string) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(raw !== undefined ? { body: raw } : body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  answers.push(text);
  return { status: r.status, headers: r.headers, body: (r.headers.get('content-type') ?? '').includes('json') ? (JSON.parse(text) as any) : null };
};

/**
 * Every place a value could have been recorded: each table of the database (rows as JSON), the events since 0, every file under the
 * data directory (bytes, WAL included), every line the server printed through console.*, and every answer body. Returns where it
 * was found ([] = nowhere). Use with a value that cannot occur by chance (PLANTED's digits).
 */
export function searchEverywhere(planted: string, ctx: { store: Store; projectId: string; dataDir: string; printed: string[]; answers: string[] }): string[] {
  const hits: string[] = [];
  const tables = ctx.store.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[];
  for (const { name } of tables) if (JSON.stringify(ctx.store.db.prepare(`SELECT * FROM "${name}"`).all()).includes(planted)) hits.push(`table ${name}`);
  if (JSON.stringify(ctx.store.eventsSince(ctx.projectId, 0)).includes(planted)) hits.push('events');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.isFile() ? [path.join(d, e.name)] : []));
  for (const f of walk(ctx.dataDir)) if (fs.readFileSync(f).includes(Buffer.from(planted))) hits.push(`file ${path.relative(ctx.dataDir, f)}`);
  if (ctx.printed.some((l) => l.includes(planted))) hits.push('server output');
  if (ctx.answers.some((a) => a.includes(planted))) hits.push('an answer');
  return hits;
}

const printed: string[] = [];
beforeAll(() => {
  for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { printed.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-picmodels-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 29, speechPython: null, voicePython: null, backupDir: null, toolsPython: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  const presence = new Presence();
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  fullGrant = gov.createGrant({ name: 'full', mode: 'edit', people: 'full' }, OWNER).token;
  proposeGrant = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
  pid = store.createProject({ name: 'eyes', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('eyes: the owner\'s own session only', () => {
  for (const [name, who] of AGENTS) {
    it(`${name}: 403 owner_required before the body is read (an invalid body and a non-JSON body both get 403)`, async () => {
      const jobs = store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number };
      for (const r of [
        await rest(who, 'POST', `/api/v1/projects/${pid}/eyes/propose`, { assetId: 'a', frame: null }),
        await rest(who, 'POST', `/api/v1/projects/${pid}/eyes/propose`, { nonsense: true, frame: -1 }),
        await rest(who, 'POST', `/api/v1/projects/${pid}/eyes/propose`, undefined, 'not json'),
        await rest(who, 'POST', '/api/v1/projects/no-such-project/eyes/propose', { assetId: 'a', frame: null }),
      ]) expect([r.status, r.body?.error?.code]).toEqual([403, 'owner_required']);
      expect(store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual(jobs);
    });
  }
  it('the owner\'s session: a bad body is 400 without echoing it; a good one is 501 eyes_not_built until W1 builds it', async () => {
    const bad = await rest(owner, 'POST', `/api/v1/projects/${pid}/eyes/propose`, { assetId: 'a', frame: null, box: [PLANTED] });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain(String(PLANTED));
    if (PICMODELS_SERVER_BUILT) return;
    const r = await rest(owner, 'POST', `/api/v1/projects/${pid}/eyes/propose`, { assetId: 'a', frame: null });
    expect([r.status, r.body?.error?.code]).toEqual([501, 'eyes_not_built']);
  });
  it('no MCP tool of this track exists', async () => {
    const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...bearer(() => auth.tokens.agent)(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }));
    const text = await r.text();
    const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
    const names: string[] = msg.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBeGreaterThan(10);
    // the living-picture track's ops work on a depth the owner DRAWS (set_clip_depth, set_living_picture): not this track's model tools
    const drawnDepthOps = new Set(['set_clip_depth', 'set_living_picture']);
    for (const n of names.filter((x) => !drawnDepthOps.has(x))) expect(n, n).not.toMatch(/eye|picture_model|face|depth|matte/i);
  });
});

describe('GET /api/v1/picture-models', () => {
  it('the owner gets every row with its sentence; no-store', async () => {
    const r = await rest(owner, 'GET', '/api/v1/picture-models');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.body.models.map((m: any) => m.id)).toEqual([...PICTURE_MODEL_IDS]);
    for (const m of r.body.models) { expect(m.detail).toMatch(/\w/); expect(JSON.stringify(m)).not.toMatch(/[\\/]/); }
  });
  for (const [name, who] of AGENTS) {
    it(`${name}: codes and numbers only, never the yunet row`, async () => {
      const r = await rest(who, 'GET', '/api/v1/picture-models');
      expect(r.status).toBe(200);
      expect(r.body.models.map((m: any) => m.id)).not.toContain('yunet');
      expect(JSON.stringify(r.body)).not.toMatch(/yunet|eyes|face/i);
      for (const m of r.body.models) expect(Object.keys(m).sort()).toEqual(['code', 'device', 'id', 'missingBytes', 'output']);
    });
  }
});

describe('eyes: nothing is stored (the privacy rule; stays when built)', () => {
  it('after every call by everyone, the planted value is in no table, event, file, printed line or answer', async () => {
    for (const [, who] of [...AGENTS, ['owner', owner] as [string, Who]]) {
      await rest(who, 'POST', `/api/v1/projects/${pid}/eyes/propose`, { assetId: String(PLANTED), frame: null });
      await rest(who, 'POST', `/api/v1/projects/${pid}/eyes/propose`, { assetId: 'a', frame: null, u: PLANTED });
    }
    // until W1 every answer is a refusal: none may echo the planted value
    expect(searchEverywhere(String(PLANTED), { store, projectId: pid, dataDir: dir, printed, answers })).toEqual([]);
  });
});

// W1 (server runtime + eyes route + the labelled fake adapter) makes these pass; named after the proof's checks
describe('eyes worker launcher (W1): one process per request, killed on abort, nothing stored, no raw error text in a log', () => {
  it.todo('E7: around 20 proposals whose fake answers carry PLANTED: searchEverywhere finds it only in the owner\'s answers (tables, events, job rows, every file of the data and tmp folders, server output)');
  it.todo('E7: the counts of rows in jobs, transactions, outbox and derivatives are unchanged; no file under the data or tmp folder was created or grew (WAL compared after a checkpoint)');
  it.todo('E10: aborting the request (client gone) SIGKILLs the worker process: its pid is gone within 1 s, nothing is answered afterwards, and the next request starts a fresh process');
  it.todo('E10: after each answer the worker process has exited (no kept worker; PF_TOOLS_KEEP_SECONDS has no effect on eyes)');
  it.todo('E11: the fake answering a box, a score, a third point, u = 1.2, NaN or a count beside the faces is 502 eyes_engine_failed, the planted value is in no printed line and no answer');
  it.todo('E11: a crash, a non-JSON line, an exit before the line and the timeout are each 502 eyes_engine_failed with details of codes and integers only; console.error saw no ZodError, SyntaxError or worker text');
  it.todo('C9: nine drawn faces answer outcome too_many with faces [] (the worker line tooMany: true carried no point)');
  it.todo('a second request while one runs is 429 eyes_busy');
  it.todo('the job table has no eyes row ever: no job type for eyes exists (grep of the server for a job type string)');
});
describe('picture-model setup (W1): ledger-only lookup', () => {
  it.todo('R1: licence not allowed → licence_blocked; changed worker byte → engine_unverified; PF_TOOLS_PYTHON unset → engine_not_configured; the fake with --missing onnxruntime → engine_not_working naming onnxruntime; library unset / item absent / other sha in the ledger / size off by one → model_missing with the exact bytes; ready says cpu');
  it.todo('R2: the right file at the right path but absent from the ledger is model_missing; a ledger item that links out of its folder is model_missing and nothing outside is opened');
  it.todo('the owner\'s detail sentences hold no path and no file name; an agent\'s rows hold five keys and no yunet row in every state');
});
