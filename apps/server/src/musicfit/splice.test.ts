/**
 * One removal of whole bars from a song (wave 7 musicfit; builder A), on synthetic songs written by songs.testFixture.ts: the join
 * search (the A·B·A song's first candidate removes A→A with similarity 1; a through-composed song measures below the warning line),
 * the made file (equal to the concatenation on A·B·A; the crossfade samples of the two-tone song equal the closed form), its grid
 * (exactly the mapped source beats), add_fitted_music with the made asset, join.wav (the made file's samples), the owner's heard
 * mark (one revision, one undo) and its refusals. Measured numbers only; nobody here listens.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { MUSICFIT, validateProject, type Asset } from '@pulseframe/core';
import { Governance, type Principal } from '../governance.ts';
import { readWavSamples } from '../music/wav.ts';
import { ApiError, Store } from '../store.ts';
import { decodeSong, frameOf, searchJoins } from './features.ts';
import { commitJoinHeard } from './heard.ts';
import { renderJoinPreview } from './joinPreview.ts';
import { markJoinHeardFor } from './routes.ts';
import { crossfadeFrames, makeFittedSong, previewWindow, spliceSpec } from './splice.ts';
import { abaSong, songWav, throughSong, twoToneSong, type FixtureSong } from './songs.testFixture.ts';

const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
let dir: string, store: Store, gov: Governance;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-musicfit-splice-')); store = new Store(dir); gov = new Governance(store); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

/** A project with the song imported and its grid entered as its beat analysis. */
function project(song: FixtureSong, library?: Asset['provenance']['library']) {
  const pid = store.createProject({ name: `mf-${song.name}`, width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
  const bytes = songWav(song);
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const tmp = path.join(dir, `${song.name}-${pid}.wav`);
  fs.writeFileSync(tmp, bytes);
  store.putBlob(hash, tmp, bytes.length, 'audio/wav');
  fs.rmSync(tmp, { force: true });
  const asset = { kind: 'audio' as const, name: `${song.name}.wav`, contentHash: hash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(song.frames, 48000), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: (library ? 'upload' : 'fixture') as 'fixture', importedAt: '2026-11-25T00:00:00Z', importedBy: 'test', ...(library ? { library } : {}) } };
  const assetId = store.commit({ projectId: pid, actor: 'test', allowInternal: true, ops: [{ op: library ? 'use_library_item' : 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
  store.commit({ projectId: pid, actor: 'test', ops: [{ op: 'edit_analysis', args: { assetId, kind: 'beats', replace: song.beats, downbeats: song.downbeats, bpm: song.bpm, meter: 4 } }] });
  return { pid, assetId, doc: () => store.getProject(pid).doc };
}

describe('the join search', () => {
  it('A·B·A: the first candidate removes A → A (16 bars, on 4-bar phrases) with similarity 1; the made length is stated', async () => {
    const song = abaSong();
    const p = project(song);
    const s = await searchJoins(store, p.doc(), p.assetId, T.ZERO, 24);
    const first = s.candidates[0]!;
    expect([T.toSeconds(first.removal.from), T.toSeconds(first.removal.to)]).toEqual([8, 40]);
    expect(first.measured).toMatchObject({ similarity: 1, phraseBars: 4, levelStepDb: 0 });
    expect(s.usableEndFrames).toBe(28 * 96000);
    expect(first.madeSeconds).toBe(24);
    expect(s.candidates.length).toBeLessThanOrEqual(MUSICFIT.maxCandidates);
    console.log(`A·B·A candidates: ${s.candidates.map((c) => `${T.toSeconds(c.removal.from)}→${T.toSeconds(c.removal.to)} s similarity ${c.measured.similarity}`).join('; ')}`);
  }, 60_000);
  it('a through-composed song: the best candidate measures below the warning line (join_weak for the planner)', async () => {
    const p = project(throughSong());
    const s = await searchJoins(store, p.doc(), p.assetId, T.ZERO, 30);
    console.log(`through-composed: best similarity ${s.candidates[0]!.measured.similarity}`);
    expect(s.candidates[0]!.measured.similarity).toBeLessThan(MUSICFIT.joinWarnSimilarity);
  }, 60_000);
  it('integration: a song whose channels are opposite (the side copy «הסרת שירה, קלאסי» makes: right = −left) is measured like the same song in phase, not as silence', async () => {
    const side = (song: FixtureSong): FixtureSong => { const pcm = song.pcm.slice(); for (let n = 0; n < song.frames; n++) pcm[2 * n + 1] = -pcm[2 * n]!; return { ...song, name: `${song.name}-side`, pcm }; };
    const pt = project(side(throughSong()));
    const st = await searchJoins(store, pt.doc(), pt.assetId, T.ZERO, 30);
    const pi = project(throughSong());
    const si = await searchJoins(store, pi.doc(), pi.assetId, T.ZERO, 30);
    // before: the mixdown (L + R) of a side copy is silence, every bar measured alike and the best join reported similarity 1
    expect(st.candidates[0]!.measured.similarity).toBeLessThan(MUSICFIT.joinWarnSimilarity);
    expect(st.candidates.map((c) => c.measured.similarity)).toEqual(si.candidates.map((c) => c.measured.similarity));
    const pa = project(side(abaSong()));
    const sa = await searchJoins(store, pa.doc(), pa.assetId, T.ZERO, 24);
    expect([T.toSeconds(sa.candidates[0]!.removal.from), T.toSeconds(sa.candidates[0]!.removal.to), sa.candidates[0]!.measured.similarity]).toEqual([8, 40, 1]);
  }, 120_000);
  it('refuses without bar starts (409 needs_bars)', async () => {
    const song = twoToneSong();
    const p = project(song);
    store.commit({ projectId: p.pid, actor: 'test', ops: [{ op: 'edit_analysis', args: { assetId: p.assetId, kind: 'beats', downbeats: null } }] });
    await expect(searchJoins(store, p.doc(), p.assetId, T.ZERO, 20)).rejects.toMatchObject({ status: 409, code: 'needs_bars' });
  }, 60_000);
});

describe('the made file', () => {
  it('A·B·A: equals the concatenation of [0, from) and [to, end) at every sample; the grid is the mapped source grid exactly; add_fitted_music takes it', async () => {
    const song = abaSong();
    const p = project(song);
    const removal = { from: T.rt(8, 1), to: T.rt(40, 1) };
    const made = await makeFittedSong(store, p.doc(), p.assetId, T.ZERO, removal, 'user:local');
    const got = readWavSamples(fs.readFileSync(store.blobPath(made.asset.contentHash)));
    const f = 8 * 48000, t = 40 * 48000, e = 28 * 96000;
    expect(got.length).toBe(2 * (e - (t - f)));
    let maxDiff = 0;
    for (let n = 0; n < got.length / 2; n++) for (let c = 0; c < 2; c++) { const src = n < f ? n : t + (n - f); maxDiff = Math.max(maxDiff, Math.abs(got[2 * n + c]! - song.pcm[2 * src + c]!)); }
    expect(maxDiff).toBeLessThanOrEqual(1);
    expect(made.asset.duration).toEqual(T.rt(e - (t - f), 48000));
    expect(made.asset.provenance.fitted).toMatchObject({ sourceAssetId: p.assetId, startAt: T.ZERO, removed: removal, joinAt: T.rt(8, 1) });
    // grid: source beats before 8 s as they are, from 40 s on 32 s earlier, the removed ones gone
    const mapped = song.beats.filter((b) => T.lt(b, removal.from) || !T.lt(b, removal.to)).map((b) => (T.lt(b, removal.from) ? b : T.sub(b, T.rt(32, 1)))).filter((b) => T.lt(b, made.asset.duration));
    expect(made.grid.beats.length).toBe(mapped.length);
    expect(made.grid.beats.every((b, i) => T.eq(b, mapped[i]!))).toBe(true);
    const r = store.commit({ projectId: p.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'add_fitted_music', args: { asset: made.asset, grid: made.grid, place: { start: T.ZERO } } }] });
    expect(r.results[0]!.output).toMatchObject({ deduplicated: false, analysisAttached: true });
    expect(validateProject(p.doc())).toEqual([]);
    // the same request makes the same bytes
    const again = await makeFittedSong(store, p.doc(), p.assetId, T.ZERO, removal, 'user:local');
    expect(again.asset.contentHash).toBe(made.asset.contentHash);
  }, 60_000);
  it('two-tone: the crossfade samples equal the closed form of a linear equal-gain crossfade ending on the join', async () => {
    const song = twoToneSong();
    const p = project(song);
    const removal = { from: T.rt(4, 1), to: T.rt(20, 1) }; // bars 2 → 10: a 440 Hz side joined to a 660 Hz side
    const made = await makeFittedSong(store, p.doc(), p.assetId, T.ZERO, removal, 'user:local');
    const got = readWavSamples(fs.readFileSync(store.blobPath(made.asset.contentHash)));
    const X = crossfadeFrames(song.beats, removal.to), j = 4 * 48000, t = 20 * 48000;
    expect(X).toBe(2880); // a quarter beat is 125 ms; at most 60 ms
    expect(made.asset.provenance.fitted!.crossfade).toEqual(T.rt(2880, 48000));
    let maxDiff = 0;
    for (let i = 0; i < X; i++) {
      const n = j - X + i, a = song.pcm[2 * n]!, b = song.pcm[2 * (t - X + i)]!;
      const closed = Math.round((a * (X - i) + b * i) / X);
      maxDiff = Math.max(maxDiff, Math.abs(got[2 * n]! - closed));
    }
    expect(maxDiff).toBeLessThanOrEqual(1);
    for (let n = j; n < j + 100; n++) expect(got[2 * n]).toBe(song.pcm[2 * (t + n - j)]); // from the join on, only the landing side
  }, 60_000);
  it('refuses a removal that is not two bar starts of the current analysis (409 fit_stale) and an already shortened file, before anything is made', async () => {
    const song = twoToneSong();
    const p = project(song);
    await expect(makeFittedSong(store, p.doc(), p.assetId, T.ZERO, { from: T.rt(5, 1), to: T.rt(20, 1) }, 'x')).rejects.toMatchObject({ status: 409, code: 'fit_stale' });
    // a file that is itself a shortened song (the licence rule's first case): refused before anything is made
    const made = await makeFittedSong(store, p.doc(), p.assetId, T.ZERO, { from: T.rt(4, 1), to: T.rt(20, 1) }, 'x');
    const id = store.commit({ projectId: p.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'add_fitted_music', args: { asset: made.asset, grid: made.grid } }] }).results[0]!.output!.assetId as string;
    const blobs = fs.readdirSync(path.join(dir, 'blobs'), { recursive: true }).length;
    await expect(makeFittedSong(store, p.doc(), id, T.ZERO, { from: T.rt(2, 1), to: T.rt(6, 1) }, 'x')).rejects.toMatchObject({ status: 409, code: 'incompatible', message: 'this music is already a shortened copy' });
    expect(fs.readdirSync(path.join(dir, 'blobs'), { recursive: true }).length).toBe(blobs);
  }, 60_000);
});

describe('join.wav and the heard mark', () => {
  it('join.wav is the made file\'s samples from two bar starts before the join to two after it', async () => {
    const song = abaSong();
    const p = project(song);
    const removal = { from: T.rt(8, 1), to: T.rt(40, 1) };
    const made = await makeFittedSong(store, p.doc(), p.assetId, T.ZERO, removal, 'user:local');
    const file = readWavSamples(fs.readFileSync(store.blobPath(made.asset.contentHash)));
    const q = { assetId: p.assetId, from: JSON.stringify(removal.from), to: JSON.stringify(removal.to) };
    const wav = readWavSamples(await renderJoinPreview(store, p.pid, q));
    const w = previewWindow(song.downbeats, T.ZERO, removal, made.spec);
    expect([w.from, w.to]).toEqual([4 * 48000, 12 * 48000]);
    expect(wav.length).toBe(2 * (w.to - w.from));
    expect(wav.every((v, i) => v === file[2 * w.from + i])).toBe(true);
    await expect(renderJoinPreview(store, p.pid, { ...q, from: JSON.stringify(T.rt(9, 1)) })).rejects.toMatchObject({ status: 409, code: 'fit_stale' });
    await expect(renderJoinPreview(store, p.pid, { ...q, from: 'x' })).rejects.toMatchObject({ status: 400 });
  }, 60_000);
  it('the owner\'s heard mark commits mark_join_heard as one undoable revision; a file that is not shortened is refused', async () => {
    const song = twoToneSong();
    const p = project(song);
    const made = await makeFittedSong(store, p.doc(), p.assetId, T.ZERO, { from: T.rt(4, 1), to: T.rt(20, 1) }, 'user:local');
    const id = store.commit({ projectId: p.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'add_fitted_music', args: { asset: made.asset, grid: made.grid } }] }).results[0]!.output!.assetId as string;
    const before = store.getProject(p.pid).revision;
    markJoinHeardFor(store, gov, OWNER, p.pid, id, true);
    expect(store.getProject(p.pid).revision).toBe(before + 1);
    expect(p.doc().assets[id]!.provenance.fitted!.heard).toMatchObject({ by: 'user:local' });
    store.undo(p.pid, 'user:local', 'undo');
    expect(p.doc().assets[id]!.provenance.fitted!.heard).toBeUndefined();
    let err: unknown;
    try { commitJoinHeard(gov, OWNER, p.pid, p.assetId, true); } catch (e) { err = e; }
    expect(err).toMatchObject({ code: 'not_found' });
    expect(err instanceof ApiError || (err as Error).name).toBeTruthy();
    // decodeSong and frameOf: exact frames of the file
    const asset = p.doc().assets[p.assetId]!;
    expect((await decodeSong(store, asset)).frames).toBe(song.frames);
    expect(frameOf(T.rt(1, 3))).toBe(16000);
    expect(spliceSpec(T.ZERO, { from: T.rt(1, 100), to: T.rt(8, 1) }, song.frames, 2880)).toBeNull();
  }, 60_000);
});
