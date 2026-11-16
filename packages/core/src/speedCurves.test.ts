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
    expect(SPEED_CURVES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(SPEED_CURVES.map((c) => c.id)).size).toBe(SPEED_CURVES.length);
    for (const c of SPEED_CURVES) {
      expect(c.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(c.name.he.length && c.name.en.length && c.hint.he.length && c.hint.en.length).toBeGreaterThan(0);
      expect(c.segments.length).toBeGreaterThanOrEqual(2);
      for (const s of c.segments) {
        expect(Number.isInteger(s.weight) && s.weight > 0).toBe(true);
        for (const v of [s.from, s.to]) expect(v >= 0.1 && v <= 8).toBe(true);
      }
      // a curve without steps is continuous: each segment starts at the speed the previous one ended at
      if (c.id !== 'jump-cut') for (let i = 1; i < c.segments.length; i++) expect(c.segments[i]!.from).toBe(c.segments[i - 1]!.to);
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
