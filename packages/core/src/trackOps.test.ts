/**
 * The motion tracking operations (ADR-0015): each is undone exactly by restoring the entity before-states (the server's
 * undo), each refusal fires with its own message, removing a file takes its motion tracks along, split and freeze keep a
 * clip's follow and privacy regions, and validation catches what the operations would refuse.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, DEFAULT_REDACT_REGION, diffEntities, findClip, MAX_MOTION_TRACKS, MAX_REDACT_REGIONS, OpError, ST, validateProject,
  type MediaClip, type MotionTrack, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (k: number) => T.frameTime(k, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `o${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = (hash: string, frames = 240) => ({ kind: 'video' as const, name: `${hash}.mp4`, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, R), video: { width: 1280, height: 720, frameRate: R, codec: 'h264', rotation: 0, frameCount: frames }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov });
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'3'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };
const music = { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'4'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(10, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm' }, provenance: prov };
const out = (r: ReturnType<typeof tx>, i: number, key: string) => r.results[i]!.output![key] as string;
const clipOf = (d: ProjectDocument, id: string) => findClip(d, id)!.clip;

/**
 * A project with: a video clip (V1) of asset A with its sound, a second file B on V2 above it, a still on V3, a title, a caption
 * cue and an adjustment clip; a region track on A with tracked samples over source frames 0..119, and a point track on B.
 */
function setup() {
  let r = tx(createProject({ id: 'prj_o', name: 'O', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset: video('1') } }, { op: 'import_asset', args: { asset: video('2') } }, { op: 'import_asset', args: { asset: still } }, { op: 'import_asset', args: { asset: music } }], true);
  const A = out(r, 0, 'assetId'), B = out(r, 1, 'assetId'), S = out(r, 2, 'assetId'), M = out(r, 3, 'assetId');
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: A, start: f(0), sourceIn: f(0), duration: f(120) } },
    { op: 'add_clip', args: { assetId: B, start: f(0), duration: f(60), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId: S, start: f(0), duration: f(60) } },
    { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60) } },
    { op: 'add_cue', args: { start: f(0), duration: f(30), text: 'cue' } },
    { op: 'add_clip', args: { assetId: M, start: f(0), duration: f(60) } },
    { op: 'add_adjustment', args: { span: 'edit' } },
  ]);
  const clip = out(r, 0, 'clipId'), sound = out(r, 0, 'audioClipId'), V1 = out(r, 0, 'trackId'), clipB = out(r, 1, 'clipId'), V2 = out(r, 1, 'trackId'), pic = out(r, 2, 'clipId'), title = out(r, 3, 'clipId'), cue = out(r, 4, 'clipId'), song = out(r, 5, 'clipId'), adjust = out(r, 6, 'clipId');
  r = tx(r.doc, [{ op: 'create_motion_track', args: { assetId: A, kind: 'region', frame: 0, x: 5000, y: 4000, w: 1500, h: 2000, name: 'face' } }, { op: 'create_motion_track', args: { assetId: B, kind: 'point', frame: 10, x: 2000, y: 3000 } }]);
  const face = out(r, 0, 'motionTrackId'), dot = out(r, 1, 'motionTrackId');
  const k = 119;
  const doc = tx(r.doc, [{ op: 'attach_motion_track', args: { motionTrackId: face, from: 1, x: Array.from({ length: k }, (_, i) => 5000 + i * 10), y: Array(k).fill(4000), s: Array(k).fill(1000), q: Array(k).fill(90), st: Array.from({ length: k }, (_, i) => (i >= 60 && i < 70 ? ST.lost : ST.tracked)), method: 'test', params: {}, createdAt: '2026-11-17T00:00:00Z' } }], true).doc;
  return { doc, A, B, S, M, clip, sound, V1, clipB, V2, pic, title, cue, song, adjust, face, dot };
}
/** Apply, then undo through the internal restore op with the entity before-states, as the server's undo does; the result must equal the start. */
function undoable(doc: ProjectDocument, ops: OpCall[], allowInternal = false) {
  const r = tx(doc, ops, allowInternal);
  const diff = diffEntities(doc, r.doc);
  expect(diff.length).toBeGreaterThan(0);
  const back = tx(r.doc, [{ op: 'restore_entities', args: { targets: diff.map((c) => ({ id: c.id, state: c.before })) } }], true).doc;
  expect(creativeProjection(back)).toBe(creativeProjection(doc));
  expect(validateProject(r.doc)).toEqual([]);
  return r;
}
const refusal = (doc: ProjectDocument, ops: OpCall[], allowInternal = false): OpError => {
  try { tx(doc, ops, allowInternal); } catch (e) { if (e instanceof OpError) return e; throw e; }
  throw new Error(`not refused: ${JSON.stringify(ops).slice(0, 200)}`);
};
const refused = (doc: ProjectDocument, ops: OpCall[], code: string, message: string | RegExp, allowInternal = false) => {
  const e = refusal(doc, ops, allowInternal);
  expect(e.code).toBe(code);
  if (typeof message === 'string') expect(e.message).toBe(message); else expect(e.message).toMatch(message);
  return e;
};
const follow = (motionTrackId: string, targetTrackId: string) => ({ motionTrackId, targetTrackId, scale: true, smooth: 0 });

describe('motion tracking operations: each is undone exactly', () => {
  it('create, attach, edit, remove; follow and unfollow; add, change and delete a privacy region', () => {
    const s = setup();
    expect(validateProject(s.doc)).toEqual([]);
    const c = undoable(s.doc, [{ op: 'create_motion_track', args: { assetId: s.B, kind: 'point', frame: 30, x: 100, y: 9000 } }]);
    const made = c.doc.motionTracks[out(c, 0, 'motionTrackId')]!;
    expect(made).toMatchObject({ assetId: s.B, kind: 'point', from: 30, x: [100], y: [9000], q: [100], st: [ST.manual], origin: { method: 'manual', createdBy: 'test', edited: false } });
    expect(made.s).toBeUndefined(); expect(made.box).toBeUndefined();
    undoable(s.doc, [{ op: 'attach_motion_track', args: { motionTrackId: s.dot, from: 0, x: [1, 2, 3], y: [4, 5, 6], q: [90, 90, 90], st: [1, 2, 3], method: 'm', params: { v: 1 }, createdAt: 'now' } }], true);
    undoable(s.doc, [{ op: 'edit_motion_track', args: { motionTrackId: s.face, name: 'שם', set: [{ frame: 130, x: 1, y: 2 }], markLost: { from: 5, to: 9 }, interpolate: { from: 60, to: 70 } } }]);
    undoable(s.doc, [{ op: 'remove_motion_track', args: { motionTrackId: s.dot } }]);
    const fol = undoable(s.doc, [{ op: 'set_clip_follow', args: { clipId: s.title, follow: follow(s.face, s.V1), offset: { x: 0, y: -0.08 } } }]);
    expect(clipOf(fol.doc, s.title)).toMatchObject({ follow: follow(s.face, s.V1), transform: { x: 0, y: -0.08, scale: 1 } });
    undoable(fol.doc, [{ op: 'set_clip_follow', args: { clipId: s.title, follow: null } }]);
    const pin = undoable(s.doc, [{ op: 'set_clip_follow', args: { clipId: s.pic, follow: { ...follow(s.dot, s.V2), smooth: 3 } } }]); // a still image on a video track follows too
    expect(clipOf(pin.doc, s.pic).follow?.smooth).toBe(3);
    const add = undoable(s.doc, [{ op: 'set_redact_region', args: { clipId: s.clip, region: { motionTrackId: s.face } } }]);
    const regionId = out(add, 0, 'regionId');
    expect((clipOf(add.doc, s.clip) as MediaClip).redact).toEqual([{ ...DEFAULT_REDACT_REGION, id: regionId, motionTrackId: s.face }]);
    const changed = undoable(add.doc, [{ op: 'set_redact_region', args: { clipId: s.clip, regionId, region: { style: 'pixelate', strength: 1 } } }]);
    expect((clipOf(changed.doc, s.clip) as MediaClip).redact![0]).toMatchObject({ id: regionId, style: 'pixelate', strength: 1, motionTrackId: s.face });
    // deleting the last region leaves no field behind, never an empty list
    const gone = undoable(add.doc, [{ op: 'set_redact_region', args: { clipId: s.clip, regionId, region: null } }]);
    expect('redact' in clipOf(gone.doc, s.clip)).toBe(false);
    // removing a bound track with unbind detaches the follow and removes the regions in the same step
    const bound = tx(add.doc, [{ op: 'set_clip_follow', args: { clipId: s.title, follow: follow(s.face, s.V1) } }, { op: 'set_redact_region', args: { clipId: s.clip, region: { motionTrackId: null, style: 'fill' } } }]).doc;
    const un = undoable(bound, [{ op: 'remove_motion_track', args: { motionTrackId: s.face, unbind: true } }]);
    expect(un.results[0]!.output!.detachedClipIds).toEqual([s.title, s.clip]);
    expect(clipOf(un.doc, s.title).follow).toBeUndefined();
    expect((clipOf(un.doc, s.clip) as MediaClip).redact!.map((x) => x.style)).toEqual(['fill']); // the fixed region stays
    expect(un.doc.motionTracks[s.face]).toBeUndefined();
  });
});

describe('motion tracking operations: refusals', () => {
  it('create_motion_track and attach_motion_track', () => {
    const s = setup();
    const ct = (args: Record<string, unknown>) => [{ op: 'create_motion_track', args }];
    refused(s.doc, ct({ assetId: 'ast_none', kind: 'point', frame: 0, x: 1, y: 1 }), 'not_found', 'asset ast_none not found');
    refused(s.doc, ct({ assetId: s.S, kind: 'point', frame: 0, x: 1, y: 1 }), 'incompatible', 'a motion track follows something in a video; this file has no video');
    refused(s.doc, ct({ assetId: s.M, kind: 'point', frame: 0, x: 1, y: 1 }), 'incompatible', 'a motion track follows something in a video; this file has no video');
    refused(s.doc, ct({ assetId: s.A, kind: 'point', frame: 240, x: 1, y: 1 }), 'out_of_bounds', 'frame 240 is past the last frame of the video (239)');
    refused(s.doc, ct({ assetId: s.A, kind: 'region', frame: 0, x: 1, y: 1, w: 100 }), 'invalid_args', 'a region track needs the size of its box (w and h)');
    refused(s.doc, ct({ assetId: s.A, kind: 'point', frame: 0, x: 1, y: 1, w: 100, h: 100 }), 'invalid_args', 'a point track has no box: w and h belong to region tracks');
    let many = s.doc;
    for (let i = Object.keys(many.motionTracks).length; i < MAX_MOTION_TRACKS; i++) many = tx(many, ct({ assetId: s.A, kind: 'point', frame: i, x: 1, y: 1 })).doc;
    refused(many, ct({ assetId: s.A, kind: 'point', frame: 0, x: 1, y: 1 }), 'out_of_bounds', `a project can hold at most ${MAX_MOTION_TRACKS} motion tracks`);
    const at = (args: Record<string, unknown>) => [{ op: 'attach_motion_track', args: { motionTrackId: s.face, from: 0, x: [1], y: [1], s: [1000], q: [1], st: [1], method: 'm', params: {}, createdAt: 'now', ...args } }];
    expect(refusal(s.doc, at({})).code).toBe('forbidden_op'); // internal: jobs only
    refused(s.doc, at({ motionTrackId: 'mtk_none' }), 'not_found', 'motion track mtk_none not found', true);
    refused(s.doc, at({ y: [1, 2] }), 'invalid_args', 'x, y, s, q and st must have the same length', true);
    refused(s.doc, at({ s: undefined }), 'invalid_args', 'a region track needs sizes (s)', true);
    refused(s.doc, at({ motionTrackId: s.dot }), 'invalid_args', 'a point track has no sizes (s)', true);
    refused(s.doc, at({ st: [ST.manual] }), 'invalid_args', 'measured samples cannot be marked manual', true);
    refused(s.doc, at({ from: 239, x: [1, 1], y: [1, 1], s: [1000, 1000], q: [1, 1], st: [1, 1] }), 'out_of_bounds', 'the samples reach past the last frame of the video (239)', true);
  });
  it('edit_motion_track and remove_motion_track', () => {
    const s = setup();
    const ed = (args: Record<string, unknown>) => [{ op: 'edit_motion_track', args: { motionTrackId: s.face, ...args } }];
    refused(s.doc, ed({ motionTrackId: 'mtk_none', name: 'x' }), 'not_found', 'motion track mtk_none not found');
    refused(s.doc, ed({}), 'invalid_args', 'nothing to change: give name, set, markLost or interpolate');
    refused(s.doc, ed({ set: [{ frame: 3, x: 1, y: 1 }, { frame: 3, x: 2, y: 2 }] }), 'invalid_args', 'frame 3 is set twice');
    refused(s.doc, ed({ set: [{ frame: 240, x: 1, y: 1 }] }), 'out_of_bounds', 'frame 240 is past the last frame of the video (239)');
    refused(s.doc, ed({ motionTrackId: s.dot, set: [{ frame: 3, x: 1, y: 1, s: 1000 }] }), 'invalid_args', 'a point track has no sizes (s)');
    refused(s.doc, ed({ markLost: { from: 9, to: 9 } }), 'invalid_args', 'markLost: the stretch must end after it starts (to is one past its last frame)');
    refused(s.doc, ed({ interpolate: { from: 100, to: 121 } }), 'out_of_bounds', 'interpolate: the stretch must lie inside the track (source frames 0 to 119)');
    refused(tx(s.doc, ed({ markLost: { from: 0, to: 10 } })).doc, ed({ interpolate: { from: 0, to: 5 } }), 'incompatible', 'filling in needs a usable sample before the stretch and another after it');
    const bound = tx(s.doc, [{ op: 'set_clip_follow', args: { clipId: s.title, follow: follow(s.face, s.V1) } }, { op: 'set_redact_region', args: { clipId: s.clip, region: { motionTrackId: s.face } } }]).doc;
    const e = refused(bound, [{ op: 'remove_motion_track', args: { motionTrackId: s.face } }], 'incompatible', '2 clip(s) follow this motion track or hide a region with it');
    expect(e.details).toMatchObject({ follow: [s.title], redact: [s.clip] });
    const textTrack = findClip(bound, s.title)!.track.id;
    const locked = tx(bound, [{ op: 'update_track', args: { trackId: textTrack, locked: true } }]).doc;
    refused(locked, [{ op: 'remove_motion_track', args: { motionTrackId: s.face, unbind: true } }], 'track_locked', `track ${textTrack} is locked`);
    refused(s.doc, [{ op: 'remove_motion_track', args: { motionTrackId: 'mtk_none' } }], 'not_found', 'motion track mtk_none not found');
  });
  it('set_clip_follow, and time effects on a clip that follows', () => {
    const s = setup();
    const sf = (clipId: string, fo: unknown) => [{ op: 'set_clip_follow', args: { clipId, follow: fo } }];
    const only = 'only a title or a drawing, or a picture on a video track, can follow a motion track';
    refused(s.doc, sf(s.cue, follow(s.face, s.V1)), 'incompatible', only);
    refused(s.doc, sf(s.song, follow(s.face, s.V1)), 'incompatible', only);
    refused(s.doc, sf(s.sound, follow(s.face, s.V1)), 'incompatible', only);
    refused(s.doc, sf(s.adjust, follow(s.face, s.V1)), 'incompatible', only);
    refused(s.doc, sf('clp_none', follow(s.face, s.V1)), 'not_found', 'clip clp_none not found');
    refused(s.doc, sf(s.title, follow('mtk_none', s.V1)), 'not_found', 'motion track mtk_none not found');
    refused(s.doc, sf(s.title, follow(s.face, 'trk_none')), 'not_found', 'track trk_none not found');
    const audioTrack = findClip(s.doc, s.song)!.track.id;
    refused(s.doc, sf(s.title, follow(s.face, audioTrack)), 'incompatible', `a clip follows a picture on a video track; track ${audioTrack} is a audio track`);
    refused(s.doc, sf(s.clipB, follow(s.face, s.V2)), 'incompatible', 'a clip cannot follow the picture on its own track');
    const echoed = tx(s.doc, [{ op: 'add_effect', args: { clipId: s.title, type: 'time.echo' } }]);
    refused(echoed.doc, sf(s.title, follow(s.face, s.V1)), 'incompatible', 'a clip with a time effect (echo, time split, shutter or stutter) cannot follow a motion track yet');
    // a time effect that is turned off does not count; turning it on again while following is refused
    const off = tx(echoed.doc, [{ op: 'update_effect', args: { clipId: s.title, effectId: out(echoed, 0, 'effectId'), enabled: false } }, { op: 'set_clip_follow', args: { clipId: s.title, follow: follow(s.face, s.V1) } }]).doc;
    refused(off, [{ op: 'update_effect', args: { clipId: s.title, effectId: out(echoed, 0, 'effectId'), enabled: true } }], 'incompatible', 'a clip with a time effect (echo, time split, shutter or stutter) cannot follow a motion track yet');
    const following = tx(s.doc, sf(s.title, follow(s.face, s.V1))).doc;
    refused(following, [{ op: 'add_effect', args: { clipId: s.title, type: 'time.stutter' } }], 'incompatible', 'a clip with a time effect (echo, time split, shutter or stutter) cannot follow a motion track yet');
    // no chains, in either order: B (on V2) follows A's picture on V1; then nothing may follow V2, and V1's clip may not follow
    const bFollows = tx(s.doc, sf(s.clipB, follow(s.face, s.V1))).doc;
    refused(bFollows, sf(s.title, follow(s.dot, s.V2)), 'incompatible', `clip ${s.clipB} on that track follows a motion track itself; follows cannot be chained`);
    refused(following, sf(s.clip, follow(s.dot, s.V2)), 'incompatible', `clip ${s.title} follows the picture on this clip's track; follows cannot be chained`);
    const vTrackLocked = tx(following, [{ op: 'update_track', args: { trackId: findClip(s.doc, s.title)!.track.id, locked: true } }]).doc;
    refused(vTrackLocked, sf(s.title, null), 'track_locked', `track ${findClip(s.doc, s.title)!.track.id} is locked`);
  });
  it('set_redact_region', () => {
    const s = setup();
    const rr = (args: Record<string, unknown>) => [{ op: 'set_redact_region', args }];
    refused(s.doc, rr({ clipId: s.pic, region: {} }), 'incompatible', 'privacy regions are drawn on video pictures only; this clip shows a still image');
    refused(s.doc, rr({ clipId: s.title, region: {} }), 'incompatible', 'privacy regions apply to video clips on video tracks');
    refused(s.doc, rr({ clipId: s.sound, region: {} }), 'incompatible', 'effects, blends, masks and transitions apply to picture, title and adjustment clips');
    refused(s.doc, rr({ clipId: s.clip, region: null }), 'invalid_args', 'name the region to delete (regionId)');
    refused(s.doc, rr({ clipId: s.clip, regionId: 'rgn_none', region: null }), 'not_found', `region rgn_none not found on clip ${s.clip}`);
    refused(s.doc, rr({ clipId: s.clip, regionId: 'rgn_none', region: { style: 'fill' } }), 'not_found', `region rgn_none not found on clip ${s.clip}`);
    refused(s.doc, rr({ clipId: s.clip, region: { motionTrackId: 'mtk_none' } }), 'not_found', 'motion track mtk_none not found');
    refused(s.doc, rr({ clipId: s.clip, region: { motionTrackId: s.dot } }), 'incompatible', 'a privacy region follows a motion track of the clip\'s own video file');
    const full = tx(s.doc, Array.from({ length: MAX_REDACT_REGIONS }, () => ({ op: 'set_redact_region', args: { clipId: s.clip, region: {} } }))).doc;
    expect((clipOf(full, s.clip) as MediaClip).redact!.length).toBe(MAX_REDACT_REGIONS);
    refused(full, rr({ clipId: s.clip, region: {} }), 'out_of_bounds', `a clip can carry at most ${MAX_REDACT_REGIONS} privacy regions`);
  });
});

describe('motion tracks with the rest of the editor', () => {
  it('removing a file takes its motion tracks along, refuses while a clip is bound to one, and undo brings both back', () => {
    const s = setup();
    // B is used by clipB: free it first; its point track then goes with it
    const free = tx(s.doc, [{ op: 'delete_clip', args: { clipId: s.clipB } }]).doc;
    const r = undoable(free, [{ op: 'remove_asset', args: { assetId: s.B } }]);
    expect(r.affectedIds).toEqual([s.B, s.dot]);
    expect(r.doc.motionTracks[s.dot]).toBeUndefined();
    expect(r.doc.motionTracks[s.face]).toBeDefined();
    // a title following B's track keeps B in the library
    const bound = tx(s.doc, [{ op: 'set_clip_follow', args: { clipId: s.title, follow: follow(s.dot, s.V2) } }, { op: 'delete_clip', args: { clipId: s.clipB } }]).doc;
    refused(bound, [{ op: 'remove_asset', args: { assetId: s.B } }], 'incompatible', '1 clip(s) still follow a motion track of this file or hide a region with one');
  });
  it('split keeps the follow and the privacy regions on both halves; a freeze frame keeps them on the held picture', () => {
    const s = setup();
    const d = tx(s.doc, [{ op: 'set_redact_region', args: { clipId: s.clip, region: { motionTrackId: s.face, style: 'pixelate' } } }, { op: 'set_clip_follow', args: { clipId: s.clipB, follow: follow(s.face, s.V1) } }]).doc;
    const split = undoable(d, [{ op: 'split_clip', args: { clipId: s.clip, at: f(40) } }, { op: 'split_clip', args: { clipId: s.clipB, at: f(20) } }]);
    const [right, rightB] = [out(split, 0, 'rightClipId'), out(split, 1, 'rightClipId')];
    for (const id of [s.clip, right]) expect((clipOf(split.doc, id) as MediaClip).redact).toEqual((clipOf(d, s.clip) as MediaClip).redact);
    for (const id of [s.clipB, rightB]) expect(clipOf(split.doc, id).follow).toEqual(follow(s.face, s.V1));
    const frozen = undoable(d, [{ op: 'freeze_frame', args: { clipId: s.clip, at: f(30), duration: f(15) } }]);
    expect((clipOf(frozen.doc, out(frozen, 0, 'freezeClipId')) as MediaClip).redact).toEqual((clipOf(d, s.clip) as MediaClip).redact);
  });
});

describe('motion tracking: validation catches what the operations refuse', () => {
  const codes = (d: ProjectDocument) => validateProject(d).map((i) => i.code);
  it('follows, privacy regions and tracks that the operations would not make are reported', () => {
    const s = setup();
    const edit = (fn: (d: ProjectDocument) => void) => { const d = structuredClone(s.doc); fn(d); return d; };
    const clip = (d: ProjectDocument, id: string) => clipOf(d, id) as MediaClip;
    expect(codes(edit((d) => { clip(d, s.cue).follow = follow(s.face, s.V1); }))).toEqual(['follow_clip']);
    expect(codes(edit((d) => { clip(d, s.song).follow = follow(s.face, s.V1); }))).toEqual(['follow_clip']);
    expect(codes(edit((d) => { clip(d, s.adjust).follow = follow(s.face, s.V1); }))).toEqual(['follow_clip']);
    expect(codes(edit((d) => { clip(d, s.title).follow = follow('mtk_none', s.V1); }))).toEqual(['follow_track']);
    // a target track that does not exist (any more) is not an issue: the evaluator reports it
    expect(codes(edit((d) => { clip(d, s.title).follow = follow(s.face, 'trk_gone'); }))).toEqual([]);
    expect(codes(edit((d) => { clip(d, s.title).follow = follow(s.face, s.V1); clip(d, s.title).effects = [{ id: 'fx_1', type: 'time.echo', enabled: true, params: { count: 3, delay: 3, decay: 0.5, mode: 'blend' } }]; }))).toContain('follow_time_effect');
    const region = { ...DEFAULT_REDACT_REGION, id: 'rgn_1', motionTrackId: null };
    expect(codes(edit((d) => { clip(d, s.pic).redact = [region]; }))).toEqual(['redact_still']);
    expect(codes(edit((d) => { clip(d, s.sound).redact = [region]; }))).toEqual(['incompatible_track']);
    expect(codes(edit((d) => { clip(d, s.clip).redact = [region, { ...region }]; }))).toEqual(['duplicate_id']);
    expect(codes(edit((d) => { clip(d, s.clip).redact = [{ ...region, motionTrackId: s.dot }]; }))).toEqual(['redact_track']);
    expect(codes(edit((d) => { clip(d, s.clip).redact = [{ ...region, motionTrackId: 'mtk_none' }]; }))).toEqual(['redact_track']);
    // region ids are unique per clip only: the same id on two clips is fine (split copies clips whole)
    expect(codes(edit((d) => { clip(d, s.clip).redact = [region]; clip(d, s.clipB).redact = [region]; }))).toEqual([]);
    const tr = (d: ProjectDocument) => d.motionTracks[s.face]! as MotionTrack;
    expect(codes(edit((d) => { d.motionTracks.mtk_other = { ...tr(d), id: 'mtk_x' }; }))).toEqual(['key_mismatch']);
    expect(codes(edit((d) => { d.motionTracks[s.clip] = { ...tr(d), id: s.clip }; }))).toEqual(['duplicate_id']); // a track id must not be another entity's
    expect(codes(edit((d) => { tr(d).q = tr(d).q.slice(1); }))).toEqual(['track_shape']);
    expect(codes(edit((d) => { delete tr(d).box; }))).toEqual(['track_shape']);
    expect(codes(edit((d) => { tr(d).from = 200; }))).toEqual(['track_range']);
    expect(codes(edit((d) => { tr(d).st[3] = 9; }))).toEqual(['track_state']);
    expect(codes(edit((d) => { tr(d).assetId = s.S; }))).toEqual(['missing_asset']);
    expect(codes(edit((d) => { for (let i = 0; i < MAX_MOTION_TRACKS; i++) d.motionTracks[`mtk_n${i}`] = { ...tr(d), id: `mtk_n${i}`, x: [1], y: [1], s: [1000], q: [1], st: [1] }; }))).toEqual(['track_limit']);
  });
});
