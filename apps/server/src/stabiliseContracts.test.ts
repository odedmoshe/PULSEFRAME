/**
 * The server contract of stabilisation (wave 7 stabilise track; stabilise.ts), through the real app and the real MCP handler,
 * before W1: both routes are registered, documented and classified; scopes hold before anything else; every entry point answers
 * the honest 501 stabilise_not_built and stores nothing; cancel dispatches the new job type; recovery ends a stray row honestly;
 * the analysis read view never sends the camera columns; the tracking route counts camera samples in the shared budget.
 * The it.todo rows name what W1 must make pass (and STABILISE_JOBS_BUILT turns the 501 rows off).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, MAX_STEADY_SAMPLES, SST, STABILISE_JOB_TYPE, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { analysisViewOf, createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { recoverStabiliseJobs, STABILISE_JOBS_BUILT, STABILISE_SERVER_REFUSALS } from './stabilise.ts';
import { Store } from './store.ts';
import { trackingRange } from './tracking.ts';

const ROUTES = ['POST /api/v1/projects/:id/clips/:clipId/stabilise', 'GET /api/v1/projects/:id/assets/:assetId/camera-motion'] as const;
let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let ownerCookie = '', pid = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer);
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as any) : null };
};
let rpcId = 0;
async function tool(who: Who, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  return { isError: !!msg.result?.isError, text: String(msg.result.content[0].text) };
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-stabilise-contract-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 24, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), new Presence(), mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  pid = store.createProject({ name: 'stabilise contract' }).doc.id;
});
afterAll(async () => {
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the stabilise routes are registered, documented and classified', () => {
  it('both routes are in OpenAPI and in the people-surface table; the two MCP tools are classified', () => {
    const doc = buildOpenApi() as { paths: Record<string, Record<string, unknown>> };
    for (const route of ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      expect({ route, documented: !!doc.paths[p.replace(/:(\w+)/g, '{$1}')]?.[method.toLowerCase()] }).toEqual({ route, documented: true });
      expect({ route, classified: route in PEOPLE_REST_SURFACES }).toEqual({ route, classified: true });
    }
    expect(PEOPLE_MCP_TOOLS.stabilise_clip).toEqual(['reader-document', 'write']);
    expect(PEOPLE_MCP_TOOLS.get_camera_motion).toEqual(['reader-document']);
  });
});

describe.skipIf(STABILISE_JOBS_BUILT)('before W1: scopes first, then the honest 501', () => {
  it('an observer cannot start a measurement (403); the owner and an agent get 501 stabilise_not_built with the fixed sentence', async () => {
    expect((await rest(observer, 'POST', `/api/v1/projects/${pid}/clips/clp_none/stabilise`, {})).status).toBe(403);
    for (const who of [owner, agent]) {
      const r = await rest(who, 'POST', `/api/v1/projects/${pid}/clips/clp_none/stabilise`, { strength: 50 });
      expect({ status: r.status, code: r.body?.error?.code, message: r.body?.error?.message }).toEqual({ status: 501, code: 'stabilise_not_built', message: STABILISE_SERVER_REFUSALS.notBuilt.message() });
    }
    expect((await rest(owner, 'POST', `/api/v1/projects/${pid}/clips/clp_none/stabilise`, { strength: 0 })).status).toBe(400);
  });
  it('the read view answers 404 for a file that is not there and nothing else', async () => {
    expect((await rest(observer, 'GET', `/api/v1/projects/${pid}/assets/ast_none/camera-motion`)).status).toBe(404);
  });
  it('MCP stabilise_clip and get_camera_motion answer stabilise_not_built or not_found; nothing was stored', async () => {
    const before = store.getProject(pid).revision;
    const s = await tool(agent, 'stabilise_clip', { projectId: pid, clipId: 'clp_none' });
    expect([s.isError, s.text.includes('stabilise_not_built')]).toEqual([true, true]);
    const g = await tool(agent, 'get_camera_motion', { projectId: pid, assetId: 'ast_none' });
    expect(g.isError).toBe(true);
    expect(store.getProject(pid).revision).toBe(before);
    expect(store.openJobs(STABILISE_JOB_TYPE)).toEqual([]);
  });
  it('cancel dispatches the stabilise job type (REST and MCP); recovery ends a stray row honestly', async () => {
    const j = store.createJob(pid, STABILISE_JOB_TYPE, 'user:local', {});
    expect((await rest(owner, 'POST', `/api/v1/jobs/${j.id}/cancel`)).body?.error?.code).toBe('stabilise_not_built');
    expect((await tool(owner, 'cancel_job', { jobId: j.id })).text).toContain('stabilise_not_built');
    expect(recoverStabiliseJobs(store)).toBe(0);
    expect([store.getJob(j.id).status, (store.getJob(j.id).error as { code?: string })?.code]).toEqual(['failed', 'stabilise_not_built']);
  });
});

const R = { num: 30, den: 1 };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `sc${n++}_`, actor: 'test', allowInternal });
const video = (frames: number, k: number) => ({ kind: 'video' as const, name: `v${k}.mp4`, contentHash: `sha256:${String(k).repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, R), video: { width: 1280, height: 720, frameRate: R, codec: 'h264', rotation: 0, frameCount: frames }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' } });
const cols = (len: number) => ({ dx: Array(len).fill(1), dy: Array(len).fill(1), dr: Array(len).fill(1), dz: Array(len).fill(1), st: [SST.start, ...Array(len - 1).fill(SST.ok)] });

describe('shared surfaces', () => {
  it('get_analysis / GET …/analysis never send the camera columns', () => {
    let doc = createProject({ id: 'prj_v', name: 'V', width: 1280, height: 720 });
    const r = tx(doc, [{ op: 'import_asset', args: { asset: video(300, 1) } }], true);
    const assetId = r.results[0]!.output!.assetId as string;
    doc = tx(r.doc, [{ op: 'attach_camera_motion', args: { assetId, from: 0, ...cols(200), method: 'test', params: { algo: 1, input: 'proxy' }, createdAt: 'x' } }], true).doc;
    doc.analyses[assetId] = { ...doc.analyses[assetId]!, scenes: { origin: { method: 't', params: {}, createdAt: 'x', createdBy: 't', edited: false }, cuts: [T.frameTime(10, R)] } };
    const view = JSON.stringify(analysisViewOf(doc, assetId));
    expect(view).toContain('cuts');
    expect(view).not.toMatch(/cameraMotion|"dx"|stretches/);
  });
  it('a tracking job is refused before it starts when camera samples fill the shared budget', () => {
    let doc = createProject({ id: 'prj_t', name: 'T', width: 1280, height: 720 });
    const ids: string[] = [];
    for (let k = 1; k <= 5; k++) { const r = tx(doc, [{ op: 'import_asset', args: { asset: video(MAX_STEADY_SAMPLES, k) } }], true); doc = r.doc; ids.push(r.results[0]!.output!.assetId as string); }
    for (const id of ids.slice(0, 4)) doc = tx(doc, [{ op: 'attach_camera_motion', args: { assetId: id, from: 0, ...cols(MAX_STEADY_SAMPLES - 1), method: 'test', params: {}, createdAt: 'x' } }], true).doc;
    const c = tx(doc, [{ op: 'create_motion_track', args: { assetId: ids[4], kind: 'point', frame: 0, x: 1, y: 1 } }]);
    const id = c.results[0]!.output!.motionTrackId as string;
    let msg = '';
    try { trackingRange(c.doc, c.doc.motionTracks[id]!, c.doc.assets[ids[4]!]!, { from: 0, to: 10 }); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/motion tracks and camera measurements would hold \d+ samples; at most 43200/);
  });
});

describe('what W1 makes pass', () => {
  it.todo('W1: 202 + one transaction [attach_camera_motion, set_clip_stabilise] with dependsOn; one undo returns the document');
  it.todo('W1: clipTooLong, fileFull and budget refused (422) before 202; 409 stabilise_in_progress; 429 busy above five open vision jobs');
  it.todo('W1: clip deleted mid-run → failed clip_changed, document unchanged; set_clip_stabilise refused → failed with its refusal and details');
  it.todo('W1: cancel mid-run → canceled, ffmpeg gone, nothing attached; restart mid-run → runs again and attaches once; shutdown leaves the row running');
  it.todo('W1: frames already measured with the same algo and input are not read again (a second clip of the same file)');
  it.todo('W1: GET …/camera-motion = MCP get_camera_motion: counts, review runs, usedBy, note; never the columns');
});
