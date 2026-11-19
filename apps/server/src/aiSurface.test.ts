/**
 * The AI-model wave's user and agent surface (ADR-0017), served in-process (app.fetch and the MCP handler called directly; no port,
 * no browser, no provider, no model):
 *  - only the owner's own session marks a translation reviewed; agents get 403 there and on the model download;
 *  - REST and MCP hand the capability service the same run request (same job.input), including source, apply and confirmLongRun;
 *  - request_model_download creates an approval and starts no job.
 * The capability service's start/estimate are replaced by a labelled recording stand-in in the parity tests: what is checked is what
 * each surface passes on, not the runners (W1/W2 test those).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { sha256Hex } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';
import type { RunRequest } from './aiContracts.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
let pid = '', assetId = '', segId = '', variantId = '', ownerCookie = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
const agentHeaders = () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'content-type': 'application/json' });
const ownerHeaders = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body?: unknown, headers: Record<string, string> = agentHeaders()) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
let rpcId = 0;
const rpc = async (method: string, params: Record<string, unknown>) => {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...agentHeaders(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return msg.result;
};
const tool = async (name: string, args: Record<string, unknown>) => {
  const result = await rpc('tools/call', { name, arguments: args });
  const text: string = result.content[0].text;
  // the MCP SDK answers a call whose arguments fail the tool's input schema with plain text, not our JSON error
  let body: any;
  try { body = JSON.parse(text); } catch { body = { error: { code: 'mcp_input_validation', message: text } }; }
  return { isError: result.isError === true, body };
};
const jobCount = () => (store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ai-surface-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, comfyuiModelsDir: path.join(dir, 'comfy-models'), speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  fs.mkdirSync(cfg.comfyuiModelsDir!, { recursive: true });
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  const presence = new Presence();
  const governance = new Governance(store);
  auth.resolveGrant = (token) => governance.principalForToken(token);
  const speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, governance, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, governance, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  // A project with a typed Hebrew transcript and a machine translation of it (fixture: attach_translation is the op the translation tool commits).
  pid = store.createProject({ name: 'ai-surface', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
  const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
  const audio = { kind: 'audio' as const, name: 'voice.wav', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(4, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: prov };
  let r = store.commit({ projectId: pid, actor: 'test', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: audio } }] });
  assetId = r.results[0]!.output!.assetId as string;
  r = store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'set_transcript', args: { assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(2, 1), text: 'שלום לכולם' }] } }] });
  segId = store.getProject(pid).doc.transcripts[assetId]!.segments[0]!.id;
  r = store.commit({ projectId: pid, actor: 'test', allowInternal: true, ops: [{ op: 'attach_translation', args: { baseVariantId: null, name: 'English', language: 'en', translation: { from: 'he', to: 'en', engine: 'fixture', model: 'fixture', createdAt: '2026-11-17T00:00:00Z', createdBy: 'test', sources: { [segId]: sha256Hex('שלום לכולם') } }, phraseText: { [segId]: 'Hello everyone' }, cueText: {} } }] });
  variantId = r.results[0]!.output!.variantId as string;
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('translation review: the owner\'s mark, never an agent\'s', () => {
  it('an agent credential gets 403 human_approval_required on the review route and nothing is committed', async () => {
    const rev = store.getProject(pid).revision;
    for (const review of ['reviewed', 'needed']) {
      const r = await rest('POST', `/projects/${pid}/variants/${variantId}/translation/review`, { review });
      expect([r.status, r.body.error.code]).toEqual([403, 'human_approval_required']);
    }
    expect(store.getProject(pid).revision).toBe(rev);
    expect(store.getProject(pid).doc.variants[variantId]!.translation!.review).toBe('needed');
  });
  it('no MCP tool marks a translation reviewed or downloads anything; review_translation is not callable through the generic transaction either', async () => {
    const names: string[] = (await rpc('tools/list', {})).tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(['run_capability', 'estimate_capability', 'translate_captions', 'request_model_download']));
    expect(names.filter((n) => /review|download/.test(n))).toEqual(['request_model_download']);
    const viaTx = await tool('apply_transaction', { projectId: pid, ops: [{ op: 'review_translation', args: { variantId, review: 'reviewed' } }] });
    expect([viaTx.isError, viaTx.body.error.code]).toEqual([true, 'forbidden_op']);
    expect(store.getProject(pid).doc.variants[variantId]!.translation!.review).toBe('needed');
  });
  it('the owner\'s session marks it reviewed (by the owner, with the time), as one undoable revision, and can set it back', async () => {
    const r = await rest('POST', `/projects/${pid}/variants/${variantId}/translation/review`, { review: 'reviewed' }, ownerHeaders());
    expect(r.status).toBe(200);
    const tl = store.getProject(pid).doc.variants[variantId]!.translation!;
    expect([tl.review, tl.reviewedBy]).toEqual(['reviewed', 'user:local']);
    expect(Number.isNaN(Date.parse(tl.reviewedAt!))).toBe(false);
    const twice = await rest('POST', `/projects/${pid}/variants/${variantId}/translation/review`, { review: 'reviewed' }, ownerHeaders());
    expect(twice.status).toBeGreaterThanOrEqual(400);
    expect((await rest('POST', `/projects/${pid}/variants/${variantId}/translation/review`, { review: 'maybe' }, ownerHeaders())).status).toBe(400);
    const back = await rest('POST', `/projects/${pid}/variants/${variantId}/translation/review`, { review: 'needed' }, ownerHeaders());
    expect(back.status).toBe(200);
    expect(store.getProject(pid).doc.variants[variantId]!.translation!.review).toBe('needed');
  });
});

describe('model downloads: agents can only ask', () => {
  const CAP = 'comfy.image.remove-background'; // BiRefNet: its weights are not in the empty models folder of this test
  it('an agent credential gets 403 on the download route and on approving; the owner\'s download route is not refused for being the owner', async () => {
    const before = jobCount();
    const dl = await rest('POST', `/projects/${pid}/capabilities/${CAP}/models/download`, { confirmBytes: 1 });
    expect([dl.status, dl.body.error.code]).toEqual([403, 'human_approval_required']);
    const ask = await rest('POST', `/projects/${pid}/capabilities/${CAP}/models/request`);
    expect(ask.status).toBe(201);
    const approve = await rest('POST', `/projects/${pid}/approvals/${ask.body.approval.id}/approve`);
    expect([approve.status, approve.body.error.code]).toEqual([403, 'owner_required']);
    // the owner is let through to the byte-count check (a wrong count is refused before any byte moves)
    const owner = await rest('POST', `/projects/${pid}/capabilities/${CAP}/models/download`, { confirmBytes: 1 }, ownerHeaders());
    expect(owner.body.error?.code).not.toBe('human_approval_required');
    expect(jobCount()).toBe(before);
  });
  it('request_model_download creates a pending approval for the exact missing bytes and starts no job, as the REST request does', async () => {
    const before = jobCount();
    const viaTool = await tool('request_model_download', { projectId: pid, capabilityId: CAP });
    expect(viaTool.isError).toBe(false);
    const a = viaTool.body.approval;
    const listed = (await capabilities.list()).capabilities.find((c) => c.id === CAP)!;
    expect([a.kind, a.status, a.requestedBy, a.action.capabilityId, a.action.bytes]).toEqual(['model-download', 'pending', 'agent:local', CAP, listed.missingDownloadBytes]);
    expect(a.action.bytes).toBeGreaterThan(0);
    expect(a.action.models.map((m: any) => m.sha256)).toEqual(listed.models.map((m) => m.sha256));
    const viaRoute = await rest('POST', `/projects/${pid}/capabilities/${CAP}/models/request`);
    expect(Object.keys(viaRoute.body.approval).sort()).toEqual(Object.keys(a).sort());
    expect(viaRoute.body.approval.action).toEqual(a.action);
    expect(jobCount()).toBe(before);
    const unknown = await tool('request_model_download', { projectId: pid, capabilityId: 'no.such-tool' });
    expect([unknown.isError, unknown.body.error.code]).toEqual([true, 'capability_not_found']);
  });
});

describe('REST and MCP hand the capability service the same run (labelled recording stand-in for start/estimate)', () => {
  const seen: RunRequest[] = [];
  let realStart: Capabilities['start'], realEstimate: Capabilities['estimate'];
  beforeAll(() => {
    realStart = capabilities.start.bind(capabilities);
    realEstimate = capabilities.estimate.bind(capabilities);
    // STAND-IN (test only): records the request and stores it as the job input, the way a real start persists what it was asked.
    capabilities.start = (req: RunRequest) => { seen.push(req); const { principal: _p, ...input } = req; return store.createJob(req.projectId, 'capability', req.actor, input); };
    capabilities.estimate = async (req: RunRequest) => { seen.push(req); return { capabilityId: req.capabilityId, setup: { code: 'ready', detail: 'stand-in' }, frames: null, chunks: null, missingDownloadBytes: 0, scratchBytes: 0, seconds: null, basis: 'none', needsConfirm: false, blockers: [{ code: 'echo', message: JSON.stringify({ source: req.source ?? null, params: req.params }) }] }; };
  });
  afterAll(() => { capabilities.start = realStart; capabilities.estimate = realEstimate; });

  it('the same run through both surfaces creates identical job.input, with source, apply and confirmLongRun passed through', async () => {
    const body = { params: { keepBass: true }, source: { clipId: 'clp_x' }, apply: 'replace-clip', confirmLongRun: true, dependsOn: ['clp_x'] };
    const viaRoute = await rest('POST', `/projects/${pid}/capabilities/local.audio.vocals-classic/runs`, body);
    expect(viaRoute.status).toBe(202);
    const viaTool = await tool('run_capability', { projectId: pid, capabilityId: 'local.audio.vocals-classic', ...body });
    expect(viaTool.isError).toBe(false);
    const a = store.getJob(viaRoute.body.jobId), b = store.getJob(viaTool.body.jobId);
    expect(b.input).toEqual(a.input);
    expect(a.input).toEqual({ projectId: pid, capabilityId: 'local.audio.vocals-classic', params: { keepBass: true }, actor: 'agent:local', source: { clipId: 'clp_x' }, apply: 'replace-clip', confirmLongRun: true, dependsOn: ['clp_x'] });
    // and with an asset range, no optional fields
    const ranged = { source: { assetId, range: { firstFrame: 3, frameCount: 30 } } };
    const r2 = await rest('POST', `/projects/${pid}/capabilities/local.voice.clean/runs`, ranged);
    const t2 = await tool('run_capability', { projectId: pid, capabilityId: 'local.voice.clean', ...ranged });
    expect(store.getJob(t2.body.jobId).input).toEqual(store.getJob(r2.body.jobId).input);
    // a malformed source or apply is refused alike (400) before the service is asked
    const n = seen.length;
    expect((await rest('POST', `/projects/${pid}/capabilities/local.voice.clean/runs`, { source: { clipId: 'x', assetId } })).status).toBe(400);
    expect((await rest('POST', `/projects/${pid}/capabilities/local.voice.clean/runs`, { apply: 'everywhere' })).status).toBe(400);
    expect((await tool('run_capability', { projectId: pid, capabilityId: 'local.voice.clean', apply: 'everywhere' })).isError).toBe(true);
    expect(seen.length).toBe(n);
  });
  it('the estimate route and estimate_capability ask for the same estimate; a query that is not JSON is a 400', async () => {
    const source = { assetId, range: { firstFrame: 0, frameCount: 12 } };
    const r = await rest('GET', `/projects/${pid}/capabilities/comfy.video.enhance/estimate?source=${encodeURIComponent(JSON.stringify(source))}&params=${encodeURIComponent(JSON.stringify({ scale_by: 0.5 }))}`);
    expect(r.status).toBe(200);
    const t = await tool('estimate_capability', { projectId: pid, capabilityId: 'comfy.video.enhance', source, params: { scale_by: 0.5 } });
    expect(t.body).toEqual(r.body);
    expect(JSON.parse(r.body.blockers[0].message)).toEqual({ source, params: { scale_by: 0.5 } });
    expect((await rest('GET', `/projects/${pid}/capabilities/comfy.video.enhance/estimate?source=not-json`)).status).toBe(400);
    expect((await rest('GET', `/projects/${pid}/capabilities/comfy.video.enhance/estimate?source=${encodeURIComponent('{"clipId":""}')}`)).status).toBe(400);
  });
  it('translate_captions runs the local translation tool for the transcript\'s language, as a library run with that source', async () => {
    const t = await tool('translate_captions', { projectId: pid, assetId, to: 'en', baseVariantId: variantId });
    expect(t.isError).toBe(false);
    expect(store.getJob(t.body.jobId).input).toEqual({ projectId: pid, capabilityId: 'local.text.translate-he-en', params: { baseVariantId: variantId }, actor: 'agent:local', source: { assetId }, apply: 'library' });
    const same = await tool('translate_captions', { projectId: pid, assetId, to: 'he' });
    expect([same.isError, same.body.error.code]).toEqual([true, 'language_mismatch']);
    const both = await tool('translate_captions', { projectId: pid, assetId, captionTrackId: 'trk_x', to: 'en' });
    expect([both.isError, both.body.error.code]).toEqual([true, 'invalid_request']);
    const cues = await tool('translate_captions', { projectId: pid, captionTrackId: 'trk_x', to: 'he' });
    expect(store.getJob(cues.body.jobId).input).toMatchObject({ capabilityId: 'local.text.translate-en-he', params: { captionTrackId: 'trk_x' }, apply: 'library' });
  });
});
