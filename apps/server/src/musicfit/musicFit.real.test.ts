/**
 * Integration of the musicfit track (wave 7): builder B's planners and apply on builder A's REAL makers — the built-in synthesiser
 * (makeMusic through the music queue), the join search (searchJoins) and the splice (makeFittedSong) behind B's SongFitter, the
 * template's real procedural media — with no double anywhere. B's double-based rows (musicFit.plan.test.ts) still pin the planners'
 * logic; these rows run the same paths end to end on files that are really made, stored and read back.
 * Fixtures: built-in music made by the product, and synthetic songs written by songs.testFixture.ts (sines and seeded noise, never
 * downloaded, never anyone's music). Video records are synthetic (the planners never read picture bytes). Nobody here listens:
 * every assertion is a measured number or an exact frame/sample count.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  exactLayoutFor, findClip, planTemplate, sampleFramesFor, TEMPLATES, validateProject,
  type Asset, type LibraryRecord, type MediaClip, type MusicFitApplyRequest, type ProjectDocument,
} from '@pulseframe/core';
import { Governance, type Principal } from '../governance.ts';
import { readWavSamples } from '../music/wav.ts';
import { ApiError, Store } from '../store.ts';
import { applyFamilyFilmFor } from '../familyFilm.ts';
import { makeMusic } from '../music.ts';
import { makeTemplateAssets } from '../templates.ts';
import { builtSongFitter, musicFitDeps, prepareMusicFit, type MusicFitDeps, type SongFitter } from './plan.ts';
import { applyMusicFit } from './apply.ts';
import { abaSong, songWav, throughSong, type FixtureSong } from './songs.testFixture.ts';

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const nf = (t: T.RationalTime) => T.nearestFrameIndex(t, R);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00.000Z', importedBy: 'test' };
let dir: string, store: Store, gov: Governance;
const real: MusicFitDeps = { ...musicFitDeps };
/** The REAL song fitter, with a count of how often each part was reached (no behaviour changed). */
const reached = { candidates: 0, make: 0 };
const countedFitter: SongFitter = {
  candidates: (a) => { reached.candidates++; return builtSongFitter.candidates(a); },
  make: (a) => { reached.make++; return builtSongFitter.make(a); },
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-musicfit-real-'));
  store = new Store(dir);
  gov = new Governance(store);
});
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
afterEach(() => { Object.assign(musicFitDeps, real); reached.candidates = reached.make = 0; });

const videoAsset = (name: string, seconds: number): Omit<Asset, 'id'> => ({ kind: 'video', name, contentHash: `sha256:${createHash('sha256').update(name).digest('hex')}`, byteSize: 100, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1), video: { width: 320, height: 180, frameRate: R, codec: 'h264', rotation: 0, frameCount: null }, provenance: prov } as Omit<Asset, 'id'>);
const record = (licence: string, over: Partial<LibraryRecord> = {}): LibraryRecord => ({ itemId: 'src-syn/aba.wav', sourceId: 'src-syn', kind: 'music', title: 'Synthetic A·B·A', sourceSha256: 'a'.repeat(64), ledger: { item: 'src-syn' }, licence: { id: licence }, credit: { text: '"Synthetic A·B·A" by the test fixture', placement: 'description' }, flags: {}, ...over });
const commit = (pid: string, ops: { op: string; args: unknown }[]) => store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops });
const doc = (pid: string) => store.getProject(pid).doc;
const rev = (pid: string) => store.getProject(pid).revision;
const clip = (d: ProjectDocument, id: string) => findClip(d, id)!.clip as MediaClip;
const refusal = async (p: Promise<unknown>): Promise<ApiError> => { try { await p; } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error('not refused'); };
const applyReq = (pid: string, body: Omit<MusicFitApplyRequest, 'expectedRevision'>, expectedRevision = rev(pid)): MusicFitApplyRequest => ({ ...body, expectedRevision });
/** Every file the store holds (blobs and temporary files): "nothing was made" means this list did not change. */
const filesOf = (root: string): string[] => fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && !/\.(sqlite|db)(-wal|-shm|-journal)?$/.test(e.name)).map((e) => path.join(e.parentPath, e.name)).sort();
const pictureEndFrame = (d: ProjectDocument) => Math.max(...d.sequences[d.mainSequenceId]!.tracks.filter((t) => t.kind !== 'audio').flatMap((t) => t.clips).map((c) => nf(T.add(c.start, c.duration))));

function project(name: string, width = 320, height = 180) { return store.createProject({ name, width, height, frameRate: R }).doc.id; }
function picture(pid: string, frames: number) {
  const v = String(commit(pid, [{ op: 'import_asset', args: { asset: videoAsset(`${pid}-v.mp4`, 120) } }]).results[0]!.output!.assetId);
  commit(pid, [{ op: 'add_clip', args: { assetId: v, start: T.ZERO, duration: f(frames), withLinkedAudio: false } }]);
}
/** A synthetic song stored as a blob, imported (or taken from a library record) and given its grid as its beat analysis. */
function addSong(pid: string, song: FixtureSong, library?: LibraryRecord): string {
  const bytes = songWav(song);
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const tmp = path.join(dir, `${song.name}-${pid}.wav`);
  fs.writeFileSync(tmp, bytes);
  store.putBlob(hash, tmp, bytes.length, 'audio/wav');
  fs.rmSync(tmp, { force: true });
  const asset = { kind: 'audio' as const, name: `${song.name}.wav`, contentHash: hash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(song.frames, 48000), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { ...prov, origin: (library ? 'upload' : 'fixture') as 'fixture', ...(library ? { library } : {}) } };
  const assetId = String(commit(pid, [{ op: library ? 'use_library_item' : 'import_asset', args: { asset } }]).results[0]!.output!.assetId);
  commit(pid, [{ op: 'edit_analysis', args: { assetId, kind: 'beats', replace: song.beats, downbeats: song.downbeats, bpm: song.bpm, meter: 4 } }]);
  return assetId;
}
const addClip = (pid: string, assetId: string, duration?: T.RationalTime) => String(commit(pid, [{ op: 'add_clip', args: { assetId, start: T.ZERO, ...(duration ? { duration } : {}) } }]).results[0]!.output!.clipId);
/** The made file read back: its sample frames. */
const framesOfBlob = (a: Asset) => readWavSamples(fs.readFileSync(store.blobPath(a.contentHash))).length / 2;
const expectValid = (pid: string) => expect(validateProject(doc(pid))).toEqual([]);

describe('a song, shortened on the real join search and splice', () => {
  it('A·B·A under a 24 s picture: the plan offers A → A first; apply makes the file (exact length, read back), then ONE transaction; the clip ends on the last picture frame; one undo leaves the made file', async () => {
    const pid = project('real-aba');
    picture(pid, 720);
    const song = addSong(pid, abaSong());
    const clipId = addClip(pid, song, f(300));
    const req = { target: { clipId }, music: { keep: true }, tailor: true } as const;
    const plan = (await prepareMusicFit(store, pid, doc(pid), rev(pid), req)).plan;
    expect(plan.make.kind).toBe('fitted');
    const c0 = plan.make.kind === 'fitted' ? plan.make.candidates[plan.make.chosen]! : null;
    expect([T.toSeconds(c0!.removal.from), T.toSeconds(c0!.removal.to), c0!.madeSeconds, c0!.measured.similarity]).toEqual([8, 40, 24, 1]);
    expect(plan.ending).toEqual({ kind: 'exact', seconds: 0 });
    expect(plan.basis.join('\n')).toMatch(/bar starts in the part used/);
    const before = rev(pid);
    const out = await applyMusicFit(store, gov, USER, pid, applyReq(pid, req));
    expect([out.madeRevision, out.revision]).toEqual([before + 1, before + 2]);
    const d = doc(pid);
    const made = d.assets[out.madeAssetId!]!;
    expect(made.provenance.fitted).toMatchObject({ sourceAssetId: song, removed: { from: T.rt(8, 1), to: T.rt(40, 1) } });
    expect(made.provenance.fitted!.heard).toBeUndefined(); // labelled «עוד לא הושמע» until the owner marks it
    expect(framesOfBlob(made)).toBe(28 * 96000 - 32 * 48000);
    const m = clip(d, clipId);
    expect([m.assetId, nf(T.add(m.start, m.duration)), m.fadeOut]).toEqual([out.madeAssetId, 720, undefined]);
    expectValid(pid);
    store.undo(pid, USER.actor, 'undo');
    expect(clip(doc(pid), clipId).assetId).toBe(song);
    expect(doc(pid).assets[out.madeAssetId!]).toBeDefined();
  }, 120_000);

  it('a candidate whose made file is shorter than the picture (ending early): apply commits it and the clip ends where the file ends (not fit_unstable)', async () => {
    const pid = project('real-early');
    picture(pid, 750); // 25 s: no whole-bar removal of 2 s bars gives exactly 25 s
    const song = addSong(pid, abaSong());
    const clipId = addClip(pid, song, f(300));
    const req = { target: { clipId }, music: { keep: true }, tailor: true } as const;
    const plan = (await prepareMusicFit(store, pid, doc(pid), rev(pid), req)).plan;
    const c = plan.make.kind === 'fitted' ? plan.make.candidates[plan.make.chosen]! : null;
    expect(c!.madeSeconds).toBeLessThan(25);
    expect(plan.ending.kind).toBe('early');
    const out = await applyMusicFit(store, gov, USER, pid, applyReq(pid, req));
    const d = doc(pid);
    const m = clip(d, clipId);
    expect(nf(T.add(m.start, m.duration))).toBe(Math.floor(c!.madeSeconds * 30));
    expect(framesOfBlob(d.assets[out.madeAssetId!]!)).toBe(sampleFramesFor(d.assets[out.madeAssetId!]!.duration));
    expectValid(pid);
  }, 120_000);
});

describe('the licence order on the real fitter: a refusal comes before any search or file', () => {
  it('no-derivatives, share-alike and an unknown licence refuse in the plan AND in the maker (fail-closed) before the search is reached or a file is written', async () => {
    musicFitDeps.songFitter = countedFitter;
    const pid = project('real-lic-refused');
    picture(pid, 720);
    const song = addSong(pid, abaSong(), record('CC-BY-4.0'));
    const clipId = addClip(pid, song, f(300));
    const files = filesOf(dir);
    for (const [licence, key] of [['CC-BY-ND-4.0', /forbids changing it/], ['CC-BY-SA-4.0', /same licence/], ['LicenseRef-not-in-table', /not one the editor knows/]] as const) {
      // the import refuses such a record, so it is written onto a copy of the document: the fit must refuse it anyway
      const d = structuredClone(doc(pid));
      (d.assets[song]!.provenance.library as LibraryRecord).licence = { id: licence };
      const e = await refusal(prepareMusicFit(store, pid, d, rev(pid), { target: { clipId }, music: { keep: true }, tailor: true }));
      expect([e.code, e.message]).toEqual(['incompatible', expect.stringMatching(key)]);
      const m = await refusal(builtSongFitter.make({ store, projectId: pid, doc: d, assetId: song, startAt: T.ZERO, removal: { from: T.rt(8, 1), to: T.rt(40, 1) }, actor: USER.actor }));
      expect([m.status, m.code]).toEqual([409, 'incompatible']);
    }
    expect(reached).toEqual({ candidates: 0, make: 0 });
    expect(filesOf(dir)).toEqual(files);
  }, 120_000);

  for (const [licence, flags] of [['CC-BY-4.0', {}], ['CC0-1.0', {}], ['CC-BY-NC-4.0', { nonCommercial: true, diskOnly: true }]] as const) {
    it(`${licence} passes: the made file carries the source's library record, its credit and its non-commercial flag`, async () => {
      const pid = project(`real-lic-${licence}`);
      picture(pid, 720);
      const rec = record(licence, { flags: { ...flags }, ...(licence === 'CC0-1.0' ? { credit: undefined } : {}) } as Partial<LibraryRecord>);
      const song = addSong(pid, abaSong(), rec);
      const clipId = addClip(pid, song, f(300));
      const out = await applyMusicFit(store, gov, USER, pid, applyReq(pid, { target: { clipId }, music: { keep: true }, tailor: true }));
      const made = doc(pid).assets[out.madeAssetId!]!;
      expect(made.provenance.library).toEqual(doc(pid).assets[song]!.provenance.library);
      expect(made.provenance.library?.flags.nonCommercial === true).toBe(licence === 'CC-BY-NC-4.0');
      expect(made.provenance.library?.credit?.text).toBe(rec.credit?.text);
      expectValid(pid);
    }, 120_000);
  }
});

describe('refused before anything is made (real makers)', () => {
  it('a stale expectedRevision and a propose-mode agent: refused, the search and the maker never reached, no file written, no revision', async () => {
    musicFitDeps.songFitter = countedFitter;
    const pid = project('real-refused');
    picture(pid, 720);
    const song = addSong(pid, abaSong());
    const clipId = addClip(pid, song, f(300));
    const before = rev(pid), files = filesOf(dir);
    const body = { target: { clipId }, music: { keep: true }, tailor: true } as const;
    const e = await refusal(applyMusicFit(store, gov, USER, pid, applyReq(pid, body, before - 1)));
    expect([e.status, e.code]).toEqual([409, 'stale_revision']);
    const propose = gov.principalForToken(gov.createGrant({ name: 'p-real', mode: 'propose' }, USER).token)!;
    const p = await refusal(applyMusicFit(store, gov, propose, pid, applyReq(pid, body)));
    expect([p.status, p.code]).toEqual([403, 'insufficient_scope']);
    expect([rev(pid), reached.candidates, reached.make]).toEqual([before, 0, 0]);
    expect(filesOf(dir)).toEqual(files);
  }, 120_000);
});

describe('built-in music made to measure by the real synthesiser', () => {
  it('a free clip: the made file has exactly sampleFramesFor(the film) frames, read back; the clip ends on the last picture frame with no fade', async () => {
    const pid = project('real-free-builtin');
    picture(pid, 400); // 13.333… s at 30 fps
    const m0 = await makeMusic(store, { styleId: 'music.festive', bars: 8, seed: 1 }, USER.actor);
    const r0 = commit(pid, [{ op: 'add_builtin_music', args: { asset: m0.asset, grid: m0.grid, place: { start: T.ZERO } } }]);
    const clipId = String(r0.results[0]!.output!.clipId);
    const req = { target: { clipId }, music: { keep: true }, tailor: true } as const;
    const out = await applyMusicFit(store, gov, USER, pid, applyReq(pid, req));
    const d = doc(pid);
    const made = d.assets[out.madeAssetId!]!;
    expect(sampleFramesFor(made.duration)).toBe(sampleFramesFor(f(400)));
    expect(framesOfBlob(made)).toBe(sampleFramesFor(f(400)));
    expect(made.provenance.procedural?.params?.end).toBe(exactLayoutFor('music.festive', sampleFramesFor(f(400))).endFrames);
    const c = clip(d, clipId);
    expect([nf(T.add(c.start, c.duration)), c.fadeOut]).toEqual([400, undefined]);
    expectValid(pid);
  }, 180_000);

  it('a family film moved to another built-in style, tailored: two commits; the music clip ends on the film\'s last picture frame, file ≤ 1 sample longer; one undo restores the run', async () => {
    const pid = project('real-film');
    const ids = Array.from({ length: 8 }, (_, i) => String(commit(pid, [{ op: 'import_asset', args: { asset: videoAsset(`real-film-${i}.mp4`, 12) } }]).results[0]!.output!.assetId));
    const m0 = await makeMusic(store, { styleId: 'music.festive', bars: 12, seed: 1 }, USER.actor);
    const music = String(commit(pid, [{ op: 'add_builtin_music', args: { asset: m0.asset, grid: m0.grid } }]).results[0]!.output!.assetId);
    const film = await applyFamilyFilmFor(store, gov, USER, pid, { assetIds: ids, musicAssetId: music, targetSeconds: 30, order: 'given' });
    const req = { target: { runId: film.runId }, music: { builtin: { styleId: 'music.calm', seed: 2 } }, tailor: true } as const;
    const before = rev(pid);
    const out = await applyMusicFit(store, gov, USER, pid, applyReq(pid, req));
    expect([out.madeRevision, out.revision]).toEqual([before + 1, before + 2]);
    const d = doc(pid);
    const m = clip(d, d.recipeRuns[film.runId]!.slots!.find((x) => x.kind === 'music')!.clipId);
    expect(m.assetId).toBe(out.madeAssetId);
    expect(nf(T.add(m.start, m.duration))).toBe(pictureEndFrame(d));
    const made = d.assets[out.madeAssetId!]!;
    expect(framesOfBlob(made) - sampleFramesFor(m.duration)).toBeGreaterThanOrEqual(0);
    expect(framesOfBlob(made) - sampleFramesFor(m.duration)).toBeLessThanOrEqual(1);
    expect(m.fadeOut).toBeUndefined();
    expectValid(pid);
    store.undo(pid, USER.actor, 'undo');
    expect(doc(pid).recipeRuns[film.runId]!.params.musicAssetId).toBe(music);
  }, 240_000);

  it('a template run, tailored: the real track and the real procedural media; the music clip ends on the last picture frame, no fade, ending exact', async () => {
    const pid = project('real-tpl', 540, 960);
    const media = Array.from({ length: 6 }, (_, i) => String(commit(pid, [{ op: 'import_asset', args: { asset: videoAsset(`real-tpl-${i}.mp4`, 60) } }]).results[0]!.output!.assetId));
    const def = TEMPLATES.find((t) => t.id === 'tpl.home-video')!;
    const plan = planTemplate(doc(pid), def, { media, builtinMusic: { styleId: 'music.festive', seed: 1 } });
    const assets = await makeTemplateAssets(store, USER, plan);
    const runId = String(commit(pid, [{ op: 'apply_template', args: { templateId: def.id, templateVersion: def.version, params: plan.params, steps: plan.steps, assets, ops: plan.ops, slots: plan.slots, recordRanges: true } }]).results[0]!.output!.runId);
    const before = rev(pid);
    const out = await applyMusicFit(store, gov, USER, pid, applyReq(pid, { target: { runId }, music: { keep: true }, tailor: true }));
    expect([out.madeRevision, out.revision]).toEqual([before + 1, before + 2]);
    const d = doc(pid);
    expect((d.recipeRuns[runId]!.params.builtinMusic as { ending?: string }).ending).toBe('exact');
    const m = clip(d, d.recipeRuns[runId]!.slots!.find((x) => x.kind === 'music')!.clipId);
    expect([m.assetId, m.fadeOut]).toEqual([out.madeAssetId, undefined]);
    expect(nf(T.add(m.start, m.duration))).toBe(pictureEndFrame(d));
    expect(framesOfBlob(d.assets[out.madeAssetId!]!) - sampleFramesFor(m.duration)).toBeLessThanOrEqual(1);
    expectValid(pid);
  }, 240_000);
});

describe('a song under a family film (real join search and splice)', () => {
  const filmWithSong = async (name: string, targetSeconds: number) => {
    const pid = project(name);
    const ids = Array.from({ length: 8 }, (_, i) => String(commit(pid, [{ op: 'import_asset', args: { asset: videoAsset(`${name}-${i}.mp4`, 12) } }]).results[0]!.output!.assetId));
    const song = addSong(pid, abaSong());
    const film = await applyFamilyFilmFor(store, gov, USER, pid, { assetIds: ids, musicAssetId: song, targetSeconds, order: 'given' });
    return { pid, song, runId: film.runId };
  };
  it('A·B·A tailored to a 30 s film: applied; the music clip is the made file and ends on the film\'s last picture frame', async () => {
    const s = await filmWithSong('real-film-song', 30);
    const out = await applyMusicFit(store, gov, USER, s.pid, applyReq(s.pid, { target: { runId: s.runId }, music: { keep: true }, tailor: true }));
    const d = doc(s.pid);
    const m = clip(d, d.recipeRuns[s.runId]!.slots!.find((x) => x.kind === 'music')!.clipId);
    expect(m.assetId).toBe(out.madeAssetId);
    expect(nf(T.add(m.start, m.duration))).toBe(pictureEndFrame(d));
    expectValid(s.pid);
  }, 240_000);
  it('fit_unstable on the real makers: a 60 s film over A·B·A wants 34 s, every candidate makes 32 s (ending early), the film planner drops the slots past the shorter song, so the second plan ends on another frame: refused, no revision, the project unchanged', async () => {
    const s = await filmWithSong('real-film-unstable', 60);
    const plan = (await prepareMusicFit(store, s.pid, doc(s.pid), rev(s.pid), { target: { runId: s.runId }, music: { keep: true }, tailor: true })).plan;
    expect(plan.make.kind).toBe('fitted');
    const cs = plan.make.kind === 'fitted' ? plan.make.candidates : [];
    expect(cs.every((c) => c.madeSeconds < plan.wantedSeconds)).toBe(true);
    console.log(`fit_unstable case: wanted ${plan.wantedSeconds} s; candidates ${cs.map((c) => `${T.toSeconds(c.removal.from)}→${T.toSeconds(c.removal.to)} s made ${c.madeSeconds} s similarity ${c.measured.similarity}`).join('; ')}`);
    const before = rev(s.pid), d0 = JSON.stringify(doc(s.pid));
    const e = await refusal(applyMusicFit(store, gov, USER, s.pid, applyReq(s.pid, { target: { runId: s.runId }, music: { keep: true }, tailor: true })));
    expect([e.status, e.code]).toEqual([409, 'fit_unstable']);
    expect(rev(s.pid)).toBe(before);
    expect(JSON.stringify(doc(s.pid))).toBe(d0);
  }, 240_000);

  it('a through-composed song: the plan warns join_weak and no plan sentence holds a praise word', async () => {
    const pid = project('real-through');
    picture(pid, 900);
    const song = addSong(pid, throughSong());
    const clipId = addClip(pid, song, f(300));
    const plan = (await prepareMusicFit(store, pid, doc(pid), rev(pid), { target: { clipId }, music: { keep: true }, tailor: true })).plan;
    expect(plan.warnings.map((w) => w.code)).toContain('join_weak');
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/\b(smooth|smoothly|seamless|seamlessly|perfect|perfectly|synced|in sync|inaudible|flawless)\b/i);
  }, 120_000);
});
