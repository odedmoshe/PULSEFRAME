/**
 * pnpm proof:musicfit, part makers (builder A): checks B1, B2, S1–S4, S7, L3, I1, I2 of musicfit-proof.ts, in-process against the
 * real code (the synthesiser, the join search and splice, the store and the operations, the engine's evaluate). Fixtures are
 * SYNTHETIC: built-in tracks from the product, songs written by apps/server/src/musicfit/songs.testFixture.ts as WAV, picture
 * files only as asset records (the frame a clip shows is read from evaluate, the function the still and the export draw from,
 * ADR-0005). Never downloaded or copyrighted music. Nobody here can listen: every check is a measurement.
 *
 * What is NOT measured here, said per check in `missing` (status 'partial' then, never 'pass'): I1 reads the frame a clip shows
 * from evaluate, not from the pixels of a server still or an export; S7 and I2 use a time-preserving copy cut by ffmpeg in this
 * proof and recorded as a derived file with its offset, not one made by a local-tool job; S2's tracker runs on the made file,
 * which the A·B·A song (16 bars of A, so the removal is 16 bars, not the plan's 32) gives a noise kick on every beat.
 *
 * Run alone: `tsx packages/evals/src/musicfit-proof.makers.ts` (exit 0 every check pass, 1 a check failed, 3 partial only).
 * Writes nothing outside a temp folder, which it removes.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, diffEntities, exactLayoutFor, joinMeasuredSentence, MUSIC_STYLES, MUSICFIT, MUSICFIT_FORBIDDEN_WORDS, MUSICFIT_FORBIDDEN_WORDS_HE, MUSICFIT_REFUSALS,
  MUSICFIT_UNHEARD_LABEL, musicLayout, musicProvenanceParams, OpError, planImpact, sampleFramesFor, type Asset, type LibraryRecord, type MediaClip, type ProjectDocument, type SyncImpactOutput,
} from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { detectBeatsOfFile } from '../../../apps/server/src/analysis.ts';
import { musicFileName } from '../../../apps/server/src/music.ts';
import { arrange } from '../../../apps/server/src/music/arrange.ts';
import { compose } from '../../../apps/server/src/music/compose.ts';
import { renderMusic } from '../../../apps/server/src/music/render.ts';
import { styleSpec } from '../../../apps/server/src/music/styles.ts';
import { readWavSamples } from '../../../apps/server/src/music/wav.ts';
import { searchJoins } from '../../../apps/server/src/musicfit/features.ts';
import { renderJoinPreview } from '../../../apps/server/src/musicfit/joinPreview.ts';
import { crossfadeFrames, makeFittedSong } from '../../../apps/server/src/musicfit/splice.ts';
import { abaSong, songWav, throughSong, twoToneSong, type FixtureSong } from '../../../apps/server/src/musicfit/songs.testFixture.ts';
import { Store } from '../../../apps/server/src/store.ts';

export interface MusicfitCheck { id: string; status: 'pass' | 'fail' | 'partial'; measured: Record<string, unknown>; missing?: string[]; error?: string }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** One temp store for the song checks. */
function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-musicfit-makers-'));
  const store = new Store(dir);
  const add = (song: FixtureSong, over: { library?: LibraryRecord } = {}) => {
    const pid = store.createProject({ name: `mf-${song.name}`, width: 320, height: 180, frameRate: { num: 30, den: 1 } }).doc.id;
    const bytes = songWav(song), hash = `sha256:${sha(bytes)}`, tmp = path.join(dir, `${song.name}.in.wav`);
    fs.writeFileSync(tmp, bytes); store.putBlob(hash, tmp, bytes.length, 'audio/wav'); fs.rmSync(tmp, { force: true });
    const asset = { kind: 'audio' as const, name: `${song.name}.wav`, contentHash: hash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(song.frames, 48000), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: (over.library ? 'upload' : 'fixture') as 'fixture', importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof', ...(over.library ? { library: over.library } : {}) } };
    const assetId = store.commit({ projectId: pid, actor: 'proof', allowInternal: true, ops: [{ op: over.library ? 'use_library_item' : 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
    store.commit({ projectId: pid, actor: 'proof', ops: [{ op: 'edit_analysis', args: { assetId, kind: 'beats', replace: song.beats, downbeats: song.downbeats, bpm: song.bpm, meter: 4 } }] });
    return { pid, assetId, doc: () => store.getProject(pid).doc };
  };
  return { dir, store, add, close: () => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
type World = ReturnType<typeof world>;

// ---------------------------------------------------------------- B1, B2: the synthesiser
async function B1(): Promise<MusicfitCheck> {
  const rows: Record<string, unknown>[] = [];
  let ok = true;
  for (const id of ['music.cinematic', 'music.birthday', 'music.pop']) {
    const style = MUSIC_STYLES.find((s) => s.id === id)!, spb = 2_880_000 / style.bpm;
    const minFrames = (style.minBars - 1) * 4 * spb + 2 * spb; // the style's minimum: minBars − 1 whole bars and two beats
    for (const rate of [{ num: 30, den: 1 }, { num: 30000, den: 1001 }]) {
      for (const seconds of [minFrames / 48000, 20, 40]) {
        const filmFrames = Math.ceil((seconds * rate.num) / rate.den - 1e-9);
        const L = sampleFramesFor(T.frameTime(filmFrames, rate));
        const { bars, endFrames } = exactLayoutFor(id, L);
        const r = await renderMusic(id, bars, 1, { endFrames });
        const layout = musicLayout(id, bars, endFrames), K = bars - 1, bar = 4 * spb;
        const notes = arrange(styleSpec(id), layout, compose(styleSpec(id), layout, 1), 1).filter((n) => n.at >= K * bar);
        const held = notes.filter((n) => n.voice.kind !== 'kick' && n.voice.kind !== 'crash');
        const row = {
          style: id, fps: `${rate.num}/${rate.den}`, filmFrames, L, fileFrames: (r.wav.length - 44) / 4,
          beatsOk: layout.beats.length === Math.ceil(L / spb) && layout.beats.every((b, k) => T.eq(b, T.normalize(T.rt(60 * k, style.bpm))) && k * spb < L),
          endingNotesAtKBar: notes.length > 0 && notes.every((n) => n.at === K * bar), heldGateEndFrames: held.every((n) => n.gate === endFrames), endFrames,
        };
        if (row.fileFrames !== L || !row.beatsOk || !row.endingNotesAtKBar || !row.heldGateEndFrames) ok = false;
        rows.push(row);
      }
    }
  }
  return { id: 'B1', status: ok ? 'pass' : 'fail', measured: { tracks: rows.length, rows } };
}
async function B2(): Promise<MusicfitCheck> {
  const golden = JSON.parse(fs.readFileSync(path.join(root, 'apps/server/src/music.golden.json'), 'utf8')) as { bars: number; seed: number; sha256: Record<string, string> };
  const rows: Record<string, unknown>[] = [];
  let ok = true;
  for (const s of MUSIC_STYLES) {
    const plain = await renderMusic(s.id, golden.bars, golden.seed), oneBar = await renderMusic(s.id, golden.bars, golden.seed, { endFrames: 4 * (2_880_000 / s.bpm) });
    const layout = musicLayout(s.id, golden.bars, 4 * (2_880_000 / s.bpm));
    const row = { style: s.id, plain: sha(plain.wav) === golden.sha256[s.id], oneBarEnding: sha(oneBar.wav) === golden.sha256[s.id], name: musicFileName(s, layout), params: Object.keys(musicProvenanceParams(layout, 1)).join(',') };
    if (!row.plain || !row.oneBarEnding || row.name !== `${s.name.en} · ${golden.bars} bars.wav` || row.params !== 'bars,seed,bpm,meter,synth') ok = false;
    rows.push(row);
  }
  return { id: 'B2', status: ok ? 'pass' : 'fail', measured: { rows } };
}

// ---------------------------------------------------------------- S1–S4, S7, L3: the song join
async function S1(w: World): Promise<MusicfitCheck> {
  const aba = abaSong(), p = w.add(aba);
  const s = await searchJoins(w.store, p.doc(), p.assetId, T.ZERO, 24);
  const first = s.candidates[0]!;
  const made = await makeFittedSong(w.store, p.doc(), p.assetId, T.ZERO, first.removal, 'proof');
  const file = readWavSamples(fs.readFileSync(w.store.blobPath(made.asset.contentHash)));
  const f = T.toSeconds(first.removal.from) * 48000, t = T.toSeconds(first.removal.to) * 48000;
  let maxAba = 0;
  for (let n = 0; n < file.length / 2; n++) for (let c = 0; c < 2; c++) maxAba = Math.max(maxAba, Math.abs(file[2 * n + c]! - aba.pcm[2 * (n < f ? n : t + n - f) + c]!));
  const two = twoToneSong(), q = w.add(two), removal = { from: T.rt(4, 1), to: T.rt(20, 1) };
  const m2 = await makeFittedSong(w.store, q.doc(), q.assetId, T.ZERO, removal, 'proof');
  const f2 = readWavSamples(fs.readFileSync(w.store.blobPath(m2.asset.contentHash)));
  const X = crossfadeFrames(two.beats, removal.to), j = 4 * 48000, t2 = 20 * 48000;
  let maxXf = 0;
  for (let i = 0; i < X; i++) for (let c = 0; c < 2; c++) { const a = two.pcm[2 * (j - X + i) + c]!, b = two.pcm[2 * (t2 - X + i) + c]!; maxXf = Math.max(maxXf, Math.abs(f2[2 * (j - X + i) + c]! - Math.round((a * (X - i) + b * i) / X))); }
  const removedBars = (T.toSeconds(first.removal.to) - T.toSeconds(first.removal.from)) / 2;
  const ok = T.toSeconds(first.removal.from) === 8 && T.toSeconds(first.removal.to) === 40 && first.measured.similarity >= 0.99 && maxAba <= 1 && maxXf <= 1;
  return { id: 'S1', status: ok ? 'pass' : 'fail', measured: { removal: [T.toSeconds(first.removal.from), T.toSeconds(first.removal.to)], removedBars, similarity: first.measured.similarity, maxDiffAbaLsb: maxAba, crossfadeFrames: X, maxDiffCrossfadeLsb: maxXf, candidates: s.candidates.map((c) => c.measured.similarity) } };
}
async function S2(w: World): Promise<MusicfitCheck> {
  const aba = abaSong(), p = w.add(aba), removal = { from: T.rt(8, 1), to: T.rt(40, 1) };
  const made = await makeFittedSong(w.store, p.doc(), p.assetId, T.ZERO, removal, 'proof');
  const mapped = aba.beats.filter((b) => T.lt(b, removal.from) || !T.lt(b, removal.to)).map((b) => (T.lt(b, removal.from) ? b : T.sub(b, T.sub(removal.to, removal.from)))).filter((b) => T.lt(b, made.asset.duration));
  const exact = made.grid.beats.length === mapped.length && made.grid.beats.every((b, i) => T.eq(b, mapped[i]!));
  const tracked = await detectBeatsOfFile(w.store.blobPath(made.asset.contentHash));
  const errs = made.grid.beats.map((b) => { const s = T.toSeconds(b); return Math.min(...tracked.beats.map((x) => Math.abs(x - s))) * 1000; });
  const agree = errs.filter((e) => e <= 35).length / errs.length;
  const sorted = [...errs].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)]!;
  const joinAt = T.toSeconds(made.asset.provenance.fitted!.joinAt);
  const nearJoin = made.grid.beats.map((b, i) => ({ s: T.toSeconds(b), e: errs[i]! })).filter((x) => Math.abs(x.s - joinAt) <= 2 + 1e-9).map((x) => Math.round(x.e * 10) / 10);
  const ok = exact && agree >= 0.95 && median <= 12 && nearJoin.every((e) => e <= 24);
  return { id: 'S2', status: ok ? 'pass' : 'fail', measured: { gridExact: exact, beats: errs.length, tracked: tracked.beats.length, agreeWithin35ms: Math.round(agree * 1000) / 1000, medianMs: Math.round(median * 10) / 10, nearJoinMs: nearJoin } };
}
async function S3(w: World): Promise<MusicfitCheck> {
  const p = w.add(throughSong());
  const s = await searchJoins(w.store, p.doc(), p.assetId, T.ZERO, 30);
  const best = s.candidates[0]!.measured;
  const words = [...Object.values(MUSICFIT_UNHEARD_LABEL), ...Object.values(joinMeasuredSentence(best))];
  const praise = words.filter((x) => MUSICFIT_FORBIDDEN_WORDS.test(x) || MUSICFIT_FORBIDDEN_WORDS_HE.test(x));
  const ok = best.similarity < MUSICFIT.joinWarnSimilarity && praise.length === 0;
  return { id: 'S3', status: ok ? 'partial' : 'fail', measured: { bestSimilarity: best.similarity, warnLine: MUSICFIT.joinWarnSimilarity, praiseWords: praise }, missing: ['the join_weak warning itself and the block, dialog and chip strings are the planner\'s and the editor\'s (builders B and C); measured here: the similarity under the line and the shared sentences'] };
}
async function S4(w: World): Promise<MusicfitCheck> {
  const p = w.add(abaSong()), removal = { from: T.rt(8, 1), to: T.rt(40, 1) };
  const made = await makeFittedSong(w.store, p.doc(), p.assetId, T.ZERO, removal, 'proof');
  const file = readWavSamples(fs.readFileSync(w.store.blobPath(made.asset.contentHash)));
  const wav = readWavSamples(await renderJoinPreview(w.store, p.pid, { assetId: p.assetId, from: JSON.stringify(removal.from), to: JSON.stringify(removal.to) }));
  const from = 4 * 48000; // two bar starts before the join (bars of 2 s)
  const equal = wav.length === 2 * 8 * 48000 && wav.every((v, i) => v === file[2 * from + i]);
  return { id: 'S4', status: equal ? 'pass' : 'fail', measured: { previewFrames: wav.length / 2, equalToFile: equal } };
}
async function S7(w: World): Promise<MusicfitCheck> {
  const aba = abaSong(), p = w.add(aba);
  // a time-preserving copy of the song from 2 s on, cut by ffmpeg here and recorded as a derived file with that offset
  const src = w.store.blobPath(p.doc().assets[p.assetId]!.contentHash), out = path.join(w.dir, 'copy.wav');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', src, '-af', 'atrim=start_sample=96000', '-map_metadata', '-1', '-fflags', '+bitexact', '-c:a', 'pcm_s16le', out]);
  const bytes = fs.readFileSync(out), hash = `sha256:${sha(bytes)}`;
  w.store.putBlob(hash, out, bytes.length, 'audio/wav');
  const copy = { kind: 'audio' as const, name: 'copy.wav', contentHash: hash, byteSize: bytes.length, container: 'wav', mimeType: 'audio/wav', duration: T.rt(aba.frames - 96000, 48000), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'derived' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof', derived: { jobId: 'proof_cut', capabilityId: 'proof.ffmpeg-atrim', capabilityVersion: '1', graphDigest: `sha256:${'0'.repeat(64)}`, params: {}, sourceAssetIds: [p.assetId], outputName: 'copy', outputRole: 'audio', encoding: 'pcm_s16le', provider: { id: 'proof' }, sourceRangeStart: T.rt(2, 1) } } };
  const copyId = w.store.commit({ projectId: p.pid, actor: 'proof', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: copy } }] }).results[0]!.output!.assetId as string;
  const direct = (await searchJoins(w.store, p.doc(), p.assetId, T.rt(2, 1), 22)).candidates[0]!;
  const viaCopy = (await searchJoins(w.store, p.doc(), copyId, T.ZERO, 22)).candidates[0]!;
  const same = T.eq(T.sub(direct.removal.from, T.rt(2, 1)), viaCopy.removal.from) && T.eq(T.sub(direct.removal.to, T.rt(2, 1)), viaCopy.removal.to);
  return { id: 'S7', status: same ? 'partial' : 'fail', measured: { direct: [T.toSeconds(direct.removal.from), T.toSeconds(direct.removal.to)], viaCopy: [T.toSeconds(viaCopy.removal.from), T.toSeconds(viaCopy.removal.to)], offset: 2, sameRemoval: same }, missing: ['the copy was cut by ffmpeg in this proof, not made by a local-tool job'] };
}
async function L3(w: World): Promise<MusicfitCheck> {
  const two = twoToneSong(), p = w.add(two);
  const record = (over: Partial<LibraryRecord> = {}): LibraryRecord => ({ itemId: 'synthetic/two.wav', sourceId: 'synthetic', kind: 'music', title: 'Two tones', sourceSha256: 'b'.repeat(64), ledger: { item: 'synthetic' }, licence: { id: 'CC-BY-4.0' }, credit: { text: '"Two tones" by the proof, CC BY 4.0', placement: 'description' }, flags: {}, ...over });
  const blobs = () => fs.readdirSync(path.join(w.dir, 'blobs'), { recursive: true }).length;
  const before = blobs();
  const removal = { from: T.rt(4, 1), to: T.rt(20, 1) };
  // (a) a record the licence table refuses (the library would not take it in; set on a copy of the document to reach the rule)
  const nd = structuredClone(p.doc()); nd.assets[p.assetId]!.provenance = { origin: 'upload', importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof', library: record({ licence: { id: 'CC-BY-ND-4.0' } }) };
  const planRefusal = await makeFittedSong(w.store, nd, p.assetId, T.ZERO, removal, 'proof').then(() => null, (e: { code: string; message: string; hint?: string }) => ({ code: e.code, message: e.message, hint: e.hint }));
  // (b) a file made from two library files
  const two2 = structuredClone(p.doc());
  const lib = (id: string, n: number): Asset => ({ ...two2.assets[p.assetId]!, id, contentHash: `sha256:${String(n).repeat(64)}`, provenance: { origin: 'upload', importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof', library: record({ itemId: `synthetic/${id}.wav` }) } });
  two2.assets.ast_l1 = lib('ast_l1', 1); two2.assets.ast_l2 = lib('ast_l2', 2);
  two2.assets[p.assetId]!.provenance = { origin: 'derived', importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof', derived: { jobId: 'j', capabilityId: 'c', capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: ['ast_l1', 'ast_l2'], outputName: 'o', outputRole: 'audio', encoding: 'pcm', provider: {} } };
  const manyRefusal = await makeFittedSong(w.store, two2, p.assetId, T.ZERO, removal, 'proof').then(() => null, (e: { code: string; message: string }) => ({ code: e.code, message: e.message }));
  // the operation refuses both too (fail-closed), whatever the server checked
  const after = blobs();
  const made = await makeFittedSong(w.store, p.doc(), p.assetId, T.ZERO, removal, 'proof'); // the owner's own file passes
  const opRefusal = (doc: ProjectDocument, asset: unknown) => { try { applyTransaction(doc, [{ op: 'add_fitted_music', args: { asset, grid: made.grid } }], { idSeed: 'l3_', actor: 'proof', allowInternal: true }); return null; } catch (e) { return e instanceof OpError ? e.message : String(e); } };
  const opNd = opRefusal(nd, { ...made.asset, provenance: { ...made.asset.provenance, library: record({ licence: { id: 'CC-BY-ND-4.0' } }) } });
  const opMany = opRefusal(two2, made.asset);
  const ok = planRefusal?.message === MUSICFIT_REFUSALS.licenceNoDerivatives.message('CC-BY-ND-4.0') && !!planRefusal.hint && manyRefusal?.message === MUSICFIT_REFUSALS.licenceManyOrigins.message()
    && opNd === MUSICFIT_REFUSALS.licenceNoDerivatives.message('CC-BY-ND-4.0') && opMany === MUSICFIT_REFUSALS.licenceManyOrigins.message() && after === before;
  return { id: 'L3', status: ok ? 'partial' : 'fail', measured: { maker: planRefusal, makerMany: manyRefusal, op: opNd, opMany, blobsMadeByRefusals: after - before }, missing: ['the plan route\'s refusal is builder B\'s (musicfit/plan.ts); measured here: the maker that apply calls and the operation'] };
}

// ---------------------------------------------------------------- I1, I2: impact sync
const R = { num: 30, den: 1 };
const shownSourceFrame = (doc: ProjectDocument, clipId: string, frame: number): number | null => {
  const l = evaluate(doc, T.frameTime(frame, R)).layers.find((x) => (x as { clipId?: string }).clipId === clipId) as { sourceFrameIndex?: number } | undefined;
  return l?.sourceFrameIndex ?? null;
};
/** The timeline frame (inside the clip) at which evaluate shows source frame `w`. */
const frameShowingWhite = (doc: ProjectDocument, c: MediaClip, w: number) => {
  const a = T.frameIndexAt(c.start, R), b = T.frameIndexAt(T.add(c.start, c.duration), R);
  for (let k = a; k < b; k++) if (shownSourceFrame(doc, c.id, k) === w) return k;
  return null;
};
function barcodeDoc(musicCopy = false): { doc: ProjectDocument; v: string; m: string; W: number } {
  const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`, prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof' };
  let doc = createProject({ id: 'prj_i1', name: 'I1', width: 320, height: 180 });
  doc.assets.ast_bar = { id: 'ast_bar', kind: 'video', name: 'barcode.mp4', contentHash: hash(1), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 320, height: 180, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
  doc.assets.ast_m = { id: 'ast_m', kind: 'audio', name: 'music.wav', contentHash: hash(2), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
  const beats = Array.from({ length: 128 }, (_, k) => T.rt(15 * k, 32)); // 128 BPM: beats fall between frames
  doc.analyses.ast_m = { assetId: 'ast_m', beats: { origin: { method: 'proof grid', params: {}, createdAt: prov.importedAt, createdBy: 'proof', edited: false }, bpm: 128, confidence: 0.9, beats, downbeats: beats.filter((_, k) => k % 4 === 0), meter: 4 } };
  // I2: the music clip shows a time-preserving copy of the measured music that starts 1 s into it (a derived file record)
  if (musicCopy) doc.assets.ast_copy = { ...doc.assets.ast_m, id: 'ast_copy', contentHash: hash(9), duration: T.rt(50, 1), provenance: { origin: 'derived', importedAt: prov.importedAt, importedBy: 'proof', derived: { jobId: 'proof_copy', capabilityId: 'proof.copy', capabilityVersion: '1', graphDigest: `sha256:${'0'.repeat(64)}`, params: {}, sourceAssetIds: ['ast_m'], outputName: 'copy', outputRole: 'audio', encoding: 'pcm', provider: {}, sourceRangeStart: T.rt(1, 1) } } } as Asset;
  const r = applyTransaction(doc, [{ op: 'add_clip', args: { assetId: 'ast_bar', start: T.ZERO, sourceIn: T.rt(2, 1), duration: T.rt(4, 1) } }, { op: 'add_clip', args: { assetId: musicCopy ? 'ast_copy' : 'ast_m', start: T.ZERO, withLinkedAudio: false } }], { idSeed: 'i1_', actor: 'proof' });
  doc = r.doc;
  return { doc, v: r.results[0]!.output!.clipId as string, m: r.results[1]!.output!.clipId as string, W: 97 }; // the white frame: source frame 97 (3.2333… s)
}
async function I1(): Promise<MusicfitCheck> {
  const { doc, v, W } = barcodeDoc();
  let n = 0;
  const tx = (d: ProjectDocument, ops: { op: string; args: unknown }[]) => applyTransaction(d, ops, { idSeed: `i1x${n++}_`, actor: 'proof', allowInternal: true });
  const clip = (d: ProjectDocument) => Object.values(d.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === v) as MediaClip;
  const moment = T.frameTime(W, R);
  const beforeFrame = frameShowingWhite(doc, clip(doc), W)!;
  const r = tx(doc, [{ op: 'sync_impact', args: { clipId: v, moment, to: 'beat' } }]);
  const out = r.results[0]!.output as unknown as SyncImpactOutput;
  const c0 = clip(doc), c1 = clip(r.doc);
  const afterFrame = frameShowingWhite(r.doc, c1, W)!;
  const beatFrame = Math.round(T.toSeconds(out.used) * 30);
  const sound0 = Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id !== v && c.type === 'media' && c.linkGroupId && c.linkGroupId === c0.linkGroupId) as MediaClip;
  const sound1 = Object.values(r.doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((c) => c.id === sound0.id) as MediaClip;
  const changes = diffEntities(doc, r.doc);
  const back = tx(r.doc, [{ op: 'restore_entities', args: { targets: changes.map((x) => ({ id: x.id, state: x.before })) } }]).doc;
  // no room: the same clip showing its file from 0 and a moment that needs later source than there is
  const tight = structuredClone(doc); clip(tight).sourceIn = T.ZERO; clip(tight).duration = T.rt(10, 1);
  for (const s of tight.sequences.seq_main!.tracks) for (const c of s.clips) if (c.id === sound0.id) { (c as MediaClip).sourceIn = T.ZERO; (c as MediaClip).duration = T.rt(10, 1); }
  let noRoom: Record<string, unknown> | null = null;
  try { tx(tight, [{ op: 'sync_impact', args: { clipId: v, moment: T.frameTime(4, R), to: 'beat', pick: 'later' } }]); } catch (e) { if (e instanceof OpError) noRoom = { message: e.message, ...e.details }; }
  // a reversed clip
  const rev = applyTransaction(doc, [{ op: 'set_clip_reverse', args: { clipId: v, reverse: true } }], { idSeed: 'i1r_', actor: 'proof' }).doc;
  const revPlan = planImpact(rev, v, moment, 'beat');
  const revDone = applyTransaction(rev, [{ op: 'sync_impact', args: { clipId: v, moment, to: 'beat' } }], { idSeed: 'i1s_', actor: 'proof' }).doc;
  const revFrame = frameShowingWhite(revDone, clip(revDone), W);
  const ok = afterFrame === beatFrame && T.eq(c0.start, c1.start) && T.eq(c0.duration, c1.duration) && T.eq(T.sub(sound1.sourceIn, sound0.sourceIn), T.sub(c1.sourceIn, c0.sourceIn))
    && out.offsetBefore.frames === beforeFrame - beatFrame && Math.abs(out.residualMs) <= 1000 / 60 && diffEntities(doc, back).length === 0
    && noRoom?.message === MUSICFIT_REFUSALS.noRoom.message() && 'maxEarlier' in noRoom && 'maxLater' in noRoom && !('refusal' in revPlan) && revFrame === revPlan.targetFrame;
  return {
    id: 'I1', status: ok ? 'partial' : 'fail',
    measured: { whiteFrameBefore: beforeFrame, beatFrame, whiteFrameAfter: afterFrame, offsetBefore: out.offsetBefore, residualMs: out.residualMs, linkedSoundSlippedAlike: T.eq(T.sub(sound1.sourceIn, sound0.sourceIn), T.sub(c1.sourceIn, c0.sourceIn)), undoExact: diffEntities(doc, back).length === 0, noRoom, reversed: 'refusal' in revPlan ? revPlan : { target: revPlan.targetFrame, whiteFrameAfter: revFrame } },
    missing: ['the white frame is read from evaluate (the function the server still and the export draw from), not from the pixels of a server still or an export', 'the beep is the linked sound clip\'s slip, not measured in exported sound'],
  };
}
async function I2(): Promise<MusicfitCheck> {
  const { doc, v, W } = barcodeDoc(true);
  const r = applyTransaction(doc, [{ op: 'sync_impact', args: { clipId: v, moment: T.frameTime(W, R), to: 'beat' } }], { idSeed: 'i2b_', actor: 'proof' });
  const out = r.results[0]!.output as unknown as SyncImpactOutput;
  const c = Object.values(r.doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((x) => x.id === v) as MediaClip;
  const after = frameShowingWhite(r.doc, c, W);
  const ok = out.viaAssetId === 'ast_m' && after === Math.round(T.toSeconds(out.used) * 30);
  return { id: 'I2', status: ok ? 'partial' : 'fail', measured: { viaAssetId: out.viaAssetId, whiteFrameAfter: after, usedBeatSeconds: T.toSeconds(out.used) }, missing: ['the copy is a derived file record with its offset, not one made by a local-tool job'] };
}

/** Every check of this part, in order; the integration step imports this. */
export async function runMusicfitMakers(): Promise<MusicfitCheck[]> {
  const out: MusicfitCheck[] = [];
  const guard = async (id: string, fn: () => Promise<MusicfitCheck>) => { try { out.push(await fn()); } catch (e) { out.push({ id, status: 'fail', measured: {}, error: String((e as Error)?.stack ?? e).slice(0, 600) }); } };
  await guard('B1', B1);
  await guard('B2', B2);
  const w = world();
  try {
    for (const [id, fn] of [['S1', S1], ['S2', S2], ['S3', S3], ['S4', S4], ['S7', S7], ['L3', L3]] as const) await guard(id, () => fn(w));
  } finally { w.close(); }
  await guard('I1', I1);
  await guard('I2', I2);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t0 = performance.now();
  const checks = await runMusicfitMakers();
  for (const c of checks) console.log(`${c.status.toUpperCase().padEnd(7)} ${c.id} ${JSON.stringify(c.measured).slice(0, 600)}${c.missing ? `\n        not measured: ${c.missing.join('; ')}` : ''}${c.error ? `\n        ${c.error}` : ''}`);
  console.log(`musicfit makers: ${checks.filter((c) => c.status === 'pass').length} pass, ${checks.filter((c) => c.status === 'partial').length} partial, ${checks.filter((c) => c.status === 'fail').length} fail; ${Math.round(performance.now() - t0)} ms (one sample)`);
  process.exit(checks.some((c) => c.status === 'fail') ? 1 : checks.some((c) => c.status === 'partial') ? 3 : 0);
}
