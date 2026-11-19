import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, clipEnd, createProject, timelineMarkers, volumeLevelAt, volumePoints, diffEntities, findClip, OpError, restoreEntities, sequenceDuration, sourceAt, validateProject, type OpCall, type ProjectDocument } from './index.ts';

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

describe('bar starts in a beat analysis', () => {
  it('are stored with the beats, must be beats, survive hand edits of the beats that keep them, reach the timeline as markers, and can be cleared', () => {
    const { doc, assetId } = project();
    const s = (n: number) => T.rt(n, 2); // every half second
    let d = tx(doc, [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: [s(1), s(2), s(3), s(4), s(5), s(6), s(7), s(8)], bpm: 120, confidence: 0.9, downbeats: [s(1), s(5), T.rt(99, 100)], meter: 4 } }], true).doc;
    const beats = () => d.analyses[assetId]!.beats!;
    expect([beats().downbeats!.map(T.toSeconds), beats().meter]).toEqual([[0.5, 2.5], 4]); // the entry that is not a beat was dropped
    expect(validateProject(d)).toEqual([]);
    expect(timelineMarkers(d).downbeats.map(T.toSeconds)).toEqual([0.5, 2.5]);
    d = tx(d, [{ op: 'edit_analysis', args: { assetId, kind: 'beats', remove: [s(5)] } }]).doc; // removing a beat that was a bar start removes that bar start
    expect(beats().downbeats!.map(T.toSeconds)).toEqual([0.5]);
    d = tx(d, [{ op: 'edit_analysis', args: { assetId, kind: 'beats', downbeats: [s(2), s(6)], meter: 4 } }]).doc;
    expect([beats().downbeats!.map(T.toSeconds), beats().origin.edited]).toEqual([[1, 3], true]);
    expect(code(() => tx(d, [{ op: 'edit_analysis', args: { assetId, kind: 'beats', downbeats: [T.rt(1, 3)] } }]))).toBe('invalid_args');
    expect(code(() => tx(d, [{ op: 'edit_analysis', args: { assetId, kind: 'scenes', downbeats: [] } }]))).toBe('invalid_args');
    d = tx(d, [{ op: 'edit_analysis', args: { assetId, kind: 'beats', downbeats: null } }]).doc;
    expect([beats().downbeats, beats().beats.length]).toEqual([undefined, 7]);
  });
});

describe('add_clip on chosen tracks', () => {
  it('trackId places the picture and audioTrackId its linked sound on the named tracks; a wrong kind, a missing or a locked track is refused', () => {
    const { doc, assetId } = project();
    let r = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }, { op: 'add_track', args: { kind: 'audio' } }]);
    const v2 = r.results[0]!.output!.trackId as string, a2 = r.results[1]!.output!.trackId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(300), duration: f(30), trackId: v2, audioTrackId: a2 } }]);
    const out = r.results[0]!.output as any;
    expect([findClip(r.doc, out.clipId)!.track.id, findClip(r.doc, out.audioClipId)!.track.id]).toEqual([v2, a2]);
    expect(validateProject(r.doc)).toEqual([]);
    expect(code(() => tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(400), duration: f(30), audioTrackId: v2 } }]))).toBe('incompatible');
    expect(code(() => tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(400), duration: f(30), audioTrackId: 'trk_none' } }]))).toBe('not_found');
    const locked = tx(r.doc, [{ op: 'update_track', args: { trackId: a2, locked: true } }]).doc;
    expect(code(() => tx(locked, [{ op: 'add_clip', args: { assetId, start: f(400), duration: f(30), audioTrackId: a2 } }]))).toBe('track_locked');
  });
});

describe('duplicate_clips with preferred tracks', () => {
  it('copies go to the preferred track of their kind when it is free, picture and sound each to their own; a busy preferred track falls back as before; a missing one is refused', () => {
    const { doc, videoId, audioId } = project();
    let r = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }, { op: 'add_track', args: { kind: 'audio' } }]);
    const v2 = r.results[0]!.output!.trackId as string, a2 = r.results[1]!.output!.trackId as string;
    const d = r.doc;
    r = tx(d, [{ op: 'duplicate_clips', args: { clipIds: [videoId, audioId], at: f(300), preferTrackIds: [v2, a2] } }]);
    const made = r.results[0]!.output!.createdClipIds as string[];
    expect(made.map((id) => findClip(r.doc, id)!.track.id).sort()).toEqual([v2, a2].sort());
    const [x, y] = made.map((id) => findClip(r.doc, id)!.clip as any);
    expect(x.linkGroupId && x.linkGroupId === y.linkGroupId).toBe(true); // still a linked pair
    expect(validateProject(r.doc)).toEqual([]);
    // the preferred picture track is busy at that time: the copy goes where it would have gone without a preference
    const busy = tx(r.doc, [{ op: 'duplicate_clips', args: { clipIds: [videoId], at: f(300), preferTrackIds: [v2] } }]);
    expect(findClip(busy.doc, (busy.results[0]!.output!.createdClipIds as string[])[0]!)!.track.id).toBe(findClip(d, videoId)!.track.id);
    expect(code(() => tx(d, [{ op: 'duplicate_clips', args: { clipIds: [videoId], at: f(300), preferTrackIds: ['trk_none'] } }]))).toBe('not_found');
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

describe('close_gaps', () => {
  it('removes time that is empty on every track, keeps gaps that another track covers, moves markers, and is undone in one step', () => {
    const { doc, assetId, titleId } = project(); // picture+sound 0..240, title 0..60, markers 30 and 150
    // second clip at 300..360 (gap 240..300 on every track), a title at 420..450 (gap 360..420), and the first title leaves 60..240 empty on the text track only
    let d = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(300), duration: f(60) } }, { op: 'add_text', args: { text: 'late', start: f(420), duration: f(30) } }, { op: 'add_marker', args: { time: f(330), label: 'in second clip' } }, { op: 'add_marker', args: { time: f(270), label: 'in the gap' } }]).doc;
    const r = tx(d, [{ op: 'close_gaps', args: {} }]);
    expect(validateProject(r.doc)).toEqual([]);
    expect((r.results[0]!.output as any).gaps.map((g: any) => [fi(g.start), fi(g.end)])).toEqual([[240, 300], [360, 420]]);
    expect(fi(sequenceDuration(r.doc))).toBe(450 - 120);
    const starts = (x: ProjectDocument, kind: string) => clips(x).filter((c) => c.kind === kind).map((c) => [fi(c.start), fi(c.duration)]).sort((a, b) => a[0]! - b[0]!);
    expect(starts(r.doc, 'video')).toEqual([[0, 240], [240, 60]]);
    expect(starts(r.doc, 'text')).toEqual([[0, 60], [300, 30]]); // the text-only gap 60..240 is under the picture and stays
    expect(Object.values(r.doc.markers!).map((m) => [fi(m.time), m.label]).sort((a: any, b: any) => a[0] - b[0])).toEqual([[30, 'early'], [150, 'late'], [240, 'in the gap'], [270, 'in second clip']]);
    expect(fi(findClip(r.doc, titleId)!.clip.start)).toBe(0);
    const back = structuredClone(r.doc);
    restoreEntities(back, diffEntities(d, r.doc).map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(d);
    // nothing left to close; a range limits the work; leading empty time counts
    expect(code(() => tx(r.doc, [{ op: 'close_gaps', args: {} }]))).toBe('not_found');
    const ranged = tx(d, [{ op: 'close_gaps', args: { from: f(250), to: f(290) } }]).doc;
    expect(fi(sequenceDuration(ranged))).toBe(450 - 40);
    d = tx(createProject({ id: 'prj_lead', name: 'lead', width: 640, height: 360 }), [{ op: 'add_text', args: { text: 'x', start: f(90), duration: f(30) } }]).doc;
    expect(starts(tx(d, [{ op: 'close_gaps', args: {} }]).doc, 'text')).toEqual([[0, 30]]);
    expect(code(() => tx(d, [{ op: 'close_gaps', args: { from: f(50), to: f(20) } }]))).toBe('invalid_args');
  });
});

describe('unlink_clip', () => {
  it('detaches picture from sound so each edits alone; nothing moves; a clip that is not linked is refused; undo relinks', () => {
    const { doc, videoId, audioId, titleId } = project();
    const r = tx(doc, [{ op: 'unlink_clip', args: { clipId: videoId } }]);
    const v = () => findClip(d, videoId)!.clip as any, a = () => findClip(d, audioId)!.clip as any;
    let d = r.doc;
    expect([v().linkGroupId, a().linkGroupId, (r.results[0]!.output as any).wasLinkedTo]).toEqual([null, null, [audioId]]);
    expect(validateProject(d)).toEqual([]);
    const back = structuredClone(d);
    restoreEntities(back, diffEntities(doc, d).map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(doc);
    // while linked, trimming the picture trims the sound; once detached it does not
    const linkedTrim = tx(doc, [{ op: 'trim_clip', args: { clipId: videoId, edge: 'end', to: f(100) } }]).doc;
    expect(fi((findClip(linkedTrim, audioId)!.clip).duration)).toBe(100);
    d = tx(d, [{ op: 'trim_clip', args: { clipId: videoId, edge: 'end', to: f(100) } }, { op: 'delete_clip', args: { clipId: videoId } }]).doc;
    expect(findClip(d, videoId)).toBeUndefined();
    expect(fi(a().duration)).toBe(240);
    expect(code(() => tx(d, [{ op: 'unlink_clip', args: { clipId: audioId } }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'unlink_clip', args: { clipId: titleId } }]))).toBe('invalid_args');
  });
});

describe('fit_music', () => {
  const music = { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' } };
  function withMusic() {
    const { doc } = project(); // picture 0..240, title 0..60
    let r = tx(doc, [{ op: 'import_asset', args: { asset: music } }], true);
    const musicId = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: musicId, start: f(30) } }]); // 20 s of music from 1 s: runs far past the picture
    return { doc: r.doc, musicId, clipId: (r.results[0]!.output as any).clipId as string };
  }
  it('without beats it ends exactly with the picture and fades out; with beats it ends on the last beat before the picture ends', () => {
    const { doc, musicId, clipId } = withMusic();
    const plain = tx(doc, [{ op: 'fit_music', args: { clipId } }]);
    const c = findClip(plain.doc, clipId)!.clip as any;
    expect([fi(c.start), fi(clipEnd(c)), fi(c.fadeOut)]).toEqual([30, 240, 30]);
    expect(plain.results[0]!.output).toMatchObject({ onBeat: false });
    expect(validateProject(plain.doc)).toEqual([]);
    // beats every 0.8 s of the source (24 frames): the clip starts at timeline 30, so beats fall at 30 + 24k
    const beats = Array.from({ length: 20 }, (_, k) => f(24 * (k + 1)));
    const analysed = tx(doc, [{ op: 'attach_analysis', args: { assetId: musicId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-15T00:00:00Z', times: beats, bpm: 75 } }], true).doc;
    const fitted = tx(analysed, [{ op: 'fit_music', args: { clipId, fadeOut: f(10) } }]);
    const b = findClip(fitted.doc, clipId)!.clip as any;
    expect([fi(clipEnd(b)), fi(b.fadeOut)]).toEqual([222, 10]); // 30 + 24·8 = 222 is the last beat at or before 240
    expect(fitted.results[0]!.output).toMatchObject({ onBeat: true });
    // an explicit end
    expect(fi(clipEnd(findClip(tx(analysed, [{ op: 'fit_music', args: { clipId, to: f(100) } }]).doc, clipId)!.clip))).toBe(78);
    // with bar starts on every fourth beat (timeline 54, 150, 246): the music ends on the last bar start before the picture ends, 150, not on the last beat, 222
    const attach = (downbeats: T.RationalTime[]) => tx(doc, [{ op: 'attach_analysis', args: { assetId: musicId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-15T00:00:00Z', times: beats, bpm: 75, downbeats, meter: 4 } }], true).doc;
    const onBar = tx(attach(beats.filter((_, k) => k % 4 === 0)), [{ op: 'fit_music', args: { clipId } }]);
    expect(fi(clipEnd(findClip(onBar.doc, clipId)!.clip))).toBe(150);
    expect(onBar.results[0]!.output).toMatchObject({ onBeat: true, onBar: true });
    // bar starts known only near the beginning: more than a bar before the last beat, so the last beat is used
    const early = tx(attach([beats[0]!]), [{ op: 'fit_music', args: { clipId } }]);
    expect(fi(clipEnd(findClip(early.doc, clipId)!.clip))).toBe(222);
    expect(early.results[0]!.output).toMatchObject({ onBeat: true, onBar: false });
  });
  it('music shorter than the picture ends on its own last beat and says how much is missing; refusals', () => {
    const { doc, musicId, clipId, } = withMusic();
    const { videoId } = (() => { const d0 = doc; const v = d0.sequences[d0.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.clips[0]!; return { videoId: v.id }; })();
    // start the music 18 s into its source: only 2 s (60 frames) remain, the picture needs 210 more
    const late = tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(60) } }, { op: 'slip_clip', args: { clipId, by: f(540) } }]).doc;
    const r = tx(late, [{ op: 'fit_music', args: { clipId } }]);
    const c = findClip(r.doc, clipId)!.clip as any;
    expect(fi(clipEnd(c))).toBe(90); // all the source there is
    expect(fi((r.results[0]!.output as any).shortBy)).toBe(150);
    expect(code(() => tx(doc, [{ op: 'fit_music', args: { clipId: videoId } }]))).toBe('incompatible');
    expect(code(() => tx(doc, [{ op: 'fit_music', args: { clipId, to: f(20) } }]))).toBe('out_of_bounds');
    const linkedAudio = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'audio')!.clips.find((x) => x.type === 'media' && x.assetId !== musicId)!;
    expect(code(() => tx(doc, [{ op: 'fit_music', args: { clipId: linkedAudio.id } }]))).toBe('incompatible');
  });
});

describe('link_clips', () => {
  it('relinks a detached picture and sound so they edit together again; mismatched or already linked clips are refused', () => {
    const { doc, videoId, audioId, titleId } = project();
    const apart = tx(doc, [{ op: 'unlink_clip', args: { clipId: videoId } }]).doc;
    const r = tx(apart, [{ op: 'link_clips', args: { clipIds: [videoId, audioId] } }]);
    const v = findClip(r.doc, videoId)!.clip as any, a = findClip(r.doc, audioId)!.clip as any;
    expect(v.linkGroupId).toBe(a.linkGroupId);
    expect(v.linkGroupId).toBeTruthy();
    expect(validateProject(r.doc)).toEqual([]);
    const trimmed = tx(r.doc, [{ op: 'trim_clip', args: { clipId: videoId, edge: 'end', to: f(100) } }]).doc;
    expect(fi(findClip(trimmed, audioId)!.clip.duration)).toBe(100); // they move together again
    expect(code(() => tx(doc, [{ op: 'link_clips', args: { clipIds: [videoId, audioId] } }]))).toBe('incompatible'); // already linked
    const uneven = tx(apart, [{ op: 'trim_clip', args: { clipId: audioId, edge: 'end', to: f(200) } }]).doc;
    expect(code(() => tx(uneven, [{ op: 'link_clips', args: { clipIds: [videoId, audioId] } }]))).toBe('incompatible');
    expect(code(() => tx(apart, [{ op: 'link_clips', args: { clipIds: [videoId, titleId] } }]))).toBe('incompatible');
    expect(code(() => tx(apart, [{ op: 'link_clips', args: { clipIds: [videoId, videoId] } }]))).toBe('invalid_args');
    const reversedOne = tx(apart, [{ op: 'set_clip_reverse', args: { clipId: videoId, reverse: true } }]).doc;
    expect(code(() => tx(reversedOne, [{ op: 'link_clips', args: { clipIds: [videoId, audioId] } }]))).toBe('incompatible');
  });
});


describe('volume curves', () => {
  const music = { kind: 'audio' as const, name: 'v.wav', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' } };
  function sound() {
    let r = tx(createProject({ id: 'prj_v', name: 'V' }), [{ op: 'import_asset', args: { asset: music } }], true);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: f(0), duration: f(300) } }]);
    return { doc: r.doc, clipId: (r.results[0]!.output as any).clipId as string };
  }
  const vol = (d: ProjectDocument, id: string) => (findClip(d, id)!.clip as any).volume as { time: T.RationalTime; value: number; curve?: 'smooth' }[] | undefined;
  it('a smooth key eases to the next one (same ends, same middle, slower at the ends); the shape is kept when only the level changes and removed by curve=linear', () => {
    const { doc, clipId } = sound();
    let d = tx(doc, [{ op: 'set_volume_keyframe', args: { clipId, time: f(0), value: 0, curve: 'smooth' } }, { op: 'set_volume_keyframe', args: { clipId, time: f(100), value: 1 } }]).doc;
    const at = (n: number) => volumeLevelAt(vol(d, clipId), f(n));
    expect([at(0), at(50), at(100), at(200)]).toEqual([0, 0.5, 1, 1]);
    expect(at(10)).toBeCloseTo(0.028, 3); // 3x² − 2x³ at x = 0.1; a straight line would give 0.1
    expect(at(90)).toBeCloseTo(0.972, 3);
    // the points handed to the mixers lie on the same curve
    const pts = volumePoints(vol(d, clipId)!, (t) => fi(t));
    expect(pts.length).toBe(17);
    expect(pts.every((p) => Math.abs(p.value - volumeLevelAt(vol(d, clipId), T.rt(Math.round(p.x * 1000), 30000))) < 1e-9)).toBe(true);
    d = tx(d, [{ op: 'set_volume_keyframe', args: { clipId, time: f(0), value: 0.2 } }]).doc;
    expect(vol(d, clipId)![0]).toMatchObject({ value: 0.2, curve: 'smooth' });
    d = tx(d, [{ op: 'set_volume_keyframe', args: { clipId, time: f(0), value: 0.2, curve: 'linear' } }]).doc;
    expect(vol(d, clipId)![0]!.curve).toBeUndefined();
    expect(volumeLevelAt(vol(d, clipId), f(50))).toBeCloseTo(0.6, 9);
    expect(validateProject(d)).toEqual([]);
  });
  it('draw_volume replaces the keys inside a range by a new run in one edit and keeps the keys outside it; bad input is refused', () => {
    const { doc, clipId } = sound();
    let d = tx(doc, [10, 40, 70, 200].map((n) => ({ op: 'set_volume_keyframe', args: { clipId, time: f(n), value: 1 } }))).doc;
    const r = tx(d, [{ op: 'draw_volume', args: { clipId, from: f(30), to: f(90), keys: [{ time: f(60), value: 0.5 }, { time: f(30), value: 0.9 }, { time: f(90), value: 1.4, curve: 'smooth' }] } }]);
    d = r.doc;
    expect(vol(d, clipId)!.map((k) => [fi(k.time), k.value])).toEqual([[10, 1], [30, 0.9], [60, 0.5], [90, 1.4], [200, 1]]);
    expect(vol(d, clipId)![3]!.curve).toBe('smooth');
    expect(validateProject(d)).toEqual([]);
    const before = tx(doc, [10, 40, 70, 200].map((n) => ({ op: 'set_volume_keyframe', args: { clipId, time: f(n), value: 1 } }))).doc;
    const back = structuredClone(d);
    restoreEntities(back, diffEntities(before, d).map((x) => ({ id: x.id, state: x.before })));
    expect(vol(back, clipId)!.map((k) => fi(k.time))).toEqual([10, 40, 70, 200]); // the undo path
    expect(vol(tx(d, [{ op: 'draw_volume', args: { clipId, from: f(0), to: f(300), keys: [] } }]).doc, clipId)).toBeUndefined(); // an empty run clears the range
    expect(code(() => tx(d, [{ op: 'draw_volume', args: { clipId, from: f(30), to: f(90), keys: [{ time: f(100), value: 1 }] } }]))).toBe('out_of_bounds');
    expect(code(() => tx(d, [{ op: 'draw_volume', args: { clipId, from: f(90), to: f(30), keys: [] } }]))).toBe('out_of_bounds');
    expect(code(() => tx(d, [{ op: 'draw_volume', args: { clipId, from: f(30), to: f(90), keys: [{ time: f(40), value: 1 }, { time: f(40), value: 0.5 }] } }]))).toBe('invalid_args');
    expect(code(() => tx(d, [{ op: 'draw_volume', args: { clipId, from: f(30), to: f(900), keys: [] } }]))).toBe('out_of_bounds');
  });
});
