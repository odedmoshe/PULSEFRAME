import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, sequenceDuration, sourceAt, sourceEnd, sourceRangesToTimeline, speedFromNumber, timelineAt, toSourceSpan, validateProject, OpError, type MediaClip, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `s${n++}_`, actor: 'test', allowInternal });
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' },
};
function project() {
  let r = tx(createProject({ id: 'prj_s', name: 'S' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
  return { doc: r.doc, assetId, clipId: r.results[0]!.output!.clipId as string };
}
const media = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;
const linkedOf = (d: ProjectDocument, id: string) => Object.values(d.sequences)[0]!.tracks.flatMap((t) => t.clips).filter((c) => c.id !== id && c.type === 'media' && c.linkGroupId && c.linkGroupId === media(d, id).linkGroupId) as MediaClip[];

describe('clip speed', () => {
  it('decimal speeds become exact ratios', () => {
    expect(speedFromNumber(0.5)).toEqual({ num: 1, den: 2 });
    expect(speedFromNumber(2)).toEqual({ num: 2, den: 1 });
    expect(speedFromNumber(1.25)).toEqual({ num: 5, den: 4 });
    expect(speedFromNumber(1)).toEqual({ num: 1, den: 1 });
  });
  it('set_clip_speed keeps the source span and changes the length; linked sound follows; 1 removes the field', () => {
    const { doc, clipId } = project();
    const fast = tx(doc, [{ op: 'set_clip_speed', args: { clipId, speed: 2 } }]).doc;
    expect(validateProject(fast)).toEqual([]);
    const c = media(fast, clipId);
    expect(c.speed).toEqual({ num: 2, den: 1 });
    expect(T.eq(c.duration, f(120))).toBe(true);
    expect(T.eq(sourceEnd(c), T.rt(8, 1))).toBe(true);
    expect(T.eq(sourceAt(c, f(30)), T.rt(2, 1))).toBe(true); // one timeline second in = two source seconds in
    expect(T.eq(timelineAt(c, T.rt(2, 1)), f(30))).toBe(true);
    for (const l of linkedOf(fast, clipId)) { expect(l.speed).toEqual({ num: 2, den: 1 }); expect(T.eq(l.duration, f(120))).toBe(true); }
    expect(linkedOf(fast, clipId).length).toBeGreaterThan(0);
    const back = tx(fast, [{ op: 'set_clip_speed', args: { clipId, speed: 1 } }]).doc;
    expect(media(back, clipId).speed).toBeUndefined();
    expect(T.eq(media(back, clipId).duration, f(240))).toBe(true);
  });
  it('slow motion lengthens the clip and refuses to overlap a neighbour', () => {
    const { doc, clipId, assetId } = project();
    const short = tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(60) } }]).doc;
    const slow = tx(short, [{ op: 'set_clip_speed', args: { clipId, speed: 0.5 } }]).doc;
    expect(T.eq(media(slow, clipId).duration, f(120))).toBe(true);
    expect(T.eq(sourceEnd(media(slow, clipId)), T.rt(2, 1))).toBe(true);
    expect(validateProject(slow)).toEqual([]);
    const crowded = tx(short, [{ op: 'add_clip', args: { assetId, start: f(60), trackId: findClip(short, clipId)!.track.id } }]).doc;
    expect(() => tx(crowded, [{ op: 'set_clip_speed', args: { clipId, speed: 0.5 } }])).toThrow(OpError);
  });
  it('trim, split and source-range mapping work in source time on a sped clip', () => {
    const { doc, clipId, assetId } = project();
    const fast = tx(doc, [{ op: 'set_clip_speed', args: { clipId, speed: 2 } }]).doc;
    // trimming the start to timeline frame 30 skips two source seconds
    const trimmed = tx(fast, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(30) } }]).doc;
    expect(T.eq(media(trimmed, clipId).sourceIn, T.rt(2, 1))).toBe(true);
    expect(T.eq(sourceEnd(media(trimmed, clipId)), T.rt(8, 1))).toBe(true);
    // the end cannot be dragged past the end of the source: 8 s of source is 120 timeline frames
    expect(() => tx(fast, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(150) } }])).toThrow(OpError);
    const r = tx(fast, [{ op: 'split_clip', args: { clipId, at: f(60) } }]);
    expect(validateProject(r.doc)).toEqual([]);
    const right = Object.values(r.doc.sequences)[0]!.tracks.flatMap((t) => t.clips).filter((c): c is MediaClip => c.type === 'media' && T.eq(c.start, f(60)));
    expect(right.length).toBeGreaterThan(0);
    for (const c of right) { expect(T.eq(c.sourceIn, T.rt(4, 1))).toBe(true); expect(c.speed).toEqual({ num: 2, den: 1 }); }
    // a source range 2..4 s sits at timeline 1..2 s on the double-speed clip
    expect(sourceRangesToTimeline(fast, assetId, [{ start: T.rt(2, 1), end: T.rt(4, 1) }])).toEqual([{ start: f(30), end: f(60) }]);
    expect(T.eq(sequenceDuration(fast), f(120))).toBe(true);
  });
  it('property: any speed keeps the project valid, never reads past the source, and maps round-trip', () => {
    fc.assert(fc.property(fc.integer({ min: 100, max: 8000 }), fc.integer({ min: 0, max: 200 }), (milli, trim) => {
      const { doc, clipId } = project();
      const base = trim ? tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(trim) } }]).doc : doc;
      const d = tx(base, [{ op: 'set_clip_speed', args: { clipId, speed: milli / 1000 } }]).doc;
      const c = media(d, clipId);
      expect(validateProject(d)).toEqual([]);
      expect(T.lte(sourceEnd(c), T.rt(8, 1))).toBe(true);
      expect(T.eq(c.duration, f(T.frameIndexAt(c.duration, R)))).toBe(true); // whole frames
      const mid = T.add(c.start, f(Math.floor(T.frameIndexAt(c.duration, R) / 2)));
      expect(T.eq(timelineAt(c, sourceAt(c, mid)), mid)).toBe(true);
      expect(T.eq(toSourceSpan(c, c.duration), T.sub(sourceEnd(c), c.sourceIn))).toBe(true);
    }), { numRuns: 60 });
  });
});
