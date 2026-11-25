/**
 * Builder B of the musicfit track (wave 7; .artifacts/wave7/musicfit-decisions.md §2.1, §2.4, §2.5, §3): planMusicSwap and
 * musicEndingSteps as ONE transaction of existing public ops (a fade only when the file is cut by a frame; exact undo), the film
 * planner's musicGridSteady and its exact ending, the template's ending 'exact'. Every asset here is a synthetic record (built-in
 * music records as makeMusic stores them, without a file; a song record with labelled synthetic beats). Nothing is heard.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, diffEntities, exactLayoutFor, findClip, FILM_BINDS, knownGridOf, MUSIC_GENERATOR, musicLayout, musicProvenanceParams, OpError, restoreEntities, sampleFramesFor, validateProject,
  type Asset, type KnownGrid, type MediaClip, type OpCall, type ProjectDocument, type TemplateDef, type TemplatePlan,
} from './index.ts';
import { endsExactly, musicEndingFor, musicEndingSteps, planMusicSwap } from './musicSwap.ts';
import { planTemplate } from './templatePlan.ts';
import { planFamilyFilm } from './familyFilm.ts';
import { beatTimes, emptyCtx, project as filmProject, song, video, win, withBeats, withMoments } from './familyFilm.testDouble.ts';
import { videoFrames } from './momentsContract.ts';

const R = { num: 30, den: 1 };
const f = (n: number, rate = R) => T.frameTime(n, rate);
const frames = (t: unknown, rate = R) => T.frameIndexAt(t as T.RationalTime, rate);
let seq = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `ms${seq++}_`, actor: 'test', allowInternal: true });
const hash = (k: number) => `sha256:${k.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00.000Z', importedBy: 'test' };
/** TEST DOUBLE: a built-in music record as makeMusic stores it (no file: core never reads one). */
function builtin(styleId: string, bars: number, endFrames?: number, seed = 1, k = 1): { asset: Omit<Asset, 'id'>; grid: KnownGrid } {
  const layout = musicLayout(styleId, bars, endFrames);
  return {
    asset: {
      kind: 'audio', name: `${styleId}.wav`, contentHash: hash(900_000 + k), byteSize: 44 + 4 * layout.totalFrames, container: 'wav', mimeType: 'audio/wav', duration: layout.duration,
      audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' },
      provenance: { origin: 'generated', importedAt: prov.importedAt, importedBy: 'test', procedural: { id: styleId, version: 1, generator: MUSIC_GENERATOR, params: musicProvenanceParams(layout, seed) } },
    } as Omit<Asset, 'id'>,
    grid: knownGridOf(layout, seed, prov.importedAt),
  };
}
/** TEST DOUBLE: a synthetic song record of `seconds` with synthetic beats at 120 BPM from 0.5 s (bar starts every four). */
function withSongAsset(doc: ProjectDocument, id: string, seconds: number): ProjectDocument {
  doc.assets[id] = { ...song(id, seconds), id } as Asset;
  return withBeats(doc, id, beatTimes(120, Math.floor(seconds * 2) - 2, { first: 500 }));
}
/** A project with one picture clip of `pictureFrames` and one music clip of `musicAsset` from 0. */
function scene(o: { pictureFrames: number; songSeconds?: number; musicFrames?: number; rate?: { num: number; den: number } } ) {
  const rate = o.rate ?? R;
  let doc = createProject({ id: 'prj_ms', name: 'ms', width: 320, height: 180, frameRate: rate });
  doc.assets.vid = { id: 'vid', kind: 'video', name: 'v.mp4', contentHash: hash(1), byteSize: 10, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(600, 1), video: { width: 320, height: 180, frameRate: rate, codec: 'h264', rotation: 0, frameCount: null }, provenance: prov } as Asset;
  doc = withSongAsset(doc, 'old', o.songSeconds ?? 120);
  const a = tx(doc, [{ op: 'add_clip', args: { assetId: 'vid', start: T.ZERO, duration: f(o.pictureFrames, rate), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: 'old', start: T.ZERO, duration: f(o.musicFrames ?? o.pictureFrames, rate) } }]);
  return { doc: a.doc, clipId: String(a.results[1]!.output!.clipId) };
}
const clipOf = (doc: ProjectDocument, id: string) => findClip(doc, id)!.clip as MediaClip;
/** Apply as ONE transaction, check the project, undo by restoring the changed entities: the creative projection is the one before. */
function oneUndo(doc: ProjectDocument, ops: OpCall[]) {
  const r = tx(doc, ops);
  expect(validateProject(r.doc)).toEqual([]);
  const back = structuredClone(r.doc);
  restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
  expect(creativeProjection(back)).toBe(creativeProjection(doc));
  return r.doc;
}

describe('musicEndingFor / endsExactly (decisions §2.4): the end is min(target, the file floored to a frame); a fade only when the file is cut', () => {
  it('a file that ends on the target frame: no cut, no fade; a longer file: cut with one second (at most half the clip); a shorter: its own end', () => {
    const exact = { duration: T.rt(sampleFramesFor(f(301)), 48000) };
    expect(musicEndingFor(R, exact, T.ZERO, T.ZERO, f(301))).toMatchObject({ cut: false, fadeOut: T.ZERO });
    expect(T.eq(musicEndingFor(R, exact, T.ZERO, T.ZERO, f(301)).end, f(301))).toBe(true);
    const long = musicEndingFor(R, { duration: T.rt(20, 1) }, T.ZERO, T.ZERO, f(301));
    expect([long.cut, frames(long.fadeOut), frames(long.end)]).toEqual([true, 30, 301]);
    expect(frames(musicEndingFor(R, { duration: T.rt(20, 1) }, T.ZERO, T.ZERO, f(41)).fadeOut)).toBe(20); // half of 41 frames, floored
    const short = musicEndingFor(R, { duration: T.rt(5, 1) }, f(10), T.ZERO, f(301));
    expect([short.cut, frames(short.end), frames(short.fadeOut)]).toEqual([false, 160, 0]);
    expect(() => musicEndingFor(R, { duration: T.rt(1, 1) }, f(10), T.rt(1, 1), f(301))).toThrow(OpError);
  });
  it('at 30000/1001 the file of ceil(D·48000) samples floors to the target frame exactly', () => {
    const N = { num: 30000, den: 1001 };
    for (const n of [1, 299, 1921, 3600]) {
      const asset = { duration: T.rt(sampleFramesFor(f(n, N)), 48000) };
      const e = musicEndingFor(N, asset, T.ZERO, T.ZERO, f(n, N));
      expect([e.cut, T.eq(e.end, f(n, N))]).toEqual([false, true]);
    }
  });
  it('endsExactly: a shortened song always; built-in music only when its floored end is the target frame; never a plain song', () => {
    const b = builtin('music.festive', 4).asset;
    const end = T.frameTime(T.frameIndexAt(b.duration, R), R);
    expect(endsExactly(R, b, T.ZERO, T.ZERO, end)).toBe(true);
    expect(endsExactly(R, b, T.ZERO, T.ZERO, T.sub(end, f(1)))).toBe(false);
    const plain = { duration: T.rt(10, 1), provenance: prov } as unknown as Asset;
    expect(endsExactly(R, plain, T.ZERO, T.ZERO, f(300))).toBe(false);
    const fitted = { ...plain, provenance: { ...prov, origin: 'derived', fitted: {} } } as unknown as Asset;
    expect(endsExactly(R, fitted, T.ZERO, T.ZERO, f(10))).toBe(true);
  });
});

describe('musicEndingSteps: existing public ops only (trim_clip, set_clip_fades)', () => {
  it('a long song cut at the picture end gets a trim and the one-second fade; exact undo', () => {
    const s = scene({ pictureFrames: 300, musicFrames: 200 });
    const e = musicEndingSteps(s.doc, s.clipId, f(300));
    expect(e.steps.map((x) => x.op)).toEqual(['trim_clip', 'set_clip_fades']);
    expect(e.cut).toBe(true);
    const doc = oneUndo(s.doc, e.steps);
    expect([frames(clipOf(doc, s.clipId).duration), frames(clipOf(doc, s.clipId).fadeOut)]).toEqual([300, 30]);
  });
  it('a file that ends on the target: no fade, and a fade-out it had is removed; nothing to do when it already ends so', () => {
    let doc = createProject({ id: 'prj_e', name: 'e', width: 320, height: 180, frameRate: R });
    const lay = exactLayoutFor('music.festive', sampleFramesFor(f(250)));
    const made = builtin('music.festive', lay.bars, lay.endFrames);
    const a = tx(doc, [{ op: 'add_builtin_music', args: { ...made, place: { start: T.ZERO } } }]);
    doc = a.doc;
    const clipId = String(a.results[0]!.output!.clipId);
    expect(frames(clipOf(doc, clipId).duration)).toBe(250);
    expect(musicEndingSteps(doc, clipId, f(250)).steps).toEqual([]);
    doc = tx(doc, [{ op: 'set_clip_fades', args: { clipId, fadeOut: f(30) } }]).doc;
    const e = musicEndingSteps(doc, clipId, f(250));
    expect(e.steps).toEqual([{ op: 'set_clip_fades', args: { clipId, fadeOut: T.ZERO } }]);
    expect(clipOf(oneUndo(doc, e.steps), clipId).fadeOut).toBeUndefined();
  });
  it('refuses music that plays backwards or at another speed (notFollowable), and an end off the frame grid', () => {
    const s = scene({ pictureFrames: 300 });
    const rev = tx(s.doc, [{ op: 'set_clip_reverse', args: { clipId: s.clipId, reverse: true } }]).doc;
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? [e.code, e.message] : 'other'; } return 'none'; };
    expect(code(() => musicEndingSteps(rev, s.clipId, f(300)))).toEqual(['incompatible', 'music that plays backwards or at another speed cannot be fitted or swapped']);
    const fast = tx(s.doc, [{ op: 'set_clip_speed', args: { clipId: s.clipId, speed: 2 } }]).doc;
    expect(code(() => planMusicSwap(fast, s.clipId, 'old'))[1]).toMatch(/backwards or at another speed/);
    expect(code(() => musicEndingSteps(s.doc, s.clipId, T.rt(1, 7)))[0]).toBe('invalid_args');
  });
});

describe('planMusicSwap: trim (only when the new file is shorter), replace_clip_media, the ending; one transaction, exact undo', () => {
  it('a shorter new song: trimmed first, then replaced from its first bar start, ending with its own end (no fade)', () => {
    const s = scene({ pictureFrames: 900 });
    const doc = withSongAsset(s.doc, 'short', 20);
    const p = planMusicSwap(doc, s.clipId, 'short', { to: f(900) });
    expect(p.steps.map((x) => x.op)).toEqual(['trim_clip', 'replace_clip_media']);
    expect(T.eq(p.sourceIn, T.rt(500, 1000))).toBe(true); // the first synthetic bar start
    expect(p.cut).toBe(false);
    const out = oneUndo(doc, p.steps);
    const c = clipOf(out, s.clipId);
    expect([c.assetId, frames(T.add(c.start, c.duration))]).toEqual(['short', frames(T.sub(T.rt(20, 1), T.rt(1, 2)))]);
    expect(c.fadeOut).toBeUndefined();
  });
  it('a longer song cut at `to` gets the fade; volume keys that fall after the new end are counted, the clip keeps id, gain and place', () => {
    const s = scene({ pictureFrames: 600 });
    let doc = withSongAsset(s.doc, 'long', 100);
    doc = tx(doc, [{ op: 'set_clip_gain', args: { clipId: s.clipId, gain: 0.5 } }, { op: 'set_volume_keyframe', args: { clipId: s.clipId, time: f(100), value: 1 } }, { op: 'set_volume_keyframe', args: { clipId: s.clipId, time: f(500), value: 0.2 } }]).doc;
    const p = planMusicSwap(doc, s.clipId, 'long', { to: f(300) });
    expect(p.steps.map((x) => x.op)).toEqual(['replace_clip_media', 'trim_clip', 'set_clip_fades']);
    expect([p.cut, p.droppedVolumeKeys]).toEqual([true, 1]);
    const c = clipOf(oneUndo(doc, p.steps), s.clipId);
    expect([c.id, c.gain, frames(c.start), frames(c.duration), frames(c.fadeOut)]).toEqual([s.clipId, 0.5, 0, 300, 30]);
  });
  it('the marked moment is cleared by replace_clip_media (another file), as the pre-pass made it', () => {
    const s = scene({ pictureFrames: 300 });
    const doc = withSongAsset(s.doc, 'other', 60);
    (findClip(doc, s.clipId)!.clip as MediaClip).impact = T.rt(2, 1);
    const c = clipOf(tx(doc, planMusicSwap(doc, s.clipId, 'other').steps).doc, s.clipId);
    expect(c.impact).toBeUndefined();
  });
});

// ---------- the template's exact ending ----------
const words = (en: string) => ({ he: `${en} (עברית)`, en });
type Slot = TemplateDef['slots'][number];
const slot = (i: number, span: Slot['span']): Slot => ({ key: `s${i}`, role: words(`Slot ${i}`), accept: 'any', span });
const TPL = (slots: Slot[]): TemplateDef => ({
  id: 'tpl.mftest', version: 1, name: words('Fit test'), hint: words('A template for this test'), genre: 'celebration', designedFor: 'tall', tempo: { fallbackBpm: 125 },
  music: { need: 'optional', startAt: 'zero' }, slots, slotUse: { mode: 'all', min: 1 }, texts: [], elements: [], sfx: [], adjust: [],
});
function tplProject(rate = R): ProjectDocument {
  const doc = createProject({ id: 'prj_mt', name: 'mt', width: 540, height: 960, frameRate: rate });
  for (const [i, id] of ['va', 'vb', 'vc'].entries()) doc.assets[id] = { id, kind: 'video', name: `${id}.mp4`, contentHash: hash(10 + i), byteSize: 10, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(120, 1), video: { width: 540, height: 960, frameRate: rate, codec: 'h264', rotation: 0, frameCount: null }, provenance: prov } as Asset;
  return doc;
}
const musicStep = (plan: TemplatePlan) => plan.ops.find((o) => o.bind === 'music' && o.op === 'add_clip')!;

describe('template builtinMusic.ending "exact" (decisions §2.2, B4)', () => {
  it('the track is asked for exactly the pictures (bars and endFrames from exactLayoutFor); no fade, no builtin_music_faded; applied, the clip ends on the last picture frame', () => {
    for (const rate of [R, { num: 30000, den: 1001 }, { num: 24, den: 1 }]) {
      const doc = tplProject(rate);
      const def = TPL([slot(1, { bars: 2 }), slot(2, { bars: 2 }), slot(3, { beats: 6 })]);
      const plan = planTemplate(doc, def, { media: ['va', 'vb', 'vc'], builtinMusic: { styleId: 'music.festive', seed: 3, ending: 'exact' } });
      const need = plan.assetsNeeded.find((n) => n.kind === 'music')!;
      const pictures = plan.predicted.endFrame - plan.predicted.startFrame;
      const want = exactLayoutFor('music.festive', sampleFramesFor(T.frameTime(pictures, rate)));
      expect(need).toMatchObject({ id: 'music.festive', seed: 3, bars: want.bars, endFrames: want.endFrames });
      expect(frames((musicStep(plan).args as { duration: T.RationalTime }).duration, rate)).toBe(pictures);
      expect(plan.ops.some((o) => o.op === 'set_clip_fades' || o.op === 'fit_music')).toBe(false);
      expect(plan.notices.map((x) => x.code)).not.toContain('builtin_music_faded');
      // the default (no ending) is unchanged: whole bars, cut and faded
      const plain = planTemplate(doc, def, { media: ['va', 'vb', 'vc'], builtinMusic: { styleId: 'music.festive', seed: 3 } });
      expect(plain.assetsNeeded.find((n) => n.kind === 'music')).not.toHaveProperty('endFrames');
      expect(plain.notices.map((x) => x.code)).toContain('builtin_music_faded');
      const m = builtin(need.id, need.bars, (need as { endFrames?: number }).endFrames, 3, 77);
      const r = tx(doc, [{ op: 'apply_template', args: { templateId: plan.templateId, templateVersion: plan.version, params: plan.params, steps: plan.steps, assets: [{ key: need.key, asset: m.asset, analysis: m.grid }], ops: plan.ops, slots: plan.slots } }]);
      expect(validateProject(r.doc)).toEqual([]);
      const clip = Object.values(r.doc.sequences).flatMap((q) => q.tracks).filter((t) => t.kind === 'audio').flatMap((t) => t.clips)[0] as MediaClip;
      expect(frames(T.add(clip.start, clip.duration), rate)).toBe(plan.predicted.endFrame);
      expect(clip.fadeOut).toBeUndefined();
      // the file is at most one sample longer than the clip
      expect(sampleFramesFor(m.asset.duration) - sampleFramesFor(clip.duration)).toBeLessThanOrEqual(1);
    }
  });
  it('pictures shorter than the style\'s shortest exact track are refused with the length it needs, never made as a faded track', () => {
    const doc = tplProject();
    expect(() => planTemplate(doc, TPL([slot(1, { beats: 2 }), slot(2, { beats: 2 })]), { media: ['va', 'vb'], builtinMusic: { styleId: 'music.festive', ending: 'exact' } })).toThrow(/too short for "Festive" with its own ending: it needs at least/);
  });
  it('a shortened song (provenance.fitted) as the template\'s music ends with its own end or exactly at the pictures, not on an earlier beat', () => {
    let doc = tplProject();
    doc = withSongAsset(doc, 'fit', 9);
    doc.assets.fit = { ...doc.assets.fit!, provenance: { ...prov, origin: 'derived' } } as Asset;
    (doc.assets.fit!.provenance as Record<string, unknown>).fitted = { sourceAssetId: 'x' };
    const def = { ...TPL([slot(1, { bars: 2 }), slot(2, { bars: 2 })]), music: { need: 'beats' as const, startAt: 'zero' as const } };
    const plan = planTemplate(doc, def, { media: ['va', 'vb'], musicAssetId: 'fit' });
    expect(plan.ops.some((o) => o.op === 'fit_music')).toBe(false);
    expect((musicStep(plan).args as { duration?: unknown }).duration).toBeDefined();
  });
});

// ---------- the family film: musicGridSteady and the exact ending ----------
function filmDoc(n: number): ProjectDocument {
  let doc = filmProject(R);
  for (let i = 0; i < n; i++) {
    const id = `v${i}`;
    doc.assets[id] = video(id, 12);
    const fr = videoFrames(doc.assets[id]!)!;
    doc = withMoments(doc, id, { windows: [win({ peakFrame: Math.floor(fr / 2), fromFrame: Math.floor(fr / 4), toFrame: Math.floor((3 * fr) / 4), motion: 20 + i })], measured: { picture: true, sound: false } });
  }
  return doc;
}
const addBuiltin = (doc: ProjectDocument, m: { asset: Omit<Asset, 'id'>; grid: KnownGrid }) => { const r = tx(doc, [{ op: 'add_builtin_music', args: m }]); return { doc: r.doc, id: String(r.results[0]!.output!.assetId) }; };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);

describe('family film: musicGridSteady (decisions §2.5) and the exact ending (§2.4)', () => {
  it('without the flag a short built-in track ends the film early (music_short); with it the film is cut on the style\'s steady grid past the file\'s end', () => {
    const short = addBuiltin(filmDoc(10), builtin('music.festive', 8));
    const params = { assetIds: ids(10), musicAssetId: short.id, targetSeconds: 30 as const, order: 'given' as const, closingCard: false, openingTitle: false };
    const plain = planFamilyFilm(short.doc, params, emptyCtx());
    expect(plain.warnings.map((w) => w.code)).toContain('music_short');
    const steady = planFamilyFilm(short.doc, params, { ...emptyCtx(), musicGridSteady: true });
    expect(steady.warnings.map((w) => w.code)).not.toContain('music_short');
    expect(steady.predicted.endFrame).toBeGreaterThan(plain.predicted.endFrame);
    // the film's cuts and end do not depend on the track's length: a longer track of the same style gives the same plan
    const long = addBuiltin(filmDoc(10), builtin('music.festive', 40, undefined, 1, 2));
    const again = planFamilyFilm(long.doc, { ...params, musicAssetId: long.id }, { ...emptyCtx(), musicGridSteady: true });
    expect([again.predicted.endFrame, again.predicted.cuts]).toEqual([steady.predicted.endFrame, steady.predicted.cuts]);
  });
  it('a track made for exactly the film\'s length is placed with an explicit length and no fit_music or fade; applied, it ends on the film\'s last frame', () => {
    const probe = addBuiltin(filmDoc(10), builtin('music.festive', 8));
    const params = { assetIds: ids(10), targetSeconds: 30 as const, order: 'given' as const };
    const first = planFamilyFilm(probe.doc, { ...params, musicAssetId: probe.id }, { ...emptyCtx(), musicGridSteady: true });
    const lay = exactLayoutFor('music.festive', sampleFramesFor(T.frameTime(first.predicted.endFrame - first.predicted.startFrame, R)));
    const exact = addBuiltin(filmDoc(10), builtin('music.festive', lay.bars, lay.endFrames, 1, 3));
    const plan = planFamilyFilm(exact.doc, { ...params, musicAssetId: exact.id }, { ...emptyCtx(), musicGridSteady: true });
    expect(plan.predicted.endFrame).toBe(first.predicted.endFrame);
    const music = plan.ops.find((o) => o.bind === FILM_BINDS.music)!;
    expect(frames((music.args as { duration: T.RationalTime }).duration)).toBe(plan.predicted.endFrame - plan.predicted.startFrame);
    expect(plan.ops.some((o) => o.op === 'fit_music')).toBe(false);
    expect(plan.ops.some((o) => o.op === 'set_clip_fades' && JSON.stringify(o.args).includes(FILM_BINDS.music))).toBe(false);
  });
  it('plain songs are planned as before: fit_music at the end of the film', () => {
    let doc = filmDoc(6);
    doc = withSongAsset(doc, 'mus', 200);
    const plan = planFamilyFilm(doc, { assetIds: ids(6), musicAssetId: 'mus', targetSeconds: 30 }, emptyCtx());
    expect(plan.ops.some((o) => o.op === 'fit_music')).toBe(true);
  });
});
