/**
 * Link groups: a link needs two clips. Every edit that removes, divides or detaches clips of a link group clears the link
 * id of a clip it leaves as the only member, in the same transaction, and undo brings the link back.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, diffEntities, findClip, loneLinkClips, restoreEntities, validateProject, OpError,
  type MediaClip, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `ln${n++}_`, actor: 'test', allowInternal });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : `other: ${e}`; } return 'ok'; };
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance,
};
const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance };

/** A picture with its linked sound, 0 … 120 frames. */
function pair() {
  let r = tx(createProject({ id: 'prj_ln', name: 'L' }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: song } }], true);
  const assetId = r.results[0]!.output!.assetId as string, songId = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(120) } }]);
  const out = r.results[0]!.output as { clipId: string; audioClipId: string; trackId: string };
  const audioTrack = findClip(r.doc, out.audioClipId)!.track.id;
  return { doc: r.doc, assetId, songId, v: out.clipId, a: out.audioClipId, videoTrack: out.trackId, audioTrack };
}
const media = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;
const all = (d: ProjectDocument) => Object.values(d.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).filter((c): c is MediaClip => c.type === 'media');
const at = (d: ProjectDocument, trackId: string) => Object.values(d.sequences)[0]!.tracks.find((t) => t.id === trackId)!.clips as MediaClip[];
/** Undo as the store does it: the before-states of every entity the transaction changed. It must give the document back exactly. */
function expectUndo(before: ProjectDocument, after: ProjectDocument) {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  expect(back).toEqual(before);
}
const lock = (d: ProjectDocument, trackId: string) => tx(d, [{ op: 'update_track', args: { trackId, locked: true } }]).doc;

describe('a link group never keeps a single clip', () => {
  it('delete_clip with includeLinked=false unlinks the clip it was linked to; undo brings the link back', () => {
    for (const side of ['v', 'a'] as const) {
      const p = pair();
      const gone = p[side], kept = side === 'v' ? p.a : p.v;
      const r = tx(p.doc, [{ op: 'delete_clip', args: { clipId: gone, includeLinked: false } }]);
      expect(findClip(r.doc, gone)).toBeUndefined();
      expect(media(r.doc, kept).linkGroupId).toBeNull();
      expect(r.results[0]!.output).toEqual({ deletedClipIds: [gone], unlinkedClipIds: [kept] });
      expect(r.affectedIds).toContain(kept);
      expect(loneLinkClips(r.doc)).toEqual([]);
      expectUndo(p.doc, r.doc);
    }
    // the default deletes both, and nothing is left to unlink
    const p = pair();
    const both = tx(p.doc, [{ op: 'delete_clip', args: { clipId: p.v } }]);
    expect(both.results[0]!.output).toEqual({ deletedClipIds: [p.v, p.a], unlinkedClipIds: [] });
  });

  it('of three linked clips, deleting one alone leaves the other two linked to each other', () => {
    const p = pair();
    const extra = tx(p.doc, [{ op: 'add_track', args: { kind: 'audio' } }, { op: 'unlink_clip', args: { clipId: p.v } }]);
    const third = tx(extra.doc, [{ op: 'add_clip', args: { assetId: p.songId, start: f(0), duration: f(120), trackId: extra.results[0]!.output!.trackId as string } }]);
    const thirdId = third.results[0]!.output!.clipId as string;
    const d = tx(third.doc, [{ op: 'link_clips', args: { clipIds: [p.v, p.a, thirdId] } }]).doc;
    const r = tx(d, [{ op: 'delete_clip', args: { clipId: p.v, includeLinked: false } }]);
    expect(media(r.doc, p.a).linkGroupId).toBeTruthy();
    expect(media(r.doc, p.a).linkGroupId).toBe(media(r.doc, thirdId).linkGroupId);
    expect((r.results[0]!.output as { unlinkedClipIds: string[] }).unlinkedClipIds).toEqual([]);
    expectUndo(d, r.doc);
  });

  it('the clip left alone is on a locked track: refused, since its link would have to be cleared', () => {
    const p = pair();
    const locked = lock(p.doc, p.audioTrack);
    let err: unknown;
    try { tx(locked, [{ op: 'delete_clip', args: { clipId: p.v, includeLinked: false } }]); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(OpError);
    expect((err as OpError).code).toBe('track_locked');
    expect((err as OpError).details).toMatchObject({ trackId: p.audioTrack, clipId: p.a });
    expect((err as OpError).hint).toMatch(/[Uu]nlock/);
    expect(code(() => tx(lock(p.doc, p.audioTrack), [{ op: 'speed_ramp', args: { clipId: p.v, from: 1, to: 2, steps: 2, includeLinked: false } }]))).toBe('track_locked');
    expect(code(() => tx(locked, [{ op: 'cut_range', args: { start: f(0), end: f(120), trackIds: [p.videoTrack], ripple: false } }]))).toBe('track_locked');
  });

  it('cut_range on some tracks: a clip whose linked clip is removed, or divided while it is not, is unlinked; undo brings the links back', () => {
    // the whole picture is removed, the sound is on a track that is not cut
    const p = pair();
    const r = tx(p.doc, [{ op: 'cut_range', args: { start: f(0), end: f(120), trackIds: [p.videoTrack] } }]);
    expect(findClip(r.doc, p.v)).toBeUndefined();
    expect(media(r.doc, p.a).linkGroupId).toBeNull();
    expect((r.results[0]!.output as { unlinkedClipIds: string[] }).unlinkedClipIds).toEqual([p.a]);
    expect(r.affectedIds).toContain(p.a);
    expectUndo(p.doc, r.doc);
    // the picture is cut in two: its first part stays linked to the sound, the second part is linked to nothing
    const mid = tx(p.doc, [{ op: 'cut_range', args: { start: f(40), end: f(60), trackIds: [p.videoTrack] } }]);
    const pic = at(mid.doc, p.videoTrack);
    expect(pic.map((c) => [T.frameIndexAt(c.start, R), T.frameIndexAt(c.duration, R)])).toEqual([[0, 40], [40, 60]]);
    expect(pic[0]!.linkGroupId).toBe(media(mid.doc, p.a).linkGroupId);
    expect(pic[0]!.linkGroupId).toBeTruthy();
    expect(pic[1]!.linkGroupId).toBeNull();
    expect(loneLinkClips(mid.doc)).toEqual([]);
    expectUndo(p.doc, mid.doc);
    // on every track, both are cut alike and every part keeps a partner
    const everywhere = tx(p.doc, [{ op: 'cut_range', args: { start: f(40), end: f(60) } }]);
    expect(all(everywhere.doc).every((c) => !!c.linkGroupId)).toBe(true);
    expect(loneLinkClips(everywhere.doc)).toEqual([]);
    expect((everywhere.results[0]!.output as { unlinkedClipIds: string[] }).unlinkedClipIds).toEqual([]);
  });

  it('cut_range on every track, after the sound was trimmed on its own: the picture that outlives its sound is unlinked', () => {
    const p = pair();
    const trimmed = tx(p.doc, [{ op: 'trim_clip', args: { clipId: p.a, edge: 'end', to: f(60), includeLinked: false } }]).doc;
    const r = tx(trimmed, [{ op: 'cut_range', args: { start: f(0), end: f(60), ripple: false } }]);
    expect(findClip(r.doc, p.a)).toBeUndefined();
    expect(media(r.doc, p.v).linkGroupId).toBeNull();
    expectUndo(trimmed, r.doc);
  });

  it('insert_gap on the picture track only: the later part of the picture is linked to nothing; undo', () => {
    const p = pair();
    const r = tx(p.doc, [{ op: 'insert_gap', args: { at: f(50), duration: f(30), trackIds: [p.videoTrack] } }]);
    const pic = at(r.doc, p.videoTrack);
    expect(pic.length).toBe(2);
    expect(pic[0]!.linkGroupId).toBe(media(r.doc, p.a).linkGroupId);
    expect(pic[1]!.linkGroupId).toBeNull();
    expect((r.results[0]!.output as { unlinkedClipIds: string[] }).unlinkedClipIds).toEqual([pic[1]!.id]);
    expect(loneLinkClips(r.doc)).toEqual([]);
    expectUndo(p.doc, r.doc);
  });

  it('freeze_frame where the sound was trimmed short on its own: the later part of the picture is linked to nothing; undo', () => {
    const p = pair();
    const trimmed = tx(p.doc, [{ op: 'trim_clip', args: { clipId: p.a, edge: 'end', to: f(30), includeLinked: false } }]).doc;
    const r = tx(trimmed, [{ op: 'freeze_frame', args: { clipId: p.v, at: f(60), duration: f(15) } }]);
    const pic = at(r.doc, p.videoTrack).filter((c) => !c.freeze);
    expect(pic.length).toBe(2);
    expect(pic[0]!.linkGroupId).toBe(media(r.doc, p.a).linkGroupId);
    expect(pic[1]!.linkGroupId).toBeNull();
    expect(loneLinkClips(r.doc)).toEqual([]);
    expectUndo(trimmed, r.doc);
  });

  it('speed_ramp with includeLinked=false: the steps are linked to nothing and neither is the sound; undo', () => {
    const p = pair();
    const r = tx(p.doc, [{ op: 'speed_ramp', args: { clipId: p.v, from: 1, to: 2, steps: 3, includeLinked: false } }]);
    expect(at(r.doc, p.videoTrack).every((c) => c.linkGroupId === null)).toBe(true);
    expect(media(r.doc, p.a).linkGroupId).toBeNull();
    expect((r.results[0]!.output as { unlinkedClipIds: string[] }).unlinkedClipIds).toEqual([p.a]);
    expectUndo(p.doc, r.doc);
    // with its sound, the steps are linked pairwise as before
    const both = tx(p.doc, [{ op: 'speed_ramp', args: { clipId: p.v, from: 1, to: 2, steps: 3 } }]);
    expect(loneLinkClips(both.doc)).toEqual([]);
    expect(all(both.doc).every((c) => !!c.linkGroupId)).toBe(true);
  });

  it('a regenerated recipe that removes one clip of a pair (the other was edited by hand) unlinks the one that stays; undo', () => {
    const p = pair();
    const r = tx(p.doc, [{ op: 'apply_recipe', args: { recipeId: 'test', params: {}, steps: ['x'], removeClipIds: [p.v], ops: [{ op: 'add_marker', args: { time: f(10) } }] } }], true);
    expect(findClip(r.doc, p.v)).toBeUndefined();
    expect(media(r.doc, p.a).linkGroupId).toBeNull();
    expect(r.affectedIds).toContain(p.a);
    expectUndo(p.doc, r.doc);
  });

  it('a project that already holds a link id of one clip stays valid and editable, and edits treat it as unlinked', () => {
    // made by hand: the state an older build left after delete_clip with includeLinked=false
    const p = pair();
    const old = structuredClone(p.doc);
    for (const s of Object.values(old.sequences)) for (const t of s.tracks) t.clips = t.clips.filter((c) => c.id !== p.v);
    expect(loneLinkClips(old)).toEqual([p.a]);
    expect(validateProject(old)).toEqual([]);
    // unrelated edits are not refused and do not touch it
    const titled = tx(old, [{ op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(30) } }]);
    expect(media(titled.doc, p.a).linkGroupId).toBe(media(old, p.a).linkGroupId);
    // dividing it clears it on the way
    const split = tx(old, [{ op: 'split_clip', args: { clipId: p.a, at: f(60) } }]);
    expect(loneLinkClips(split.doc)).toEqual([]);
    expectUndo(old, split.doc);
    // it can be fitted to the picture and linked to another clip without unlink_clip first
    expect(code(() => tx(old, [{ op: 'fit_music', args: { clipId: p.a, to: f(90) } }]))).toBe('ok');
    const pic = tx(old, [{ op: 'add_clip', args: { assetId: p.assetId, start: f(0), duration: f(120), withLinkedAudio: false } }]);
    const picId = pic.results[0]!.output!.clipId as string;
    const linked = tx(pic.doc, [{ op: 'link_clips', args: { clipIds: [picId, p.a] } }]);
    expect(media(linked.doc, p.a).linkGroupId).toBe(media(linked.doc, picId).linkGroupId);
    expect(loneLinkClips(linked.doc)).toEqual([]);
    // two clips that really are linked still cannot be linked again
    expect(code(() => tx(p.doc, [{ op: 'link_clips', args: { clipIds: [p.v, p.a] } }]))).toBe('incompatible');
  });

  it('property: whatever edits are made, no link group of one is left, and each edit undoes exactly', () => {
    const base = (() => {
      const p = pair();
      // a second pair on the same two tracks, after the first
      const r = tx(p.doc, [{ op: 'add_clip', args: { assetId: p.assetId, start: f(150), sourceIn: f(30), duration: f(60), trackId: p.videoTrack, audioTrackId: p.audioTrack } }]);
      return { ...p, doc: r.doc };
    })();
    expect(loneLinkClips(base.doc)).toEqual([]);
    const frame = fc.integer({ min: 0, max: 220 });
    const len = fc.integer({ min: 1, max: 80 });
    const pick = fc.nat();
    const flag = fc.boolean();
    const step = fc.oneof(
      fc.record({ op: fc.constant('delete_clip'), k: pick, alone: flag }),
      fc.record({ op: fc.constant('cut_range'), s: frame, l: len, tracks: fc.constantFrom('both', 'video', 'audio'), ripple: flag }),
      fc.record({ op: fc.constant('insert_gap'), s: frame, l: len, tracks: fc.constantFrom('both', 'video', 'audio') }),
      fc.record({ op: fc.constant('split_clip'), k: pick, s: frame, alone: flag }),
      fc.record({ op: fc.constant('trim_clip'), k: pick, s: frame, end: flag }),
      fc.record({ op: fc.constant('move_clip'), k: pick, s: frame }),
      fc.record({ op: fc.constant('freeze_frame'), k: pick, s: frame, l: len }),
      fc.record({ op: fc.constant('speed_ramp'), k: pick, alone: flag }),
      fc.record({ op: fc.constant('apply_speed_curve'), k: pick, alone: flag }),
      fc.record({ op: fc.constant('set_clip_reverse'), k: pick, alone: flag }),
      fc.record({ op: fc.constant('duplicate_clips'), k: pick, s: frame }),
      fc.record({ op: fc.constant('unlink_clip'), k: pick }),
    );
    fc.assert(fc.property(fc.array(step, { minLength: 1, maxLength: 8 }), (steps) => {
      let doc = base.doc;
      for (const s of steps) {
        const clips = all(doc);
        if (!clips.length) break;
        const c = clips[('k' in s ? s.k : 0) % clips.length]!;
        const tracks = (t: string) => (t === 'video' ? [base.videoTrack] : t === 'audio' ? [base.audioTrack] : undefined);
        const call: OpCall =
          s.op === 'delete_clip' ? { op: s.op, args: { clipId: c.id, ...(s.alone ? { includeLinked: false } : {}) } }
          : s.op === 'cut_range' ? { op: s.op, args: { start: f(s.s), end: f(s.s + s.l), ripple: s.ripple, ...(tracks(s.tracks) ? { trackIds: tracks(s.tracks) } : {}) } }
          : s.op === 'insert_gap' ? { op: s.op, args: { at: f(s.s), duration: f(s.l), ...(tracks(s.tracks) ? { trackIds: tracks(s.tracks) } : {}) } }
          : s.op === 'split_clip' ? { op: s.op, args: { clipId: c.id, at: f(s.s), ...(s.alone ? { includeLinked: false } : {}) } }
          : s.op === 'trim_clip' ? { op: s.op, args: { clipId: c.id, edge: s.end ? 'end' : 'start', to: f(s.s), includeLinked: false } }
          : s.op === 'move_clip' ? { op: s.op, args: { clipId: c.id, start: f(s.s), includeLinked: false } }
          : s.op === 'freeze_frame' ? { op: s.op, args: { clipId: c.id, at: f(s.s), duration: f(s.l) } }
          : s.op === 'speed_ramp' ? { op: s.op, args: { clipId: c.id, from: 1, to: 2, steps: 2, ...(s.alone ? { includeLinked: false } : {}) } }
          : s.op === 'apply_speed_curve' ? { op: s.op, args: { clipId: c.id, preset: 'hero', ...(s.alone ? { includeLinked: false } : {}) } }
          : s.op === 'set_clip_reverse' ? { op: s.op, args: { clipId: c.id, reverse: !c.reverse, ...(s.alone ? { includeLinked: false } : {}) } }
          : s.op === 'duplicate_clips' ? { op: s.op, args: { clipIds: [c.id], at: f(s.s) } }
          : { op: s.op, args: { clipId: c.id } };
        let next: ProjectDocument;
        try { next = tx(doc, [call]).doc; } catch (e) { if (e instanceof OpError) continue; throw e; }
        expect(loneLinkClips(next), `${call.op} ${JSON.stringify(call.args)}`).toEqual([]);
        expectUndo(doc, next);
        doc = next;
      }
    }), { numRuns: 300 });
  }, 120_000);
});
