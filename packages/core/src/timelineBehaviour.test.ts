/**
 * The per-project timeline behaviour (settings.timeline, set_timeline_behaviour) and ripple delete (ripple_delete_clips),
 * UX redesign wave A: docs/design/UX_REDESIGN.md §2 decision 6 and §5 "Delete".
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, diffEntities, findClip, LEGACY_TIMELINE, mainTrackOf, migrateProject, NEW_PROJECT_TIMELINE, OpError, ProjectSchema,
  restoreEntities, timelineBehaviour, validateProject, type MediaClip, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const fi = (t: T.RationalTime) => T.frameIndexAt(t, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `tb${n++}_`, actor: 'test', allowInternal });
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'8'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(30, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };

/** The undo path the server takes: the entity diff of the step, applied backwards. */
const undo = (before: ProjectDocument, after: ProjectDocument) => {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  return back;
};

/**
 * V1: A 0..60, B 60..120, C 120..180, a gap, D 200..230, each with its linked sound on A1 at the same times.
 * A2: music 0..300. T1: a title 100..140. A marker at 150.
 */
function edit(timeline?: null) {
  let r = tx(createProject({ id: 'prj_tb', name: 'TB', width: 640, height: 360, frameRate: R, ...(timeline === null ? { timeline } : {}) }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: song } }], true);
  const vid = r.results[0]!.output!.assetId as string, mus = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: vid, start: f(0), sourceIn: f(0), duration: f(60) } },
    { op: 'add_clip', args: { assetId: vid, start: f(60), sourceIn: f(100), duration: f(60) } },
    { op: 'add_clip', args: { assetId: vid, start: f(120), sourceIn: f(200), duration: f(60) } },
    { op: 'add_clip', args: { assetId: vid, start: f(200), sourceIn: f(300), duration: f(30) } },
    { op: 'add_text', args: { text: 'כותרת', start: f(100), duration: f(40) } },
    { op: 'add_marker', args: { time: f(150), label: 'here' } },
  ]);
  const pic = (i: number) => (r.results[i]!.output as any).clipId as string, snd = (i: number) => (r.results[i]!.output as any).audioClipId as string;
  const ids = { A: pic(0), a: snd(0), B: pic(1), b: snd(1), C: pic(2), c: snd(2), D: pic(3), d: snd(3), title: pic(4) };
  const a1 = findClip(r.doc, ids.a)!.track.id;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: mus, start: f(0), duration: f(300) } }]);
  return { doc: r.doc, ids: { ...ids, music: (r.results[0]!.output as any).clipId as string }, a1, v1: mainTrackOf(r.doc)!.id, mus };
}
const at = (d: ProjectDocument, id: string) => { const c = findClip(d, id); return c ? [fi(c.clip.start), fi(T.add(c.clip.start, c.clip.duration))] : null; };

describe('settings.timeline: the per-project editing behaviour', () => {
  it('new projects start with the magnet and ripple delete on; a document without the field reads as both off and stays without it', () => {
    const fresh = createProject({ id: 'prj_new', name: 'new' });
    expect(fresh.settings.timeline).toEqual(NEW_PROJECT_TIMELINE);
    expect(timelineBehaviour(fresh)).toEqual({ mainMagnet: true, rippleDelete: true });
    expect(ProjectSchema.parse(fresh).settings.timeline).toEqual({ mainMagnet: true, rippleDelete: true });
    const old = createProject({ id: 'prj_old', name: 'old', timeline: null });
    expect('timeline' in old.settings).toBe(false);
    expect(timelineBehaviour(old)).toEqual(LEGACY_TIMELINE);
    // a stored document of before the field: it migrates and parses as it was (no field, both off)
    const stored = JSON.parse(JSON.stringify(old));
    const back = migrateProject(stored);
    expect('timeline' in back.settings).toBe(false);
    expect(JSON.stringify(back)).toBe(JSON.stringify(ProjectSchema.parse(stored)));
    // the field is strict
    expect(ProjectSchema.safeParse({ ...fresh, settings: { ...fresh.settings, timeline: { mainMagnet: true } } }).success).toBe(false);
    expect(ProjectSchema.safeParse({ ...fresh, settings: { ...fresh.settings, timeline: { mainMagnet: true, rippleDelete: false, snap: true } } }).success).toBe(false);
    expect(createProject({ id: 'prj_x', name: 'x', timeline: { mainMagnet: false, rippleDelete: true } }).settings.timeline).toEqual({ mainMagnet: false, rippleDelete: true });
  });

  it('set_timeline_behaviour changes what it is given, keeps the rest, and one undo restores the document exactly (also the absent field)', () => {
    const doc = createProject({ id: 'prj_s', name: 's', timeline: null });
    const r = tx(doc, [{ op: 'set_timeline_behaviour', args: { mainMagnet: true } }]);
    expect(r.doc.settings.timeline).toEqual({ mainMagnet: true, rippleDelete: false });
    expect(r.affectedIds).toEqual([doc.id]);
    expect(r.results[0]!.output).toEqual({ timeline: { mainMagnet: true, rippleDelete: false } });
    const r2 = tx(r.doc, [{ op: 'set_timeline_behaviour', args: { rippleDelete: true } }]);
    expect(r2.doc.settings.timeline).toEqual({ mainMagnet: true, rippleDelete: true });
    const r3 = tx(r2.doc, [{ op: 'set_timeline_behaviour', args: { mainMagnet: false, rippleDelete: false } }]);
    expect(r3.doc.settings.timeline).toEqual({ mainMagnet: false, rippleDelete: false });
    expect(validateProject(r3.doc)).toEqual([]);
    for (const [before, after] of [[doc, r.doc], [r.doc, r2.doc], [r2.doc, r3.doc]] as const) expect(JSON.stringify(undo(before, after))).toBe(JSON.stringify(before));
    expect('timeline' in undo(doc, r.doc).settings).toBe(false);
    const e = refusal(() => tx(doc, [{ op: 'set_timeline_behaviour', args: {} }]));
    expect([e.code, e.message]).toEqual(['invalid_args', 'nothing to change: give mainMagnet or rippleDelete']);
    expect(refusal(() => tx(doc, [{ op: 'set_timeline_behaviour', args: { mainMagnet: 'yes' } as any }])).code).toBe('invalid_args');
  });

  it('no operation reads it: the same edits give the same timeline with the behaviour on, off or absent', () => {
    const { doc: on, ids } = edit();
    const absent = structuredClone(on); delete absent.settings.timeline;
    const off = tx(on, [{ op: 'set_timeline_behaviour', args: { mainMagnet: false, rippleDelete: false } }]).doc;
    const ops: OpCall[] = [{ op: 'delete_clip', args: { clipId: ids.B } }, { op: 'move_clip', args: { clipId: ids.D, start: f(240) } }, { op: 'ripple_delete_clips', args: { clipIds: [ids.A] } }, { op: 'duplicate_clips', args: { clipIds: [ids.C], offset: f(200) } }];
    const run = (d: ProjectDocument) => { const x = structuredClone(applyTransaction(d, ops, { idSeed: 'same_', actor: 'test' }).doc); delete x.settings.timeline; return creativeProjection(x); };
    expect(run(off)).toBe(run(on));
    expect(run(absent)).toBe(run(on));
  });
});

describe('ripple_delete_clips: delete and close the gap', () => {
  it('closes the gap on the main track; linked sound follows its picture; music, titles, markers and old gaps stay; one undo restores it all', () => {
    const { doc, ids, v1, a1 } = edit();
    const r = tx(doc, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.B] } }]);
    const d = r.doc;
    expect(validateProject(d)).toEqual([]);
    expect(at(d, ids.B)).toBeNull();
    expect(at(d, ids.b)).toBeNull();
    expect([ids.A, ids.C, ids.D].map((id) => at(d, id))).toEqual([[0, 60], [60, 120], [140, 170]]);
    expect([ids.a, ids.c, ids.d].map((id) => at(d, id))).toEqual([[0, 60], [60, 120], [140, 170]]);
    expect(at(d, ids.music)).toEqual([0, 300]);
    expect(at(d, ids.title)).toEqual([100, 140]);
    expect(Object.values(d.markers).map((m) => fi(m.time))).toEqual([150]);
    // the moved clips show what they showed (source unchanged) and stay linked
    for (const id of [ids.C, ids.c, ids.D, ids.d]) expect(fi((findClip(d, id)!.clip as MediaClip).sourceIn)).toBe(fi((findClip(doc, id)!.clip as MediaClip).sourceIn));
    expect((findClip(d, ids.C)!.clip as MediaClip).linkGroupId).toBe((findClip(d, ids.c)!.clip as MediaClip).linkGroupId);
    const out = r.results[0]!.output as any;
    expect(out.deletedClipIds.sort()).toEqual([ids.B, ids.b].sort());
    expect(out.movedClipIds.sort()).toEqual([ids.C, ids.c, ids.D, ids.d].sort());
    expect(out.unlinkedClipIds).toEqual([]);
    expect(out.closed).toEqual([{ trackId: v1, removed: f(60) }]);
    expect(r.summary).toBe('Deleted 2 clip(s) and closed the gap; 4 clip(s) moved earlier');
    expect(findClip(d, ids.c)!.track.id).toBe(a1);
    expect(creativeProjection(undo(doc, d))).toBe(creativeProjection(doc));
  });

  it('several clips at once, in any order and with repeats; deleting the last clip moves nothing', () => {
    const { doc, ids } = edit();
    const d = tx(doc, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.C, ids.A, ids.C, ids.a] } }]).doc;
    expect([ids.B, ids.D].map((id) => at(d, id))).toEqual([[0, 60], [80, 110]]);
    expect([ids.b, ids.d].map((id) => at(d, id))).toEqual([[0, 60], [80, 110]]);
    expect(validateProject(d)).toEqual([]);
    const last = tx(doc, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.D] } }]);
    expect((last.results[0]!.output as any).movedClipIds).toEqual([]);
    expect(last.summary).toBe('Deleted 2 clip(s) and closed the gap');
  });

  it('a title or caption track closes up the same way when one of its clips is named; the main track then stays', () => {
    const { doc, ids } = edit();
    let r = tx(doc, [{ op: 'add_text', args: { text: 'שנייה', start: f(160), duration: f(20) } }]);
    const second = r.results[0]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.title] } }]);
    expect(at(r.doc, second)).toEqual([120, 140]);
    expect(at(r.doc, ids.C)).toEqual([120, 180]);
  });

  it('refuses honestly and leaves the document as it was', () => {
    const { doc, ids, a1 } = edit();
    const json = JSON.stringify(doc);
    // a locked track under a clip that would go
    const locked = tx(doc, [{ op: 'update_track', args: { trackId: a1, locked: true } }]).doc;
    const e1 = refusal(() => tx(locked, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.B] } }]));
    expect([e1.code, e1.message]).toEqual(['track_locked', `linked clip ${ids.b} is on locked track ${a1}`]);
    // the picture alone: its sound stays, and the next sound would slide over it
    const e2 = refusal(() => tx(doc, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.B], includeLinked: false } }]));
    expect([e2.code, e2.message]).toEqual(['overlap', `closing the gap would put clip ${ids.c} over clip ${ids.b} on track ${a1}`]);
    // the sound alone: the next picture would land on the picture that stays
    const e3 = refusal(() => tx(doc, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.b], includeLinked: false } }]));
    expect(e3.code).toBe('overlap');
    expect(e3.message).toMatch(new RegExp(`^closing the gap would put clip ${ids.C} over clip ${ids.B} on track `));
    // two closing tracks that would move a linked pair by different amounts
    const r = tx(doc, [{ op: 'move_clips', args: { clipIds: [ids.C, ids.D], delta: f(40) } }, { op: 'add_clip', args: { assetId: Object.keys(doc.assets).find((k) => doc.assets[k]!.kind === 'audio')!, start: f(125), duration: f(10), trackId: a1 } }]);
    const x = (r.results[1]!.output as any).clipId as string;
    const e4 = refusal(() => tx(r.doc, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.B, x] } }]));
    expect(e4.code).toBe('incompatible');
    expect(e4.message).toMatch(/^linked clips \S+ and \S+ would move by different amounts$/);
    const e5 = refusal(() => tx(doc, [{ op: 'ripple_delete_clips', args: { clipIds: ['clp_none'] } }]));
    expect([e5.code, e5.message]).toEqual(['not_found', 'clip clp_none not found']);
    expect(refusal(() => tx(doc, [{ op: 'ripple_delete_clips', args: { clipIds: [] } }])).code).toBe('invalid_args');
    expect(JSON.stringify(doc)).toBe(json);
  });

  it('a sound that starts before its picture (a J-cut) moves with it and keeps its offset; one that would go before 0 is refused, not left to the final check', () => {
    const { doc, ids, a1 } = edit();
    // J-cut into B: A's sound ends at 50, B's sound starts at 50, ten frames before its picture (still linked)
    const j = tx(doc, [{ op: 'trim_clip', args: { clipId: ids.a, edge: 'end', to: f(50), includeLinked: false } }, { op: 'trim_clip', args: { clipId: ids.b, edge: 'start', to: f(50), includeLinked: false } }]).doc;
    expect(validateProject(j)).toEqual([]);
    expect((findClip(j, ids.B)!.clip as MediaClip).linkGroupId).toBe((findClip(j, ids.b)!.clip as MediaClip).linkGroupId);
    const json = JSON.stringify(j);
    // deleting A would move B by 60 and its sound to -10
    const e = refusal(() => tx(j, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.A] } }]));
    expect([e.code, e.message]).toEqual(['out_of_bounds', `closing the gap would place clip ${ids.b} before 0`]);
    expect(e.details).toMatchObject({ clipId: ids.b, trackId: a1 });
    expect(JSON.stringify(j)).toBe(json);
    // the same J-cut one clip later: deleting A moves C and its sound together and keeps the ten frames
    const j2 = tx(doc, [{ op: 'trim_clip', args: { clipId: ids.b, edge: 'end', to: f(110), includeLinked: false } }, { op: 'trim_clip', args: { clipId: ids.c, edge: 'start', to: f(110), includeLinked: false } }]).doc;
    const d = tx(j2, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.A] } }]).doc;
    expect(validateProject(d)).toEqual([]);
    expect([at(d, ids.C), at(d, ids.c)]).toEqual([[60, 120], [50, 120]]);
    expect(creativeProjection(undo(j2, d))).toBe(creativeProjection(j2));
    // and deleting A and B would put C's sound at -10: refused the same way
    expect(refusal(() => tx(j2, [{ op: 'ripple_delete_clips', args: { clipIds: [ids.A, ids.B] } }])).message).toBe(`closing the gap would place clip ${ids.c} before 0`);
  });

  it('property: with a sound that starts before its picture, every ripple delete keeps each picture with its sound at the same offset, or is refused with the reason', () => {
    for (let seed = 1; seed < 16; seed++) {
      const { doc, ids, a1 } = edit();
      // C's sound starts at 110, ten frames before C; B's sound ends there
      const j = tx(doc, [{ op: 'trim_clip', args: { clipId: ids.b, edge: 'end', to: f(110), includeLinked: false } }, { op: 'trim_clip', args: { clipId: ids.c, edge: 'start', to: f(110), includeLinked: false } }]).doc;
      const pics = [ids.A, ids.B, ids.C, ids.D], snds = [ids.a, ids.b, ids.c, ids.d];
      const pick = pics.filter((_, i) => (seed >> i) & 1);
      const has = (id: string) => pick.includes(id);
      // what is expected: C's sound would go to -10 when A and B both go; it would land on A's sound (0..60) when only B goes before it
      const expected = has(ids.C) || !has(ids.B) ? null : has(ids.A) ? ['out_of_bounds', `closing the gap would place clip ${ids.c} before 0`] : ['overlap', `closing the gap would put clip ${ids.c} over clip ${ids.a} on track ${a1}`];
      let d: ProjectDocument;
      try { d = tx(j, [{ op: 'ripple_delete_clips', args: { clipIds: pick } }]).doc; } catch (e) {
        expect(e).toBeInstanceOf(OpError);
        expect([(e as OpError).code, (e as OpError).message]).toEqual(expected);
        continue;
      }
      expect(expected).toBeNull();
      expect(validateProject(d)).toEqual([]);
      for (const [i, p] of pics.entries()) {
        if (has(p)) continue;
        expect(at(d, snds[i]!)![0]! - at(d, p)![0]!).toBe(at(j, snds[i]!)![0]! - at(j, p)![0]!);
      }
      expect(creativeProjection(undo(j, d))).toBe(creativeProjection(j));
    }
  });

  it('property: any ripple delete of any set of main-track clips leaves no gap where they were and keeps every picture with its sound', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { doc, ids } = edit();
      const pics = [ids.A, ids.B, ids.C, ids.D];
      const pick = pics.filter((_, i) => (seed >> i) & 1);
      if (!pick.length) continue;
      const before = pics.map((id) => at(doc, id)!);
      const d = tx(doc, [{ op: 'ripple_delete_clips', args: { clipIds: pick } }]).doc;
      expect(validateProject(d)).toEqual([]);
      for (const [i, id] of pics.entries()) {
        if (pick.includes(id)) { expect(at(d, id)).toBeNull(); continue; }
        const removed = pics.filter((p, k) => pick.includes(p) && before[k]![1]! <= before[i]![0]!).reduce((s, p) => s + (before[pics.indexOf(p)]![1]! - before[pics.indexOf(p)]![0]!), 0);
        expect(at(d, id)).toEqual([before[i]![0]! - removed, before[i]![1]! - removed]);
      }
      for (const [p, s] of [[ids.A, ids.a], [ids.B, ids.b], [ids.C, ids.c], [ids.D, ids.d]] as const) expect(at(d, s)).toEqual(at(d, p));
      expect(creativeProjection(undo(doc, d))).toBe(creativeProjection(doc));
    }
  });
});
