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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { PICMODELS_SERVER_BUILT, PICTURE_TEST_ADAPTER_LABEL } from './contract.ts';
import { startServer, type RunningServer } from '../index.ts';
import { EXIF_FACE, makeExifStill, makePicmodelsFixtures, type PicmodelsFixtures } from '../../../../packages/evals/src/picmodels-fixtures.ts';
import { makePicWorld, pidsRunning, pythonPath, type PicWorld } from './testWorld.ts';

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

// W1: the server runtime and the eyes route through a real server (startServer port 0) with the LABELLED fake worker, its digest,
// a synthetic registry and library (testWorld.ts), and the synthetic drawn faces of packages/evals/src/picmodels-fixtures.ts.
describe.skipIf(!pythonPath() || !hasFfmpeg())('eyes through a real server with the labelled fake (W1)', () => {
  let s: RunningServer, w: PicWorld, fx: PicmodelsFixtures, cookie = '', spid = '';
  const ids: Record<string, string> = {};
  const fxDir = () => path.join(w.root, 'fixtures');
  const ownerH = () => ({ cookie, origin: s.url, 'content-type': 'application/json', connection: 'close' });
  const post = async (body: unknown, opts: { signal?: AbortSignal; headers?: Record<string, string> } = {}) => {
    const r = await fetch(`${s.url}/api/v1/projects/${spid}/eyes/propose`, { method: 'POST', headers: opts.headers ?? ownerH(), body: JSON.stringify(body), ...(opts.signal ? { signal: opts.signal } : {}) });
    const text = await r.text();
    answers.push(text);
    return { status: r.status, cache: r.headers.get('cache-control'), body: JSON.parse(text) as any };
  };
  const ask = (name: string, frame: number | null = null) => post({ assetId: ids[name], frame });
  const near = (p: { u: number; v: number }, x: number, y: number, W: number, H: number) => Math.hypot(p.u * W - x, p.v * H - y);
  const waitFor = async (cond: () => boolean, ms: number) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 20)); return cond(); };
  const counts = () => Object.fromEntries(['jobs', 'transactions', 'outbox', 'derivatives'].map((t) => [t, (s.store.db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n]));
  const files = () => { s.store.db.pragma('wal_checkpoint(TRUNCATE)'); const out: Record<string, number> = {}; const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile()) out[path.relative(s.cfg.dataDir, f)] = fs.statSync(f).size; } }; walk(s.cfg.dataDir); return out; };

  beforeAll(async () => {
    w = makePicWorld();
    fx = makePicmodelsFixtures(fxDir());
    const exif6 = makeExifStill(fxDir(), 'exif6.jpg', 6, 640, 480, [EXIF_FACE]);
    const exif3 = makeExifStill(fxDir(), 'exif3.jpg', 3, 640, 480, [EXIF_FACE]);
    s = await startServer({ port: 0, dataDir: path.join(w.root, 'data'), toolsPython: w.python, libraryDir: null, backupDir: null, speechPython: null, voicePython: null }, { picmodelsTest: w.seams });
    cookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner, connection: 'close' } })).headers.get('set-cookie')!.split(';')[0]!;
    spid = (await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: ownerH(), body: JSON.stringify({ name: 'eyes', width: 640, height: 360 }) })).json() as any).project.id;
    for (const [name, file] of [...Object.entries(fx.stills).map(([k, v]) => [k, v.file] as const), ['video', fx.video.file] as const, ['exif6', exif6.file] as const, ['exif3', exif3.file] as const]) {
      const r = await fetch(`${s.url}/api/v1/projects/${spid}/assets`, { method: 'POST', headers: { cookie, origin: s.url, 'x-filename': path.basename(file), connection: 'close' }, body: new Uint8Array(fs.readFileSync(file)) });
      const j = await r.json() as any;
      expect(r.status, `${name}: ${JSON.stringify(j).slice(0, 200)}`).toBe(201);
      ids[name] = j.assetId;
    }
    await s.derivatives.idle();
  }, 120_000);
  afterAll(async () => { delete process.env.PF_FAKE_PICTURE_MODE; await s?.close(); fs.rmSync(w.root, { recursive: true, force: true }); });
  afterEach(() => { delete process.env.PF_FAKE_PICTURE_MODE; });

  it('E2/E5/E12: one face at its drawn place, none for no face or a lone square, too_many with no point for nine; no-store, labelled', async () => {
    const one = await ask('one');
    expect([one.status, one.cache, one.body.outcome, one.body.faces.length, one.body.method]).toEqual([200, 'no-store', 'faces', 1, PICTURE_TEST_ADAPTER_LABEL]);
    const f = fx.stills.one.faces[0]!;
    expect(near(one.body.faces[0].eyes[0], f.a.x, f.a.y, 640, 480)).toBeLessThan(1.5);
    expect(near(one.body.faces[0].eyes[1], f.b.x, f.b.y, 640, 480)).toBeLessThan(1.5);
    expect(Object.keys(one.body).sort()).toEqual(['faces', 'method', 'outcome']);
    for (const name of ['none', 'decoy']) expect((await ask(name)).body).toEqual({ outcome: 'none', faces: [], method: PICTURE_TEST_ADAPTER_LABEL });
    expect((await ask('nine')).body).toEqual({ outcome: 'too_many', faces: [], method: PICTURE_TEST_ADAPTER_LABEL });
  }, 120_000);
  it('two faces are sorted by position (left to right), never by anything else', async () => {
    const r = await ask('two');
    expect(r.body.faces).toHaveLength(2);
    const mids = r.body.faces.map((x: any) => (x.eyes[0].u + x.eyes[1].u) / 2);
    expect(mids[0]).toBeLessThan(mids[1]);
    expect(Math.round(mids[0] * 640)).toBe(181);
  }, 120_000);
  it('E3: EXIF-6 and EXIF-3 JPEGs answer at the SHOWN positions', async () => {
    for (const name of ['exif6', 'exif3']) {
      const r = await ask(name);
      expect(r.body.outcome, name).toBe('faces');
      expect(near(r.body.faces[0].eyes[0], EXIF_FACE.a.x, EXIF_FACE.a.y, 640, 480), name).toBeLessThan(1.5);
      expect(near(r.body.faces[0].eyes[1], EXIF_FACE.b.x, EXIF_FACE.b.y, 640, 480), name).toBeLessThan(1.5);
    }
  }, 120_000);
  it('E6: move.mp4 frame 12 answers frame 12\'s drawn positions, not frame 0\'s; frame rules refuse with their codes', async () => {
    const r = await ask('video', 12);
    const e = fx.video.eyesAt(12);
    expect(near(r.body.faces[0].eyes[0], e.a.x, e.a.y, 640, 360)).toBeLessThan(1.5);
    expect(near(r.body.faces[0].eyes[1], e.b.x, e.b.y, 640, 360)).toBeLessThan(1.5);
    expect([(await ask('video', null)).status, (await ask('video', 24)).body.error.code, (await ask('one', 0)).body.error.code, (await post({ assetId: 'no-such', frame: null })).status]).toEqual([400, 'out_of_bounds', 'invalid_args', 404]);
  }, 120_000);
  it('C9: nine drawn faces answer too_many with faces [] (the worker line tooMany: true carried no point)', async () => {
    const r = await ask('nine');
    expect(r.body).toEqual({ outcome: 'too_many', faces: [], method: PICTURE_TEST_ADAPTER_LABEL });
  }, 120_000);
  it('E8: agent credentials get 403 owner_required before anything; their /picture-models has no yunet row in the ready state', async () => {
    const full = s.governance.createGrant({ name: 'full', mode: 'edit', people: 'full' }, OWNER).token;
    for (const token of [s.auth.tokens.agent, full]) {
      const r = await post({ nonsense: 1 }, { headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', connection: 'close' } });
      expect([r.status, r.body.error.code]).toEqual([403, 'owner_required']);
      const m = await (await fetch(`${s.url}/api/v1/picture-models`, { headers: { authorization: `Bearer ${token}`, connection: 'close' } })).json() as any;
      expect(JSON.stringify(m)).not.toMatch(/yunet|eyes|face/i);
    }
    const mine = await (await fetch(`${s.url}/api/v1/picture-models`, { headers: ownerH() })).json() as any;
    expect(mine.models[0]).toMatchObject({ id: 'yunet', code: 'ready', device: 'cpu' });
    expect(mine.built).toBe(true);
  }, 120_000);
  it('E11: a box, a score, a landmark, a count, a third point, u = 1.2, NaN, a crash, a non-JSON line and an early exit are each 502 eyes_engine_failed with codes and integers only; nothing printed', async () => {
    const before = printed.length;
    for (const mode of ['box', 'score', 'landmark', 'count', 'third', 'outside', 'nan', 'garbage', 'crash', 'exit-early']) {
      process.env.PF_FAKE_PICTURE_MODE = mode;
      const r = await ask('one');
      expect([r.status, r.body.error?.code], mode).toEqual([502, 'eyes_engine_failed']);
      for (const v of Object.values(r.body.error.details ?? {})) expect(['string', 'number'].includes(typeof v) && !/\s/.test(String(v)), `${mode} ${String(v)}`).toBe(true);
      expect(JSON.stringify(r.body), mode).not.toMatch(/Traceback|fake crash|not json|ZodError|SyntaxError|boxes|scores/);
    }
    expect(printed.slice(before)).toEqual([]);
  }, 120_000);
  it('a second request while one runs is 429 eyes_busy', async () => {
    process.env.PF_FAKE_PICTURE_MODE = 'slow';
    const ac = new AbortController();
    const first = post({ assetId: ids.one, frame: null }, { signal: ac.signal }).catch(() => null);
    expect(await waitFor(() => pidsRunning(w.worker).length === 1, 10_000)).toBe(true);
    const second = await ask('one');
    expect([second.status, second.body.error.code]).toEqual([429, 'eyes_busy']);
    ac.abort();
    await first;
    expect(await waitFor(() => pidsRunning(w.worker).length === 0, 1000)).toBe(true);
  }, 120_000);
  it('E10: aborting the request (client gone) SIGKILLs the worker within 1 s; nothing is answered afterwards; the next request starts a fresh process', async () => {
    process.env.PF_FAKE_PICTURE_MODE = 'slow';
    const ac = new AbortController();
    const first = post({ assetId: ids.one, frame: null }, { signal: ac.signal }).then(() => 'answered', () => 'aborted');
    expect(await waitFor(() => pidsRunning(w.worker).length === 1, 10_000)).toBe(true);
    const [pid] = pidsRunning(w.worker);
    ac.abort();
    expect(await first).toBe('aborted');
    expect(await waitFor(() => pidsRunning(w.worker).length === 0, 1000)).toBe(true);
    expect(fs.existsSync(`/proc/${pid}/cmdline`) && fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(w.worker)).toBe(false);
    delete process.env.PF_FAKE_PICTURE_MODE;
    const next = await ask('one');
    expect(next.body.outcome).toBe('faces');
  }, 120_000);
  it('E10: after each answer the worker process has exited (no kept worker; PF_TOOLS_KEEP_SECONDS has no effect on eyes)', async () => {
    expect(s.cfg.toolsKeepSeconds).toBeGreaterThan(0);
    for (let k = 0; k < 3; k++) { expect((await ask('one')).status).toBe(200); expect(await waitFor(() => pidsRunning(w.worker).length === 0, 1000)).toBe(true); }
  }, 120_000);
  it('E7: around 20 proposals whose fake answers carry PLANTED: the answered values are only in the owner\'s answers; the worker\'s raw value is nowhere; row counts unchanged and no file of the data or tmp folder was created or grew', async () => {
    await s.derivatives.idle();
    const rows0 = counts(), files0 = files(), printed0 = printed.length;
    process.env.PF_FAKE_PICTURE_MODE = 'planted';
    const said: string[] = [];
    for (let k = 0; k < 20; k++) {
      const r = await ask(k % 2 ? 'one' : 'two');
      expect(r.status).toBe(200);
      for (const f of r.body.faces) for (const p of f.eyes) said.push(String(p.u));
    }
    delete process.env.PF_FAKE_PICTURE_MODE;
    expect(said.length).toBeGreaterThanOrEqual(60);
    const ctx = { store: s.store, projectId: spid, dataDir: s.cfg.dataDir, printed: printed.slice(printed0), answers };
    for (const u of new Set(said)) expect(searchEverywhere(u, ctx), u).toEqual(['an answer']);
    expect(searchEverywhere(String(PLANTED).slice(2), { ...ctx, answers: [] })).toEqual([]);
    expect(counts()).toEqual(rows0);
    const files1 = files();
    for (const [f, n] of Object.entries(files1)) expect(n, f).toBeLessThanOrEqual(files0[f] ?? -1);
  }, 120_000);
  it('the job table has no eyes row ever: no job type for eyes exists in the server', async () => {
    const types = (s.store.db.prepare('SELECT DISTINCT type FROM jobs').all() as { type: string }[]).map((r) => r.type);
    for (const t of types) expect(t).not.toMatch(/eye|face|picture.?model/i);
    const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path.join(d, e.name)] : []));
    for (const f of walk(src)) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/(createJob|enqueue|insertJob)\([^)]*['"`]eyes?\b|type:\s*['"`]eyes?['"`]/);
    const runtime = fs.readFileSync(path.join(src, 'picmodels', 'runtime.ts'), 'utf8') + fs.readFileSync(path.join(src, 'picmodels', 'eyes.ts'), 'utf8') + fs.readFileSync(path.join(src, 'toolsWorker.ts'), 'utf8');
    expect(runtime).not.toMatch(/console\.|createJob|store\.commit|writeFile|appendFile|events\.emit/);
  }, 120_000);
});

function hasFfmpeg(): boolean { try { execFileSync('ffmpeg', ['-version']); return true; } catch { return false; } }
