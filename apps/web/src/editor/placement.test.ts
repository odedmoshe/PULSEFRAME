import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, clipEnd, createProject, validateProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { addAssetArgs, addedClipDuration, dropAssetArgs, soundTargetIfFree, trackFreeAt } from './placement.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const fi = (t: T.RationalTime) => T.frameIndexAt(t, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `p${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' };
const video = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(30, 1),
  video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 900 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance,
};
const music = { kind: 'audio' as const, name: 'music.mp3', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'mp3', mimeType: 'audio/mpeg', duration: T.rt(30, 1), audio: { sampleRate: 48000, channels: 2, codec: 'mp3' }, provenance };

/** A 30 s video with linked sound at 0 (V1 + A1) and a 30 s music file in the library: the project of the finding. */
function project() {
  let r = tx(createProject({ id: 'prj_p', name: 'P', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: music } }], true);
  const videoId = r.results[0]!.output!.assetId as string, musicId = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: videoId, start: f(0) } }]);
  const tracks = r.doc.sequences[r.doc.mainSequenceId]!.tracks;
  return { doc: r.doc, videoId, musicId, v1: tracks.find((t) => t.kind === 'video')!.id, a1: tracks.find((t) => t.kind === 'audio')!.id };
}
/** Sound tracks as `name: asset[start..end) …` in frames, by start and then by file name (clips that start together have no fixed order). */
const sound = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.filter((t) => t.kind === 'audio')
  .map((t) => `${t.name}: ${t.clips.map((c) => ({ at: fi(c.start), text: `${c.type === 'media' ? d.assets[c.assetId]!.name : c.type}[${fi(c.start)}..${fi(clipEnd(c))})` }))
    .sort((x, y) => x.at - y.at || (x.text < y.text ? -1 : 1)).map((x) => x.text).join(' ')}`);
/** Clips of one track that overlap another clip of the same track. */
const stacked = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips.filter((c) => !trackFreeAt({ clips: t.clips.filter((o) => o !== c) }, c.start, clipEnd(c))));
const span = (start: number, end: number) => ({ start: f(start), duration: f(end - start) });

describe('trackFreeAt: is the track free over [start, end)?', () => {
  const track = { clips: [span(100, 200)] };
  it('an empty track is free', () => expect(trackFreeAt({ clips: [] }, f(0), f(900))).toBe(true));
  it('a clip that lies before the range leaves it free', () => expect(trackFreeAt(track, f(250), f(400))).toBe(true));
  it('a clip that lies after the range leaves it free', () => expect(trackFreeAt(track, f(0), f(50))).toBe(true));
  it('touching exactly at a boundary is free, on either side', () => {
    expect(trackFreeAt(track, f(200), f(300))).toBe(true); // starts on the frame the clip ends
    expect(trackFreeAt(track, f(0), f(100))).toBe(true); // ends on the frame the clip starts
  });
  it('overlapping by one frame is not free, on either side', () => {
    expect(trackFreeAt(track, f(199), f(300))).toBe(false);
    expect(trackFreeAt(track, f(0), f(101))).toBe(false);
  });
  it('a range inside the clip, or one that covers it, is not free', () => {
    expect(trackFreeAt(track, f(120), f(130))).toBe(false);
    expect(trackFreeAt(track, f(50), f(250))).toBe(false);
  });
  it('a sound that fits the gap between two clips is free; one frame longer than the gap is not', () => {
    const gap = { clips: [span(0, 100), span(160, 300)] };
    expect(trackFreeAt(gap, f(100), f(160))).toBe(true);
    expect(trackFreeAt(gap, f(100), f(161))).toBe(false);
  });
  it('compares exact times, whatever their timescales', () => {
    const ntsc = { clips: [{ start: T.rt(0, 1), duration: T.rt(1001, 30000) }] }; // one 29.97 fps frame
    expect(trackFreeAt(ntsc, T.rt(1001, 30000), T.rt(1, 1))).toBe(true);
    expect(trackFreeAt(ntsc, T.rt(1000, 30000), T.rt(1, 1))).toBe(false);
  });
});

describe('soundTargetIfFree', () => {
  it('names the target only while it is free over the new sound', () => {
    const { doc, a1 } = project(); // A1 holds the linked sound 0..900
    expect(soundTargetIfFree(doc, a1, f(0), f(900))).toBeNull();
    expect(soundTargetIfFree(doc, a1, f(899), f(900))).toBeNull();
    expect(soundTargetIfFree(doc, a1, f(900), f(900))).toBe(a1);
    expect(soundTargetIfFree(doc, null, f(900), f(900))).toBeNull();
  });
  it('never names a track that is not a usable sound track', () => {
    const { doc, v1, a1 } = project();
    expect(soundTargetIfFree(doc, v1, f(900), f(900))).toBeNull();
    expect(soundTargetIfFree(doc, 'trk_gone', f(900), f(900))).toBeNull();
    const locked = tx(doc, [{ op: 'update_track', args: { trackId: a1, locked: true } }]).doc;
    expect(soundTargetIfFree(locked, a1, f(900), f(900))).toBeNull();
  });
});

describe('addedClipDuration mirrors the default of add_clip', () => {
  it('cuts the source to whole frames; a still picture gets 5 s', () => {
    expect(fi(addedClipDuration({ kind: 'audio', duration: T.rt(30, 1) }, R))).toBe(900);
    expect(addedClipDuration({ kind: 'audio', duration: T.rt(30_010, 1000) }, R)).toEqual(f(900)); // 30.01 s: the last third of a frame is dropped
    expect(addedClipDuration({ kind: 'image', duration: T.ZERO }, R)).toEqual(T.rt(5, 1));
  });
  it('is the duration the operation gives the clip', () => {
    const { doc, musicId } = project();
    const r = tx(doc, [{ op: 'add_clip', args: { assetId: musicId, start: f(900) } }]);
    const clip = r.doc.sequences[r.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === (r.results[0]!.output as any).clipId)!;
    expect(clip.duration).toEqual(addedClipDuration(r.doc.assets[musicId]!, R));
  });
});

describe('addAssetArgs: the + button of a library card (finding 23)', () => {
  const press = (doc: ProjectDocument, assetId: string, p: { playhead: number; videoTarget?: string | null; audioTarget?: string | null; appendPoint?: number }) =>
    tx(doc, [{ op: 'add_clip', args: addAssetArgs(doc, assetId, { appendPoint: f(p.appendPoint ?? 900), playhead: f(p.playhead), videoTarget: p.videoTarget ?? null, audioTarget: p.audioTarget ?? null }) }]).doc;

  it('the cause: add_clip uses a named sound track as given, so naming an occupied target stacks the clips (and the document stays valid)', () => {
    const { doc, musicId, a1 } = project();
    const d = tx(doc, [{ op: 'add_clip', args: { assetId: musicId, start: f(0), trackId: a1 } }]).doc; // what the + button used to send
    expect(sound(d)).toEqual(['A1: a.mp4[0..900) music.mp3[0..900)']);
    expect(validateProject(d)).toEqual([]);
    expect(stacked(d)).toHaveLength(2);
  });
  it('sound target occupied at the playhead: the target is not named and the sound lands on a free sound track', () => {
    const { doc, musicId, a1 } = project();
    expect(addAssetArgs(doc, musicId, { appendPoint: f(900), playhead: f(0), videoTarget: null, audioTarget: a1 })).toEqual({ assetId: musicId, start: f(0) });
    const d = press(doc, musicId, { playhead: 0, audioTarget: a1 });
    expect(sound(d)).toEqual(['A1: a.mp4[0..900)', 'A2: music.mp3[0..900)']);
    expect(stacked(d)).toEqual([]);
  });
  it('pressing + twice at the same playhead never stacks, each press deciding from the document as it then is', () => {
    const { doc, musicId, a1 } = project();
    const d = press(press(doc, musicId, { playhead: 0, audioTarget: a1 }), musicId, { playhead: 0, audioTarget: a1 });
    expect(sound(d)).toEqual(['A1: a.mp4[0..900)', 'A2: music.mp3[0..900)', 'A3: music.mp3[0..900)']);
    expect(stacked(d)).toEqual([]);
  });
  it('overlapping the target by a single frame is enough to leave it', () => {
    const { doc, musicId, a1 } = project();
    expect(sound(press(doc, musicId, { playhead: 899, audioTarget: a1 }))).toEqual(['A1: a.mp4[0..900)', 'A2: music.mp3[899..1799)']);
  });
  it('sound target free at the playhead: the target is named, also when the sound starts on the frame the other clip ends', () => {
    const { doc, musicId, a1 } = project();
    expect(addAssetArgs(doc, musicId, { appendPoint: f(900), playhead: f(900), videoTarget: null, audioTarget: a1 })).toEqual({ assetId: musicId, start: f(900), trackId: a1 });
    const d = press(doc, musicId, { playhead: 900, audioTarget: a1 });
    expect(sound(d)).toEqual(['A1: a.mp4[0..900) music.mp3[900..1800)']);
    expect(stacked(d)).toEqual([]);
  });
  it('the target is named over automatic placement when it is free: a free A2 chosen as target is used although A1 is free too', () => {
    const { doc, musicId, a1 } = project();
    const two = tx(doc, [{ op: 'add_track', args: { kind: 'audio' } }]).doc;
    const a2 = two.sequences[two.mainSequenceId]!.tracks.filter((t) => t.kind === 'audio').find((t) => t.id !== a1)!.id;
    expect(sound(press(two, musicId, { playhead: 900, audioTarget: a2 }))).toEqual(['A1: a.mp4[0..900)', 'A2: music.mp3[900..1800)']);
    expect(sound(press(two, musicId, { playhead: 900 }))).toEqual(['A1: a.mp4[0..900) music.mp3[900..1800)', 'A2: ']);
  });
  it('a sound longer than the gap on the target goes elsewhere; one that fits the gap stays on the target', () => {
    const { doc, musicId, a1 } = project();
    // A1: a.mp4 0..900, then music from 1800: a gap of exactly 900 frames, the length of the music
    const gap = tx(doc, [{ op: 'add_clip', args: { assetId: musicId, start: f(1800), trackId: a1 } }]).doc;
    expect(sound(press(gap, musicId, { playhead: 900, audioTarget: a1 }))).toEqual(['A1: a.mp4[0..900) music.mp3[900..1800) music.mp3[1800..2700)']);
    expect(sound(press(gap, musicId, { playhead: 901, audioTarget: a1 }))).toEqual(['A1: a.mp4[0..900) music.mp3[1800..2700)', 'A2: music.mp3[901..1801)']);
  });
  it('a picture file still goes after what is there, on the picture target, its linked sound on the sound target', () => {
    const { doc, videoId, v1, a1 } = project();
    expect(addAssetArgs(doc, videoId, { appendPoint: f(900), playhead: f(0), videoTarget: v1, audioTarget: a1 })).toEqual({ assetId: videoId, start: f(900), trackId: v1, audioTrackId: a1 });
    expect(addAssetArgs(doc, videoId, { appendPoint: f(900), playhead: f(0), videoTarget: null, audioTarget: null })).toEqual({ assetId: videoId, start: f(900) });
    const d = press(doc, videoId, { playhead: 0, videoTarget: v1, audioTarget: a1 });
    expect(sound(d)).toEqual(['A1: a.mp4[0..900) a.mp4[900..1800)']);
    expect(stacked(d)).toEqual([]);
  });
  it('an unknown file is still sent to the server, which names what is wrong', () => {
    const { doc, a1 } = project();
    expect(addAssetArgs(doc, 'ast_gone', { appendPoint: f(900), playhead: f(30), videoTarget: null, audioTarget: a1 })).toEqual({ assetId: 'ast_gone', start: f(30) });
  });
});

describe('dropAssetArgs: a library file dropped on the timeline', () => {
  const drop = (doc: ProjectDocument, assetId: string, frame: number, trackId: string | null, audioTarget: string | null) => {
    const args = dropAssetArgs(doc, assetId, { start: f(frame), trackId, audioTarget });
    return { args, doc: args ? tx(doc, [{ op: 'add_clip', args }]).doc : doc };
  };
  it('the linked sound of a picture file goes to the sound target only while the target is free there', () => {
    const { doc, videoId, a1 } = project();
    const v2 = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }]).doc;
    const upper = v2.sequences[v2.mainSequenceId]!.tracks.filter((t) => t.kind === 'video').find((t) => t.clips.length === 0)!.id;
    const over = drop(v2, videoId, 300, upper, a1); // above the first clip: the target A1 is occupied 0..900
    expect(over.args).toEqual({ assetId: videoId, start: f(300), trackId: upper });
    expect(sound(over.doc)).toEqual(['A1: a.mp4[0..900)', 'A2: a.mp4[300..1200)']);
    expect(stacked(over.doc)).toEqual([]);
    const after = drop(v2, videoId, 900, upper, a1);
    expect(after.args).toEqual({ assetId: videoId, start: f(900), trackId: upper, audioTrackId: a1 });
    expect(sound(after.doc)).toEqual(['A1: a.mp4[0..900) a.mp4[900..1800)']);
  });
  it('a sound-only file stays on the sound track it was dropped on (the user named that track); on a picture track or beside the tracks it is placed automatically', () => {
    const { doc, musicId, v1, a1 } = project();
    expect(dropAssetArgs(doc, musicId, { start: f(900), trackId: a1, audioTarget: null })).toEqual({ assetId: musicId, start: f(900), trackId: a1 });
    expect(dropAssetArgs(doc, musicId, { start: f(0), trackId: a1, audioTarget: a1 })).toEqual({ assetId: musicId, start: f(0), trackId: a1 });
    expect(dropAssetArgs(doc, musicId, { start: f(0), trackId: v1, audioTarget: a1 })).toEqual({ assetId: musicId, start: f(0) });
    expect(sound(drop(doc, musicId, 0, null, a1).doc)).toEqual(['A1: a.mp4[0..900)', 'A2: music.mp3[0..900)']);
  });
  it('differs from the rule before the fix in exactly one case: a picture file with sound whose sound target is occupied there, where the target is no longer named', () => {
    const { doc, videoId, musicId, v1, a1 } = project();
    // V1 + A1 hold a.mp4 0..900; V2 and A2 are empty; A3 is locked
    const more = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }, { op: 'add_track', args: { kind: 'audio' } }, { op: 'add_track', args: { kind: 'audio' } }]);
    const [v2, a2, a3] = more.results.map((r) => r.output!.trackId as string) as [string, string, string];
    const d = tx(more.doc, [{ op: 'update_track', args: { trackId: a3, locked: true } }]).doc;
    /** The arguments `dropAsset` built before the fix (9c87eb6), kept here as the reference: the linked sound always went to the sound target. */
    const before = (assetId: string, frame: number, trackId: string | null, audioTarget: string | null) => {
      const a = d.assets[assetId]!;
      const picture = !!a.video || a.kind === 'image';
      const tr = trackId ? d.sequences[d.mainSequenceId]!.tracks.find((t) => t.id === trackId) : undefined;
      const fits = !!tr && !tr.locked && tr.kind === (picture ? 'video' : 'audio');
      return { assetId, start: f(frame), ...(fits ? { trackId: tr!.id } : {}), ...(picture && a.audio && audioTarget ? { audioTrackId: audioTarget } : {}) };
    };
    const apply = (args: Record<string, unknown>) => { try { return tx(d, [{ op: 'add_clip', args }]).doc; } catch { return null; } }; // null: refused (a picture on an occupied picture track)
    const changed: string[] = [];
    let same = 0, unstacked = 0;
    for (const assetId of [videoId, musicId]) for (const frame of [0, 300, 899, 900, 1500]) for (const trackId of [null, v1, v2, a1, a2, a3, 'trk_gone']) for (const audioTarget of [null, a1, a2]) { // the editor never hands over a locked or missing target
      const old = before(assetId, frame, trackId, audioTarget), now = dropAssetArgs(d, assetId, { start: f(frame), trackId, audioTarget });
      if (JSON.stringify(now) === JSON.stringify(old)) { same++; continue; }
      changed.push(`${d.assets[assetId]!.name}@${frame} target ${audioTarget === a1 ? 'A1' : 'other'}`);
      const { audioTrackId, ...rest } = old as Record<string, unknown>;
      expect(audioTrackId).toBe(a1); // only the occupied target ...
      expect(now).toEqual(rest); // ... is left out; the frame and the picture track are as before
      const was = apply(old), is = apply(now!);
      expect(was === null).toBe(is === null); // what was refused is still refused
      if (was && is) { expect(stacked(was).length).toBeGreaterThan(0); expect(stacked(is)).toEqual([]); unstacked++; }
    }
    // the video over 0..900 of A1 (frames 0, 300, 899), on each of the 7 drop places, with A1 as target: 21 of 210 cases
    expect([...new Set(changed)]).toEqual(['a.mp4@0 target A1', 'a.mp4@300 target A1', 'a.mp4@899 target A1']);
    expect([changed.length, same]).toEqual([21, 189]);
    expect(unstacked).toBe(18); // the other 3 are drops on the occupied V1, refused before and now
  });
  it('a locked track is not named; an unknown file places nothing', () => {
    const { doc, musicId, a1 } = project();
    const locked = tx(doc, [{ op: 'update_track', args: { trackId: a1, locked: true } }]).doc;
    expect(dropAssetArgs(locked, musicId, { start: f(900), trackId: a1, audioTarget: null })).toEqual({ assetId: musicId, start: f(900) });
    expect(dropAssetArgs(doc, 'ast_gone', { start: f(0), trackId: a1, audioTarget: null })).toBeNull();
  });
});
