/**
 * The made file of a shortened song (wave 7 musicfit, decisions §2.11; built by builder A): the song from `startAt` to its usable
 * end with ONE removal of whole bars [from, to), joined by a linear equal-gain crossfade that ENDS on the join, so from the join on
 * only the landing side plays. Integer sample arithmetic; the same code makes the file and the join.wav preview (spliceRange).
 *
 * Frames (48 kHz): s = startAt, f = from, t = to, e = the usable end (all whole frames: a rational time is taken to its nearest
 * frame), j = f − s the join in the made file, X the crossfade. Made frame n, channel c (src = the song's samples):
 *   n < j − X:         src[s + n]
 *   j − X ≤ n < j:     i = n − (j − X); round((src[s + n]·(X − i) + src[t − (j − n)]·i) / X)   (Math.round)
 *   n ≥ j:             src[t + (n − j)]
 * The made file has e − s − (t − f) frames. X = the quarter of the beat interval that starts at `to`, in whole frames, kept within
 * MUSICFIT.crossfadeMinMs … crossfadeMaxMs. A heuristic's file: nothing here says how the join sounds; it is labelled «עוד לא
 * הושמע» until the owner marks it.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import {
  FIT_GRID_METHOD, FIT_METHOD, fitLicenceProblem, fitLicenceRefusal, fittedGrid, fittedLibraryRecord, fittedSourceRecord, MUSICFIT, ownBeats,
  type Asset, type FittedGrid, type JoinCandidate, type JoinRemoval, type ProjectDocument,
} from '@pulseframe/core';
import { describeMedia } from '../ingest.ts';
import { writeWav } from '../music/wav.ts';
import { assertStorageRoom } from '../storage.ts';
import { ApiError, type Store } from '../store.ts';
import { decodeSong, frameOf, scoreRemoval, songBars, SONG_RATE, usableEndFrames, type DecodedSong } from './features.ts';
import { musicFitApiError } from './routes.ts';

export interface SpliceSpec { start: number; from: number; to: number; end: number; crossfade: number; /** frames of the made file */ total: number; /** the join in the made file */ join: number }
/** The crossfade in frames for a removal ending at `to`: a quarter of the beat interval starting there, within 20 … 60 ms. */
export function crossfadeFrames(beats: readonly T.RationalTime[], to: T.RationalTime): number {
  const lo = (MUSICFIT.crossfadeMinMs * SONG_RATE) / 1000, hi = (MUSICFIT.crossfadeMaxMs * SONG_RATE) / 1000;
  const next = beats.find((b) => T.lt(to, b));
  if (!next) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(T.toSeconds(T.sub(next, to)) * SONG_RATE / 4)));
}
/** The splice in frames; null when it does not fit (the crossfade must lie inside the kept part before the join and the removal). */
export function spliceSpec(startAt: T.RationalTime, removal: JoinRemoval, endFrames: number, crossfade: number): SpliceSpec | null {
  const start = frameOf(startAt), from = frameOf(removal.from), to = frameOf(removal.to), end = endFrames;
  if (!(start >= 0 && start <= from && from < to && to <= end)) return null;
  const join = from - start;
  if (join < crossfade || to - from < crossfade) return null;
  return { start, from, to, end, crossfade, total: end - start - (to - from), join };
}
/** Frames [outFrom, outTo) of the made file, interleaved stereo (the rule of the header). */
export function spliceRange(src: Int16Array, spec: SpliceSpec, outFrom: number, outTo: number): Int16Array {
  const a = Math.max(0, outFrom), b = Math.min(spec.total, outTo);
  const out = new Int16Array(2 * Math.max(0, b - a));
  const { start: s, to: t, join: j, crossfade: X } = spec;
  for (let n = a; n < b; n++) {
    const o = 2 * (n - a);
    for (let c = 0; c < 2; c++) {
      let v: number;
      if (n < j - X) v = src[2 * (s + n) + c]!;
      else if (n < j) { const i = n - (j - X); v = Math.round((src[2 * (s + n) + c]! * (X - i) + src[2 * (t - (j - n)) + c]! * i) / X); }
      else v = src[2 * (t + (n - j)) + c]!;
      out[o + c] = v;
    }
  }
  return out;
}
/** Frames [from, to) of the made file around the join: two bars before it and two after (the join.wav preview), in made frames. */
export function previewWindow(downbeats: readonly T.RationalTime[], startAt: T.RationalTime, removal: JoinRemoval, spec: SpliceSpec): { from: number; to: number } {
  const before = downbeats.filter((d) => T.lt(d, removal.from) && !T.lt(d, startAt));
  const after = downbeats.filter((d) => T.lt(removal.to, d));
  const fromSrc = before.length >= 2 ? frameOf(before[before.length - 2]!) : spec.start;
  const toSrc = after.length >= 2 ? frameOf(after[1]!) : spec.end;
  return { from: Math.max(0, fromSrc - spec.start), to: Math.min(spec.total, spec.join + (Math.min(toSrc, spec.end) - spec.to)) };
}
/** The removal must be two bar starts of the song's CURRENT analysis (409 fit_stale otherwise). */
export function assertRemovalCurrent(doc: ProjectDocument, assetId: string, removal: JoinRemoval): void {
  const own = ownBeats(doc, assetId);
  const isBar = (t: T.RationalTime) => !!own && own.downbeats.some((d) => T.eq(d, t));
  if (!isBar(removal.from) || !isBar(removal.to) || !T.lt(removal.from, removal.to)) throw musicFitApiError('fitStale', { assetId, from: removal.from, to: removal.to });
}

export interface MadeFittedSong {
  /** The asset record for add_fitted_music (stored blob; id given by the op). */
  asset: Omit<Asset, 'id'>;
  /** The made file's beats for add_fitted_music.grid, exactly mapped from the source's (core fittedGrid), inside the file. */
  grid: FittedGrid;
  spec: SpliceSpec; measured: JoinCandidate['measured']; usableEnd: T.RationalTime;
}
/** The made samples of a removal (decoded song, the whole made file), for the server and the proof. */
export function splicedSong(song: DecodedSong, spec: SpliceSpec): Int16Array { return spliceRange(song.pcm, spec, 0, spec.total); }

/**
 * Make, validate and store the shortened song of `assetId` for a clip starting at `startAt` with `removal` (bar starts of its
 * current analysis). Refuses: the licence rule (core fitLicenceProblem, fail-closed, before anything is made); 409 fit_stale; 409
 * needs_bars; 400 too_long; 409 no_join when the removal leaves no room for the crossfade or its grid is not ascending. The asset
 * is not attached to any project: the caller commits add_fitted_music (which checks the licence, the record, the grid and the
 * removal again). `name`: the library name (default "<song> (shortened).wav").
 */
export async function makeFittedSong(store: Store, doc: ProjectDocument, assetId: string, startAt: T.RationalTime, removal: JoinRemoval, actor: string, opts: { signal?: AbortSignal; name?: string } = {}): Promise<MadeFittedSong> {
  const source = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]! : null;
  if (!source || !source.audio) throw new ApiError(404, 'not_found', `asset ${assetId} not found`, { assetId }, 'get_summary lists the library files.');
  const problem = fitLicenceProblem(doc, assetId);
  if (problem) { const e = fitLicenceRefusal(problem, assetId); throw new ApiError(409, e.code, e.message, e.details, e.hint); }
  if (T.toSeconds(source.duration) > MUSICFIT.maxSeconds) throw musicFitApiError('tooLongSong', { assetId });
  assertRemovalCurrent(doc, assetId, removal);
  const own = ownBeats(doc, assetId)!;
  const song = await decodeSong(store, source, opts.signal);
  const endFrames = usableEndFrames(song);
  const usableEnd = T.rt(endFrames, SONG_RATE);
  const spec = spliceSpec(startAt, removal, endFrames, crossfadeFrames(own.beats, removal.to));
  const g = spec && fittedGrid({ beats: own.beats, downbeats: own.downbeats, duration: source.duration }, startAt, removal, usableEnd);
  if (!spec || !g) throw musicFitApiError('noJoin', { assetId, from: removal.from, to: removal.to });
  const bars = songBars(doc, assetId, song, startAt, endFrames);
  const a = bars.starts.findIndex((t) => T.eq(t, removal.from)), b = bars.starts.findIndex((t) => T.eq(t, removal.to));
  const usedBeats = own.beats.filter((t) => !T.lt(t, startAt) && T.lt(t, usableEnd));
  const d = usedBeats.slice(1).map((x, i) => T.toSeconds(T.sub(x, usedBeats[i]!)) * 1000), mean = d.reduce((x, y) => x + y, 0) / Math.max(1, d.length);
  const spread = d.length < 2 ? 0 : Math.round(Math.sqrt(d.reduce((x, y) => x + (y - mean) ** 2, 0) / d.length) * 10) / 10;
  const { measured } = scoreRemoval(bars, a, b, spread, own.analysis.confidence ?? null);
  // the file
  const bytes = writeWav(splicedSong(song, spec));
  const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (!fs.existsSync(store.blobPath(contentHash))) assertStorageRoom(store, bytes.length, 'store this shortened song');
  const tmp = path.join(store.tmpDir, `fitted_${randomBytes(6).toString('hex')}.wav`);
  try {
    fs.writeFileSync(tmp, bytes);
    const meta = await describeMedia(tmp);
    const duration = T.rt(spec.total, SONG_RATE);
    if (meta.kind !== 'audio' || !meta.audio || Math.abs(T.toSeconds(meta.duration) - T.toSeconds(duration)) > 1e-6) throw new ApiError(500, 'music_invalid', 'the shortened song that was made did not pass its check: the file as read back does not have the length that was made', { probed: T.toSeconds(meta.duration), made: T.toSeconds(duration) }, 'This is a fault in this build, not in your request. Nothing was stored.');
    store.putBlob(contentHash, tmp, bytes.length, meta.mimeType);
    const importedAt = new Date().toISOString();
    const library = fittedLibraryRecord(doc, assetId);
    const fetchedRecord = fittedSourceRecord(doc, assetId); // wave 8 sources (C4): a fetched song's copy carries its record
    const inside = (t: T.RationalTime) => T.lt(t, duration);
    const beats = g.beats.filter(inside), downbeats = g.downbeats.filter(inside);
    const base = source.name.replace(/\.[^.]+$/, '');
    const asset: Omit<Asset, 'id'> = {
      ...meta, duration, name: (opts.name ?? `${base} (shortened).wav`).slice(0, 200), contentHash, byteSize: bytes.length,
      provenance: {
        origin: 'derived', importedAt, importedBy: actor, ...(library ? { library } : {}), ...(fetchedRecord ? { source: fetchedRecord } : {}),
        fitted: { sourceAssetId: assetId, method: FIT_METHOD, startAt, removed: { from: removal.from, to: removal.to }, crossfade: T.rt(spec.crossfade, SONG_RATE), joinAt: g.joinAt, measured },
      },
    };
    const grid: FittedGrid = { method: FIT_GRID_METHOD, bpm: own.analysis.bpm, meter: own.analysis.meter ?? null, confidence: own.analysis.confidence ?? null, beats, downbeats };
    return { asset, grid, spec, measured, usableEnd };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
