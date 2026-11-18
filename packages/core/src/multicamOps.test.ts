/**
 * The multicam operations (ADR-0020 W1; multicamOps.ts): create, sync by hand and measured, update, looks, place, switch,
 * detach, remove; switching after any edit, drift, heal, coverage, transitions, the look that travels with the angle, exact
 * undo at a thousand cuts, the change cap, and the refusals other edits raise on multicam segments.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, creativeProjection, diffEntities, groupGrid, groupTimeAt, masterGroupTimeAt, migrateProject, MULTICAM_REFUSALS, MAX_TOUCHED_ENTITIES, ProjectSchema, remapSource, SCHEMA_VERSION,
  validateProject, type Clip, type MediaClip, type MulticamGroup, type OpCall, type ProjectDocument, type SwitchAnglesOutput, type PlaceMulticamOutput,
} from './index.ts';
import { camera, podcast, project, R30, recorder, refusal, samples, tx, type Podcast } from './multicam.testFixture.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const f = (k: number) => T.frameTime(k, R30);
const sec = (s: number) => T.rt(s, 1);
const group = (d: ProjectDocument, id: string): MulticamGroup => d.multicam![id]!;
const clipsOf = (d: ProjectDocument, trackId: string): MediaClip[] => Object.values(d.sequences).flatMap((s) => s.tracks).find((t) => t.id === trackId)!.clips as MediaClip[];
const clip = (d: ProjectDocument, id: string) => Object.values(d.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === id) as MediaClip | undefined;
/** The podcast laid from group 10 s to 400 s at timeline 0 on camera A, with the recorder as sound. */
function program(p: Podcast = podcast(), args: Record<string, unknown> = {}) {
  const r = tx(p.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camA, range: { from: sec(10), to: sec(400) }, ...args } }]);
  return { ...p, doc: r.doc, out: r.results[0]!.output as unknown as PlaceMulticamOutput };
}
const sw = (doc: ProjectDocument, args: Record<string, unknown>, idSeed?: string) => { const r = idSeed ? applyTransaction(doc, [{ op: 'switch_angles', args }], { idSeed, actor: 'test' }) : tx(doc, [{ op: 'switch_angles', args }]); return { doc: r.doc, out: r.results[0]!.output as unknown as SwitchAnglesOutput, affected: r.affectedIds }; };

describe('create_multicam', () => {
  it('the reference piece 0 gets {0,0} and verdict reference, the rest unsynced; labels «מצלמה N» / «מיקרופון N»; the sample rate is the project\'s', () => {
    const { doc, ids } = project([camera('a.mp4', 60), recorder('m.wav', 60), camera('b.mp4', 60)]);
    const r = tx(doc, [{ op: 'create_multicam', args: { angles: [{ assetIds: [ids[0]!] }, { assetIds: [ids[1]!] }, { assetIds: [ids[2]!], label: 'צד' }] } }]);
    const out = r.results[0]!.output as { groupId: string; angleIds: string[]; referenceAngleId: string };
    const g = group(r.doc, out.groupId);
    expect(g.angles.map((a) => [a.label, a.kind, a.pieces[0]!.quality.verdict, a.pieces[0]!.anchors.length])).toEqual([['מצלמה 1', 'picture', 'unsynced', 0], ['מיקרופון 1', 'sound', 'reference', 1], ['צד', 'picture', 'unsynced', 0]]);
    expect(out.referenceAngleId).toBe(out.angleIds[1]); // group time follows the first sound recorder
    expect(g.sampleRate).toBe(48000);
    expect(validateProject(r.doc)).toEqual([]);
    expect(r.affectedIds).toEqual([out.groupId]);
  });
  it('refusals: a file named twice, a silent file as a mic, a reference index past the angles, more than the cap of groups', () => {
    const { doc, ids } = project([camera('a.mp4', 60, R30, false), recorder('m.wav', 60)]);
    expect(refusal(() => tx(doc, [{ op: 'create_multicam', args: { angles: [{ assetIds: [ids[0]!] }, { assetIds: [ids[0]!] }] } }])).message).toBe(MULTICAM_REFUSALS.assetTwice.message(ids[0]!));
    expect(refusal(() => tx(doc, [{ op: 'create_multicam', args: { angles: [{ assetIds: [ids[0]!], kind: 'sound' }, { assetIds: [ids[1]!] }] } }])).message).toBe(MULTICAM_REFUSALS.angleKind.message(ids[0]!, 'sound'));
    expect(refusal(() => tx(doc, [{ op: 'create_multicam', args: { angles: [{ assetIds: [ids[0]!] }, { assetIds: [ids[1]!] }], referenceAngleIndex: 5 } }])).code).toBe('invalid_args');
    let d = doc;
    for (let i = 0; i < 8; i++) d = tx(d, [{ op: 'create_multicam', args: { angles: [{ assetIds: [ids[0]!] }, { assetIds: [ids[1]!] }] } }]).doc;
    // a file may be in several groups; the ninth group is refused
    expect(refusal(() => tx(d, [{ op: 'create_multicam', args: { angles: [{ assetIds: [ids[0]!] }, { assetIds: [ids[1]!] }] } }])).message).toBe(MULTICAM_REFUSALS.tooManyGroups.message());
  });
});

describe('sync by hand and measured', () => {
  it('set_multicam_sync on the reference is refused; exactly one form; verdict manual and origin.edited', () => {
    const p = podcast();
    expect(refusal(() => tx(p.doc, [{ op: 'set_multicam_sync', args: { groupId: p.groupId, angleId: p.mic, pieceIndex: 0, offset: sec(1) } }])).message).toBe(MULTICAM_REFUSALS.referenceFixed.message());
    expect(refusal(() => tx(p.doc, [{ op: 'set_multicam_sync', args: { groupId: p.groupId, angleId: p.camA, pieceIndex: 0, offset: sec(1), clear: true } }])).message).toBe(MULTICAM_REFUSALS.syncForm.message());
    expect(refusal(() => tx(p.doc, [{ op: 'set_multicam_sync', args: { groupId: p.groupId, angleId: p.camA, pieceIndex: 0, offset: T.rt(1, 96000) } }])).message).toBe(MULTICAM_REFUSALS.anchorOffSample.message(48000));
    expect(refusal(() => tx(p.doc, [{ op: 'set_multicam_sync', args: { groupId: p.groupId, angleId: p.camA, pieceIndex: 0, anchors: [{ group: T.ZERO, source: T.ZERO }, { group: samples(48_100_000), source: samples(48_000_000) }] } }])).message).toBe(MULTICAM_REFUSALS.driftTooLarge.message());
    const g = group(p.doc, p.groupId);
    expect(g.angles[1]!.pieces[0]!.quality.verdict).toBe('manual');
    expect(g.origin.edited).toBe(true);
    const cleared = tx(p.doc, [{ op: 'set_multicam_sync', args: { groupId: p.groupId, angleId: p.camB, pieceIndex: 0, clear: true } }]).doc;
    expect(group(cleared, p.groupId).angles[2]!.pieces[0]).toMatchObject({ anchors: [], quality: { verdict: 'unsynced' } });
    // an unsynced angle cannot be nudged or laid
    expect(refusal(() => tx(cleared, [{ op: 'set_multicam_sync', args: { groupId: p.groupId, angleId: p.camB, pieceIndex: 0, nudge: f(1) } }])).message).toBe(MULTICAM_REFUSALS.notSynced.message('מצלמה 2'));
    expect(refusal(() => tx(cleared, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camB } }])).message).toBe(MULTICAM_REFUSALS.notSynced.message('מצלמה 2'));
  });
  it('remapping on a nudge keeps group time: the program segments follow the correction', () => {
    const p = program();
    const before = p.doc, grid = groupGrid(before, group(before, p.groupId));
    const r = tx(before, [{ op: 'set_multicam_sync', args: { groupId: p.groupId, angleId: p.camA, pieceIndex: 0, nudge: f(2) } }]);
    const remapped = (r.results[0]!.output as { remappedClipIds: string[] }).remappedClipIds;
    expect(remapped.length).toBeGreaterThan(0);
    for (const id of remapped) {
      const a = clip(before, id)!, b = clip(r.doc, id)!;
      // the file now plays 2 frames later against the reference, so the same group time is 2 frames earlier in its source
      expect(T.eq(b.sourceIn, T.sub(a.sourceIn, f(2)))).toBe(true);
      expect(T.eq(remapSource(group(before, p.groupId).angles[1]!.pieces[0]!, group(r.doc, p.groupId).angles[1]!.pieces[0]!, a.sourceIn, grid), b.sourceIn)).toBe(true);
    }
    for (const t of [f(30), f(3000)]) expect(T.eq(groupTimeAt(r.doc, p.out.sequenceId, p.out.videoTrackId, t)!.g, groupTimeAt(before, p.out.sequenceId, p.out.videoTrackId, t)!.g)).toBe(true);
  });
  it('attach_multicam_sync (internal) keeps a hand-synced file unless overwrite, and stores measured maps', () => {
    const p = podcast();
    const call = (overwrite?: boolean): OpCall => ({ op: 'attach_multicam_sync', args: { groupId: p.groupId, createdAt: '2026-11-18T00:00:00Z', method: 'test', params: { peakZ: 12 }, pieces: [{ angleId: p.camA, pieceIndex: 0, anchors: [{ group: samples(57601), source: T.ZERO }], quality: { verdict: 'confident', peakZ: 14, peakRatio: 2, anchorsUsed: 3, anchorsRejected: 0, residualSamples: 10, driftPpm: 0, overlapSeconds: 590, candidates: [], chainDepth: 0, jobId: 'job_x' } }], ...(overwrite ? { overwrite } : {}) } });
    const e = refusal(() => tx(p.doc, [call()], true));
    expect([e.message, e.details.why]).toEqual([MULTICAM_REFUSALS.wouldDiscardManual.message('מצלמה 1'), 'would_discard_edits']);
    const d = tx(p.doc, [call(true)], true).doc;
    expect(group(d, p.groupId).angles[1]!.pieces[0]!.quality.verdict).toBe('confident');
    expect(group(d, p.groupId).origin).toMatchObject({ method: 'test', createdBy: 'test', edited: true }); // camera B is still synced by hand
  });
});

describe('update_multicam and set_angle_look', () => {
  it('update: names, wide angle, speakers (ids made), and their refusals', () => {
    const p = podcast();
    const r = tx(p.doc, [{ op: 'update_multicam', args: { groupId: p.groupId, name: 'ראיון', wideAngleId: p.camB, angles: [{ angleId: p.camA, label: 'מארחת' }], speakers: [{ label: 'מארחת', micAngleId: p.mic, channel: 0, shotAngleId: p.camA }] } }]);
    const g = group(r.doc, p.groupId);
    expect([g.name, g.wideAngleId, g.angles[1]!.label, g.speakers.length]).toEqual(['ראיון', p.camB, 'מארחת', 1]);
    expect(refusal(() => tx(p.doc, [{ op: 'update_multicam', args: { groupId: p.groupId } }])).message).toBe(MULTICAM_REFUSALS.nothingToUpdate.message());
    expect(refusal(() => tx(p.doc, [{ op: 'update_multicam', args: { groupId: p.groupId, wideAngleId: p.mic } }])).message).toBe(MULTICAM_REFUSALS.wideNotPicture.message('מיקרופון 1'));
    expect(refusal(() => tx(p.doc, [{ op: 'update_multicam', args: { groupId: p.groupId, speakers: [{ label: 'x', micAngleId: 'ang_none', channel: null, shotAngleId: null }] } }])).message).toBe(MULTICAM_REFUSALS.speakerMic.message('x'));
  });
  it('set_angle_look from a segment: the angle takes its look, its file the privacy regions; apply unedited leaves hand-edited segments', () => {
    const p = program();
    let d = p.doc;
    const first = sw(d, { groupId: p.groupId, cuts: [{ at: f(300), angleId: p.camB }, { at: f(600), angleId: p.camA }, { at: f(900), angleId: p.camB }, { at: f(1200), angleId: p.camA }] });
    const [s1, s2] = first.out.switchedClipIds as [string, string];
    d = first.doc;
    const mt = tx(d, [{ op: 'create_motion_track', args: { assetId: p.files.b, kind: 'region', frame: 0, x: 5000, y: 5000, w: 2000, h: 2000 } }]);
    d = tx(mt.doc, [{ op: 'set_clip_transform', args: { clipId: s1, transform: { scale: 1.3 } } }, { op: 'set_redact_region', args: { clipId: s1, region: { motionTrackId: mt.results[0]!.output!.motionTrackId as string } } }]).doc;
    const r = tx(d, [{ op: 'set_angle_look', args: { groupId: p.groupId, angleId: p.camB, fromClipId: s1 } }]);
    const out = r.results[0]!.output as { appliedClipIds: string[]; keptClipIds: string[] };
    expect(out.appliedClipIds.sort()).toEqual([s1, s2].sort());
    expect(clip(r.doc, s2)!.transform.scale).toBe(1.3);
    expect(clip(r.doc, s2)!.redact!.map((x) => x.motionTrackId)).toEqual(clip(r.doc, s1)!.redact!.map((x) => x.motionTrackId));
    const B = group(r.doc, p.groupId).angles[2]!;
    expect([B.look!.transform.scale, B.pieces[0]!.redact!.length]).toEqual([1.3, 1]);
    // a hand-edited segment keeps its look under 'unedited'
    const edited = tx(d, [{ op: 'set_clip_transform', args: { clipId: s2, transform: { x: 0.2 } } }]).doc;
    const r2 = tx(edited, [{ op: 'set_angle_look', args: { groupId: p.groupId, angleId: p.camB, fromClipId: s1 } }]);
    expect((r2.results[0]!.output as { keptClipIds: string[] }).keptClipIds).toEqual([s2]);
    expect(refusal(() => tx(d, [{ op: 'set_angle_look', args: { groupId: p.groupId, angleId: p.camA, fromClipId: s1 } }])).message).toBe(MULTICAM_REFUSALS.notThisAngle.message(s1, 'מצלמה 1'));
    expect(refusal(() => tx(d, [{ op: 'set_angle_look', args: { groupId: p.groupId, angleId: p.mic, clear: true } }])).message).toBe(MULTICAM_REFUSALS.soundAngleLook.message('מיקרופון 1'));
    // clear removes the look and the file's regions; apply all restores the default framing
    const cleared = tx(r.doc, [{ op: 'set_angle_look', args: { groupId: p.groupId, angleId: p.camB, clear: true, apply: 'all' } }]).doc;
    expect(group(cleared, p.groupId).angles[2]!.look).toBeUndefined();
    expect([clip(cleared, s2)!.transform.scale, clip(cleared, s2)!.redact]).toEqual([1, undefined]);
  });
});

describe('place_multicam', () => {
  it('lays tagged picture segments on a new video track and the recorder on a new sound track, frame-aligned, valid', () => {
    const p = program();
    expect(validateProject(p.doc)).toEqual([]);
    const v = clipsOf(p.doc, p.out.videoTrackId), a = clipsOf(p.doc, p.out.soundTrackIds[0]!);
    expect(v.every((c) => c.multicam?.angleId === p.camA && c.multicam.groupId === p.groupId)).toBe(true);
    expect(a.map((c) => c.multicam?.angleId)).toEqual([p.mic]);
    expect(T.eq(a[0]!.sourceIn, sec(10))).toBe(true); // the recorder is the reference: group time = its source time
    expect(T.eq(v[0]!.sourceIn, T.sub(sec(10), T.rt(57600, 48000)))).toBe(true); // camera A's source 0 plays at 1.2 s
    expect(p.out.createdClipIds.length).toBe(v.length + a.length);
    expect([p.out.soundChunks, p.out.maxSoundErrorSeconds, p.out.uncovered]).toEqual([0, 0, []]);
  });
  it('in a new sequence with the multicam origin; refusals for a sound angle, a busy track, a new sequence with a track, a range under one frame', () => {
    const p = podcast();
    const r = tx(p.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camB, newSequence: { name: 'תוכנית' } } }]);
    const out = r.results[0]!.output as unknown as PlaceMulticamOutput;
    expect(r.doc.sequences[out.sequenceId]!.origin).toEqual({ kind: 'multicam', groupId: p.groupId });
    expect(out.filled.map((x) => x.angleId)).toEqual([p.camA]); // camera A covers 1.2–2.5 s, before camera B starts
    expect(out.uncovered.map((u) => [T.toSeconds(T.normalize(u.start)), T.toSeconds(T.normalize(u.end))])).toEqual([[0, 1.2], [602.5, 620]]); // and after both cameras end, while the recorder runs on
    expect(refusal(() => tx(p.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.mic } }])).code).toBe('incompatible');
    expect(refusal(() => tx(p.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camA, newSequence: { name: 'x' }, trackId: 'trk_video' } }])).message).toBe(MULTICAM_REFUSALS.newSequenceAndTrack.message());
    const busy = tx(p.doc, [{ op: 'add_clip', args: { assetId: p.files.a, start: T.ZERO, duration: f(10), withLinkedAudio: false } }]).doc;
    expect(refusal(() => tx(busy, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camA, trackId: 'trk_video' } }])).message).toBe(MULTICAM_REFUSALS.trackNotEmpty.message('trk_video'));
    expect(refusal(() => tx(p.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camA, range: { from: sec(5), to: T.rt(501, 100) } } }])).code).toBe('invalid_args');
  });
});

describe('switching after edits', () => {
  it('after 50 seeded random edits (cut_range, insert_gap, close_gaps, delete_transcript_range, trim_clip, split_clip, slip_clip), each switched sourceIn equals remapSource(...) exactly; picture and master sound agree within 1 sample at 20 probes', () => {
    const p = program();
    // words of the recorder, so delete_transcript_range has something to cut
    const words = Array.from({ length: 200 }, (_, i) => ({ text: `מילה${i}`, start: T.rt(10 * 1 + i * 18, 10), duration: T.rt(6, 10) }));
    let d = tx(p.doc, [{ op: 'set_transcript', args: { assetId: p.files.mic, language: 'he', segments: [{ start: words[0]!.start, duration: T.rt(3610, 10), text: words.map((w) => w.text).join(' '), words }] } }]).doc;
    const rnd = mulberry32(2026), int = (k: number) => Math.floor(rnd() * k);
    const V = p.out.videoTrackId, A = p.out.soundTrackIds[0]!;
    const pairOf = (dd: ProjectDocument, c: Clip) => clipsOf(dd, A).find((x) => T.eq(x.start, c.start) && T.eq(x.duration, c.duration));
    let done = 0;
    for (let step = 0; done < 50 && step < 500; step++) {
      const vs = clipsOf(d, V), c = vs[int(vs.length)]!, pair = c && pairOf(d, c);
      const kind = int(7);
      let ops: OpCall[] = [];
      if (kind === 0) { const s = int(9000); ops = [{ op: 'cut_range', args: { start: f(s), end: f(s + 1 + int(200)) } }]; }
      else if (kind === 1) ops = [{ op: 'insert_gap', args: { at: f(int(9000)), duration: f(1 + int(60)) } }];
      else if (kind === 2) ops = [{ op: 'close_gaps', args: {} }];
      else if (kind === 3) { const tr = d.transcripts[p.files.mic]!.segments.flatMap((s) => s.words); if (tr.length < 2) continue; const i = int(tr.length - 1); ops = [{ op: 'delete_transcript_range', args: { assetId: p.files.mic, fromWordId: tr[i]!.id, toWordId: tr[i + int(2)]!.id } }]; }
      else if (!pair) continue;
      else if (kind === 4) { const to = T.add(c.start, f(1 + int(Math.max(1, T.frameIndexAt(c.duration, R30) - 1)))); ops = [{ op: 'trim_clip', args: { clipId: c.id, edge: 'end', to } }, { op: 'trim_clip', args: { clipId: pair.id, edge: 'end', to } }]; }
      else if (kind === 5) { const n = T.frameIndexAt(c.duration, R30); if (n < 2) continue; const at = T.add(c.start, f(1 + int(n - 1))); ops = [{ op: 'split_clip', args: { clipId: c.id, at } }, { op: 'split_clip', args: { clipId: pair.id, at } }]; }
      else { const by = f(int(21) - 10 || 1); ops = [{ op: 'slip_clip', args: { clipId: c.id, by } }, { op: 'slip_clip', args: { clipId: pair.id, by } }]; }
      try { d = tx(d, ops).doc; done++; } catch { /* a refused edit (nothing that far, nothing to close) is not counted */ }
    }
    expect(done).toBe(50);
    const before = d;
    const g = group(before, p.groupId), grid = groupGrid(before, g);
    const end = T.frameIndexAt(clipsOf(before, V).reduce((m, c) => T.max(m, T.add(c.start, c.duration)), T.ZERO), R30);
    const cuts = Array.from({ length: 12 }, (_, i) => ({ at: f(Math.floor(((i + 0.5) / 12) * end)), angleId: i % 2 ? p.camA : p.camB }));
    const r = sw(before, { groupId: p.groupId, cuts, coverage: 'clip', until: { at: f(end) } });
    expect(r.out.switchedClipIds.length).toBeGreaterThan(5);
    for (const id of r.out.switchedClipIds) {
      const now = clip(r.doc, id)!;
      const was = clipsOf(before, V).find((c) => T.lte(c.start, now.start) && T.lt(now.start, T.add(c.start, c.duration)))!;
      const from = g.angles.find((x) => x.id === was.multicam!.angleId)!.pieces[0]!, to = g.angles.find((x) => x.id === now.multicam!.angleId)!.pieces[0]!;
      expect(T.eq(now.sourceIn, remapSource(from, to, T.add(was.sourceIn, T.sub(now.start, was.start)), grid))).toBe(true);
    }
    let probes = 0;
    for (let i = 0; i < 400 && probes < 20; i++) {
      const t = f(int(end));
      const pic = groupTimeAt(r.doc, p.out.sequenceId, V, t), snd = masterGroupTimeAt(r.doc, p.out.sequenceId, p.groupId, t);
      if (!pic || !snd) continue;
      probes++;
      expect(Math.abs(T.toSeconds(T.sub(pic.g, snd))) * 48000).toBeLessThanOrEqual(1);
    }
    expect(probes).toBe(20);
  });
});

describe('switch_angles', () => {
  it('cut order does not change the result; re-applying the same op changes 0 entities', () => {
    const p = program();
    const cuts = [{ at: f(90), angleId: p.camB }, { at: f(400), angleId: p.camA }, { at: f(700), groupTime: undefined, angleId: p.camB }].map(({ groupTime: _g, ...c }) => c);
    const a = sw(p.doc, { groupId: p.groupId, cuts }, 'same_'), b = sw(p.doc, { groupId: p.groupId, cuts: [...cuts].reverse() }, 'same_');
    expect(creativeProjection(a.doc)).toBe(creativeProjection(b.doc));
    const again = sw(a.doc, { groupId: p.groupId, cuts });
    expect(diffEntities(a.doc, again.doc)).toEqual([]);
    expect(again.out.skipped.every((s) => s.reason === 'already_on_angle')).toBe(true);
    // a group-time cut lands where that group time is now
    const g = groupTimeAt(p.doc, p.out.sequenceId, p.out.videoTrackId, f(90))!.g;
    expect(creativeProjection(sw(p.doc, { groupId: p.groupId, cuts: [{ groupTime: g, angleId: p.camB }, ...cuts.slice(1)] }, 'same_').doc)).toBe(creativeProjection(a.doc));
  });
  it('heal produces the minimum number of segments; the last cut on a frame wins', () => {
    const p = program();
    const one = clipsOf(p.doc, p.out.videoTrackId).length;
    const there = sw(p.doc, { groupId: p.groupId, cuts: [{ at: f(100), angleId: p.camB }, { at: f(200), angleId: p.camB }, { at: f(300), angleId: p.camA }] });
    expect(clipsOf(there.doc, p.out.videoTrackId).length).toBe(one + 2); // A | B (healed from two spans) | A
    const back = sw(there.doc, { groupId: p.groupId, cuts: [{ at: f(100), angleId: p.camA }] , until: { at: f(300) } });
    expect(clipsOf(back.doc, p.out.videoTrackId).length).toBe(one); // one A segment again
    expect(creativeProjection(back.doc)).toBe(creativeProjection(p.doc));
    const same = sw(p.doc, { groupId: p.groupId, cuts: [{ at: f(100), angleId: p.camA }, { at: f(100), angleId: p.camB }], until: { at: f(200) } });
    expect(same.out.cuts.map((c) => c.angleId)).toEqual([p.camB]);
    expect(same.out.skipped.map((s) => s.reason)).toEqual(['same_frame']);
  });
  it('coverage refuse names {coveredFrom, coveredTo}; clip reports what was skipped', () => {
    // camera B ends at group 300 s: the program runs to 400 s
    const p = program(podcast({ anchorsB: [{ group: sec(-300), source: T.ZERO }] }));
    const e = refusal(() => sw(p.doc, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.camB }] }));
    expect(e.code).toBe('range_not_covered');
    expect(e.message).toBe(MULTICAM_REFUSALS.notCovering.message('מצלמה 2', 300, 400));
    expect(e.details).toMatchObject({ angleId: p.camB, coveredFrom: { value: '-300', timescale: 1 }, coveredTo: { value: '300', timescale: 1 } });
    const r = sw(p.doc, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.camB }], coverage: 'clip' });
    expect(r.out.skipped.map((s) => [s.reason, T.toSeconds(s.at!)])).toEqual([['not_covered', 290]]);
    expect(clipsOf(r.doc, p.out.videoTrackId).map((c) => c.multicam!.angleId)).toEqual([p.camB, p.camA]);
  });
  it('a piece boundary splits the segment', () => {
    const { doc, ids } = project([recorder('mic.wav', 700), camera('a.mp4', 600), camera('b1.mp4', 200), camera('b2.mp4', 400)]);
    let r = tx(doc, [{ op: 'create_multicam', args: { angles: [{ assetIds: [ids[0]!] }, { assetIds: [ids[1]!] }, { assetIds: [ids[2]!, ids[3]!] }] } }]);
    const { groupId, angleIds } = r.results[0]!.output as { groupId: string; angleIds: string[] };
    r = tx(r.doc, [
      { op: 'set_multicam_sync', args: { groupId, angleId: angleIds[1]!, pieceIndex: 0, offset: T.ZERO } },
      { op: 'set_multicam_sync', args: { groupId, angleId: angleIds[2]!, pieceIndex: 0, offset: T.ZERO } },
      { op: 'set_multicam_sync', args: { groupId, angleId: angleIds[2]!, pieceIndex: 1, offset: sec(200) } },
      { op: 'place_multicam', args: { groupId, at: T.ZERO, angleId: angleIds[1]!, range: { from: T.ZERO, to: sec(500) } } },
    ]);
    const V = (r.results[3]!.output as unknown as PlaceMulticamOutput).videoTrackId;
    const s = sw(r.doc, { groupId, cuts: [{ at: f(0), angleId: angleIds[2]! }] });
    expect(clipsOf(s.doc, V).map((c) => [c.assetId, T.toSeconds(c.start), T.toSeconds(c.sourceIn)])).toEqual([[ids[2], 0, 0], [ids[3], 200, 0]]);
    // the two files of one angle may not overlap in group time
    expect(refusal(() => tx(r.doc, [{ op: 'set_multicam_sync', args: { groupId, angleId: angleIds[2]!, pieceIndex: 1, offset: sec(150) } }])).code).toBe('incompatible');
  });
  it('a transition handle that is too short refuses with maxFrames and the clip id', () => {
    // camera B ends at group 400 s = timeline 390 s; a dissolve at 390 s reads the previous clip's source after its end
    const p = program(podcast({ anchorsB: [{ group: sec(-200), source: T.ZERO }] }), { range: { from: sec(10), to: sec(500) } });
    const at = f(390 * 30);
    let d = tx(p.doc, [{ op: 'split_clip', args: { clipId: clipsOf(p.doc, p.out.videoTrackId)[0]!.id, at } }]).doc;
    const right = clipsOf(d, p.out.videoTrackId)[1]!;
    d = tx(d, [{ op: 'set_transition', args: { clipId: right.id, type: 'dissolve', frames: 10 } }]).doc;
    const e = refusal(() => sw(d, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.camB }], until: { at } }));
    expect([e.code, e.details.maxFrames, e.details.clipId]).toEqual(['out_of_bounds', 0, right.id]);
  });
  it('reversed, ramped and linked segments are skipped with their reason', () => {
    const p = program();
    const V = p.out.videoTrackId;
    let d = p.doc;
    for (const k of [300, 600, 900]) d = tx(d, [{ op: 'split_clip', args: { clipId: clipsOf(d, V).at(-1)!.id, at: f(k) } }]).doc;
    const [, rev, ramp, linked] = clipsOf(d, V);
    const extra = tx(d, [{ op: 'add_clip', args: { assetId: p.files.mic, start: linked!.start, sourceIn: sec(50), duration: linked!.duration } }]);
    d = tx(extra.doc, [{ op: 'set_clip_reverse', args: { clipId: rev!.id, reverse: true } }, { op: 'set_clip_speed_ramp', args: { clipId: ramp!.id, from: 1, to: 1.5 } }, { op: 'link_clips', args: { clipIds: [linked!.id, extra.results[0]!.output!.clipId as string] } }]).doc;
    // the ramp plays faster, so it is shorter and leaves a gap: the switch is given an end past it
    const r = sw(d, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.camB }], until: { at: f(390 * 30) } });
    expect(r.out.skipped.map((s) => [s.clipId, s.reason])).toEqual([[rev!.id, 'reversed'], [ramp!.id, 'ramped'], [undefined, 'gap'], [linked!.id, 'linked']]);
    expect(clipsOf(r.doc, V).map((c) => c.multicam!.angleId)).toEqual([p.camB, p.camA, p.camA, p.camA]);
  });
  it('A\'s privacy region ids never appear on a B segment, and redaction_missing is warned; opacity keys are kept, x/y/scale/rotation keys dropped and reported', () => {
    const p = program();
    const id = clipsOf(p.doc, p.out.videoTrackId)[0]!.id;
    const mt = tx(p.doc, [{ op: 'create_motion_track', args: { assetId: p.files.a, kind: 'region', frame: 0, x: 5000, y: 5000, w: 2000, h: 2000 } }]);
    const d = tx(mt.doc, [
      { op: 'set_redact_region', args: { clipId: id, region: { motionTrackId: mt.results[0]!.output!.motionTrackId as string } } },
      { op: 'set_keyframe', args: { clipId: id, property: 'opacity', time: f(0), value: 0.5 } },
      { op: 'set_keyframe', args: { clipId: id, property: 'scale', time: f(0), value: 1.5 } },
    ]).doc;
    const regionIds = clip(d, id)!.redact!.map((x) => x.id);
    const r = sw(d, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.camB }], until: { at: f(300) } });
    const b = clip(r.doc, id)!;
    expect(b.multicam!.angleId).toBe(p.camB);
    expect(JSON.stringify(b)).not.toMatch(new RegExp(regionIds.join('|')));
    expect(b.redact).toBeUndefined();
    expect(r.out.warnings).toEqual([{ code: 'redaction_missing', clipIds: [id] }]);
    expect(b.keyframes!.opacity!.length).toBe(1);
    expect(b.keyframes!.scale).toBeUndefined();
    expect(r.out.dropped).toEqual([{ clipId: id, what: 'keyframes' }]);
  });
  it('variantTransforms replace per-clip overrides (the replaced override is reported)', () => {
    const p = program();
    let d = tx(p.doc, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }]).doc;
    const variantId = Object.keys(d.variants)[0]!;
    const s = sw(d, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.camB }, { at: f(300), angleId: p.camA }] });
    const b = s.out.switchedClipIds[0]!;
    d = tx(s.doc, [{ op: 'set_variant_override', args: { variantId, clipId: b, transform: { x: 0.3 } } }, { op: 'set_angle_look', args: { groupId: p.groupId, angleId: p.camB, fromClipId: b } }]).doc;
    const aId = clipsOf(d, p.out.videoTrackId)[1]!.id;
    d = tx(d, [{ op: 'set_variant_override', args: { variantId, clipId: aId, transform: { x: -0.1 } } }]).doc;
    const r = sw(d, { groupId: p.groupId, cuts: [{ at: f(300), angleId: p.camB }], until: { at: f(600) } });
    expect(d.variants[variantId]!.overrides[aId]!.transform).toEqual({ x: -0.1 });
    expect(r.doc.variants[variantId]!.overrides[b]!.transform).toEqual({ x: 0.3 });
    expect(r.out.dropped).toEqual([{ clipId: b, what: 'variant_transform' }]); // healed into the earlier B segment
  });
  it('refusals: no program, a sound angle, an unknown angle, both at and groupTime', () => {
    const p = podcast();
    expect(refusal(() => sw(p.doc, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.camB }] })).message).toBe(MULTICAM_REFUSALS.noProgram.message());
    const q = program(p);
    expect(refusal(() => sw(q.doc, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.mic }] })).code).toBe('incompatible');
    expect(refusal(() => sw(q.doc, { groupId: p.groupId, cuts: [{ at: f(0), angleId: 'ang_x' }] })).message).toBe(MULTICAM_REFUSALS.angleNotFound.message('ang_x', p.groupId));
    expect(refusal(() => sw(q.doc, { groupId: p.groupId, cuts: [{ at: f(0), groupTime: sec(1), angleId: p.camB }] })).message).toBe(MULTICAM_REFUSALS.pointForm.message());
    const two = tx(q.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camB, range: { from: sec(10), to: sec(20) } } }]).doc;
    expect(refusal(() => sw(two, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.camB }] })).message).toBe(MULTICAM_REFUSALS.ambiguousTrack.message(2));
  });
});

describe('undo and limits', () => {
  it('a 1000-cut switch_angles followed by restore_entities of its before-states gives an identical creativeProjection; the time for 1000 cuts on a 60-minute program is printed', () => {
    const p = podcast({ seconds: 3700 });
    const placed = tx(p.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camA, range: { from: sec(10), to: sec(3610) } } }]).doc;
    const rnd = mulberry32(99);
    const frames = new Set<number>();
    while (frames.size < 1000) frames.add(1 + Math.floor(rnd() * (3600 * 30 - 2)));
    const cuts = [...frames].map((k, i) => ({ at: f(k), angleId: i % 2 ? p.camA : p.camB }));
    const t0 = performance.now();
    const r = sw(placed, { groupId: p.groupId, cuts });
    const ms = performance.now() - t0;
    console.log(`switch_angles: 1000 cuts on a 60-minute program in ${ms.toFixed(0)} ms (target < 500 ms${ms < 500 ? '' : ': MISSED'})`);
    const changes = diffEntities(placed, r.doc);
    expect(changes.length).toBe(r.affected.length);
    expect(changes.length).toBeLessThanOrEqual(5000);
    const back = tx(r.doc, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.before })) } }], true).doc;
    expect(creativeProjection(back)).toBe(creativeProjection(placed));
  }, 120_000);
  it('the too_many_changes boundary holds at 4500', () => {
    const p = program();
    const V = p.out.videoTrackId;
    // the program as 4600 one-frame segments of camera A
    const d = structuredClone(p.doc);
    const track = d.sequences[p.out.sequenceId]!.tracks.find((t) => t.id === V)!;
    const first = track.clips[0] as MediaClip;
    track.clips = Array.from({ length: 4600 }, (_, k) => ({ ...structuredClone(first), id: `clp_one${k}`, start: f(k), duration: f(1), sourceIn: T.add(first.sourceIn, f(k)) }));
    expect(validateProject(d)).toEqual([]);
    const ok = sw(d, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.camB }], until: { at: f(MAX_TOUCHED_ENTITIES) } });
    expect(ok.affected.length).toBe(4500);
    expect(diffEntities(d, ok.doc).length).toBe(4500);
    const e = refusal(() => sw(d, { groupId: p.groupId, cuts: [{ at: f(0), angleId: p.camB }], until: { at: f(MAX_TOUCHED_ENTITIES + 1) } }));
    expect([e.code, e.message, e.details.why]).toEqual(['out_of_bounds', MULTICAM_REFUSALS.tooManyChanges.message(4501), 'too_many_changes']);
  }, 120_000);
});

describe('other rules', () => {
  it('remove_asset and replace_clip_asset refuse a file and a segment of a group', () => {
    const p = program();
    const id = clipsOf(p.doc, p.out.videoTrackId)[0]!.id;
    expect(refusal(() => tx(p.doc, [{ op: 'remove_asset', args: { assetId: p.files.b } }])).message).toBe(MULTICAM_REFUSALS.assetInGroup.message(1));
    expect(refusal(() => tx(p.doc, [{ op: 'replace_clip_asset', args: { clipId: id, assetId: p.files.b } }])).message).toBe(MULTICAM_REFUSALS.taggedClip.message());
  });
  it('remove_multicam: refused while segments use the group, unless detach; detach_from_multicam; undo restores the group', () => {
    const p = program();
    const n = p.out.createdClipIds.length;
    expect(refusal(() => tx(p.doc, [{ op: 'remove_multicam', args: { groupId: p.groupId } }])).message).toBe(MULTICAM_REFUSALS.tagsExist.message(n));
    const r = tx(p.doc, [{ op: 'remove_multicam', args: { groupId: p.groupId, detach: true } }]);
    expect('multicam' in r.doc).toBe(false);
    expect(Object.values(r.doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).some((c) => c.type === 'media' && c.multicam)).toBe(false);
    const changes = diffEntities(p.doc, r.doc);
    const back = tx(r.doc, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.before })) } }], true).doc;
    expect(creativeProjection(back)).toBe(creativeProjection(p.doc));
    const id = p.out.createdClipIds[0]!;
    const det = tx(p.doc, [{ op: 'detach_from_multicam', args: { clipIds: [id] } }]).doc;
    expect(clip(det, id)!.multicam).toBeUndefined();
    expect(refusal(() => tx(det, [{ op: 'detach_from_multicam', args: { clipIds: [id] } }])).message).toBe(MULTICAM_REFUSALS.notTagged.message(id));
    // an empty group goes without detach
    const empty = podcast();
    expect('multicam' in tx(empty.doc, [{ op: 'remove_multicam', args: { groupId: empty.groupId } }]).doc).toBe(false);
  });
  it('a v2 document migrates to v3 with only its version changed', () => {
    const p = program();
    expect(SCHEMA_VERSION).toBe(3);
    const v2 = { ...JSON.parse(JSON.stringify(p.doc)), schemaVersion: 2 };
    const v3 = migrateProject(structuredClone(v2));
    expect(JSON.stringify(v3)).toBe(JSON.stringify(ProjectSchema.parse({ ...v2, schemaVersion: 3 }))); // nothing but the version
    expect(v3.schemaVersion).toBe(3);
    expect(creativeProjection(v3)).toBe(creativeProjection(p.doc));
  });
  it('every validate rule rejects a crafted bad document, the overlap of two files of one angle included', () => {
    const p = program();
    const bad = (fn: (d: ProjectDocument) => void) => { const d = structuredClone(p.doc); fn(d); return validateProject(d).map((i) => i.code); };
    const g = (d: ProjectDocument) => d.multicam![p.groupId]!;
    // two files of camera B overlapping in group time
    const { doc, ids } = project([recorder('m.wav', 100), camera('b1.mp4', 50), camera('b2.mp4', 50)]);
    let r = tx(doc, [{ op: 'create_multicam', args: { angles: [{ assetIds: [ids[0]!] }, { assetIds: [ids[1]!, ids[2]!] }] } }]);
    const { groupId, angleIds } = r.results[0]!.output as { groupId: string; angleIds: string[] };
    r = tx(r.doc, [{ op: 'set_multicam_sync', args: { groupId, angleId: angleIds[1]!, pieceIndex: 0, offset: T.ZERO } }, { op: 'set_multicam_sync', args: { groupId, angleId: angleIds[1]!, pieceIndex: 1, offset: sec(50) } }]);
    expect(validateProject(r.doc)).toEqual([]);
    const overlap = structuredClone(r.doc);
    overlap.multicam![groupId]!.angles[1]!.pieces[1]!.anchors = [{ group: sec(40), source: T.ZERO }];
    expect(validateProject(overlap).map((i) => i.code)).toContain('multicam_sync');
    expect(bad((d) => { g(d).angles[0]!.pieces[0]!.anchors = [{ group: samples(1), source: T.ZERO }]; })).toContain('multicam_group');
    expect(bad((d) => { g(d).angles[1]!.pieces[0]!.anchors = []; })).toContain('multicam_sync');
    expect(bad((d) => { g(d).angles[1]!.pieces[0]!.anchors = [{ group: T.rt(1, 96000), source: T.ZERO }]; })).toContain('multicam_sync');
    expect(bad((d) => { g(d).wideAngleId = p.mic; })).toContain('multicam_group');
    expect(bad((d) => { const c = d.sequences[p.out.sequenceId]!.tracks.find((t) => t.id === p.out.videoTrackId)!.clips[0] as MediaClip; c.multicam = { groupId: p.groupId, angleId: p.mic }; })).toContain('multicam_tag');
    expect(bad((d) => { const c = d.sequences[p.out.sequenceId]!.tracks.find((t) => t.id === p.out.videoTrackId)!.clips[0] as MediaClip; c.multicam = { groupId: 'mcg_gone', angleId: p.camA }; })).toContain('multicam_tag');
    expect(bad((d) => { g(d).angles[1]!.pieces[0]!.assetId = p.files.mic; })).toContain('multicam_asset');
  });
});
