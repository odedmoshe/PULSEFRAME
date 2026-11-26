import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, cutOps, sequenceDuration, sourceRangesToTimeline, transformAt, validateProject, findClip, OpError, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `k${n++}_`, actor: 'test', allowInternal });
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-14T00:00:00Z', importedBy: 'test' },
};
function project() {
  let r = tx(createProject({ id: 'prj_k', name: 'K' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
  return { doc: r.doc, assetId, clipId: r.results[0]!.output!.clipId as string };
}

describe('cleanup candidates', () => {
  it('maps source ranges to timeline, snapping inward and keeping breathing room', () => {
    const { doc, assetId } = project();
    // silence 0.11..0.99 s -> frames ceil(3.3)=4 .. floor(29.7)=29
    expect(sourceRangesToTimeline(doc, assetId, [{ start: T.rt(110, 1000), end: T.rt(990, 1000) }])).toEqual([{ start: f(4), end: f(29) }]);
    // keep 0.1 s on each side -> 0.21..0.89 -> frames 7..26
    expect(sourceRangesToTimeline(doc, assetId, [{ start: T.rt(110, 1000), end: T.rt(990, 1000) }], T.rt(1, 10))).toEqual([{ start: f(7), end: f(26) }]);
    // shorter than the breathing room: no candidate
    expect(sourceRangesToTimeline(doc, assetId, [{ start: T.rt(0, 1), end: T.rt(150, 1000) }], T.rt(1, 10))).toEqual([]);
    expect(sourceRangesToTimeline(doc, 'ast_other', [{ start: f(0), end: f(30) }])).toEqual([]);
  });
  it('follows trims and moves, merges linked picture+sound into one range, and cuts apply as one valid transaction', () => {
    const { doc, assetId, clipId } = project();
    const moved = tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(30) } }, { op: 'move_clip', args: { clipId, start: f(0) } }]).doc; // source 1 s.. now at 0
    const ranges = sourceRangesToTimeline(moved, assetId, [{ start: T.rt(2, 1), end: T.rt(3, 1) }, { start: T.rt(5, 1), end: T.rt(6, 1) }, { start: T.rt(0, 1), end: T.rt(1, 2) }]);
    expect(ranges).toEqual([{ start: f(30), end: f(60) }, { start: f(120), end: f(150) }]);
    const cut = tx(moved, cutOps(ranges)).doc;
    expect(validateProject(cut)).toEqual([]);
    expect(T.eq(sequenceDuration(cut), f(210 - 60))).toBe(true);
    // applying the same candidates again finds nothing left to cut
    expect(sourceRangesToTimeline(cut, assetId, [{ start: T.rt(2, 1), end: T.rt(3, 1) }, { start: T.rt(5, 1), end: T.rt(6, 1) }])).toEqual([]);
  });
});

describe('animate_clip', () => {
  const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : `non-op:${e}`; } return 'ok'; };
  it('writes editable keyframes: fade in, hold, slide out; rest value in the middle', () => {
    const { doc } = project();
    const a = tx(doc, [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60), transform: { y: 0.2 } } }]);
    const id = a.results[0]!.output!.clipId as string;
    const r = tx(a.doc, [{ op: 'animate_clip', args: { clipId: id, in: 'pop', out: 'slide-down', inFrames: 10, outFrames: 10 } }]);
    const clip = findClip(r.doc, id)!.clip;
    expect(validateProject(r.doc)).toEqual([]);
    expect(transformAt(clip, f(0))).toMatchObject({ opacity: 0, scale: 0.6, y: 0.2 });
    expect(transformAt(clip, f(30))).toMatchObject({ opacity: 1, scale: 1, y: 0.2 });
    const end = transformAt(clip, f(59));
    expect(end.opacity).toBeGreaterThan(0);
    expect(end.opacity).toBeLessThan(0.35);
    expect(end.y).toBeLessThan(0.2);
    // monotonic entrance
    const o = Array.from({ length: 11 }, (_, i) => transformAt(clip, f(i)).opacity);
    expect(o.every((v, i) => i === 0 || v >= o[i - 1]!)).toBe(true);
    expect(code(() => tx(a.doc, [{ op: 'animate_clip', args: { clipId: id, in: 'fade', out: 'fade', inFrames: 40, outFrames: 40 } }]))).toBe('out_of_bounds');
    expect(code(() => tx(a.doc, [{ op: 'animate_clip', args: { clipId: id } }]))).toBe('invalid_args');
  });
});
