import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, diffEntities, findClip, OpError, restoreEntities, validateProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { audioPlan } from './audio.ts';
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
    // picture and its linked sound reverse together and stay linked
    expect([T.frameIndexAt(c.start, R), T.frameIndexAt(c.duration, R), T.frameIndexAt(c.sourceIn, R), c.reverse, a.reverse]).toEqual([20, 100, 50, true, true]);
    expect(c.linkGroupId).not.toBeNull();
    expect(a.linkGroupId).toBe(c.linkGroupId);
    expect((result.output as any).reversedClipIds.sort()).toEqual([clipId, audioId].sort());
    // the sound plan reads the same stretch of source and marks it reversed
    const planned = audioPlan(doc).clips.find((x) => x.clipId === audioId)!;
    expect([planned.reverse, planned.source, planned.length]).toEqual([true, Math.round((50 / 30) * 48000), Math.round((100 / 30) * 48000)]);
    expect(audioPlan(fwd).clips.find((x) => x.clipId === audioId)!.reverse).toBeUndefined();
    // one side only: it is reversed alone and the pair is unlinked
    const solo = tx(fwd, [{ op: 'set_clip_reverse', args: { clipId, reverse: true, includeLinked: false } }]);
    const sc = findClip(solo.doc, clipId)!.clip as any, sa = findClip(solo.doc, audioId)!.clip as any;
    expect([sc.reverse, sa.reverse, sc.linkGroupId, sa.linkGroupId]).toEqual([true, undefined, null, null]);
    expect(validateProject(solo.doc)).toEqual([]);
    const back = structuredClone(doc);
    restoreEntities(back, diffEntities(fwd, doc).map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(fwd);
    const again = tx(doc, [{ op: 'set_clip_reverse', args: { clipId, reverse: false } }]).doc;
    expect(shown(again, 20, 120)).toEqual(range(50, 149));
    expect(code(() => tx(doc, [{ op: 'set_clip_reverse', args: { clipId, reverse: true } }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'set_clip_reverse', args: { clipId: audioId, reverse: true } }]))).toBe('invalid_args'); // already reversed, with its picture
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
    const hold = (tx(doc, [{ op: 'freeze_frame', args: { clipId, at: f(40), duration: f(15) } }]).results[0]!.output as any).freezeClipId as string;
    expect(code(() => tx(frozen, [{ op: 'set_clip_reverse', args: { clipId: hold, reverse: true } }]))).not.toBe('ok');
  });
  it('transitions next to a reversed clip: the outgoing reversed clip keeps playing backwards into earlier source, and the spare-source rule looks on the right side', () => {
    const { doc, clipId, assetId } = project(); // reversed, shows 149…50 at 20..119; 50 source frames lie before the stretch
    let d = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(120), sourceIn: f(100), duration: f(30), withLinkedAudio: false } }]);
    const nextId = (d.results[0]!.output as any).clipId as string;
    const withTr = tx(d.doc, [{ op: 'set_transition', args: { clipId: nextId, type: 'dissolve', frames: 10 } }]).doc;
    expect(validateProject(withTr)).toEqual([]);
    // during the transition (timeline 120..129) the outgoing layer continues 49, 48, … and the incoming shows 100, 101, …
    const layers = (t: number) => evaluate(withTr, f(t)).layers.filter((x) => x.kind === 'video').map((x: any) => [x.transition?.role ?? null, x.sourceFrameIndex]);
    expect(layers(119)).toEqual([[null, 50]]);
    expect(layers(120).sort()).toEqual([['in', 100], ['out', 49]].sort());
    expect(layers(129).sort()).toEqual([['in', 109], ['out', 40]].sort());
    expect(layers(130)).toEqual([[null, 110]]);
    // only 50 spare frames exist before the stretch: 51 is refused, 50 is accepted
    expect(code(() => tx(d.doc, [{ op: 'trim_clip', args: { clipId: nextId, edge: 'end', to: f(190) } }, { op: 'set_transition', args: { clipId: nextId, type: 'dissolve', frames: 51 } }]))).toBe('out_of_bounds');
    expect(code(() => tx(d.doc, [{ op: 'trim_clip', args: { clipId: nextId, edge: 'end', to: f(190) } }, { op: 'set_transition', args: { clipId: nextId, type: 'dissolve', frames: 50 } }]))).toBe('ok');
    // a transition AT the start of the reversed clip itself is fine too (it needs nothing from the reversed clip)
    d = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(0), duration: f(20), withLinkedAudio: false } }, { op: 'set_transition', args: { clipId, type: 'dissolve', frames: 8 } }]);
    expect(validateProject(d.doc)).toEqual([]);
    // turning the outgoing clip forwards again needs spare source AFTER the stretch: the source is 240 long and the stretch ends at 150, so it is allowed;
    // slip the stretch to the very end of the source first and it is refused
    expect(code(() => tx(withTr, [{ op: 'set_clip_reverse', args: { clipId, reverse: false } }]))).toBe('ok');
    const atEnd = tx(withTr, [{ op: 'slip_clip', args: { clipId, by: f(85) } }]).doc; // stretch 135..234, 5 frames after it
    expect(code(() => tx(atEnd, [{ op: 'set_clip_reverse', args: { clipId, reverse: false } }]))).toBe('out_of_bounds');
  });
});

describe('track settings', () => {
  it('hide, mute, lock, rename and remove a track; a hidden picture track is not drawn and a muted sound track is not mixed; a locked track refuses edits but can be unlocked; undo restores', () => {
    const { fwd: doc, clipId, audioId } = project();
    const tracks = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks;
    const vt = tracks(doc).find((t) => t.kind === 'video')!.id, at = tracks(doc).find((t) => t.kind === 'audio')!.id;
    const hidden = tx(doc, [{ op: 'update_track', args: { trackId: vt, hidden: true, name: 'B-roll' } }]).doc;
    expect(validateProject(hidden)).toEqual([]);
    expect(evaluate(doc, f(30)).layers.filter((l) => l.kind === 'video').length).toBe(1);
    expect(evaluate(hidden, f(30)).layers.filter((l) => l.kind === 'video').length).toBe(0);
    expect(tracks(hidden).find((t) => t.id === vt)!.name).toBe('B-roll');
    const muted = tx(doc, [{ op: 'update_track', args: { trackId: at, muted: true } }]).doc;
    expect(evaluate(doc, f(30)).audio.length).toBe(1);
    expect(evaluate(muted, f(30)).audio.length).toBe(0);
    const locked = tx(doc, [{ op: 'update_track', args: { trackId: vt, locked: true } }]).doc;
    expect(code(() => tx(locked, [{ op: 'move_clip', args: { clipId, start: f(40) } }]))).toBe('track_locked');
    expect(code(() => tx(locked, [{ op: 'insert_gap', args: { at: f(30), duration: f(10) } }]))).toBe('track_locked');
    expect(code(() => tx(locked, [{ op: 'remove_track', args: { trackId: vt } }]))).toBe('track_locked');
    const unlocked = tx(locked, [{ op: 'update_track', args: { trackId: vt, locked: false } }]).doc;
    expect(unlocked).toEqual(doc);
    const back = structuredClone(hidden);
    restoreEntities(back, diffEntities(doc, hidden).map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(doc);
    // wrong kind, nothing to change, unknown track
    expect(code(() => tx(doc, [{ op: 'update_track', args: { trackId: at, hidden: true } }]))).toBe('incompatible');
    expect(code(() => tx(doc, [{ op: 'update_track', args: { trackId: vt, muted: true } }]))).toBe('incompatible');
    expect(code(() => tx(doc, [{ op: 'update_track', args: { trackId: vt } }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'update_track', args: { trackId: 'trk_none', locked: true } }]))).toBe('not_found');
    // remove: only when empty; undo puts the track back in its place
    expect(code(() => tx(doc, [{ op: 'remove_track', args: { trackId: vt } }]))).toBe('incompatible');
    const emptied = tx(doc, [{ op: 'unlink_clip', args: { clipId } }, { op: 'delete_clip', args: { clipId: audioId } }]).doc;
    const removed = tx(emptied, [{ op: 'remove_track', args: { trackId: at } }]).doc;
    expect(tracks(removed).some((t) => t.id === at)).toBe(false);
    expect(validateProject(removed)).toEqual([]);
    const restored = structuredClone(removed);
    restoreEntities(restored, diffEntities(emptied, removed).map((x) => ({ id: x.id, state: x.before })));
    expect(restored).toEqual(emptied);
  });
});

describe('project frame and library entries', () => {
  it('the project frame size, background and fit can be changed and undone; clips keep their relative layout; odd sizes are refused', () => {
    const { fwd: doc } = project();
    const r = tx(doc, [{ op: 'set_project_format', args: { width: 1080, height: 1920, background: '#102030', fit: 'cover' } }]).doc;
    expect(validateProject(r)).toEqual([]);
    const g0 = evaluate(doc, f(30)), g1 = evaluate(r, f(30));
    expect([g0.width, g0.height, g0.background, g0.fit]).toEqual([640, 360, '#000000', 'contain']);
    expect([g1.width, g1.height, g1.background, g1.fit]).toEqual([1080, 1920, '#102030', 'cover']);
    expect((g1.layers[0] as any).transform).toEqual((g0.layers[0] as any).transform); // positions are fractions of the frame
    expect((g1.layers[0] as any).sourceFrameIndex).toBe((g0.layers[0] as any).sourceFrameIndex);
    const back = structuredClone(r);
    restoreEntities(back, diffEntities(doc, r).map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(doc);
    expect(tx(r, [{ op: 'set_project_format', args: { fit: 'contain' } }]).doc.settings.fit).toBeUndefined();
    expect(code(() => tx(doc, [{ op: 'set_project_format', args: { width: 641 } }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'set_project_format', args: {} }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'set_project_format', args: { background: 'red' } }]))).toBe('invalid_args');
  });
  it('a library file can be renamed, and removed once no clip uses it (its transcript and analysis go with it); undo brings all of it back', () => {
    const { fwd: doc, clipId, audioId, assetId } = project();
    const named = tx(doc, [{ op: 'rename_asset', args: { assetId, name: 'ראיון 1.mp4' } }]).doc;
    expect(named.assets[assetId]!.name).toBe('ראיון 1.mp4');
    expect(code(() => tx(doc, [{ op: 'remove_asset', args: { assetId } }]))).toBe('incompatible');
    let d = tx(doc, [{ op: 'attach_analysis', args: { assetId, kind: 'scenes', method: 'test', params: {}, createdAt: '2026-11-15T00:00:00Z', times: [f(30)] } }], true).doc;
    d = tx(d, [{ op: 'delete_clip', args: { clipId } }]).doc; // the linked sound clip goes with it
    expect(findClip(d, audioId)).toBeUndefined();
    expect(d.analyses[assetId]).toBeDefined();
    const removed = tx(d, [{ op: 'remove_asset', args: { assetId } }]).doc;
    expect([removed.assets[assetId], removed.analyses[assetId]]).toEqual([undefined, undefined]);
    expect(validateProject(removed)).toEqual([]);
    const back = structuredClone(removed);
    restoreEntities(back, diffEntities(d, removed).map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(d);
    expect(code(() => tx(removed, [{ op: 'remove_asset', args: { assetId } }]))).toBe('not_found');
    expect(code(() => tx(removed, [{ op: 'add_clip', args: { assetId, start: f(0) } }]))).toBe('not_found');
  });
});

describe('track order', () => {
  it('moving a picture track changes what is drawn on top; one undo restores the order; adding or removing another track is not an order change', () => {
    const { fwd: doc, assetId } = project(); // tracks: video, audio (clip at 20..119)
    let r = tx(doc, [{ op: 'add_track', args: { kind: 'video', name: 'top' } }]);
    const top = r.results[0]!.output!.trackId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(20), sourceIn: f(200), duration: f(30), trackId: top, withLinkedAudio: false } }]);
    const base = r.doc;
    const order = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.map((t) => t.name);
    const drawn = (d: ProjectDocument) => evaluate(d, f(30)).layers.filter((l) => l.kind === 'video').map((l: any) => l.sourceFrameIndex);
    expect(drawn(base)).toEqual([60, 210]); // list order: the later track is on top
    const moved = tx(base, [{ op: 'move_track', args: { trackId: top, toIndex: 0 } }]).doc;
    expect(validateProject(moved)).toEqual([]);
    expect(order(moved)[0]).toBe('top');
    expect(drawn(moved)).toEqual([210, 60]);
    const changes = diffEntities(base, moved);
    expect(changes.map((c) => c.id)).toEqual([`order:${base.mainSequenceId}`]);
    const back = structuredClone(moved);
    restoreEntities(back, changes.map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(base);
    // an unrelated track added after the move does not stop the undo from restoring the relative order, and is not itself an order change
    const later = tx(moved, [{ op: 'add_track', args: { kind: 'text', name: 'titles' } }]).doc;
    expect(diffEntities(moved, later).some((c) => c.id.startsWith('order:'))).toBe(false);
    const undone = structuredClone(later);
    restoreEntities(undone, changes.map((x) => ({ id: x.id, state: x.before })));
    expect(drawn(undone)).toEqual([60, 210]);
    expect(order(undone)).toContain('titles');
    expect(validateProject(undone)).toEqual([]);
    expect(code(() => tx(base, [{ op: 'move_track', args: { trackId: top, toIndex: order(base).indexOf('top') } }]))).toBe('invalid_args');
    expect(code(() => tx(base, [{ op: 'move_track', args: { trackId: 'trk_none', toIndex: 0 } }]))).toBe('not_found');
  });
});

