/**
 * Builder B of the musicfit track (wave 7; .artifacts/wave7/musicfit-decisions.md §2–§4): plan and apply for a free music clip, a
 * family film and a template run, called directly (the routes answer 501 until the lead flips MUSICFIT_SERVER_BUILT at integration).
 *
 * LABELLED TEST DOUBLES (musicFitDeps): builder A's makers and pure functions are not merged in this worktree, so
 * - makeMusic is a double that returns the RECORD makeMusic would store for the request (the layout's exact duration and known grid,
 *   a content hash of the request), with no synthesis and no file: core and these planners never read the bytes;
 * - cutStats is a double that counts the cut frames (count, the shortest gap, the most in one second);
 * - planImpact is a double that reports 0 frames under the original song and 3 frames under any other music;
 * - the template's sound effects and elements are stand-in records (procStandIn), never rendered;
 * - the song fitter is a double that offers one removal of two bars and records whether it was asked.
 * Every library item is a synthetic record with a licence id from the core table. Nothing here is heard.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  exactLayoutFor, findClip, musicLayout, planTemplate, sampleFramesFor, TEMPLATES,
  type Asset, type JoinCandidate, type LibraryRecord, type MediaClip, type MusicFitApplyRequest, type MusicRequest, type ProjectDocument,
} from '@pulseframe/core';
import { Governance, type Principal } from '../governance.ts';
import { ApiError, Store } from '../store.ts';
import { applyFamilyFilmFor, regenerateFamilyFilmFor } from '../familyFilm.ts';
import { builtinStandIn, cutsOf, flashRule, musicFitDeps, prepareMusicFit, procStandIn, type MusicFitDeps } from './plan.ts';
import { applyMusicFit } from './apply.ts';
import { MUSICFIT_SERVER_BUILT } from './routes.ts';

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const nf = (t: T.RationalTime) => T.nearestFrameIndex(t, R);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00.000Z', importedBy: 'test' };
let dir: string, store: Store, gov: Governance;
const real: MusicFitDeps = { ...musicFitDeps };
const calls = { makeMusic: 0, candidates: 0, make: 0 };

/** DOUBLE of makeMusic: the record the real one stores for this request (exact duration, known grid), no synthesis. */
const makeMusicDouble: MusicFitDeps['makeMusic'] = async (_store, req: MusicRequest) => {
  calls.makeMusic++;
  const s = builtinStandIn(req.styleId, req.seed ?? 1, req.bars!, req.endFrames);
  return { asset: { ...s.asset, contentHash: `sha256:${'d'.repeat(48)}${String(req.bars).padStart(8, '0')}${String(req.endFrames ?? 0).padStart(8, '0')}` }, grid: s.grid, layout: musicLayout(req.styleId, req.bars!, req.endFrames) };
};
/** DOUBLE of cutStats (builder A): count, shortest gap, most cuts in one second. */
const cutStatsDouble: MusicFitDeps['cutStats'] = (frames, fps) => {
  const s = [...frames].sort((a, b) => a - b);
  let min: number | null = null, most = 0;
  for (let i = 0; i < s.length; i++) { if (i) min = Math.min(min ?? Infinity, s[i]! - s[i - 1]!); most = Math.max(most, s.filter((x) => x >= s[i]! && x < s[i]! + fps).length); }
  return { cuts: s.length, minGapFrames: min, maxInOneSecond: most };
};
/** DOUBLE of planImpact (builder A): 0 frames from the beat under the song 'old', 3 under anything else. */
const planImpactDouble: MusicFitDeps['planImpact'] = (doc, clipId) => {
  const music = Object.values(doc.sequences).flatMap((q) => q.tracks).filter((t) => t.kind === 'audio').flatMap((t) => t.clips)[0] as MediaClip | undefined;
  const asset = music ? doc.assets[music.assetId] : undefined;
  if (asset?.name === 'old.wav') return { refusal: 'alreadyOnBeat', details: { clipId } };
  return { clipId, moment: T.ZERO, momentFrame: 0, targetFrame: 3, by: f(3), offsetBefore: { frames: 3, ms: 100 }, residualMs: 0, musicClipId: music?.id ?? '', viaAssetId: asset?.id ?? '', wanted: T.ZERO, used: T.ZERO };
};
const candidate: JoinCandidate = { removal: { from: T.rt(4, 1), to: T.rt(8, 1) }, madeSeconds: 9.5, offBySeconds: -0.5, measured: { similarity: 0.42, levelStepDb: 0.5, phraseBars: 2, tempoSpreadMs: 3, beatConfidence: 0.9 } };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-musicfit-b-'));
  store = new Store(dir);
  gov = new Governance(store);
});
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const useDoubles = () => {
  Object.assign(musicFitDeps, { makeMusic: makeMusicDouble, makeTemplateAssets: async (_s: Store, _p: Principal, plan: { assetsNeeded: Parameters<typeof procStandIn>[0][] }) => plan.assetsNeeded.map((n) => ({ key: n.key, ...procStandIn(n) })), cutStats: cutStatsDouble, planImpact: planImpactDouble, songFitter: {
    candidates: async () => { calls.candidates++; return { candidates: [candidate], basis: ['double: one candidate'] }; },
    make: async () => { calls.make++; throw new Error('the double makes no file'); },
  } } satisfies Partial<MusicFitDeps>);
  calls.makeMusic = calls.candidates = calls.make = 0;
};
afterEach(() => { Object.assign(musicFitDeps, real); });

const sound = (name: string, seconds: number, over: Partial<Asset['provenance']> = {}): Omit<Asset, 'id'> => ({ kind: 'audio', name, contentHash: `sha256:${Buffer.from(name).toString('hex').padEnd(64, '0').slice(0, 64)}`, byteSize: 100, container: 'wav', mimeType: 'audio/wav', duration: T.rt(seconds, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { ...prov, ...over } } as Omit<Asset, 'id'>);
const videoAsset = (name: string, seconds: number): Omit<Asset, 'id'> => ({ kind: 'video', name, contentHash: `sha256:${Buffer.from(name).toString('hex').padEnd(64, '1').slice(0, 64)}`, byteSize: 100, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1), video: { width: 320, height: 180, frameRate: R, codec: 'h264', rotation: 0, frameCount: null }, provenance: prov } as Omit<Asset, 'id'>);
const record = (licence: string, over: Partial<LibraryRecord> = {}): LibraryRecord => ({ itemId: 'src-a/song.wav', sourceId: 'src-a', kind: 'music', title: 'Song A', sourceSha256: 'a'.repeat(64), ledger: { item: 'src-a' }, licence: { id: licence }, credit: { text: '"Song A" by Someone', placement: 'description' }, flags: {}, ...over });
const commit = (pid: string, ops: { op: string; args: unknown }[]) => store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops });
const beatsOps = (assetId: string, seconds: number) => {
  const times = Array.from({ length: seconds * 2 - 1 }, (_, i) => T.rt(i, 2));
  return { op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'synthetic test beats', params: {}, createdAt: prov.importedAt, times, bpm: 120, confidence: 0.9, downbeats: times.filter((_, i) => i % 4 === 0), meter: 4 } };
};
const doc = (pid: string) => store.getProject(pid).doc;
const rev = (pid: string) => store.getProject(pid).revision;
const clip = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;
const refusal = async (p: Promise<unknown>): Promise<ApiError> => { try { await p; } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error('not refused'); };

/** A project with a 10 s picture and one music clip (`kind`: a built-in track from 0, or the song 'old' with beats). */
function freeScene(name: string, kind: 'builtin' | 'song', pictureFrames = 300) {
  const pid = store.createProject({ name, width: 320, height: 180, frameRate: R }).doc.id;
  const v = String(commit(pid, [{ op: 'import_asset', args: { asset: videoAsset(`${name}-v.mp4`, 60) } }]).results[0]!.output!.assetId);
  commit(pid, [{ op: 'add_clip', args: { assetId: v, start: T.ZERO, duration: f(pictureFrames), withLinkedAudio: false } }]);
  if (kind === 'builtin') {
    const s = builtinStandIn('music.festive', 1, 8);
    const r = commit(pid, [{ op: 'add_builtin_music', args: { ...s, place: { start: T.ZERO } } }]);
    return { pid, clipId: String(r.results[0]!.output!.clipId), assetId: String(r.results[0]!.output!.assetId) };
  }
  const a = String(commit(pid, [{ op: 'import_asset', args: { asset: sound('old.wav', 120) } }]).results[0]!.output!.assetId);
  commit(pid, [beatsOps(a, 120)]);
  const c = String(commit(pid, [{ op: 'add_clip', args: { assetId: a, start: T.ZERO, duration: f(200) } }]).results[0]!.output!.clipId);
  return { pid, clipId: c, assetId: a };
}
const applyReq = (pid: string, body: Omit<MusicFitApplyRequest, 'expectedRevision'>, expectedRevision = rev(pid)): MusicFitApplyRequest => ({ ...body, expectedRevision });

describe('music fit: plan and apply (builder B)', () => {
  it('the routes stay 501 until the lead flips the flag at integration', () => { expect(MUSICFIT_SERVER_BUILT).toBe(false); });

  it('free clip, built-in, tailored: the plan says exact and composed again; apply makes TWO commits; the clip ends on the last picture frame with no fade; one undo leaves the made file', async () => {
    useDoubles();
    const s = freeScene('mf-free', 'builtin');
    const plan = (await prepareMusicFit(store, s.pid, doc(s.pid), rev(s.pid), { target: { clipId: s.clipId }, music: { keep: true }, tailor: true })).plan;
    const want = exactLayoutFor('music.festive', sampleFramesFor(f(300)));
    expect(plan.make).toEqual({ kind: 'builtin', styleId: 'music.festive', seed: 1, bars: want.bars, endFrames: want.endFrames });
    expect(plan.ending).toEqual({ kind: 'exact', seconds: 0 });
    expect(plan.warnings.map((w) => w.code)).toEqual(['composed_again']);
    expect(calls.makeMusic).toBe(0); // planning makes nothing
    const before = rev(s.pid);
    const out = await applyMusicFit(store, gov, USER, s.pid, applyReq(s.pid, { target: { clipId: s.clipId }, music: { keep: true }, tailor: true }));
    expect([out.madeRevision, out.revision]).toEqual([before + 1, before + 2]);
    const c = clip(doc(s.pid), s.clipId);
    expect([c.assetId, nf(T.add(c.start, c.duration)), c.fadeOut]).toEqual([out.madeAssetId, 300, undefined]);
    store.undo(s.pid, USER.actor, 'undo');
    expect(clip(doc(s.pid), s.clipId).assetId).toBe(s.assetId);
    expect(doc(s.pid).assets[out.madeAssetId!]).toBeDefined(); // the made file stays in the library (ADR-0022)
  });

  it('a stale expectedRevision answers 409 and nothing is made or changed; a propose-mode agent is refused 403 before anything', async () => {
    useDoubles();
    const s = freeScene('mf-stale', 'builtin');
    const before = rev(s.pid);
    const e = await refusal(applyMusicFit(store, gov, USER, s.pid, applyReq(s.pid, { target: { clipId: s.clipId }, music: { keep: true }, tailor: true }, before - 1)));
    expect([e.status, e.code]).toEqual([409, 'stale_revision']);
    const propose = gov.principalForToken(gov.createGrant({ name: 'p', mode: 'propose' }, USER).token)!;
    const p = await refusal(applyMusicFit(store, gov, propose, s.pid, applyReq(s.pid, { target: { clipId: s.clipId }, music: { keep: true }, tailor: true })));
    expect([p.status, p.code]).toEqual([403, 'insufficient_scope']);
    expect([rev(s.pid), calls.makeMusic]).toEqual([before, 0]);
  });

  it('the plan made twice: a made file that differs from the plan refuses fit_unstable and NOTHING is committed (not even the file)', async () => {
    useDoubles();
    // a deliberately wrong maker: it ignores endFrames and makes the style's shortest track, so the second plan ends earlier
    musicFitDeps.makeMusic = async (st, req, actor) => makeMusicDouble(st, { styleId: req.styleId, bars: 4, seed: req.seed ?? 1 }, actor);
    const s = freeScene('mf-unstable', 'builtin', 600);
    const before = rev(s.pid);
    const e = await refusal(applyMusicFit(store, gov, USER, s.pid, applyReq(s.pid, { target: { clipId: s.clipId }, music: { keep: true }, tailor: true })));
    expect([e.status, e.code]).toEqual([409, 'fit_unstable']);
    expect(rev(s.pid)).toBe(before);
  });

  it('built-in music is composed from its start: a clip that starts later in its file is refused not_from_start; a film too short is too_short with the length', async () => {
    useDoubles();
    const s = freeScene('mf-nfs', 'builtin');
    commit(s.pid, [{ op: 'trim_clip', args: { clipId: s.clipId, edge: 'start', to: f(15) } }]);
    const e = await refusal(prepareMusicFit(store, s.pid, doc(s.pid), rev(s.pid), { target: { clipId: s.clipId }, music: { keep: true }, tailor: true }));
    expect([e.status, e.code]).toEqual([409, 'not_from_start']);
    const t = freeScene('mf-short', 'builtin', 60);
    const short = await refusal(prepareMusicFit(store, t.pid, doc(t.pid), rev(t.pid), { target: { clipId: t.clipId }, music: { builtin: { styleId: 'music.festive' } }, tailor: true }));
    expect([short.status, short.code]).toEqual([400, 'too_short']);
    expect(short.message).toMatch(/it needs at least [\d.]+ s/);
  });

  it('a library song: the licence refusal comes before the join search (no-derivatives, share-alike, unknown); CC BY and CC0 reach the search; a song without bar starts is needs_bars', async () => {
    useDoubles();
    const s = freeScene('mf-lic', 'song');
    const add = (name: string, rec: LibraryRecord | null, beats = true) => {
      const id = String(commit(s.pid, [{ op: 'import_asset', args: { asset: sound(name, 60, rec ? { origin: 'upload', library: rec } : {}) } }]).results[0]!.output!.assetId);
      if (beats) commit(s.pid, [beatsOps(id, 60)]);
      return id;
    };
    // a record the project would not even accept on import is written onto a copy of the document: the plan must refuse it anyway
    const base = add('refused.wav', record('CC-BY-4.0'));
    for (const [licence, key] of [['CC-BY-ND-4.0', /forbids changing it/], ['CC-BY-SA-4.0', /same licence/], ['LicenseRef-not-in-table', /not one the editor knows/]] as const) {
      const d = structuredClone(doc(s.pid));
      (d.assets[base]!.provenance.library as LibraryRecord).licence = { id: licence };
      const e = await refusal(prepareMusicFit(store, s.pid, d, rev(s.pid), { target: { clipId: s.clipId }, music: { assetId: base }, tailor: true }));
      expect([e.code, e.message]).toEqual(['incompatible', expect.stringMatching(key)]);
    }
    expect(calls.candidates).toBe(0);
    for (const licence of ['CC-BY-4.0', 'CC0-1.0']) {
      const id = add(`${licence}.wav`, record(licence));
      const plan = (await prepareMusicFit(store, s.pid, doc(s.pid), rev(s.pid), { target: { clipId: s.clipId }, music: { assetId: id }, tailor: true })).plan;
      expect(plan.make).toMatchObject({ kind: 'fitted', sourceAssetId: id, chosen: 0 });
      // a measured similarity below the guess warns join_weak; the basis says it is measured, not heard
      expect(plan.warnings.map((w) => w.code)).toContain('join_weak');
      expect(plan.basis.join('\n')).toMatch(/Measured, not heard/);
      expect(plan.ending).toEqual({ kind: 'early', seconds: 0.5 });
    }
    const bare = add('nobars.wav', null, false);
    const nb = await refusal(prepareMusicFit(store, s.pid, doc(s.pid), rev(s.pid), { target: { clipId: s.clipId }, music: { assetId: bare }, tailor: true }));
    expect(nb.code).toBe('needs_bars');
    // a removal that is not one of the current candidates is stale
    const by = add('by.wav', record('CC-BY-4.0'));
    const st = await refusal(prepareMusicFit(store, s.pid, doc(s.pid), rev(s.pid), { target: { clipId: s.clipId }, music: { assetId: by }, tailor: true, removal: { from: T.rt(1, 1), to: T.rt(2, 1) } }));
    expect(st.code).toBe('fit_stale');
  });

  it('a song fit is applied only once builder A\'s file maker and add_fitted_music exist: before that it refuses and nothing changes', async () => {
    useDoubles();
    musicFitDeps.songFitter = null;
    const s = freeScene('mf-nofit', 'song');
    const id = String(commit(s.pid, [{ op: 'import_asset', args: { asset: sound('own.wav', 60) } }]).results[0]!.output!.assetId);
    commit(s.pid, [beatsOps(id, 60)]);
    const before = rev(s.pid);
    const e = await refusal(applyMusicFit(store, gov, USER, s.pid, applyReq(s.pid, { target: { clipId: s.clipId }, music: { assetId: id }, tailor: true })));
    expect([e.status, e.code]).toEqual([501, 'musicfit_not_built']);
    expect(rev(s.pid)).toBe(before);
  });

  it('a swap without tailoring: one transaction of public ops; volume keys after the new end are counted; the impacts are listed with their offsets', async () => {
    useDoubles();
    const s = freeScene('mf-swap', 'song');
    const id = String(commit(s.pid, [{ op: 'import_asset', args: { asset: sound('new.wav', 5) } }]).results[0]!.output!.assetId);
    commit(s.pid, [beatsOps(id, 5), { op: 'set_volume_keyframe', args: { clipId: s.clipId, time: f(180), value: 0.5 } }]);
    // a marked moment on the picture (synthetic: set on the record, as set_clip_impact will write it)
    const v = doc(s.pid).sequences[doc(s.pid).mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.clips[0]!.id;
    const d = structuredClone(doc(s.pid));
    (findClip(d, v)!.clip as MediaClip).impact = T.rt(1, 1);
    const p = await prepareMusicFit(store, s.pid, d, rev(s.pid), { target: { clipId: s.clipId }, music: { assetId: id }, tailor: false });
    expect(p.plan.make).toEqual({ kind: 'none' });
    expect(p.plan.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['music_keys_dropped', 'impacts_off_beat']));
    expect(p.plan.impacts).toEqual([{ clipId: v, framesFromBeatBefore: 0, framesFromBeatAfter: 3 }]);
    const before = rev(s.pid);
    const out = await applyMusicFit(store, gov, USER, s.pid, applyReq(s.pid, { target: { clipId: s.clipId }, music: { assetId: id }, tailor: false }));
    expect([out.revision, out.madeAssetId]).toEqual([before + 1, null]);
    expect(clip(doc(s.pid), s.clipId).assetId).toBe(id);
  });
});

describe('the flash rule (C10): only a cut this plan makes blocks', () => {
  const withPictures = (starts: number[]) => {
    const d = { settings: { frameRate: R }, mainSequenceId: 's', sequences: { s: { tracks: [{ kind: 'video', clips: starts.map((st, i) => ({ id: `c${st}_${i}`, start: f(st), duration: f(5) })) }] } } } as unknown as ProjectDocument;
    return d;
  };
  it('a made cut 3 frames from another blocks flash_gap; two kept cuts that close only warn kept_cuts_close', () => {
    const before = withPictures([0, 30, 33]);
    const sameIds = structuredClone(before);
    expect(flashRule(before, sameIds, 's')).toMatchObject({ blocking: [], warnings: [{ code: 'kept_cuts_close' }] });
    const after = withPictures([0, 30, 60]);
    (after.sequences.s!.tracks[0]!.clips as { id: string }[])[2]!.id = 'new';
    after.sequences.s!.tracks[0]!.clips.push({ id: 'new2', start: f(63), duration: f(5) } as never);
    const r = flashRule(before, after, 's');
    expect(r.blocking.map((b) => b.code)).toEqual(['flash_gap']);
    expect(r.blocking[0]!.details.pairs).toEqual([[60, 63]]);
    expect([...cutsOf(after, 's').keys()]).toEqual([0, 30, 60, 63]);
  });
});

describe('family film and template runs', () => {
  function filmProject(name: string) {
    const pid = store.createProject({ name, width: 320, height: 180, frameRate: R }).doc.id;
    const ids = Array.from({ length: 8 }, (_, i) => String(commit(pid, [{ op: 'import_asset', args: { asset: videoAsset(`${name}-${i}.mp4`, 12) } }]).results[0]!.output!.assetId));
    const m = builtinStandIn('music.festive', 1, 12);
    const music = String(commit(pid, [{ op: 'add_builtin_music', args: m }]).results[0]!.output!.assetId);
    return { pid, ids, music };
  }
  it('film, built-in to another style, tailored: the film is cut on the new steady grid, the track is made for its exact end, two commits, one undo restores the document', async () => {
    useDoubles();
    const s = filmProject('mf-film');
    const film = await applyFamilyFilmFor(store, gov, USER, s.pid, { assetIds: s.ids, musicAssetId: s.music, targetSeconds: 30, order: 'given' });
    const musicSlot = film.slots.find((x) => x.kind === 'music')!;
    // the person set the music's level by hand and drew a key: the clip is kept by hand; an explicit change replaces it
    commit(s.pid, [{ op: 'set_clip_gain', args: { clipId: musicSlot.clipId, gain: 0.6 } }, { op: 'set_volume_keyframe', args: { clipId: musicSlot.clipId, time: f(30), value: 0.8 } }]);
    const req = { target: { runId: film.runId }, music: { builtin: { styleId: 'music.calm', seed: 2 } }, tailor: true } as const;
    const plan = (await prepareMusicFit(store, s.pid, doc(s.pid), rev(s.pid), req)).plan;
    expect(plan.target).toEqual({ kind: 'film', clipId: null, runId: film.runId });
    expect(plan.make).toMatchObject({ kind: 'builtin', styleId: 'music.calm', seed: 2 });
    expect(plan.ending.kind).toBe('exact');
    expect(plan.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['composed_again', 'music_keys_dropped']));
    expect(plan.recut!.before.cuts).toBeGreaterThan(0);
    expect(plan.blocking).toEqual([]);
    const before = rev(s.pid);
    const out = await applyMusicFit(store, gov, USER, s.pid, applyReq(s.pid, req));
    expect([out.madeRevision, out.revision]).toEqual([before + 1, before + 2]);
    const d = doc(s.pid);
    const run = d.recipeRuns[film.runId]!;
    const m = clip(d, run.slots!.find((x) => x.kind === 'music')!.clipId);
    expect([m.assetId, m.gain, m.volume, m.fadeOut]).toEqual([out.madeAssetId, 0.6, undefined, undefined]);
    const end = Math.max(...Object.values(d.sequences[d.mainSequenceId]!.tracks).filter((t) => t.kind !== 'audio').flatMap((t) => t.clips).map((c) => nf(T.add(c.start, c.duration))));
    expect(nf(T.add(m.start, m.duration))).toBe(end);
    const made = d.assets[out.madeAssetId!]!;
    expect(sampleFramesFor(made.duration) - sampleFramesFor(m.duration)).toBeLessThanOrEqual(1);
    // W6: «אורך אחר» afterwards is an ordinary regeneration (no re-tailoring in version 1): the tailored track is too short and it says so
    const longer = await regenerateFamilyFilmFor(store, gov, USER, s.pid, film.runId, { targetSeconds: 60 });
    expect(longer.warnings.map((w) => w.code)).toContain('music_short');
    store.undo(s.pid, USER.actor, 'undo');
    store.undo(s.pid, USER.actor, 'undo');
    expect(doc(s.pid).recipeRuns[film.runId]!.params.musicAssetId).toBe(s.music);
    expect(doc(s.pid).assets[out.madeAssetId!]).toBeDefined();
  });
  it('template run with a slot trimmed by hand: the plan lists it under blocked with template_blocked; apply refuses; nothing changes', async () => {
    useDoubles();
    const pid = store.createProject({ name: 'mf-tpl', width: 540, height: 960, frameRate: R }).doc.id;
    const media = Array.from({ length: 6 }, (_, i) => String(commit(pid, [{ op: 'import_asset', args: { asset: videoAsset(`tpl-${i}.mp4`, 60) } }]).results[0]!.output!.assetId));
    const def = TEMPLATES.find((t) => t.id === 'tpl.home-video')!;
    const plan = planTemplate(doc(pid), def, { media, builtinMusic: { styleId: 'music.festive', seed: 1 } });
    const assets = plan.assetsNeeded.map((n) => ({ key: n.key, ...procStandIn(n) }));
    const r = commit(pid, [{ op: 'apply_template', args: { templateId: def.id, templateVersion: def.version, params: plan.params, steps: plan.steps, assets, ops: plan.ops, slots: plan.slots, recordRanges: true } }]);
    const runId = String(r.results[0]!.output!.runId);
    const pic = doc(pid).recipeRuns[runId]!.slots!.find((x) => x.kind === 'picture')!;
    const c = clip(doc(pid), pic.clipId);
    commit(pid, [{ op: 'trim_clip', args: { clipId: pic.clipId, edge: 'end', to: T.sub(T.add(c.start, c.duration), f(2)) } }]);
    const before = rev(pid);
    const req = { target: { runId }, music: { builtin: { styleId: 'music.calm', seed: 1 } }, tailor: true } as const;
    const p = (await prepareMusicFit(store, pid, doc(pid), before, req)).plan;
    expect(p.blocking.map((b) => b.code)).toEqual(['template_blocked']);
    expect(p.recut!.blocked).toContain(pic.key);
    expect(String(p.blocking[0]!.details.he)).toMatch(/התבנית אינה יכולה לחול כך/);
    const e = await refusal(applyMusicFit(store, gov, USER, pid, applyReq(pid, req)));
    expect([e.status, e.code]).toEqual([409, 'template_blocked']);
    expect([rev(pid), calls.makeMusic]).toEqual([before, 0]);
  });
  it('template run, built-in, tailored: the regeneration asks for the exact ending; the made file is committed first and the template step finds it by content', async () => {
    useDoubles();
    const pid = store.createProject({ name: 'mf-tpl2', width: 540, height: 960, frameRate: R }).doc.id;
    const media = Array.from({ length: 6 }, (_, i) => String(commit(pid, [{ op: 'import_asset', args: { asset: videoAsset(`tpl2-${i}.mp4`, 60) } }]).results[0]!.output!.assetId));
    const def = TEMPLATES.find((t) => t.id === 'tpl.home-video')!;
    const plan = planTemplate(doc(pid), def, { media, builtinMusic: { styleId: 'music.festive', seed: 1 } });
    const assets = plan.assetsNeeded.map((n) => ({ key: n.key, ...procStandIn(n) }));
    const runId = String(commit(pid, [{ op: 'apply_template', args: { templateId: def.id, templateVersion: def.version, params: plan.params, steps: plan.steps, assets, ops: plan.ops, slots: plan.slots, recordRanges: true } }]).results[0]!.output!.runId);
    const req = { target: { runId }, music: { keep: true }, tailor: true } as const;
    const before = rev(pid);
    const out = await applyMusicFit(store, gov, USER, pid, applyReq(pid, req));
    expect([out.madeRevision, out.revision]).toEqual([before + 1, before + 2]);
    const d = doc(pid);
    expect((d.recipeRuns[runId]!.params.builtinMusic as { ending?: string }).ending).toBe('exact');
    const m = clip(d, d.recipeRuns[runId]!.slots!.find((x) => x.kind === 'music')!.clipId);
    expect([m.assetId, m.fadeOut]).toEqual([out.madeAssetId, undefined]);
    expect(Object.values(d.assets).filter((a) => a.provenance.procedural?.id === 'music.festive').length).toBe(2); // the old track and the made one, not a third
  });
});
