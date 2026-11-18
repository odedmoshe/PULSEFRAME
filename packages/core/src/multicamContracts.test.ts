/**
 * Lead contracts of multicam (ADR-0020), the parts the lead builds itself: the optional schema fields (no version bump), the
 * 'multicamGroup' entity and its exact undo, the registry rows (every operation refuses honestly until W1), the validation of
 * groups and tags, the refusals other edits now raise (remove_asset, remove_motion_track, replace_clip_asset,
 * replace_clip_media), the capture-time priors, syncGrid, the in-place recipe row and the sequence origin member. The bodies of
 * multicam.ts and multicamOps.ts are W1's (multicam.test.ts, multicamOps.test.ts).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, capturePriors, createProject, creativeProjection, describeOps, diffEntities, entityMap, getOp, isInPlaceRecipe, migrateProject, MULTICAM_OPS, MULTICAM_REFUSALS,
  MULTICAM_SYNC_OP, MulticamGroupSchema, MulticamOpArgs, MULTICAM_OPS_BUILT, OpError, planRecipe, ProjectSchema, RecipeError, restoreEntities, SCHEMA_VERSION, SequenceOriginSchema, syncGrid,
  validateProject, type Asset, type Capture, type MediaClip, type MulticamGroup, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `mc${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const camera = (c: string, capture?: Capture): Omit<Asset, 'id'> => ({ kind: 'video', name: `cam-${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(600, 1), video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 18000 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance, ...(capture ? { capture } : {}) });
const recorder = (c: string, capture?: Capture): Omit<Asset, 'id'> => ({ kind: 'audio', name: `mic-${c}.wav`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(620, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance, ...(capture ? { capture } : {}) });
const quality = (verdict: MulticamGroup['angles'][number]['pieces'][number]['quality']['verdict']) => ({ verdict, peakZ: null, peakRatio: null, anchorsUsed: 0, anchorsRejected: 0, residualSamples: null, driftPpm: null, overlapSeconds: null, candidates: [], chainDepth: 0, jobId: null });
const at = (samples: number) => T.rt(samples, 48000);

/** Three files imported (two cameras, one recorder), a picture clip of camera A and a group written by hand as W1's create_multicam + a sync would leave it. */
function setup(captures: (Capture | undefined)[] = []) {
  let r = tx(createProject({ id: 'prj_mc', name: 'MC', width: 1920, height: 1080, frameRate: R }), [
    { op: 'import_asset', args: { asset: camera('a', captures[0]) } },
    { op: 'import_asset', args: { asset: camera('b', captures[1]) } },
    { op: 'import_asset', args: { asset: recorder('c', captures[2]) } },
  ], true);
  const [A, B, MIC] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: A, start: f(0), duration: f(90), withLinkedAudio: false } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  const group: MulticamGroup = {
    id: 'mcg_1', name: 'Podcast', sampleRate: 48000, referenceAngleId: 'ang_mic', wideAngleId: 'ang_a',
    angles: [
      { id: 'ang_mic', label: 'מיקרופון 1', kind: 'sound', pieces: [{ assetId: MIC, anchors: [{ group: T.ZERO, source: T.ZERO }], quality: quality('reference') }] },
      { id: 'ang_a', label: 'מצלמה 1', kind: 'picture', pieces: [{ assetId: A, anchors: [{ group: at(57321), source: T.ZERO }], quality: quality('confident') }] },
      { id: 'ang_b', label: 'מצלמה 2', kind: 'picture', pieces: [{ assetId: B, anchors: [], quality: quality('unsynced') }] },
    ],
    speakers: [{ id: 'spk_1', label: 'מארחת', micAngleId: 'ang_mic', channel: 0, shotAngleId: 'ang_a' }],
    origin: { method: 'test', params: {}, createdAt: '2026-11-18T00:00:00Z', createdBy: 'test', edited: false },
  };
  return { doc: r.doc, A, B, MIC, clipId, group };
}
const withGroup = (doc: ProjectDocument, group: MulticamGroup): ProjectDocument => ({ ...structuredClone(doc), multicam: { [group.id]: structuredClone(group) } });
const tagged = (doc: ProjectDocument, clipId: string, angleId = 'ang_a'): ProjectDocument => {
  const d = structuredClone(doc);
  for (const s of Object.values(d.sequences)) for (const t of s.tracks) for (const c of t.clips) if (c.id === clipId && c.type === 'media') c.multicam = { groupId: 'mcg_1', angleId };
  return d;
};
const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const codes = (doc: ProjectDocument) => validateProject(doc).map((i) => i.code);

describe('multicam schema (ADR-0020): optional fields, no version bump', () => {
  it('stays at the wave-4 version; a project without groups is stored exactly as before (no multicam key, no tag)', () => {
    expect(SCHEMA_VERSION).toBe(3);
    const { doc } = setup();
    expect('multicam' in doc).toBe(false);
    expect(JSON.stringify(migrateProject(JSON.parse(JSON.stringify(doc))))).toBe(JSON.stringify(ProjectSchema.parse(doc)));
    expect('multicam' in migrateProject(JSON.parse(JSON.stringify({ ...doc, multicam: {} })))).toBe(false);
  });
  it('a group and a tag parse; the shape is strict', () => {
    const s = setup();
    const d = tagged(withGroup(s.doc, s.group), s.clipId);
    expect(ProjectSchema.safeParse(d).success).toBe(true);
    expect(validateProject(d)).toEqual([]);
    expect(MulticamGroupSchema.safeParse({ ...s.group, extra: 1 }).success).toBe(false);
    expect(MulticamGroupSchema.safeParse({ ...s.group, angles: [s.group.angles[0]] }).success).toBe(false); // at least two angles
  });
  it('a sequence may carry the multicam origin member; ids in it are informational', () => {
    expect(SequenceOriginSchema.safeParse({ kind: 'multicam', groupId: 'mcg_gone' }).success).toBe(true);
    expect(SequenceOriginSchema.safeParse({ kind: 'multicam', groupId: 'mcg_1', score: 3 }).success).toBe(false);
  });
});

describe('the multicamGroup entity', () => {
  it('is keyed by the group id; restoring the before-state of a first group gives the document back exactly (the map goes too)', () => {
    const s = setup();
    const after = withGroup(s.doc, s.group);
    expect(entityMap(after).get('mcg_1')?.kind).toBe('multicamGroup');
    const changes = diffEntities(s.doc, after);
    expect(changes.map((c) => c.id)).toEqual(['mcg_1']);
    const back = structuredClone(after);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    expect('multicam' in back).toBe(false);
    expect(JSON.stringify(back)).toBe(JSON.stringify(s.doc));
    const redo = structuredClone(back);
    restoreEntities(redo, changes.map((c) => ({ id: c.id, state: c.after })));
    expect(creativeProjection(redo)).toBe(creativeProjection(after));
  });
  it('a correction of one group is one entity change, and undo restores it', () => {
    const s = setup();
    const before = withGroup(s.doc, s.group);
    const after = structuredClone(before);
    after.multicam!.mcg_1!.angles[2]!.label = 'צד';
    const changes = diffEntities(before, after);
    expect(changes.map((c) => c.id)).toEqual(['mcg_1']);
    restoreEntities(after, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(after)).toBe(creativeProjection(before));
  });
});

describe('registry rows', () => {
  it('eight public operations and one internal, version 1, each with its argument schema', () => {
    const pub = describeOps().map((o) => o.name);
    for (const op of MULTICAM_OPS) { expect(pub).toContain(op); expect(getOp(op)!.version).toBe(1); expect(getOp(op)!.args).toBe(MulticamOpArgs[op]); }
    expect(pub).not.toContain(MULTICAM_SYNC_OP);
    expect(getOp(MULTICAM_SYNC_OP)!.internal).toBe(true);
    expect(MULTICAM_OPS_BUILT).toBe(false);
  });
  it('until W1 builds them, every operation refuses with the not-built refusal and changes nothing (an internal one only with allowInternal)', () => {
    const s = setup();
    const d = withGroup(s.doc, s.group);
    const calls: OpCall[] = [
      { op: 'create_multicam', args: { angles: [{ assetIds: [s.A] }, { assetIds: [s.MIC] }] } },
      { op: 'set_multicam_sync', args: { groupId: 'mcg_1', angleId: 'ang_b', pieceIndex: 0, offset: T.rt(1, 1) } },
      { op: 'update_multicam', args: { groupId: 'mcg_1', name: 'x' } },
      { op: 'set_angle_look', args: { groupId: 'mcg_1', angleId: 'ang_a', clear: true } },
      { op: 'place_multicam', args: { groupId: 'mcg_1', at: T.ZERO, angleId: 'ang_a' } },
      { op: 'switch_angles', args: { groupId: 'mcg_1', cuts: [{ at: T.ZERO, angleId: 'ang_b' }] } },
      { op: 'detach_from_multicam', args: { clipIds: [s.clipId] } },
      { op: 'remove_multicam', args: { groupId: 'mcg_1' } },
      { op: 'attach_multicam_sync', args: { groupId: 'mcg_1', createdAt: '2026-11-18T00:00:00Z', method: 'm', params: {}, pieces: [{ angleId: 'ang_b', pieceIndex: 0, anchors: [], quality: quality('ambiguous') }] } },
    ];
    const json = JSON.stringify(d);
    for (const call of calls) {
      const e = refusal(() => tx(d, [call], true));
      expect(e.code, call.op).toBe('unknown_op');
      expect(e.message).toBe(MULTICAM_REFUSALS.notBuilt.message(call.op));
      expect(e.hint).toBe(MULTICAM_REFUSALS.notBuilt.hint);
    }
    expect(refusal(() => tx(d, [calls[8]!])).code).toBe('forbidden_op');
    expect(JSON.stringify(d)).toBe(json);
  });
});

describe('other edits and multicam groups', () => {
  it('remove_asset is refused while a group names the file', () => {
    const s = setup();
    const d = withGroup(s.doc, s.group);
    const e = refusal(() => tx(d, [{ op: 'remove_asset', args: { assetId: s.B } }]));
    expect([e.code, e.message, e.hint]).toEqual(['incompatible', MULTICAM_REFUSALS.assetInGroup.message(1), MULTICAM_REFUSALS.assetInGroup.hint]);
    expect(e.details).toMatchObject({ assetId: s.B, groupIds: ['mcg_1'] });
    // without the group the file goes
    expect(tx(s.doc, [{ op: 'remove_asset', args: { assetId: s.B } }]).doc.assets[s.B]).toBeUndefined();
  });
  it('replace_clip_asset and replace_clip_media refuse a multicam segment (wave 1: no derived copies on angles), naming the clip and the group', () => {
    const s = setup();
    const d = tagged(withGroup(s.doc, s.group), s.clipId);
    for (const call of [{ op: 'replace_clip_asset', args: { clipId: s.clipId, assetId: s.B } }, { op: 'replace_clip_media', args: { clipId: s.clipId, assetId: s.B } }]) {
      const e = refusal(() => tx(d, [call]));
      expect([e.code, e.message, e.hint], call.op).toEqual(['incompatible', MULTICAM_REFUSALS.taggedClip.message(), MULTICAM_REFUSALS.taggedClip.hint]);
      expect(e.details).toMatchObject({ clipId: s.clipId, groupId: 'mcg_1' });
    }
    // an ordinary clip still takes another file
    expect((tx(s.doc, [{ op: 'replace_clip_media', args: { clipId: s.clipId, assetId: s.B } }]).doc.sequences.seq_main!.tracks[0]!.clips[0] as MediaClip).assetId).toBe(s.B);
  });
  it('remove_motion_track is refused, unbind or not, while a file of a group hides a region with it', () => {
    const s = setup();
    let r = tx(s.doc, [{ op: 'create_motion_track', args: { assetId: s.A, kind: 'region', frame: 0, x: 5000, y: 5000, w: 2000, h: 2000 } }]);
    const mt = r.results[0]!.output!.motionTrackId as string;
    const g = structuredClone(s.group);
    g.angles[1]!.pieces[0]!.redact = [{ id: 'rg_1', motionTrackId: mt, shape: 'ellipse', x: 0, y: 0, width: 0.2, height: 0.2, pad: 0.15, feather: 0.01, style: 'blur', strength: 0.8, color: '#000000', onLoss: 'frame', weakIsLost: true }];
    const d = withGroup(r.doc, g);
    expect(validateProject(d)).toEqual([]);
    for (const unbind of [false, true]) {
      const e = refusal(() => tx(d, [{ op: 'remove_motion_track', args: { motionTrackId: mt, unbind } }]));
      expect([e.code, e.message]).toEqual(['incompatible', MULTICAM_REFUSALS.motionTrackInGroup.message(1)]);
    }
    r = tx(r.doc, [{ op: 'remove_motion_track', args: { motionTrackId: mt } }]);
    expect(r.doc.motionTracks[mt]).toBeUndefined();
  });
});

describe('validation of groups and tags (lead rules; the overlap-in-group-time rule is W1\'s)', () => {
  const s = setup();
  // a motion track of camera B, for the region rule
  const withTrack = tx(s.doc, [{ op: 'create_motion_track', args: { assetId: s.B, kind: 'region', frame: 0, x: 5000, y: 5000, w: 2000, h: 2000 } }]);
  const mtB = withTrack.results[0]!.output!.motionTrackId as string;
  const base = tagged(withGroup(withTrack.doc, s.group), s.clipId);
  const mutate = (fn: (d: ProjectDocument) => void) => { const d = structuredClone(base); fn(d); return codes(d); };
  const g = (d: ProjectDocument) => d.multicam!.mcg_1!;
  it.each<[string, (d: ProjectDocument) => void, string]>([
    ['a key that is not its id', (d) => { d.multicam = { mcg_x: g(d) }; }, 'key_mismatch'],
    ['a group id that is another entity\'s', (d) => { const x = g(d); x.id = s.clipId; d.multicam = { [s.clipId]: x }; for (const t of d.sequences.seq_main!.tracks) for (const c of t.clips) if (c.type === 'media') delete c.multicam; }, 'duplicate_id'],
    ['a missing file', (d) => { g(d).angles[2]!.pieces[0]!.assetId = 'ast_gone'; }, 'multicam_asset'],
    ['a sound file as a picture angle', (d) => { g(d).angles[2]!.pieces[0]!.assetId = s.MIC; }, 'multicam_asset'],
    ['a file named twice', (d) => { g(d).angles[2]!.pieces.push(structuredClone(g(d).angles[1]!.pieces[0]!)); }, 'multicam_asset'],
    ['a reference with an offset', (d) => { g(d).angles[0]!.pieces[0]!.anchors = [{ group: at(1), source: T.ZERO }]; }, 'multicam_group'],
    ['a second reference', (d) => { g(d).angles[1]!.pieces[0]!.quality.verdict = 'reference'; }, 'multicam_group'],
    ['an unknown reference angle', (d) => { g(d).referenceAngleId = 'ang_none'; }, 'multicam_group'],
    ['an unplaced verdict with anchors', (d) => { g(d).angles[2]!.pieces[0]!.anchors = [{ group: T.ZERO, source: T.ZERO }]; }, 'multicam_sync'],
    ['a placed verdict without anchors', (d) => { g(d).angles[1]!.pieces[0]!.anchors = []; }, 'multicam_sync'],
    ['an anchor off the sample grid', (d) => { g(d).angles[1]!.pieces[0]!.anchors = [{ group: T.rt(1, 96000), source: T.ZERO }]; }, 'multicam_sync'],
    ['anchors not increasing', (d) => { g(d).angles[1]!.pieces[0]!.anchors = [{ group: at(100), source: at(100) }, { group: at(50), source: at(200) }]; }, 'multicam_sync'],
    ['a slope past 1000 ppm', (d) => { g(d).angles[1]!.pieces[0]!.anchors = [{ group: T.ZERO, source: T.ZERO }, { group: at(48_100_000), source: at(48_000_000) }]; }, 'multicam_sync'],
    ['a wide angle that is a sound angle', (d) => { g(d).wideAngleId = 'ang_mic'; }, 'multicam_group'],
    ['a speaker whose mic has no sound', (d) => { const v = structuredClone(d.assets[s.B]!); delete v.audio; d.assets[s.B] = v; g(d).speakers[0]!.micAngleId = 'ang_b'; }, 'multicam_group'],
    ['a speaker shot on a sound angle', (d) => { g(d).speakers[0]!.shotAngleId = 'ang_mic'; }, 'multicam_group'],
    ['a region of another file\'s motion track', (d) => { g(d).angles[1]!.pieces[0]!.redact = [{ id: 'rg', motionTrackId: mtB, shape: 'ellipse', x: 0, y: 0, width: 0.2, height: 0.2, pad: 0.15, feather: 0.01, style: 'blur', strength: 0.8, color: '#000000', onLoss: 'frame', weakIsLost: true }]; }, 'redact_track'],
    ['a tag naming no group', (d) => { delete d.multicam; }, 'multicam_tag'],
    ['a tag naming an angle of another file', (d) => { for (const t of d.sequences.seq_main!.tracks) for (const c of t.clips) if (c.type === 'media') c.multicam = { groupId: 'mcg_1', angleId: 'ang_b' }; }, 'multicam_tag'],
    ['a sound angle on a video track', (d) => { g(d).angles[0]!.pieces.push({ assetId: s.A, anchors: [{ group: T.ZERO, source: T.ZERO }], quality: quality('manual') }); g(d).angles[1]!.pieces[0]!.assetId = s.B; for (const t of d.sequences.seq_main!.tracks) for (const c of t.clips) if (c.type === 'media') c.multicam = { groupId: 'mcg_1', angleId: 'ang_mic' }; }, 'multicam_tag'],
    ['more groups than allowed', (d) => { for (let i = 2; i <= 9; i++) { const x = structuredClone(g(d)); x.id = `mcg_${i}`; d.multicam![x.id] = x; } }, 'multicam_limit'],
  ])('%s is invalid', (_what, fn, code) => {
    expect(mutate(fn)).toContain(code);
  });
});

describe('capture-time priors (ADR-0021 dates; a prior, never a sync)', () => {
  it('two phones with stated offsets are compared as instants; a phone without a date, or a day only, has no prior', () => {
    const s = setup([
      { at: '2026-06-01T18:00:05', utcOffsetMinutes: 180, source: 'container' },
      { at: '2026-06-01T16:59:58', utcOffsetMinutes: 120, source: 'container' },
      { at: '2026-06-01T18:00:00', utcOffsetMinutes: 180, source: 'container' },
    ]);
    const d = withGroup(s.doc, s.group);
    const p = capturePriors(d, d.multicam!.mcg_1!);
    expect(p.map((x) => [x.angleId, x.why, x.offsetSeconds, x.basis])).toEqual([['ang_mic', 'reference', 0, null], ['ang_a', null, 5, 'utc'], ['ang_b', null, -2, 'utc']]);
    expect(T.eq(p[1]!.offset!, T.rt(5, 1))).toBe(true);
    // stamped when the recording stopped: start = stamp − length (camera 600 s, recorder 620 s)
    expect(p[1]!.endStampedOffsetSeconds).toBe(5 - 600 + 620);
    const none = setup([{ at: '2026-06-01', utcOffsetMinutes: null, source: 'filename', circa: true }, undefined, { at: '2026-06-01T18:00:00', utcOffsetMinutes: null, source: 'exif' }]);
    const dn = withGroup(none.doc, none.group);
    expect(capturePriors(dn, dn.multicam!.mcg_1!).map((x) => x.why)).toEqual(['reference', 'day_only', 'no_capture']);
    const mixed = setup([{ at: '2026-06-01T18:00:05', utcOffsetMinutes: 180, source: 'container' }, undefined, { at: '2026-06-01T18:00:00', utcOffsetMinutes: null, source: 'exif' }]);
    const dm = withGroup(mixed.doc, mixed.group);
    expect(capturePriors(dm, dm.multicam!.mcg_1!)[1]!.why).toBe('mixed_offsets');
  });
});

describe('small fixed parts', () => {
  it('syncGrid is lcm(sampleRate, frame rate numerator)', () => {
    expect(syncGrid(48000, { num: 30, den: 1 })).toBe(48000);
    expect(syncGrid(48000, { num: 30000, den: 1001 })).toBe(240000);
    expect(syncGrid(44100, { num: 24000, den: 1001 })).toBe(3528000);
  });
  it('the auto-switch recipe is in place and refuses honestly until W2 builds its planner', () => {
    expect(isInPlaceRecipe('multicam-auto')).toBe(true);
    expect(isInPlaceRecipe('beat-montage')).toBe(false);
    const s = setup();
    try { planRecipe(withGroup(s.doc, s.group), 'multicam-auto', { groupId: 'mcg_1' }); throw new Error('planned'); } catch (e) { expect(e).toBeInstanceOf(RecipeError); expect((e as RecipeError).code).toBe('not_built'); }
  });
});

describe('W1 bodies (multicam.ts, multicamOps.ts)', () => {
  it.todo('maps, remap, coverage, planPicture/planSound, lookOfClip, multiviewDocument: multicam.test.ts');
  it.todo('the nine operation bodies, their refusals and outputs: multicamOps.test.ts');
  it.todo('validation: the pieces of one angle do not overlap in group time (multicamValidate.ts, needs pieceCoverage)');
});
