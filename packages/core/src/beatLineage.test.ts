/**
 * Every reader of beats, bars, tempo and scene cuts follows a clip (or a file) that is a DERIVED copy back to the measured file by
 * the one lineage rule (lineage.ts beatsFor / sceneCutsFor, with ownBeats / ownSceneCuts for the readers that want lists on the
 * file's own clock): a copy that keeps its timing behaves exactly like its source, a copy made without a recorded time mapping
 * (reversed) behaves like a file that was never analysed. One block per reader: the beat grid of effects, the perform mode's
 * grid, fit_music, the mixer's track role, the template and film music grid, the template's meter, the shorts planner; and the
 * pins for what must NOT follow lineage (the writers of a record, the list of records).
 * The derived assets are hand-built fixtures standing in for provider results (labelled: no provider ran).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, beatNumbers, beatPositionAt, beatsFor, BuildShortsBodySchema, createProject, findClip, followedBeats, ownBeats, ownSceneCuts, performGrid, placedMusicGrid,
  planShorts, planTemplate, summarize, TemplateError, trackRole, validateProject,
  type OpCall, type ProjectDocument, type ShortsPlanContext, type TemplateDef,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `bl${n++}_`, actor: 'test', allowInternal });
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const derivedProv = (src: string, extra: Record<string, unknown> = {}, capabilityId = 'local.audio.voice-clean') => ({
  origin: 'derived' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test',
  derived: { jobId: 'job_fixture', capabilityId, capabilityVersion: '0.1.0', graphDigest: hash('a'), params: {}, sourceAssetIds: [src], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, logicDigest: hash('a'), ...extra },
});
const music = { kind: 'audio' as const, name: 'song.wav', contentHash: hash('1'), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
const video = { kind: 'video' as const, name: 'film.mp4', contentHash: hash('2'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(30, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 900 }, provenance: prov };

/** Beats of song.wav every half second from 1/3 s (off the frame grid on purpose), bar starts every third beat (meter 3); scene cuts of film.mp4 at 2 s, 9/2 s and 20 s. */
const BEATS = Array.from({ length: 36 }, (_, i) => T.add(T.rt(1, 3), T.rt(i, 2)));
const BARS = BEATS.filter((_, i) => i % 3 === 0);
const CUTS = [T.rt(2, 1), T.rt(9, 2), T.rt(20, 1)];

function setup() {
  let r = tx(createProject({ id: 'prj_bl', name: 'BL', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: music } }, { op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: { ...music, name: 'other.wav', contentHash: hash('8') } } }], true);
  const [song, film, other] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  const copies = {
    /** a cleaned-up copy of the song from 1/2 s of it: keeps its timing */
    clean: { ...music, name: 'clean.wav', contentHash: hash('4'), duration: T.rt(19, 1), provenance: derivedProv(song, { sourceRangeStart: T.rt(1, 2), audio: 'processed' }) },
    /** a reversed rendition of the song: made from it, no recorded time mapping */
    backwards: { ...music, name: 'backwards.wav', contentHash: hash('5'), provenance: derivedProv(song, {}, 'comfy.audio.reverse') },
    /** a colour-processed copy of the film from 1 s of it, 15 s long: keeps its timing */
    graded: { ...video, name: 'graded.mp4', contentHash: hash('6'), duration: T.rt(15, 1), video: { ...video.video, frameCount: 450 }, provenance: derivedProv(film, { sourceRangeStart: T.rt(1, 1), audio: 'source-copied' }, 'comfy.video.enhance') },
    /** a reversed rendition of the film: no recorded time mapping */
    reversed: { ...video, name: 'reversed.mp4', contentHash: hash('7'), provenance: derivedProv(film, {}, 'comfy.video.reverse') },
  };
  r = tx(r.doc, Object.values(copies).map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  const ids = Object.fromEntries(Object.keys(copies).map((k, i) => [k, r.results[i]!.output!.assetId as string])) as Record<keyof typeof copies, string>;
  r = tx(r.doc, [
    { op: 'attach_analysis', args: { assetId: song, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: BEATS, bpm: 120, confidence: 0.9, downbeats: BARS, meter: 3 } },
    { op: 'attach_analysis', args: { assetId: film, kind: 'scenes', method: 'test', params: {}, createdAt: 'now', times: CUTS } },
  ], true);
  expect(validateProject(r.doc)).toEqual([]);
  return { doc: r.doc, song, film, other, ids };
}
const exact = (ts: readonly T.RationalTime[]) => ts.map((t) => { const x = T.normalize(t); return `${x.value}/${x.timescale}`; });
const place = (doc: ProjectDocument, args: Record<string, unknown>) => { const r = tx(doc, [{ op: 'add_clip', args: { withLinkedAudio: false, ...args } }]); return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string }; };
/** The same stretch of the song (1 s .. 5 s of it) through the song's own clip, the clean copy's clip (its zero is 1/2 s of the song), and clips of the reversed copy and of an unmeasured file. */
function fourWays(s: ReturnType<typeof setup>, frames = 120) {
  return {
    song: place(s.doc, { assetId: s.song, start: f(10), sourceIn: f(30), duration: f(frames) }),
    copy: place(s.doc, { assetId: s.ids.clean, start: f(10), sourceIn: f(15), duration: f(frames) }),
    reversed: place(s.doc, { assetId: s.ids.backwards, start: f(10), sourceIn: f(30), duration: f(frames) }),
    unmeasured: place(s.doc, { assetId: s.other, start: f(10), sourceIn: f(30), duration: f(frames) }),
  };
}

describe('the lineage readers on the file\'s own clock (ownBeats, ownSceneCuts, beatNumbers)', () => {
  it('a time-preserving copy has its source\'s beats and cuts moved exactly (rational); the numbers count what lies in the copy; a reversed copy has none', () => {
    const s = setup();
    const own = ownBeats(s.doc, s.ids.clean)!;
    expect([own.assetId, exact([own.offset]), own.analysis.meter, own.analysis.bpm]).toEqual([s.song, ['1/2'], 3, 120]);
    expect(exact(own.beats).slice(0, 3)).toEqual(['-1/6', '1/3', '5/6']); // the song's first beat lies before the copy begins
    expect(exact(own.downbeats).slice(0, 2)).toEqual(['-1/6', '4/3']);
    expect(ownBeats(s.doc, s.ids.clean)!.beats).toBe(own.beats); // the same list again: readers cache by it
    expect(ownBeats(s.doc, s.song)!.beats).toBe(s.doc.analyses[s.song]!.beats!.beats);
    expect([beatNumbers(s.doc, s.song)!.count, beatNumbers(s.doc, s.song)!.bars, beatNumbers(s.doc, s.ids.clean)!.count, beatNumbers(s.doc, s.ids.clean)!.bars]).toEqual([36, 12, 35, 11]);
    expect(exact(ownSceneCuts(s.doc, s.ids.graded)!.cuts)).toEqual(['1/1', '7/2']); // the cut at 20 s is past the copy's 15 s
    expect([ownBeats(s.doc, s.ids.backwards), beatNumbers(s.doc, s.ids.backwards), ownSceneCuts(s.doc, s.ids.reversed), ownBeats(s.doc, s.other)]).toEqual([null, null, null, null]);
  });
});

describe('the beat grid of effects (beatPositionAt, followedBeats) and of the perform mode (performGrid)', () => {
  const position = (doc: ProjectDocument, frame: number) => { const p = beatPositionAt(doc, f(frame)); return p ? { ...p, clipId: 'x' } : null; };
  it('a clip of a time-preserving copy is followed exactly like the song\'s own clip: the same beat, bar position, period and hits', () => {
    const w = fourWays(setup());
    for (const frame of [10, 37, 64, 129]) {
      const a = position(w.song.doc, frame), b = position(w.copy.doc, frame);
      expect(a, `frame ${frame}`).not.toBeNull();
      expect(b, `frame ${frame}`).toEqual(a);
    }
    // the song's beat at 4/3 s is 1/3 s into either clip: 2/3 s on the timeline, and it is beat number 2 of the song (bar start at index 3)
    const hits = followedBeats(w.copy.doc, 0, 10);
    expect(hits).toEqual(followedBeats(w.song.doc, 0, 10));
    expect([hits.length, hits[0]!.t, hits[0]!.index]).toEqual([8, 2 / 3, 2]);
    expect(beatPositionAt(w.copy.doc, f(20))!.clipId).toBe(w.copy.clipId);
  });
  it('a clip of a reversed copy is not followed, like a clip of a file that was never analysed', () => {
    const w = fourWays(setup());
    expect([position(w.reversed.doc, 37), followedBeats(w.reversed.doc, 0, 10)]).toEqual([position(w.unmeasured.doc, 37), followedBeats(w.unmeasured.doc, 0, 10)]);
    expect([position(w.reversed.doc, 37), followedBeats(w.reversed.doc, 0, 10)]).toEqual([null, []]);
  });
  it('the perform mode snaps to the same grid under a copy as under the song, at every tempo and snap; under a reversed copy there is no grid (no_music)', () => {
    const w = fourWays(setup());
    for (const settings of [{ snap: 'beat', tempo: 'normal', parity: 0 }, { snap: 'half', tempo: 'normal', parity: 0 }, { snap: 'beat', tempo: 'half', parity: 1 }, { snap: 'beat', tempo: 'double', parity: 0 }] as never[]) {
      const grid = performGrid(w.song.doc, settings);
      expect(grid.length, JSON.stringify(settings)).toBeGreaterThan(3);
      expect(performGrid(w.copy.doc, settings), JSON.stringify(settings)).toEqual(grid);
      expect([performGrid(w.reversed.doc, settings), performGrid(w.unmeasured.doc, settings)], JSON.stringify(settings)).toEqual([[], []]);
    }
  });
});

describe('fit_music', () => {
  /** A picture until frame 100, and the music from frame 0 through the given clip. */
  const fitted = (s: ReturnType<typeof setup>, assetId: string, sourceIn: number) => {
    const pic = place(s.doc, { assetId: s.film, start: f(0), duration: f(100) });
    const mus = place(pic.doc, { assetId, start: f(0), sourceIn: f(sourceIn), duration: f(300) });
    const r = tx(mus.doc, [{ op: 'fit_music', args: { clipId: mus.clipId } }]);
    const clip = findClip(r.doc, mus.clipId)!.clip;
    return { out: r.results[0]!.output as { end: T.RationalTime; onBeat: boolean; onBar: boolean; shortBy: T.RationalTime }, endFrame: T.nearestFrameIndex(T.add(clip.start, clip.duration), R), summary: r.results[0]!.summary };
  };
  it('music that is a time-preserving copy ends on the same bar start as the song itself would', () => {
    const s = setup();
    const a = fitted(s, s.song, 30), b = fitted(s, s.ids.clean, 15);
    // the song's bar start at 10/3 s is 7/3 s into the clip: frame 70, the last bar start before the picture ends at frame 100
    expect([a.out.onBeat, a.out.onBar, a.endFrame]).toEqual([true, true, 70]);
    expect([b.out, b.endFrame, b.summary]).toEqual([a.out, a.endFrame, a.summary]);
  });
  it('music that is a reversed copy is fitted like a file without a beat analysis: exactly to the end of the picture, and the answer does not say "on a beat"', () => {
    const s = setup();
    const a = fitted(s, s.other, 30), b = fitted(s, s.ids.backwards, 30);
    expect([a.out.onBeat, a.out.onBar, a.endFrame]).toEqual([false, false, 100]);
    expect([b.out, b.endFrame, b.summary]).toEqual([a.out, a.endFrame, a.summary]);
    expect(b.summary).not.toMatch(/beat|bar/);
  });
});

describe('the mixer\'s track role (trackRole: the command bar\'s «המוזיקה»)', () => {
  const roleOf = (p: { doc: ProjectDocument; clipId: string }) => trackRole(p.doc, findClip(p.doc, p.clipId)!.track);
  it('a track of a time-preserving copy of measured music is music, like the song\'s; a track of a reversed copy is not, like an unmeasured file\'s', () => {
    const w = fourWays(setup());
    expect([roleOf(w.song), roleOf(w.copy), roleOf(w.reversed), roleOf(w.unmeasured)]).toEqual(['music', 'music', null, null]);
  });
  it('speech likewise: a track of a cleaned-up copy of a transcribed recording is speech; of a reversed copy it is not', () => {
    const s = setup();
    const said = tx(s.doc, [{ op: 'set_transcript', args: { assetId: s.other, language: 'he', segments: [{ start: T.rt(1, 1), duration: T.rt(2, 1), text: 'שלום עולם', words: [{ start: T.rt(1, 1), duration: T.rt(1, 1), text: 'שלום' }, { start: T.rt(2, 1), duration: T.rt(1, 1), text: 'עולם' }] }] } }]).doc;
    const r = tx(said, [
      { op: 'import_asset', args: { asset: { ...music, name: 'voice-clean.wav', contentHash: hash('9'), duration: T.rt(19, 1), provenance: derivedProv(s.other, { sourceRangeStart: T.rt(1, 2), audio: 'processed' }) } } },
      { op: 'import_asset', args: { asset: { ...music, name: 'voice-backwards.wav', contentHash: hash('b'), provenance: derivedProv(s.other, {}, 'comfy.audio.reverse') } } },
    ], true);
    const [clean, backwards] = r.results.map((x) => x.output!.assetId as string) as [string, string];
    expect([s.other, clean, backwards].map((assetId) => roleOf(place(r.doc, { assetId, start: f(0), duration: f(120) })))).toEqual(['speech', 'speech', null]);
  });
});

describe('the music grid of templates and of the family film (placedMusicGrid) and the template\'s meter', () => {
  const beatsOf = (g: ReturnType<typeof placedMusicGrid>['grid'], from: T.RationalTime, count: number) => { const out: T.RationalTime[] = []; let c = from; for (let i = 0; i < count; i++) { const next = g.beatAfter(c, 1); if (!next) break; out.push(next); c = next; } return exact(out); };
  it('a time-preserving copy carries the same grid as the song: the same beats and bars on the timeline, the clip starting at the same moment of the music', () => {
    const s = setup(), at = f(60);
    const a = placedMusicGrid(s.doc, s.song, at, 'first-downbeat', true), b = placedMusicGrid(s.doc, s.ids.clean, at, 'first-downbeat', true);
    // the song starts at its first bar start (1/3 s); the copy begins after that, so it starts at its own first bar start: the song's 11/6 s
    expect([exact([a.sourceIn]), exact([b.sourceIn])]).toEqual([['1/3'], ['4/3']]);
    expect([b.bars, b.bpm, b.confidence, b.method, b.grid.meter, b.asset.id]).toEqual([true, 120, 0.9, a.method, 3, s.ids.clean]);
    expect(b.beatCount).toBe(a.beatCount - 3);
    // from the file's start both play the same music at the same moments: the copy placed 1/2 s later has every beat where the song's is
    const zeroA = placedMusicGrid(s.doc, s.song, at, 'zero', false), zeroB = placedMusicGrid(s.doc, s.ids.clean, T.add(at, T.rt(1, 2)), 'zero', false);
    expect(beatsOf(zeroB.grid, T.add(at, T.rt(1, 2)), 12)).toEqual(beatsOf(zeroA.grid, T.add(at, T.rt(1, 2)), 12));
    expect(beatsOf(zeroB.grid, at, 1)).toEqual(['17/6']); // 2 s + the song's 5/6 s
  });
  it('a reversed copy is refused like music that was never measured: needs_analysis, with the same next step', () => {
    const s = setup();
    const refusal = (assetId: string) => { try { placedMusicGrid(s.doc, assetId, f(0), 'first-downbeat', false); } catch (e) { if (e instanceof TemplateError) return [e.code, e.message, e.hint]; throw e; } return ['planned']; };
    expect(refusal(s.ids.backwards)).toEqual(refusal(s.other));
    expect(refusal(s.ids.backwards).slice(0, 2)).toEqual(['needs_analysis', 'the music has no beat analysis yet']);
  });
  it('a template counts its bars by the meter of the copy\'s measured source (at double tempo a one-bar slot is half a bar of THAT meter)', () => {
    const s = setup();
    const words = (en: string) => ({ he: `${en} (he)`, en });
    // meter 6: half a bar is 3 beats (the default meter 4 would give 2)
    const six = tx(s.doc, [{ op: 'edit_analysis', args: { assetId: s.song, kind: 'beats', downbeats: BEATS.filter((_, i) => i % 6 === 0), meter: 6 } }]).doc;
    const DEF: TemplateDef = {
      id: 'tpl.lineage-meter', version: 1, name: words('Meter'), hint: words('Meter'), genre: 'montage', designedFor: 'wide', tempo: { fallbackBpm: 120 }, music: { need: 'beats', startAt: 'first-downbeat' },
      slots: ['s1', 's2'].map((key) => ({ key, role: words(key), accept: 'any' as const, span: { bars: 1 }, keepAudio: false })), slotUse: { mode: 'all', min: 1 }, texts: [], elements: [], sfx: [], adjust: [],
    };
    const lengths = (musicAssetId: string) => { const p = planTemplate(six, DEF, { media: [s.film], musicAssetId, tempo: 'double' }); return p.ops.filter((o) => o.op === 'add_clip' && (o.args as { assetId?: unknown }).assetId === s.film).map((o) => T.nearestFrameIndex((o.args as { duration: T.RationalTime }).duration, R)); };
    expect(lengths(s.song)).toEqual([45, 45]); // 3 beats of half a second
    expect(lengths(s.ids.clean)).toEqual(lengths(s.song));
  });
});

describe('the shorts planner\'s scene cuts (planShorts)', () => {
  const ctx0: ShortsPlanContext = { createdAt: '2026-11-25T00:00:00Z', candidates: new Map(), features: new Map() };
  const planned = (s: ReturnType<typeof setup>, assetId: string, start: number, end: number) => { const p = planShorts(s.doc, BuildShortsBodySchema.parse({ picks: [{ assetId, start: T.rt(start, 1), end: T.rt(end, 1) }] }), ctx0); return { basis: p.basis.includes('scene cuts (analysis)'), warned: p.warnings.some((x) => x.code === 'no_scene_cuts') }; };
  it('a short from a time-preserving copy of an analysed film is planned with its scene cuts, like one from the film; from a reversed copy it is planned without, and says so', () => {
    const s = setup();
    expect(planned(s, s.film, 1, 13)).toEqual({ basis: true, warned: false });
    expect(planned(s, s.ids.graded, 0, 12)).toEqual({ basis: true, warned: false });
    expect(planned(s, s.ids.reversed, 1, 13)).toEqual({ basis: false, warned: true });
  });
});

describe('what must NOT follow lineage (pinned)', () => {
  it('attach_analysis and edit_analysis write the record of the file they name: a copy corrected itself gets its own record on its own clock, which then wins for every reader; the source\'s record is untouched', () => {
    const s = setup();
    const before = structuredClone(s.doc.analyses[s.song]);
    const r = tx(s.doc, [{ op: 'edit_analysis', args: { assetId: s.ids.clean, kind: 'beats', add: [T.rt(1, 1), T.rt(2, 1)] } }]).doc;
    expect(r.analyses[s.song]).toEqual(before);
    expect(exact(r.analyses[s.ids.clean]!.beats!.beats)).toEqual(['1/1', '2/1']);
    expect([beatsFor(r, s.ids.clean)!.assetId, exact([beatsFor(r, s.ids.clean)!.offset]), beatNumbers(r, s.ids.clean)!.count]).toEqual([s.ids.clean, ['0/1'], 2]);
    const measured = tx(s.doc, [{ op: 'attach_analysis', args: { assetId: s.ids.backwards, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: [T.rt(1, 1), T.rt(3, 2), T.rt(2, 1)], bpm: 120, confidence: 0.5 } }], true).doc;
    expect([measured.analyses[s.song], beatsFor(measured, s.ids.backwards)!.assetId, ownBeats(measured, s.ids.backwards)!.beats.length]).toEqual([before, s.ids.backwards, 3]);
  });
  it('the project summary lists the stored records, one per measured file: a copy that follows its source has no entry of its own', () => {
    const s = setup();
    expect(summarize(s.doc).analyses.map((a) => a.assetId).sort()).toEqual([s.song, s.film].sort());
  });
});
