/**
 * Regenerate (recipes.ts) after the in-place branch for the multicam auto-switch (ADR-0020 W2): beat-montage and tidy-speech
 * regenerate exactly as before (untouched clips removed and re-planned, hand-edited ones kept); the in-place recipe removes
 * nothing and keeps a hand-switched segment's fingerprint (needs the multicam operations, W1).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { findClip, fingerprint, MULTICAM_OPS_BUILT, type Asset, type MulticamGroup } from '@pulseframe/core';
import { Derivatives } from './derive.ts';
import { Governance } from './governance.ts';
import { setMulticamDerivatives } from './multicamSync.ts';
import { applyRecipe, regenerateRecipe } from './recipes.ts';
import { Store } from './store.ts';
import { speechAt, speechBursts, wav } from './multicamSync.fixtures.ts';
import type { Principal } from './auth.ts';

let dir: string, store: Store, gov: Governance, derivatives: Derivatives;
const owner: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'propose', 'edit', 'export', 'job', 'admin', 'people'] } as unknown as Principal;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
/** A content hash for a one-letter name: the import_asset schema wants 64 lowercase hex digits. */
const hashOf = (c: string) => `sha256:${c.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)}`;
const fake = (c: string, kind: 'video' | 'audio'): Omit<Asset, 'id'> => ({ kind, name: `${c}`, contentHash: hashOf(c), byteSize: 1, container: kind === 'video' ? 'mp4' : 'wav', mimeType: kind === 'video' ? 'video/mp4' : 'audio/wav', duration: T.rt(60, 1), ...(kind === 'video' ? { video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 1800 } } : { audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' } }), provenance: prov });
function realWav(pid: string, name: string, x: Float32Array, channels: number): string {
  const bytes = wav(x, 48000, channels), hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const tmp = path.join(dir, `${name}.wav`);
  fs.writeFileSync(tmp, bytes);
  store.putBlob(hash, tmp, bytes.length, 'audio/wav');
  const asset: Omit<Asset, 'id'> = { kind: 'audio', name, contentHash: hash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(x.length / channels, 48000), audio: { sampleRate: 48000, channels, codec: 'pcm_s16le' }, provenance: prov };
  return store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
}
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-recipes-regen-'));
  store = new Store(dir);
  gov = new Governance(store);
  derivatives = new Derivatives(store);
  setMulticamDerivatives(derivatives);
});
afterAll(async () => { setMulticamDerivatives(null); await derivatives.stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('regenerate after the in-place branch', () => {
  it('beat-montage: untouched clips are removed and re-planned, a hand-edited one is kept byte for byte', async () => {
    const pid = store.createProject({ name: 'bm', width: 640, height: 360, frameRate: R }).doc.id;
    const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: fake('a', 'audio') } }, { op: 'import_asset', args: { asset: fake('b', 'video') } }, { op: 'import_asset', args: { asset: fake('c', 'video') } }] });
    const [M, A, B] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
    const mc = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId: M, start: f(0) } }] }).results[0]!.output!;
    store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'attach_analysis', args: { assetId: M, kind: 'beats', method: 'test', params: {}, createdAt: 'x', times: Array.from({ length: 100 }, (_, i) => T.rt(i, 2)), bpm: 120, confidence: 1 } }] });
    const params = { musicClipId: (mc.audioClipId ?? mc.clipId) as string, assetIds: [A, B], everyBeats: 4 };
    const applied = await applyRecipe(store, gov, owner, pid, 'beat-montage', params);
    const created = applied.createdIds.filter((id: string) => findClip(store.getProject(pid).doc, id)?.track.kind === 'video');
    expect(created.length).toBeGreaterThanOrEqual(6);
    const edited = created[1]!;
    const c = findClip(store.getProject(pid).doc, edited)!.clip;
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'trim_clip', args: { clipId: edited, edge: 'end', to: T.sub(T.add(c.start, c.duration), f(10)) } }] });
    const before = structuredClone(findClip(store.getProject(pid).doc, edited)!.clip);
    const regen = await regenerateRecipe(store, gov, owner, pid, applied.runId, { ...params, everyBeats: 2 });
    expect(regen.protected).toEqual([edited]);
    expect(regen.replaced).toBe(created.length - 1);
    const doc = store.getProject(pid).doc;
    expect(findClip(doc, edited)!.clip).toEqual(before);
    for (const id of created.filter((x: string) => x !== edited)) expect(findClip(doc, id)).toBeFalsy();
  });
  it('tidy-speech: regenerating a run is planned on the document without its untouched clips, as before', async () => {
    const pid = store.createProject({ name: 'ts', width: 640, height: 360, frameRate: R }).doc.id;
    const bursts = speechBursts(5, 12);
    const x = Float32Array.from({ length: 12 * 48000 }, (_, i) => (i / 48000 > 4 && i / 48000 < 6 ? 0 : speechAt(bursts, i / 48000, 0.5)));
    const S = realWav(pid, 'speech.wav', x, 1);
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId: S, start: f(0) } }] });
    const applied = await applyRecipe(store, gov, owner, pid, 'tidy-speech', { assetId: S, captions: false, loudness: null });
    const rev = store.getProject(pid).revision;
    const regen = await regenerateRecipe(store, gov, owner, pid, applied.runId).catch((e) => e);
    // tidy-speech removes silences and creates no clips: regenerating it has nothing left to cut, or re-plans the same way
    if (regen instanceof Error) expect((regen as any).code).toBe('nothing_to_do');
    else { expect(regen.protected).toEqual([]); expect(store.getProject(pid).revision).toBe(rev + 1); }
  }, 60_000);
  it.skipIf(!MULTICAM_OPS_BUILT)('multicam-auto regenerates in place: nothing is removed, a hand-switched segment keeps its fingerprint', async () => {
    const pid = store.createProject({ name: 'mca', width: 640, height: 360, frameRate: R }).doc.id;
    const bursts = [speechBursts(1, 60), speechBursts(2, 60, 1.3)];
    const turn = (t: number) => Math.floor(t / 6) % 2; // host and guest take 6 s turns
    const st = new Float32Array(60 * 48000 * 2);
    for (let i = 0; i < 60 * 48000; i++) { const t = i / 48000, k = turn(t), v = speechAt(bursts[k]!, t, 0.4); st[2 * i + k] = v; st[2 * i + 1 - k] = 0.03 * v; }
    const MIC = realWav(pid, 'rec.wav', st, 2);
    const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: ['w', 'h', 'g'].map((c) => ({ op: 'import_asset', args: { asset: fake(c, 'video') } })) });
    const [W, H, G] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
    const created = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'create_multicam', args: { name: 'pod', angles: [{ kind: 'sound', assetIds: [MIC] }, { assetIds: [W] }, { assetIds: [H] }, { assetIds: [G] }] } }] }).results[0]!.output as { groupId: string; angleIds: string[] };
    const [mic, wide, host, guest] = created.angleIds as [string, string, string, string];
    store.commit({ projectId: pid, actor: 'user:owner', ops: [
      ...[wide, host, guest].map((angleId) => ({ op: 'set_multicam_sync', args: { groupId: created.groupId, angleId, pieceIndex: 0, offset: T.ZERO } })),
      { op: 'update_multicam', args: { groupId: created.groupId, wideAngleId: wide, speakers: [{ label: 'Host', micAngleId: mic, channel: 0, shotAngleId: host }, { label: 'Guest', micAngleId: mic, channel: 1, shotAngleId: guest }] } },
      { op: 'place_multicam', args: { groupId: created.groupId, at: T.ZERO, angleId: wide } },
    ] });
    const applied = await applyRecipe(store, gov, owner, pid, 'multicam-auto', { groupId: created.groupId });
    let doc = store.getProject(pid).doc;
    const seg = applied.createdIds.map((id: string) => findClip(doc, id)).find((x: any) => x && x.track.kind === 'video' && T.toSeconds(x.clip.start) > 10)!;
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'switch_angles', args: { groupId: created.groupId, cuts: [{ at: seg.clip.start, angleId: wide }], until: { at: T.add(seg.clip.start, seg.clip.duration) } } }] });
    doc = store.getProject(pid).doc;
    const hand = findClip(doc, seg.clip.id)!.clip;
    const regen = await regenerateRecipe(store, gov, owner, pid, applied.runId, { groupId: created.groupId, minShotSeconds: 3 });
    expect(regen.replaced).toBe(0);
    expect(regen.protected).toContain(seg.clip.id);
    doc = store.getProject(pid).doc;
    expect(fingerprint(findClip(doc, seg.clip.id)!.clip)).toBe(fingerprint(hand));
  }, 120_000);
});
