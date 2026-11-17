/**
 * The shared contracts of motion tracking (ADR-0015) that exist before its operations: the document fields, the motion track
 * as an entity of its own (undo, conflicts), the source frame numbering tracks are stored by, and the job API shapes.
 * The operations, validation rules and sample functions come with the tracking wave's core work (tracking.test.ts, trackOps.test.ts).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, diffEntities, entityMap, FollowSchema, MAX_REDACT_REGIONS, MAX_TRACK_SAMPLES, migrateProject, MotionTrackSchema, ProjectSchema, referencedIds,
  restoreEntities, sourceFrameIndexAt, ST, TRACK_STATES, TrackOpArgs, TrackRunBody, trackingStage, DEFAULT_REDACT_REGION, validateProject,
  type MediaClip, type MotionTrack, type OpCall, type ProjectDocument, type RedactRegion,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `k${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 1280, height: 720, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov };

/** A project with one video clip and one title, plus a region track on the video's asset (built by hand: the ops come later). */
function setup() {
  let r = tx(createProject({ id: 'prj_t', name: 'T', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset: video } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(30), duration: f(90) } }, { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60) } }]);
  const clipId = r.results[0]!.output!.clipId as string, textId = r.results[1]!.output!.clipId as string;
  const track: MotionTrack = {
    id: 'mtk_a', assetId, name: 'face', kind: 'region', from: 30, box: { w: 1500, h: 2000 },
    x: [5000, 5010, 5020], y: [4000, 4000, 3990], s: [1000, 1010, 1020], q: [100, 90, 40], st: [ST.manual, ST.tracked, ST.weak],
    origin: { method: 'manual', params: {}, createdAt: '2026-11-17T00:00:00Z', createdBy: 'test', edited: false },
  };
  return { doc: r.doc, assetId, clipId, textId, track };
}
const withTrack = (doc: ProjectDocument, t: MotionTrack): ProjectDocument => ({ ...structuredClone(doc), motionTracks: { ...doc.motionTracks, [t.id]: structuredClone(t) } });

describe('motion tracking contracts: document fields', () => {
  it('a new project has no motion tracks, and a stored project from before tracking reads with an empty list', () => {
    expect(createProject({ id: 'p', name: 'p' }).motionTracks).toEqual({});
    const old = structuredClone(createProject({ id: 'p', name: 'p' })) as Partial<ProjectDocument>;
    delete old.motionTracks;
    expect(migrateProject(JSON.parse(JSON.stringify(old))).motionTracks).toEqual({});
  });
  it('a track, a follow and privacy regions are part of the document schema', () => {
    const { doc, clipId, textId, track } = setup();
    const d = withTrack(doc, track);
    const clips = d.sequences.seq_main!.tracks.flatMap((t) => t.clips);
    const vTrack = d.sequences.seq_main!.tracks.find((t) => t.kind === 'video')!.id;
    const region: RedactRegion = { ...DEFAULT_REDACT_REGION, id: 'rgn_1', motionTrackId: track.id };
    (clips.find((c) => c.id === clipId) as MediaClip).redact = [region];
    clips.find((c) => c.id === textId)!.follow = { motionTrackId: track.id, targetTrackId: vTrack, scale: false, smooth: 2 };
    expect(ProjectSchema.safeParse(d).success).toBe(true);
    expect(validateProject(d)).toEqual([]);
    // at most MAX_REDACT_REGIONS regions per clip; an empty list is not stored (the field is left out instead)
    (clips.find((c) => c.id === clipId) as MediaClip).redact = Array.from({ length: MAX_REDACT_REGIONS + 1 }, (_, i) => ({ ...region, id: `rgn_${i}` }));
    expect(ProjectSchema.safeParse(d).success).toBe(false);
    (clips.find((c) => c.id === clipId) as MediaClip).redact = [];
    expect(ProjectSchema.safeParse(d).success).toBe(false);
    expect(FollowSchema.safeParse({ motionTrackId: 'mtk_a', targetTrackId: vTrack, scale: true, smooth: 16 }).success).toBe(false);
  });
  it('the track schema keeps integer samples inside their ranges and at most MAX_TRACK_SAMPLES per array', () => {
    const { track } = setup();
    expect(MotionTrackSchema.safeParse(track).success).toBe(true);
    expect(MotionTrackSchema.safeParse({ ...track, x: [5000.5, 5010, 5020] }).success).toBe(false);
    expect(MotionTrackSchema.safeParse({ ...track, st: [0, 1, 7] }).success).toBe(false);
    expect(MotionTrackSchema.safeParse({ ...track, q: [101, 0, 0] }).success).toBe(false);
    const long = Array.from({ length: MAX_TRACK_SAMPLES + 1 }, () => 5000);
    expect(MotionTrackSchema.safeParse({ ...track, x: long, y: long, s: long.map(() => 1000), q: long.map(() => 50), st: long.map(() => 1) }).success).toBe(false);
    expect(TRACK_STATES.map((s) => ST[s])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // the op argument tables are strict: unknown keys are refused, ids are bounded
    expect(TrackOpArgs.create_motion_track.safeParse({ assetId: 'a', kind: 'point', frame: 0, x: 0, y: 10_000 }).success).toBe(true);
    expect(TrackOpArgs.create_motion_track.safeParse({ assetId: 'a', kind: 'point', frame: 0, x: 0, y: 10_001 }).success).toBe(false);
    expect(TrackOpArgs.set_redact_region.safeParse({ clipId: 'c', region: { style: 'pixelate' } }).success).toBe(true);
    expect(TrackOpArgs.set_redact_region.safeParse({ clipId: 'c', region: { id: 'x' } }).success).toBe(false);
  });
});

describe('motion tracking contracts: a track is an entity keyed by its own id', () => {
  it('adding, changing and removing a track are exact entity changes, and restoring the before-states undoes them', () => {
    const { doc, track } = setup();
    const added = withTrack(doc, track);
    const changed = withTrack(added, { ...track, x: [5000, 5011, 5020], origin: { ...track.origin, edited: true } });
    const removed = { ...structuredClone(changed), motionTracks: {} };
    expect(entityMap(added).get(track.id)).toEqual({ kind: 'motionTrack', track });
    for (const [before, after] of [[doc, added], [added, changed], [changed, removed]] as const) {
      const diff = diffEntities(before, after);
      expect(diff.map((c) => c.id)).toEqual([track.id]);
      // through the internal undo op, as the server's undo does it
      const undone = tx(after, [{ op: 'restore_entities', args: { targets: diff.map((c) => ({ id: c.id, state: c.before })) } }], true).doc;
      expect(creativeProjection(undone)).toBe(creativeProjection(before));
      const redone = structuredClone(undone);
      restoreEntities(redone, diff.map((c) => ({ id: c.id, state: c.after })));
      expect(creativeProjection(redone)).toBe(creativeProjection(after));
    }
  });
  it('a track id in op arguments is recognised as a reference, so an edit from an out-of-date view of the track conflicts', () => {
    const { doc, track } = setup();
    const m = entityMap(withTrack(doc, track));
    expect([...referencedIds({ motionTrackId: track.id, set: [{ frame: 31, x: 1, y: 2 }] }, (id) => m.has(id))]).toEqual([track.id]);
  });
});

describe('motion tracking contracts: source frame numbering', () => {
  it('sourceFrameIndexAt numbers frames as the evaluator does: speed, reverse, a late first picture and the last frame', () => {
    const { doc, clipId, assetId } = setup();
    const asset = doc.assets[assetId]!;
    const v = { ...asset, video: asset.video! };
    const clip = doc.sequences.seq_main!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) as MediaClip;
    expect([0, 1, 89].map((k) => sourceFrameIndexAt(v, clip, f(k), R))).toEqual([30, 31, 119]);
    expect([0, 1, 2, 3].map((k) => sourceFrameIndexAt(v, { ...clip, speed: { num: 1, den: 2 } }, f(k), R))).toEqual([30, 30, 31, 31]);
    expect([0, 1, 89].map((k) => sourceFrameIndexAt(v, { ...clip, reverse: true }, f(k), R))).toEqual([119, 118, 30]);
    // a picture that starts two frames after the file's time zero is shown two frames later, held until then
    const late = { ...v, video: { ...v.video, startTime: f(2) } };
    expect([0, 1, 2].map((k) => sourceFrameIndexAt(late, { ...clip, sourceIn: T.ZERO }, f(k), R))).toEqual([0, 0, 0]);
    expect(sourceFrameIndexAt(late, { ...clip, sourceIn: T.ZERO }, f(3), R)).toBe(1);
    // past the end of the source: the last frame
    expect(sourceFrameIndexAt(v, { ...clip, sourceIn: f(235) }, f(20), R)).toBe(239);
    expect(sourceFrameIndexAt({ ...v, video: { ...v.video, frameCount: null } }, { ...clip, sourceIn: f(235) }, f(20), R)).toBe(239);
  });
});

describe('motion tracking contracts: the job API', () => {
  it('the run body has its defaults and is strict; stages use the STAGE_WORDS keys', () => {
    expect(TrackRunBody.parse({})).toEqual({ direction: 'both', input: 'proxy' });
    expect(TrackRunBody.safeParse({ from: 10, to: 5, direction: 'sideways' }).success).toBe(false);
    expect(TrackRunBody.safeParse({ graph: {} }).success).toBe(false);
    expect([trackingStage('reading'), trackingStage('forward', 12, 240), trackingStage('backward', 3, 30), trackingStage('saving')]).toEqual(['reading frames', 'tracking forward 12/240', 'tracking backward 3/30', 'saving track']);
  });
});
