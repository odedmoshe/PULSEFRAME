/**
 * The in-editor agent «סוכן» (wave 8 autonomy Part 2), lead pre-pass: the routes and MCP tools answer honestly (501 agent_not_built
 * after their checks; the provider key and base URL routes are the owner floor), the additive tool changes the verifier named are
 * complete (render_frame scale and get_transcript paging, C11; idempotency keys on export, shorts, template and recipe tools, C8),
 * backups never hold the agent's folder (C12), and the todo rows the builders must make pass, named after proof:agent's checks.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { AGENT_PROVIDER_ERROR_CODES, AGENT_ROUTES, type ProjectDocument } from '@pulseframe/core';
import { AGENT_ADAPTER_ERROR_CODES } from '@pulseframe/providers';
import { Auth } from './auth.ts';
import { backupDataDir, NEVER_BACKED_UP } from './backup.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store, type JobRow } from './store.ts';
import { ensureAgentTables, runPrincipal } from './agent/contract.ts';
import { plannerToolNames, loopToolSpecs } from './agent/tools.ts';

/** Records the scale of every still and draws a 1×1 picture; starts no export worker (the job row is what idempotency is about). */
class RecordingExporter extends Exporter {
  scales: number[] = [];
  override async renderStill(_doc: ProjectDocument, _revision: number, _frameIndex: number, scale: 1 | 0.5 | 0.25 = 1): Promise<Buffer> {
    this.scales.push(scale);
    return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  }
  override enqueue(_job: JobRow) { /* no worker in this test */ }
}
let dir: string, cfg: Config, store: Store, auth: Auth, exporter: RecordingExporter, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>;
let pid = '', assetId = '', ownerCookie = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
const agentH = () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'content-type': 'application/json' });
const ownerH = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, headers: Record<string, string>, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
};
let rpcId = 0;
const rpc = async (method: string, params: unknown) => {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...agentH(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return msg.result;
};
const tool = async (name: string, args: Record<string, unknown>) => { const res = await rpc('tools/call', { name, arguments: args }); return { isError: res.isError === true, body: JSON.parse(res.content[0].text) as any, content: res.content as any[] }; };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-contracts-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  exporter = new RecordingExporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  const capabilities = new Capabilities(store, cfg), derivatives = new Derivatives(store), presence = new Presence(), gov = new Governance(store), speech = new Speech(store, cfg);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  pid = store.createProject({ name: 'agent', width: 1920, height: 1080, frameRate: { num: 30, den: 1 } }).doc.id;
  const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
  const bytes = Buffer.from('a labelled fixture: not a real recording');
  const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const tmp = path.join(store.tmpDir, 'fixture.wav'); fs.writeFileSync(tmp, bytes); store.putBlob(contentHash, tmp, bytes.length, 'audio/wav');
  const audio = { kind: 'audio' as const, name: 'voice.wav', contentHash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: prov };
  assetId = store.commit({ projectId: pid, actor: 'test', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: audio } }] }).results[0]!.output!.assetId as string;
  store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'set_transcript', args: { assetId, language: 'he', segments: [0, 1, 2, 3, 4].map((i) => ({ start: T.rt(i * 3, 1), duration: T.rt(2, 1), text: `משפט ${i}` })) } }] });
  store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'add_clip', args: { assetId, start: T.rt(0, 1), duration: T.rt(4, 1) } }] });
});
afterAll(async () => { (app as any).browserExport?.stop(); await (mcp as any).close?.(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('contract pieces', () => {
  it('the adapters\' error codes are core\'s (providers does not import core)', () => { expect([...AGENT_ADAPTER_ERROR_CODES]).toEqual([...AGENT_PROVIDER_ERROR_CODES]); });
  it('the tables are created idempotently; the run principal is an ordinary agent credential with its own actor', () => {
    const db = new Database(':memory:');
    ensureAgentTables(db); ensureAgentTables(db);
    expect((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_%' ORDER BY name").all() as any[]).map((r) => r.name)).toEqual(['agent_runs', 'agent_steps']);
    expect(runPrincipal('run_abc12345')).toEqual({ actor: 'agent:run_abc12345', kind: 'agent', scopes: ['observe', 'edit'] });
  });
  it('the planner view keeps only registered tools, then the loop\'s own three', async () => {
    const names: string[] = (await rpc('tools/list', {})).tools.map((t: any) => t.name);
    const view = plannerToolNames(names);
    expect(view.slice(-3)).toEqual(['update_plan', 'wait_for_job', 'finish']);
    expect(view).toContain('apply_transaction');
    for (const t of view.slice(0, -3)) expect(names).toContain(t);
    expect(loopToolSpecs().map((s) => (s.inputSchema as any).type)).toEqual(['object', 'object', 'object']);
  });
});

describe('routes and MCP tools: honest until built', () => {
  const fill = (p: string) => p.replace(':id', pid).replace(':runId', 'run_abcdefgh').replace(':providerId', 'anthropic');
  const bodyFor = (p: string) => (p.endsWith('/agent/runs') ? { goal: 'תחתכו את השקטים' } : p.endsWith('/undo-actor') ? { actor: 'agent:local' } : p.endsWith('/models') ? { rows: [] } : {});
  it('every run route answers 501 agent_not_built until the loop is bound; the owner floor answers 403 to an agent; run routes add no gate', async () => {
    for (const r of AGENT_ROUTES) {
      const provider = r.path.startsWith('/api/v1/agent/'); // built by W2: agentKeys.test.ts
      const a = await rest(r.method, fill(r.path), agentH(), r.method === 'GET' || r.method === 'DELETE' ? undefined : bodyFor(r.path));
      expect([r.path, a.status]).toEqual([r.path, r.who === 'owner-floor' ? 403 : provider ? 200 : 501]);
      if (provider) continue;
      const o = await rest(r.method, fill(r.path), ownerH(), r.method === 'GET' || r.method === 'DELETE' ? undefined : bodyFor(r.path));
      expect([r.path, o.status, o.body?.error?.code]).toEqual([r.path, 501, 'agent_not_built']);
    }
  });
  it('a body that does not parse is 400 before 501; an unknown provider is 404', async () => {
    expect((await rest('POST', `/api/v1/projects/${pid}/agent/runs`, ownerH(), { goal: '' })).status).toBe(400);
    expect((await rest('PUT', '/api/v1/agent/providers/nope/key', ownerH(), { key: 'k' })).body.error.code).toBe('agent_provider_unknown');
  });
  it('start_agent_run, get_agent_run and undo_actor_since are registered and answer agent_not_built', async () => {
    for (const [name, args] of [['start_agent_run', { goal: 'x' }], ['get_agent_run', { runId: 'run_abcdefgh' }], ['undo_actor_since', { actor: 'agent:local' }]] as const) {
      const r = await tool(name, { projectId: pid, ...args });
      expect([name, r.isError, r.body.error.code]).toEqual([name, true, 'agent_not_built']);
    }
  });
  it('serveAs is a door for the loop only: the object carries it, http.ts has no route to it', () => {
    expect(typeof (mcp as any).serveAs).toBe('function');
    const http = fs.readFileSync(new URL('./http.ts', import.meta.url), 'utf8');
    expect(http.includes('serveAs')).toBe(false);
  });
});

describe('C11: how the model sees', () => {
  it('render_frame takes scale 0.5 / 0.25 and says it; without it the picture is full size as before', async () => {
    exporter.scales = [];
    const a = await tool('render_frame', { projectId: pid, frameIndex: 10, scale: 0.5 });
    const b = await tool('render_frame', { projectId: pid, frameIndex: 10 });
    expect(exporter.scales).toEqual([0.5, 1]);
    expect(a.body.scale).toBe(0.5);
    expect(b.body.scale).toBeUndefined();
    expect((await rpc('tools/call', { name: 'render_frame', arguments: { projectId: pid, scale: 0.3 } })).isError).toBe(true);
  });
  it('get_transcript pages by source seconds, limits, and has a compact form; without options it answers as before', async () => {
    const whole = await tool('get_transcript', { projectId: pid, assetId });
    expect(whole.body.segments).toHaveLength(5);
    expect(whole.body.page).toBeUndefined();
    const page = await tool('get_transcript', { projectId: pid, assetId, fromSeconds: 4, limit: 2 });
    expect(page.body.segments.map((s: any) => s.text)).toEqual(['משפט 1', 'משפט 2']);
    expect(page.body.page).toMatchObject({ segments: 2, totalSegments: 5, nextFromSeconds: 9 });
    const compact = await tool('get_transcript', { projectId: pid, assetId, compact: true });
    expect(compact.body.lines).toHaveLength(5);
    expect(compact.body.lines[0]).toMatch(/^\S+ 0\.00-2\.00 משפט 0$/);
  });
});

describe('C8: idempotency keys on tools that start jobs or plan before committing', () => {
  it('export_project with a key starts one job; the resend returns it', async () => {
    const a = await tool('export_project', { projectId: pid, format: 'wav', idempotencyKey: 'run_k1.3.0' });
    expect(a.isError, JSON.stringify(a.body)).toBe(false);
    const b = await tool('export_project', { projectId: pid, format: 'wav', idempotencyKey: 'run_k1.3.0' });
    expect([b.body.jobId, b.body.replayed]).toEqual([a.body.jobId, true]);
    expect((store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'export'").get() as any).n).toBe(1);
    const c = await tool('export_project', { projectId: pid, format: 'wav' });
    expect(c.body.jobId).not.toBe(a.body.jobId);
  });
  it('export_batch with a key starts its jobs once', async () => {
    const before = (store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'export'").get() as any).n;
    const a = await tool('export_batch', { projectId: pid, items: [{}], options: { format: 'wav' }, idempotencyKey: 'run_k1.4.0' });
    expect(a.isError, JSON.stringify(a.body)).toBe(false);
    const b = await tool('export_batch', { projectId: pid, items: [{}], options: { format: 'wav' }, idempotencyKey: 'run_k1.4.0' });
    expect(b.body.jobs.map((j: any) => j.jobId)).toEqual(a.body.jobs.map((j: any) => j.jobId));
    expect((store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'export'").get() as any).n).toBe(before + 1);
  });
  it('make_shorts, apply_template and apply_recipe answer a stored commit with the key BEFORE planning (the document moved since)', async () => {
    const first = await tool('apply_transaction', { projectId: pid, idempotencyKey: 'run_k1.5.0', ops: [{ op: 'add_text', args: { text: 'שתיים', start: T.rt(2, 1), duration: T.rt(1, 1) } }] });
    expect(first.isError).toBe(false);
    store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_text', args: { text: 'אחר כך', start: T.rt(4, 1), duration: T.rt(1, 1) } }] });
    const pick = { assetId, start: T.rt(0, 1), end: T.rt(2, 1) };
    for (const [name, args] of [['apply_recipe', { recipeId: 'no-such-recipe' }], ['apply_template', { templateId: 'tpl.no-such' }], ['make_shorts', { picks: [pick] }]] as const) {
      const r = await tool(name, { projectId: pid, idempotencyKey: 'run_k1.5.0', ...args });
      expect([name, r.isError, r.body.transactionId, r.body.replayed]).toEqual([name, false, first.body.transactionId, true]);
    }
  });
  it('the key scope gives the key to the first edit commit inside it only', async () => {
    const { withCommitKey } = await import('./store.ts');
    const add = (text: string, at: number) => store.commit({ projectId: pid, actor: 'agent:scope', ops: [{ op: 'add_text', args: { text, start: T.rt(at, 1), duration: T.rt(1, 1) } }] });
    const [a, b] = withCommitKey('run_k2.1.0', () => [add('א', 6), add('ב', 7)]);
    expect(store.findTransactionByKey(pid, 'agent:scope', 'run_k2.1.0')?.transactionId).toBe(a!.transactionId);
    expect(b!.transactionId).not.toBe(a!.transactionId);
  });
});

describe('C12: backups never hold the agent folder', () => {
  it('a destination\'s agent/ folder (keys) is removed recursively; the rule lists it', async () => {
    expect(NEVER_BACKED_UP as readonly string[]).toContain('agent');
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-bk-src-')), dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-bk-')), 'copy');
    new Database(path.join(src, 'pulseframe.sqlite')).exec('CREATE TABLE projects (id TEXT)');
    fs.mkdirSync(path.join(dest, 'agent', 'keys'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'agent', 'keys', 'anthropic.key'), 'sk-test');
    await backupDataDir(src, dest);
    expect(fs.existsSync(path.join(dest, 'agent'))).toBe(false);
  });
});

// The builders' rows live in agentLoop, undoActor, agentRecover (W1) and agentKeys / agentAdapters (W2) tests; proof:agent lists all checks.
