/**
 * Multicam sync by sound (ADR-0020 W2) on synthetic speech-like sound (multicamSync.fixtures.ts): lags to the sample, drift,
 * polarity and noise, and the honest verdicts (ambiguous, no-shared-sound, inconsistent) with no anchors; the refusals; the
 * background job with cancel. Measurements are dry runs, so these tests do not depend on the attach operation's body
 * (W1); the commit itself is checked once that body is built.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { MULTICAM_OPS_BUILT, type Asset, type MulticamGroup, type MulticamSyncReport, type SyncQuality } from '@pulseframe/core';
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
import { addNoise, loopAt, pinkNoise, speechAt, speechBursts, wav } from './multicamSync.fixtures.ts';
import { coarseMatch, fitSync, verdictOf } from './multicamSync.ts';

const SR = 48000;
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
let pid = '';
const rest = async (method: string, p: string, body: unknown, t = auth.tokens.agent) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: { host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
let rpc = 0;
const tool = async (name: string, args: Record<string, unknown>, t = auth.tokens.agent) => {
  const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, body: JSON.parse(msg.result.content[0].text) as any };
};
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
function importWav(name: string, x: Float32Array): string {
  const bytes = wav(x, SR), hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const tmp = path.join(dir, `${name}.wav`);
  fs.writeFileSync(tmp, bytes);
  store.putBlob(hash, tmp, bytes.length, 'audio/wav');
  const asset: Omit<Asset, 'id'> = { kind: 'audio', name: `${name}.wav`, contentHash: hash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(x.length, SR), audio: { sampleRate: SR, channels: 1, codec: 'pcm_s16le' }, provenance: prov };
  const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
  return r.results[0]!.output!.assetId as string;
}
const q = (verdict: SyncQuality['verdict']): SyncQuality => ({ verdict, peakZ: null, peakRatio: null, anchorsUsed: 0, anchorsRejected: 0, residualSamples: null, driftPpm: null, overlapSeconds: null, candidates: [], chainDepth: 0, jobId: null });
function putGroup(id: string, angles: { id: string; assetId: string; verdict?: SyncQuality['verdict']; anchors?: { group: T.RationalTime; source: T.RationalTime }[] }[]) {
  const group: MulticamGroup = {
    id, name: id, sampleRate: SR, referenceAngleId: angles[0]!.id, wideAngleId: null, speakers: [], origin: { method: 'test', params: {}, createdAt: 'x', createdBy: 'test', edited: false },
    angles: angles.map((a, i) => ({ id: a.id, label: a.id.toUpperCase(), kind: 'sound', pieces: [{ assetId: a.assetId, anchors: i === 0 ? [{ group: T.ZERO, source: T.ZERO }] : a.anchors ?? [], quality: q(i === 0 ? 'reference' : a.verdict ?? 'unsynced') }] })),
  };
  // the group as create_multicam leaves it (the operation is W1's), put in place by an undoable restore
  store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'restore_entities', args: { targets: [{ id, state: { kind: 'multicamGroup', group } }] } }] });
}
const render = (seconds: number, f: (t: number) => number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => f(i / SR));

const speech = speechBursts(11, 140);
const S = (t: number) => speechAt(speech, t);
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-multicam-sync-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  gov = new Governance(store);
  auth.resolveGrant = (t) => gov.principalForToken(t);
  const sp = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, sp);
  derivatives = new Derivatives(store);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, sp);
  pid = store.createProject({ name: 'mc-sync', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
  const ref = importWav('ref', render(120, S));
  const plus = importWav('plus', render(90, (t) => S(t + 57321 / SR)));
  const minus = importWav('minus', render(90, (t) => S(t - 12345 / SR)));
  const seven = importWav('seven', render(90, (t) => S(t + 7 / SR)));
  const drift = importWav('drift', render(100, (t) => S(30000 / SR + t * (1 + 100e-6))));
  const flipped = importWav('flipped', addNoise(render(90, (t) => -S(t + 57321 / SR)), 10, 5));
  const paused = importWav('paused', render(90, (t) => (t < 36 ? S(t + 4) : S(t + 4 + 2))));
  putGroup('mcg_speech', [{ id: 'ref', assetId: ref }, { id: 'plus', assetId: plus }, { id: 'minus', assetId: minus }, { id: 'seven', assetId: seven }, { id: 'drift', assetId: drift }, { id: 'flipped', assetId: flipped }, { id: 'paused', assetId: paused }]);
  // a room with a backing loop: the reference hears speech and the loop; one camera hears only the loop, one only noise
  const room = importWav('room', render(90, (t) => S(t) + 0.5 * loopAt(t)));
  const loopOnly = importWav('loop', render(80, (t) => loopAt(t + 3.3)));
  const noise = importWav('noise', pinkNoise(9, 80 * SR).map((v) => 0.1 * v));
  putGroup('mcg_room', [{ id: 'room', assetId: room }, { id: 'loop', assetId: loopOnly }, { id: 'noise', assetId: noise }]);
  const manual = importWav('manual', render(60, (t) => S(t + 1)));
  putGroup('mcg_manual', [{ id: 'mref', assetId: ref }, { id: 'hand', assetId: manual, verdict: 'manual', anchors: [{ group: T.rt(48000, SR), source: T.ZERO }] }]);
}, 120_000);
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let speechReport: MulticamSyncReport;
const row = (r: MulticamSyncReport, angleId: string) => r.pieces.find((p) => p.angleId === angleId)!;
const samples = (s: number | null) => (s === null ? null : Math.round(s * SR));

describe('multicam sync by sound (synthetic speech)', () => {
  it('measures every angle in one dry run (observe credential), committing nothing', async () => {
    const r = await rest('POST', `/projects/${pid}/multicam/mcg_speech/sync`, { dryRun: true }, auth.tokens.observer);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    speechReport = r.body;
    expect(speechReport.committed).toBe(false);
    expect(speechReport.revision).toBe(store.getProject(pid).revision);
    expect(row(speechReport, 'ref').verdict).toBe('reference');
  }, 240_000);
  it.each([['plus', 57321], ['minus', -12345], ['seven', 7]])('a lag of %s (%d samples) is recovered to ±1 sample, confidently', (angle, lag) => {
    const p = row(speechReport, angle);
    expect(p.verdict, JSON.stringify(p)).toBe('confident');
    expect(Math.abs(samples(p.offsetSeconds)! - lag)).toBeLessThanOrEqual(1);
    expect(p.anchors).toBe(1);
    expect(p.peakZ!).toBeGreaterThanOrEqual(10);
  });
  it('100 ppm of clock drift is recovered within 2 ppm, as a line', () => {
    const p = row(speechReport, 'drift');
    expect(['confident', 'check'], JSON.stringify(p)).toContain(p.verdict);
    expect(Math.abs(p.driftPpm! - 100)).toBeLessThanOrEqual(2);
    expect(p.anchors).toBe(2);
    expect(Math.abs(samples(p.offsetSeconds)! - 30000)).toBeLessThanOrEqual(2);
  });
  it('an inverted polarity at 10 dB SNR of pink noise still syncs to the sample', () => {
    const p = row(speechReport, 'flipped');
    expect(['confident', 'check'], JSON.stringify(p)).toContain(p.verdict);
    expect(Math.abs(samples(p.offsetSeconds)! - 57321)).toBeLessThanOrEqual(1);
  });
  it('a recording with a 2 s pause inside is inconsistent and gets no anchors', () => {
    const p = row(speechReport, 'paused');
    expect(p.verdict, JSON.stringify(p)).toBe('inconsistent');
    expect([p.anchors, p.offsetSeconds, p.why]).toEqual([0, null, 'inconsistent']);
  });
  it('a periodic loop is ambiguous (no anchors, several candidates); pink noise has no shared sound', async () => {
    const r = await rest('POST', `/projects/${pid}/multicam/mcg_room/sync`, { dryRun: true }, auth.tokens.observer);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const loop = row(r.body, 'loop'), noise = row(r.body, 'noise');
    expect(loop.verdict, JSON.stringify(loop)).toBe('ambiguous');
    expect(loop.anchors).toBe(0);
    expect(loop.candidates.length).toBeGreaterThanOrEqual(2);
    expect(noise.verdict, JSON.stringify(noise)).toBe('no-shared-sound');
    expect(noise.anchors).toBe(0);
  }, 120_000);
});

describe('multicam sync refusals and the job', () => {
  it('a hand-synced file without overwrite is refused 409 would_discard_edits; a dry run of it is fine', async () => {
    const r = await rest('POST', `/projects/${pid}/multicam/mcg_manual/sync`, {});
    expect([r.status, r.body.error.code, r.body.error.details.why]).toEqual([409, 'would_discard_edits', 'would_discard_edits']);
    expect(r.body.error.hint).toMatch(/overwrite/);
    const before = store.getProject(pid).revision;
    expect((await rest('POST', `/projects/${pid}/multicam/mcg_manual/sync`, { dryRun: true }, auth.tokens.observer)).status).toBe(200);
    expect(store.getProject(pid).revision).toBe(before);
  }, 120_000);
  it('an observe credential gets a dry run but 403 on a commit, in the request and as a job', async () => {
    expect((await rest('POST', `/projects/${pid}/multicam/mcg_room/sync`, {}, auth.tokens.observer)).status).toBe(403);
    expect((await rest('POST', `/projects/${pid}/multicam/mcg_room/sync`, { background: true }, auth.tokens.observer)).status).toBe(403);
    const unknown = await rest('POST', `/projects/${pid}/multicam/mcg_room/sync`, { dryRun: true, angleIds: ['nope'] }, auth.tokens.observer);
    expect([unknown.status, unknown.body.error.code]).toEqual([404, 'not_found']);
  });
  it('as a durable analysis job (kind multicam-sync) whose output names each angle; cancel_job before it starts removes it', async () => {
    const started = await rest('POST', `/projects/${pid}/multicam/mcg_room/sync`, { dryRun: true, background: true }, auth.tokens.observer);
    expect(started.status).toBe(202);
    let j = store.getJob(started.body.jobId);
    for (let i = 0; i < 600 && !['succeeded', 'failed', 'canceled'].includes(j.status); i++) { await new Promise((r) => setTimeout(r, 100)); j = store.getJob(started.body.jobId); }
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(j.input.kind).toBe('multicam-sync');
    expect(j.output.angles).toEqual(expect.arrayContaining([expect.objectContaining({ angleId: 'loop', label: 'LOOP', verdict: 'ambiguous' }), expect.objectContaining({ angleId: 'noise', label: 'NOISE', verdict: 'no-shared-sound' })]));
    // a queued job canceled through MCP's cancel_job path (the same dispatch as REST) is removed and never measured
    const queued = store.createJob(pid, 'analysis', 'agent:local', { kind: 'multicam-sync', groupId: 'mcg_room', options: { dryRun: true }, projectRevision: 0 });
    const c = await rest('POST', `/jobs/${queued.id}/cancel`, {});
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(store.getJob(queued.id).status).toBe('canceled');
  }, 120_000);
  it('a running job asked to cancel stops between pieces and attaches nothing', async () => {
    const before = store.getProject(pid).revision;
    const started = await rest('POST', `/projects/${pid}/multicam/mcg_speech/sync`, { background: true, overwrite: true });
    expect(started.status).toBe(202);
    await rest('POST', `/jobs/${started.body.jobId}/cancel`, {});
    let j = store.getJob(started.body.jobId);
    for (let i = 0; i < 1200 && !['succeeded', 'failed', 'canceled'].includes(j.status); i++) { await new Promise((r) => setTimeout(r, 100)); j = store.getJob(started.body.jobId); }
    expect(j.status).toBe('canceled');
    expect(store.getProject(pid).revision).toBe(before);
  }, 180_000);
  it.skipIf(!MULTICAM_OPS_BUILT)('a commit attaches the measured maps as one step (needs the attach operation, W1)', async () => {
    const r = await rest('POST', `/projects/${pid}/multicam/mcg_speech/sync`, { angleIds: ['plus', 'paused'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.committed).toBe(true);
    const g = store.getProject(pid).doc.multicam!.mcg_speech!;
    expect(g.angles.find((a) => a.id === 'plus')!.pieces[0]!.anchors).toEqual([{ group: T.rt(57321, SR), source: T.rt(0, SR) }]);
    expect(g.angles.find((a) => a.id === 'paused')!.pieces[0]!.anchors).toEqual([]);
    expect(g.origin.params).toMatchObject({ confidentPeakZ: 10, ambiguousBelowPeakRatio: 1.2 });
  }, 120_000);
});

describe('MCP', () => {
  it('sync_multicam (a dry run with an observe credential, refused to commit), get_multicam, and cancel_job on a multicam-sync job', async () => {
    const dry = await tool('sync_multicam', { projectId: pid, groupId: 'mcg_room', dryRun: true }, auth.tokens.observer);
    expect(dry.isError, JSON.stringify(dry.body)).toBe(false);
    expect(dry.body.pieces.find((p: any) => p.angleId === 'loop').verdict).toBe('ambiguous');
    const commit = await tool('sync_multicam', { projectId: pid, groupId: 'mcg_room' }, auth.tokens.observer);
    expect([commit.isError, commit.body.error.code]).toEqual([true, 'insufficient_scope']);
    const view = await tool('get_multicam', { projectId: pid, groupId: 'mcg_room' }, auth.tokens.observer);
    expect(view.isError).toBe(false);
    expect(view.body.group.id).toBe('mcg_room');
    expect(view.body.envelopes.every((e: any) => e.status === 'ready')).toBe(true);
    expect(view.body.coverage).toEqual([{ angleId: 'room', pieceIndex: 0, startSeconds: 0, endSeconds: 90 }]);
    const queued = store.createJob(pid, 'analysis', 'agent:local', { kind: 'multicam-sync', groupId: 'mcg_room', options: { dryRun: true }, projectRevision: 0 });
    const c = await tool('cancel_job', { jobId: queued.id });
    expect([c.isError, c.body.outcome]).toEqual([false, 'removed-from-queue']);
    expect(store.getJob(queued.id).status).toBe('canceled');
  }, 120_000);
});

describe('the pure stages', () => {
  it('fit: a pure offset, a drift line, outliers dropped', () => {
    const off = fitSync([0, 1, 2, 3].map((k) => ({ x: k * 1e6, y: k * 1e6 + 500 })), 96, 48, 3e6)!;
    expect([off.model, off.anchors, off.residualSamples]).toEqual(['offset', [{ x: 0, y: 500 }], 0]);
    const line = fitSync([0, 1, 2, 3, 4].map((k) => ({ x: k * 1e6, y: k * 1e6 * (1 + 1e-4) + 9 + (k === 2 ? 900 : 0) })), 96, 48, 4e6)!;
    expect([line.model, line.dropped, Math.round((line.slope - 1) * 1e6)]).toEqual(['line', 1, 100]);
  });
  it('verdicts follow the starting thresholds in order', () => {
    const fit = { anchors: [{ x: 0, y: 1 }], slope: 1, residualSamples: 10, kept: 3, dropped: 0, model: 'offset' as const };
    expect(verdictOf({ peakZ: 5, peakRatio: 3, fit, windows: 3, measured: 3, rejected: 0, oneMs: 48 })).toBe('no-shared-sound');
    expect(verdictOf({ peakZ: 20, peakRatio: 1.1, fit, windows: 3, measured: 3, rejected: 0, oneMs: 48 })).toBe('ambiguous');
    expect(verdictOf({ peakZ: 20, peakRatio: 2, fit, windows: 3, measured: 3, rejected: 0, oneMs: 48 })).toBe('confident');
    expect(verdictOf({ peakZ: 8, peakRatio: 2, fit, windows: 3, measured: 3, rejected: 0, oneMs: 48 })).toBe('check');
    expect(verdictOf({ peakZ: 20, peakRatio: 2, fit: { ...fit, residualSamples: 300 }, windows: 3, measured: 3, rejected: 0, oneMs: 48 })).toBe('inconsistent');
    expect(verdictOf({ peakZ: 20, peakRatio: 2, fit, windows: 4, measured: 4, rejected: 2, oneMs: 48 })).toBe('inconsistent');
  });
  it('coarse: needs the minimum overlap', () => {
    const f = Float32Array.from({ length: 1000 }, (_, i) => ((i * 7919) % 13) / 13);
    const bed = { start: 0, values: Float64Array.from({ length: 1000 }, (_, i) => f[i]!), covered: new Uint8Array(1000).fill(1) };
    expect(coarseMatch(f, bed, { minOverlapFrames: 2000, maxOffsetFrames: 1e6 }).lagFrames).toBeNull();
  });
});
