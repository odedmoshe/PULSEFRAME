/**
 * Lead contracts of track cover on the server (wave 8 pre-pass, turned to the built behaviour at integration): after the scope,
 * body and project checks the sharpest-frame routes and MCP tools start a job (202) or read what is stored (numbers only); a saved picture (`still`) is refused 403
 * owner_required for every credential but the owner's own session, at every route that starts or retries an export; the option
 * rules of a still are blockers; the browser route refuses a still; the options of older jobs parse as before; both tools are in
 * the people tables and answer numbers only. What W1 and W2 build is tested in stills.test.ts, stills.math.test.ts and
 * stillExport.test.ts (theirs). The seeded file has no bytes, so a started job is stopped here before it reads.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { STILL_EXPORT_BUILT, STILLS_LABEL, STILLS_MEASURE_BUILT, STILLS_REFUSALS } from '@pulseframe/core';
import { cancelStillsJob, stopStillsJobs } from './stills.ts';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter, ExportOptionsSchema, stillOptionBlockers } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

const R = { num: 30, den: 1 };
let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives, ownerCookie: string;
const base = () => `http://127.0.0.1:${cfg.port}`;
const bearer = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const owner = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body: unknown, headers: Record<string, string>) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
};
let rpc = 0;
const tool = async (name: string, args: Record<string, unknown>, t: string) => {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...bearer(t), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, content: msg.result.content as { type: string; text?: string }[], text: msg.result.content[0].text as string };
};
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: prov };
function seed(name: string) {
  const pid = store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
  const r = store.commit({ projectId: pid, actor: 'test', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: video } }] });
  const assetId = r.results[0]!.output!.assetId as string;
  const c = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId, start: T.ZERO, duration: T.frameTime(60, R) } }] });
  return { pid, assetId, clipId: c.results[0]!.output!.clipId as string };
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-stills-contracts-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  const gov = new Governance(store);
  auth.resolveGrant = (t) => gov.principalForToken(t);
  const speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
});
afterAll(async () => {
  await stopStillsJobs(store);
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('cover: the sharpest-frame routes and tools (wave 8 pre-pass)', () => {
  it('POST …/stills: 400 for a bad body, 404 for an unknown project, 403 for the observer, then 202 with a job; a second job in the project is 409', async () => {
    const s = seed('find');
    const agent = bearer(auth.tokens.agent);
    expect((await rest('POST', `/projects/${s.pid}/stills`, { assetId: s.assetId }, agent)).status).toBe(400); // neither clip nor stretch
    expect((await rest('POST', `/projects/${s.pid}/stills`, { assetId: s.assetId, clipId: s.clipId, from: 0, to: 10 }, agent)).status).toBe(400);
    expect((await rest('POST', `/projects/${s.pid}/stills`, { assetId: s.assetId, from: 0 }, agent)).status).toBe(400);
    expect((await rest('POST', `/projects/${s.pid}/stills`, { assetId: s.assetId, clipId: s.clipId, extra: 1 }, agent)).status).toBe(400);
    expect((await rest('POST', `/projects/prj_none/stills`, { assetId: s.assetId, clipId: s.clipId }, agent)).status).toBe(404);
    expect((await rest('POST', `/projects/${s.pid}/stills`, { assetId: s.assetId, clipId: s.clipId }, bearer(auth.tokens.observer))).status).toBe(403);
    const r = await rest('POST', `/projects/${s.pid}/stills`, { assetId: s.assetId, clipId: s.clipId }, agent);
    expect(STILLS_MEASURE_BUILT).toBe(true);
    expect(r.status).toBe(202);
    expect(r.body.jobId).toMatch(/^job_/);
    const again = await rest('POST', `/projects/${s.pid}/stills`, { assetId: s.assetId, clipId: s.clipId }, agent);
    expect([again.status, again.body.error.code, again.body.error.details.jobId]).toEqual([409, 'stills_in_progress', r.body.jobId]);
    cancelStillsJob(store, r.body.jobId, 'test');
  });
  it('GET …/stills: 400 for a bad query, 404 for an unknown project, then a SharpAnswer of what is stored (the observer may read)', async () => {
    const s = seed('read');
    const obs = bearer(auth.tokens.observer);
    expect((await rest('GET', `/projects/${s.pid}/stills?assetId=${s.assetId}&from=x&to=3`, undefined, obs)).status).toBe(400);
    expect((await rest('GET', `/projects/${s.pid}/stills?assetId=${s.assetId}`, undefined, obs)).status).toBe(400);
    expect((await rest('GET', `/projects/prj_none/stills?assetId=${s.assetId}&from=0&to=3`, undefined, obs)).status).toBe(404);
    const r = await rest('GET', `/projects/${s.pid}/stills?assetId=${s.assetId}&from=0&to=3`, undefined, obs);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ assetId: s.assetId, from: 0, to: 3, measuredFrames: 0, complete: false, median: null, candidates: [], frames: [], heuristic: true, label: { he: STILLS_LABEL.he, en: STILLS_LABEL.en } });
  });
  it('MCP find_sharp_frames starts a job and read_sharp_frames reads the stored numbers, as text only (no image part)', async () => {
    const s = seed('mcp');
    const f = await tool('find_sharp_frames', { projectId: s.pid, assetId: s.assetId, clipId: s.clipId }, auth.tokens.agent);
    const g = await tool('read_sharp_frames', { projectId: s.pid, assetId: s.assetId, from: 0, to: 3 }, auth.tokens.observer);
    for (const r of [f, g]) {
      expect(r.content.every((c) => c.type === 'text')).toBe(true);
      expect(r.isError, r.text).toBe(false);
    }
    expect(JSON.parse(f.text).jobId).toMatch(/^job_/);
    expect(JSON.parse(g.text)).toMatchObject({ measuredFrames: 0, complete: false, heuristic: true });
    cancelStillsJob(store, JSON.parse(f.text).jobId, 'test');
    expect((await tool('find_sharp_frames', { projectId: s.pid, assetId: s.assetId, clipId: s.clipId }, auth.tokens.observer)).isError).toBe(true); // needs edit
  });
  it('both tools and both routes are in the people tables as reader-document', () => {
    expect(PEOPLE_MCP_TOOLS.find_sharp_frames).toEqual(['reader-document']);
    expect(PEOPLE_MCP_TOOLS.read_sharp_frames).toEqual(['reader-document']);
    expect(PEOPLE_REST_SURFACES['POST /api/v1/projects/:id/stills']).toEqual(['reader-document']);
    expect(PEOPLE_REST_SURFACES['GET /api/v1/projects/:id/stills']).toEqual(['reader-document']);
  });
});

describe('cover: the saved picture (export option still)', () => {
  const still = (assetId: string) => ({ format: 'png', still: { assetId, sourceFrame: 12 } });
  it('older options parse as before; still is strict; paper and orientation come together', () => {
    expect('still' in ExportOptionsSchema.parse({})).toBe(false);
    expect(ExportOptionsSchema.parse({ format: 'jpeg', still: { assetId: 'a', sourceFrame: 0 } }).format).toBe('jpeg');
    expect(ExportOptionsSchema.safeParse({ still: { assetId: 'a', sourceFrame: 0, extra: 1 } }).success).toBe(false);
    expect(ExportOptionsSchema.safeParse({ still: { assetId: 'a', sourceFrame: 0, paper: 'a4' } }).success).toBe(false);
    expect(ExportOptionsSchema.safeParse({ still: { assetId: 'a', sourceFrame: 0, crop: { x: 0, y: 0, w: 15, h: 20 } } }).success).toBe(false);
    expect(ExportOptionsSchema.safeParse({ still: { assetId: 'a', sourceFrame: 0, paper: 'a4', orientation: 'landscape', crop: { x: 3, y: 1, w: 1527, h: 1080 } } }).success).toBe(true);
  });
  it('the option rules are blockers with their wording and hint', () => {
    const o = (x: Record<string, unknown>) => stillOptionBlockers(ExportOptionsSchema.parse(x)).filter((b) => b.code !== 'still_not_built').map((b) => [b.code, b.message]);
    expect(o({ format: 'jpeg' })).toEqual([['still_options', STILLS_REFUSALS.jpegNeedsStill.message()]]);
    expect(o({ format: 'mp4-h264-aac', still: { assetId: 'a', sourceFrame: 0 } })).toEqual([['still_options', STILLS_REFUSALS.stillFormat.message('mp4-h264-aac')]]);
    expect(o({ format: 'png', frame: 3, sequenceId: 's', still: { assetId: 'a', sourceFrame: 0 } })).toEqual([['still_options', STILLS_REFUSALS.stillOptions.message('frame')], ['still_options', STILLS_REFUSALS.stillOptions.message('sequenceId')]]);
    expect(o({ format: 'png', scale: 0.5, still: { assetId: 'a', sourceFrame: 0 } })).toEqual([['still_options', STILLS_REFUSALS.stillScale.message()]]);
    expect(o({ format: 'png', still: { assetId: 'a', sourceFrame: 0 } })).toEqual([]);
    expect(o({ format: 'png', frame: 3 })).toEqual([]);
    for (const b of stillOptionBlockers(ExportOptionsSchema.parse({ format: 'jpeg' }))) expect(b.hint!.length).toBeGreaterThan(10);
  });
  it('every credential but the owner\'s own session is refused 403 owner_required: REST export, batch, MCP export_project and export_batch', async () => {
    const s = seed('still-agent');
    const want = [403, 'owner_required', STILLS_REFUSALS.ownerRequired.message()];
    const r = await rest('POST', `/projects/${s.pid}/exports`, still(s.assetId), bearer(auth.tokens.agent));
    expect([r.status, r.body.error.code, r.body.error.message]).toEqual(want);
    const b = await rest('POST', `/projects/${s.pid}/exports/batch`, { items: [{}], options: { still: { assetId: s.assetId, sourceFrame: 0 } } }, bearer(auth.tokens.agent));
    expect([b.status, b.body.error.code]).toEqual([403, 'owner_required']);
    for (const [name, args] of [['export_project', { projectId: s.pid, ...still(s.assetId) }], ['export_batch', { projectId: s.pid, items: [{}], options: { still: { assetId: s.assetId, sourceFrame: 0 } } }]] as const) {
      const t = await tool(name, args, auth.tokens.agent);
      expect(t.isError, name).toBe(true);
      expect(JSON.parse(t.text).error.code, name).toBe('owner_required');
    }
    expect(store.openJobs('export').filter((j) => j.projectId === s.pid)).toEqual([]);
  });
  it('the owner\'s own session passes the owner rule; built, its still is planned as a job (here blocked only by the absent bytes and render page)', async () => {
    const s = seed('still-owner');
    const r = await rest('POST', `/projects/${s.pid}/exports`, still(s.assetId), owner());
    expect(STILL_EXPORT_BUILT).toBe(true);
    expect([r.status, r.body.error.code]).toEqual([422, 'render_blocked']);
    expect(r.body.error.details.blockers.map((x: any) => x.code).sort()).toEqual(['missing_media', 'renderer_unavailable']);
  });
  it('the browser route refuses a still (409 unsupported_in_browser_export), even for the owner', async () => {
    const s = seed('still-browser');
    const r = await rest('POST', `/projects/${s.pid}/exports/browser`, { sessionId: 'tab-session-1', ...still(s.assetId) }, owner());
    expect([r.status, r.body.error.code, r.body.error.message]).toEqual([409, 'unsupported_in_browser_export', STILLS_REFUSALS.stillBrowserRoute.message()]);
  });
});
