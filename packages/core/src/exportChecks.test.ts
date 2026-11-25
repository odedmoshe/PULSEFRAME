/**
 * Export checks (wave 7 send, C10): what the document says should be on screen. A still, a freeze clip, a hidden track, a video
 * covered by an opaque full-frame clip and a video held past its source end are not "moving"; a gap is not "drawn"; the report
 * lists every kind looked for and never says the file is fine.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, assembleChecks, createProject, findClip, flagsOf, FINDING_KINDS, pictureExpectation, type MediaClip, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `ec${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const asset = (kind: 'video' | 'image', name: string, seconds: number, extra: Record<string, unknown> = {}) => ({
  kind, name, contentHash: `sha256:${(name.charCodeAt(0) % 16).toString(16).repeat(64)}`, byteSize: 1, container: kind === 'video' ? 'mp4' : 'png', mimeType: kind === 'video' ? 'video/mp4' : 'image/png', duration: T.rt(seconds, 1),
  ...(kind === 'video' ? { video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: seconds * 30 } } : { image: { width: 640, height: 360, codec: 'png', hasAlpha: false } }), provenance: prov, ...extra,
});
/** A 640×360 project: a 4 s video at 0–120 on V1, nothing 120–150 (gap), a title 150–180 on the text track. */
function base() {
  let r = tx(createProject({ id: 'prj_ec', name: 'ec' }), [{ op: 'import_asset', args: { asset: asset('video', 'v.mp4', 4) } }, { op: 'import_asset', args: { asset: asset('image', 'p.png', 5) } }, { op: 'import_asset', args: { asset: asset('image', 'q.png', 5, { image: { width: 640, height: 360, codec: 'png', hasAlpha: true } }) } }], true);
  const [vid, img, alpha] = r.results.map((x) => x.output!.assetId as string);
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: vid!, start: f(0), duration: f(120), withLinkedAudio: false } },
    { op: 'add_text', args: { text: 'סוף', start: f(150), duration: f(30) } },
  ]);
  const doc = { ...r.doc, settings: { ...r.doc.settings, width: 640, height: 360 } };
  return { doc, vid: vid!, img: img!, alpha: alpha!, clip: r.results[0]!.output!.clipId as string, seq: doc.mainSequenceId };
}
const mutClip = (doc: ProjectDocument, id: string, patch: Partial<MediaClip>): ProjectDocument => {
  const d = structuredClone(doc);
  Object.assign(findClip(d, id)!.clip, patch);
  return d;
};
/** Adds a picture track above V1 with one clip of `assetId` over [from, to). */
function overlay(doc: ProjectDocument, assetId: string, from: number, to: number, patch: Partial<MediaClip> = {}) {
  let r = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }]);
  const trackId = r.results[0]!.output!.trackId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, trackId, start: f(from), duration: f(to - from), withLinkedAudio: false } }]);
  return mutClip(r.doc, r.results[0]!.output!.clipId as string, patch);
}

describe('pictureExpectation (core, C10)', () => {
  it('a plain video moves while it plays; the gap is not drawn; a title is drawn and does not move', () => {
    const { doc, seq } = base();
    expect(pictureExpectation(doc, seq, 0, 180)).toEqual({ drawn: [[0, 120], [150, 180]], moving: [[0, 120]] });
    // a range is relative to its first frame
    expect(pictureExpectation(doc, seq, 100, 60)).toEqual({ drawn: [[0, 20], [50, 60]], moving: [[0, 20]] });
  });
  it('B: a still, a freeze clip, a hidden track, a video covered by an opaque full-frame clip and a video past its source end are not "moving"', () => {
    const b = base();
    // freeze
    expect(pictureExpectation(mutClip(b.doc, b.clip, { freeze: true }), b.seq, 0, 120).moving).toEqual([]);
    // hidden track
    const hidden = structuredClone(b.doc); hidden.sequences[b.seq]!.tracks.find((t) => t.clips.some((c) => c.id === b.clip))!.hidden = true;
    expect(pictureExpectation(hidden, b.seq, 0, 120)).toEqual({ drawn: [], moving: [] });
    // a still photo alone (the video replaced by the image)
    expect(pictureExpectation(mutClip(b.doc, b.clip, { assetId: b.img }), b.seq, 0, 120)).toEqual({ drawn: [[0, 120]], moving: [] });
    // past its source end: sourceIn 3 s of a 4 s video → moves 30 frames, then holds
    expect(pictureExpectation(mutClip(b.doc, b.clip, { sourceIn: T.rt(3, 1) }), b.seq, 0, 120).moving).toEqual([[0, 30]]);
    // at speed 2 from 0: 4 s of source last 60 frames
    expect(pictureExpectation(mutClip(b.doc, b.clip, { speed: { num: 2, den: 1 } }), b.seq, 0, 120).moving).toEqual([[0, 60]]);
    // covered by an opaque full-frame photo above over frames 30–60
    expect(pictureExpectation(overlay(b.doc, b.img, 30, 60), b.seq, 0, 120).moving).toEqual([[0, 30], [60, 120]]);
  });
  it('a clip above that does not cover the frame (alpha, opacity, scale, offset, keyframes) leaves the video moving', () => {
    const b = base();
    for (const doc of [
      overlay(b.doc, b.alpha, 30, 60),
      overlay(b.doc, b.img, 30, 60, { transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.99 } }),
      overlay(b.doc, b.img, 30, 60, { transform: { x: 0, y: 0, scale: 0.5, rotation: 0, opacity: 1 } }),
      overlay(b.doc, b.img, 30, 60, { transform: { x: 0.1, y: 0, scale: 1, rotation: 0, opacity: 1 } }),
      overlay(b.doc, b.img, 30, 60, { keyframes: { opacity: [{ time: f(0), value: 1 }] } as MediaClip['keyframes'] }),
    ]) expect(pictureExpectation(doc, b.seq, 0, 120).moving).toEqual([[0, 120]]);
    // an opaque clip BELOW the video does not hide it
    const below = overlay(b.doc, b.img, 30, 60);
    const seq = below.sequences[b.seq]!;
    const top = seq.tracks.findIndex((t) => t.clips.some((c) => c.type === 'media' && c.assetId === b.img));
    const v1 = seq.tracks.findIndex((t) => t.clips.some((c) => c.id === b.clip));
    [seq.tracks[top], seq.tracks[v1]] = [seq.tracks[v1]!, seq.tracks[top]!];
    expect(pictureExpectation(below, b.seq, 0, 120).moving).toEqual([[0, 120]]);
  });
  it('flagsOf turns runs back into per-frame flags', () => {
    expect([...flagsOf([[1, 3], [5, 9]], 7)]).toEqual([0, 1, 1, 0, 0, 1, 1]);
  });
});

describe('assembleChecks (core)', () => {
  it('B: assembleChecks lists every kind looked for and never calls the file fine', () => {
    const r = assembleChecks({ method: 'm', status: 'measured', findings: [] }, { method: 's', status: 'not_measured', findings: [] });
    expect(r.lookedFor).toEqual(FINDING_KINDS);
    expect(JSON.stringify(r)).not.toMatch(/"(ok|fine|clean|pass)"/);
    expect(Object.keys(r).sort()).toEqual(['lookedFor', 'picture', 'sound']);
  });
  it('orders findings by time, then kind', () => {
    const at = (k: number) => T.frameTime(k, R);
    const r = assembleChecks({ method: 'm', status: 'measured', findings: [
      { kind: 'frozen', from: at(90), to: at(150), measured: {} }, { kind: 'black', from: at(10), to: at(30), context: 'gap', measured: {} },
    ] }, { method: 's', status: 'measured', findings: [] });
    expect(r.picture.findings.map((x) => x.kind)).toEqual(['black', 'frozen']);
  });
});
