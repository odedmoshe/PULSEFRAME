import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, diffEntities, findClip, OpError, restoreEntities, validateProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from './evaluate.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `r${n++}_`, actor: 'test', allowInternal });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : `non-op:${e}`; } return 'ok'; };
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' },
};
/** A 240-frame source; one clip showing source 50..149 at timeline 20..119, reversed. */
function project() {
  let r = tx(createProject({ id: 'prj_r', name: 'R', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(20), sourceIn: f(50), duration: f(100) } }]);
  const out = r.results[0]!.output as any;
  const fwd = r.doc;
  const rev = tx(fwd, [{ op: 'set_clip_reverse', args: { clipId: out.clipId, reverse: true } }]);
  return { fwd, doc: rev.doc, clipId: out.clipId as string, audioId: out.audioClipId as string, assetId, result: rev.results[0]! };
}
/** Source frame shown at each timeline frame (null where no picture), by the evaluator used for preview, stills and export. */
const shown = (d: ProjectDocument, from: number, to: number) => Array.from({ length: to - from }, (_, i) => { const l = evaluate(d, f(from + i)).layers.find((x) => x.kind === 'video') as any; return l ? (l.sourceFrameIndex as number) : null; });
const range = (a: number, b: number) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => (a <= b ? a + i : a - i));

describe('reverse playback of a clip', () => {
  it('shows the same stretch of source in the opposite order, keeps place and length, unlinks the sound, and is undone and switched back exactly', () => {
    const { fwd, doc, clipId, audioId, result } = project();
    expect(validateProject(doc)).toEqual([]);
    expect(shown(fwd, 20, 120)).toEqual(range(50, 149));
    expect(shown(doc, 20, 120)).toEqual(range(149, 50));
    expect([shown(doc, 19, 20)[0], shown(doc, 120, 121)[0]]).toEqual([null, null]);
    const c = findClip(doc, clipId)!.clip as any, a = findClip(doc, audioId)!.clip as any;
    expect([T.frameIndexAt(c.start, R), T.frameIndexAt(c.duration, R), T.frameIndexAt(c.sourceIn, R), c.linkGroupId, a.linkGroupId]).toEqual([20, 100, 50, null, null]);
    expect((result.output as any).unlinkedClipIds).toEqual([audioId]);
    const back = structuredClone(doc);
    restoreEntities(back, diffEntities(fwd, doc).map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(fwd);
    const again = tx(doc, [{ op: 'set_clip_reverse', args: { clipId, reverse: false } }]).doc;
    expect(shown(again, 20, 120)).toEqual(range(50, 149));
    expect(code(() => tx(doc, [{ op: 'set_clip_reverse', args: { clipId, reverse: true } }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'set_clip_reverse', args: { clipId: audioId, reverse: true } }]))).toBe('incompatible');
  });
  it('split, ripple insert and a cut in the middle leave every remaining frame showing what it showed', () => {
    const { doc, clipId } = project();
    const before = shown(doc, 20, 120);
    const split = tx(doc, [{ op: 'split_clip', args: { clipId, at: f(60) } }]).doc;
    expect(validateProject(split)).toEqual([]);
    expect(shown(split, 20, 120)).toEqual(before);
    const gap = tx(doc, [{ op: 'insert_gap', args: { at: f(60), duration: f(30) } }]).doc;
    expect(shown(gap, 20, 60)).toEqual(before.slice(0, 40));
    expect(shown(gap, 60, 90).every((x) => x === null)).toBe(true);
    expect(shown(gap, 90, 150)).toEqual(before.slice(40));
    const cut = tx(doc, [{ op: 'cut_range', args: { start: f(50), end: f(70) } }]).doc; // removes timeline 50..69 = the 31st..50th frames of the clip
    expect(shown(cut, 20, 100)).toEqual([...before.slice(0, 30), ...before.slice(50)]);
    const head = tx(doc, [{ op: 'cut_range', args: { start: f(10), end: f(40) } }]).doc; // removes the first 20 frames of the clip
    expect(shown(head, 10, 90)).toEqual(before.slice(20));
    const tail = tx(doc, [{ op: 'cut_range', args: { start: f(100), end: f(130) } }]).doc; // removes its last 20 frames
    expect(shown(tail, 20, 100)).toEqual(before.slice(0, 80));
    for (const d of [gap, cut, head, tail]) expect(validateProject(d)).toEqual([]);
  });
  it('trimming either edge removes or reveals frames at that edge; limits are the ends of the source', () => {
    const { doc, clipId } = project();
    const before = shown(doc, 20, 120); // 149 … 50
    const s = tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(30) } }]).doc;
    expect(shown(s, 30, 120)).toEqual(before.slice(10));
    const e = tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(100) } }]).doc;
    expect(shown(e, 20, 100)).toEqual(before.slice(0, 80));
    // extending the start reveals later source (150…), extending the end reveals earlier source (…49)
    const s2 = tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(10) } }]).doc;
    expect(shown(s2, 10, 120)).toEqual(range(159, 50));
    const e2 = tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(150) } }]).doc;
    expect(shown(e2, 20, 150)).toEqual(range(149, 20));
    // the source has 90 frames after the stretch but the clip can only start 20 frames earlier (timeline 0); 50 frames before the stretch
    expect(code(() => tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(171) } }]))).toBe('out_of_bounds');
    expect(shown(tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(170) } }]).doc, 169, 170)).toEqual([0]);
    const late = tx(doc, [{ op: 'move_clip', args: { clipId, start: f(200) } }]).doc;
    expect(code(() => tx(late, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(109) } }]))).toBe('out_of_bounds');
    expect(shown(tx(late, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(110) } }]).doc, 110, 111)).toEqual([239]);
    for (const d of [s, e, s2, e2]) expect(validateProject(d)).toEqual([]);
  });
  it('slip, speed and freeze frame work on a reversed clip; what makes no sense is refused', () => {
    const { doc, clipId } = project();
    const slipped = tx(doc, [{ op: 'slip_clip', args: { clipId, by: f(10) } }]).doc;
    expect(shown(slipped, 20, 120)).toEqual(range(159, 60));
    const fast = tx(doc, [{ op: 'set_clip_speed', args: { clipId, speed: 2 } }]).doc; // same stretch in 50 frames
    const sf = shown(fast, 20, 70);
    expect([sf[0], sf[49], sf.length]).toEqual([148, 50, 50]);
    expect(sf.every((x, i) => i === 0 || x === sf[i - 1]! - 2)).toBe(true);
    const frozen = tx(doc, [{ op: 'freeze_frame', args: { clipId, at: f(40), duration: f(15) } }]).doc; // timeline 40 shows source 129
    expect(validateProject(frozen)).toEqual([]);
    expect(shown(frozen, 20, 40)).toEqual(range(149, 130));
    expect(shown(frozen, 40, 55).every((x) => x === 129)).toBe(true);
    expect(shown(frozen, 55, 135)).toEqual(range(129, 50));
    expect(code(() => tx(doc, [{ op: 'set_transition', args: { clipId, type: 'dissolve', frames: 10 } }]))).toBe('incompatible');
    const hold = (tx(doc, [{ op: 'freeze_frame', args: { clipId, at: f(40), duration: f(15) } }]).results[0]!.output as any).freezeClipId as string;
    expect(code(() => tx(frozen, [{ op: 'set_clip_reverse', args: { clipId: hold, reverse: true } }]))).not.toBe('ok');
  });
});
