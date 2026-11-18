/**
 * Contracts of multicam (ADR-0020) on the server: the three routes are registered, check the credential's scope (a sync that
 * commits needs edit; a dryRun only observe), the body and that the project, group or file exists, and then run W2's bodies
 * (multicamSync.ts). The files here have content hashes with no bytes behind them, so every measurement honestly refuses
 * 422 analysis_failed (nothing is fabricated or attached); the group view answers 200 without measuring anything; the
 * auto-switch recipe refuses 400 because the group maps no speakers to mics.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { Asset, MulticamGroup } from '@pulseframe/core';
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

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
let pid = '', A = '';
const rest = async (method: string, p: string, body: unknown, t = auth.tokens.agent) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: { host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const cam = (c: string): Omit<Asset, 'id'> => ({ kind: 'video', name: `${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 64, height: 36, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 1800 }, audio: { sampleRate: 48000, channels: 1, codec: 'aac' }, provenance: prov });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-multicam-routes-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  gov = new Governance(store);
  auth.resolveGrant = (t) => gov.principalForToken(t);
  const speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech);
  derivatives = new Derivatives(store);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, speech);
  pid = store.createProject({ name: 'mc', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
  const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: cam('a') } }, { op: 'import_asset', args: { asset: cam('b') } }] });
  [A] = r.results.map((x) => x.output!.assetId as string) as [string];
  const B = r.results[1]!.output!.assetId as string;
  // the group as W1's create_multicam will leave it, put in place by an undoable restore (the operations are W1's)
  const q = (verdict: 'reference' | 'unsynced') => ({ verdict, peakZ: null, peakRatio: null, anchorsUsed: 0, anchorsRejected: 0, residualSamples: null, driftPpm: null, overlapSeconds: null, candidates: [], chainDepth: 0, jobId: null });
  const group: MulticamGroup = { id: 'mcg_1', name: 'G', sampleRate: 48000, referenceAngleId: 'ang_a', wideAngleId: 'ang_a', speakers: [], origin: { method: 'test', params: {}, createdAt: 'x', createdBy: 'test', edited: false },
    angles: [{ id: 'ang_a', label: 'A', kind: 'picture', pieces: [{ assetId: A, anchors: [{ group: T.ZERO, source: T.ZERO }], quality: q('reference') }] }, { id: 'ang_b', label: 'B', kind: 'picture', pieces: [{ assetId: B, anchors: [], quality: q('unsynced') }] }] };
  store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'restore_entities', args: { targets: [{ id: 'mcg_1', state: { kind: 'multicamGroup', group } }] } }] });
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('multicam routes (contract and the built bodies)', () => {
  it('the group exists in the stored project, put there through an operation', () => {
    expect(store.getProject(pid).doc.multicam?.mcg_1?.angles).toHaveLength(2);
  });
  it('sync: a commit needs edit, a dryRun only observe; a bad body is 400; an unknown group 404; a file with no bytes 422, nothing attached', async () => {
    expect((await rest('POST', `/projects/${pid}/multicam/mcg_1/sync`, {}, auth.tokens.observer)).status).toBe(403);
    expect((await rest('POST', `/projects/${pid}/multicam/mcg_1/sync`, { nope: 1 })).status).toBe(400);
    const missing = await rest('POST', `/projects/${pid}/multicam/mcg_none/sync`, {});
    expect([missing.status, missing.body.error.code, missing.body.error.message]).toEqual([404, 'not_found', 'multicam group mcg_none not found']);
    const before = store.getProject(pid).revision;
    // the reference file's sound cannot be decoded (its hash has no blob), so the measurement refuses instead of guessing
    for (const [body, t] of [[{ dryRun: true }, auth.tokens.observer], [{}, auth.tokens.agent]] as const) {
      const r = await rest('POST', `/projects/${pid}/multicam/mcg_1/sync`, body, t);
      expect([r.status, r.body.error.code, r.body.error.details.assetId]).toEqual([422, 'analysis_failed', A]);
    }
    // background: a durable job (202) that ends failed with the same refusal
    const bg = await rest('POST', `/projects/${pid}/multicam/mcg_1/sync`, { background: true });
    expect(bg.status).toBe(202);
    expect(typeof bg.body.jobId).toBe('string');
    await expect.poll(() => store.getJob(bg.body.jobId).status, { timeout: 10_000 }).toBe('failed');
    expect((store.getJob(bg.body.jobId).error as { code: string }).code).toBe('analysis_failed');
    expect(store.getProject(pid).revision).toBe(before);
    expect(store.getProject(pid).doc.multicam?.mcg_1?.angles[1]?.pieces[0]?.anchors).toEqual([]);
  });
  it('the group view and the envelope: observe, 404 for what is not there; the view answers 200, an envelope of a file with no bytes 422', async () => {
    expect((await rest('GET', `/projects/${pid}/multicam/toString`, undefined, auth.tokens.observer)).status).toBe(404);
    const v = await rest('GET', `/projects/${pid}/multicam/mcg_1`, undefined, auth.tokens.observer);
    expect(v.status).toBe(200);
    expect(v.body.group.id).toBe('mcg_1');
    expect(v.body.coverage).toEqual([{ angleId: 'ang_a', pieceIndex: 0, startSeconds: 0, endSeconds: 60 }]);
    expect(v.body.programTracks).toEqual([]);
    expect(v.body.outOfSync).toEqual([]);
    expect(v.body.envelopes.map((e: { assetId: string }) => e.assetId)).toHaveLength(2);
    expect(v.body.capturePriors.map((c: { angleId: string; why: string }) => [c.angleId, c.why])).toEqual([['ang_a', 'reference'], ['ang_b', 'reference_no_capture']]);
    expect((await rest('POST', `/projects/${pid}/assets/ast_none/derivatives/envelope`, undefined, auth.tokens.observer)).status).toBe(404);
    const env = await rest('POST', `/projects/${pid}/assets/${A}/derivatives/envelope`, undefined, auth.tokens.observer);
    expect([env.status, env.body.error.code]).toEqual([422, 'analysis_failed']);
  });
  it('the auto-switch recipe is listed and its plan refuses 400 while the group maps no speakers to mics', async () => {
    const r = await rest('POST', `/projects/${pid}/recipes/multicam-auto/plan`, { params: { groupId: 'mcg_1' } });
    expect([r.status, r.body.error.code, r.body.error.message]).toEqual([400, 'invalid_request', 'the group has no speakers mapped to mics']);
  });
});
