/**
 * Lead contracts of the shorts track (ADR-0018), the parts the lead builds itself: schema version 3 with its identity
 * migration, the optional sequence fields, and the output projection (frameOf, projectSequence, projectOutput, outputSafeArea,
 * outputWarnings, sequenceList), plus collectCreated / isLiveCreated. The sequence operations' bodies are W1's
 * (sequenceOps.test.ts); the replay of random op logs through MIGRATIONS[2] is packages/evals/src/schemaV3-replay.test.ts.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, collectCreated, createProject, CREATED_OUTPUT_KEYS, frameOf, isLiveCreated, migrateProject, OutputTargetError, outputSafeArea, outputWarnings,
  projectOutput, projectSequence, ProjectSchema, SCHEMA_VERSION, SequenceFormatSchema, SequenceOriginSchema, SequenceSchema, sequenceList, validateProject,
  type MediaClip, type OpCall, type ProjectDocument, type Sequence, type SequenceFormat, type ShortOrigin,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `sq${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'talk.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(240, 1), video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 7200 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance };
const FORMAT: SequenceFormat = { width: 720, height: 1280, fit: 'cover', profileId: 'vertical-9x16', safeArea: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.12 }, loudness: { target: -14, truePeak: -1 } };
const ORIGIN: ShortOrigin = {
  kind: 'short', assetId: 'ast_1', candidateId: 'cand_0123456789abcdef', excerpt: { start: T.rt(10, 1), end: T.rt(40, 1) }, kept: [{ start: T.rt(10, 1), end: T.rt(40, 1) }],
  score: 74, reasons: [{ code: 'louder_than_usual', sign: 'plus', value: 6, unit: 'dB', at: T.rt(12, 1), quote: 'שלום' }], reframe: 'centre', motionTrackId: null,
  method: 'shorts-rank 1', createdAt: '2026-11-18T00:00:00Z',
};

/** A main edit with a picture (and its linked sound), a title and a marker; and, written by hand as W1's add_sequence would leave it, a short with its own frame, a clip and a marker. */
function twoSequences(): ProjectDocument {
  let r = tx(createProject({ id: 'prj_sq', name: 'SQ', width: 1920, height: 1080, frameRate: R }), [{ op: 'import_asset', args: { asset: video } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(300) } }, { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(60) } }, { op: 'add_marker', args: { time: f(30), label: 'main' } }]);
  const doc = structuredClone(r.doc);
  const main = doc.sequences[doc.mainSequenceId]!;
  const clip = structuredClone(main.tracks[0]!.clips[0]!) as MediaClip;
  const short: Sequence = {
    id: 'seq_short', name: 'Short 1', format: FORMAT, origin: { ...ORIGIN, assetId },
    tracks: [{ id: 'trk_sv', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, clips: [{ ...clip, id: 'clp_short', start: f(0), duration: f(90), linkGroupId: null }] }],
  };
  doc.sequences.seq_short = short;
  doc.markers.mrk_short = { id: 'mrk_short', sequenceId: 'seq_short', time: f(15), label: 'short', color: 'green' };
  return doc;
}

describe('schema version 3 (wave 4: one bump, identity migration)', () => {
  it('new documents are version 3; v1 and v2 documents migrate unchanged apart from the version; a newer one is refused', () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(createProject({ id: 'prj_v', name: 'V' }).schemaVersion).toBe(3);
    const doc = twoSequences();
    for (const from of [1, 2]) {
      const old = { ...JSON.parse(JSON.stringify(doc)), schemaVersion: from };
      expect(ProjectSchema.safeParse(old).success).toBe(false); // only through the migration
      expect(migrateProject(old)).toEqual({ ...old, schemaVersion: 3 });
    }
    expect(() => migrateProject({ ...doc, schemaVersion: 4 })).toThrow(/newer than supported 3/);
  });
  it('every optional field added since v2 survives MIGRATIONS[2] unchanged (people, events, captures, settings.timeline and loudness, provenance.upload, sequence format and origin)', () => {
    const doc = twoSequences();
    const assetId = Object.keys(doc.assets)[0]!;
    doc.assets[assetId]!.capture = { at: '2024-05-01T10:20:30', utcOffsetMinutes: 180, source: 'container' };
    doc.assets[assetId]!.provenance = { origin: 'upload', importedAt: '2026-11-18T00:00:00Z', importedBy: 'phone:drp_1', upload: { via: 'phone', jobId: 'job_1', dropId: 'drp_1' } };
    doc.events = { evt_1: { id: 'evt_1', name: 'יום הולדת', afterSunset: null, assetIds: [assetId], origin: { method: 'gap', gapMinutes: 240, createdBy: 'test', edited: false } } };
    doc.people = { per_1: { id: 'per_1', name: 'נועה', birthDate: '2020-02-29', form: 'f' } };
    doc.settings.loudness = { target: -16, truePeak: -1.5 };
    expect(doc.settings.timeline).toEqual({ mainMagnet: true, rippleDelete: true });
    expect(ProjectSchema.safeParse(doc).success).toBe(true);
    const v2 = { ...JSON.parse(JSON.stringify(doc)), schemaVersion: 2 };
    const back = migrateProject(v2);
    expect(JSON.stringify(back)).toBe(JSON.stringify(ProjectSchema.parse({ ...v2, schemaVersion: 3 })));
    expect(back).toEqual({ ...v2, schemaVersion: 3 });
    // `people: {}` keeps reading as absent, as before the bump
    const empty = migrateProject({ ...v2, people: {} });
    expect('people' in empty).toBe(false);
  });
  it('a sequence without format and origin is stored exactly as before; the fields are strict', () => {
    const plain = { id: 'seq_a', name: 'A', tracks: [] };
    expect(SequenceSchema.parse(plain)).toEqual(plain);
    expect(SequenceSchema.safeParse({ ...plain, format: FORMAT, origin: ORIGIN }).success).toBe(true);
    expect(SequenceFormatSchema.safeParse({ ...FORMAT, frameRate: R }).success).toBe(false); // one frame rate per project
    expect(SequenceFormatSchema.safeParse({ ...FORMAT, loudness: null }).success).toBe(true);
    expect(SequenceFormatSchema.safeParse({ ...FORMAT, loudness: undefined }).success).toBe(true);
    expect(SequenceOriginSchema.safeParse({ ...ORIGIN, candidateId: 'cand_0123' }).success).toBe(false); // 16 hex digits, as fingerprint() gives
    expect(SequenceOriginSchema.safeParse({ ...ORIGIN, score: 101 }).success).toBe(false);
    expect(SequenceOriginSchema.safeParse({ ...ORIGIN, kept: [] }).success).toBe(false);
    expect(SequenceOriginSchema.safeParse({ ...ORIGIN, kind: 'cover' }).success).toBe(false); // wave 2 adds it
    expect(SequenceOriginSchema.safeParse({ ...ORIGIN, reasons: [{ ...ORIGIN.reasons[0], code: 'viral' }] }).success).toBe(false);
  });
});

describe('output projection (ADR-0018, ADR-0005)', () => {
  it('a single-sequence project projects to the same object; frameOf the main sequence is the project frame', () => {
    const doc = createProject({ id: 'prj_one', name: 'One', width: 1920, height: 1080 });
    expect(projectSequence(doc)).toBe(doc);
    expect(projectOutput(doc)).toBe(doc);
    expect(projectOutput(doc, { sequenceId: doc.mainSequenceId })).toBe(doc);
    expect(frameOf(doc)).toEqual({ width: 1920, height: 1080, fit: 'contain' });
    expect(outputSafeArea(doc)).toBeNull();
  });
  it('a short projects alone, made the main one, with its own frame, fit, loudness and only its markers; the stored document is not changed', () => {
    const doc = twoSequences();
    const before = JSON.stringify(doc);
    const p = projectSequence(doc, 'seq_short');
    expect(JSON.stringify(doc)).toBe(before);
    expect(Object.keys(p.sequences)).toEqual(['seq_short']);
    expect(p.mainSequenceId).toBe('seq_short');
    expect(p.settings).toMatchObject({ width: 720, height: 1280, fit: 'cover', loudness: { target: -14, truePeak: -1 }, frameRate: R });
    expect(Object.keys(p.markers)).toEqual(['mrk_short']);
    // the main sequence never carries format or origin, so the projection does not either
    expect(p.sequences.seq_short!.format).toBeUndefined();
    expect(p.sequences.seq_short!.origin).toBeUndefined();
    expect(p.sequences.seq_short!.tracks).toBe(doc.sequences.seq_short!.tracks);
    expect(validateProject(p)).toEqual([]);
    expect(validateProject(doc)).toEqual([]);
    expect(frameOf(doc, 'seq_short')).toEqual({ width: 720, height: 1280, fit: 'cover' });
    expect(frameOf(p)).toEqual({ width: 720, height: 1280, fit: 'cover' });
    expect(outputSafeArea(doc, { sequenceId: 'seq_short' })).toEqual(FORMAT.safeArea);
  });
  it('the main sequence of a multi-sequence project projects without the shorts; settings unchanged', () => {
    const doc = twoSequences();
    const p = projectOutput(doc);
    expect(p).not.toBe(doc);
    expect(Object.keys(p.sequences)).toEqual([doc.mainSequenceId]);
    expect(p.settings).toEqual(doc.settings);
    expect(Object.values(p.markers).map((m) => m.label)).toEqual(['main']);
  });
  it('loudness: absent follows the project, null exports without normalisation', () => {
    const doc = twoSequences();
    doc.settings.loudness = { target: -16, truePeak: -1 };
    const { loudness: _l, ...noLoudness } = FORMAT;
    doc.sequences.seq_short!.format = noLoudness;
    expect(projectSequence(doc, 'seq_short').settings.loudness).toEqual({ target: -16, truePeak: -1 });
    doc.sequences.seq_short!.format = { ...FORMAT, loudness: null };
    expect('loudness' in projectSequence(doc, 'seq_short').settings).toBe(false);
  });
  it('a sequence without a format renders at the project frame', () => {
    const doc = twoSequences();
    delete doc.sequences.seq_short!.format;
    expect(frameOf(doc, 'seq_short')).toEqual({ width: 1920, height: 1080, fit: 'contain' });
    expect(projectSequence(doc, 'seq_short').settings).toEqual(doc.settings);
    expect(outputSafeArea(doc, { sequenceId: 'seq_short' })).toBeNull();
  });
  it('a variant applies over the projected sequence and warns when the sequence has its own frame; unknown targets are refused by own property', () => {
    let doc = twoSequences();
    doc = tx(doc, [{ op: 'add_variant', args: { profileId: 'square-1x1' } }]).doc;
    const variantId = Object.keys(doc.variants)[0]!;
    const p = projectOutput(doc, { sequenceId: 'seq_short', variantId });
    expect(p.settings).toMatchObject({ width: 1080, height: 1080 });
    expect(Object.keys(p.sequences)).toEqual(['seq_short']);
    expect(outputSafeArea(doc, { sequenceId: 'seq_short', variantId })).toEqual(doc.variants[variantId]!.safeArea);
    expect(outputWarnings(doc, { sequenceId: 'seq_short', variantId })).toEqual(['variant_over_sequence_format']);
    expect(outputWarnings(doc, { variantId })).toEqual([]);
    expect(outputWarnings(doc, { sequenceId: 'seq_short' })).toEqual([]);
    for (const sequenceId of ['seq_none', 'constructor', '__proto__', 'toString']) {
      const e = (() => { try { projectOutput(doc, { sequenceId }); } catch (x) { return x; } })();
      expect(e).toBeInstanceOf(OutputTargetError);
      expect((e as OutputTargetError).code).toBe('sequence_not_found');
    }
    for (const id of ['var_none', 'constructor', 'hasOwnProperty']) {
      expect(() => projectOutput(doc, { variantId: id })).toThrow(OutputTargetError);
      expect(outputSafeArea(doc, { variantId: id })).toBeNull();
    }
    expect(frameOf(doc, 'constructor')).toEqual(frameOf(doc));
  });
  it('sequenceList: main first, then the others in document order, with exact durations and whole frames', () => {
    const doc = twoSequences();
    const list = sequenceList(doc);
    expect(list.map((s) => [s.id, s.main, s.origin, s.frames, s.clips])).toEqual([[doc.mainSequenceId, true, null, 300, 3], ['seq_short', false, 'short', 90, 1]]);
    expect(T.eq(list[1]!.duration, f(90))).toBe(true);
    expect(list[1]!.durationSeconds).toBe(3);
    expect(list[1]!.format).toEqual(FORMAT);
    expect(list[0]!.format).toBeNull();
  });
});

describe('created ids (collectCreated, isLiveCreated)', () => {
  it('collects every created-output key, own properties only, and createdClipIds', () => {
    const into: string[] = [];
    collectCreated({ sequenceId: 'seq_1', videoTrackId: 'trk_v', textTrackId: null, audioTrackId: 'trk_a', clipId: 'clp_1', createdClipIds: ['clp_2', 3, 'clp_4'], other: 'x' }, into);
    expect(into).toEqual(['clp_1', 'seq_1', 'trk_v', 'trk_a', 'clp_2', 'clp_4']);
    const inherited = Object.create({ clipId: 'clp_proto' }) as Record<string, unknown>;
    collectCreated(inherited, into);
    collectCreated(undefined, into);
    expect(into).toHaveLength(6);
    expect(CREATED_OUTPUT_KEYS).toContain('sequenceId');
  });
  it('a created id is live while it names a clip, variant, sequence or track', () => {
    const doc = twoSequences();
    for (const id of ['clp_short', 'seq_short', 'trk_sv', doc.sequences[doc.mainSequenceId]!.tracks[0]!.id]) expect(isLiveCreated(doc, id)).toBe(true);
    for (const id of ['clp_gone', 'constructor', '__proto__']) expect(isLiveCreated(doc, id)).toBe(false);
  });
});
