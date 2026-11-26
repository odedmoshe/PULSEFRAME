import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, validateProject, OpError, type MediaClip, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `mv${n++}_`, actor: 'test', allowInternal });
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' },
};
function project() {
  let r = tx(createProject({ id: 'prj_mv', name: 'S' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
  return { doc: r.doc, assetId, clipId: r.results[0]!.output!.clipId as string };
}
const media = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;
const linkedOf = (d: ProjectDocument, id: string) => Object.values(d.sequences)[0]!.tracks.flatMap((t) => t.clips).filter((c) => c.id !== id && c.type === 'media' && c.linkGroupId && c.linkGroupId === media(d, id).linkGroupId) as MediaClip[];

describe('move_clips', () => {
  const starts = (d: ProjectDocument, ids: string[]) => ids.map((id) => T.frameIndexAt(findClip(d, id)!.clip.start, R));
  function three() {
    const { doc, assetId, clipId } = project();
    let d = tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(30) } }]).doc; // A: 0..30
    const track = findClip(d, clipId)!.track.id;
    const r = tx(d, [{ op: 'add_clip', args: { assetId, start: f(30), duration: f(30), trackId: track } }, { op: 'add_clip', args: { assetId, start: f(90), duration: f(30), trackId: track } }]);
    return { doc: r.doc, a: clipId, b: r.results[0]!.output!.clipId as string, c: r.results[1]!.output!.clipId as string };
  }
  it('moves several clips by one delta, keeping their spacing; linked sound follows; clips may pass through space the group itself vacates', () => {
    const { doc, a, b, c } = three();
    const d = tx(doc, [{ op: 'move_clips', args: { clipIds: [a, b], delta: f(15) } }]).doc; // A 15..45, B 45..75: B lands where only A/B were
    expect(validateProject(d)).toEqual([]);
    expect(starts(d, [a, b, c])).toEqual([15, 45, 90]);
    for (const id of [a, b]) for (const l of linkedOf(d, id)) expect(T.eq(l.start, findClip(d, id)!.clip.start)).toBe(true);
    const back = tx(d, [{ op: 'move_clips', args: { clipIds: [b, a], delta: f(-15) } }]).doc;
    expect(starts(back, [a, b, c])).toEqual([0, 30, 90]);
  });
  it('is all-or-nothing: refuses a move before 0, onto a clip that is not moving, or off the frame grid', () => {
    const { doc, a, b, c } = three();
    expect(() => tx(doc, [{ op: 'move_clips', args: { clipIds: [a, b], delta: f(-1) } }])).toThrow(OpError);
    expect(() => tx(doc, [{ op: 'move_clips', args: { clipIds: [a, b], delta: f(40) } }])).toThrow(OpError); // B would overlap C
    expect(() => tx(doc, [{ op: 'move_clips', args: { clipIds: [a], delta: T.rt(1, 7) } }])).toThrow(OpError);
    expect(() => tx(doc, [{ op: 'move_clips', args: { clipIds: [a, 'clp_missing'], delta: f(1) } }])).toThrow(OpError);
    // moving all three together is fine
    expect(starts(tx(doc, [{ op: 'move_clips', args: { clipIds: [a, b, c], delta: f(40) } }]).doc, [a, b, c])).toEqual([40, 70, 130]);
  });
});
