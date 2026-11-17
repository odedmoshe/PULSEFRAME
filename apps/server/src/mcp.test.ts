/**
 * MCP tools that dispatch on job types and the tracking tools (ADR-0015), against REST twins served in-process (no port).
 * cancel_job used to send speech jobs (transcribe, narration, speech model download) to the capability canceller, which
 * refused them with cancel_not_supported while POST /jobs/:jobId/cancel cancelled them.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@pulseframe/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/core')>();
  /** LABELLED TEST DOUBLE until W1 merges (tracking wave): trackSummary counts per its contract; used only while the real one throws "not implemented yet". */
  const trackSummary: typeof real.trackSummary = (t) => {
    try { return real.trackSummary(t); } catch (e) {
      if (!/not implemented yet/.test((e as Error).message)) throw e;
      const counts = Object.fromEntries(real.TRACK_STATES.map((s) => [s, 0])) as Record<import('@pulseframe/core').TrackStateName, number>;
      for (const c of t.st) counts[real.TRACK_STATES[c]!]++;
      return { samples: t.st.length, counts, problems: [] };
    }
  };
  return { ...real, trackSummary };
});

import { ST, type MotionTrack } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { describeMedia } from './ingest.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';
import { stopTrackingJobs } from './tracking.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives, speech: Speech;
let pid = '', agentActor = '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const headers = () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
let rpcId = 0;
const rpc = async (method: string, params: unknown) => {
  const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { ...headers(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return msg.result;
};
const tool = async (name: string, args: Record<string, unknown>) => { const res = await rpc('tools/call', { name, arguments: args }); return { isError: res.isError === true, body: JSON.parse(res.content[0].text) as any }; };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-mcp-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  const presence = new Presence();
  const gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech);
  pid = store.createProject({ name: 'mcp', width: 320, height: 240, frameRate: { num: 30, den: 1 } }).doc.id;
  agentActor = auth.authenticate(new Request('http://127.0.0.1/', { headers: headers() })).actor;
});
afterAll(async () => {
  await stopTrackingJobs(store);
  (app as any).browserExport?.stop();
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('cancel_job dispatches speech jobs as POST /jobs/:jobId/cancel does', () => {
  // Rows as the speech service writes them; nothing runs, so each cancel is decided by the job's type and status alone.
  const job = (type: string, status = 'queued') => { const j = store.createJob(pid, type, agentActor, { assetId: 'ast_x', projectRevision: 0 }); if (status !== 'queued') store.updateJob(j.id, { status }); return j.id; };
  for (const type of ['transcribe', 'narration'] as const) {
    it(`${type}, queued: removed from the queue on both surfaces`, async () => {
      const viaTool = await tool('cancel_job', { jobId: job(type) });
      const viaRest = await rest('POST', `/jobs/${job(type)}/cancel`, {});
      expect(viaTool.isError, JSON.stringify(viaTool.body)).toBe(false);
      expect(viaTool.body).toMatchObject({ status: 'canceled', outcome: 'removed-from-queue' });
      expect({ ...viaTool.body, jobId: null }).toEqual({ ...viaRest.body, jobId: null });
      expect(store.getJob(viaTool.body.jobId).status).toBe('canceled');
    });
    it(`${type}, running: a stop is requested on both surfaces`, async () => {
      const viaTool = await tool('cancel_job', { jobId: job(type, 'running') });
      const viaRest = await rest('POST', `/jobs/${job(type, 'running')}/cancel`, {});
      expect(viaTool.body).toMatchObject({ status: 'cancel-requested', outcome: 'stopping' });
      expect({ ...viaTool.body, jobId: null }).toEqual({ ...viaRest.body, jobId: null });
    });
  }
  it('a speech model download is stopped; a finished job says so', async () => {
    const viaTool = await tool('cancel_job', { jobId: job('speech-model-download', 'running') });
    expect(viaTool.body).toMatchObject({ status: 'canceled', outcome: 'download-stopped' });
    const done = job('transcribe', 'succeeded');
    expect((await tool('cancel_job', { jobId: done })).body).toMatchObject({ status: 'succeeded', outcome: 'already-finished' });
  });
  it('an agent may not cancel a job someone else started, on either surface', async () => {
    const other = store.createJob(pid, 'transcribe', 'user:local', { assetId: 'ast_x', projectRevision: 0 });
    const viaTool = await tool('cancel_job', { jobId: other.id });
    expect([viaTool.isError, viaTool.body.error.code]).toEqual([true, 'not_your_job']);
    expect((await rest('POST', `/jobs/${other.id}/cancel`, {})).body.error.code).toBe('not_your_job');
    expect(store.getJob(other.id).status).toBe('queued');
  });
});

describe('motion tracking tools (ADR-0015)', () => {
  let assetId = '';
  beforeAll(async () => {
    const file = path.join(dir, 'clip.mp4');
    await new Promise<void>((resolve, reject) => { const p = spawn('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=30', '-t', '3', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', file]); p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}`)))); });
    const meta = await describeMedia(file);
    const contentHash = `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
    const copy = path.join(store.tmpDir, `in_${randomBytes(4).toString('hex')}`);
    fs.copyFileSync(file, copy);
    store.putBlob(contentHash, copy, fs.statSync(file).size, meta.mimeType);
    const r = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { ...meta, name: 'clip.mp4', contentHash, byteSize: fs.statSync(file).size, provenance: { origin: 'upload', importedAt: new Date().toISOString(), importedBy: 'test' } } } }] });
    assetId = r.results[0]!.output!.assetId as string;
    const track: MotionTrack = { id: 'mtk_m1', assetId, name: 'square', kind: 'region', from: 10, box: { w: 1500, h: 2000 }, x: [5000], y: [5000], s: [1000], q: [100], st: [ST.manual], origin: { method: 'manual', params: {}, createdAt: '2026-11-17T00:00:00.000Z', createdBy: 'user:local', edited: false } };
    store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'restore_entities', args: { targets: [{ id: track.id, state: { kind: 'motionTrack', track } }] } }] });
  }, 60_000);

  it('both tools are listed; their descriptions say no AI model is used and that a tracked blur is not guaranteed redaction', async () => {
    const { tools } = await rpc('tools/list', {});
    const byName = new Map<string, any>(tools.map((t: any) => [t.name, t]));
    for (const name of ['track_motion', 'get_motion_track']) {
      expect(byName.has(name), name).toBe(true);
      expect(byName.get(name).description).toMatch(/no AI model/i);
      expect(byName.get(name).description).toMatch(/not guaranteed redaction/i);
    }
    expect(Object.keys(byName.get('track_motion').inputSchema.properties).sort()).toEqual(['direction', 'from', 'input', 'motionTrackId', 'overwrite', 'projectId', 'to']);
    expect(byName.get('get_motion_track').annotations?.readOnlyHint).toBe(true);
  });
  it('get_motion_track returns the same view as GET …/motion-tracks/:id; an unknown track is not_found on both', async () => {
    const viaTool = await tool('get_motion_track', { projectId: pid, motionTrackId: 'mtk_m1' });
    const viaRest = await rest('GET', `/projects/${pid}/motion-tracks/mtk_m1`);
    expect(viaTool.isError).toBe(false);
    expect(viaTool.body).toEqual(viaRest.body);
    expect(viaTool.body).toMatchObject({ motionTrackId: 'mtk_m1', assetId, kind: 'region', from: 10, to: 11, counts: { manual: 1 } });
    expect((await tool('get_motion_track', { projectId: pid, motionTrackId: 'mtk_nope' })).body.error.code).toBe('not_found');
    expect((await rest('GET', `/projects/${pid}/motion-tracks/mtk_nope`)).body.error.code).toBe('not_found');
  });
  it('track_motion starts a durable tracking job that cancel_job stops; refusals match REST', async () => {
    expect((await tool('track_motion', { projectId: pid, motionTrackId: 'mtk_nope' })).body.error.code).toBe('not_found');
    expect((await tool('track_motion', { projectId: pid, motionTrackId: 'mtk_m1', from: 50, to: 60 })).body.error.code).toBe('no_anchor');
    expect((await rest('POST', `/projects/${pid}/motion-tracks/mtk_m1/track`, { from: 50, to: 60 })).body.error.code).toBe('no_anchor');
    const started = await tool('track_motion', { projectId: pid, motionTrackId: 'mtk_m1' });
    expect(started.isError, JSON.stringify(started.body)).toBe(false);
    expect(['queued', 'running']).toContain(started.body.status);
    const j = store.getJob(started.body.jobId);
    expect(j.type).toBe('tracking');
    expect(j.input).toMatchObject({ motionTrackId: 'mtk_m1', assetId, from: 0, to: 90, direction: 'both', input: 'proxy' });
    const c = await tool('cancel_job', { jobId: j.id });
    expect(c.isError, JSON.stringify(c.body)).toBe(false);
    expect(['cancel-requested', 'canceled']).toContain(c.body.status);
    for (let i = 0; i < 400 && store.getJob(j.id).status !== 'canceled'; i++) await sleep(10);
    expect(store.getJob(j.id)).toMatchObject({ status: 'canceled', error: { code: 'canceled' } });
    expect(store.getProject(pid).doc.motionTracks.mtk_m1!.x).toHaveLength(1);
  }, 60_000);
});
