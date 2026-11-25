/**
 * The join search of a shortened song (wave 7 musicfit, decisions §2.11 and plan C9 minus the lag; built by builder A). A HEURISTIC
 * on measured numbers; nothing here says how a join sounds. Server only, Node only; floats stay here and only rounded numbers enter
 * a document. Every time that enters a document is a rational of the song's own beat analysis.
 *
 * - decodeSong: the song's first sound stream as 48 kHz stereo 16-bit PCM, on the file's own clock (the aresample first_pts rule of
 *   audiomix.ts). One decode at a time (a serial lane of this module); the two most recent songs are kept in memory by content hash.
 * - usableEndFrames: the frame after the last sample above MUSICFIT.silenceDbfs (−60 dBFS).
 * - Bar features: eight equal slices between two consecutive bar starts; per slice a 4096-point Hann FFT of the mono mix at the
 *   slice's middle: 12 pitch-class energies from 130 Hz to 4186 Hz (unit length), six octave band levels in dB from 130 Hz, and
 *   the slice's RMS in dB.
 * - Cost of removing [bar a, bar b): the mean over i = −2 … 1 of the distance between bar a + i and bar b + i (0.6 · mean over
 *   slices of (1 − cosine of the pitch classes) + 0.4 · min(1, mean band-level difference / 12 dB)), plus 0.1 · min(1, |level step|
 *   / 6 dB) (bar b's RMS against bar a's), plus 0 / 0.1 / 0.2 when both bar starts are 4 / 2 / 1 bars from the first bar start at
 *   or after the clip's start. similarity = 1 − cost, clamped to [0, 1], three decimals. A candidate's grid that is not strictly
 *   ascending is dropped (core fittedGrid).
 * - Candidates: k whole bars removed, k from the one that brings the made length nearest the wanted length and its two neighbours;
 *   `a` at least two bars after the first bar start at or after startAt, `b` at least two bars before the last bar start before the
 *   usable end. Ordered by core orderCandidates (cost to 1e-6, phrase, distance to the wanted length, earlier from).
 */
import { spawn } from 'node:child_process';
import * as T from '@pulseframe/time';
import { fittedGrid, MUSICFIT, orderCandidates, ownBeats, timeOriginSeconds, type Asset, type JoinCandidate, type JoinRemoval, type ProjectDocument } from '@pulseframe/core';
import { ANALYSIS_TIMEOUT_MS, fftMag } from '../dsp.ts';
import { ApiError, type Store } from '../store.ts';
import { musicFitApiError } from './routes.ts';

export const SONG_RATE = 48_000;
export interface DecodedSong { contentHash: string; frames: number; /** interleaved stereo, 16 bit */ pcm: Int16Array }

let lane: Promise<unknown> = Promise.resolve();
const cache = new Map<string, DecodedSong>();
const CACHE_SONGS = 2;
const cancelled = () => new ApiError(503, 'music_cancelled', 'the song was not read: the request was cancelled', {}, 'Ask again if you still want it.');

/** The song's sound as 48 kHz stereo 16-bit PCM on its own clock (see the header). */
export function decodeSong(store: Store, asset: Asset, signal?: AbortSignal): Promise<DecodedSong> {
  const hit = cache.get(asset.contentHash);
  if (hit) { cache.delete(asset.contentHash); cache.set(asset.contentHash, hit); return Promise.resolve(hit); }
  const job = lane.then(async () => {
    if (signal?.aborted) throw cancelled();
    const again = cache.get(asset.contentHash);
    if (again) return again;
    const origin = timeOriginSeconds(asset);
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-copyts', '-i', store.blobPath(asset.contentHash), '-map', '0:a:0', '-af', `aresample=${SONG_RATE}:first_pts=${Math.round(origin * SONG_RATE)}`, '-ac', '2', '-ar', String(SONG_RATE), '-f', 's16le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const parts: Buffer[] = [];
      const timer = setTimeout(() => p.kill('SIGKILL'), ANALYSIS_TIMEOUT_MS);
      const abort = () => p.kill('SIGKILL');
      signal?.addEventListener('abort', abort, { once: true });
      p.stdout.on('data', (b: Buffer) => parts.push(b));
      p.on('error', (e) => { clearTimeout(timer); reject(e); });
      p.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) return reject(cancelled());
        if (code !== 0) return reject(new ApiError(422, 'decode_failed', 'the sound of this file could not be read', { assetId: asset.id }, 'Check the file plays, or choose another.'));
        resolve(Buffer.concat(parts));
      });
    });
    const frames = Math.floor(bytes.length / 4);
    const pcm = new Int16Array(frames * 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(2 * i);
    const song = { contentHash: asset.contentHash, frames, pcm };
    cache.set(asset.contentHash, song);
    while (cache.size > CACHE_SONGS) cache.delete(cache.keys().next().value!);
    return song;
  });
  lane = job.catch(() => undefined);
  return job;
}
/** The frame after the last sample louder than −60 dBFS (0 for silence). */
export function usableEndFrames(song: DecodedSong): number {
  const limit = 32768 * 10 ** (MUSICFIT.silenceDbfs / 20);
  for (let n = song.frames - 1; n >= 0; n--) if (Math.abs(song.pcm[2 * n]!) > limit || Math.abs(song.pcm[2 * n + 1]!) > limit) return n + 1;
  return 0;
}
/** A source time as the sample frame nearest to it (exact rational rounding, ties up). */
export const frameOf = (t: T.RationalTime): number => T.nearestSampleIndex(t, SONG_RATE);

// ---------- bar features ----------
const N = 4096, SLICES = 8;
const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
const LOW_HZ = 130, HIGH_HZ = 4186;
export interface BarFeature { pc: Float64Array[]; bands: Float64Array[]; rmsDb: number }
const dbOf = (x: number) => 10 * Math.log10(Math.max(x, 1e-12));
function sliceFeature(song: DecodedSong, from: number, to: number): { pc: Float64Array; bands: Float64Array; ms: number } {
  const re = new Float64Array(N), im = new Float64Array(N);
  const mid = Math.floor((from + to) / 2), start = mid - N / 2;
  const pc = new Float64Array(12), bands = new Float64Array(6);
  // each channel's spectrum on its own, energies summed: a mixdown (L + R) would measure a side-only file (right = −left, what
  // the classic vocal removal makes) as silence (wave 7 integration; splice.test.ts "opposite"). For left = right the pitch classes
  // are the same and every band 3 dB higher in every bar, so the distances between bars do not change.
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < N; i++) { const n = start + i; re[i] = n >= 0 && n < song.frames ? (song.pcm[2 * n + c]! / 32768) * HANN[i]! : 0; im[i] = 0; }
    fftMag(re, im);
    for (let k = 1; k < N / 2; k++) {
      const hz = (k * SONG_RATE) / N;
      if (hz < LOW_HZ || hz > HIGH_HZ * 2) continue;
      const e = re[k]! * re[k]! + im[k]! * im[k]!;
      if (hz <= HIGH_HZ) pc[(((Math.round(12 * Math.log2(hz / 440)) + 69) % 12) + 12) % 12]! += e;
      const band = Math.floor(Math.log2(hz / LOW_HZ));
      if (band >= 0 && band < 6) bands[band]! += e;
    }
  }
  let norm = 0;
  for (const v of pc) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < 12; i++) pc[i] = pc[i]! / norm;
  for (let i = 0; i < 6; i++) bands[i] = dbOf(bands[i]!);
  let ms = 0;
  for (let n = from; n < to; n++) { const a = song.pcm[2 * n]! / 32768, b = song.pcm[2 * n + 1]! / 32768; ms += (a * a + b * b) / 2; }
  return { pc, bands, ms: ms / Math.max(1, to - from) };
}
/** The features of the bar from frame `from` to frame `to`. */
export function barFeature(song: DecodedSong, from: number, to: number): BarFeature {
  const pc: Float64Array[] = [], bands: Float64Array[] = [];
  let ms = 0;
  for (let s = 0; s < SLICES; s++) {
    const a = from + Math.floor(((to - from) * s) / SLICES), b = from + Math.floor(((to - from) * (s + 1)) / SLICES);
    const f = sliceFeature(song, a, b);
    pc.push(f.pc); bands.push(f.bands); ms += f.ms * (b - a);
  }
  return { pc, bands, rmsDb: dbOf(ms / Math.max(1, to - from)) };
}
/** Distance of two bars (see the header), 0 for bars with the same samples. */
export function barDistance(x: BarFeature, y: BarFeature): number {
  let tonal = 0, level = 0;
  for (let s = 0; s < SLICES; s++) {
    let dot = 0, nx = 0, ny = 0;
    for (let i = 0; i < 12; i++) { dot += x.pc[s]![i]! * y.pc[s]![i]!; nx += x.pc[s]![i]! ** 2; ny += y.pc[s]![i]! ** 2; }
    tonal += nx > 0 && ny > 0 ? 1 - dot / Math.sqrt(nx * ny) : nx === ny ? 0 : 1;
    let d = 0;
    for (let i = 0; i < 6; i++) d += Math.abs(x.bands[s]![i]! - y.bands[s]![i]!);
    level += d / 6;
  }
  return 0.6 * (tonal / SLICES) + 0.4 * Math.min(1, level / SLICES / 12);
}

// ---------- the search ----------
export interface SongBars {
  /** Bar starts of the song's current analysis (source clock), from the first at or after startAt to the last before the usable end. */
  starts: T.RationalTime[]; frames: number[]; features: BarFeature[];
  /** Index (into `starts`) of the first bar start at or after the clip's start. */
  first: number;
}
export interface JoinSearch {
  usableEnd: T.RationalTime; usableEndFrames: number; candidates: JoinCandidate[];
  /** Standard deviation of the measured beat intervals in the used part (ms, one decimal). */
  tempoSpreadMs: number; beatConfidence: number | null; bars: number;
}
/** The song's bars with their features (needs_bars without at least six bar starts after startAt). */
export function songBars(doc: ProjectDocument, assetId: string, song: DecodedSong, startAt: T.RationalTime, endFrames: number): SongBars {
  const own = ownBeats(doc, assetId);
  const all = (own?.downbeats ?? []).filter((t) => !T.lt(t, startAt) && frameOf(t) < endFrames);
  if (all.length < 6) throw musicFitApiError('needsBars', { assetId, bars: all.length });
  const frames = all.map(frameOf);
  const features = all.slice(0, -1).map((_, i) => barFeature(song, frames[i]!, frames[i + 1]!));
  return { starts: all, frames, features, first: 0 };
}
const spreadMs = (beats: readonly T.RationalTime[]): number => {
  if (beats.length < 3) return 0;
  const d = beats.slice(1).map((b, i) => T.toSeconds(T.sub(b, beats[i]!)) * 1000);
  const mean = d.reduce((x, y) => x + y, 0) / d.length;
  return Math.round(Math.sqrt(d.reduce((x, y) => x + (y - mean) ** 2, 0) / d.length) * 10) / 10;
};
/** The measured numbers and the cost of removing [bars.starts[a], bars.starts[b]). */
export function scoreRemoval(bars: SongBars, a: number, b: number, tempoSpread: number, beatConfidence: number | null): { cost: number; measured: JoinCandidate['measured'] } {
  let dist = 0, n = 0;
  for (let i = -2; i <= 1; i++) {
    const x = bars.features[a + i], y = bars.features[b + i];
    if (!x || !y) continue;
    dist += barDistance(x, y); n++;
  }
  const levelStepDb = (bars.features[b]?.rmsDb ?? 0) - (bars.features[a]?.rmsDb ?? 0);
  const off = (i: number) => i - bars.first;
  const phraseBars: 1 | 2 | 4 = off(a) % 4 === 0 && off(b) % 4 === 0 ? 4 : off(a) % 2 === 0 && off(b) % 2 === 0 ? 2 : 1;
  const cost = (n ? dist / n : 1) + 0.1 * Math.min(1, Math.abs(levelStepDb) / 6) + (phraseBars === 4 ? 0 : phraseBars === 2 ? 0.1 : 0.2);
  const similarity = Math.round(Math.max(0, Math.min(1, 1 - cost)) * 1000) / 1000;
  return { cost, measured: { similarity, levelStepDb: Math.round(levelStepDb * 10) / 10, phraseBars, tempoSpreadMs: tempoSpread, beatConfidence } };
}
/**
 * The join candidates of a song for a clip that starts at `startAt` of it and a wanted made length (seconds). Refuses 400 too_long
 * (over MUSICFIT.maxSeconds), 409 needs_bars, 409 no_join. Pure apart from decoding the file.
 */
export async function searchJoins(store: Store, doc: ProjectDocument, assetId: string, startAt: T.RationalTime, wantedSeconds: number, signal?: AbortSignal): Promise<JoinSearch> {
  const asset = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]! : null;
  if (!asset || !asset.audio) throw new ApiError(404, 'not_found', `asset ${assetId} not found`, { assetId });
  if (T.toSeconds(asset.duration) > MUSICFIT.maxSeconds) throw musicFitApiError('tooLongSong', { assetId });
  if (!ownBeats(doc, assetId)?.downbeats.length) throw musicFitApiError('needsBars', { assetId, bars: 0 });
  const song = await decodeSong(store, asset, signal);
  const endFrames = usableEndFrames(song);
  const usableEnd = T.rt(endFrames, SONG_RATE);
  const bars = songBars(doc, assetId, song, startAt, endFrames);
  const own = ownBeats(doc, assetId)!;
  const usedBeats = own.beats.filter((t) => !T.lt(t, startAt) && T.lt(t, usableEnd));
  const tempo = spreadMs(usedBeats), conf = own.analysis.confidence ?? null;
  const D = T.toSeconds(T.sub(usableEnd, startAt));
  const last = bars.starts.length - 1; // the last bar start (its bar may run to the usable end)
  const meanBar = T.toSeconds(T.sub(bars.starts[last]!, bars.starts[0]!)) / last;
  const k0 = Math.max(1, Math.round((D - wantedSeconds) / meanBar));
  const scored: (JoinCandidate & { cost: number })[] = [];
  const source = { beats: own.beats, downbeats: own.downbeats, duration: asset.duration };
  for (const k of [k0 - 1, k0, k0 + 1]) {
    if (k < 1) continue;
    for (let a = bars.first + 2; a + k <= last - 2; a++) {
      const b = a + k;
      const removal: JoinRemoval = { from: bars.starts[a]!, to: bars.starts[b]! };
      const g = fittedGrid(source, startAt, removal, usableEnd);
      if (!g) continue;
      const madeSeconds = Math.round(T.toSeconds(g.duration) * 1000) / 1000;
      const s = scoreRemoval(bars, a, b, tempo, conf);
      scored.push({ removal, madeSeconds, offBySeconds: Math.round((madeSeconds - wantedSeconds) * 1000) / 1000, measured: s.measured, cost: s.cost });
    }
  }
  const candidates = orderCandidates(scored, wantedSeconds);
  if (!candidates.length) throw musicFitApiError('noJoin', { assetId, bars: bars.starts.length });
  return { usableEnd, usableEndFrames: endFrames, candidates, tempoSpreadMs: tempo, beatConfidence: conf, bars: bars.starts.length };
}
