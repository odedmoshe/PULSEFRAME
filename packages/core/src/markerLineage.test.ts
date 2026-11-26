/**
 * Beat and scene markers, and the beat montage, follow a clip that shows a DERIVED copy back to the measured file through the same
 * lineage as the transcript-driven edits (lineage.ts beatsFor, sceneCutsFor, timingRelations). A copy that keeps its timing
 * (provenance.derived.sourceRangeStart) has its source's beats and scene cuts, moved exactly onto its own clock (rational time); a
 * copy made without a recorded time mapping (reversed, stretched) has NONE of them, and the montage says so instead of guessing.
 * The derived assets are hand-built fixtures standing in for provider results (labelled: no provider ran).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, beatsFor, createProject, planRecipe, RecipeError, timelineMarkers, validateProject, type OpCall, type ProjectDocument } from './index.ts';
import { dictionaries, MONTAGE_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `ml${n++}_`, actor: 'test', allowInternal });
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test' };
const derivedProv = (src: string, extra: Record<string, unknown> = {}, capabilityId = 'local.audio.voice-clean') => ({
  origin: 'derived' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test',
  derived: { jobId: 'job_fixture', capabilityId, capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, logicDigest: hash('a'), ...extra },
});
const music = { kind: 'audio' as const, name: 'song.wav', contentHash: hash('1'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
const video = { kind: 'video' as const, name: 'film.mp4', contentHash: hash('2'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov };
const picture = { ...video, name: 'picture.mp4', contentHash: hash('3') };

/** Beats of song.wav every half second from 1/3 s (off the frame grid on purpose), bar starts every fourth beat; scene cuts of film.mp4 at 2 s and 9/2 s. */
const BEATS = Array.from({ length: 36 }, (_, i) => T.add(T.rt(1, 3), T.rt(i, 2)));
const BARS = BEATS.filter((_, i) => i % 4 === 0);
const CUTS = [T.rt(2, 1), T.rt(9, 2)];

function setup() {
  let r = tx(createProject({ id: 'prj_ml', name: 'ML' }), [{ op: 'import_asset', args: { asset: music } }, { op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: picture } }], true);
  const [song, film, pic] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  const copies = {
    /** a cleaned-up copy of the song from 1/2 s of it: keeps its timing */
    clean: { ...music, name: 'clean.wav', contentHash: hash('4'), duration: T.rt(19, 1), provenance: derivedProv(song, { sourceRangeStart: T.rt(1, 2), audio: 'processed' }) },
    /** a reversed rendition of the song: made from it, no recorded time mapping */
    backwards: { ...music, name: 'backwards.wav', contentHash: hash('5'), provenance: derivedProv(song, {}, 'comfy.audio.reverse') },
    /** a colour-processed copy of the film from 1 s of it: keeps its timing */
    graded: { ...video, name: 'graded.mp4', contentHash: hash('6'), duration: T.rt(6, 1), video: { ...video.video, frameCount: 180 }, provenance: derivedProv(film, { sourceRangeStart: T.rt(1, 1), audio: 'source-copied' }, 'comfy.video.enhance') },
    /** a reversed rendition of the film: no recorded time mapping */
    reversed: { ...video, name: 'reversed.mp4', contentHash: hash('7'), provenance: derivedProv(film, {}, 'comfy.video.reverse') },
  };
  r = tx(r.doc, Object.values(copies).map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  const ids = Object.fromEntries(Object.keys(copies).map((k, i) => [k, r.results[i]!.output!.assetId as string])) as Record<keyof typeof copies, string>;
  r = tx(r.doc, [
    { op: 'attach_analysis', args: { assetId: song, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: BEATS, bpm: 120, confidence: 0.9, downbeats: BARS, meter: 4 } },
    { op: 'attach_analysis', args: { assetId: film, kind: 'scenes', method: 'test', params: {}, createdAt: 'now', times: CUTS } },
  ], true);
  expect(validateProject(r.doc)).toEqual([]);
  return { doc: r.doc, song, film, pic, ids };
}
const exact = (ts: T.RationalTime[]) => ts.map((t) => { const x = T.normalize(t); return `${x.value}/${x.timescale}`; });
const place = (doc: ProjectDocument, args: Record<string, unknown>) => { const r = tx(doc, [{ op: 'add_clip', args: { withLinkedAudio: false, ...args } }]); return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string }; };
const refused = (fn: () => unknown): RecipeError => { try { fn(); } catch (e) { if (e instanceof RecipeError) return e; throw e; } throw new Error('planned'); };
const starts = (plan: { ops: OpCall[] }) => plan.ops.map((o) => T.frameIndexAt((o.args as { start: T.RationalTime }).start, R));

describe('timeline beat and scene markers follow a time-preserving copy (the editor draws timelineMarkers)', () => {
  it('a clip of a cleaned-up copy of measured music shows its beats and bar starts at exactly the places the song\'s own clip does (offset and trim)', () => {
    const s = setup();
    // the copy's zero is 1/2 s of the song: the clip plays the song's 1 s .. 5 s either way
    const onSong = place(s.doc, { assetId: s.song, start: f(10), sourceIn: f(30), duration: f(120) }).doc;
    const onCopy = place(s.doc, { assetId: s.ids.clean, start: f(10), sourceIn: f(15), duration: f(120) }).doc;
    const a = timelineMarkers(onSong), b = timelineMarkers(onCopy);
    expect(a.beats.length).toBe(8); // song beats 4/3 … 29/6 s
    expect(exact(b.beats)).toEqual(exact(a.beats));
    expect(exact(b.downbeats)).toEqual(exact(a.downbeats));
    // exactly, in rational time: the song's beat at 4/3 s is 5/6 s of the copy, 1/3 s into the clip → 1/3 + 1/3 s on the timeline
    expect(exact(b.beats)[0]).toBe('2/3');
    expect(exact(b.downbeats)).toEqual(['5/3', '11/3']); // song bars at 7/3 and 13/3 s
  });
  it('a clip of a colour-processed copy of an analysed film shows its scene cuts, mapped exactly; cuts before the copy starts are not shown', () => {
    const s = setup();
    // the copy's zero is 1 s of the film; the clip plays the copy from 1/2 s (film 3/2 s): the cut at 2 s is 1/2 s into the clip
    const b = timelineMarkers(place(s.doc, { assetId: s.ids.graded, start: f(60), sourceIn: f(15), duration: f(120) }).doc);
    expect(exact(b.sceneCuts)).toEqual(['5/2', '5/1']);
    // from the copy's start the film's cut at 2 s is 1 s in; a clip of the copy trimmed past both cuts shows none
    expect(exact(timelineMarkers(place(s.doc, { assetId: s.ids.graded, start: f(0), duration: f(60) }).doc).sceneCuts)).toEqual(['1/1']);
    expect(timelineMarkers(place(s.doc, { assetId: s.ids.graded, start: f(0), sourceIn: f(120), duration: f(30) }).doc).sceneCuts).toEqual([]);
  });
  it('a clip of a REVERSED (untimed) copy gets NO markers: not beats, not bar starts, not scene cuts', () => {
    const s = setup();
    let d = place(s.doc, { assetId: s.ids.backwards, start: f(0), duration: f(300) }).doc;
    d = place(d, { assetId: s.ids.reversed, start: f(0), duration: f(240) }).doc;
    expect(timelineMarkers(d)).toEqual({ beats: [], sceneCuts: [], downbeats: [] });
    expect(beatsFor(d, s.ids.backwards)).toBeNull();
  });
  it('a copy that was measured itself shows its own beats only (no second set from its source)', () => {
    const s = setup();
    const own = [T.rt(1, 1), T.rt(2, 1), T.rt(3, 1)];
    const measured = tx(s.doc, [{ op: 'attach_analysis', args: { assetId: s.ids.clean, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: own, bpm: 60, confidence: 0.9 } }], true).doc;
    expect(exact(timelineMarkers(place(measured, { assetId: s.ids.clean, start: f(0), duration: f(120) }).doc).beats)).toEqual(['1/1', '2/1', '3/1']);
    expect(beatsFor(measured, s.ids.clean)).toMatchObject({ assetId: s.ids.clean, offset: T.ZERO });
  });
});

describe('the beat montage follows a music clip that shows a derived copy', () => {
  it('a time-preserving copy of the measured music is followed: the same cuts as the song\'s own clip, and the plan says where the beats were measured', () => {
    const s = setup();
    const onSong = place(s.doc, { assetId: s.song, start: f(10), sourceIn: f(30), duration: f(300) });
    const onCopy = place(s.doc, { assetId: s.ids.clean, start: f(10), sourceIn: f(15), duration: f(300) });
    const a = planRecipe(onSong.doc, 'beat-montage', { musicClipId: onSong.clipId, assetIds: [s.pic], everyBeats: 2 });
    const b = planRecipe(onCopy.doc, 'beat-montage', { musicClipId: onCopy.clipId, assetIds: [s.pic], everyBeats: 2 });
    expect(starts(a).length).toBeGreaterThan(5);
    expect(starts(b)).toEqual(starts(a));
    expect(starts(b)[0]).toBe(20); // the song's beat at 4/3 s = 2/3 s on the timeline
    expect(b.ops).toEqual(a.ops);
    expect(b.basis.join(' | ')).toMatch(/measured on "song\.wav"/);
    expect(a.basis.join(' | ')).not.toMatch(/measured on/);
    // on bar starts too
    const bars = (doc: ProjectDocument, clipId: string) => starts(planRecipe(doc, 'beat-montage', { musicClipId: clipId, assetIds: [s.pic], everyBeats: 1, cutOn: 'bars' }));
    expect(bars(onCopy.doc, onCopy.clipId)).toEqual(bars(onSong.doc, onSong.clipId));
    expect(bars(onCopy.doc, onCopy.clipId).slice(0, 2)).toEqual([50, 110]);
  });
  it('a REVERSED (untimed) copy is not followed and the refusal says why and what to do (Hebrew and English); an unrelated unmeasured file is refused as before', () => {
    const s = setup();
    const back = place(s.doc, { assetId: s.ids.backwards, start: f(0), duration: f(300) });
    const e = refused(() => planRecipe(back.doc, 'beat-montage', { musicClipId: back.clipId, assetIds: [s.pic] }));
    expect(e.code).toBe('untimed_copy');
    expect(e.message).toBe(`music clip ${back.clipId} plays a copy of the measured music that does not keep its timing, so where the beats are in it is unknown`);
    expect(e.hint).toMatch(/analyze_asset kind=beats/);
    const he = translateRefusal('he', e.message);
    expect(he && /[֐-׿]/.test(he)).toBe(true);
    expect(he!.split('; ').length).toBe(2); // the reason, then the next step
    expect(MONTAGE_REFUSAL_PATTERNS.every((re) => re.test(e.message))).toBe(true);
    expect(translateRefusal('en', e.message)).toBeUndefined();
    for (const lang of ['he', 'en'] as const) expect((dictionaries[lang] as Record<string, string>)['error.code.untimed_copy']?.trim()).toBeTruthy();
    // a sound that is no copy of anything measured: the old refusal
    const other = tx(s.doc, [{ op: 'import_asset', args: { asset: { ...music, name: 'other.wav', contentHash: hash('8') } } }], true);
    const plain = place(other.doc, { assetId: other.results[0]!.output!.assetId as string, start: f(0), duration: f(300) });
    expect(refused(() => planRecipe(plain.doc, 'beat-montage', { musicClipId: plain.clipId, assetIds: [s.pic] }))).toMatchObject({ code: 'needs_analysis', message: 'the music has no beat analysis yet' });
  });
});
