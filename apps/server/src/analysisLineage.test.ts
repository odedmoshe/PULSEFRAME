/**
 * The server's readers of beats and scene cuts follow a file that is a DERIVED copy back to the measured file by the one lineage
 * rule (core lineage.ts): GET …/analysis and get_analysis (analysisViewOf), the assistant's summary, the shorts finder, and the
 * scene cuts a frame-interpolation job must not blend across. A copy that keeps its timing answers like its source, on its own
 * clock (rational time); a copy made without a recorded time mapping (reversed) answers like a file that was never analysed.
 * Pinned: measuring writes the record of the file it names, so a hand-corrected source does not refuse measuring its copy.
 * The derived assets are hand-built fixtures standing in for provider results (labelled: no provider ran).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type Asset, type OpCall, type ProjectDocument } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { assistantSummary } from './assistant/summary.ts';
import { sceneCutFrames } from './capabilities.ts';
import { Governance } from './governance.ts';
import { analysisViewOf, analyzeAsset } from './http.ts';
import { finderInputs, sceneCutsOf } from './shorts.ts';
import { ApiError, Store } from './store.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `al${n++}_`, actor: 'test', allowInternal });
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const derivedProv = (src: string, extra: Record<string, unknown> = {}, capabilityId = 'local.audio.voice-clean') => ({
  origin: 'derived' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test',
  derived: { jobId: 'job_fixture', capabilityId, capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, logicDigest: hash('a'), ...extra },
});
const music = { kind: 'audio' as const, name: 'song.wav', contentHash: hash('1'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
const video = { kind: 'video' as const, name: 'film.mp4', contentHash: hash('2'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(30, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 900 }, provenance: prov };
/** Beats of song.wav every half second from 1/3 s, bar starts every fourth; scene cuts of film.mp4 at 2 s, 9/2 s and 20 s. */
const BEATS = Array.from({ length: 36 }, (_, i) => T.add(T.rt(1, 3), T.rt(i, 2)));
const CUTS = [T.rt(2, 1), T.rt(9, 2), T.rt(20, 1)];
const copiesOf = (song: string, film: string) => ({
  clean: { ...music, name: 'clean.wav', contentHash: hash('4'), duration: T.rt(19, 1), provenance: derivedProv(song, { sourceRangeStart: T.rt(1, 2), audio: 'processed' }) },
  backwards: { ...music, name: 'backwards.wav', contentHash: hash('5'), provenance: derivedProv(song, {}, 'comfy.audio.reverse') },
  graded: { ...video, name: 'graded.mp4', contentHash: hash('6'), duration: T.rt(15, 1), video: { ...video.video, frameCount: 450 }, provenance: derivedProv(film, { sourceRangeStart: T.rt(1, 1), audio: 'source-copied' }, 'comfy.video.enhance') },
  reversed: { ...video, name: 'reversed.mp4', contentHash: hash('7'), provenance: derivedProv(film, {}, 'comfy.video.reverse') },
});
const measure = (song: string, film: string): OpCall[] => [
  { op: 'attach_analysis', args: { assetId: song, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: BEATS, bpm: 120, confidence: 0.9, downbeats: BEATS.filter((_, i) => i % 4 === 0), meter: 4 } },
  { op: 'attach_analysis', args: { assetId: film, kind: 'scenes', method: 'test', params: {}, createdAt: 'now', times: CUTS } },
];
function setup() {
  let r = tx(createProject({ id: 'prj_al', name: 'AL', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: music } }, { op: 'import_asset', args: { asset: video } }], true);
  const [song, film] = r.results.map((x) => x.output!.assetId as string) as [string, string];
  const copies = copiesOf(song, film);
  r = tx(r.doc, Object.values(copies).map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  const ids = Object.fromEntries(Object.keys(copies).map((k, i) => [k, r.results[i]!.output!.assetId as string])) as Record<keyof typeof copies, string>;
  return { doc: tx(r.doc, measure(song, film), true).doc, song, film, ids };
}
const exact = (ts: readonly T.RationalTime[]) => ts.map((t) => { const x = T.normalize(t); return `${x.value}/${x.timescale}`; });

describe('GET …/analysis and get_analysis (analysisViewOf)', () => {
  it('a time-preserving copy answers its source\'s beats and cuts on its own clock and names where they are stored; the source answers as before', () => {
    const s = setup();
    const own = analysisViewOf(s.doc, s.song)!;
    expect([own.beats!.count, own.beats!.bpm, 'measuredOn' in own]).toEqual([36, 120, false]);
    const copy = analysisViewOf(s.doc, s.ids.clean)! as ReturnType<typeof analysisViewOf> & { measuredOn: Record<string, { assetId: string; offset: T.RationalTime; offsetSeconds: number }> };
    // the song's first beat (1/3 s) lies before the copy begins (1/2 s): 35 of the 36 beats are in the copy, the first at 1/3 s of it
    expect([copy.assetId, copy.beats!.count, copy.beats!.bpm, copy.beats!.confidence, copy.beats!.method, copy.beats!.beatSeconds[0], copy.beats!.barCount, copy.beats!.meter]).toEqual([s.ids.clean, 35, 120, 0.9, 'test', 0.333333, 8, 4]);
    expect([copy.measuredOn.beats!.assetId, exact([copy.measuredOn.beats!.offset]), copy.measuredOn.beats!.offsetSeconds]).toEqual([s.song, ['1/2'], 0.5]);
    expect(copy.note).toMatch(/this time \+ offset/);
    const graded = analysisViewOf(s.doc, s.ids.graded)! as typeof copy;
    expect([graded.scenes!.count, exact(graded.scenes!.cuts), graded.measuredOn.scenes!.assetId, exact([graded.measuredOn.scenes!.offset])]).toEqual([2, ['1/1', '7/2'], s.film, ['1/1']]);
  });
  it('a reversed copy, an unknown asset and an Object.prototype name answer nothing (404 on the route), like a file that was never analysed', () => {
    const s = setup();
    expect([analysisViewOf(s.doc, s.ids.backwards), analysisViewOf(s.doc, s.ids.reversed), analysisViewOf(s.doc, 'ast_missing'), analysisViewOf(s.doc, 'constructor')]).toEqual([null, null, null, null]);
  });
});

describe('the assistant\'s summary (music: beat count and tempo only)', () => {
  const musicOf = (doc: ProjectDocument, assetId: string) => {
    const placed = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(300), withLinkedAudio: false } }]).doc;
    return assistantSummary(placed, { playheadFrame: 0, selection: [] }, { titlesAndMarkers: false, peopleNames: false }).music;
  };
  it('a clip of a time-preserving copy of measured music is listed as music with its beat count and tempo; a clip of a reversed copy is not', () => {
    const s = setup();
    expect(musicOf(s.doc, s.song)).toEqual([{ asset: 'A1', beats: 36, bpm: 120 }]);
    expect(musicOf(s.doc, s.ids.clean)).toEqual([{ asset: 'A1', beats: 35, bpm: 120 }]);
    expect(musicOf(s.doc, s.ids.backwards)).toEqual([]);
  });
});

describe('the shorts finder\'s scene cuts and the frame job\'s', () => {
  it('a time-preserving copy of an analysed film has its scene cuts on its own clock (only those inside it); a reversed copy has none, like an unanalysed file', () => {
    const s = setup();
    const asset = (id: string) => s.doc.assets[id] as Asset;
    expect(exact(sceneCutsOf(s.doc, asset(s.film))!)).toEqual(['2/1', '9/2', '20/1']);
    expect(exact(sceneCutsOf(s.doc, asset(s.ids.graded))!)).toEqual(['1/1', '7/2']);
    expect(exact(finderInputs(s.doc, asset(s.ids.graded), null).sceneCuts!)).toEqual(['1/1', '7/2']);
    expect([sceneCutsOf(s.doc, asset(s.ids.reversed)), finderInputs(s.doc, asset(s.ids.reversed), null).sceneCuts]).toEqual([null, null]);
  });
  it('frame interpolation of a time-preserving copy is not blended across its source\'s cuts: the same frames of the picture, numbered in the copy', () => {
    const s = setup();
    const src = (assetId: string) => ({ assetId, rate: R, startFrames: 0 });
    expect(sceneCutFrames(s.doc, src(s.film))).toEqual([60, 135, 600]);
    expect(sceneCutFrames(s.doc, src(s.ids.graded))).toEqual([30, 105]); // one second (30 frames) earlier in the copy
    expect(sceneCutFrames(s.doc, src(s.ids.reversed))).toEqual([]);
  });
});

describe('measuring writes the record of the file it names (pinned: not lineage)', () => {
  let dir = '', store: Store | null = null;
  afterAll(() => { store?.close(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
  it('a source corrected by hand refuses to be measured again without overwrite; its time-preserving copy is not refused for that: it gets a record of its own', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-analysis-lineage-'));
    store = new Store(dir);
    const gov = new Governance(store);
    const owner = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'propose', 'edit', 'export', 'job', 'admin', 'people'] } as unknown as Principal;
    const pid = store.createProject({ name: 'pin', width: 640, height: 360, frameRate: R }).doc.id;
    const commit = (ops: OpCall[]) => store!.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops });
    const song = commit([{ op: 'import_asset', args: { asset: music } }]).results[0]!.output!.assetId as string;
    const clean = commit([{ op: 'import_asset', args: { asset: copiesOf(song, song).clean } }]).results[0]!.output!.assetId as string;
    commit([measure(song, song)[0]!, { op: 'edit_analysis', args: { assetId: song, kind: 'beats', add: [T.rt(1, 8)] } }]);
    const refusal = async (assetId: string) => { try { await analyzeAsset(store!, gov, owner, pid, { assetId, kind: 'beats' }); } catch (e) { return e instanceof ApiError ? e.code : `not a typed refusal: ${String(e)}`; } return 'measured'; };
    expect(await refusal(song)).toBe('would_discard_edits');
    // the copy passes that check (its own record does not exist); these fixtures have no media file, so the measuring itself fails
    expect(await refusal(clean)).toBe('analysis_failed');
    expect(store.getProject(pid).doc.analyses[song]!.beats!.origin.edited).toBe(true);
  });
});
