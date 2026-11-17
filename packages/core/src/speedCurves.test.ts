import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import {
  applyTransaction, clipEnd, createProject, curvePolyline, findClip, segmentsFromPoints, sourceEnd, SPEED_CURVES, toSourceSpan, validateProject, OpError,
  type MediaClip, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `c${n++}_`, actor: 'test', allowInternal });
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-16T00:00:00Z', importedBy: 'test' },
};
/** One 8-second clip of a 20-second file (source 2 s … 10 s) with its linked sound, at the start of the timeline. */
function project(frames = 240) {
  let r = tx(createProject({ id: 'prj_c', name: 'C' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: T.rt(2, 1), duration: f(frames) } }]);
  return { doc: r.doc, assetId, clipId: r.results[0]!.output!.clipId as string };
}
const media = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : `other: ${e}`; } return 'ok'; };
const frameSeconds = 1 / 30;

describe('speed curves', () => {
  it('the catalogue is well formed', () => {
    expect(SPEED_CURVES.length).toBeGreaterThanOrEqual(14);
    // the eight velocity presets the specification names (Appendix A): each has a curve here
    for (const id of ['montage', 'hero', 'bullet', 'flash-in', 'flash-out', 'jump-cut', 'smooth-ramp', 'stutter']) expect(SPEED_CURVES.some((c) => c.id === id), id).toBe(true);
    expect(new Set(SPEED_CURVES.map((c) => c.id)).size).toBe(SPEED_CURVES.length);
    for (const c of SPEED_CURVES) {
      expect(c.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(c.name.he.length && c.name.en.length && c.hint.he.length && c.hint.en.length).toBeGreaterThan(0);
      expect(c.segments.length).toBeGreaterThanOrEqual(1);
      for (const s of c.segments) {
        expect(Number.isInteger(s.weight) && s.weight > 0).toBe(true);
        for (const v of [s.from, s.to]) expect(v >= 0.1 && v <= 8).toBe(true);
      }
      // a curve without steps is continuous: each segment starts at the speed the previous one ended at
      if (c.id !== 'jump-cut' && c.id !== 'stutter') for (let i = 1; i < c.segments.length; i++) expect(c.segments[i]!.from).toBe(c.segments[i - 1]!.to);
      const line = curvePolyline(c.segments, c.smooth);
      expect(line[0]!.x).toBe(0);
      expect(line[line.length - 1]!.x).toBeCloseTo(1, 9);
      for (let i = 1; i < line.length; i++) expect(line[i]!.x).toBeGreaterThanOrEqual(line[i - 1]!.x);
    }
  });

  it('every preset keeps the source contiguous, ends within a frame of the old end, and gives picture and sound the same parts', () => {
    for (const curve of SPEED_CURVES) {
      const { doc, clipId } = project();
      const before = media(doc, clipId);
      const srcStart = before.sourceIn, srcEnd = sourceEnd(before);
      const r = tx(doc, [{ op: 'apply_speed_curve', args: { clipId, preset: curve.id } }]);
      expect(validateProject(r.doc), curve.id).toEqual([]);
      const out = r.results[0]!.output as { partClipIds: string[]; createdClipIds: string[]; durationFrames: number; deltaFrames: number; parts: { frames: number; from: number; to: number }[] };
      expect(out.partClipIds.length).toBe(curve.segments.length);
      expect(out.partClipIds[0]).toBe(clipId); // the first part keeps the id
      const parts = out.partClipIds.map((id) => media(r.doc, id));
      // on the timeline: back to back from the old start
      let at = T.ZERO;
      for (const p of parts) { expect(T.eq(p.start, at), curve.id).toBe(true); at = clipEnd(p); }
      expect(T.eq(at, f(out.durationFrames))).toBe(true);
      expect(out.deltaFrames).toBe(out.durationFrames - 240);
      // in the source: each part starts exactly where the previous one stopped
      let src = srcStart;
      for (const p of parts) { expect(T.eq(p.sourceIn, src), curve.id).toBe(true); src = sourceEnd(p); }
      const shortBy = T.toSeconds(T.sub(srcEnd, src));
      // never past the old end; short of it by less than what the fastest part plays in one frame
      expect(shortBy).toBeGreaterThanOrEqual(0);
      expect(shortBy).toBeLessThan(frameSeconds * 8);
      // speeds as the curve says
      parts.forEach((p, k) => {
        const sg = curve.segments[k]!;
        expect((p.speed?.num ?? 1) / (p.speed?.den ?? 1)).toBeCloseTo(sg.from, 6);
        if (sg.from === sg.to) expect(p.speedEnd).toBeUndefined();
        else { expect(p.speedEnd!.num / p.speedEnd!.den).toBeCloseTo(sg.to, 6); expect(p.speedCurve).toBe(curve.smooth ? 'smooth' : undefined); }
        expect(p.rampWindow).toBeUndefined();
      });
      // linked sound: one part per picture part, same place, length, source and speed; linked pair by pair
      const tracks = Object.values(r.doc.sequences)[0]!.tracks;
      const sound = tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips) as MediaClip[];
      expect(sound.length, curve.id).toBe(parts.length);
      const groups = new Set<string>();
      parts.forEach((p, k) => {
        const s = sound[k]!;
        expect(T.eq(s.start, p.start) && T.eq(s.duration, p.duration) && T.eq(s.sourceIn, p.sourceIn)).toBe(true);
        expect(s.speed).toEqual(p.speed); expect(s.speedEnd).toEqual(p.speedEnd);
        expect(s.linkGroupId && s.linkGroupId === p.linkGroupId).toBeTruthy();
        groups.add(p.linkGroupId!);
      });
      expect(groups.size).toBe(parts.length);
    }
  });

  it('what follows on the same tracks moves by the difference; music on another track stays; ripple=false leaves everything', () => {
    const { doc, clipId, assetId } = project();
    const v1 = findClip(doc, clipId)!.track.id;
    let d = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(240), trackId: v1, duration: f(60) } }]).doc; // a second clip right after, with its sound
    const second = Object.values(d.sequences)[0]!.tracks.find((t) => t.id === v1)!.clips[1]!.id;
    const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'f'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: asset.provenance };
    const music = tx(d, [{ op: 'import_asset', args: { asset: song } }, { op: 'add_track', args: { kind: 'audio' } }], true);
    const musicTrack = music.results[1]!.output!.trackId as string;
    const placed = tx(music.doc, [{ op: 'add_clip', args: { assetId: music.results[0]!.output!.assetId as string, start: f(0), trackId: musicTrack, duration: f(400) } }]);
    d = placed.doc;
    const musicId = placed.results[0]!.output!.clipId as string;
    const r = tx(d, [{ op: 'apply_speed_curve', args: { clipId, preset: 'bullet' } }]);
    expect(validateProject(r.doc)).toEqual([]);
    const out = r.results[0]!.output as { durationFrames: number; deltaFrames: number; movedClipIds: string[] };
    expect(out.deltaFrames).not.toBe(0);
    expect(T.eq(media(r.doc, second).start, f(out.durationFrames))).toBe(true); // still right after the curve
    const secondSound = Object.values(r.doc.sequences)[0]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'media' && c.id !== second && c.linkGroupId === media(r.doc, second).linkGroupId)!;
    expect(T.eq(secondSound.start, f(out.durationFrames))).toBe(true); // and its sound came with it
    expect(out.movedClipIds).toContain(second);
    expect(T.eq(media(r.doc, musicId).start, f(0)) && T.eq(media(r.doc, musicId).duration, f(400))).toBe(true); // music untouched
    // ripple=false: a curve that gets shorter leaves a gap; one that gets longer is refused when something is in the way
    const shorter = tx(d, [{ op: 'apply_speed_curve', args: { clipId, preset: 'fast-forward', ripple: false } }]);
    expect((shorter.results[0]!.output as { deltaFrames: number }).deltaFrames).toBeLessThan(0);
    expect(T.eq(media(shorter.doc, second).start, f(240))).toBe(true);
    expect(code(() => tx(d, [{ op: 'apply_speed_curve', args: { clipId, preset: 'slow-down', ripple: false } }]))).toBe('overlap');
  });

  it('a hand-made curve from points; bad points and unusable clips are refused with a reason', () => {
    const { doc, clipId, assetId } = project();
    const r = tx(doc, [{ op: 'apply_speed_curve', args: { clipId, points: [{ at: 0, speed: 1 }, { at: 0.5, speed: 4 }, { at: 1, speed: 1 }] } }]);
    expect(validateProject(r.doc)).toEqual([]);
    const ids = (r.results[0]!.output as { partClipIds: string[] }).partClipIds;
    expect(ids.length).toBe(2);
    expect(media(r.doc, ids[0]!).speedCurve).toBe('smooth');
    expect(media(r.doc, ids[0]!).speedEnd).toEqual({ num: 4, den: 1 });
    // 4 s of source at an average of 2.5× = 1.6 s = 48 frames, twice
    expect(T.eq(media(r.doc, ids[0]!).duration, f(48)) && T.eq(media(r.doc, ids[1]!).duration, f(48))).toBe(true);
    const even = tx(doc, [{ op: 'apply_speed_curve', args: { clipId, smooth: false, points: [{ at: 0, speed: 1 }, { at: 1, speed: 2 }] } }]);
    expect(media(even.doc, clipId).speedCurve).toBeUndefined();
    expect(segmentsFromPoints([{ at: 0, speed: 1 }])).toBeNull();
    expect(segmentsFromPoints([{ at: 0.1, speed: 1 }, { at: 1, speed: 2 }])).toBeNull();
    expect(segmentsFromPoints([{ at: 0, speed: 1 }, { at: 0.6, speed: 2 }, { at: 0.6, speed: 3 }, { at: 1, speed: 1 }])).toBeNull();
    expect(code(() => tx(doc, [{ op: 'apply_speed_curve', args: { clipId, points: [{ at: 0, speed: 1 }, { at: 0.9, speed: 2 }] } }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'apply_speed_curve', args: { clipId } }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero', points: [{ at: 0, speed: 1 }, { at: 1, speed: 2 }] } }]))).toBe('invalid_args');
    // too short for a curve of many parts: refused, nothing half-done
    const tiny = project(6);
    expect(code(() => tx(tiny.doc, [{ op: 'apply_speed_curve', args: { clipId: tiny.clipId, preset: 'surge' } }]))).toBe('out_of_bounds');
    // keyframes, a reversed clip, a kept pitch (with a gradual curve) and a transition are refused
    const keyed = tx(doc, [{ op: 'set_keyframe', args: { clipId, property: 'scale', time: f(0), value: 1.2 } }]).doc;
    expect(code(() => tx(keyed, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero' } }]))).toBe('incompatible');
    const reversed = tx(doc, [{ op: 'set_clip_reverse', args: { clipId, reverse: true } }]).doc;
    expect(code(() => tx(reversed, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero' } }]))).toBe('incompatible');
    const pitched = tx(doc, [{ op: 'set_clip_pitch', args: { clipId, keepPitch: true } }]).doc;
    expect(code(() => tx(pitched, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero' } }]))).toBe('incompatible');
    expect(code(() => tx(pitched, [{ op: 'apply_speed_curve', args: { clipId, preset: 'jump-cut' } }]))).toBe('ok'); // steps only: each part has one speed
    const v1 = findClip(doc, clipId)!.track.id;
    const two = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(240), trackId: v1, duration: f(60) } }]);
    const withTransition = tx(two.doc, [{ op: 'set_transition', args: { clipId: two.results[0]!.output!.clipId as string, type: 'dissolve', frames: 10 } }]).doc;
    expect(code(() => tx(withTransition, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero' } }]))).toBe('incompatible');
  });

  it('random hand-made curves on random clips: valid project, contiguous source, never past the old end', () => {
    fc.assert(fc.property(
      fc.integer({ min: 20, max: 300 }), fc.integer({ min: 0, max: 200 }),
      fc.array(fc.record({ at: fc.integer({ min: 1, max: 999 }), speed: fc.integer({ min: 100, max: 8000 }) }), { minLength: 0, maxLength: 6 }),
      fc.integer({ min: 100, max: 8000 }), fc.integer({ min: 100, max: 8000 }), fc.boolean(),
      (frames, inFrames, mids, first, last, smooth) => {
        let r = tx(createProject({ id: 'prj_r', name: 'R' }), [{ op: 'import_asset', args: { asset } }], true);
        const assetId = r.results[0]!.output!.assetId as string;
        r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(inFrames), duration: f(frames) } }]);
        const clipId = r.results[0]!.output!.clipId as string;
        const ats = [...new Set(mids.map((m) => m.at))].sort((a, b) => a - b);
        const points = [{ at: 0, speed: first / 1000 }, ...ats.map((at) => ({ at: at / 1000, speed: mids.find((m) => m.at === at)!.speed / 1000 })), { at: 1, speed: last / 1000 }];
        const before = media(r.doc, clipId);
        const oldEnd = sourceEnd(before);
        let out;
        try { out = tx(r.doc, [{ op: 'apply_speed_curve', args: { clipId, points, smooth } }]); }
        catch (e) { expect(e).toBeInstanceOf(OpError); expect((e as OpError).code).toBe('out_of_bounds'); return; } // too short for these points: a typed refusal
        expect(validateProject(out.doc)).toEqual([]);
        const ids = (out.results[0]!.output as { partClipIds: string[] }).partClipIds;
        let src = before.sourceIn, at = T.ZERO;
        for (const id of ids) {
          const p = media(out.doc, id);
          expect(T.eq(p.sourceIn, src) && T.eq(p.start, at)).toBe(true);
          expect(T.lt(T.ZERO, toSourceSpan(p, p.duration))).toBe(true);
          src = sourceEnd(p); at = clipEnd(p);
        }
        expect(T.lte(src, oldEnd)).toBe(true);
      },
    ), { numRuns: 150 });
  });
});

describe('speed curves: links and crossfades', () => {
  const tracksOf = (d: ProjectDocument) => Object.values(d.sequences)[0]!.tracks;
  const all = (d: ProjectDocument) => tracksOf(d).flatMap((t) => t.clips).filter((c): c is MediaClip => c.type === 'media');
  const partsOf = (r: ReturnType<typeof tx>) => (r.results[r.results.length - 1]!.output as { partClipIds: string[] }).partClipIds;
  const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'f'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: asset.provenance };

  it('a clip curved on its own leaves no part linked to another part: each part can be deleted, split and trimmed alone', () => {
    // (a) the sound was deleted on its own before, so the picture still carries its old link id
    const a = project();
    const soundId = all(a.doc).find((c) => c.id !== a.clipId)!.id;
    const lone = tx(a.doc, [{ op: 'delete_clip', args: { clipId: soundId, includeLinked: false } }]).doc;
    expect(media(lone, a.clipId).linkGroupId).toBeTruthy(); // the precondition: a link id that points at nothing
    // (b) the picture is curved without its sound
    const b = project();
    for (const [name, doc, clipId, extra] of [['lone', lone, a.clipId, {}], ['includeLinked=false', b.doc, b.clipId, { includeLinked: false }]] as const) {
      const r = tx(doc, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero', ...extra } }]);
      expect(validateProject(r.doc), name).toEqual([]);
      const ids = partsOf(r);
      expect(ids.length, name).toBe(5);
      for (const id of ids) expect(media(r.doc, id).linkGroupId, name).toBeNull();
      // no clip is left with a link id that only it carries
      const count = new Map<string, number>();
      for (const c of all(r.doc)) if (c.linkGroupId) count.set(c.linkGroupId, (count.get(c.linkGroupId) ?? 0) + 1);
      for (const [id, n] of count) expect(n, `${name}: ${id}`).toBeGreaterThan(1);
      const before = all(r.doc).length;
      const third = media(r.doc, ids[2]!);
      expect(all(tx(r.doc, [{ op: 'delete_clip', args: { clipId: third.id } }]).doc).length, name).toBe(before - 1);
      expect(code(() => tx(r.doc, [{ op: 'split_clip', args: { clipId: third.id, at: T.add(third.start, f(10)) } }])), name).toBe('ok');
      expect(code(() => tx(r.doc, [{ op: 'trim_clip', args: { clipId: third.id, edge: 'end', to: T.sub(clipEnd(third), f(1)) } }])), name).toBe('ok');
    }
    // the sound that was left out is still there, whole, and no longer linked
    const r = tx(b.doc, [{ op: 'apply_speed_curve', args: { clipId: b.clipId, preset: 'hero', includeLinked: false } }]);
    const sound = tracksOf(r.doc).filter((t) => t.kind === 'audio').flatMap((t) => t.clips) as MediaClip[];
    expect(sound.length).toBe(1);
    expect(T.eq(sound[0]!.duration, f(240))).toBe(true);
    expect(sound[0]!.linkGroupId).toBeNull();
    expect(r.results[0]!.affectedIds).toContain(sound[0]!.id);
  });

  it('left out of a group of three, the other two stay linked to each other', () => {
    const { doc, clipId } = project();
    const soundId = all(doc).find((c) => c.id !== clipId)!.id;
    const extra = tx(doc, [{ op: 'import_asset', args: { asset: song } }, { op: 'add_track', args: { kind: 'audio' } }, { op: 'unlink_clip', args: { clipId } }], true);
    const third = tx(extra.doc, [{ op: 'add_clip', args: { assetId: extra.results[0]!.output!.assetId as string, start: f(0), duration: f(240), trackId: extra.results[1]!.output!.trackId as string } }]);
    const thirdId = third.results[0]!.output!.clipId as string;
    const d = tx(third.doc, [{ op: 'link_clips', args: { clipIds: [clipId, soundId, thirdId] } }]).doc;
    const r = tx(d, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero', includeLinked: false } }]);
    for (const id of partsOf(r)) expect(media(r.doc, id).linkGroupId).toBeNull();
    expect(media(r.doc, soundId).linkGroupId).toBeTruthy();
    expect(media(r.doc, soundId).linkGroupId).toBe(media(r.doc, thirdId).linkGroupId);
  });

  it('a sound that crossfades into the next clip, or is crossfaded into, is refused with a reason; without the crossfade it works', () => {
    let r = tx(createProject({ id: 'prj_x', name: 'X' }), [{ op: 'import_asset', args: { asset: song } }, { op: 'add_track', args: { kind: 'audio' } }], true);
    const assetId = r.results[0]!.output!.assetId as string, trackId = r.results[1]!.output!.trackId as string;
    r = tx(r.doc, [0, 300, 600].map((at) => ({ op: 'add_clip', args: { assetId, start: f(at), duration: f(300), trackId } })));
    const [m1, m2, m3] = r.results.map((x) => x.output!.clipId as string) as [string, string, string];
    const plain = r.doc;
    const faded = tx(plain, [{ op: 'set_audio_crossfade', args: { clipId: m2, duration: f(30) } }]).doc;
    expect(T.eq(clipEnd(media(faded, m1)), f(330))).toBe(true); // M1 now lies over the start of M2
    const refusal = (clipId: string) => { try { tx(faded, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero' } }]); } catch (e) { return e as OpError; } return null; };
    const out = refusal(m1), into = refusal(m2);
    expect(out?.code).toBe('incompatible');
    expect(out?.message).toMatch(/crossfade/);
    expect(out?.hint).toMatch(/set_audio_crossfade/);
    expect(into?.code).toBe('incompatible');
    expect(into?.message).toMatch(/crossfade/);
    expect(code(() => tx(faded, [{ op: 'apply_speed_curve', args: { clipId: m1, preset: 'hero', ripple: false } }]))).toBe('incompatible');
    expect(code(() => tx(faded, [{ op: 'apply_speed_curve', args: { clipId: m3, preset: 'hero' } }]))).toBe('ok'); // M3 has no crossfade
    // once the crossfade is removed the curve applies and what follows stays back to back
    const cleared = tx(faded, [{ op: 'set_audio_crossfade', args: { clipId: m2, duration: f(0) } }]).doc;
    const ok = tx(cleared, [{ op: 'apply_speed_curve', args: { clipId: m1, preset: 'hero' } }]);
    const total = (ok.results[0]!.output as { durationFrames: number }).durationFrames;
    expect(T.eq(media(ok.doc, m2).start, f(total))).toBe(true);
    expect(T.eq(media(ok.doc, m3).start, f(total + 300))).toBe(true);
  });

  it('a crossfade on the linked sound refuses the curve on the picture too', () => {
    // two picture + sound pairs back to back; the first sound crossfades into the second
    const { doc, clipId, assetId } = project();
    const v1 = findClip(doc, clipId)!.track.id;
    const two = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(240), sourceIn: T.rt(12, 1), trackId: v1, duration: f(60) } }]);
    const secondId = two.results[0]!.output!.clipId as string;
    const secondSound = all(two.doc).find((c) => c.id !== secondId && c.linkGroupId === media(two.doc, secondId).linkGroupId)!;
    const faded = tx(two.doc, [{ op: 'set_audio_crossfade', args: { clipId: secondSound.id, duration: f(10) } }]).doc;
    // the second pair still matches in place and length; only its sound is crossfaded into
    let err: OpError | null = null;
    try { tx(faded, [{ op: 'apply_speed_curve', args: { clipId: secondId, preset: 'jump-cut' } }]); } catch (e) { err = e as OpError; }
    expect(err?.code).toBe('incompatible');
    expect(err?.message).toMatch(/crossfade/);
    expect(code(() => tx(faded, [{ op: 'apply_speed_curve', args: { clipId, preset: 'jump-cut' } }]))).toBe('incompatible');
    // left out, the sound's crossfade is not in the way of the picture
    expect(code(() => tx(faded, [{ op: 'apply_speed_curve', args: { clipId: secondId, preset: 'jump-cut', includeLinked: false } }]))).toBe('ok');
  });

  /** Three sounds back to back on one track; M1 crossfades 30 frames into M2 (so M1 is [0,330) over M2 [300,600)). */
  function threeSounds() {
    let r = tx(createProject({ id: 'prj_x', name: 'X' }), [{ op: 'import_asset', args: { asset: song } }, { op: 'add_track', args: { kind: 'audio' } }], true);
    const assetId = r.results[0]!.output!.assetId as string, trackId = r.results[1]!.output!.trackId as string;
    r = tx(r.doc, [0, 300, 600].map((at) => ({ op: 'add_clip', args: { assetId, start: f(at), duration: f(300), trackId } })));
    const [m1, m2, m3] = r.results.map((x) => x.output!.clipId as string) as [string, string, string];
    return { plain: r.doc, faded: tx(r.doc, [{ op: 'set_audio_crossfade', args: { clipId: m2, duration: f(30) } }]).doc, m1, m2, m3, assetId, trackId };
  }
  const refusal = (doc: ProjectDocument, args: Record<string, unknown>) => { try { tx(doc, [{ op: 'apply_speed_curve', args }]); } catch (e) { return e as OpError; } return null; };
  /** Every sound on the track of `id` starts where the one before it ends: no silence and nothing doubled. */
  const backToBack = (d: ProjectDocument, id: string) => {
    const clips = [...findClip(d, id)!.track.clips].sort((a, b) => T.cmp(a.start, b.start));
    for (let i = 1; i < clips.length; i++) expect(T.eq(clips[i]!.start, clipEnd(clips[i - 1]!)), `${clips[i - 1]!.id} -> ${clips[i]!.id}`).toBe(true);
  };

  it('an overlap left by half a crossfade (one of its two fades cleared) is refused as well, with a hint that can be followed', () => {
    const { faded, m1, m2 } = threeSounds();
    // (a) the later clip's fade-in was cleared: the earlier clip still plays on over its start, and still records the crossfade length
    const noFadeIn = tx(faded, [{ op: 'set_clip_fades', args: { clipId: m2, fadeIn: f(0) } }]).doc;
    // (b) the earlier clip's fade-out was cleared: the overlap is still there, but nothing says how long the crossfade was
    const noFadeOut = tx(faded, [{ op: 'set_clip_fades', args: { clipId: m1, fadeOut: f(0) } }]).doc;
    for (const [name, doc] of [['later fade-in cleared', noFadeIn], ['earlier fade-out cleared', noFadeOut]] as const) {
      expect(T.lt(media(doc, m2).start, clipEnd(media(doc, m1))), name).toBe(true); // the precondition: M1 still lies over the start of M2
      for (const clipId of [m1, m2]) {
        for (const extra of [{}, { ripple: false }]) {
          const err = refusal(doc, { clipId, preset: 'hero', ...extra });
          expect(err?.code, `${name}: ${clipId}`).toBe('incompatible');
          expect(err?.details, name).toMatchObject(clipId === m1 ? { nextClipId: m2 } : { previousClipId: m1 });
        }
      }
    }
    // (a) is still a crossfade as set_audio_crossfade sees it: the hint names it, and following it works
    const a = refusal(noFadeIn, { clipId: m1, preset: 'hero' })!;
    expect(a.hint).toMatch(/set_audio_crossfade/);
    const clearedA = tx(noFadeIn, [{ op: 'set_audio_crossfade', args: { clipId: m2, duration: f(0) } }]).doc;
    backToBack(tx(clearedA, [{ op: 'apply_speed_curve', args: { clipId: m1, preset: 'hero' } }]).doc, m1);
    // (b) is not (set_audio_crossfade finds no crossfade there), so the hint must not send the caller to it: it says to trim the earlier clip back
    expect(code(() => tx(noFadeOut, [{ op: 'set_audio_crossfade', args: { clipId: m2, duration: f(0) } }]))).toBe('not_found');
    for (const clipId of [m1, m2]) {
      const b = refusal(noFadeOut, { clipId, preset: 'hero' })!;
      expect(b.hint, clipId).not.toMatch(/set_audio_crossfade/);
      expect(b.hint, clipId).toMatch(/trim_clip/);
      expect(b.message, clipId).toMatch(/overlap|plays on/);
    }
    const clearedB = tx(noFadeOut, [{ op: 'trim_clip', args: { clipId: m1, edge: 'end', to: media(noFadeOut, m2).start } }]).doc;
    for (const clipId of [m1, m2]) backToBack(tx(clearedB, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero' } }]).doc, m1);
  });

  it('an overlap with no fades at all is refused in the same way: what follows could not stay back to back', () => {
    const { plain, m1, m2 } = threeSounds();
    const over = tx(plain, [{ op: 'trim_clip', args: { clipId: m1, edge: 'end', to: f(330) } }]).doc; // sound may overlap sound on one track
    expect(refusal(over, { clipId: m1, preset: 'hero' })?.details).toMatchObject({ nextClipId: m2 });
    expect(refusal(over, { clipId: m2, preset: 'hero' })?.details).toMatchObject({ previousClipId: m1 });
    expect(refusal(over, { clipId: m1, preset: 'hero' })?.hint).toMatch(/trim_clip/);
  });

  it('a sound layered inside a longer one on the same track is not a crossfade: the curve applies to either of them', () => {
    let r = tx(createProject({ id: 'prj_y', name: 'Y' }), [{ op: 'import_asset', args: { asset: song } }, { op: 'add_track', args: { kind: 'audio' } }], true);
    const assetId = r.results[0]!.output!.assetId as string, trackId = r.results[1]!.output!.trackId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(300), trackId } }, { op: 'add_clip', args: { assetId, start: f(100), duration: f(60), trackId } }]);
    const [music, sfx] = r.results.map((x) => x.output!.clipId as string) as [string, string];
    const lay = tx(r.doc, [{ op: 'set_clip_fades', args: { clipId: music, fadeOut: f(30) } }, { op: 'set_clip_fades', args: { clipId: sfx, fadeIn: f(10) } }]).doc;
    // there is no crossfade here to remove (the old refusal sent the caller to set_audio_crossfade, which then failed)
    expect(code(() => tx(lay, [{ op: 'set_audio_crossfade', args: { clipId: sfx, duration: f(0) } }]))).toBe('not_found');
    const onMusic = tx(lay, [{ op: 'apply_speed_curve', args: { clipId: music, preset: 'hero' } }]);
    expect(validateProject(onMusic.doc)).toEqual([]);
    expect(partsOf(onMusic).length).toBe(5);
    expect([media(onMusic.doc, sfx).start, media(onMusic.doc, sfx).duration].map((t) => T.frameIndexAt(t, R))).toEqual([100, 60]); // the layered sound stays where it was
    const onSfx = tx(lay, [{ op: 'apply_speed_curve', args: { clipId: sfx, preset: 'jump-cut' } }]);
    expect(validateProject(onSfx.doc)).toEqual([]);
    expect(T.eq(media(onSfx.doc, music).duration, f(300))).toBe(true);
  });

  it('with the linked sound on a locked track, no refusal recommends a step that is refused in turn', () => {
    const { doc, clipId } = project();
    const audioTrack = tracksOf(doc).find((t) => t.kind === 'audio')!;
    const locked = tx(doc, [{ op: 'update_track', args: { trackId: audioTrack.id, locked: true } }]).doc;
    // picture + one sound: leaving the sound out would have to clear its link, which its locked track does not allow either
    const withSound = refusal(locked, { clipId, preset: 'hero' })!;
    const alone = refusal(locked, { clipId, preset: 'hero', includeLinked: false })!;
    expect(withSound.code).toBe('track_locked');
    expect(alone.code).toBe('track_locked');
    expect(withSound.hint).not.toMatch(/includeLinked/);
    for (const err of [withSound, alone]) {
      expect(err.hint).toMatch(/[Uu]nlock/);
      expect(err.details).toMatchObject({ trackId: audioTrack.id });
    }
    // following the hint works, both ways
    const unlocked = tx(locked, [{ op: 'update_track', args: { trackId: audioTrack.id, locked: false } }]).doc;
    expect(code(() => tx(unlocked, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero' } }]))).toBe('ok');
    expect(code(() => tx(unlocked, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero', includeLinked: false } }]))).toBe('ok');
    // a group of three with one locked member: there includeLinked=false is a real way out (the other two stay linked), and the hint may say so
    const soundId = all(doc).find((c) => c.id !== clipId)!.id;
    const extra = tx(doc, [{ op: 'import_asset', args: { asset: song } }, { op: 'add_track', args: { kind: 'audio' } }, { op: 'unlink_clip', args: { clipId } }], true);
    const third = tx(extra.doc, [{ op: 'add_clip', args: { assetId: extra.results[0]!.output!.assetId as string, start: f(0), duration: f(240), trackId: extra.results[1]!.output!.trackId as string } }]);
    const three = tx(third.doc, [{ op: 'link_clips', args: { clipIds: [clipId, soundId, third.results[0]!.output!.clipId as string] } }, { op: 'update_track', args: { trackId: audioTrack.id, locked: true } }]).doc;
    const hint = refusal(three, { clipId, preset: 'hero' })!;
    expect(hint.code).toBe('track_locked');
    expect(hint.hint).toMatch(/includeLinked=false/);
    expect(code(() => tx(three, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero', includeLinked: false } }]))).toBe('ok');
  });
});
