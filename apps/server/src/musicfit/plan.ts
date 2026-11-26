/**
 * The music-fit planner on the server (wave 7 musicfit, BUILDER B; .artifacts/wave7/musicfit-decisions.md §2–§4): what «התאמה
 * לאורך» and «מוזיקה אחרת» would do to a free music clip, a family film or a template run, before anything is made or changed.
 *
 * - A target is a music clip ({clipId}) or a run ({runId}: a family film, or a template). A run is planned by its own planner
 *   (core planFamilyFilm through filmRegeneration; templateRegeneration), regenerated with the new music; a clip is given the new
 *   file by core planMusicSwap (trim_clip, replace_clip_media, then the ending steps: no new op).
 * - Built-in music, tailored: composed again for exactly the length, from the file's start (core exactLayoutFor; a clip that does
 *   not start at its file's start is refused not_from_start). A film is planned with musicGridSteady, so its end never depends on
 *   the track; the plan is made on a draft that holds a stand-in record of the track (the same layout and known grid, no bytes),
 *   and apply makes it again with the real file before anything is committed (fit_unstable when they differ).
 * - A song, tailored: ONE removal of whole bars, found by builder A's join search (SongFitter; builtSongFitter since integration). The
 *   licence rule (core fitLicenceProblem, fail-closed) refuses before anything is searched or made; a song without measured bar
 *   starts is needs_bars; one over MUSICFIT.maxSeconds too_long. Every candidate's numbers are measured, not heard.
 * - The flash rule (§2.14, C10): only a cut THIS plan makes that comes closer than flashGapFrames to another cut blocks (flash_gap);
 *   two kept cuts that close are the warning kept_cuts_close. A cut is the start frame of a picture clip on any picture track of
 *   the sequence, all tracks merged.
 * - Builder A's pure functions (cutStats, planImpact) and the server makers (makeMusic, the song fitter) are reached through
 *   `musicFitDeps`, so unit tests can use small labelled doubles (musicFit.plan.test.ts) beside the real ones (musicFit.real.test.ts).
 * Nothing here is committed: apply.ts commits (two commits: the made file, then one transaction).
 */
import * as T from '@pulseframe/time';
import {
  applyTransaction, barsForDuration, BUILTIN_MUSIC_ASSET_KEY, clipEnd, cutStats, exactLayoutFor, FAMILY_FILM_RUN_RECIPE_ID, FAMILY_FILM_TEMPLATE_ID, FAMILY_FILM_VERSION, FilmError, FILM_BINDS,
  filmRunParams, filmRunRecordParams, findClip, findMusicStyle, fitLicenceProblem, fitLicenceRefusal, fitSourceNotes, flashGapFrames, followable, isBuiltinMusic, joinMeasuredSentence, knownGridOf, MUSIC_GENERATOR,
  MUSIC_MAX_SECONDS, MUSIC_SAMPLE_RATE, MUSICFIT, MUSICFIT_COMPOSED_AGAIN, musicFitRefusal, MusicFitNotBuilt, musicLayout, musicProvenanceParams, musicStartOf, OpError, ownBeats, placedMusicGrid, planFamilyFilm,
  planImpact, planMusicSwap, sampleFramesFor, sha256Hex, TemplateError,
  type Asset, type CutStats, type FamilyFilmPlan, type FittedGrid, type JoinCandidate, type JoinRemoval, type KnownGrid, type MediaClip, type MusicFitNote, type MusicFitPlan, type MusicFitPlanRequest, type OpCall,
  type ProjectDocument, type RecipeRun, type TemplatePlan,
} from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import { filmRegeneration, FILM_API_ERRORS, refuseAgesInPlan } from '../familyFilm.ts';
import { makeMusic } from '../music.ts';
import { instrumentsError } from '../instruments/contract.ts';
import { ApiError, type Store } from '../store.ts';
import { makeTemplateAssets, templateApiError, templateElements, templateOfRun, templateRegeneration, templateRegenerationOp, withoutClips } from '../templates.ts';
import { musicFitApiError } from './routes.ts';
import { searchJoins } from './features.ts';
import { makeFittedSong } from './splice.ts';

type RT = T.RationalTime;

// ---------- what the planner needs from builder A (and the music queue) ----------
/**
 * Builder A's join search and splice (apps/server/src/musicfit/features.ts, splice.ts), as this planner calls them. Registered at
 * integration as the default (builtSongFitter below); with none set, a tailored song answers 501 musicfit_not_built after its licence and bar checks.
 */
export interface SongFitter {
  /** Up to MUSICFIT.maxCandidates removals of whole bars from the song played from `startAt`, ordered (core orderCandidates). */
  candidates(a: { store: Store; projectId: string; doc: ProjectDocument; assetId: string; startAt: RT; wantedSeconds: number; signal?: AbortSignal }): Promise<{ candidates: JoinCandidate[]; basis: string[]; /** The song's usable end (source clock, whole 48 kHz frames), so the made length is exact. */ usableEnd?: RT }>;
  /** The made file of one removal (checked against the song's current analysis: 409 fit_stale otherwise), stored, not committed. */
  make(a: { store: Store; projectId: string; doc: ProjectDocument; assetId: string; startAt: RT; removal: JoinRemoval; actor: string; signal?: AbortSignal }): Promise<{ asset: Omit<Asset, 'id'>; grid: FittedGrid }>;
}
export interface MusicFitDeps {
  makeMusic: typeof makeMusic;
  makeTemplateAssets: typeof makeTemplateAssets;
  cutStats: typeof cutStats;
  planImpact: typeof planImpact;
  songFitter: SongFitter | null;
}
/**
 * Builder A's join search (features.ts searchJoins) and splice (splice.ts makeFittedSong) behind B's SongFitter (wave 7 musicfit
 * integration). Both are reached at call time only (the musicfit modules import each other). The basis sentences say what was
 * measured, never how the join sounds.
 */
export const builtSongFitter: SongFitter = {
  async candidates({ store, doc, assetId, startAt, wantedSeconds, signal }) {
    const s = await searchJoins(store, doc, assetId, startAt, wantedSeconds, signal);
    const basis = [
      `the song's bar starts come from its own beat analysis: ${s.bars} bar starts in the part used, from ${secs(startAt)} s to its usable end at ${secs(s.usableEnd)} s; only whole bars are removed`,
      `measured beat-interval spread ${s.tempoSpreadMs.toFixed(1)} ms; beat confidence ${s.beatConfidence === null ? 'not given' : s.beatConfidence.toFixed(2)}; each candidate is scored on the pitch classes and band levels of the bars on both sides of the join (${s.candidates.length} candidate(s) kept)`,
    ];
    return { candidates: s.candidates, basis, usableEnd: s.usableEnd };
  },
  async make({ store, doc, assetId, startAt, removal, actor, signal }) {
    const m = await makeFittedSong(store, doc, assetId, startAt, removal, actor, signal ? { signal } : {});
    return { asset: m.asset, grid: m.grid };
  },
};
/** The functions the planner and apply call; tests replace them with labelled doubles. */
export const musicFitDeps: MusicFitDeps = { makeMusic, makeTemplateAssets, cutStats, planImpact, songFitter: builtSongFitter };
/** Integration: builder A's song fitter (the default since integration; tests may set null to see the not-built answer). */
export const setSongFitter = (f: SongFitter | null): void => { musicFitDeps.songFitter = f; };

// ---------- errors ----------
const FILM_STATUS: Record<FilmError['code'], number> = { not_found: 404, needs_analysis: 409, invalid_args: 400, nothing_to_do: 409 };
/** Every error of the planners as the API reports it (an OpError as Store.commit reports it; a function A has not built: 501). */
export function asApiError(e: unknown): unknown {
  if (e instanceof ApiError) return e;
  if (e instanceof MusicFitNotBuilt) return musicFitApiError('notBuilt', { fn: e.fn });
  if (e instanceof OpError) return new ApiError(e.code === 'forbidden_op' ? 403 : e.code === 'not_found' ? 404 : 422, e.code, e.message, e.details, e.hint);
  if (e instanceof TemplateError) return templateApiError(e);
  if (e instanceof FilmError) return new ApiError(FILM_STATUS[e.code], e.code === 'invalid_args' ? 'invalid_request' : e.code, e.message, {}, e.hint);
  return e;
}
export const guard = async <R>(fn: () => Promise<R> | R): Promise<R> => { try { return await fn(); } catch (e) { throw asApiError(e); } };
const nothingToDo = () => new ApiError(409, 'nothing_to_do', 'the music stays as it is and was not asked to fit the length, so there is nothing to do', {}, 'Ask for the length to fit (tailor: true), or choose other music.');

// ---------- small exact helpers ----------
const ft = (doc: ProjectDocument, f: number) => T.frameTime(f, doc.settings.frameRate);
const nf = (doc: ProjectDocument, t: RT) => T.nearestFrameIndex(t, doc.settings.frameRate);
const own = <V>(rec: Readonly<Record<string, V>> | undefined, key: string): V | undefined => (rec && Object.hasOwn(rec, key) ? rec[key] : undefined);
const secs = (t: RT) => Math.round(T.toSeconds(t) * 1000) / 1000;
let draftN = 0;
const draft = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `mfd${(draftN++).toString(36)}_`, actor: 'musicfit-plan', allowInternal: true });
const seqOfClip = (doc: ProjectDocument, clipId: string) => findClip(doc, clipId)?.seq.id ?? doc.mainSequenceId;
/** The end of the last picture, title or caption clip of a sequence (what fit_music ends at by default). */
export function pictureEnd(doc: ProjectDocument, sequenceId: string): RT {
  const seq = own(doc.sequences, sequenceId);
  return (seq?.tracks ?? []).filter((t) => t.kind !== 'audio').flatMap((t) => t.clips).reduce((m, c) => T.max(m, clipEnd(c)), T.ZERO);
}
/** Cut frames of a sequence: the start frames of picture clips on every picture track, merged, ascending; with the clip ids at each. */
export function cutsOf(doc: ProjectDocument, sequenceId: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const t of own(doc.sequences, sequenceId)?.tracks ?? []) {
    if (t.kind !== 'video') continue;
    for (const c of t.clips) { const f = nf(doc, c.start); out.set(f, [...(out.get(f) ?? []), c.id]); }
  }
  return new Map([...out.entries()].sort((a, b) => a[0] - b[0]));
}
/**
 * The flash rule on the document as the plan leaves it (C10): a cut is MADE by the plan when a picture clip that was not in the
 * document before starts there. flash_gap blocks when a made cut comes closer than flashGapFrames to any other cut; two kept cuts
 * that close only warn (kept_cuts_close).
 */
export function flashRule(before: ProjectDocument, after: ProjectDocument, sequenceId: string): { blocking: MusicFitNote[]; warnings: MusicFitNote[] } {
  const rate = after.settings.frameRate, gap = flashGapFrames(rate.num / rate.den);
  const had = new Set(Object.values(before.sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips.map((c) => c.id))));
  const cuts = [...cutsOf(after, sequenceId).entries()];
  const made = new Set(cuts.filter(([, ids]) => ids.some((id) => !had.has(id))).map(([f]) => f));
  const close: { a: number; b: number; madeByPlan: boolean }[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1]![0], b = cuts[i]![0];
    if (b - a < gap) close.push({ a, b, madeByPlan: made.has(a) || made.has(b) });
  }
  const bad = close.filter((x) => x.madeByPlan), kept = close.filter((x) => !x.madeByPlan);
  return {
    blocking: bad.length ? [{ code: 'flash_gap', message: `${bad.length} cut(s) this plan makes would come less than ${gap} frames from another cut (the flash rule allows at most three cuts a second)`, details: { gapFrames: gap, pairs: bad.map(({ a, b }) => [a, b]) } }] : [],
    warnings: kept.length ? [{ code: 'kept_cuts_close', message: `${kept.length} pair(s) of cuts you kept by hand are less than ${gap} frames apart; the plan does not change them`, details: { gapFrames: gap, pairs: kept.map(({ a, b }) => [a, b]) } }] : [],
  };
}
/** A built-in track as makeMusic will store it, without its bytes (a stand-in for planning; core never reads a file). */
export function builtinStandIn(styleId: string, seed: number, bars: number, endFrames?: number): { asset: Omit<Asset, 'id'>; grid: KnownGrid } {
  const style = findMusicStyle(styleId)!;
  const layout = musicLayout(styleId, bars, endFrames);
  const at = '1970-01-01T00:00:00.000Z';
  return {
    asset: {
      kind: 'audio', name: `${style.name.en} · ${layout.bars} bars.wav`, contentHash: `sha256:${sha256Hex(`musicfit plan stand-in\n${styleId}\n${bars}\n${layout.endFrames}\n${seed}`)}`,
      byteSize: 44 + 4 * layout.totalFrames, container: 'wav', mimeType: 'audio/wav', duration: layout.duration, audio: { sampleRate: MUSIC_SAMPLE_RATE, channels: 2, codec: 'pcm_s16le' },
      provenance: { origin: 'generated', importedAt: at, importedBy: 'musicfit-plan', procedural: { id: style.id, version: style.version, generator: MUSIC_GENERATOR, params: musicProvenanceParams(layout, seed) } },
    } as Omit<Asset, 'id'>,
    grid: knownGridOf(layout, seed, at),
  };
}
/**
 * A stand-in record (no bytes) for a procedural medium a template plan needs, so the plan can show the document as the template would
 * leave it: built-in music with its layout and grid; a sound effect as one second of sound; an element as a still picture. Apply makes
 * the real media and checks the flash rule again on them.
 */
export function procStandIn(n: TemplatePlan['assetsNeeded'][number]): { asset: Omit<Asset, 'id'>; analysis?: KnownGrid } {
  if (n.kind === 'music') { const s = builtinStandIn(n.id, n.seed, n.bars, n.endFrames); return { asset: s.asset, analysis: s.grid }; }
  const hash = `sha256:${sha256Hex(`musicfit plan stand-in\n${JSON.stringify(n)}`)}`;
  const base = { name: `${n.id}`, contentHash: hash, byteSize: 1, provenance: { origin: 'generated', importedAt: '1970-01-01T00:00:00.000Z', importedBy: 'musicfit-plan' } };
  return n.kind === 'sfx'
    ? { asset: { ...base, kind: 'audio', container: 'wav', mimeType: 'audio/wav', duration: T.rt(1, 1), audio: { sampleRate: MUSIC_SAMPLE_RATE, channels: 2, codec: 'pcm_s16le' } } as Omit<Asset, 'id'> }
    : { asset: { ...base, kind: 'image', container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 64, height: 64, codec: 'png', hasAlpha: true } } as Omit<Asset, 'id'> };
}
/** The exact layout of a built-in track of exactly `length`; refusals too_short (with the shortest length) and too_long. */
export function exactBuiltin(styleId: string, length: RT): { bars: number; endFrames: number } {
  const style = findMusicStyle(styleId);
  if (!style) throw new ApiError(404, 'not_found', `there is no built-in music style "${styleId}"`, { styleId }, 'GET /api/v1/music (or list_catalog → music) lists the styles.');
  const frames = sampleFramesFor(length);
  if (frames > MUSIC_MAX_SECONDS * MUSIC_SAMPLE_RATE) throw musicFitApiError('tooLongBuiltin', { seconds: secs(length) });
  try { return exactLayoutFor(styleId, Math.max(1, frames)); } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    const minSeconds = ((style.minBars - 1) * 240 + 120) / style.bpm;
    throw musicFitApiError('tooShort', { seconds: secs(length), minSeconds }, (Math.ceil(minSeconds * 10) / 10).toFixed(1));
  }
}

// ---------- the choice of music ----------
type Choice = { kind: 'builtin'; styleId: string; seed: number; fromAssetId: string | null } | { kind: 'file'; assetId: string };
function choiceOf(doc: ProjectDocument, music: MusicFitPlanRequest['music'], current: string | null): { choice: Choice; changes: boolean } {
  const builtinOf = (assetId: string): Choice | null => {
    const a = own(doc.assets, assetId);
    if (!a || !isBuiltinMusic(a)) return null;
    const seed = Number((a.provenance.procedural?.params as Record<string, unknown> | undefined)?.seed ?? 1);
    return { kind: 'builtin', styleId: a.provenance.procedural!.id, seed: Number.isInteger(seed) ? seed : 1, fromAssetId: assetId };
  };
  if ('builtin' in music) {
    if (!findMusicStyle(music.builtin.styleId)) throw new ApiError(404, 'not_found', `there is no built-in music style "${music.builtin.styleId}"`, { styleId: music.builtin.styleId }, 'GET /api/v1/music (or list_catalog → music) lists the styles.');
    return { choice: { kind: 'builtin', styleId: music.builtin.styleId, seed: music.builtin.seed ?? 1, fromAssetId: null }, changes: true };
  }
  const assetId = 'keep' in music ? current : music.assetId;
  if (!assetId) throw new ApiError(409, 'nothing_to_do', 'there is no music to keep here', {}, 'Choose a sound file of the library or built-in music.');
  const a = own(doc.assets, assetId);
  if (!a) throw new ApiError(404, 'not_found', `asset ${assetId} not found`, { assetId }, 'Call get_summary to list assets.');
  // wave 7 instruments: a track made with recorded instruments is never fitted (nor silently recomposed as synth) in v1
  if (a.provenance.instruments) throw instrumentsError('notFittable', { assetId });
  if (!a.audio || a.video || a.kind === 'image') throw new ApiError(400, 'invalid_request', `asset ${assetId} is not a sound file`, { assetId }, 'Choose a sound-only file as the music.');
  return { choice: builtinOf(assetId) ?? { kind: 'file', assetId }, changes: assetId !== current };
}
/** The checks a song passes before anything is searched or made (the licence first, fail-closed). */
function songChecks(doc: ProjectDocument, assetId: string): SongFitter {
  const problem = fitLicenceProblem(doc, assetId);
  if (problem) throw fitLicenceRefusal(problem, assetId);
  const a = doc.assets[assetId]!;
  if (T.lt(T.rt(MUSICFIT.maxSeconds, 1), a.duration)) throw musicFitApiError('tooLongSong', { assetId, seconds: secs(a.duration) });
  const beats = ownBeats(doc, assetId);
  if (!beats || !beats.downbeats.length) throw musicFitApiError('needsBars', { assetId });
  if (!musicFitDeps.songFitter) throw musicFitApiError('notBuilt', { fn: 'song fit (join search and splice)' });
  return musicFitDeps.songFitter;
}

// ---------- the prepared plan ----------
export type MakeSpec = { kind: 'none'; assetId: string | null } | { kind: 'builtin'; styleId: string; seed: number; bars: number; endFrames?: number } | { kind: 'fitted'; sourceAssetId: string; startAt: RT; removal: JoinRemoval };
/** Commit 2 for the music `assetId` in `doc` (the real document after commit 1, or a draft holding the made file). */
export interface Edit { /** Procedural media of a template plan still to be made (sound effects, elements) and added to the step's assets. */ needed?: TemplatePlan['assetsNeeded']; ops: OpCall[]; allowInternal: boolean; label: string; endFrame: number; after: ProjectDocument; droppedVolumeKeys: number; recut: MusicFitPlan['recut']; flash: ReturnType<typeof flashRule> | null; sequenceId: string }
export interface Prepared {
  plan: MusicFitPlan;
  make: MakeSpec;
  /** The first plan's end frame (on the stand-in, or the length the song is fitted to): apply compares the second with it. */
  firstEndFrame: number;
  edit(doc: ProjectDocument, assetId: string, principal?: Principal, made?: { key: string; asset: Omit<Asset, 'id'>; analysis?: KnownGrid }): Promise<Edit>;
}

/** Volume keys inside a clip's length. */
const keysInside = (c: MediaClip) => (c.volume ?? []).filter((k) => T.lt(k.time, c.duration)).length;

function impactsOf(before: ProjectDocument, after: ProjectDocument, sequenceId: string): MusicFitPlan['impacts'] {
  const ids = (own(after.sequences, sequenceId)?.tracks ?? []).flatMap((t) => t.clips).filter((c) => c.type === 'media' && c.impact).map((c) => c.id);
  const off = (doc: ProjectDocument, id: string): number | null => {
    if (!findClip(doc, id)) return null;
    const r = musicFitDeps.planImpact(doc, id, undefined, 'beat');
    if ('refusal' in r) return r.refusal === 'alreadyOnBeat' ? 0 : null;
    return r.offsetBefore.frames;
  };
  return ids.map((clipId) => ({ clipId, framesFromBeatBefore: off(before, clipId), framesFromBeatAfter: off(after, clipId) }));
}
const statsOf = (doc: ProjectDocument, sequenceId: string): CutStats => { const r = doc.settings.frameRate; return musicFitDeps.cutStats([...cutsOf(doc, sequenceId).keys()], r.num / r.den); };

/** The ending in words: exact, early (the file ends before the target) or cut (faded at the target), with the seconds between. */
function endingOf(fileSeconds: number, wantedSeconds: number, exact: boolean): MusicFitPlan['ending'] {
  if (exact) return { kind: 'exact', seconds: 0 };
  const d = Math.round((fileSeconds - wantedSeconds) * 1000) / 1000;
  return d < 0 ? { kind: 'early', seconds: -d } : d > 0 ? { kind: 'cut', seconds: d } : { kind: 'exact', seconds: 0 };
}

/** Make the plan (read-only). Throws ApiError. */
export async function prepareMusicFit(store: Store, projectId: string, doc: ProjectDocument, revision: number, req: MusicFitPlanRequest, signal?: AbortSignal): Promise<Prepared> {
  return guard(async () => {
    if ('clipId' in req.target) return prepareClip(store, projectId, doc, revision, req, req.target.clipId, null, signal);
    const run = own(doc.recipeRuns, req.target.runId);
    if (!run) throw new ApiError(404, 'not_found', `run ${req.target.runId} not found`, { runId: req.target.runId }, 'A film or template run id is returned by apply (runId).');
    if (run.recipeId === FAMILY_FILM_RUN_RECIPE_ID) {
      if (req.recut === false) return prepareClip(store, projectId, doc, revision, req, runMusicClip(doc, run), pictureEnd(doc, seqOfClip(doc, runMusicClip(doc, run))), signal, run.id);
      return prepareFilm(store, projectId, doc, revision, req, run, signal);
    }
    if (run.recipeId.startsWith('template:')) {
      if (req.recut === false) return prepareClip(store, projectId, doc, revision, req, runMusicClip(doc, run), pictureEnd(doc, seqOfClip(doc, runMusicClip(doc, run))), signal, run.id);
      return prepareTemplate(store, projectId, doc, revision, req, run, signal);
    }
    throw new ApiError(400, 'invalid_request', `run ${run.id} is not a family film or a template`, { runId: run.id, recipeId: run.recipeId }, 'A montage\'s music is changed on its music clip ({clipId}).');
  });
}
function runMusicClip(doc: ProjectDocument, run: RecipeRun): string {
  const slot = (run.slots ?? []).find((s) => s.kind === 'music' && !!findClip(doc, s.clipId));
  if (!slot) throw new ApiError(409, 'nothing_to_do', `run ${run.id} has no music clip in the project`, { runId: run.id }, 'Make the film or template again with music (recut), or add music.');
  return slot.clipId;
}

// ---------- a free music clip ----------
async function prepareClip(store: Store, projectId: string, doc: ProjectDocument, revision: number, req: MusicFitPlanRequest, clipId: string, end: RT | null, signal: AbortSignal | undefined, runId: string | null = null): Promise<Prepared> {
  const f = findClip(doc, clipId);
  if (!f) throw new ApiError(404, 'not_found', `clip ${clipId} not found`, { clipId }, 'Call get_timeline to list clips.');
  if (f.clip.type !== 'media' || f.track.kind !== 'audio') throw new ApiError(400, 'invalid_request', 'music that fits the film is a sound clip on a sound track', { clipId });
  const clip = f.clip;
  if (!followable(clip)) throw musicFitRefusal('notFollowable', { clipId });
  const seqId = f.seq.id;
  const { choice, changes } = choiceOf(doc, req.music, clip.assetId);
  const target = req.tailor ? end ?? pictureEnd(doc, seqId) : clipEnd(clip);
  if (!T.lt(clip.start, target)) throw new ApiError(422, 'out_of_bounds', 'there is no picture, title or caption after the start of this music to fit it to', { clipStart: clip.start, target }, 'Move the music earlier, or add pictures after it.');
  const wantedSeconds = T.toSeconds(T.sub(target, clip.start));
  const warnings: MusicFitNote[] = [], basis: string[] = [];
  let make: MakeSpec, firstEndFrame = nf(doc, target), draftAsset: { asset: Omit<Asset, 'id'>; grid: KnownGrid } | null = null, ending: MusicFitPlan['ending'], planMake: MusicFitPlan['make'];
  if (!req.tailor && !changes) throw nothingToDo();
  if (choice.kind === 'builtin' && (req.tailor || changes)) {
    // built-in music is composed again from its start: a clip of a built-in file must start at the file's start (C13)
    if (!changes && !T.isZero(clip.sourceIn)) throw musicFitApiError('notFromStart', { clipId, sourceIn: clip.sourceIn });
    const style = findMusicStyle(choice.styleId)!;
    const lay = req.tailor ? exactBuiltin(choice.styleId, T.sub(target, clip.start)) : { bars: barsForDuration(choice.styleId, T.sub(target, clip.start)) };
    const endFrames = 'endFrames' in lay ? lay.endFrames : undefined;
    make = { kind: 'builtin', styleId: choice.styleId, seed: choice.seed, bars: lay.bars, ...(endFrames !== undefined ? { endFrames } : {}) };
    draftAsset = builtinStandIn(choice.styleId, choice.seed, lay.bars, endFrames);
    planMake = { kind: 'builtin', styleId: choice.styleId, seed: choice.seed, bars: lay.bars, endFrames: draftAsset.grid.params.end !== undefined ? Number(draftAsset.grid.params.end) : (MUSIC_SAMPLE_RATE * 240) / style.bpm };
    const fileSeconds = T.toSeconds(draftAsset.asset.duration);
    ending = endingOf(fileSeconds, wantedSeconds, !!req.tailor);
    if (req.tailor) warnings.push({ code: 'composed_again', message: MUSICFIT_COMPOSED_AGAIN.en, details: { he: MUSICFIT_COMPOSED_AGAIN.he, styleId: choice.styleId, seed: choice.seed } });
    basis.push(`built-in music "${style.name.en}" (${style.id}): ${style.bpm} beats a minute; its beats and bars are known from its recipe, nothing was measured; ${req.tailor ? `made for exactly ${secs(T.sub(target, clip.start))} s (${lay.bars - 1} whole bars and an ending of ${Math.round(((endFrames ?? (MUSIC_SAMPLE_RATE * 240) / style.bpm) / MUSIC_SAMPLE_RATE) * 100) / 100} s)` : `${lay.bars} whole bars`}`);
  } else if (choice.kind === 'file' && req.tailor) {
    const fitter = songChecks(doc, choice.assetId);
    const startAt = changes ? musicStartOf(doc, choice.assetId) : clip.sourceIn;
    const found = await fitter.candidates({ store, projectId, doc, assetId: choice.assetId, startAt, wantedSeconds, ...(signal ? { signal } : {}) });
    const r = chooseCandidate(found.candidates, req.removal, choice.assetId);
    make = { kind: 'fitted', sourceAssetId: choice.assetId, startAt, removal: r.candidates[r.chosen]!.removal };
    planMake = { kind: 'fitted', sourceAssetId: choice.assetId, candidates: r.candidates, chosen: r.chosen };
    const c = r.candidates[r.chosen]!;
    ending = endingOf(c.madeSeconds, wantedSeconds, false);
    // the clip ends where the made file ends when that comes before the target (ending early): the same rule planMusicSwap applies
    // on the made file in apply's second plan (its end floored to a frame from the clip's start), else apply refuses fit_unstable
    if (found.usableEnd) firstEndFrame = Math.min(firstEndFrame, T.frameIndexAt(T.add(clip.start, madeLength(startAt, c.removal, found.usableEnd)), doc.settings.frameRate));
    warnings.push(...joinNotes(c), ...fitSourceNotes(doc, choice.assetId)); // wave 8 sources (C4): licence findings of a fetched song are warnings
    basis.push(...found.basis, ...joinBasis(c));
  } else {
    // the file as it is: its own end, or cut at the clip's end with a fade
    const assetId = choice.kind === 'file' ? choice.assetId : choice.fromAssetId!;
    make = { kind: 'none', assetId };
    planMake = { kind: 'none' };
    const a = doc.assets[assetId]!;
    ending = endingOf(T.toSeconds(T.sub(a.duration, musicStartOf(doc, assetId))), wantedSeconds, false);
  }
  const edit: Prepared['edit'] = async (d, assetId) => {
    const sourceIn = make.kind === 'none' ? (changes ? undefined : findClip(d, clipId)?.clip.type === 'media' ? (findClip(d, clipId)!.clip as MediaClip).sourceIn : undefined) : T.ZERO;
    const swap = planMusicSwap(d, clipId, assetId, { ...(sourceIn ? { sourceIn } : {}), to: target });
    const after = applyTransaction(d, swap.steps, { idSeed: 'mfe_', actor: 'musicfit-plan' }).doc;
    return { ops: swap.steps, allowInternal: false, label: `Music: ${req.tailor ? 'fit to the length' : 'other music'}`, endFrame: nf(d, swap.end), after, droppedVolumeKeys: swap.droppedVolumeKeys, recut: null, flash: null, sequenceId: seqId };
  };
  // the edit as it would be: on a draft holding the stand-in of a built-in track, or the chosen file itself
  let shown: Edit | null = null;
  if (draftAsset) { const dr = draft(doc, [{ op: 'add_builtin_music', args: draftAsset }]); shown = await edit(dr.doc, String(dr.results[0]!.output!.assetId)); firstEndFrame = shown.endFrame; }
  else if (make.kind === 'none' && make.assetId) { shown = await edit(doc, make.assetId); firstEndFrame = shown.endFrame; }
  else basis.push('the edit is worked out again on the made file before anything is committed; the cuts of the pictures do not change');
  if (shown && shown.droppedVolumeKeys) warnings.push({ code: 'music_keys_dropped', message: `${shown.droppedVolumeKeys} volume key(s) of the music clip lie after its new end and no longer apply`, details: { count: shown.droppedVolumeKeys } });
  const impacts = shown ? impactsOf(doc, shown.after, seqId) : [];
  if (impacts.some((x) => x.framesFromBeatAfter !== 0)) warnings.push(impactNote(impacts));
  const plan: MusicFitPlan = { revision, target: { kind: runId ? (doc.recipeRuns[runId]!.recipeId === FAMILY_FILM_RUN_RECIPE_ID ? 'film' : 'template') : 'clip', clipId, runId }, make: planMake, wantedSeconds: Math.round(wantedSeconds * 1000) / 1000, ending, recut: null, impacts, warnings, blocking: [], basis };
  return { plan, make, firstEndFrame, edit };
}
/** The exact length of a made file (splice.ts: e − s − (t − f), every time taken to its nearest 48 kHz frame). */
function madeLength(startAt: RT, removal: JoinRemoval, usableEnd: RT): RT {
  const fr = (t: RT) => T.nearestSampleIndex(t, MUSIC_SAMPLE_RATE);
  return T.rt(fr(usableEnd) - fr(startAt) - (fr(removal.to) - fr(removal.from)), MUSIC_SAMPLE_RATE);
}
function impactNote(impacts: MusicFitPlan['impacts']): MusicFitNote {
  const off = impacts.filter((x) => x.framesFromBeatAfter !== 0);
  return { code: 'impacts_off_beat', message: `${off.length} marked moment(s) will not be on a beat's frame after this change; «ליישר שוב» brings them back`, details: { clipIds: off.map((x) => x.clipId) } };
}
function chooseCandidate(candidates: JoinCandidate[], removal: JoinRemoval | undefined, assetId: string): { candidates: JoinCandidate[]; chosen: number } {
  if (!candidates.length) throw musicFitApiError('noJoin', { assetId });
  if (!removal) return { candidates, chosen: 0 };
  const i = candidates.findIndex((c) => T.eq(c.removal.from, removal.from) && T.eq(c.removal.to, removal.to));
  if (i < 0) throw musicFitApiError('fitStale', { assetId, removal });
  return { candidates, chosen: i };
}
function joinNotes(c: JoinCandidate): MusicFitNote[] {
  const out: MusicFitNote[] = [];
  if (c.measured.similarity < MUSICFIT.joinWarnSimilarity) out.push({ code: 'join_weak', message: `no similar place to join was found (similarity ${c.measured.similarity.toFixed(3)}, below ${MUSICFIT.joinWarnSimilarity}, a guess until the owner has heard joins); listen to the join, or end the music with a fade`, details: { similarity: c.measured.similarity } });
  if (c.measured.tempoSpreadMs > MUSICFIT.tempoSpreadWarnMs) out.push({ code: 'tempo_unsteady', message: `the measured beats of the song vary by ${c.measured.tempoSpreadMs.toFixed(1)} ms, so cuts after the join may not lie on its beats`, details: { tempoSpreadMs: c.measured.tempoSpreadMs } });
  return out;
}
const joinBasis = (c: JoinCandidate) => { const s = joinMeasuredSentence(c.measured); return [s.en, s.he, 'the join is chosen by a heuristic and nobody has heard it yet («חיבור אוטומטי — עוד לא הושמע»)']; };

// ---------- a family film ----------
interface FilmRegen { plan: FamilyFilmPlan; op: OpCall; released: { clipId: string; gain: number; keys: number } | null; protectedIds: string[]; movedKeys: string[] }
/** The film's regeneration with music `assetId` (core planFamilyFilm via filmRegeneration); an explicit change releases a hand-touched music clip. */
function filmRegen(doc: ProjectDocument, run: RecipeRun, assetId: string, steady: boolean, release: boolean, principal?: Principal): FilmRegen {
  const params: Record<string, unknown> = { ...filmRunParams(run.params), musicAssetId: assetId };
  const g = filmRegeneration(doc, run, params);
  let { removable, protectedIds, keepSlots, keepIds, without, ctx } = g;
  let released: FilmRegen['released'] = null;
  const musicSlot = (run.slots ?? []).find((s) => s.kind === 'music');
  if (release && musicSlot && protectedIds.includes(musicSlot.clipId)) {
    const c = findClip(doc, musicSlot.clipId)!.clip as MediaClip;
    released = { clipId: c.id, gain: c.gain, keys: (c.volume ?? []).length };
    removable = [...removable, c.id];
    protectedIds = protectedIds.filter((id) => id !== c.id);
    keepSlots = keepSlots.filter((s) => s.clipId !== c.id);
    keepIds = keepIds.filter((id) => id !== c.id);
    without = withoutClips(doc, removable);
    ctx = { ...ctx, kept: (ctx.kept ?? []).filter((k) => k.clipId !== c.id), keptKeys: (ctx.keptKeys ?? []).filter((k) => k !== musicSlot.key) };
  }
  if (steady) ctx = { ...ctx, musicGridSteady: true };
  const plan = planFamilyFilm(without, params, ctx);
  if (principal) refuseAgesInPlan(principal, plan.ops);
  const clash = plan.slots.find((s) => keepSlots.some((k) => k.key === s.key));
  if (clash) throw FILM_API_ERRORS.keyClash(clash.key);
  if (plan.blocking.length) throw FILM_API_ERRORS.blocked(plan.blocking[0]!.message, plan.blocking);
  // the gain set by hand on the released music clip is carried to the new one (its volume keys are not: counted)
  const ops = released && released.gain !== 1 && plan.ops.some((o) => o.bind === FILM_BINDS.music) ? [...plan.ops, { op: 'set_clip_gain', args: { clipId: { $ref: FILM_BINDS.music }, gain: released.gain } }] : plan.ops;
  const op = { op: 'apply_template', args: { runId: run.id, templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: FAMILY_FILM_VERSION, params: filmRunRecordParams(plan, g.removedPicks), steps: plan.steps, removeClipIds: removable, keepIds, keepSlots, ops, slots: plan.slots, recordRanges: true } };
  return { plan, op, released, protectedIds, movedKeys: g.movedKeys };
}
const filmMusicStart = (plan: FamilyFilmPlan, doc: ProjectDocument): RT => {
  const step = plan.ops.find((o) => o.bind === FILM_BINDS.music && o.op === 'add_clip');
  const start = (step?.args as { start?: RT } | undefined)?.start;
  return start ?? ft(doc, plan.predicted.startFrame);
};
const thinnedOf = (warnings: readonly { code: string; details: Record<string, unknown> }[]) => {
  const w = warnings.find((x) => x.code === 'cuts_merged');
  const list = w ? (w.details.assetIds ?? w.details.slots) : null;
  return Array.isArray(list) ? list.length : 0;
};

async function prepareFilm(store: Store, projectId: string, doc: ProjectDocument, revision: number, req: MusicFitPlanRequest, run: RecipeRun, signal: AbortSignal | undefined): Promise<Prepared> {
  const current = typeof run.params.musicAssetId === 'string' ? run.params.musicAssetId : null;
  const { choice, changes } = choiceOf(doc, req.music, current);
  const seqId = doc.mainSequenceId;
  const warnings: MusicFitNote[] = [], basis: string[] = [];
  let make: MakeSpec, planMake: MusicFitPlan['make'], first: { doc: ProjectDocument; assetId: string } | null = null, wanted: RT, ending: MusicFitPlan['ending'];
  const steady = choice.kind === 'builtin';
  if (choice.kind === 'builtin') {
    // the film on the style's steady grid (its end does not depend on the track), then the track made for exactly that end
    const style = findMusicStyle(choice.styleId)!;
    const probe = builtinStandIn(choice.styleId, choice.seed, Math.max(style.minBars, 8));
    const d0 = draft(doc, [{ op: 'add_builtin_music', args: probe }]);
    const p0 = filmRegen(d0.doc, run, String(d0.results[0]!.output!.assetId), true, changes);
    const start = filmMusicStart(p0.plan, doc);
    wanted = T.sub(ft(doc, p0.plan.predicted.endFrame), start);
    const lay = req.tailor ? exactBuiltin(choice.styleId, wanted) : { bars: barsForDuration(choice.styleId, wanted) };
    const endFrames = 'endFrames' in lay ? lay.endFrames : undefined;
    make = { kind: 'builtin', styleId: choice.styleId, seed: choice.seed, bars: lay.bars, ...(endFrames !== undefined ? { endFrames } : {}) };
    const s1 = builtinStandIn(choice.styleId, choice.seed, lay.bars, endFrames);
    const d1 = draft(doc, [{ op: 'add_builtin_music', args: s1 }]);
    first = { doc: d1.doc, assetId: String(d1.results[0]!.output!.assetId) };
    planMake = { kind: 'builtin', styleId: choice.styleId, seed: choice.seed, bars: lay.bars, endFrames: s1.grid.params.end !== undefined ? Number(s1.grid.params.end) : (MUSIC_SAMPLE_RATE * 240) / style.bpm };
    ending = endingOf(T.toSeconds(s1.asset.duration), T.toSeconds(wanted), !!req.tailor);
    if (req.tailor) warnings.push({ code: 'composed_again', message: MUSICFIT_COMPOSED_AGAIN.en, details: { he: MUSICFIT_COMPOSED_AGAIN.he, styleId: choice.styleId, seed: choice.seed } });
    basis.push(`built-in music "${style.name.en}" (${style.id}): the film is cut on its steady grid of ${style.bpm} beats a minute, known from its recipe (nothing was measured); the track is made for the film's ${secs(wanted)} s`);
  } else if (req.tailor) {
    const fitter = songChecks(doc, choice.assetId);
    const p0 = filmRegen(doc, run, choice.assetId, false, changes);
    const start = filmMusicStart(p0.plan, doc);
    wanted = T.sub(ft(doc, p0.plan.predicted.endFrame), start);
    const startAt = placedMusicGrid(doc, choice.assetId, start, 'first-downbeat', false).sourceIn;
    const found = await fitter.candidates({ store, projectId, doc, assetId: choice.assetId, startAt, wantedSeconds: T.toSeconds(wanted), ...(signal ? { signal } : {}) });
    const r = chooseCandidate(found.candidates, req.removal, choice.assetId);
    const c = r.candidates[r.chosen]!;
    make = { kind: 'fitted', sourceAssetId: choice.assetId, startAt, removal: c.removal };
    planMake = { kind: 'fitted', sourceAssetId: choice.assetId, candidates: r.candidates, chosen: r.chosen };
    ending = endingOf(c.madeSeconds, T.toSeconds(wanted), false);
    warnings.push(...joinNotes(c), ...fitSourceNotes(doc, choice.assetId)); // wave 8 sources (C4): licence findings of a fetched song are warnings
    basis.push(...found.basis, ...joinBasis(c), 'the cuts shown are planned on the whole song; they are planned again on the shortened file before anything is committed');
    first = { doc, assetId: choice.assetId };
  } else {
    if (!changes && !req.recut) throw nothingToDo();
    make = { kind: 'none', assetId: choice.assetId };
    planMake = { kind: 'none' };
    first = { doc, assetId: choice.assetId };
    wanted = T.ZERO;
    ending = { kind: 'exact', seconds: 0 };
  }
  const edit: Prepared['edit'] = async (d, assetId, principal) => {
    const r = filmRegen(d, run, assetId, steady, changes || choice.kind === 'builtin', principal);
    const after = applyTransaction(d, [r.op], { idSeed: 'mfe_', actor: 'musicfit-plan', allowInternal: true }).doc;
    const keptPictures = r.protectedIds.filter((id) => findClip(d, id)?.track.kind === 'video');
    const offGrid = keptPictures.filter((id) => { const c = findClip(after, id)?.clip; return !!c && (r.plan.predicted.offGridCuts.includes(nf(d, c.start)) || r.plan.predicted.offGridCuts.includes(nf(d, clipEnd(c)))); });
    return {
      ops: [r.op], allowInternal: true, label: `Family film: ${req.tailor ? 'music fitted to the length' : 'other music'}`.slice(0, 120), endFrame: r.plan.predicted.endFrame, after, droppedVolumeKeys: r.released?.keys ?? 0,
      recut: { before: statsOf(doc, seqId), after: statsOf(after, seqId), thinned: thinnedOf(r.plan.warnings), kept: r.protectedIds, movedBack: r.movedKeys, offGrid, blocked: [] },
      flash: flashRule(d, after, seqId), sequenceId: seqId,
    };
  };
  const shown = await edit(first.doc, first.assetId);
  if (make.kind === 'none') {
    // the file as it is: the film planner ends it on a beat (fit_music); said as the file's length against the film's
    const a = doc.assets[first.assetId]!;
    wanted = T.sub(ft(doc, shown.endFrame), filmMusicStartOfEdit(shown, doc));
    ending = endingOf(T.toSeconds(T.sub(a.duration, musicStartOf(doc, first.assetId))), T.toSeconds(wanted), false);
  }
  return finishRun(doc, revision, req, run, make, planMake, wanted, ending, shown, warnings, basis, seqId, edit);
}
const filmMusicStartOfEdit = (e: Edit, doc: ProjectDocument): RT => {
  const ops = ((e.ops[0]?.args as { ops?: { op: string; bind?: string; args: unknown }[] } | undefined)?.ops) ?? [];
  const step = ops.find((o) => o.bind === FILM_BINDS.music && o.op === 'add_clip');
  return (step?.args as { start?: RT } | undefined)?.start ?? ft(doc, 0);
};
function finishRun(doc: ProjectDocument, revision: number, req: MusicFitPlanRequest, run: RecipeRun, make: MakeSpec, planMake: MusicFitPlan['make'], wanted: RT, ending: MusicFitPlan['ending'], shown: Edit, warnings: MusicFitNote[], basis: string[], seqId: string, edit: Prepared['edit'], blocking: MusicFitNote[] = []): Prepared {
  const flash = shown.flash ?? { blocking: [], warnings: [] };
  warnings.push(...flash.warnings);
  if (shown.droppedVolumeKeys) warnings.push({ code: 'music_keys_dropped', message: `the music clip you changed by hand is replaced: its level (gain) is carried to the new music, its ${shown.droppedVolumeKeys} volume key(s) are not`, details: { count: shown.droppedVolumeKeys } });
  if (shown.recut && shown.recut.after.maxInOneSecond > shown.recut.before.maxInOneSecond) warnings.push({ code: 'cuts_faster', message: `the busiest second has ${shown.recut.after.maxInOneSecond} cuts instead of ${shown.recut.before.maxInOneSecond}; the export's light check still reads the rendered frames`, details: { before: shown.recut.before.maxInOneSecond, after: shown.recut.after.maxInOneSecond } });
  if (shown.recut?.offGrid.length) basis.push(`${shown.recut.offGrid.length} picture(s) you kept by hand stay where they are and are not on the new music's grid`);
  const impacts = impactsOf(doc, shown.after, seqId);
  if (impacts.some((x) => x.framesFromBeatAfter !== 0)) warnings.push(impactNote(impacts));
  const plan: MusicFitPlan = {
    revision, target: { kind: run.recipeId === FAMILY_FILM_RUN_RECIPE_ID ? 'film' : 'template', clipId: null, runId: run.id }, make: planMake,
    wantedSeconds: secs(wanted), ending, recut: shown.recut, impacts, warnings, blocking: [...blocking, ...flash.blocking], basis,
  };
  return { plan, make, firstEndFrame: shown.endFrame, edit };
}

// ---------- a template run ----------
async function prepareTemplate(store: Store, projectId: string, doc: ProjectDocument, revision: number, req: MusicFitPlanRequest, run: RecipeRun, signal: AbortSignal | undefined): Promise<Prepared> {
  const def = templateOfRun(run);
  const elementsAvailable = await templateElements(def);
  const runBuiltin = run.params.builtinMusic as { styleId?: string; seed?: number } | null | undefined;
  const current = typeof run.params.musicAssetId === 'string' ? run.params.musicAssetId : null;
  const keepBuiltin = 'keep' in req.music && !current && runBuiltin?.styleId;
  const music: MusicFitPlanRequest['music'] = keepBuiltin ? { builtin: { styleId: runBuiltin!.styleId!, seed: runBuiltin!.seed ?? 1 } } : req.music;
  const { choice, changes } = choiceOf(doc, music, current);
  const seqId = doc.mainSequenceId;
  const warnings: MusicFitNote[] = [], basis: string[] = [];
  const regen = (d: ProjectDocument, p: Record<string, unknown>) => templateRegeneration(d, run, def, p, {}, elementsAvailable);
  let make: MakeSpec, planMake: MusicFitPlan['make'], params: (assetId: string) => Record<string, unknown>, firstDoc = doc, firstAsset = '', wanted = T.ZERO, ending: MusicFitPlan['ending'] = { kind: 'exact', seconds: 0 };
  const blocked = (e: unknown): MusicFitNote | null => (e instanceof ApiError && e.code === 'template_blocked' ? { code: 'template_blocked', message: e.message, details: { ...e.details, he: 'התבנית אינה יכולה לחול כך: קטעים שנערכו ביד לא נחתכים מחדש. בטלו את העריכה ביד או מחקו את הקליפ ונסו שוב', hint: e.hint } } : null);
  if (choice.kind === 'builtin') {
    const builtinMusic = { styleId: choice.styleId, seed: choice.seed, ...(req.tailor ? { ending: 'exact' as const } : {}) };
    params = () => ({ builtinMusic, musicAssetId: null });
    make = { kind: 'none', assetId: null };
    planMake = { kind: 'none' };
    if (req.tailor) warnings.push({ code: 'composed_again', message: MUSICFIT_COMPOSED_AGAIN.en, details: { he: MUSICFIT_COMPOSED_AGAIN.he, styleId: choice.styleId, seed: choice.seed } });
  } else if (req.tailor) {
    const fitter = songChecks(doc, choice.assetId);
    let p0: TemplatePlan;
    try { p0 = regen(doc, { musicAssetId: choice.assetId, builtinMusic: null }).plan; } catch (e) { const b = blocked(e); if (!b) throw e; return blockedTemplate(doc, revision, req, run, b); }
    const start = ft(doc, p0.predicted.startFrame);
    wanted = T.sub(ft(doc, p0.predicted.endFrame), start);
    const startAt = placedMusicGrid(doc, choice.assetId, start, def.music.startAt, false).sourceIn;
    const found = await fitter.candidates({ store, projectId, doc, assetId: choice.assetId, startAt, wantedSeconds: T.toSeconds(wanted), ...(signal ? { signal } : {}) });
    const r = chooseCandidate(found.candidates, req.removal, choice.assetId);
    const c = r.candidates[r.chosen]!;
    make = { kind: 'fitted', sourceAssetId: choice.assetId, startAt, removal: c.removal };
    planMake = { kind: 'fitted', sourceAssetId: choice.assetId, candidates: r.candidates, chosen: r.chosen };
    ending = endingOf(c.madeSeconds, T.toSeconds(wanted), false);
    warnings.push(...joinNotes(c), ...fitSourceNotes(doc, choice.assetId)); // wave 8 sources (C4): licence findings of a fetched song are warnings
    basis.push(...found.basis, ...joinBasis(c), 'the cuts shown are planned on the whole song; they are planned again on the shortened file before anything is committed');
    params = (assetId) => ({ musicAssetId: assetId, builtinMusic: null });
    firstAsset = choice.assetId;
  } else {
    if (!changes && !req.recut) throw nothingToDo();
    params = (assetId) => ({ musicAssetId: assetId, builtinMusic: null });
    make = { kind: 'none', assetId: choice.assetId };
    planMake = { kind: 'none' };
    firstAsset = choice.assetId;
  }
  const edit: Prepared['edit'] = async (d, assetId, _principal, made) => {
    const g = regen(d, params(assetId));
    // the built-in track of the plan is the one made in commit 1 (the same bytes: apply_template finds it by its content)
    const needed = g.plan.assetsNeeded.filter((n) => !(made && n.kind === 'music' && n.key === BUILTIN_MUSIC_ASSET_KEY));
    const assets: { key: string; asset: Omit<Asset, 'id'>; analysis?: KnownGrid }[] = made ? [made] : [];
    const op = templateRegenerationOp(run.id, def, g.plan, assets, g.removable, g.protectedIds, g.keepSlots);
    let after = d;
    // the regeneration as it would be: the procedural media are stand-ins here (no bytes); only the cuts and the end are read from it
    const standIns = needed.map((n) => ({ key: n.key, ...procStandIn(n) }));
    after = applyTransaction(d, [{ op: 'apply_template', args: { ...(op.args as Record<string, unknown>), assets: [...assets, ...standIns] } }], { idSeed: 'mfe_', actor: 'musicfit-plan', allowInternal: true }).doc;
    return {
      ops: [op], allowInternal: true, label: `Template: ${req.tailor ? 'music fitted to the length' : 'other music'}`.slice(0, 120), endFrame: g.plan.predicted.endFrame, after, droppedVolumeKeys: 0,
      recut: { before: statsOf(doc, seqId), after: statsOf(after, seqId), thinned: thinnedOf(g.plan.warnings), kept: g.protectedIds, movedBack: (g.plan.notices.find((x) => x.code === 'moved_back')?.details.keys as string[] | undefined) ?? [], offGrid: [], blocked: [] },
      flash: flashRule(d, after, seqId), sequenceId: seqId,
      ...(needed.some((n) => n.kind !== 'music') || (!made && needed.length) ? { needed } : {}),
    };
  };
  let shown: Edit;
  try { shown = await edit(firstDoc, firstAsset); } catch (e) { const b = blocked(e); if (!b) throw e; return blockedTemplate(doc, revision, req, run, b); }
  if (choice.kind === 'builtin') {
    const g = regen(doc, params(''));
    const m = g.plan.assetsNeeded.find((n) => n.kind === 'music');
    if (m && m.kind === 'music') { make = { kind: 'builtin', styleId: m.id, seed: m.seed, bars: m.bars, ...(m.endFrames !== undefined ? { endFrames: m.endFrames } : {}) }; const style = findMusicStyle(m.id)!; planMake = { kind: 'builtin', styleId: m.id, seed: m.seed, bars: m.bars, endFrames: m.endFrames ?? (MUSIC_SAMPLE_RATE * 240) / style.bpm }; }
    wanted = T.sub(ft(doc, g.plan.predicted.endFrame), ft(doc, g.plan.predicted.startFrame));
    const faded = g.plan.notices.find((x) => x.code === 'builtin_music_faded');
    ending = req.tailor ? { kind: 'exact', seconds: 0 } : faded ? { kind: 'cut', seconds: Math.round(((Number(faded.details.trackFrames) - Number(faded.details.clipFrames)) * doc.settings.frameRate.den / doc.settings.frameRate.num) * 1000) / 1000 } : { kind: 'exact', seconds: 0 };
    basis.push(...g.plan.basis.slice(0, 1));
  }
  return finishRun(doc, revision, req, run, make, planMake, wanted, ending, shown, warnings, basis, seqId, edit);
}
/** A template run whose hand-edited slots would have to move (C6: not re-timed in version 1): the plan lists them and nothing can be applied. */
function blockedTemplate(doc: ProjectDocument, revision: number, req: MusicFitPlanRequest, run: RecipeRun, note: MusicFitNote): Prepared {
  const kept = Array.isArray(note.details.kept) ? (note.details.kept as { key: string }[]).map((k) => k.key) : [];
  const stats: CutStats = { cuts: cutsOf(doc, doc.mainSequenceId).size, minGapFrames: null, maxInOneSecond: 0 };
  const plan: MusicFitPlan = {
    revision, target: { kind: 'template', clipId: null, runId: run.id }, make: { kind: 'none' }, wantedSeconds: 0, ending: { kind: 'exact', seconds: 0 },
    recut: { before: stats, after: stats, thinned: 0, kept: [], movedBack: [], offGrid: [], blocked: kept }, impacts: [], warnings: [], blocking: [note],
    basis: ['slots edited by hand are not re-timed in this version: the template keeps them where they are, so the new music cannot be cut around them'],
  };
  void req;
  return { plan, make: { kind: 'none', assetId: null }, firstEndFrame: -1, edit: async () => { throw new ApiError(409, 'template_blocked', note.message, note.details, String(note.details.hint ?? '')); } };
}
