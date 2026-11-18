/**
 * The live switching session (ADR-0020), pure. The record / commit-argument / splitting tests need only the session itself.
 * The tests that apply a step to a document (ripple, cut out, projection) need the switch_angles body of core (W1,
 * MULTICAM_OPS_BUILT): until it is merged they are skipped, and they say so in their names.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, MAX_CUTS, MULTICAM_OPS_BUILT, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { commitOps, commitParts, effectiveCuts, projection, projectionResult, record, reportOf, startSession, type MulticamSession } from './multicamSession.ts';

const R = { num: 30, den: 1 };
const g = (frames: number) => T.frameTime(frames, R);
const base: MulticamSession = { groupId: 'mcg_1', sequenceId: 'seq_1', trackId: 'trk_v', cuts: [], baseRevision: 7, reactionFrames: 0 };

describe('record and commit arguments', () => {
  it('record adds a cut in group time and never changes the session it was given', () => {
    const s1 = record(base, g(30), 'ang_a');
    const s2 = record(s1, g(60), 'ang_b');
    expect(base.cuts).toEqual([]);
    expect(s1.cuts).toHaveLength(1);
    expect(s2.cuts.map((c) => c.angleId)).toEqual(['ang_a', 'ang_b']);
  });
  it('commitOps is ONE switch_angles with group-time cuts, coverage clip and the program named', () => {
    const s = record(record(base, g(30), 'ang_a'), g(75), 'ang_b');
    const ops = commitOps(s)!;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ op: 'switch_angles', args: { groupId: 'mcg_1', sequenceId: 'seq_1', trackId: 'trk_v', cuts: [{ groupTime: g(30), angleId: 'ang_a' }, { groupTime: g(75), angleId: 'ang_b' }], coverage: 'clip' } });
    expect(JSON.stringify(ops)).not.toContain('"at"'); // never timeline times
    expect(commitParts(s)[0]!.label).toBe('החלפת זוויות');
  });
  it('the last press at the same group time wins', () => {
    const s = record(record(record(base, g(30), 'ang_a'), g(60), 'ang_b'), g(30), 'ang_c');
    expect(effectiveCuts(s).map((c) => [c.groupTime.value, c.angleId])).toEqual([[g(60).value, 'ang_b'], [g(30).value, 'ang_c']]);
  });
  it('nothing recorded commits nothing', () => { expect(commitParts(base)).toEqual([]); expect(commitOps(base)).toBeNull(); });
});

describe('more than MAX_CUTS cuts', () => {
  it('split into labelled parts of at most MAX_CUTS cuts, in order, every cut once', () => {
    let s = base;
    const n = MAX_CUTS * 2 + 5;
    for (let i = 0; i < n; i++) s = record(s, g(i + 1), i % 2 ? 'ang_a' : 'ang_b');
    const parts = commitParts(s);
    expect(parts.map((p) => p.label)).toEqual([1, 2, 3].map((k) => `החלפת זוויות · חלק ${k} מתוך 3`));
    const sizes = parts.map((p) => (p.ops[0]!.args as { cuts: unknown[] }).cuts.length);
    expect(sizes).toEqual([MAX_CUTS, MAX_CUTS, 5]);
    expect(commitOps(s)).toBeNull();
    const all = parts.flatMap((p) => (p.ops[0]!.args as { cuts: { groupTime: T.RationalTime }[] }).cuts.map((c) => c.groupTime.value));
    expect(all).toEqual(Array.from({ length: n }, (_, i) => g(i + 1).value));
  });
});

describe('the report', () => {
  it('sums cuts and skip reasons over the parts', () => {
    const o = (cuts: number, skipped: string[]) => ({ cuts: Array.from({ length: cuts }, () => ({ at: g(0), angleId: 'a' })), switchedClipIds: [], createdClipIds: [], healedClipIds: [], skipped: skipped.map((reason) => ({ reason })), dropped: [], warnings: [] }) as never;
    expect(reportOf([o(3, ['group_time_not_on_track']), o(2, ['group_time_not_on_track', 'gap']), undefined])).toMatchObject({ saved: 5, skipped: [{ reason: 'group_time_not_on_track', count: 2 }, { reason: 'gap', count: 1 }] });
  });
});

describe.skipIf(!MULTICAM_OPS_BUILT)('against core switch_angles (needs W1 merged)', () => {
  // A one-group project: two cameras and a recorder, placed over 10 s, built by the real ops.
  const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `t${Math.random()}_`, actor: 'test', allowInternal });
  function program() {
    const asset = (c: string, kind: 'video' | 'audio') => kind === 'video'
      ? { kind, name: `cam-${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 640, height: 360, codec: 'h264', frameRate: R, rotation: 0, frameCount: 1800 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' } }
      : { kind, name: 'mic.wav', contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' } };
    let r = tx(createProject({ id: 'prj_s', name: 'S', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: asset('a', 'video') } }, { op: 'import_asset', args: { asset: asset('b', 'video') } }, { op: 'import_asset', args: { asset: asset('c', 'audio') } }] as OpCall[], true);
    const [A, B, M] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
    r = tx(r.doc, [{ op: 'create_multicam', args: { name: 'S', angles: [{ assetIds: [A] }, { assetIds: [B] }, { assetIds: [M] }] } }]);
    const out = r.results[0]!.output as { groupId: string; angleIds: string[] };
    // sync: all three share group time 0 (offset 0), set by hand
    const ops: OpCall[] = out.angleIds.slice(0, 2).map((angleId) => ({ op: 'set_multicam_sync', args: { groupId: out.groupId, angleId, pieceIndex: 0, offset: T.ZERO } }));
    r = tx(r.doc, ops);
    r = tx(r.doc, [{ op: 'place_multicam', args: { groupId: out.groupId, at: T.ZERO, angleId: out.angleIds[0], range: { from: T.ZERO, to: T.rt(10, 1) } } }]);
    const p = r.results[0]!.output as { sequenceId: string; videoTrackId: string };
    return { doc: r.doc, groupId: out.groupId, angleIds: out.angleIds, seq: p.sequenceId, track: p.videoTrackId };
  }
  const clipsOf = (d: ProjectDocument, trackId: string) => d.sequences[d.mainSequenceId]!.tracks.find((t) => t.id === trackId)!.clips;
  it('projection shows the cuts and leaves the document alone; an empty session is the document', () => {
    const p = program();
    const s = record(startSession(p.doc, { groupId: p.groupId, sequenceId: p.seq, trackId: p.track, revision: 1 }), g(90), p.angleIds[1]!);
    const before = JSON.stringify(p.doc);
    const out = projection(p.doc, s);
    expect(JSON.stringify(p.doc)).toBe(before);
    expect(clipsOf(out, p.track).length).toBeGreaterThan(clipsOf(p.doc, p.track).length);
    expect(projection(p.doc, startSession(p.doc, { groupId: p.groupId, sequenceId: p.seq, trackId: p.track, revision: 1 }))).toBe(p.doc);
  });
  it('a group time recorded before a ripple still lands on the right frame after it', () => {
    const p = program();
    const s = record(startSession(p.doc, { groupId: p.groupId, sequenceId: p.seq, trackId: p.track, revision: 1 }), g(150), p.angleIds[1]!); // group 5 s
    // ripple: shift the whole program 2 s later (someone else's edit)
    const moved = tx(p.doc, [{ op: 'move_clips', args: { clipIds: clipsOf(p.doc, p.track).map((c) => c.id), delta: T.rt(2, 1) } }] as OpCall[]).doc;
    const r = projectionResult(moved, s);
    expect(r.refusal).toBeNull();
    const cutAt = clipsOf(r.doc, p.track).find((c) => c.type === 'media' && c.multicam?.angleId === p.angleIds[1]);
    expect(cutAt && T.toSeconds(cutAt.start)).toBeCloseTo(7, 6); // 5 s of group time is now 7 s on the timeline
  });
  it('a cut whose moment was cut out is reported as skipped', () => {
    const p = program();
    const s = record(startSession(p.doc, { groupId: p.groupId, sequenceId: p.seq, trackId: p.track, revision: 1 }), g(150), p.angleIds[1]!);
    const cutOut = tx(p.doc, [{ op: 'cut_range', args: { start: T.rt(4, 1), end: T.rt(6, 1) } }] as OpCall[]).doc;
    const r = projectionResult(cutOut, s);
    expect(r.output?.skipped.map((k) => k.reason)).toContain('group_time_not_on_track');
  });
});
