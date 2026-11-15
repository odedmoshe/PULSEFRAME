import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, diffEntities, findClip, OpError, restoreEntities, sequenceDuration, sourceAt, validateProject, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const fi = (t: T.RationalTime) => T.frameIndexAt(t, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `g${n++}_`, actor: 'test', allowInternal });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : `non-op:${e}`; } return 'ok'; };
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' },
};
function project() {
  let r = tx(createProject({ id: 'prj_g', name: 'G', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId, start: f(0) } },
    { op: 'add_text', args: { text: 'title', start: f(0), duration: f(60) } },
    { op: 'add_marker', args: { time: f(30), label: 'early' } }, { op: 'add_marker', args: { time: f(150), label: 'late' } },
  ]);
  const out = r.results[0]!.output as any;
  return { doc: r.doc, assetId, videoId: out.clipId as string, audioId: out.audioClipId as string, titleId: r.results[1]!.output!.clipId as string };
}
const clips = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips.map((c) => ({ ...c, kind: t.kind })));
const markerFrames = (d: ProjectDocument) => Object.values(d.markers ?? {}).map((m) => fi(m.time)).sort((a, b) => a - b);

describe('insert_gap (ripple insert) and markers under ripple edits', () => {
  it('splits clips lying across the point, moves later material and markers, keeps the source continuous and the halves linked', () => {
    const { doc, videoId, audioId, titleId } = project();
    const r = tx(doc, [{ op: 'set_keyframe', args: { clipId: videoId, property: 'opacity', time: f(120), value: 0.5 } }, { op: 'insert_gap', args: { at: f(100), duration: f(50) } }]);
    const d = r.doc;
    expect(validateProject(d)).toEqual([]);
    expect(fi(sequenceDuration(d))).toBe(290);
    const v = clips(d).filter((c) => c.kind === 'video').sort((a, b) => fi(a.start) - fi(b.start)) as any[];
    const a = clips(d).filter((c) => c.kind === 'audio').sort((x, y) => fi(x.start) - fi(y.start)) as any[];
    expect(v.map((c) => [fi(c.start), fi(c.duration)])).toEqual([[0, 100], [150, 140]]);
    expect(a.map((c) => [fi(c.start), fi(c.duration)])).toEqual([[0, 100], [150, 140]]);
    expect([v[0].id, a[0].id]).toEqual([videoId, audioId]); // the earlier halves keep their ids
    // the picture continues where it stopped: last source frame before the gap is 99, first after it is 100
    expect(fi(sourceAt(v[0], f(99)))).toBe(99);
    expect(fi(sourceAt(v[1], f(150)))).toBe(100);
    // each side stays a linked picture + sound pair, and the two sides are different pairs
    expect(v[0].linkGroupId).toBe(a[0].linkGroupId);
    expect(v[1].linkGroupId).toBe(a[1].linkGroupId);
    expect(v[1].linkGroupId).not.toBe(v[0].linkGroupId);
    // a keyframe at clip time 120 is 20 frames into the later half (the earlier half keeps its own list, as after split_clip)
    expect((v[1].keyframes?.opacity ?? []).map((k: any) => fi(k.time))).toEqual([20]);
    // a clip that ends before the point and a marker before it do not move; the later marker does
    expect(fi(findClip(d, titleId)!.clip.start)).toBe(0);
    expect(markerFrames(d)).toEqual([30, 200]);
    expect((r.results[1]!.output as any).createdClipIds.length).toBe(2);
  });
  it('insert = gap + clip in one transaction; one undo restores the timeline; a cut of the same range closes it again', () => {
    const { doc, assetId } = project();
    const r = tx(doc, [{ op: 'insert_gap', args: { at: f(100), duration: f(50) } }, { op: 'add_clip', args: { assetId, start: f(100), sourceIn: f(10), duration: f(50) } }]);
    expect(validateProject(r.doc)).toEqual([]);
    const v = clips(r.doc).filter((c) => c.kind === 'video').sort((a, b) => fi(a.start) - fi(b.start)) as any[];
    expect(v.map((c) => [fi(c.start), fi(c.duration), fi(c.sourceIn)])).toEqual([[0, 100, 0], [100, 50, 10], [150, 140, 100]]);
    expect(new Set(v.map((c) => r.doc.sequences[r.doc.mainSequenceId]!.tracks.find((t) => t.clips.some((x) => x.id === c.id))!.id)).size).toBe(1); // the inserted clip sits in the gap on the same track
    const back = structuredClone(r.doc);
    restoreEntities(back, diffEntities(doc, r.doc).map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(doc);
    const closed = tx(r.doc, [{ op: 'cut_range', args: { start: f(100), end: f(150) } }]).doc;
    const v2 = clips(closed).filter((c) => c.kind === 'video').sort((a, b) => fi(a.start) - fi(b.start)) as any[];
    expect(v2.map((c) => [fi(c.start), fi(c.duration), fi(c.sourceIn)])).toEqual([[0, 100, 0], [100, 140, 100]]);
  });
  it('cut_range with ripple moves later markers earlier; markers on removed frames collapse onto the cut point, one survivor; without ripple or on chosen tracks they stay', () => {
    const { doc } = project(); // markers at 30 and 150
    let d = tx(doc, [{ op: 'add_marker', args: { time: f(60), label: 'in-a' } }, { op: 'add_marker', args: { time: f(70), label: 'in-b' } }, { op: 'add_marker', args: { time: f(90), label: 'at-end' } }]).doc;
    const r = tx(d, [{ op: 'cut_range', args: { start: f(50), end: f(90) } }]);
    const ms = Object.values(r.doc.markers!).map((m) => [fi(m.time), m.label]).sort((a: any, b: any) => a[0] - b[0]);
    expect(ms).toEqual([[30, 'early'], [50, 'in-a'], [110, 'late']]); // in-b and at-end had no frame left and the cut point was taken by in-a
    expect((r.results[0]!.output as any).removedMarkerIds.length).toBe(2);
    expect(validateProject(r.doc)).toEqual([]);
    const back = structuredClone(r.doc);
    restoreEntities(back, diffEntities(d, r.doc).map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(d); // undo brings the dropped markers back
    // a marker already on the cut point wins
    d = tx(d, [{ op: 'add_marker', args: { time: f(50), label: 'cut-point' } }]).doc;
    const r2 = tx(d, [{ op: 'cut_range', args: { start: f(50), end: f(90) } }]).doc;
    expect(Object.values(r2.markers!).map((m) => [fi(m.time), m.label]).sort((a: any, b: any) => a[0] - b[0])).toEqual([[30, 'early'], [50, 'cut-point'], [110, 'late']]);
    // no ripple: time is not removed, markers stay
    expect(markerFrames(tx(d, [{ op: 'cut_range', args: { start: f(50), end: f(90), ripple: false } }]).doc)).toEqual(markerFrames(d));
    const textTrack = d.sequences[d.mainSequenceId]!.tracks.find((t) => t.kind === 'text')!.id;
    expect(markerFrames(tx(d, [{ op: 'cut_range', args: { start: f(10), end: f(20), trackIds: [textTrack] } }]).doc)).toEqual(markerFrames(d));
  });
  it('at a cut point nothing is split; on chosen tracks only, markers stay; bad input and locked tracks are refused', () => {
    const { doc, videoId } = project();
    const split = tx(doc, [{ op: 'split_clip', args: { clipId: videoId, at: f(100) } }]).doc;
    const before = clips(split).length;
    const g = tx(split, [{ op: 'insert_gap', args: { at: f(100), duration: f(30) } }]);
    expect(clips(g.doc).length).toBe(before);
    expect((g.results[0]!.output as any).createdClipIds).toEqual([]);
    const textTrack = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'text')!.id;
    const only = tx(doc, [{ op: 'insert_gap', args: { at: f(20), duration: f(30), trackIds: [textTrack] } }]).doc;
    expect(markerFrames(only)).toEqual([30, 150]);
    expect(clips(only).filter((c) => c.kind === 'text').map((c) => [fi(c.start), fi(c.duration)])).toEqual([[0, 20], [50, 40]]);
    expect(clips(only).filter((c) => c.kind === 'video').length).toBe(1);
    expect(code(() => tx(doc, [{ op: 'insert_gap', args: { at: f(10), duration: f(0) } }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'insert_gap', args: { at: T.rt(1, 7), duration: f(10) } }]))).not.toBe('ok');
    expect(code(() => tx(doc, [{ op: 'insert_gap', args: { at: f(10), duration: f(10), trackIds: ['trk_none'] } }]))).toBe('not_found');
    const locked = structuredClone(doc); locked.sequences[locked.mainSequenceId]!.tracks[0]!.locked = true;
    expect(code(() => tx(locked, [{ op: 'insert_gap', args: { at: f(10), duration: f(10) } }]))).toBe('track_locked');
    // past the end of everything: nothing moves, nothing fails
    const far = tx(doc, [{ op: 'insert_gap', args: { at: f(900), duration: f(10) } }]).doc;
    expect(far.sequences).toEqual(doc.sequences);
  });
});

describe('slip_clip', () => {
  it('shows a different stretch of the source without moving or resizing the clip; linked sound follows; limits are the ends of the source', () => {
    const { doc, videoId, audioId, titleId } = project(); // 240-frame source
    let d = tx(doc, [{ op: 'trim_clip', args: { clipId: videoId, edge: 'start', to: f(60) } }, { op: 'trim_clip', args: { clipId: videoId, edge: 'end', to: f(160) } }]).doc; // shows source 60..159 at 60..159
    const v = () => findClip(d, videoId)!.clip as any, a = () => findClip(d, audioId)!.clip as any;
    expect([fi(v().start), fi(v().duration), fi(v().sourceIn), fi(a().sourceIn)]).toEqual([60, 100, 60, 60]);
    d = tx(d, [{ op: 'slip_clip', args: { clipId: videoId, by: f(25) } }]).doc;
    expect([fi(v().start), fi(v().duration), fi(v().sourceIn), fi(a().start), fi(a().duration), fi(a().sourceIn)]).toEqual([60, 100, 85, 60, 100, 85]);
    expect(fi(sourceAt(v(), f(60)))).toBe(85);
    d = tx(d, [{ op: 'slip_clip', args: { clipId: videoId, by: T.sub(T.ZERO, f(85)) } }]).doc; // back to the very start of the source
    expect(fi(v().sourceIn)).toBe(0);
    expect(code(() => tx(d, [{ op: 'slip_clip', args: { clipId: videoId, by: T.sub(T.ZERO, f(1)) } }]))).toBe('out_of_bounds');
    d = tx(d, [{ op: 'slip_clip', args: { clipId: videoId, by: f(140) } }]).doc; // the last 100 frames of the source
    expect(fi(v().sourceIn)).toBe(140);
    expect(code(() => tx(d, [{ op: 'slip_clip', args: { clipId: videoId, by: f(1) } }]))).toBe('out_of_bounds');
    // picture only
    d = tx(d, [{ op: 'slip_clip', args: { clipId: videoId, by: T.sub(T.ZERO, f(10)), includeLinked: false } }]).doc;
    expect([fi(v().sourceIn), fi(a().sourceIn)]).toEqual([130, 140]);
    // at double speed 10 timeline frames are 20 source frames
    d = tx(d, [{ op: 'slip_clip', args: { clipId: videoId, by: T.sub(T.ZERO, f(100)) } }]).doc; // picture 30, sound 40
    d = tx(d, [{ op: 'set_clip_speed', args: { clipId: videoId, speed: 2 } }]).doc;
    const before = fi(v().sourceIn);
    d = tx(d, [{ op: 'slip_clip', args: { clipId: videoId, by: f(10) } }]).doc;
    expect(fi(v().sourceIn) - before).toBe(20);
    expect(validateProject(d)).toEqual([]);
    expect(code(() => tx(d, [{ op: 'slip_clip', args: { clipId: titleId, by: f(5) } }]))).toBe('incompatible');
    expect(code(() => tx(d, [{ op: 'slip_clip', args: { clipId: videoId, by: f(0) } }]))).toBe('invalid_args');
    expect(code(() => tx(d, [{ op: 'slip_clip', args: { clipId: 'clp_none', by: f(5) } }]))).toBe('not_found');
  });
});
