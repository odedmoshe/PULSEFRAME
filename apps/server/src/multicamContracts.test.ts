/**
 * Lead contracts of multicam (ADR-0020) on the server: the three routes are registered and documented, check the credential's
 * scope (a sync that commits needs edit; a dryRun only observe), the body and that the project, group or file exists, and then
 * answer 501 not_built until W2 builds them (multicamSync.ts). Nothing is measured or committed here. The recipe route answers
 * the auto-switch's not-built refusal with 501 too.
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

describe('multicam routes (contract; bodies are W2\'s)', () => {
  it('the group exists in the stored project, put there through an operation', () => {
    expect(store.getProject(pid).doc.multicam?.mcg_1?.angles).toHaveLength(2);
  });
  it('sync: a commit needs edit, a dryRun only observe; a bad body is 400; an unknown group 404; then 501 not_built', async () => {
    expect((await rest('POST', `/projects/${pid}/multicam/mcg_1/sync`, {}, auth.tokens.observer)).status).toBe(403);
    expect((await rest('POST', `/projects/${pid}/multicam/mcg_1/sync`, { nope: 1 })).status).toBe(400);
    const missing = await rest('POST', `/projects/${pid}/multicam/mcg_none/sync`, {});
    expect([missing.status, missing.body.error.code, missing.body.error.message]).toEqual([404, 'not_found', 'multicam group mcg_none not found']);
    for (const [body, t] of [[{ dryRun: true }, auth.tokens.observer], [{}, auth.tokens.agent], [{ background: true }, auth.tokens.agent]] as const) {
      const r = await rest('POST', `/projects/${pid}/multicam/mcg_1/sync`, body, t);
      expect([r.status, r.body.error.code]).toEqual([501, 'not_built']);
    }
  });
  it('the group view and the envelope: observe, 404 for what is not there, then 501 not_built', async () => {
    expect((await rest('GET', `/projects/${pid}/multicam/toString`, undefined, auth.tokens.observer)).status).toBe(404);
    expect((await rest('GET', `/projects/${pid}/multicam/mcg_1`, undefined, auth.tokens.observer)).status).toBe(501);
    expect((await rest('POST', `/projects/${pid}/assets/ast_none/derivatives/envelope`, undefined, auth.tokens.observer)).status).toBe(404);
    expect((await rest('POST', `/projects/${pid}/assets/${A}/derivatives/envelope`, undefined, auth.tokens.observer)).status).toBe(501);
  });
  it('the auto-switch recipe is listed and its plan answers 501 not_built', async () => {
    const r = await rest('POST', `/projects/${pid}/recipes/multicam-auto/plan`, { params: { groupId: 'mcg_1' } });
    expect([r.status, r.body.error.code]).toEqual([501, 'not_built']);
  });
});
