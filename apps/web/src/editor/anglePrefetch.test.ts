/**
 * The prefetch scheduler of multicam (anglePrefetch.ts): which angles it chooses, in which order, and at which source time. The
 * project is built through the real operations (create_multicam, set_multicam_sync, place_multicam, switch_angles) on labelled
 * fixture files (core multicam.testFixture.ts); every expected time is the one the real evaluator asks the decoder for.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { evaluate, type VideoLayer } from '@pulseframe/engine';
import { camera, project, recorder, samples, tx } from '@pulseframe/core/multicam.testFixture.ts';
import type { MediaClip, PlaceMulticamOutput, ProjectDocument } from '@pulseframe/core';
import { anglePrefetchPlan } from './anglePrefetch.ts';

const R = { num: 30, den: 1 };
const f = (k: number) => T.frameTime(k, R);
/** A recorder (reference) and four cameras: A at group 1.2 s, B at 2.5 s, C at 0.5 s, D only from group 300 s; placed on A from group 10 s. */
function rig() {
  const { doc, ids } = project([recorder('mic.wav', 620), camera('a.mp4', 600), camera('b.mp4', 600), camera('c.mp4', 600), camera('d.mp4', 100)]);
  let r = tx(doc, [{ op: 'create_multicam', args: { name: 'G', angles: ids.map((id) => ({ assetIds: [id] })) } }]);
  const out = r.results[0]!.output as { groupId: string; angleIds: string[] };
  const [, A, B, C, D] = out.angleIds as [string, string, string, string, string];
  const sync = (angleId: string, at: number) => ({ op: 'set_multicam_sync', args: { groupId: out.groupId, angleId, pieceIndex: 0, offset: samples(at) } });
  r = tx(r.doc, [sync(A, 57600), sync(B, 120000), sync(C, 24000), sync(D, 300 * 48000)]);
  r = tx(r.doc, [{ op: 'place_multicam', args: { groupId: out.groupId, at: T.ZERO, angleId: A, range: { from: T.rt(10, 1), to: T.rt(40, 1) }, fill: false } }]);
  const placed = r.results[0]!.output as unknown as PlaceMulticamOutput;
  const prog = { sequenceId: placed.sequenceId, trackId: placed.videoTrackId };
  const cut = (d: ProjectDocument, cuts: [number, string][]) => tx(d, [{ op: 'switch_angles', args: { groupId: out.groupId, ...prog, cuts: cuts.map(([k, angleId]) => ({ at: f(k), angleId })), coverage: 'clip' } }]).doc;
  return { doc: r.doc, prog, groupId: out.groupId, A, B, C, D, assets: { A: ids[1]!, B: ids[2]!, C: ids[3]!, D: ids[4]! }, cut };
}
/** What the evaluator asks the decoder for on the program track at frame k. */
const shown = (d: ProjectDocument, k: number, trackId: string) => evaluate(d, f(k)).layers.find((l) => l.kind === 'video' && l.trackId === trackId) as VideoLayer;
const ONE_FRAME = 1 / 30;

describe('anglePrefetchPlan: which angles', () => {
  it('while recording: every other picture angle covering the frame, in digit order; never the angle on air, a sound angle or an angle with no picture there', () => {
    const g = rig();
    const plan = anglePrefetchPlan(g.doc, g.prog, 90, { quality: 'full', live: true });
    expect(plan.map((x) => [x.angleId, x.why, x.assetId])).toEqual([[g.B, 'live_angle', g.assets.B], [g.C, 'live_angle', g.assets.C]]); // D starts at group 300 s
    expect(plan.every((x) => x.quality === 'full' && x.width === 1920 && x.height === 1080)).toBe(true);
  });

  it('not recording: no live angles (and nothing at all far from the next segment)', () => {
    const g = rig();
    expect(anglePrefetchPlan(g.doc, g.prog, 90, { quality: 'full', live: false })).toEqual([]);
  });

  it('each live angle is warmed one frame before the frame the evaluator would ask for if the cut were made here', () => {
    const g = rig();
    for (const k of [0, 37, 300]) {
      const plan = anglePrefetchPlan(g.doc, g.prog, k, { quality: 'draft', live: true });
      for (const angleId of [g.B, g.C]) {
        const want = shown(g.cut(g.doc, [[k, angleId]]), k, g.prog.trackId);
        const got = plan.find((x) => x.angleId === angleId)!;
        expect(got.assetId).toBe(want.assetId);
        expect(got.seconds).toBeCloseTo(want.sourceSeekSeconds - ONE_FRAME, 9);
      }
    }
  });

  it('the next segment comes first when it starts within the horizon, warmed one frame before its first picture', () => {
    const g = rig();
    const d = g.cut(g.doc, [[100, g.C]]);
    const first = shown(d, 100, g.prog.trackId);
    const plan = anglePrefetchPlan(d, g.prog, 80, { quality: 'full', live: false });
    expect(plan.map((x) => [x.why, x.angleId])).toEqual([['next_in_program', g.C]]);
    expect(plan[0]!.seconds).toBeCloseTo(first.sourceSeekSeconds - ONE_FRAME, 9);
    expect(anglePrefetchPlan(d, g.prog, 60, { quality: 'full', live: false })).toEqual([]); // 40 frames away: past the one-second horizon
    expect(anglePrefetchPlan(d, g.prog, 60, { quality: 'full', live: false, horizonFrames: 45 }).map((x) => x.angleId)).toEqual([g.C]);
    // recording: the next segment, then the live angles (C again as a live angle is one decoder: the budget keeps the first)
    expect(anglePrefetchPlan(d, g.prog, 80, { quality: 'full', live: true }).map((x) => [x.why, x.angleId])).toEqual([['next_in_program', g.C], ['live_angle', g.B], ['live_angle', g.C]]);
  });

  it('the angles the program showed most recently come before the others', () => {
    const g = rig();
    const d = g.cut(g.doc, [[30, g.C], [60, g.A]]);
    expect(anglePrefetchPlan(d, g.prog, 90, { quality: 'full', live: true }).map((x) => x.angleId)).toEqual([g.C, g.B]);
    const d2 = g.cut(g.doc, [[30, g.C], [60, g.B], [80, g.A]]);
    expect(anglePrefetchPlan(d2, g.prog, 90, { quality: 'full', live: true }).map((x) => x.angleId)).toEqual([g.B, g.C]);
    // on air now: B; the program showed A just before, then C
    const d3 = g.cut(g.doc, [[30, g.C], [60, g.A], [80, g.B]]);
    expect(anglePrefetchPlan(d3, g.prog, 90, { quality: 'full', live: true }).map((x) => x.angleId)).toEqual([g.A, g.C]);
  });

  it('nothing off the program: a frame past its end, a track that is not video, a track that does not exist', () => {
    const g = rig();
    expect(anglePrefetchPlan(g.doc, g.prog, 5000, { quality: 'full', live: true })).toEqual([]);
    expect(anglePrefetchPlan(g.doc, { ...g.prog, trackId: 'trk_none' }, 90, { quality: 'full', live: true })).toEqual([]);
    const audio = g.doc.sequences[g.prog.sequenceId]!.tracks.find((t) => t.kind === 'audio');
    if (audio) expect(anglePrefetchPlan(g.doc, { ...g.prog, trackId: audio.id }, 90, { quality: 'full', live: true })).toEqual([]);
  });

  it('only warms: the plan is computed from the document and never changes it', () => {
    const g = rig();
    const before = JSON.stringify(g.doc);
    anglePrefetchPlan(g.doc, g.prog, 90, { quality: 'full', live: true });
    expect(JSON.stringify(g.doc)).toBe(before);
    const clips = g.doc.sequences[g.prog.sequenceId]!.tracks.find((t) => t.id === g.prog.trackId)!.clips as MediaClip[];
    expect(clips.every((c) => c.multicam?.angleId === g.A)).toBe(true);
  });
});
