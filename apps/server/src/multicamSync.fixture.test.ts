/**
 * The multicam fixture (packages/fixtures multicam.ts: seeded speech from the narration sample) through sync by sound, sound
 * only: every angle gets the verdict its construction expects and the placed files their true offsets. A dry run, so the
 * attach operation (W1) is not needed.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { Asset, MulticamGroup } from '@pulseframe/core';
import { generateMulticamFixture, type MulticamFixture } from '../../../packages/fixtures/src/multicam.ts';
import { Derivatives } from './derive.ts';
import { Governance } from './governance.ts';
import { setMulticamDerivatives, syncMulticam } from './multicamSync.ts';
import { Store } from './store.ts';
import type { Principal } from './auth.ts';

let dir = '', store: Store, derivatives: Derivatives, fx: MulticamFixture, pid = '';
const owner = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'propose', 'edit', 'export', 'job', 'admin', 'people'] } as unknown as Principal;
const narration = path.resolve(__dirname, '../../../docs/demo/narration-sample-he.m4a');
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-mc-fixture-'));
  fx = await generateMulticamFixture({ outDir: path.join(dir, 'fx'), seconds: 75, seed: 4, narrationPath: narration, extras: true, video: false });
  store = new Store(path.join(dir, 'store'));
  derivatives = new Derivatives(store);
  setMulticamDerivatives(derivatives);
  pid = store.createProject({ name: 'fx', width: 320, height: 180, frameRate: { num: 30, den: 1 } }).doc.id;
  const q = (verdict: 'reference' | 'unsynced') => ({ verdict, peakZ: null, peakRatio: null, anchorsUsed: 0, anchorsRejected: 0, residualSamples: null, driftPpm: null, overlapSeconds: null, candidates: [], chainDepth: 0, jobId: null });
  const angles = fx.angles.map((a, i) => ({ id: `a${i}`, label: a.label, kind: 'sound' as const, pieces: a.files.map((f, k) => {
    const bytes = fs.readFileSync(f.path), hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`, tmp = `${f.path}.blob`;
    fs.copyFileSync(f.path, tmp);
    store.putBlob(hash, tmp, bytes.length, 'audio/wav');
    const channels = bytes.readUInt16LE(22), samples = (bytes.length - 44) / 2 / channels;
    const asset: Omit<Asset, 'id'> = { kind: 'audio', name: path.basename(f.path), contentHash: hash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(samples, fx.sampleRate), audio: { sampleRate: fx.sampleRate, channels, codec: 'pcm_s16le' }, provenance: { origin: 'fixture', importedAt: 'x', importedBy: 'test' } };
    const assetId = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
    return { assetId, anchors: i === 0 && k === 0 ? [{ group: T.ZERO, source: T.ZERO }] : [], quality: q(i === 0 && k === 0 ? 'reference' : 'unsynced') };
  }) }));
  const group: MulticamGroup = { id: 'mcg_fx', name: 'fx', sampleRate: fx.sampleRate, referenceAngleId: 'a0', wideAngleId: null, speakers: [], angles, origin: { method: 'test', params: {}, createdAt: 'x', createdBy: 'test', edited: false } };
  store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'restore_entities', args: { targets: [{ id: 'mcg_fx', state: { kind: 'multicamGroup', group } }] } }] });
}, 300_000);
afterAll(async () => { setMulticamDerivatives(null); await derivatives.stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('the multicam fixture through sync by sound', () => {
  it('every angle gets its expected verdict, and placed files their true offsets', async () => {
    const r = await syncMulticam(store, new Governance(store), owner, pid, 'mcg_fx', { dryRun: true });
    if ('jobId' in r) throw new Error('unexpected job');
    const seen = fx.angles.map((a, i) => ({ label: a.label, expect: a.expect, got: r.pieces.filter((p) => p.angleId === `a${i}`).map((p) => [p.verdict, p.offsetSeconds === null ? null : Math.round(p.offsetSeconds * fx.sampleRate), p.driftPpm]) }));
    for (const [i, a] of fx.angles.entries()) {
      const rows = r.pieces.filter((p) => p.angleId === `a${i}`);
      for (const p of rows) expect(p.verdict === a.expect || (a.expect === 'confident' && p.verdict === 'check'), JSON.stringify(seen)).toBe(true);
      if (a.expect === 'confident') a.files.forEach((f, k) => expect(Math.abs(Math.round(rows[k]!.offsetSeconds! * fx.sampleRate) - f.groupStartSamples), JSON.stringify(seen)).toBeLessThanOrEqual(a.truth.driftPpm ? 2 : 1));
      if (a.truth.driftPpm) for (const p of rows) expect(Math.abs(p.driftPpm! - a.truth.driftPpm)).toBeLessThanOrEqual(2);
      if (!['reference', 'confident'].includes(a.expect)) for (const p of rows) expect(p.anchors).toBe(0);
    }
  }, 300_000);
});
