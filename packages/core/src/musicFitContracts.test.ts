/**
 * The musicfit track's contract in core (wave 7; .artifacts/wave7/musicfit-decisions.md): the exact layout of built-in music (the
 * default is byte-for-byte today's), the two optional fields and their validation, the moment's fate when a clip's file changes, the
 * licence rule of a shortened library song and its credit line, the language assistant's exclusion, the honest "not built" state of
 * the four operations, the stubs and the template's exact ending. The it.todo rows name what builders A and B must make pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, assistantOps, ASSISTANT_EXCLUDED_OPS, collectCredits, createProject, cutStats, exactLayoutFor, findTemplate, fitLicenceProblem, fittedLibraryRecord, FIT_METHOD,
  fittedGrid, getOp, listOps, MODIFIED_LINE, MUSIC_STYLES, musicAt, musicEndingSteps, MusicFitNotBuilt, MUSICFIT_OPS_BUILT, MUSICFIT_PUBLIC_OPS, MUSICFIT_INTERNAL_OPS, MUSICFIT_REFUSALS, musicLayout,
  musicProvenanceParams, OpError, orderCandidates, planImpact, planMusicSwap, planTemplate, ProjectSchema, sampleFramesFor, TEMPLATES, validateProject, maxMusicBars,
  type Asset, type LibraryRecord, type MediaClip, type ProjectDocument,
} from './index.ts';
import type { PlaceMulticamOutput } from './index.ts';
import { podcast } from './multicam.testFixture.ts';

const R = { num: 30, den: 1 };
const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const video = (id: string, n: number): Asset => ({ id, kind: 'video', name: `${id}.mp4`, contentHash: hash(n), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(300, R), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov });
const sound = (id: string, n: number, over: Partial<Asset> = {}): Asset => ({ id, kind: 'audio', name: `${id}.wav`, contentHash: hash(n), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov, ...over });
let seed = 0;
const tx = (doc: ProjectDocument, ops: { op: string; args: unknown }[]) => applyTransaction(doc, ops, { idSeed: `mf${seed++}_`, actor: 'test', allowInternal: true });
const clipsOf = (doc: ProjectDocument) => Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).filter((c): c is MediaClip => c.type === 'media');
const record = (over: Partial<LibraryRecord> = {}): LibraryRecord => ({ itemId: 'src-a/song.wav', sourceId: 'src-a', kind: 'music', title: 'Song A', sourceSha256: 'a'.repeat(64), ledger: { item: 'src-a' }, licence: { id: 'CC-BY-4.0' }, credit: { text: '"Song A" by Someone, CC BY 4.0', placement: 'description' }, flags: {}, ...over });
const fitted = (sourceAssetId: string) => ({ sourceAssetId, method: FIT_METHOD, startAt: T.ZERO, removed: { from: T.rt(8, 1), to: T.rt(24, 1) }, crossfade: T.rt(40, 1000), joinAt: T.rt(8, 1), measured: { similarity: 0.9, levelStepDb: 0.4, phraseBars: 4 as const, tempoSpreadMs: 2, beatConfidence: null } });

describe('built-in music: exact layout (decisions §2.2)', () => {
  it('without endFrames, and with an ending of one bar, every layout is today\'s: length, beats, bars, sections, params', () => {
    for (const s of MUSIC_STYLES) for (const bars of [s.minBars, 7, 16, 33, maxMusicBars(s)]) {
      const spb = 2_880_000 / s.bpm;
      const a = musicLayout(s.id, bars), b = musicLayout(s.id, bars, 4 * spb);
      expect(a).toEqual(b);
      expect(a.totalFrames).toBe(bars * 4 * spb);
      expect(a.endFrames).toBe(4 * spb);
      expect(a.duration).toEqual(T.normalize(T.rt(240 * bars, s.bpm)));
      expect(a.beats.length).toBe(4 * bars);
      expect(a.beats[a.beats.length - 1]).toEqual(T.normalize(T.rt(60 * (4 * bars - 1), s.bpm)));
      expect(Object.keys(musicProvenanceParams(a, 3))).toEqual(['bars', 'seed', 'bpm', 'meter', 'synth']);
    }
  });
  it('an exact ending: (bars − 1) whole bars and endFrames; beats k·spb < totalFrames; the ending section starts at (bars − 1)·bar; params.end', () => {
    const l = musicLayout('music.birthday', 10, 2.5 * 24000); // 120 BPM: spb 24,000
    expect(l.totalFrames).toBe(9 * 96000 + 60000);
    expect(l.duration).toEqual(T.normalize(T.rt(l.totalFrames, 48000)));
    expect(l.beats.length).toBe(36 + 3); // beats at 0 … 38 spb: 38·24000 = 912,000 < 924,000
    expect(l.beats.every((b) => T.lt(b, l.duration))).toBe(true);
    expect(l.sections[l.sections.length - 1]).toMatchObject({ kind: 'ending', startBar: 9, bars: 1 });
    expect(musicProvenanceParams(l, 1)).toEqual({ bars: 10, seed: 1, bpm: 120, meter: 4, synth: 1, end: 60000 });
  });
  it('refuses an ending shorter than two or longer than six beats, a fraction of a frame, and a track over five minutes', () => {
    expect(() => musicLayout('music.birthday', 10, 47_999)).toThrow(RangeError);
    expect(() => musicLayout('music.birthday', 10, 144_001)).toThrow(RangeError);
    expect(() => musicLayout('music.birthday', 10, 60_000.5)).toThrow(RangeError);
    expect(() => musicLayout('music.birthday', 151, 48_000)).toThrow(/at most 300 s/);
  });
  it('exactLayoutFor gives K + 1 bars and an ending of 2 to under 6 beats that add up to the length exactly', () => {
    for (const s of MUSIC_STYLES) for (const seconds of [15, 17.37, 29.97, 40, 64.1]) { // the slowest style needs 3 bars and 2 beats (11.7 s) at least
      const L = sampleFramesFor(T.rt(Math.round(seconds * 1000), 1000));
      const spb = 2_880_000 / s.bpm;
      const { bars, endFrames } = exactLayoutFor(s.id, L);
      expect(musicLayout(s.id, bars, endFrames).totalFrames).toBe(L);
      expect(endFrames).toBeGreaterThanOrEqual(2 * spb);
      expect(endFrames).toBeLessThan(6 * spb);
    }
    expect(() => exactLayoutFor('music.cinematic', sampleFramesFor(T.rt(5, 1)))).toThrow(RangeError);
    expect(() => exactLayoutFor('music.calm', sampleFramesFor(T.rt(301, 1)))).toThrow(RangeError);
  });
  it('sampleFramesFor rounds up: 1921 frames at 30000/1001 fps are 1922921/30000 s', () => {
    expect(sampleFramesFor(T.frameTime(1921, { num: 30000, den: 1001 }))).toBe(Math.ceil((1922921 / 30000) * 48000));
    expect(sampleFramesFor(T.rt(1, 1))).toBe(48000);
  });
});

describe('the two optional fields', () => {
  it('a clip may carry impact; validation refuses it on a still, a freeze frame, before 0 and past the file', () => {
    let doc = tx(createProject({ id: 'prj_mi', name: 'I' }), []).doc;
    doc.assets.ast_v = video('ast_v', 1);
    doc = tx(doc, [{ op: 'add_clip', args: { assetId: 'ast_v', start: T.ZERO, withLinkedAudio: false } }]).doc;
    const clip = clipsOf(doc)[0]!;
    const withImpact = (t: T.RationalTime) => { const d = structuredClone(doc); clipsOf(d)[0]!.impact = t; return d; };
    expect(ProjectSchema.safeParse(withImpact(T.rt(3, 1))).success).toBe(true);
    expect(validateProject(withImpact(T.rt(3, 1))).filter((i) => i.code === 'clip_impact')).toEqual([]);
    expect(validateProject(withImpact(T.rt(11, 1))).map((i) => i.code)).toContain('clip_impact');
    expect(validateProject(withImpact(T.rt(-1, 30))).map((i) => i.code)).toContain('clip_impact');
    const frozen = withImpact(T.rt(3, 1)); clipsOf(frozen)[0]!.freeze = true;
    expect(validateProject(frozen).map((i) => i.code)).toContain('clip_impact');
    void clip;
  });
  it('a shortened song is a derived sound file; validation checks its stretch, crossfade and join', () => {
    const doc = createProject({ id: 'prj_mf', name: 'F' });
    doc.assets.ast_s = sound('ast_s', 2);
    doc.assets.ast_f = sound('ast_f', 3, { provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'test', fitted: fitted('ast_s') } });
    expect(ProjectSchema.safeParse(doc).success).toBe(true);
    expect(validateProject(doc).filter((i) => i.code === 'fitted_provenance')).toEqual([]);
    const bad = structuredClone(doc);
    bad.assets.ast_f!.provenance.fitted!.joinAt = T.rt(9, 1);
    bad.assets.ast_f!.provenance.fitted!.crossfade = T.rt(100, 1000);
    bad.assets.ast_f!.provenance.origin = 'upload';
    expect(validateProject(bad).filter((i) => i.code === 'fitted_provenance').length).toBe(3);
  });
});

describe('the marked moment when the clip\'s file changes (decisions §2.8)', () => {
  function base() {
    let doc = createProject({ id: 'prj_mm', name: 'M' });
    doc.assets.ast_v = video('ast_v', 1);
    doc.assets.ast_w = video('ast_w', 4);
    // a time-preserving copy of ast_v that starts 2 s into it and lasts 6 s
    doc.assets.ast_c = { ...video('ast_c', 5), duration: T.rt(6, 1), provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'test', derived: { jobId: 'job_1', capabilityId: 'x', capabilityVersion: '1', graphDigest: 'd', params: {}, sourceAssetIds: ['ast_v'], outputName: 'o', outputRole: 'video', encoding: 'h264', provider: {}, sourceRangeStart: T.rt(2, 1) } } } as Asset;
    doc = tx(doc, [{ op: 'add_clip', args: { assetId: 'ast_v', start: T.ZERO, sourceIn: T.rt(3, 1), duration: T.rt(4, 1), withLinkedAudio: false } }]).doc;
    clipsOf(doc)[0]!.impact = T.rt(5, 1);
    return { doc, clipId: clipsOf(doc)[0]!.id };
  }
  it('split, duplicate keep it (a copy of the clip); replace_clip_media to another file clears it', () => {
    const { doc, clipId } = base();
    const split = tx(doc, [{ op: 'split_clip', args: { clipId, at: T.rt(1, 1) } }]).doc;
    expect(clipsOf(split).map((c) => c.impact)).toEqual([T.rt(5, 1), T.rt(5, 1)]);
    const dup = tx(doc, [{ op: 'duplicate_clips', args: { clipIds: [clipId], offset: T.rt(20, 1) } }]).doc;
    expect(clipsOf(dup).every((c) => T.eq(c.impact!, T.rt(5, 1)))).toBe(true);
    const other = tx(doc, [{ op: 'replace_clip_media', args: { clipId, assetId: 'ast_w' } }]).doc;
    expect(clipsOf(other)[0]!.impact).toBeUndefined();
    const sameFile = tx(doc, [{ op: 'replace_clip_media', args: { clipId, assetId: 'ast_v', sourceIn: T.rt(2, 1) } }]).doc;
    expect(clipsOf(sameFile)[0]!.impact).toEqual(T.rt(5, 1));
  });
  it('replace_clip_asset moves it to the copy\'s clock, and drops it when the copy does not hold it', () => {
    const { doc, clipId } = base();
    const r = tx(doc, [{ op: 'replace_clip_asset', args: { clipId, assetId: 'ast_c' } }]).doc;
    expect(clipsOf(r)[0]!.impact).toEqual(T.rt(3, 1));
    const late = structuredClone(doc); clipsOf(late)[0]!.impact = T.rt(9, 1);
    expect(clipsOf(tx(late, [{ op: 'replace_clip_asset', args: { clipId, assetId: 'ast_c' } }]).doc)[0]!.impact).toBeUndefined();
  });
  it('a multicam angle switch that changes the file clears the mark; a switch that keeps the file keeps it (switch_angles on a group)', () => {
    const p = podcast();
    const placed = tx(p.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camA, range: { from: T.rt(10, 1), to: T.rt(40, 1) } } }]);
    const out = placed.results[0]!.output as unknown as PlaceMulticamOutput;
    const videoTrack = (d: ProjectDocument) => Object.values(d.sequences).flatMap((s) => s.tracks).find((t) => t.id === out.videoTrackId)!.clips as MediaClip[];
    const marked = structuredClone(placed.doc);
    const first = videoTrack(marked)[0]!;
    first.impact = first.sourceIn;
    const fileBefore = first.assetId;
    // switching the second half to camera B: the part that now plays B's file loses the mark, the part still on A keeps it
    const sw = tx(marked, [{ op: 'switch_angles', args: { groupId: p.groupId, cuts: [{ at: T.frameTime(300, R), angleId: p.camB }] } }]).doc;
    const parts = videoTrack(sw);
    expect(parts.length).toBe(2);
    expect(parts[0]!.assetId).toBe(fileBefore);
    expect(parts[0]!.impact).toEqual(first.impact);
    expect(parts[1]!.assetId).not.toBe(fileBefore);
    expect(parts[1]!.impact).toBeUndefined();
    // the whole program to camera B: the mark is gone
    const all = tx(marked, [{ op: 'switch_angles', args: { groupId: p.groupId, cuts: [{ at: T.ZERO, angleId: p.camB }] } }]).doc;
    expect(videoTrack(all).every((c) => c.impact === undefined)).toBe(true);
  });
});

describe('the licence rule of a shortened library song (decisions §1)', () => {
  function lib(rec: LibraryRecord) {
    const doc = createProject({ id: 'prj_ml', name: 'L' });
    doc.assets.ast_lib = sound('ast_lib', 6, { provenance: { origin: 'upload', importedAt: prov.importedAt, importedBy: 'user:local', library: rec } });
    doc.assets.ast_own = sound('ast_own', 7);
    return doc;
  }
  it('the owner\'s own file and a CC BY or non-commercial song pass; the made file carries the record', () => {
    expect(fitLicenceProblem(lib(record()), 'ast_own')).toBeNull();
    expect(fitLicenceProblem(lib(record()), 'ast_lib')).toBeNull();
    const nc = record({ licence: { id: 'CC-BY-NC-4.0' }, flags: { nonCommercial: true, diskOnly: true } });
    expect(fitLicenceProblem(lib(nc), 'ast_lib')).toBeNull();
    expect(fittedLibraryRecord(lib(nc), 'ast_lib')).toEqual(nc);
    expect(fittedLibraryRecord(lib(nc), 'ast_own')).toBeNull();
  });
  it('fail-closed: no-derivatives, share-alike, unknown, a weaker record, two origins and an already shortened file are refused', () => {
    expect(fitLicenceProblem(lib(record({ licence: { id: 'CC-BY-ND-4.0' } })), 'ast_lib')).toEqual({ key: 'licenceNoDerivatives', licenceId: 'CC-BY-ND-4.0' });
    expect(fitLicenceProblem(lib(record({ licence: { id: 'CC-BY-SA-4.0' } })), 'ast_lib')).toEqual({ key: 'licenceShareAlike', licenceId: 'CC-BY-SA-4.0' });
    expect(fitLicenceProblem(lib(record({ licence: { id: 'custom:other' } })), 'ast_lib')).toEqual({ key: 'licenceUnknown', licenceId: 'custom:other' });
    expect(fitLicenceProblem(lib(record({ licence: { id: 'CC-BY-NC-4.0' } })), 'ast_lib')?.key).toBe('licenceUnknown'); // record not marked non-commercial
    const two = lib(record());
    two.assets.ast_lib2 = sound('ast_lib2', 8, { provenance: { origin: 'upload', importedAt: prov.importedAt, importedBy: 'user:local', library: record({ itemId: 'src-a/b.wav' }) } });
    two.assets.ast_mix = sound('ast_mix', 9, { provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'test', derived: { jobId: 'j', capabilityId: 'c', capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: ['ast_lib', 'ast_lib2'], outputName: 'o', outputRole: 'audio', encoding: 'pcm', provider: {} } } });
    expect(fitLicenceProblem(two, 'ast_mix')).toEqual({ key: 'licenceManyOrigins', licenceId: null });
    const f = lib(record());
    f.assets.ast_f = sound('ast_f', 10, { provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'test', fitted: fitted('ast_lib'), library: record() } });
    expect(fitLicenceProblem(f, 'ast_f')).toEqual({ key: 'alreadyFitted', licenceId: null });
  });
  it('a shortened copy carries the record: valid, credited once, marked shortened in the description, non-commercial and archive rules follow', () => {
    const doc = lib(record());
    doc.assets.ast_f = sound('ast_f', 10, { provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'test', fitted: fitted('ast_lib'), library: record() } });
    expect(validateProject(doc).filter((i) => i.code === 'library_provenance' || i.code === 'fitted_provenance')).toEqual([]);
    const placed = tx(doc, [{ op: 'add_clip', args: { assetId: 'ast_lib', start: T.ZERO } }, { op: 'add_clip', args: { assetId: 'ast_f', start: T.rt(70, 1) } }]).doc;
    const c = collectCredits(placed);
    expect(c.lines.length).toBe(1);
    expect(c.lines[0]!.modified).toBe('shortened');
    expect(c.descriptionText('he')).toContain(`${record().credit!.text}\n${MODIFIED_LINE.he}`);
    expect(c.descriptionText('en')).toContain(MODIFIED_LINE.en);
    const onlyOriginal = collectCredits(tx(doc, [{ op: 'add_clip', args: { assetId: 'ast_lib', start: T.ZERO } }]).doc);
    expect(onlyOriginal.lines[0]!.modified).toBeUndefined();
    expect(onlyOriginal.descriptionText('he')).not.toContain(MODIFIED_LINE.he);
  });
});

describe('operations, the assistant and the stubs', () => {
  it('the four operations are registered (two public, two internal); until built they refuse notBuilt, changing nothing (built: musicFitOps.test.ts)', () => {
    for (const op of MUSICFIT_PUBLIC_OPS) expect(getOp(op)?.internal ?? false).toBe(false);
    for (const op of MUSICFIT_INTERNAL_OPS) expect(getOp(op)?.internal).toBe(true);
    if (MUSICFIT_OPS_BUILT) return;
    const doc = createProject({ id: 'prj_mo', name: 'O' });
    for (const [op, args] of [['set_clip_impact', { clipId: 'c', moment: null }], ['sync_impact', { clipId: 'c', to: 'bar' }], ['mark_join_heard', { assetId: 'a', heard: false, at: 'x' }]] as const) {
      let err: unknown;
      try { tx(doc, [{ op, args }]); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(OpError);
      expect((err as OpError).message).toBe(MUSICFIT_REFUSALS.notBuilt.message(op));
    }
  });
  it('the language assistant is offered neither public op (its reviewed prompt is unchanged), and no existing op changed its arguments', () => {
    for (const op of MUSICFIT_PUBLIC_OPS) { expect(ASSISTANT_EXCLUDED_OPS).toContain(op); expect(assistantOps()).not.toContain(op); }
    expect(Object.keys((getOp('fit_music')!.args as unknown as { shape: Record<string, unknown> }).shape)).toEqual(['clipId', 'to', 'fadeOut']);
    expect(listOps().filter((o) => o.name === 'swap_music')).toEqual([]);
  });
  it('the stubs throw MusicFitNotBuilt (never a made-up value)', () => {
    const doc = createProject({ id: 'prj_ms', name: 'S' });
    // builder A's (musicAt, cutStats, planImpact, fittedGrid, orderCandidates) are built: musicFitOps.test.ts
    // builder B's (planMusicSwap, musicEndingSteps) are built too: musicSwap.test.ts. No stub is left; a missing clip is an OpError
    for (const fn of [() => planMusicSwap(doc, 'c', 'a'), () => musicEndingSteps(doc, 'c', T.ZERO)]) { expect(fn).toThrow(OpError); expect(fn).not.toThrow(MusicFitNotBuilt); }
    expect(musicAt(doc, T.ZERO)).toBeNull();
    expect(cutStats([0], 30)).toEqual({ cuts: 1, minGapFrames: null, maxInOneSecond: 1 });
    expect(() => planImpact(doc, 'c', undefined, 'beat')).toThrow(OpError);
    expect(fittedGrid({ beats: [], downbeats: [], duration: T.ZERO }, T.ZERO, { from: T.ZERO, to: T.ZERO }, T.ZERO)).toBeNull();
    expect(orderCandidates([], 1)).toEqual([]);
  });
  it('a template asked for an exact built-in ending on pictures too short for the shortest piece is refused with the length, never made as a faded track (built: musicSwap.test.ts)', () => {
    const def = findTemplate(TEMPLATES[0]!.id)!;
    const doc = createProject({ id: 'prj_mt', name: 'T' });
    doc.assets.ast_v = video('ast_v', 1);
    expect(() => planTemplate(doc, def, { media: ['ast_v'], musicAssetId: null, builtinMusic: { styleId: 'music.festive', ending: 'exact' } })).toThrow(/too short/);
  });
});
