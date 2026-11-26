/**
 * replace_clip_media (ADR-0016): a clip takes another file and keeps everything else, its id first of all (so per-format
 * overrides and template slots stay). Linked sound follows by default or is detached on request. Every refusal names what
 * is missing, and undo (the step's entity diff applied backwards) restores the previous document exactly.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, diffEntities, OpError, restoreEntities, validateProject,
  type MediaClip, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `rm${n++}_`, actor: 'test', allowInternal });
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const vid = (name: string, c: string, seconds: number, sound = true) => ({ kind: 'video' as const, name, contentHash: hash(c), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: seconds * 30 }, ...(sound ? { audio: { sampleRate: 48000, channels: 2, codec: 'aac' } } : {}), provenance });
const ASSETS = {
  long: vid('long.mp4', '1', 8),
  short: vid('short.mp4', '2', 4),
  mute: vid('mute.mp4', '3', 8, false),
  still: { kind: 'image' as const, name: 'p.png', contentHash: hash('4'), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance },
  song: { kind: 'audio' as const, name: 's.wav', contentHash: hash('5'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance },
  lut: { kind: 'lut' as const, name: 'look.cube', contentHash: hash('6'), byteSize: 1, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: 2, title: null }, provenance },
};
type Key = keyof typeof ASSETS;

const find = (doc: ProjectDocument, id: string) => { for (const s of Object.values(doc.sequences)) for (const t of s.tracks) for (const c of t.clips) if (c.id === id) return { clip: c as MediaClip, track: t }; throw new Error(`no clip ${id}`); };
function acceptAndUndo(doc: ProjectDocument, ops: OpCall[]) {
  const r = tx(doc, ops);
  expect(validateProject(r.doc)).toEqual([]);
  const back = structuredClone(r.doc);
  restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
  expect(creativeProjection(back)).toBe(creativeProjection(doc));
  return r;
}

/**
 * Two clips of the long video, touching: A at 0…60 (source 1 s…3 s) and B at 60…120 (source 4 s…6 s) with a 15-frame
 * dissolve into it; each with its linked sound. A carries a transform, opacity keys, an effect, a blend mode and a mask, and a
 * square format hides nothing but moves A. A title at 0…30.
 */
function edit() {
  let r = tx(createProject({ id: 'prj_rm', name: 'R', width: 640, height: 360 }), Object.values(ASSETS).map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  const id = Object.fromEntries((Object.keys(ASSETS) as Key[]).map((k, i) => [k, r.results[i]!.output!.assetId as string])) as Record<Key, string>;
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: id.long, start: f(0), sourceIn: f(30), duration: f(60) } },
    { op: 'add_clip', args: { assetId: id.long, start: f(60), sourceIn: f(120), duration: f(60) } },
    { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(30) } },
    { op: 'add_variant', args: { profileId: 'square-1x1' } },
  ]);
  const a = r.results[0]!.output as { clipId: string; audioClipId: string }, b = r.results[1]!.output as { clipId: string; audioClipId: string };
  const title = r.results[2]!.output!.clipId as string, variantId = r.results[3]!.output!.variantId as string;
  r = tx(r.doc, [
    { op: 'set_clip_transform', args: { clipId: a.clipId, transform: { x: 0.1, scale: 1.2 } } },
    { op: 'set_keyframe', args: { clipId: a.clipId, property: 'opacity', time: f(0), value: 0 } },
    { op: 'set_keyframe', args: { clipId: a.clipId, property: 'opacity', time: f(10), value: 1 } },
    { op: 'add_effect', args: { clipId: a.clipId, type: 'color.sepia' } },
    { op: 'set_clip_blend', args: { clipId: a.clipId, mode: 'screen' } },
    { op: 'set_clip_mask', args: { clipId: a.clipId, mask: { shape: 'ellipse' } } },
    { op: 'set_transition', args: { clipId: b.clipId, type: 'dissolve', frames: 15 } },
    { op: 'set_variant_override', args: { variantId, clipId: a.clipId, transform: { x: -0.2 } } },
    { op: 'set_clip_fades', args: { clipId: a.audioClipId, fadeIn: f(5) } },
  ]);
  return { doc: r.doc, id, a, b, title, variantId };
}
const replace = (clipId: string, assetId: string, extra: Record<string, unknown> = {}): OpCall => ({ op: 'replace_clip_media', args: { clipId, assetId, ...extra } });

describe('replace_clip_media keeps the clip', () => {
  it('only the file and the source start change; id, place, length, transform, keys, effects, blend, mask, transition and overrides stay', () => {
    const { doc, id, a, b, variantId } = edit();
    const before = find(doc, a.clipId).clip, beforeB = find(doc, b.clipId).clip;
    // B (4 s…6 s of the long file) takes the short file: 4 s is past its end (4 s long), so sourceIn falls back to 0
    const r = acceptAndUndo(doc, [replace(a.clipId, id.short), replace(b.clipId, id.short)]);
    const after = find(r.doc, a.clipId).clip, afterB = find(r.doc, b.clipId).clip;
    expect(after.assetId).toBe(id.short);
    expect(T.eq(after.sourceIn, before.sourceIn)).toBe(true); // 1 s…3 s fits in 4 s: kept
    expect({ ...after, assetId: before.assetId, sourceIn: before.sourceIn }).toEqual(before);
    expect(T.eq(afterB.sourceIn, T.ZERO)).toBe(true);
    expect(afterB.transition).toEqual(beforeB.transition);
    expect(r.doc.variants[variantId]).toEqual(doc.variants[variantId]);
    // the linked sound followed, with the same sourceIn, and kept its fade
    const sound = find(r.doc, a.audioClipId).clip;
    expect([sound.assetId, T.eq(sound.sourceIn, after.sourceIn), sound.fadeIn && T.eq(sound.fadeIn, f(5)), sound.linkGroupId]).toEqual([id.short, true, true, after.linkGroupId]);
    expect(r.results[0]!.output).toEqual({ clipIds: [a.clipId, a.audioClipId], assetId: id.short, sourceIn: before.sourceIn, unlinkedClipIds: [] });
  });
  it('an explicit sourceIn is used; a still picture starts at 0; a sound clip may be given another sound', () => {
    const { doc, id, a } = edit();
    const r = acceptAndUndo(doc, [replace(a.clipId, id.long, { sourceIn: f(90) })]);
    expect(T.eq(find(r.doc, a.clipId).clip.sourceIn, f(90))).toBe(true);
    const still = acceptAndUndo(doc, [replace(a.clipId, id.still, { linked: 'detach' })]);
    expect(T.eq(find(still.doc, a.clipId).clip.sourceIn, T.ZERO)).toBe(true);
    const song = acceptAndUndo(doc, [replace(a.audioClipId, id.song, { linked: 'detach' })]);
    expect(find(song.doc, a.audioClipId).clip.assetId).toBe(id.song);
    expect(find(song.doc, a.clipId).clip.assetId).toBe(id.long);
  });
});

describe('linked sound: follow or detach', () => {
  it('follow (default) refuses a file without sound, naming linked:detach; detach unlinks both and leaves the sound as it is', () => {
    const { doc, id, a } = edit();
    const e = refusal(() => tx(doc, [replace(a.clipId, id.mute)]));
    expect([e.code, e.message]).toEqual(['incompatible', `the clip linked to this one (${a.audioClipId}) plays sound, and the file has no sound`]);
    expect(e.hint).toMatch(/linked:detach/);
    expect(refusal(() => tx(doc, [replace(a.clipId, id.still)])).hint).toMatch(/linked:detach/);
    const r = acceptAndUndo(doc, [replace(a.clipId, id.mute, { linked: 'detach' })]);
    const pic = find(r.doc, a.clipId).clip, sound = find(r.doc, a.audioClipId).clip;
    expect([pic.assetId, pic.linkGroupId, sound.assetId, sound.linkGroupId]).toEqual([id.mute, null, id.long, null]);
    expect(r.results[0]!.output!.unlinkedClipIds).toEqual([a.clipId, a.audioClipId]);
    expect(find(r.doc, a.audioClipId).clip).toEqual({ ...find(doc, a.audioClipId).clip, linkGroupId: null });
  });
  it('a sound clip given a video follows into its picture; given a sound-only file, the picture refuses unless detached', () => {
    const { doc, id, a } = edit();
    const r = acceptAndUndo(doc, [replace(a.audioClipId, id.short)]);
    expect([find(r.doc, a.clipId).clip.assetId, find(r.doc, a.audioClipId).clip.assetId]).toEqual([id.short, id.short]);
    const e = refusal(() => tx(doc, [replace(a.audioClipId, id.song)]));
    expect([e.code, e.message]).toEqual(['incompatible', `the clip linked to this one (${a.clipId}) shows a picture, and the file has no picture`]);
  });
  it('a linked clip on a locked track stops a follow; detach leaves it alone but cannot unlink it there', () => {
    const { doc, id, a } = edit();
    const audioTrack = find(doc, a.audioClipId).track.id;
    const locked = tx(doc, [{ op: 'update_track', args: { trackId: audioTrack, locked: true } }]).doc;
    const e = refusal(() => tx(locked, [replace(a.clipId, id.short)]));
    expect([e.code, e.hint]).toEqual(['track_locked', 'Unlock the track, or pass linked:detach to leave that clip as it is.']);
    expect(refusal(() => tx(locked, [replace(a.clipId, id.short, { linked: 'detach' })])).code).toBe('track_locked');
  });
});

describe('refusals', () => {
  it('a file that is not there, a colour table, a title and an adjustment', () => {
    const { doc, id, a, title } = edit();
    expect(refusal(() => tx(doc, [replace(a.clipId, 'ast_none')])).code).toBe('not_found');
    expect(refusal(() => tx(doc, [replace(a.clipId, id.lut)])).message).toBe('a colour table (LUT) is not placed on the timeline; it is applied to a clip as an effect');
    expect(refusal(() => tx(doc, [replace(title, id.long)])).message).toBe('only clips that play a file can take another file');
    const adj = tx(doc, [{ op: 'add_adjustment', args: { span: 'edit' } }]);
    const x = refusal(() => tx(adj.doc, [replace(adj.results[0]!.output!.clipId as string, id.long)]));
    expect([x.code, x.message]).toEqual(['incompatible', 'an adjustment clip has no source or picture of its own, so it cannot be given another file']);
  });
  it('a picture clip needs a picture and a sound clip needs sound', () => {
    const { doc, id, a } = edit();
    expect(refusal(() => tx(doc, [replace(a.clipId, id.song, { linked: 'detach' })])).message).toBe('this clip shows a picture, and the file has no picture');
    expect(refusal(() => tx(doc, [replace(a.audioClipId, id.mute, { linked: 'detach' })])).message).toBe('this clip plays sound, and the file has no sound');
  });
  it('a file too short from sourceIn: out_of_bounds with what is available and what is needed', () => {
    const { doc, id, a } = edit();
    const e = refusal(() => tx(doc, [replace(a.clipId, id.short, { sourceIn: f(90) })]));
    expect([e.code, e.message]).toEqual(['out_of_bounds', 'the file is too short for this clip from that point']);
    expect(T.eq(e.details.available as T.RationalTime, f(30))).toBe(true); // 4 s − 3 s
    expect(T.eq(e.details.needed as T.RationalTime, f(60))).toBe(true);
    expect(refusal(() => tx(doc, [replace(a.clipId, id.short, { sourceIn: f(-1) })])).code).toBe('out_of_bounds');
    // at double speed the clip needs twice the source: 4 s from 0, which the short file has exactly; from 1 frame on it does not
    const fast = tx(doc, [{ op: 'set_clip_speed', args: { clipId: a.clipId, speed: 2, includeLinked: true } }]).doc;
    const len = T.frameIndexAt(find(fast, a.clipId).clip.duration, R);
    expect(len).toBe(30);
    acceptAndUndo(fast, [replace(a.clipId, id.short, { sourceIn: f(60) })]);
    const twice = refusal(() => tx(fast, [replace(a.clipId, id.short, { sourceIn: f(61) })]));
    expect(T.eq(twice.details.needed as T.RationalTime, f(60))).toBe(true);
  });
  it('a still picture cannot replace a clip at another speed, played backwards, frozen or ramped', () => {
    const { doc, id, a, b } = edit();
    const setups: OpCall[][] = [
      [{ op: 'set_clip_speed', args: { clipId: a.clipId, speed: 2, includeLinked: false } }],
      [{ op: 'set_clip_reverse', args: { clipId: a.clipId, reverse: true, includeLinked: false } }],
      [{ op: 'delete_clip', args: { clipId: b.clipId } }, { op: 'set_clip_speed_ramp', args: { clipId: a.clipId, from: 1, to: 2, includeLinked: false } }],
    ];
    for (const ops of setups) {
      const d = tx(doc, ops).doc;
      const e = refusal(() => tx(d, [replace(a.clipId, id.still, { linked: 'detach' })]));
      expect([e.code, e.message]).toEqual(['incompatible', 'a still picture cannot replace a clip that plays at another speed, backwards, as a freeze frame or with a gradual change of speed']);
    }
    const frozen = tx(doc, [{ op: 'freeze_frame', args: { clipId: a.clipId, at: f(20), duration: f(15) } }]);
    const hold = frozen.results[0]!.output!.freezeClipId as string;
    expect(refusal(() => tx(frozen.doc, [replace(hold, id.still)])).message).toMatch(/^a still picture cannot replace/);
    // a freeze frame takes another video: it needs one picture inside the file
    acceptAndUndo(frozen.doc, [replace(hold, id.short)]);
  });
  it('a transition into the next clip needs spare source after this clip in the new file: out_of_bounds with maxFrames', () => {
    const { doc, id, a } = edit();
    // A needs 60 frames; the short file has 120: from frame 55 on, 5 frames are left after A's end, and the dissolve into B needs 15
    const e = refusal(() => tx(doc, [replace(a.clipId, id.short, { sourceIn: f(55) })]));
    expect([e.code, e.message]).toEqual(['out_of_bounds', 'the transition into the next clip needs 15 spare source frames after this clip, and the file has only 5']);
    expect(e.details.maxFrames).toBe(5);
    acceptAndUndo(doc, [replace(a.clipId, id.short, { sourceIn: f(45) })]); // exactly 15 left
    acceptAndUndo(doc, [replace(a.clipId, id.still, { linked: 'detach' })]); // a still picture holds as long as needed
  });
  it('the same file from the same point changes nothing and is refused', () => {
    const { doc, id, a } = edit();
    expect(refusal(() => tx(doc, [replace(a.clipId, id.long)])).code).toBe('invalid_args');
    // detaching from the same file is a change: the link goes
    const r = acceptAndUndo(doc, [replace(a.clipId, id.long, { linked: 'detach' })]);
    expect(find(r.doc, a.clipId).clip.linkGroupId).toBeNull();
  });
});
