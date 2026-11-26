/**
 * Wave 8 «גדלים מול העיניים» pre-pass (verifier C1, C3):
 * - THE freeze-handle rule (speed.ts spareAfter): a freeze frame, like a still, never runs out of source after its end, so a
 *   transition into the next picture plays over it. Checked at every call site in core: set_transition (transitionSource, and so
 *   velocityLimit), replace_clip_media, and the template planner (templatePlan.test.ts). The engine side (what is drawn on both
 *   sides of such a dissolve) is packages/engine/src/heldFrameDissolve.test.ts; preflight is apps/server preflight.transitions.test.ts.
 *   Each row here was refused (out_of_bounds, 0 spare frames) before the rule.
 * - add_clip { freeze: true }: a held frame placed without inserting time; its refusals; old calls unchanged.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, OpError, sourceTimeOfFrame, spareAfter, validateProject, velocityLimit, type MediaClip, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let k = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `hf${k++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const video = (n: string, frames = 240) => ({ kind: 'video' as const, name: `${n}.mp4`, contentHash: `sha256:${n.repeat(64).slice(0, 64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: f(frames), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: frames }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov });
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };

function base() {
  const r = tx(createProject({ id: 'prj_hf', name: 'HF', frameRate: R }), [{ op: 'import_asset', args: { asset: video('a') } }, { op: 'import_asset', args: { asset: video('b', 60) } }, { op: 'import_asset', args: { asset: still } }], true);
  const [v, w, p] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  return { doc: r.doc, v, w, p };
}
const clipOf = (doc: ProjectDocument, id: string) => findClip(doc, id)!.clip as MediaClip;
const refusal = (doc: ProjectDocument, ops: OpCall[]) => { try { tx(doc, ops); } catch (e) { if (e instanceof OpError) return { code: e.code, message: e.message }; throw e; } return null; };

/** A held frame of source frame 200 at frames 0–30 (add_clip freeze), then a clip of the same file at 30–90 whose source runs to the end. */
function heldThenClip() {
  const b = base();
  const r = tx(b.doc, [
    { op: 'add_clip', args: { assetId: b.v, start: f(0), duration: f(30), sourceIn: sourceTimeOfFrame(b.doc.assets[b.v]!, 200), freeze: true } },
    { op: 'add_clip', args: { assetId: b.v, start: f(30), sourceIn: f(0), duration: f(60), withLinkedAudio: false } },
  ]);
  return { ...b, doc: r.doc, held: r.results[0]!.output!.clipId as string, next: r.results[1]!.output!.clipId as string };
}

describe('add_clip { freeze: true }: a held frame without inserting time', () => {
  it('places a freeze clip on a picture track, with no sound, showing sourceIn, and moves nothing', () => {
    const b = base();
    const before = tx(b.doc, [{ op: 'add_clip', args: { assetId: b.v, start: f(0), duration: f(60) } }]);
    const at = sourceTimeOfFrame(b.doc.assets[b.v]!, 120);
    const r = tx(before.doc, [{ op: 'add_clip', args: { assetId: b.v, start: f(60), duration: f(45), sourceIn: at, freeze: true } }]);
    const out = r.results[0]!.output!;
    expect(out.audioClipId).toBeUndefined();
    const c = clipOf(r.doc, out.clipId as string);
    expect(c).toMatchObject({ freeze: true, sourceIn: at, start: f(60), duration: f(45), linkGroupId: null });
    expect(findClip(r.doc, out.clipId as string)!.track.kind).toBe('video');
    // nothing that was there moved (freeze_frame would have inserted time)
    for (const t of before.doc.sequences[before.doc.mainSequenceId]!.tracks) for (const x of t.clips) expect(findClip(r.doc, x.id)!.clip).toEqual(x);
    expect(validateProject(r.doc)).toEqual([]);
    expect(r.results[0]!.summary).toMatch(/^Held a frame of "a\.mp4"/);
  });
  it('may be held longer than the file is long: it reads one picture, not a stretch', () => {
    const b = base();
    const r = tx(b.doc, [{ op: 'add_clip', args: { assetId: b.w, start: f(0), duration: f(300), sourceIn: f(59), freeze: true } }]); // a 60-frame file held 10 s on its last frame
    expect(clipOf(r.doc, r.results[0]!.output!.clipId as string).freeze).toBe(true);
    expect(validateProject(r.doc)).toEqual([]);
    // without freeze the same call reads past the end and is refused as always
    expect(refusal(b.doc, [{ op: 'add_clip', args: { assetId: b.w, start: f(0), duration: f(300), sourceIn: f(59) } }])).toEqual({ code: 'out_of_bounds', message: 'clip would read past the end of the source' });
  });
  it('refuses a still, linked sound, a missing duration, a sound track, and a picture outside the file', () => {
    const b = base();
    const audioTrack = tx(b.doc, [{ op: 'add_track', args: { kind: 'audio' } }]);
    const aTrack = audioTrack.results[0]!.output!.trackId as string;
    expect(refusal(b.doc, [{ op: 'add_clip', args: { assetId: b.p, start: f(0), duration: f(30), freeze: true } }])).toEqual({ code: 'incompatible', message: 'a held frame needs a video file' });
    expect(refusal(b.doc, [{ op: 'add_clip', args: { assetId: b.v, start: f(0), duration: f(30), freeze: true, withLinkedAudio: true } }])).toEqual({ code: 'incompatible', message: 'a held frame has no sound' });
    expect(refusal(b.doc, [{ op: 'add_clip', args: { assetId: b.v, start: f(0), freeze: true } }])).toEqual({ code: 'invalid_args', message: 'a held frame needs a duration' });
    expect(refusal(audioTrack.doc, [{ op: 'add_clip', args: { assetId: b.v, start: f(0), duration: f(30), freeze: true, trackId: aTrack } }])).toEqual({ code: 'incompatible', message: 'a held frame goes on a picture track' });
    expect(refusal(b.doc, [{ op: 'add_clip', args: { assetId: b.v, start: f(0), duration: f(30), freeze: true, sourceIn: f(240) } }])).toEqual({ code: 'out_of_bounds', message: 'sourceIn is outside the asset' });
    expect(refusal(b.doc, [{ op: 'add_clip', args: { assetId: b.v, start: f(0), duration: f(30), freeze: true, withLinkedAudio: false } }])).toBeNull(); // false is fine
  });
  it('a call without freeze makes exactly what it always made (old logs replay identically)', () => {
    const b = base();
    const r = tx(b.doc, [{ op: 'add_clip', args: { assetId: b.v, start: f(0), duration: f(30) } }]);
    const c = clipOf(r.doc, r.results[0]!.output!.clipId as string);
    expect(Object.keys(c).sort()).toEqual(['assetId', 'duration', 'gain', 'id', 'linkGroupId', 'sourceIn', 'start', 'transform', 'type']);
    expect(r.results[0]!.output!.audioClipId).toBeTypeOf('string');
  });
});

describe('the freeze-handle rule: a transition out of a freeze frame plays over the held picture', () => {
  it('spareAfter: null for a still and a freeze, the frames after the end otherwise', () => {
    const h = heldThenClip();
    expect(spareAfter(clipOf(h.doc, h.held), h.doc.assets[h.v]!, R)).toBeNull();
    expect(spareAfter(clipOf(h.doc, h.next), h.doc.assets[h.v]!, R)).toBe(180);
    expect(spareAfter({ ...clipOf(h.doc, h.next), assetId: h.p }, h.doc.assets[h.p]!, R)).toBeNull();
  });
  it('set_transition: a dissolve after a held frame (add_clip freeze) is accepted at any length the clip allows', () => {
    const h = heldThenClip();
    const r = tx(h.doc, [{ op: 'set_transition', args: { clipId: h.next, type: 'dissolve', frames: 45 } }]);
    expect(clipOf(r.doc, h.next).transition).toEqual({ type: 'dissolve', frames: 45 });
    expect(validateProject(r.doc)).toEqual([]);
    expect(velocityLimit(r.doc, h.next)).toMatchObject({ haveOutFrames: null });
  });
  it('set_transition: also after a freeze made by freeze_frame', () => {
    const b = base();
    const r0 = tx(b.doc, [{ op: 'add_clip', args: { assetId: b.v, start: f(0), sourceIn: f(30), duration: f(90), withLinkedAudio: false } }]);
    const src = r0.results[0]!.output!.clipId as string;
    const r1 = tx(r0.doc, [{ op: 'freeze_frame', args: { clipId: src, at: f(30), duration: f(20) } }]);
    const seq = r1.doc.sequences[r1.doc.mainSequenceId]!;
    const after = seq.tracks.flatMap((t) => t.clips).find((c) => T.eq(c.start, f(50)) && c.type === 'media' && !c.freeze)!;
    const r2 = tx(r1.doc, [{ op: 'set_transition', args: { clipId: after.id, type: 'dissolve', frames: 15 } }]);
    expect(clipOf(r2.doc, after.id).transition?.frames).toBe(15);
  });
  it('a velocity ramp out of a freeze frame is still refused (it cannot remap a held picture)', () => {
    const h = heldThenClip();
    const r = tx(h.doc, [{ op: 'set_transition', args: { clipId: h.next, type: 'dissolve', frames: 15 } }]);
    expect(refusal(r.doc, [{ op: 'set_transition_options', args: { clipId: h.next, velocity: 2 } }])?.message).toBe('a velocity ramp cannot remap a clip that plays backwards or is a freeze frame');
  });
  it('replace_clip_media: a held frame that dissolves into the next picture may be given another picture of another file', () => {
    const h = heldThenClip();
    const r = tx(h.doc, [{ op: 'set_transition', args: { clipId: h.next, type: 'dissolve', frames: 20 } }]);
    const swapped = tx(r.doc, [{ op: 'replace_clip_media', args: { clipId: h.held, assetId: h.w, sourceIn: f(59) } }]); // the last picture of a 60-frame file
    expect(clipOf(swapped.doc, h.held)).toMatchObject({ assetId: h.w, sourceIn: f(59), freeze: true });
    expect(validateProject(swapped.doc)).toEqual([]);
  });
  it('a clip that is not a freeze still needs its spare frames (the rule changed nothing else)', () => {
    const h = heldThenClip();
    const r = tx(h.doc, [{ op: 'add_clip', args: { assetId: h.w, start: f(90), sourceIn: f(0), duration: f(30), withLinkedAudio: false } }]);
    const last = r.results[0]!.output!.clipId as string;
    // h.next ends at source frame 60 of a 240-frame file: 180 spare; a slip to the end leaves none
    const slipped = tx(r.doc, [{ op: 'slip_clip', args: { clipId: h.next, by: f(180) } }]);
    expect(refusal(slipped.doc, [{ op: 'set_transition', args: { clipId: last, type: 'dissolve', frames: 5 } }])?.code).toBe('out_of_bounds');
  });
});
