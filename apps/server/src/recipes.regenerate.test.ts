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
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { creativeProjection, findClip, fingerprint, MULTICAM_OPS_BUILT, planRecipe, validateProject, type Asset, type MulticamGroup } from '@pulseframe/core';
import { Derivatives } from './derive.ts';
import { Governance } from './governance.ts';
import { setMulticamDerivatives } from './multicamSync.ts';
import { applyRecipe, regenerateRecipe } from './recipes.ts';
import { ApiError, Store } from './store.ts';
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
  it('beat-montage: a clip deleted by hand stays deleted (its range stays empty, carried on in run.ranges); undo of the delete or restoreRemoved fills it again; replay is byte-identical', async () => {
    const pid = store.createProject({ name: 'bm-del', width: 640, height: 360, frameRate: R }).doc.id;
    const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: fake('d', 'audio') } }, { op: 'import_asset', args: { asset: fake('e', 'video') } }, { op: 'import_asset', args: { asset: fake('f', 'video') } }] });
    const [M, A, B] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
    const mc = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId: M, start: f(0) } }] }).results[0]!.output!;
    store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'attach_analysis', args: { assetId: M, kind: 'beats', method: 'test', params: {}, createdAt: 'x', times: Array.from({ length: 100 }, (_, i) => T.rt(i, 2)), bpm: 120, confidence: 1 } }] });
    const params = { musicClipId: (mc.audioClipId ?? mc.clipId) as string, assetIds: [A, B], everyBeats: 4 };
    const applied = await applyRecipe(store, gov, owner, pid, 'beat-montage', params);
    const pictures = () => { const d = store.getProject(pid).doc; return Object.values(d.sequences).flatMap((q) => q.tracks).filter((t) => t.kind === 'video').flatMap((t) => t.clips); };
    const run0 = store.getProject(pid).doc.recipeRuns[applied.runId]!;
    expect(Object.keys(run0.ranges ?? {}).sort()).toEqual([...run0.createdIds].filter((id) => !!findClip(store.getProject(pid).doc, id)).sort());
    const gone = pictures()[2]!;
    const [from, to] = [gone.start, T.add(gone.start, gone.duration)];
    const over = () => pictures().filter((c) => T.lt(c.start, to) && T.lt(from, T.add(c.start, c.duration)));
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'delete_clip', args: { clipId: gone.id } }] });
    const regen = await regenerateRecipe(store, gov, owner, pid, applied.runId, params);
    expect(regen.removed).toEqual([gone.id]);
    expect(regen.steps.join(' ')).toMatch(/empty because their clips were deleted by hand/);
    expect(over()).toEqual([]);
    expect(store.getProject(pid).doc.recipeRuns[applied.runId]!.ranges![gone.id]).toEqual({ start: from, end: to });
    // another cut rate still leaves the deleted range empty
    const again = await regenerateRecipe(store, gov, owner, pid, applied.runId, { ...params, everyBeats: 2 });
    expect([again.removed, over()]).toEqual([[gone.id], []]);
    expect(JSON.stringify(store.replay(pid, store.getProject(pid).revision).doc)).toBe(JSON.stringify(store.getProject(pid).doc));
    // restoreRemoved: the range is filled again and the deleted clip is forgotten
    const back = await regenerateRecipe(store, gov, owner, pid, applied.runId, params, { restoreRemoved: true });
    expect(back.removed).toEqual([]);
    expect(over().length).toBeGreaterThan(0);
    expect(store.getProject(pid).doc.recipeRuns[applied.runId]!.ranges![gone.id]).toBeUndefined();
    // delete one, undo the delete: the regeneration treats it as untouched (nothing removed, the range filled)
    const one = over()[0]!;
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'delete_clip', args: { clipId: one.id } }] });
    store.undo(pid, 'user:owner', 'undo');
    const undone = await regenerateRecipe(store, gov, owner, pid, applied.runId, params);
    expect(undone.removed).toEqual([]);
    expect(over().length).toBeGreaterThan(0);
    expect(JSON.stringify(store.replay(pid, store.getProject(pid).revision).doc)).toBe(JSON.stringify(store.getProject(pid).doc));
  });
  describe('beat-montage: a clip that a delete moved (it closed the gap before it) is not edited by hand; a clip dragged by hand is (ADR-0016 decision 6, amendment of 2026-11-24)', () => {
    const SIX = [[0, 60], [60, 120], [120, 180], [180, 240], [240, 300], [300, 360]];
    /** A project with 12 s of music (a beat every half second) on the timeline and two long videos. */
    function montageProject(name: string, letters: [string, string, string], musicAt = 0) {
      const pid = store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
      const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { ...fake(letters[0], 'audio'), duration: T.rt(12, 1) } } }, { op: 'import_asset', args: { asset: fake(letters[1], 'video') } }, { op: 'import_asset', args: { asset: fake(letters[2], 'video') } }] });
      const [M, A, B] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
      const mc = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId: M, start: f(musicAt) } }] }).results[0]!.output!;
      store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'attach_analysis', args: { assetId: M, kind: 'beats', method: 'test', params: {}, createdAt: 'x', times: Array.from({ length: 24 }, (_, i) => T.rt(i, 2)), bpm: 120, confidence: 1 } }] });
      const params = { musicClipId: (mc.audioClipId ?? mc.clipId) as string, assetIds: [A, B], everyBeats: 4 };
      const pictures = () => Object.values(store.getProject(pid).doc.sequences).flatMap((q) => q.tracks).filter((t) => t.kind === 'video').flatMap((t) => t.clips).sort((x, y) => T.cmp(x.start, y.start));
      const at = () => pictures().map((c) => [T.nearestFrameIndex(c.start, R), T.nearestFrameIndex(T.add(c.start, c.duration), R)]);
      return { pid, params, pictures, at, A };
    }

    it('after a Delete that closes the gap the later clips are placed again on the beat (not kept one segment early), the deleted clip\'s place stays empty and is the only one named; restoreRemoved fills it; exact undo', async () => {
      const m = montageProject('bm-ripple', ['g', 'h', 'i']);
      const applied = await applyRecipe(store, gov, owner, m.pid, 'beat-montage', m.params);
      const doc0 = store.getProject(m.pid).doc;
      expect(m.at()).toEqual(SIX);
      // the run records each clip's place with its track
      for (const c of m.pictures()) expect(doc0.recipeRuns[applied.runId]!.ranges![c.id]).toEqual({ start: c.start, end: T.add(c.start, c.duration), trackId: findClip(doc0, c.id)!.track.id });
      const before = m.pictures();
      store.commit({ projectId: m.pid, actor: 'user:owner', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [before[2]!.id] } }] });
      const rippled = store.getProject(m.pid).doc;
      expect(m.at()).toEqual(SIX.slice(0, 5));
      const survivors = before.slice(3).map((c) => c.id);
      const regen = await regenerateRecipe(store, gov, owner, m.pid, applied.runId, m.params);
      expect([regen.protected, regen.replaced, regen.removed, [...(regen.movedBack ?? [])].sort()]).toEqual([[], 5, [before[2]!.id], [...survivors].sort()]);
      expect(regen.steps.join(' ')).toMatch(/Place 3 clip\(s\) again that had moved earlier only because a delete before them closed the gap/);
      expect(regen.steps.join(' ')).not.toMatch(/edited by hand/);
      let doc = store.getProject(m.pid).doc;
      expect(validateProject(doc)).toEqual([]);
      for (const id of survivors) expect(findClip(doc, id)).toBeFalsy();
      expect(m.at()).toEqual(SIX.filter((_, i) => i !== 2)); // every clip on its beat; the deleted clip's segment empty
      // restoreRemoved: the place is filled again
      const back = await regenerateRecipe(store, gov, owner, m.pid, applied.runId, m.params, { restoreRemoved: true });
      expect([back.protected, back.removed, back.movedBack, m.at()]).toEqual([[], [], [], SIX]);
      doc = store.getProject(m.pid).doc;
      expect(JSON.stringify(store.replay(m.pid, store.getProject(m.pid).revision).doc)).toBe(JSON.stringify(doc));
      store.undo(m.pid, 'user:owner', 'undo'); store.undo(m.pid, 'user:owner', 'undo');
      expect(creativeProjection(store.getProject(m.pid).doc)).toBe(creativeProjection(rippled));
      store.undo(m.pid, 'user:owner', 'undo');
      expect(creativeProjection(store.getProject(m.pid).doc)).toBe(creativeProjection(doc0));
      // the button at once after the Delete: one regeneration gives the whole montage back, on the beat
      store.commit({ projectId: m.pid, actor: 'user:owner', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [before[2]!.id] } }] });
      const at = await regenerateRecipe(store, gov, owner, m.pid, applied.runId, m.params, { restoreRemoved: true });
      expect([at.protected, at.removed, at.movedBack?.length, m.at()]).toEqual([[], [], 3, SIX]);
    });

    it('a clip dragged by hand, with nothing else changed, is kept where the person put it ("left alone because edited by hand"); so is one dragged after a delete, one moved by the delete and trimmed, and one taken to another track (still at the next regeneration)', async () => {
      // dragged later by half a second, no delete anywhere: no deleted length lies before it, so the move is the person's
      const d = montageProject('bm-dragged', ['j', 'k', 'l']);
      const dragged = await applyRecipe(store, gov, owner, d.pid, 'beat-montage', d.params);
      const last = d.pictures()[5]!;
      store.commit({ projectId: d.pid, actor: 'user:owner', ops: [{ op: 'move_clip', args: { clipId: last.id, start: f(315) } }] });
      const keptLast = structuredClone(findClip(store.getProject(d.pid).doc, last.id)!.clip);
      const rd = await regenerateRecipe(store, gov, owner, d.pid, dragged.runId, d.params);
      expect([rd.protected, rd.movedBack, rd.removed]).toEqual([[last.id], [], []]);
      expect(rd.steps.join(' ')).toMatch(/Leave 1 segment\(s\) alone because they hold clips edited by hand/);
      expect(findClip(store.getProject(d.pid).doc, last.id)!.clip).toEqual(keptLast);
      expect(validateProject(store.getProject(d.pid).doc)).toEqual([]);
      // a Delete closed the gap before it AND it was dragged 15 frames on: it did not move by the deleted length, so it is kept;
      // the other clips the delete moved are placed again
      const e = montageProject('bm-dragged-after-delete', ['s', 't', 'u']);
      const made0 = await applyRecipe(store, gov, owner, e.pid, 'beat-montage', e.params);
      const e0 = e.pictures();
      store.commit({ projectId: e.pid, actor: 'user:owner', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [e0[2]!.id] } }, { op: 'move_clip', args: { clipId: e0[5]!.id, start: f(255) } }] });
      const re = await regenerateRecipe(store, gov, owner, e.pid, made0.runId, e.params);
      expect([re.protected, [...(re.movedBack ?? [])].sort(), re.removed]).toEqual([[e0[5]!.id], [e0[3]!.id, e0[4]!.id].sort(), [e0[2]!.id]]);
      expect(T.nearestFrameIndex(findClip(store.getProject(e.pid).doc, e0[5]!.id)!.clip.start, R)).toBe(255);
      expect(validateProject(store.getProject(e.pid).doc)).toEqual([]);
      // moved by the delete and trimmed: edited
      const m = montageProject('bm-ripple-edited', ['v', 'w', 'x']);
      const applied = await applyRecipe(store, gov, owner, m.pid, 'beat-montage', m.params);
      const before = m.pictures();
      store.commit({ projectId: m.pid, actor: 'user:owner', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [before[2]!.id] } }, { op: 'trim_clip', args: { clipId: before[3]!.id, edge: 'end', to: f(170) } }] });
      const kept = structuredClone(findClip(store.getProject(m.pid).doc, before[3]!.id)!.clip);
      const regen = await regenerateRecipe(store, gov, owner, m.pid, applied.runId, m.params);
      expect([regen.protected, [...(regen.movedBack ?? [])].sort(), regen.removed]).toEqual([[before[3]!.id], [before[4]!.id, before[5]!.id].sort(), [before[2]!.id]]);
      expect(findClip(store.getProject(m.pid).doc, before[3]!.id)!.clip).toEqual(kept);
      expect(validateProject(store.getProject(m.pid).doc)).toEqual([]);
      // another montage: one clip taken to another picture track, at its own time
      const n = montageProject('bm-other-track', ['m', 'n', 'o']);
      const made = await applyRecipe(store, gov, owner, n.pid, 'beat-montage', n.params);
      const first = n.pictures();
      const other = store.commit({ projectId: n.pid, actor: 'user:owner', ops: [{ op: 'add_track', args: { kind: 'video' } }] }).results[0]!.output!.trackId as string;
      store.commit({ projectId: n.pid, actor: 'user:owner', ops: [{ op: 'move_clip', args: { clipId: first[1]!.id, start: f(60), trackId: other } }] });
      for (let i = 0; i < 2; i++) {
        const r = await regenerateRecipe(store, gov, owner, n.pid, made.runId, n.params);
        expect([r.protected, r.movedBack, findClip(store.getProject(n.pid).doc, first[1]!.id)!.track.id, n.at()], `regeneration ${i + 1}`).toEqual([[first[1]!.id], [], other, SIX]);
      }
    });

    it('several deletes add up; a delete that kept its gap and a later one that closed its gap: the clips after both moved by the closed length and are placed again; a delete of a clip the montage did not make explains no move: those clips stay kept, and the montage stays valid with no picture over another', async () => {
      const noOverlap = (at: number[][]) => at.every(([s2], i) => i === 0 || s2! >= at[i - 1]![1]!);
      // two Deletes that each closed the gap: the clips after both moved by two segments and are placed again
      const m = montageProject('bm-two-deletes', ['y', 'z', 'A']);
      const applied = await applyRecipe(store, gov, owner, m.pid, 'beat-montage', m.params);
      const p0 = m.pictures();
      store.commit({ projectId: m.pid, actor: 'user:owner', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [p0[1]!.id] } }] });
      store.commit({ projectId: m.pid, actor: 'user:owner', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [p0[3]!.id] } }] });
      expect(m.at()).toEqual(SIX.slice(0, 4));
      const r = await regenerateRecipe(store, gov, owner, m.pid, applied.runId, m.params);
      expect([r.protected, [...(r.movedBack ?? [])].sort(), [...(r.removed ?? [])].sort(), m.at()]).toEqual([[], [p0[2]!.id, p0[4]!.id, p0[5]!.id].sort(), [p0[1]!.id, p0[3]!.id].sort(), SIX.filter((_, i) => i !== 1 && i !== 3)]);
      const back = await regenerateRecipe(store, gov, owner, m.pid, applied.runId, m.params, { restoreRemoved: true });
      expect([back.protected, back.removed, m.at()]).toEqual([[], [], SIX]);
      // one clip deleted with its gap KEPT and a later one with its gap closed: the clips after both moved by one segment while two
      // are gone before them. Each gone clip closed its gap or kept it, and the reading that fits the track (the clips between
      // them did not move) explains the move: they are placed again on the beat, not kept (amendment of 2026-11-25)
      const u = montageProject('bm-mixed-deletes', ['B', 'C', 'D']);
      const mixed = await applyRecipe(store, gov, owner, u.pid, 'beat-montage', u.params);
      const u0 = u.pictures();
      store.commit({ projectId: u.pid, actor: 'user:owner', ops: [{ op: 'delete_clip', args: { clipId: u0[0]!.id } }, { op: 'ripple_delete_clips', args: { clipIds: [u0[3]!.id] } }] });
      const ru = await regenerateRecipe(store, gov, owner, u.pid, mixed.runId, u.params);
      // the clips between the two deletes did not move (untouched, replaced); those after the closing delete are put back
      expect([ru.protected, [...(ru.movedBack ?? [])].sort(), [...(ru.removed ?? [])].sort()]).toEqual([[], [u0[4]!.id, u0[5]!.id].sort(), [u0[0]!.id, u0[3]!.id].sort()]);
      expect([validateProject(store.getProject(u.pid).doc), noOverlap(u.at()), u.at()]).toEqual([[], true, SIX.filter((_, i) => i !== 0 && i !== 3)]);
      // a clip the montage did not make, before the montage on its picture track, deleted with its gap closed: every clip moved,
      // none of the montage's own clips is gone, so every clip is kept as moved by hand (as before the rule)
      const v = montageProject('bm-foreign-delete', ['E', 'F', 'G'], 60);
      const pid = v.pid;
      const foreign = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId: v.A, start: f(0), duration: f(60), withLinkedAudio: false } }] }).results[0]!.output!.clipId as string;
      const later = await applyRecipe(store, gov, owner, pid, 'beat-montage', v.params);
      const v0 = v.pictures().filter((c) => c.id !== foreign);
      expect([v0.length, T.nearestFrameIndex(v0[0]!.start, R), new Set([foreign, ...v0.map((c) => c.id)].map((id) => findClip(store.getProject(pid).doc, id)!.track.id)).size]).toEqual([6, 60, 1]);
      store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [foreign] } }] });
      expect(v.at()).toEqual(SIX);
      const rv = await regenerateRecipe(store, gov, owner, pid, later.runId, v.params);
      expect([[...rv.protected].sort(), rv.movedBack, rv.removed]).toEqual([v0.map((c) => c.id).sort(), [], []]);
      // the six kept clips lie one segment early, and the last segment of the music, now free, gets a new clip: no overlap, no gap
      expect([validateProject(store.getProject(pid).doc), v.at()]).toEqual([[], [...SIX, [360, 420]]]);
    });

    it('Shift+Delete then Delete, and Delete then Shift+Delete, before the same clips: they moved by the one closed segment and are placed again on the beat, not kept one segment early; a clip dragged by hand after the two deletes is still kept where it was put', async () => {
      const keepGap = (id: string) => ({ op: 'delete_clip', args: { clipId: id } }), closeGap = (id: string) => ({ op: 'ripple_delete_clips', args: { clipIds: [id] } });
      const hand = (pid: string, op: { op: string; args: unknown }) => store.commit({ projectId: pid, actor: 'user:owner', ops: [op] });
      for (const [name, letters, first, second] of [['bm-kept-then-closed', ['H', 'I', 'J'], keepGap, closeGap], ['bm-closed-then-kept', ['K', 'L', 'M'], closeGap, keepGap]] as const) {
        const m = montageProject(name, [...letters]);
        const applied = await applyRecipe(store, gov, owner, m.pid, 'beat-montage', m.params);
        const p0 = m.pictures();
        hand(m.pid, first(p0[0]!.id));
        hand(m.pid, second(p0[1]!.id));
        // the four later clips lie one segment early, while two clips are gone before them
        expect(m.at(), name).toEqual(SIX.slice(1, 5));
        const held = store.getProject(m.pid).doc;
        const r = await regenerateRecipe(store, gov, owner, m.pid, applied.runId, m.params);
        expect([r.protected, [...(r.movedBack ?? [])].sort(), [...(r.removed ?? [])].sort(), m.at()], name).toEqual([[], p0.slice(2).map((c) => c.id).sort(), [p0[0]!.id, p0[1]!.id].sort(), SIX.slice(2)]);
        expect(validateProject(store.getProject(m.pid).doc), name).toEqual([]);
        store.undo(m.pid, 'user:owner', 'undo');
        expect(creativeProjection(store.getProject(m.pid).doc), name).toBe(creativeProjection(held));
      }
      // the same two deletes, then the last clip dragged 15 frames on by hand: no reading of the deletes gives that amount, so it
      // is kept where it was put; the clips before it, which only the delete moved, are still placed again
      const d = montageProject('bm-two-deletes-then-drag', ['N', 'O', 'P']);
      const made = await applyRecipe(store, gov, owner, d.pid, 'beat-montage', d.params);
      const d0 = d.pictures();
      hand(d.pid, keepGap(d0[0]!.id));
      hand(d.pid, closeGap(d0[1]!.id));
      hand(d.pid, { op: 'move_clip', args: { clipId: d0[5]!.id, start: f(255) } });
      const kept = structuredClone(findClip(store.getProject(d.pid).doc, d0[5]!.id)!.clip);
      const rd = await regenerateRecipe(store, gov, owner, d.pid, made.runId, d.params);
      expect([rd.protected, [...(rd.movedBack ?? [])].sort()]).toEqual([[d0[5]!.id], [d0[2]!.id, d0[3]!.id, d0[4]!.id].sort()]);
      expect(findClip(store.getProject(d.pid).doc, d0[5]!.id)!.clip).toEqual(kept);
      const at = d.at();
      expect([validateProject(store.getProject(d.pid).doc), at.every(([s2], i) => i === 0 || s2! >= at[i - 1]![1]!)]).toEqual([[], true]);
    });

    it('property (seeded): after hand edits (deletes that close the gap, drags, deletes that keep the gap, trims, turns) a regeneration leaves a valid montage with no two pictures on the same frames, undoes exactly and replays; after deletes alone, gap-closing and gap-keeping in any order, every clip is back on its beat and nothing is kept; while none of the montage\'s clips is deleted every dragged clip is kept where it was put', async () => {
      const tally = { runs: 0, ripples: 0, gapKeeping: 0, drags: 0, deletesOnly: 0, mixedDeletesOnly: 0, noDelete: 0, movedBack: 0, kept: 0, draggedKept: 0 };
      let project = 0;
      await fc.assert(fc.asyncProperty(fc.array(fc.tuple(fc.nat(7), fc.nat(20), fc.nat(50)), { minLength: 1, maxLength: 4 }), fc.boolean(), async (edits, restore) => {
        const letters = [0, 1, 2].map((i) => String.fromCharCode(0x80 + ((project * 3 + i) % 0x80))) as [string, string, string];
        const m = montageProject(`bm-prop-${project++}`, letters);
        const applied = await applyRecipe(store, gov, owner, m.pid, 'beat-montage', m.params);
        const done = new Set<string>();
        for (const [kind, pick, amount] of edits) {
          const pics = m.pictures();
          if (!pics.length) break;
          const c = pics[pick % pics.length]!, start = T.nearestFrameIndex(c.start, R);
          const [name, op] = ([
            ['ripple', { op: 'ripple_delete_clips', args: { clipIds: [c.id] } }],
            ['ripple', { op: 'ripple_delete_clips', args: { clipIds: [c.id] } }],
            // a drag needs room: the last clip is dragged later (there is always room after it), any clip earlier (into a gap, if one is there)
            ['drag', { op: 'move_clip', args: { clipId: pics.at(-1)!.id, start: f(T.nearestFrameIndex(pics.at(-1)!.start, R) + 1 + amount) } }],
            ['drag', { op: 'move_clip', args: { clipId: c.id, start: f(Math.max(0, start - 1 - amount)) } }],
            ['delete', { op: 'delete_clip', args: { clipId: c.id } }],
            ['delete', { op: 'delete_clip', args: { clipId: c.id } }],
            ['trim', { op: 'trim_clip', args: { clipId: c.id, edge: 'end', to: f(start + 10 + (amount % 40)) } }],
            ['turn', { op: 'set_clip_transform', args: { clipId: c.id, transform: { rotation: 1 + amount } } }],
          ] as const)[kind]!;
          try { store.commit({ projectId: m.pid, actor: 'user:owner', ops: [op] }); done.add(name); if (name === 'ripple') tally.ripples++; if (name === 'delete') tally.gapKeeping++; if (name === 'drag') tally.drags++; } catch (e) { if (!(e instanceof ApiError)) throw e; }
        }
        const held = store.getProject(m.pid).doc, run = held.recipeRuns[applied.runId]!;
        const live = run.createdIds.filter((id) => !!findClip(held, id));
        // the clips that lie somewhere else than the run placed them, by the run's own record
        const displaced = live.filter((id) => !T.eq(findClip(held, id)!.clip.start, run.ranges![id]!.start));
        let r: Awaited<ReturnType<typeof regenerateRecipe>>;
        try { r = await regenerateRecipe(store, gov, owner, m.pid, applied.runId, m.params, { restoreRemoved: restore }); } catch (e) {
          if (!(e instanceof ApiError) || e.code !== 'nothing_to_do') throw e;
          if (JSON.stringify(store.getProject(m.pid).doc) !== JSON.stringify(held)) throw new Error('a refusal changed the project');
          return true;
        }
        tally.runs++;
        const doc = store.getProject(m.pid).doc;
        if (validateProject(doc).length) throw new Error(`invalid: ${JSON.stringify(validateProject(doc))}`);
        for (const id of r.protected) if (JSON.stringify(findClip(doc, id)?.clip) !== JSON.stringify(findClip(held, id)!.clip)) throw new Error(`kept clip ${id} changed`);
        // every clip that is neither kept nor said to be put back was where the run placed it (untouched)
        for (const id of live) if (!r.protected.includes(id) && !(r.movedBack ?? []).includes(id) && displaced.includes(id)) throw new Error(`clip ${id} was moved, yet neither kept nor named as put back`);
        if ((r.movedBack ?? []).some((id) => !displaced.includes(id)) || ((r.movedBack ?? []).length && live.length === run.createdIds.length)) throw new Error('clips were put back although none of the montage\'s clips was deleted');
        const at = m.at();
        if (at.some(([s2], i) => i > 0 && s2! < at[i - 1]![1]!)) throw new Error(`pictures overlap: ${JSON.stringify(at)}`);
        // deletes alone, each with its gap closed or kept, in any order: every clip lies where those deletes left it, so none is a hand edit
        if (done.size > 0 && [...done].every((x) => x === 'ripple' || x === 'delete')) {
          tally.deletesOnly++;
          if (done.size === 2) tally.mixedDeletesOnly++;
          if (r.protected.length || at.some(([s2, e2]) => s2! % 60 !== 0 || e2! - s2! !== 60)) throw new Error(`only deletes, yet not every clip is on its beat: ${JSON.stringify({ at, protected: r.protected, done: [...done] })}`);
          if (restore && JSON.stringify(at) !== JSON.stringify(SIX)) throw new Error(`restoreRemoved after deletes alone did not give the whole montage: ${JSON.stringify(at)}`);
        }
        if (!done.has('ripple') && !done.has('delete')) {
          // none of the montage's clips is gone, so no move is explained by a delete: every displaced clip was dragged and is kept
          tally.noDelete++;
          const lost = displaced.filter((id) => !r.protected.includes(id));
          if (lost.length || (r.movedBack ?? []).length) throw new Error(`a clip dragged by hand was not kept: ${JSON.stringify({ lost, movedBack: r.movedBack })}`);
          if (displaced.length) tally.draggedKept++;
        }
        if ((r.movedBack ?? []).length) tally.movedBack++;
        if (r.protected.length) tally.kept++;
        for (const id of r.removed ?? []) { const g = run.ranges![id]!; const [gs, ge] = [T.nearestFrameIndex(g.start, R), T.nearestFrameIndex(g.end, R)]; if (at.some(([s2, e2]) => s2! <= gs && ge <= e2!)) throw new Error(`removed names ${id}, whose whole range holds a clip`); }
        if (JSON.stringify(store.replay(m.pid, store.getProject(m.pid).revision).doc) !== JSON.stringify(doc)) throw new Error('replay differs');
        store.undo(m.pid, 'user:owner', 'undo');
        if (creativeProjection(store.getProject(m.pid).doc) !== creativeProjection(held)) throw new Error('undo of the regeneration is not exact');
        return true;
      }), { numRuns: Number(process.env.PF_PROPERTY_RUNS ?? 40), seed: Number(process.env.PF_PROPERTY_SEED ?? 20261124) });
      console.log(`beat-montage regeneration after hand edits (property): ${JSON.stringify(tally)}`);
      expect(tally.ripples).toBeGreaterThan(5);
      expect(tally.drags).toBeGreaterThan(5);
      expect(tally.gapKeeping).toBeGreaterThan(5);
      expect(tally.deletesOnly).toBeGreaterThan(1);
      expect(tally.mixedDeletesOnly).toBeGreaterThan(0);
      expect(tally.movedBack).toBeGreaterThan(1);
      expect(tally.draggedKept).toBeGreaterThan(1);
    }, 300_000);

    it('a montage made before tracks were recorded keeps the clips a Delete moved, as before; the answer no longer names the deleted clip as removed when a kept clip lies on its whole range', async () => {
      const m = montageProject('bm-ripple-older', ['p', 'q', 'r']);
      // as a server before this amendment committed it: recordRanges without recordTracks
      const doc = store.getProject(m.pid).doc;
      const plan = planRecipe(doc, 'beat-montage', m.params, {});
      const runId = store.commit({ projectId: m.pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'apply_recipe', args: { recipeId: 'beat-montage', params: plan.params, steps: plan.steps, ops: plan.ops, recordRanges: true } }] }).results[0]!.output!.runId as string;
      const before = m.pictures();
      expect(store.getProject(m.pid).doc.recipeRuns[runId]!.ranges![before[0]!.id]).toEqual({ start: f(0), end: f(60) });
      store.commit({ projectId: m.pid, actor: 'user:owner', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [before[2]!.id] } }] });
      const survivors = before.slice(3).map((c) => c.id);
      const shifted = structuredClone(m.pictures().filter((c) => survivors.includes(c.id)));
      const regen = await regenerateRecipe(store, gov, owner, m.pid, runId, m.params);
      // the three shifted clips are kept byte for byte (no track was recorded to check them against), the freed last segment is
      // filled, and nothing is named as removed: a kept clip lies on the deleted clip's old range
      expect([[...regen.protected].sort(), regen.replaced, regen.removed, regen.movedBack]).toEqual([[...survivors].sort(), 2, [], []]);
      expect(m.pictures().filter((c) => survivors.includes(c.id))).toEqual(shifted);
      expect(m.at()).toEqual(SIX);
      expect(validateProject(store.getProject(m.pid).doc)).toEqual([]);
      // the record still remembers the deleted clip's place, so nothing is forgotten if the kept clips go later
      expect(store.getProject(m.pid).doc.recipeRuns[runId]!.ranges![before[2]!.id]).toEqual({ start: f(120), end: f(180) });
      expect(JSON.stringify(store.replay(m.pid, store.getProject(m.pid).revision).doc)).toBe(JSON.stringify(store.getProject(m.pid).doc));
    });
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
    // a segment deleted by hand stays deleted: the in-place regeneration plans on the document as it is, and switch_angles never
    // fills a gap (it skips it), so nothing is made where the segment was (ADR-0016 decision 6; checked, no change needed)
    const prog = findClip(doc, seg.clip.id)!.track;
    const victim = prog.clips.find((c) => c.id !== seg.clip.id && T.toSeconds(c.start) > 1 && T.toSeconds(c.start) < 9)!;
    const [from, to] = [victim.start, T.add(victim.start, victim.duration)];
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'delete_clip', args: { clipId: victim.id } }] });
    const covering = () => { const d = store.getProject(pid).doc; return Object.values(d.sequences).flatMap((q) => q.tracks).filter((t) => t.id === prog.id).flatMap((t) => t.clips).filter((c) => T.lt(c.start, to) && T.lt(from, T.add(c.start, c.duration))); };
    expect(covering()).toEqual([]);
    await regenerateRecipe(store, gov, owner, pid, applied.runId, { groupId: created.groupId });
    expect(covering()).toEqual([]);
  }, 120_000);
});
