/**
 * What the editor says about a file's beats and scene cuts follows a derived copy by the timeline's lineage (core ownBeats /
 * ownSceneCuts): the analysis panel and its corrections, the inspector's beat card, the library card, the music step of the
 * template and film dialogs, the bar.beat readout's meter. A copy that keeps its timing reads like its source on its own clock; a
 * reversed (untimed) copy reads "not measured". The derived assets are hand-built fixtures standing in for provider results
 * (labelled: no provider ran).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, beatsFor, createProject, sceneCutsFor, timelineMarkers, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { analysisEdit, analysisFacts, beatFacts, libraryFacts, meterOf } from './analysis.logic.ts';
import { beatInfo } from './familyFilm.logic.ts';
import { beatState, defaultMusic } from './templateDialog.logic.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `an${n++}_`, actor: 'test', allowInternal });
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const derived = (src: string, extra: Record<string, unknown>, capabilityId = 'local.audio.voice-clean') => ({
  origin: 'derived' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test',
  derived: { jobId: 'job_fixture', capabilityId, capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, logicDigest: hash('a'), ...extra },
});
const music = { kind: 'audio' as const, name: 'song.wav', contentHash: hash('1'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
const video = { kind: 'video' as const, name: 'film.mp4', contentHash: hash('2'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(30, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 900 }, provenance: prov };
/** Beats of song.wav every half second from 1/3 s, bar starts every third (meter 3); scene cuts of film.mp4 at 2 s, 9/2 s and 20 s. */
const BEATS = Array.from({ length: 36 }, (_, i) => T.add(T.rt(1, 3), T.rt(i, 2)));
const CUTS = [T.rt(2, 1), T.rt(9, 2), T.rt(20, 1)];

function setup() {
  let r = tx(createProject({ id: 'prj_an', name: 'AN' }), [{ op: 'import_asset', args: { asset: music } }, { op: 'import_asset', args: { asset: video } }], true);
  const [song, film] = r.results.map((x) => x.output!.assetId as string) as [string, string];
  const copies = {
    /** from 1/2 s of the song: keeps its timing */
    clean: { ...music, name: 'clean.wav', contentHash: hash('4'), duration: T.rt(19, 1), provenance: derived(song, { sourceRangeStart: T.rt(1, 2), audio: 'processed' }) },
    backwards: { ...music, name: 'backwards.wav', contentHash: hash('5'), provenance: derived(song, {}, 'comfy.audio.reverse') },
    /** from 1 s of the film, 15 s long: keeps its timing */
    graded: { ...video, name: 'graded.mp4', contentHash: hash('6'), duration: T.rt(15, 1), video: { ...video.video, frameCount: 450 }, provenance: derived(film, { sourceRangeStart: T.rt(1, 1), audio: 'source-copied' }, 'comfy.video.enhance') },
    reversed: { ...video, name: 'reversed.mp4', contentHash: hash('7'), provenance: derived(film, {}, 'comfy.video.reverse') },
  };
  r = tx(r.doc, Object.values(copies).map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  const ids = Object.fromEntries(Object.keys(copies).map((k, i) => [k, r.results[i]!.output!.assetId as string])) as Record<keyof typeof copies, string>;
  r = tx(r.doc, [
    { op: 'attach_analysis', args: { assetId: song, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: BEATS, bpm: 121.4, confidence: 0.9, downbeats: BEATS.filter((_, i) => i % 3 === 0), meter: 3 } },
    { op: 'attach_analysis', args: { assetId: film, kind: 'scenes', method: 'test', params: {}, createdAt: 'now', times: CUTS } },
  ], true);
  return { doc: r.doc, song, film, ids };
}
const exact = (ts: readonly T.RationalTime[]) => ts.map((t) => { const x = T.normalize(t); return `${x.value}/${x.timescale}`; });

describe('beats and scene cuts of a file, by lineage', () => {
  it('the music step of the template and film dialogs, the inspector\'s beat card and the bar.beat meter: a time-preserving copy is measured music with its source\'s tempo and meter; a reversed copy is not measured', () => {
    const s = setup();
    expect(beatFacts(s.doc, s.song)).toEqual({ measured: true, count: 36, bpm: 121.4 });
    // the song's first beat lies before the copy begins: 35 beats are in the copy
    for (const facts of [beatFacts, beatInfo, beatState]) {
      expect(facts(s.doc, s.ids.clean), facts.name).toEqual({ measured: true, count: 35, bpm: 121.4 });
      expect(facts(s.doc, s.ids.backwards), facts.name).toEqual({ measured: false, count: 0, bpm: null });
      expect(facts(s.doc, 'constructor'), facts.name).toEqual({ measured: false, count: 0, bpm: null });
    }
    expect([meterOf(s.doc, s.song), meterOf(s.doc, s.ids.clean), meterOf(s.doc, s.ids.backwards), meterOf(s.doc, '')]).toEqual([3, 3, null, null]);
    // the dialog opens on the first sound file whose beat is known: without the song that is its clean copy, never the reversed one
    const only = structuredClone(s.doc);
    const order = [s.ids.backwards, s.ids.clean, s.song];
    only.assets = Object.fromEntries([...order.map((id) => [id, only.assets[id]!] as const), ...Object.entries(only.assets).filter(([id]) => !order.includes(id))]);
    expect(defaultMusic(only, 'beats')).toBe(s.ids.clean);
  });

  it('the library card: the copy shows its source\'s tempo and the shots that lie in it; a reversed copy shows neither', () => {
    const s = setup();
    expect([libraryFacts(s.doc, s.song), libraryFacts(s.doc, s.ids.clean), libraryFacts(s.doc, s.ids.backwards)]).toEqual([{ bpm: 121, shots: null }, { bpm: 121, shots: null }, { bpm: null, shots: null }]);
    // the film has three cuts (four shots); the copy covers 1 s .. 16 s of it: two cuts, three shots
    expect([libraryFacts(s.doc, s.film), libraryFacts(s.doc, s.ids.graded), libraryFacts(s.doc, s.ids.reversed)]).toEqual([{ bpm: null, shots: 4 }, { bpm: null, shots: 3 }, { bpm: null, shots: null }]);
  });

  it('the analysis panel shows what the timeline follows and names where it was measured', () => {
    const s = setup();
    const own = analysisFacts(s.doc, s.song);
    expect([own.measuredOn, own.beats!.count, own.beats!.bars, own.beats!.meter, own.scenes]).toEqual([null, 36, 12, 3, null]);
    const copy = analysisFacts(s.doc, s.ids.clean);
    expect([copy.measuredOn, copy.beats!.on, copy.beats!.count, copy.beats!.bars, copy.beats!.meter, copy.beats!.bpm, copy.beats!.confidence, copy.beats!.origin.method]).toEqual([s.song, s.song, 35, 11, 3, 121.4, 0.9, 'test']);
    const graded = analysisFacts(s.doc, s.ids.graded);
    expect([graded.measuredOn, exact(graded.scenes!.cuts), graded.beats]).toEqual([s.film, ['1/1', '7/2'], null]);
    for (const id of [s.ids.backwards, s.ids.reversed]) expect(analysisFacts(s.doc, id), id).toEqual({ scenes: null, beats: null, measuredOn: null });
  });
});

describe('a correction made in the analysis panel on a copy\'s clip', () => {
  it('goes to the measured file at the same moment of the music (exact), so the copy\'s clip and the song\'s clip show it; it never starts a record on the copy that would hide the measured beats', () => {
    const s = setup();
    // the playhead is at 3/4 s of the copy = 5/4 s of the song
    const add = analysisEdit(s.doc, s.ids.clean, 'beats', 'add', T.rt(3, 4))!;
    expect(add).toEqual({ op: 'edit_analysis', args: { assetId: s.song, kind: 'beats', add: [T.rt(5, 4)] } });
    const added = tx(s.doc, [add]).doc;
    expect([Object.hasOwn(added.analyses, s.ids.clean), added.analyses[s.song]!.beats!.beats.length, added.analyses[s.song]!.beats!.origin.edited, beatsFor(added, s.ids.clean)!.assetId]).toEqual([false, 37, true, s.song]);
    const onCopy = tx(added, [{ op: 'add_clip', args: { assetId: s.ids.clean, start: f(0), duration: f(60), withLinkedAudio: false } }]).doc;
    expect(exact(timelineMarkers(onCopy).beats)).toEqual(['1/3', '3/4', '5/6', '4/3', '11/6']);
    // remove the nearest beat to 0.7 s of the copy: the one at 3/4 s of it (5/4 s of the song), not the one at 5/6 s
    const remove = analysisEdit(added, s.ids.clean, 'beats', 'remove', T.rt(7, 10))!;
    expect(remove).toEqual({ op: 'edit_analysis', args: { assetId: s.song, kind: 'beats', remove: [T.rt(5, 4)] } });
    expect(exact(tx(added, [remove]).doc.analyses[s.song]!.beats!.beats)).toEqual(exact(BEATS));
    // scene cuts likewise: 2 s of the graded copy is 3 s of the film
    expect(analysisEdit(s.doc, s.ids.graded, 'scenes', 'add', T.rt(2, 1))).toEqual({ op: 'edit_analysis', args: { assetId: s.film, kind: 'scenes', add: [T.rt(3, 1)] } });
    expect(analysisEdit(s.doc, s.ids.graded, 'scenes', 'remove', T.rt(3, 1))).toEqual({ op: 'edit_analysis', args: { assetId: s.film, kind: 'scenes', remove: [T.rt(9, 2)] } });
  });
  it('on a reversed copy, or a file with no measurement, the correction starts that file\'s own record (as before); there is nothing to remove', () => {
    const s = setup();
    for (const id of [s.ids.backwards, s.ids.reversed]) {
      expect(analysisEdit(s.doc, id, 'beats', 'add', T.rt(1, 1)), id).toEqual({ op: 'edit_analysis', args: { assetId: id, kind: 'beats', add: [T.rt(1, 1)] } });
      expect(analysisEdit(s.doc, id, 'beats', 'remove', T.rt(1, 1)), id).toBeNull();
    }
    const own = tx(s.doc, [analysisEdit(s.doc, s.ids.backwards, 'beats', 'add', T.rt(1, 1))!]).doc;
    expect([beatsFor(own, s.ids.backwards)!.assetId, own.analyses[s.song]!.beats!.beats.length, sceneCutsFor(own, s.ids.backwards)]).toEqual([s.ids.backwards, 36, null]);
    // the file's own record is corrected in place, on its own clock
    expect(analysisEdit(s.doc, s.song, 'beats', 'remove', T.rt(1, 2))).toEqual({ op: 'edit_analysis', args: { assetId: s.song, kind: 'beats', remove: [T.rt(1, 3)] } });
  });
});
