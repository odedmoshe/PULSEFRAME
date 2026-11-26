import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { SFX } from './sfx.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

/**
 * The storage ceiling holds for the MCP tools exactly as for their REST twins: both call the same function, and that function makes
 * the check (Exporter.start, makeElement, makeSfx, Speech.startNarration). Served in-process (app.fetch and the MCP handler called
 * directly): no port is opened and no browser is started. The render worker is absent on purpose: a refusal happens before it is needed.
 */
const QUOTA = 3_000_000;
let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives, exporter: Exporter;
let pid = '';
let speech: Speech;
const filler = () => path.join(dir, 'filler.bin');
const fill = () => fs.writeFileSync(filler(), Buffer.alloc(QUOTA)); // stands in for accumulated media and exports
const unfill = () => fs.rmSync(filler(), { force: true });
const headers = () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
let rpcId = 0;
/** One tools/call over the MCP endpoint; returns the tool's JSON result and whether it is an error result. */
const tool = async (name: string, args: Record<string, unknown>) => {
  const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { ...headers(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, body: JSON.parse(msg.result.content[0].text) as any };
};
/** The parts of a typed error that must be the same on both surfaces (bytes in use move a little between two calls). */
const errorOf = (b: any) => ({ code: b.error.code, detailKeys: Object.keys(b.error.details ?? {}).sort(), quotaBytes: b.error.details?.quotaBytes, neededBytes: b.error.details?.neededBytes, hint: b.error.hint });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ceiling-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, maxStorageBytes: QUOTA, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir, cfg.maxStorageBytes);
  auth = new Auth(cfg);
  exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  const presence = new Presence();
  const governance = new Governance(store);
  auth.resolveGrant = (token) => governance.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, governance, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, governance, undefined, speech);
  pid = store.createProject({ name: 'ceiling', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('exports: export_project is held to the ceiling like POST /exports', () => {
  it('below the ceiling the export gets as far as planning (an empty project is render_blocked), on both surfaces', async () => {
    unfill();
    const viaTool = await tool('export_project', { projectId: pid });
    expect([viaTool.isError, viaTool.body.error.code]).toEqual([true, 'render_blocked']);
    const viaRoute = await rest('POST', `/projects/${pid}/exports`, {});
    expect([viaRoute.status, viaRoute.body.error.code]).toEqual([422, 'render_blocked']);
  });
  it('past the ceiling both are refused with the same typed 507 and no job is created', async () => {
    fill();
    try {
      const jobs = () => (store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
      const before = jobs();
      const viaTool = await tool('export_project', { projectId: pid });
      const viaRoute = await rest('POST', `/projects/${pid}/exports`, {});
      expect(viaRoute.status).toBe(507);
      expect(viaTool.isError).toBe(true);
      expect(viaTool.body.error.code).toBe('storage_quota_exceeded');
      expect(errorOf(viaTool.body)).toEqual(errorOf(viaRoute.body));
      expect(viaTool.body.error).toMatchObject({ message: expect.stringContaining('start an export'), details: { quotaBytes: QUOTA, neededBytes: 1, usedBytes: expect.any(Number) }, hint: expect.stringMatching(/clean-up/) });
      expect(jobs()).toBe(before);
    } finally { unfill(); }
  });
  it('the batch route checks once for all its jobs: 507 past the ceiling with no job created, and its starts are not checked again one by one', async () => {
    fill();
    try {
      const jobs = () => (store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
      const before = jobs();
      const batch = await rest('POST', `/projects/${pid}/exports/batch`, { variantIds: ['v1', 'v2'] });
      expect([batch.status, batch.body.error.code]).toEqual([507, 'storage_quota_exceeded']);
      expect(jobs()).toBe(before);
      // what the batch route passes to each start once it has checked: no second check (planning is reached; this project is empty)
      expect(() => exporter.start(pid, 'agent:local', {}, undefined, { roomChecked: true })).toThrow(expect.objectContaining({ code: 'render_blocked' }));
      expect(() => exporter.start(pid, 'agent:local', {})).toThrow(expect.objectContaining({ code: 'storage_quota_exceeded' }));
    } finally { unfill(); }
  });
  it('a retry writes a new file too: retry_job and POST /jobs/:id/retry are refused past the ceiling', async () => {
    const doc = store.getProject(pid).doc;
    const failed = store.createJob(pid, 'export', 'agent:local', { revision: 0, snapshot: doc, sidecar: null, manifest: { options: {} }, warnings: [], retryOf: null });
    store.updateJob(failed.id, { status: 'failed', error: { code: 'export_failed', message: 'stand-in failure' } });
    fill();
    try {
      const viaTool = await tool('retry_job', { jobId: failed.id });
      expect([viaTool.isError, viaTool.body.error.code, viaTool.body.error.message]).toEqual([true, 'storage_quota_exceeded', expect.stringContaining('retry this export')]);
      const viaRoute = await rest('POST', `/jobs/${failed.id}/retry`);
      expect([viaRoute.status, viaRoute.body.error.code]).toEqual([507, 'storage_quota_exceeded']);
    } finally { unfill(); }
  });
});

describe('generated media: the agent tools and the routes refuse a new file past the ceiling', () => {
  it('add_graphic_element and POST /elements: 507 for a new picture, nothing added', async () => {
    fill();
    try {
      const viaTool = await tool('add_graphic_element', { projectId: pid, elementId: 'element.shape.circle', color: '#010203' });
      expect([viaTool.isError, viaTool.body.error.code]).toEqual([true, 'storage_quota_exceeded']);
      const viaRoute = await rest('POST', `/projects/${pid}/elements`, { elementId: 'element.shape.circle', color: '#010204' });
      expect([viaRoute.status, viaRoute.body.error.code]).toEqual([507, 'storage_quota_exceeded']);
      expect(Object.keys(store.getProject(pid).doc.assets)).toEqual([]);
    } finally { unfill(); }
  }, 60_000);
  it('add_sound_effect and POST /sfx: 507 for a sound not stored yet; a sound already stored needs no room', async () => {
    const stored = await tool('add_sound_effect', { projectId: pid, sfxId: 'sfx.click' }); // below the ceiling: stored
    expect(stored.isError).toBe(false);
    const blobs = () => fs.readdirSync(path.join(dir, 'blobs')).length;
    const n = blobs();
    fill();
    try {
      const viaTool = await tool('add_sound_effect', { projectId: pid, sfxId: 'sfx.pop' });
      expect([viaTool.isError, viaTool.body.error.code, viaTool.body.error.message]).toEqual([true, 'storage_quota_exceeded', expect.stringContaining('store this sound')]);
      const viaRoute = await rest('POST', `/projects/${pid}/sfx`, { sfxId: SFX.find((s) => s.id === 'sfx.ding')!.id });
      expect([viaRoute.status, viaRoute.body.error.code]).toEqual([507, 'storage_quota_exceeded']);
      expect(blobs()).toBe(n);
      expect(fs.readdirSync(store.tmpDir).filter((f) => f.startsWith('sfx'))).toEqual([]);
      const again = await rest('POST', `/projects/${pid}/sfx`, { sfxId: 'sfx.click' });
      expect(again.status).toBe(201);
      expect(again.body.assetId).toBe(stored.body.assetId); // the same bytes: the asset already in the project
    } finally { unfill(); }
  }, 60_000);
  it('generate_narration, narrate_script and their routes: without a voice engine the honest setup state comes first, even past the ceiling; with one, 507 past the ceiling', async () => {
    fill();
    try {
      const unset = await tool('generate_narration', { projectId: pid, text: 'שלום' });
      expect([unset.isError, unset.body.error.code]).toEqual([true, 'voice_not_ready']);
    } finally { unfill(); }
    // a narration that could run (the voice engine reported ready; nothing is synthesised because the ceiling refuses first)
    const real = speech.status.bind(speech);
    (speech as unknown as { status: () => Promise<unknown> }).status = async () => ({ ...(await real()), narration: { ready: true, detail: 'ready', reason: null }, models: [{ id: 'test-tts', kind: 'tts', ready: true }] });
    fill();
    try {
      const one = await tool('generate_narration', { projectId: pid, text: 'שלום' });
      expect([one.isError, one.body.error.code]).toEqual([true, 'storage_quota_exceeded']);
      const script = await tool('narrate_script', { projectId: pid, text: 'One. Two.', start: { value: '0', timescale: 30 } });
      expect([script.isError, script.body.error.code]).toEqual([true, 'storage_quota_exceeded']);
      expect((await rest('POST', `/projects/${pid}/narration`, { text: 'שלום' })).status).toBe(507);
      expect((await rest('POST', `/projects/${pid}/narration/script`, { text: 'One. Two.', start: { value: '0', timescale: 30 } })).status).toBe(507);
    } finally { unfill(); (speech as unknown as { status: unknown }).status = real; }
    const below = await tool('generate_narration', { projectId: pid, text: 'שלום' });
    expect([below.isError, below.body.error.code]).toEqual([true, 'voice_not_ready']);
  }, 60_000);
});

describe('project import: a body of unknown size is cut off at the room left', () => {
  it('provider runs: past the ceiling a run is refused with 507 before a job exists, on REST and MCP alike', async () => {
    fill();
    try {
      const jobs = () => ((store as unknown as { db: { prepare(q: string): { get(): { n: number } } } }).db.prepare('SELECT count(*) AS n FROM jobs').get().n);
      const jobsBefore = jobs();
      const r = await rest('POST', `/projects/${pid}/capabilities/comfy.smoke.solid-image/runs`, { params: {} });
      expect(r.status).toBe(507);
      expect(r.body.error.code).toBe('storage_quota_exceeded');
      const t = await tool('run_capability', { projectId: pid, capabilityId: 'comfy.smoke.solid-image', params: {} });
      expect(t.isError).toBe(true);
      expect(errorOf(t.body)).toEqual(errorOf(r.body));
      expect(jobs()).toBe(jobsBefore);
    } finally { unfill(); }
    // below the ceiling it gets as far as the honest setup state (no ComfyUI here)
    const ok = await rest('POST', `/projects/${pid}/capabilities/comfy.smoke.solid-image/runs`, { params: {} });
    expect(ok.status).not.toBe(507);
  });

  it('a chunked body larger than the room is refused with 413 while streaming, and its temporary file is removed', async () => {
    const room = QUOTA - (await import('./storage.ts')).dataDirBytes(dir);
    expect(room).toBeGreaterThan(200_000);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { if (sent > room + 2_000_000) return c.close(); sent += 65536; c.enqueue(new Uint8Array(65536)); } });
    const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1/projects/import`, { method: 'POST', headers: { host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}` }, body, duplex: 'half' } as RequestInit));
    const b = (await r.json()) as any;
    expect([r.status, b.error.code]).toEqual([413, 'upload_too_large']); // before: the whole body was taken, then refused as not an archive (422)
    expect(Math.abs(b.error.details.maxBytes - room)).toBeLessThan(100_000); // the room left (the database moves it a little)
    expect(sent).toBeLessThan(room + 2_000_000); // it stopped reading, it did not take the whole body
    expect(fs.readdirSync(store.tmpDir).filter((f) => f.startsWith('imp_'))).toEqual([]);
  });
});
