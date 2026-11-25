/**
 * The family film planner (wave 5, ADR-0026): planFamilyFilm and filmPickKey, exactly as declared in familyFilmContract.ts
 * (PlanFamilyFilm, FilmPickKey). Pure and deterministic: no clock, no random source, no I/O; the document is never mutated.
 * Heuristic: a rule-based first cut from measurements (moments, beats, capture times). No model; faces are NOT used (no face
 * model is approved), and the plan's basis says so.
 *
 * How a film is planned (the contract header's rules; the verifier's corrections win over the plan's section 5):
 * 1. Parameters are parsed (FamilyFilmParamsSchema) and resolved with FILM_DEFAULTS. Every asset is checked: a video or a still
 *    with a picture; anything else is left out as no_picture, an asset of a clip kept by hand as kept_by_hand, a video shorter
 *    than the shortest slot as too_short, picks.exclude as excluded_by_you. Nothing left = FilmError nothing_to_do.
 * 2. Order: 'capture' (ctx.capture, compareWall; undated ones after the dated ones in the given order, said in basis and as the
 *    warning no_capture_time), 'given', or 'arc' (calm first, the most active at two thirds, calm last; by the stored window
 *    values, else the file values, else last).
 * 3. Grid: with music the template construction (placedMusicGrid: the music starts at its first bar start, timeline beat =
 *    at + (b − sourceIn), exact); a kept music clip defines the grid as it is placed (refused as kept_music_not_followable when
 *    it plays backwards or at another speed); without music a steady FILM.fallbackBpm grid (steadyGrid). The grid is counted in
 *    UNITS of g beats from the film start: g = m/2 for an even meter m, else m (times 2 or 4 when the music is so fast that fewer
 *    than two spans fit [FILM.minSlotSeconds, FILM.maxSlotSeconds]: "counted on every second beat"). Allowed spans are
 *    {m/2 (even m), m, 2m, 4m} beats, i.e. {1, 2, 4, 8} or {1, 2, 4} units, inside that range. The unit boundaries are read
 *    from the grid's own bar list, so irregular (hand-corrected) bars are followed: every bar start, plus the middle beat of each
 *    bar of an even number of beats for half-bar units, or every q-th bar start for units of q bars; every g-th beat when the music
 *    has no bar starts. Every cut is a unit boundary, snapped ONCE to the nearest frame; lengths are differences of snapped
 *    boundaries (ADR-0003); spans and slot records count the real bars (else beats) between two boundaries. When music kept by
 *    hand was moved so that no boundary lies on the film start, the first clip starts with the film and ends on a boundary; that
 *    start is no cut on the grid and is listed in neither cuts list (said in basis).
 * 4. Spans: the allowed span nearest target/n seconds is the base; class A (both bases or a burst) one step longer, class C
 *    (flat and not active throughout, unmeasured, a still) one step shorter. Fitting happens in units, so tempo drift cannot
 *    move the film's end: too many picks for the target drop C, then B, then A picks, spread evenly over the order (never a
 *    run from the end; picks.include never), then spans shrink C, B, A; too few add second windows (same asset, >= 4 s apart,
 *    next to the first in source order), then grow B, A, C. A clip shorter than its span takes the largest span it can fill;
 *    one shorter than every allowed span is left out as too_short. At most FILM.maxPicks picks.
 * 5. Layout on the grid, around the pictures kept by hand (occupied intervals): a slot that would run into one ends at its start
 *    when at least FILM.minSlotSeconds remain (else the slot before is extended to it, or a gap is left and counted), and the
 *    layout goes on from its end to the next unit boundary at least FILM.minSlotSeconds away. Those cuts are the person's own
 *    and are listed in predicted.offGridCuts, never in predicted.cuts. Slots past the music's last usable beat are dropped
 *    (music_short). A slot shorter than flashGapFrames is merged into the one before (cuts_merged; ADR-0009).
 * 6. The window in the source: start = clamp(peakFrame − round(0.4·Ls), fromFrame, toFrame − Ls) when the clean stretch holds
 *    the slot's Ls source frames, else centred on the stretch (filmReasonsFor then says past_clean_stretch); unmeasured or flat:
 *    the middle of the file. A still gets motion.move.ken-burns-in unless motion is 'none'. sourceIn = sourceTimeOfFrame(start)
 *    (the picture's start offset counted), never past the end of the file. Reasons come from filmReasonsFor only.
 * 7. Ops, in order, every item bound: tracks, add_clip per pick (linked sound to the own-sound track), set_clip_fades on the linked
 *    sound, apply_motion_preset for stills, set_track_audio / set_ducking (only where the mix as it SOUNDS changes: filmMix),
 *    the opening title (add_text with fields: true when it is live, apply_text_preset, set_text_animation unless motion 'none'),
 *    the closing card, the music (add_clip + fit_music to the end of the closing card).
 */
import * as T from '@pulseframe/time';
import { z } from 'zod';
import {
  FAMILY_FILM_DRAFT_LABEL, FAMILY_FILM_FACES_NOTE, FAMILY_FILM_METHOD, FAMILY_FILM_RECIPE_ID, FAMILY_FILM_TEMPLATE_ID, FAMILY_FILM_VERSION, FamilyFilmParamsSchema, FILM, FILM_BINDS, FILM_DEFAULTS, FILM_PICK_KEY, FilmError, filmMix, filmReasonsFor, filmRunPicked, filmRunRemovedPicks,
  type FamilyFilmPlan, type FilmExclusion, type FilmRemovedPick, type FilmMomentsRecord, type FilmPick, type FilmPickKey, type FilmPlanContext, type FilmReason, type FilmText, type FilmWarning, type FilmWarningCode, type PlanFamilyFilm, type ResolvedFilmParams,
} from './familyFilmContract.ts';
import { MOMENTS_ALGO, MOMENTS_GATES, videoFrames, type MomentWindow } from './momentsContract.ts';
import { anchorOf, listGrid, placedMusicGrid, steadyGrid, type Grid } from './templatePlan.ts';
import { TemplateError, type PlannedSlot, type TemplateStep } from './templateContract.ts';
import { isFreeze, isRamped, sourceTimeOfFrame, speedOf, startOffsetFrames } from './speed.ts';
import { flashGapFrames } from './flashSafety.ts';
import { findTextPreset } from './textPresets.ts';
import { compareWall } from './events.ts';
import { clipEnd } from './validate.ts';
import { findClip } from './ops.ts';
import { sha256Hex } from './sha256.ts';
import { WALL_DATE_TIME, type Asset, type ProjectDocument, type RecipeRun, type SlotRecord, type Track } from './schema.ts';
import { removedByHand } from './templateOps.ts';

type RT = T.RationalTime;
type Ref = { $ref: string; out?: string };

/** True once the planner below is built. */
export const FAMILY_FILM_BUILT: boolean = true;

/** Stable key of a pick: 'm' + the first 12 hex of sha256(`${assetId}:${ordinal}`). */
export const filmPickKey: FilmPickKey = (assetId: string, ordinal: number): string => `m${sha256Hex(`${assetId}:${ordinal}`).slice(0, 12)}`;

const DEFAULT_TITLE = { he: 'הסרט שלנו', en: 'Our film' } as const;
const DEFAULT_CLOSING = { he: 'סוף', en: 'The end' } as const;
const TITLE_LOOK = 'title-card', CLOSING_LOOK = 'end-card', STILL_MOTION = 'motion.move.ken-burns-in';
/** A tick below the film start, so that the grid's "beat strictly after" finds a beat lying exactly on the start. */
const TICK = T.rt(1, 1_000_000_000);
const MAX_ITEM_CHARS = FILM.maxStepChars;

const own = <V>(rec: Readonly<Record<string, V>> | undefined | null, key: string): V | undefined => (rec && Object.hasOwn(rec, key) ? rec[key] : undefined);
const clampInt = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const isPicture = (a: Asset) => (!!a.video && a.kind !== 'image') || (a.kind === 'image' && !!a.image);
const isStill = (a: Asset) => a.kind === 'image';
const hasSound = (a: Asset) => !isStill(a) && !!a.audio;
const clipText = (s: string) => (s.length > MAX_ITEM_CHARS ? `${s.slice(0, MAX_ITEM_CHARS - 1)}…` : s);
const quote = (s: string) => (s.length > 60 ? `${s.slice(0, 59)}…` : s);

/** A template grid error as a film error (same code; needs_capability cannot happen here and reads as invalid_args). */
function filmErrorOf(e: unknown): never {
  if (e instanceof TemplateError) throw new FilmError(e.code === 'needs_capability' ? 'invalid_args' : e.code, e.message, e.hint);
  throw e;
}

// ---------- source frames of an asset (mixed frame rates; the picture's start offset counted) ----------
/** Source frames a clip of `projFrames` project frames reads at speed 1 (rounded up, so the window covers every frame shown). */
function sourceFramesFor(asset: Asset, projFrames: number, rate: { num: number; den: number }): number {
  const a = asset.video!.frameRate;
  const num = BigInt(projFrames) * BigInt(a.num) * BigInt(rate.den), den = BigInt(a.den) * BigInt(rate.num);
  return Number((num + den - 1n) / den);
}
/** The latest source frame a clip of `projFrames` may start at without reading past the file (frames and duration), or -1. */
function latestStart(asset: Asset, projFrames: number, rate: { num: number; den: number }): number {
  const frames = videoFrames(asset)!;
  const ls = sourceFramesFor(asset, projFrames, rate);
  const length = T.frameTime(projFrames, rate);
  const room = T.sub(asset.duration, length);
  if (T.isNegative(room)) return -1;
  const off = startOffsetFrames(asset.video!);
  let s = Math.min(frames - ls, T.frameIndexAt(room, asset.video!.frameRate) - off + 1);
  while (s >= 0 && T.lt(asset.duration, T.add(sourceTimeOfFrame(asset, s), length))) s--;
  return s;
}
/** The longest clip (project frames) the asset can fill at speed 1; Infinity for a still. */
function capacityOf(asset: Asset, rate: { num: number; den: number }): number {
  if (isStill(asset)) return Infinity;
  const frames = videoFrames(asset)!;
  const a = asset.video!.frameRate;
  let f = Math.min(T.frameIndexAt(asset.duration, rate), Math.floor((frames * a.den * rate.num) / (a.num * rate.den)));
  while (f > 0 && latestStart(asset, f, rate) < 0) f--;
  return Math.max(0, f);
}

// ---------- the moments of an asset ----------
function recordOf(doc: ProjectDocument, assetId: string): FilmMomentsRecord | null {
  const m = own(doc.analyses, assetId)?.moments;
  return m ? { algo: m.algo, flat: m.flat, file: m.file, windows: m.windows } : null;
}
const measured = (r: FilmMomentsRecord | null): r is FilmMomentsRecord => !!r && r.algo === MOMENTS_ALGO;
type Cls = 'A' | 'B' | 'C';
function classOf(asset: Asset, r: FilmMomentsRecord | null, w: MomentWindow | null): Cls {
  if (isStill(asset) || !measured(r)) return 'C';
  if (r.flat || !w) return r.file.motion !== null && r.file.motion >= MOMENTS_GATES.activeMotionPermille ? 'B' : 'C';
  return w.basis.length >= 2 || w.burstFrame !== undefined ? 'A' : 'B';
}
/** How active a pick is, for the 'arc' order: motion (permille) + 10 x level above the file's median (dB); null = unknown. */
function activityOf(asset: Asset, r: FilmMomentsRecord | null, w: MomentWindow | null): number | null {
  if (isStill(asset) || !measured(r)) return null;
  if (w) return (w.motion ?? 0) + 10 * Math.max(0, w.level ?? 0);
  return r.file.motion;
}

/** At most `max` lines in their order: every line of `must` is kept, the others in order while room is left. */
function capKeeping(lines: readonly string[], must: readonly string[], max: number): string[] {
  if (lines.length <= max) return [...lines];
  const keep = new Set(must);
  let room = max - lines.filter((x) => keep.has(x)).length;
  return lines.filter((x) => keep.has(x) || room-- > 0);
}
/** Spread `count` choices evenly over `list` (never a run from one end). */
function spread<X>(list: readonly X[], count: number): X[] {
  if (count <= 0) return [];
  if (count >= list.length) return [...list];
  const out: X[] = [];
  for (let i = 0; i < count; i++) out.push(list[Math.min(list.length - 1, Math.floor(((i + 0.5) * list.length) / count))]!);
  return [...new Set(out)];
}
/** Arrange values so they rise to the largest at two thirds and fall after it (unimodal). Items are [index, value] pairs. */
function arc<X>(items: readonly { item: X; value: number; given: number }[]): X[] {
  const n = items.length;
  if (n === 0) return [];
  const sorted = [...items].sort((a, b) => b.value - a.value || a.given - b.given);
  const peak = Math.round(((n - 1) * 2) / 3);
  const slots: (X | undefined)[] = new Array(n);
  slots[peak] = sorted[0]!.item;
  let l = peak - 1, r = peak + 1, usedL = 0, usedR = 0;
  const capL = peak, capR = n - 1 - peak;
  for (const x of sorted.slice(1)) {
    const left = capR === usedR || (capL > usedL && usedL * capR <= usedR * capL);
    if (left) { slots[l--] = x.item; usedL++; } else { slots[r++] = x.item; usedR++; }
  }
  return slots as X[];
}

interface Cand {
  asset: Asset; given: number; rec: FilmMomentsRecord | null;
  windowIndex: number | null; chosen: boolean; second: boolean;
  cls: Cls; include: boolean; capacity: number; captureAt: string | null;
  /** index into the allowed spans */
  si: number; key?: string;
}
interface Slot { c: Cand; startF: number; endF: number; startJ: number | null; endJ: number | null }

/** Pure. Throws FilmError. */
export const planFamilyFilm: PlanFamilyFilm = (doc: ProjectDocument, params: unknown, ctx: FilmPlanContext): FamilyFilmPlan => {
  // ===== 1. parameters =====
  const parsed = FamilyFilmParamsSchema.safeParse(params ?? {});
  if (!parsed.success) throw new FilmError('invalid_args', z.prettifyError(parsed.error), 'See the family film parameters (describe_recipes, recipe family-film).');
  const p0 = parsed.data;
  const rate = doc.settings.frameRate, fps = rate.num / rate.den, gap = flashGapFrames(fps);
  const seq = doc.sequences[doc.mainSequenceId];
  if (!seq) throw new FilmError('not_found', 'the project has no main sequence');
  let at: RT;
  try { at = anchorOf(doc, p0.at); } catch (e) { filmErrorOf(e); }
  const nf = (t: RT) => T.nearestFrameIndex(t, rate);
  const ft = (f: number) => T.frameTime(f, rate);
  const secs = (f: number) => `${(f / fps).toFixed(2)} s`;
  const P: ResolvedFilmParams = {
    assetIds: [...p0.assetIds], targetSeconds: p0.targetSeconds ?? FILM_DEFAULTS.targetSeconds, musicAssetId: p0.musicAssetId ?? null,
    order: p0.order ?? FILM_DEFAULTS.order, ownSound: p0.ownSound ?? FILM_DEFAULTS.ownSound, openingTitle: p0.openingTitle ?? FILM_DEFAULTS.openingTitle,
    closingCard: p0.closingCard ?? FILM_DEFAULTS.closingCard, lang: p0.lang ?? FILM_DEFAULTS.lang, motion: p0.motion ?? FILM_DEFAULTS.motion,
    ...(p0.event !== undefined ? { event: p0.event } : {}), ...(p0.openingText !== undefined ? { openingText: p0.openingText } : {}), ...(p0.closingText !== undefined ? { closingText: p0.closingText } : {}),
    at, picks: { exclude: [...(p0.picks?.exclude ?? [])], include: [...(p0.picks?.include ?? [])], window: Object.fromEntries(Object.entries(p0.picks?.window ?? {})) },
  };
  const lang = P.lang;
  const warnings: FilmWarning[] = [], blocking: FilmWarning[] = [], steps: string[] = [], basis: string[] = [];
  const warn = (code: FilmWarningCode, message: string, details: Record<string, unknown> = {}) => warnings.push({ code, message, details });
  const excluded: FilmExclusion[] = [];
  const exclude = (assetId: string, code: FilmExclusion['code'], details: Record<string, unknown> = {}) => excluded.push({ assetId, code, details });
  const minF = Math.round(FILM.minSlotSeconds * fps), maxF = Math.round(FILM.maxSlotSeconds * fps);

  // ===== regeneration: what was kept by hand =====
  const kept = ctx.kept ?? [];
  const keptPictures = kept.filter((k) => k.kind === 'picture' && k.endFrame > k.startFrame).map((k) => ({ s: k.startFrame, e: k.endFrame, k })).sort((a, b) => a.s - b.s || a.e - b.e);
  const keptAssets = new Set(keptPictures.flatMap((k) => (k.k.assetId ? [k.k.assetId] : [])));
  const keptTitle = kept.some((k) => k.kind === 'text' && k.key === FILM_BINDS.title);
  const keptClosing = kept.some((k) => k.kind === 'text' && k.key === FILM_BINDS.closing);
  const keptMusic = kept.find((k) => k.kind === 'music');
  if (kept.length) warn('kept_by_hand', `${kept.length} clip(s) of the last film were edited by hand and are kept exactly as they are`, { clipIds: kept.map((k) => k.clipId) });
  // clips that had only been moved in time are not hand edits: they went with the untouched ones and the film is laid out again
  const movedBack = [...new Set(ctx.movedKeys ?? [])].sort();
  if (movedBack.length) warn('moved_back', `${movedBack.length} clip(s) of the last film had only been moved in time, with nothing else changed; they were not kept where they were moved to, and the film was laid out again with them`, { keys: movedBack });
  // ===== regeneration: what was deleted by hand (FilmPlanContext.removedKeys) is not made again =====
  const keptKeySet = new Set(ctx.keptKeys ?? []);
  const removedKeys = new Set((ctx.removedKeys ?? []).filter((k) => !keptKeySet.has(k)));
  const removedTitle = removedKeys.has(FILM_BINDS.title), removedClosing = removedKeys.has(FILM_BINDS.closing), removedMusic = removedKeys.has(FILM_BINDS.music) && !keptMusic;
  // music deleted by hand: the mix is the no-music mix; the cuts stay on its bars, where the last film had them, until another
  // length or order is asked for (then a steady grid: nothing follows music that is not there)
  const prevCut = ctx.previousCut;
  const cutOnRemovedMusic = removedMusic && P.musicAssetId !== null && (!prevCut || (prevCut.onMusicBars && prevCut.targetSeconds === P.targetSeconds && prevCut.order === P.order));
  // picks deleted by hand: the window each showed comes from the run record (ctx.removedPicks); a pick with a window leaves out only
  // that window when the file has another to give, one without (the file's only possible pick) leaves the file out
  const removedWindows = new Map<string, Set<number>>(), removedFiles = new Set<string>();
  const resolvedPicks = new Set<string>();
  for (const r of ctx.removedPicks ?? []) {
    if (!removedKeys.has(r.key)) continue;
    resolvedPicks.add(r.key);
    if (r.windowIndex === null) removedFiles.add(r.assetId);
    else { const set = removedWindows.get(r.assetId) ?? new Set<number>(); set.add(r.windowIndex); removedWindows.set(r.assetId, set); }
  }
  // a removed pick key the record does not explain: a pick key is a hash of (file, ordinal), and a file's ordinal only grows past
  // keys already taken, so the file is found by its hash and left out whole
  const unexplained = [...removedKeys].filter((k) => FILM_PICK_KEY.test(k) && !resolvedPicks.has(k));
  if (unexplained.length) {
    const ordinals = keptKeySet.size + removedKeys.size + 2;
    for (const id of new Set(P.assetIds)) for (let o = 0; o < ordinals; o++) if (unexplained.includes(filmPickKey(id, o))) { removedFiles.add(id); break; }
  }
  /** What the plan leaves out because it was deleted by hand, for the warning (names and window times; the editor words it). */
  const leftOut: { kind: 'file' | 'window' | 'title' | 'closing' | 'music'; assetId?: string; name?: string; windowIndex?: number; fromSecond?: number; toSecond?: number }[] = [];
  const fileGone = new Set<string>();

  // ===== assets =====
  const excludeSet = new Set(P.picks.exclude), includeSet = new Set(P.picks.include);
  const seen = new Set<string>();
  const cands: Cand[] = [];
  const staleWindows: { wanted: number; name: string; have: number }[] = [];
  for (const [given, id] of P.assetIds.entries()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const a = own(doc.assets, id);
    if (!a) { exclude(id, 'no_picture', { reason: 'not in this project' }); continue; }
    if (!isPicture(a)) { exclude(id, 'no_picture', { kind: a.kind }); continue; }
    if (excludeSet.has(id)) { exclude(id, 'excluded_by_you'); continue; }
    if (keptAssets.has(id)) { exclude(id, 'kept_by_hand'); continue; }
    const rec = recordOf(doc, id);
    const ws = measured(rec) && !rec.flat ? rec.windows : [];
    const gone = removedWindows.get(id);
    const free = (i: number) => !gone?.has(i);
    // deleted by hand: the file is left out when it has no window left to give (or its only possible pick was deleted)
    if (removedFiles.has(id) || (gone && !ws.some((_, i) => free(i)))) { exclude(id, 'removed_by_hand'); fileGone.add(id); continue; }
    const capacity = capacityOf(a, rate);
    if (capacity < minF) { exclude(id, 'too_short', { seconds: Math.round((capacity / fps) * 100) / 100, shortestSlotSeconds: FILM.minSlotSeconds }); continue; }
    const wanted = own(P.picks.window, id);
    const chosen = wanted !== undefined && wanted < ws.length && free(wanted);
    if (wanted !== undefined && wanted >= ws.length) staleWindows.push({ wanted, name: quote(a.name), have: ws.length });
    const windowIndex = ws.length ? (chosen ? wanted! : ws.findIndex((_, i) => free(i))) : null;
    const capRaw = own(ctx.capture, id) ?? null;
    const captureAt = typeof capRaw === 'string' && WALL_DATE_TIME.test(capRaw) ? capRaw : null;
    cands.push({ asset: a, given, rec, windowIndex, chosen, second: false, cls: classOf(a, rec, windowIndex !== null ? ws[windowIndex]! : null), include: includeSet.has(id), capacity, captureAt, si: 0 });
  }
  // one line for every window asked for that does not exist (a stale choice after measuring again), so they never crowd the basis
  if (staleWindows.length === 1) { const w = staleWindows[0]!; basis.push(clipText(`window ${w.wanted} of "${w.name}" was asked for, but it has ${w.have} measured window(s); its first one is used`)); }
  else if (staleWindows.length > 1) basis.push(clipText(`${staleWindows.length} window choices were asked for that the files do not have, so their first measured window is used: ${staleWindows.map((w) => `window ${w.wanted} of "${w.name}" (${w.have} measured)`).join(', ')}`));
  // the warning: every file and window left out, by name and time, then the titles and the music
  for (const id of [...new Set([...removedFiles, ...fileGone])]) leftOut.push({ kind: 'file', assetId: id, name: own(doc.assets, id)?.name ?? id });
  for (const [id, set] of removedWindows) {
    if (fileGone.has(id) || removedFiles.has(id)) continue;
    const a = own(doc.assets, id), rec = recordOf(doc, id);
    for (const w of [...set].sort((x, y) => x - y)) {
      const win = a && measured(rec) && !rec.flat ? rec.windows[w] : undefined;
      const at = (f: number) => Math.round(T.toSeconds(sourceTimeOfFrame(a!, f)) * 10) / 10;
      leftOut.push({ kind: 'window', assetId: id, name: a?.name ?? id, windowIndex: w, ...(win ? { fromSecond: at(win.fromFrame), toSecond: at(win.toFrame) } : {}) });
    }
  }
  if (removedTitle) leftOut.push({ kind: 'title' });
  if (removedClosing) leftOut.push({ kind: 'closing' });
  if (removedMusic) leftOut.push({ kind: 'music', ...(P.musicAssetId !== null ? { assetId: P.musicAssetId, name: own(doc.assets, P.musicAssetId)?.name ?? P.musicAssetId } : {}) });
  if (removedKeys.size) {
    const words = leftOut.map((x) => x.kind === 'file' ? `"${quote(x.name!)}" (the whole file)` : x.kind === 'window' ? `"${quote(x.name!)}" (${x.fromSecond !== undefined ? `its moment at ${x.fromSecond.toFixed(1)}–${x.toSecond!.toFixed(1)} s` : `its moment ${x.windowIndex! + 1}`}; its other moments may stay)` : x.kind === 'title' ? 'the opening title' : x.kind === 'closing' ? 'the closing card' : `the music${x.name ? ` "${quote(x.name)}"` : ''}`);
    warn('removed_by_hand', clipText(`left out because they were deleted by hand: ${words.join(', ') || `${removedKeys.size} part(s)`}; regenerate with restoreRemoved to make them again`), { keys: [...removedKeys].sort(), items: leftOut });
  }
  if (!cands.length && !keptPictures.length) throw new FilmError('nothing_to_do', 'none of the chosen files can go into the film (no picture, too short, left out or kept by hand)', fileGone.size ? 'Regenerate with restoreRemoved: true to bring back the clips deleted by hand, or choose more pictures or videos.' : 'Choose pictures or videos of at least 1.6 seconds.');

  // ===== 2. order =====
  let ordered: Cand[];
  if (P.order === 'given') ordered = [...cands];
  else if (P.order === 'capture') {
    const dated = cands.filter((c) => c.captureAt !== null).sort((a, b) => compareWall(a.captureAt!, b.captureAt!) || a.given - b.given);
    const undated = cands.filter((c) => c.captureAt === null);
    ordered = [...dated, ...undated];
    if (undated.length) {
      warn('no_capture_time', `${undated.length} file(s) have no capture time; they come after the dated ones, in the order chosen`, { assetIds: undated.map((c) => c.asset.id) });
      basis.push(`order: by capture time (${dated.length} dated); ${undated.length} file(s) without a capture time follow in the order chosen`);
    } else basis.push(`order: by capture time (${dated.length} dated file(s))`);
  } else {
    const valued = cands.flatMap((c) => { const w = c.windowIndex !== null && c.rec ? c.rec.windows[c.windowIndex]! : null; const v = activityOf(c.asset, c.rec, w); return v === null ? [] : [{ item: c, value: v, given: c.given }]; });
    const rest = cands.filter((c) => !valued.some((v) => v.item === c));
    ordered = [...arc(valued), ...rest];
    basis.push(`order: an arc — calm first, the most active clip at two thirds, calm at the end (measured motion plus 10 x the sound level above the file's median, in dB; heuristic)${rest.length ? `; ${rest.length} still(s) or unmeasured file(s) at the end` : ''}`);
  }
  if (P.order === 'given') basis.push('order: as chosen');

  // ===== 3. grid =====
  type Music = { assetId: string; name: string; sourceIn: RT; grid: Grid; beatCount: number; bpm: number | null; bars: boolean; confidence: number | null; method: string; edited: boolean; kept: boolean; trackId: string | null };
  let music: Music | null = null;
  if (keptMusic) {
    const f = findClip(doc, keptMusic.clipId);
    const c = f?.clip;
    const an = c && c.type === 'media' ? own(doc.analyses, c.assetId)?.beats : undefined;
    const sp = c && c.type === 'media' ? speedOf(c) : null;
    const followable = !!c && c.type === 'media' && !c.reverse && !isRamped(c) && !isFreeze(c) && !!sp && sp.num === sp.den && !!an && an.beats.length >= 2;
    if (!followable || !c || c.type !== 'media' || !an) {
      blocking.push({ code: 'kept_music_not_followable', message: 'the music kept by hand plays backwards, at another speed or has no measured beats, so the new cuts cannot follow its beats', details: { clipId: keptMusic.clipId } });
    } else {
      const end = T.add(c.sourceIn, c.duration);
      const place = (list: readonly RT[]) => [...list].filter((b) => !T.lt(b, c.sourceIn) && T.lt(b, end)).sort(T.cmp).map((b) => T.add(c.start, T.sub(b, c.sourceIn)));
      const tb = place(an.beats), downs = place(an.downbeats ?? []);
      if (tb.length < 2) blocking.push({ code: 'kept_music_not_followable', message: 'fewer than two measured beats of the music kept by hand lie inside its clip', details: { clipId: keptMusic.clipId } });
      else music = { assetId: c.assetId, name: own(doc.assets, c.assetId)?.name ?? c.assetId, sourceIn: c.sourceIn, grid: listGrid(tb, downs.length ? downs : null, an.meter ?? 4), beatCount: tb.length, bpm: an.bpm, bars: downs.length > 0, confidence: an.confidence, method: an.origin.method, edited: !!an.origin.edited, kept: true, trackId: f!.track.id };
    }
  } else if (P.musicAssetId !== null && !(removedMusic && !cutOnRemovedMusic)) {
    try {
      const pm = placedMusicGrid(doc, P.musicAssetId, at, 'first-downbeat', false);
      music = { assetId: pm.asset.id, name: pm.asset.name, sourceIn: pm.sourceIn, grid: pm.grid, beatCount: pm.beatCount, bpm: pm.bpm, bars: pm.bars, confidence: pm.confidence, method: pm.method, edited: pm.edited, kept: false, trackId: null };
    } catch (e) { filmErrorOf(e); }
  }
  const grid: Grid = music?.grid ?? steadyGrid(at, FILM.fallbackBpm);
  const hasBars = music ? music.bars : true;
  if (music && music.confidence !== null && music.confidence < FILM.lowBeatConfidence) warn('low_beat_confidence', `the beat measurement of "${quote(music.name)}" is unsure (confidence ${music.confidence.toFixed(2)}); the cuts follow its beats as measured`, { confidence: music.confidence });
  const m = grid.meter;
  /** the k-th beat (k >= 0) at or after the film start */
  const beatCache = new Map<number, RT | null>();
  const beatK = (k: number): RT | null => { let v = beatCache.get(k); if (v === undefined) { v = grid.beatAfter(T.sub(at, TICK), k + 1); beatCache.set(k, v); } return v; };
  const beatCount = music ? (() => { let n = 0; for (let lo = 0, hi = music.beatCount; lo < hi;) { const mid = (lo + hi) >> 1; if (beatK(mid)) { n = mid + 1; lo = mid + 1; } else hi = mid; } return n; })() : Infinity;
  if (music && beatCount < 2) throw new FilmError('needs_analysis', 'fewer than two measured beats of the music lie after the start of the film', 'Measure the beat of the music first (מדידת קצב, ללא בינה מלאכותית).');
  const probe = Math.min(64, beatCount - 1);
  const beatSec = (T.toSeconds(beatK(probe)!) - T.toSeconds(beatK(0)!)) / probe;
  // allowed spans in beats; doubled when the music is too fast for two of them to fit the slot range
  const baseBeats = m % 2 === 0 ? [m / 2, m, 2 * m, 4 * m] : [m, 2 * m, 4 * m];
  const fits = (b: number) => b * beatSec >= FILM.minSlotSeconds - 1e-9 && b * beatSec <= FILM.maxSlotSeconds + 1e-9;
  let every = 1;
  while (baseBeats.filter((b) => fits(b * every)).length < 2 && every < 4 && baseBeats[0]! * every * 2 * beatSec <= FILM.maxSlotSeconds) every *= 2;
  const g = baseBeats[0]! * every;
  let allowed = baseBeats.map((b) => b * every).filter(fits).map((b) => b / g);
  if (!allowed.length) {
    const nearest = [...baseBeats.map((b) => b * every)].sort((x, y) => Math.abs(x * beatSec - FILM.minSlotSeconds) - Math.abs(y * beatSec - FILM.minSlotSeconds))[0]!;
    allowed = [nearest / g];
    basis.push(`no span of ${baseBeats.join('/')} beats lies between ${FILM.minSlotSeconds} and ${FILM.maxSlotSeconds} s at this tempo; every slot is ${nearest} beats long`);
  }
  if (every > 1) basis.push(`the music is fast: counted on every ${every === 2 ? 'second' : 'fourth'} beat, so every slot lasts at least ${FILM.minSlotSeconds} s`);
  const unitSec = g * beatSec;
  // The unit boundaries, read from the grid's own bar list (bar starts may be irregular: measured so, or corrected by hand).
  // Half-bar units (g = m/2): every bar start, and the middle beat of every bar of an even number of beats (a bar of an odd
  // number has no half-bar cut). Units of q = g/m bars: every q-th bar start from the first one at or after the film start.
  // Music without bar starts: every g-th beat. The steady grid is regular (a bar every m beats from the film start) and endless.
  type Bound = { t: RT; beat: number; bar: number | null };
  let bounds: Bound[] | null = null;
  let irregularBars = 0;
  if (music) {
    const beats: RT[] = [];
    for (let k = 0; k < beatCount; k++) beats.push(beatK(k)!);
    bounds = [];
    if (music.bars) {
      const starts: number[] = [];
      for (let n = 1, k = 0; ; n++) {
        const d = grid.barAfter(T.sub(at, TICK), n);
        if (!d) break;
        while (k < beats.length && T.lt(beats[k]!, d)) k++;
        if (k >= beats.length) break;
        if (T.eq(beats[k]!, d)) starts.push(k); // every bar start is one of the beats (edit_analysis, attach_analysis)
      }
      const perUnit = 2 * g === m ? 0 : g / m;
      for (const [i, p] of starts.entries()) {
        const next = starts[i + 1];
        if (next !== undefined && next - p !== m) irregularBars++;
        if (perUnit === 0) {
          bounds.push({ t: beats[p]!, beat: p, bar: i });
          const len = next !== undefined ? next - p : m;
          if (len % 2 === 0 && p + len / 2 < beats.length) bounds.push({ t: beats[p + len / 2]!, beat: p + len / 2, bar: null });
        } else if (i % perUnit === 0) bounds.push({ t: beats[p]!, beat: p, bar: i });
      }
    } else for (let k = 0; k < beats.length; k += g) bounds.push({ t: beats[k]!, beat: k, bar: null });
  }
  /** the j-th unit boundary (j >= 0), exact; null past the music's last usable beat */
  const unitAt = (j: number): Bound | null => {
    if (bounds) return bounds[j] ?? null;
    const t = beatK(j * g);
    return t ? { t, beat: j * g, bar: (j * g) % m === 0 ? (j * g) / m : null } : null;
  };
  const bound = (j: number): RT | null => unitAt(j)?.t ?? null;
  const boundF = (j: number): number | null => { const b = bound(j); return b ? nf(b) : null; };
  const maxJ = bounds ? bounds.length - 1 : Infinity;
  /** The film start is a unit boundary, unless the music kept by hand was moved so that its first bar start (beat) lies later. */
  const startOnGrid = boundF(0) === nf(at);
  if (irregularBars) basis.push(`${irregularBars} bar(s) of the music do not have ${m} beats; the cuts follow the measured bar starts${2 * g === m ? ', and a bar of an odd number of beats has no half-bar cut' : ''}`);
  if (!startOnGrid) basis.push(bound(0) ? `the music kept by hand has its first ${music?.bars ? 'bar start' : 'beat'} ${T.toSeconds(T.sub(bound(0)!, at)).toFixed(2)} s after the start of the film; the first clip starts with the film and its end, like every cut after it, is on the grid` : 'no bar start of the music kept by hand lies after the start of the film');
  const tempoText = music ? (music.bpm ? `${music.bpm.toFixed(1)} BPM` : 'unknown tempo') : `${FILM.fallbackBpm} BPM`;
  basis.unshift(music
    ? `${music.beatCount} measured beats of "${quote(music.name)}" (${tempoText}, confidence ${music.confidence ?? 'n/a'}${music.edited ? ', corrected by hand' : ''}${music.bars ? ', with bar starts' : ''}${music.kept ? ', placed by hand' : ''}); method: ${music.method}`
    : `no music: a steady grid of ${FILM.fallbackBpm} beats a minute, four beats to a bar`);

  // ===== 4. spans and fitting, in units =====
  const capUnits = (c: Cand): number => { let i = -1; allowed.forEach((u, k) => { if (Math.round(u * unitSec * fps) <= c.capacity) i = k; }); return i; };
  const fitting: Cand[] = [];
  for (const c of ordered) {
    if (capUnits(c) < 0) { exclude(c.asset.id, 'too_short', { seconds: Math.round((c.capacity / fps) * 100) / 100, shortestSlotSeconds: Math.round(allowed[0]! * unitSec * 100) / 100 }); continue; }
    fitting.push(c);
  }
  if (!fitting.length && !keptPictures.length) throw new FilmError('nothing_to_do', `every chosen video is shorter than the shortest slot at this tempo (${(allowed[0]! * unitSec).toFixed(2)} s)`, 'Choose longer videos, pictures, or other music.');
  // the target in units: the pictures end one closing card before the target, at the boundary nearest it
  const closingBeats = (() => { for (let k = m; k <= 16 * m; k += m) { if (k * beatSec >= FILM.closingMinSeconds - 1e-9) return k * beatSec <= FILM.closingMaxSeconds + 1e-9 ? k : Math.max(1, Math.ceil(FILM.closingMinSeconds / beatSec)); } return Math.max(1, Math.ceil(FILM.closingMinSeconds / beatSec)); })();
  const closingEst = P.closingCard ? Math.min(FILM.closingMaxSeconds, Math.max(FILM.closingMinSeconds, closingBeats * beatSec)) : 0;
  const targetT = T.add(at, T.fromSeconds(Math.max(0, P.targetSeconds - closingEst).toFixed(6)));
  let nTarget = 0;
  for (let j = 1; j <= maxJ; j++) {
    const b = bound(j);
    if (!b) break;
    if (!T.lt(b, targetT)) { const prev = bound(j - 1)!; nTarget = Math.abs(T.toSeconds(T.sub(b, targetT))) < Math.abs(T.toSeconds(T.sub(targetT, prev))) ? j : j - 1; break; }
    nTarget = j;
  }
  const reached = bound(nTarget) ?? at;
  const musicShort = !!music && T.toSeconds(T.sub(targetT, reached)) > unitSec / 2;
  if (musicShort) warn('music_short', `the music's measured beats end ${T.toSeconds(T.sub(targetT, reached)).toFixed(1)} s before the length asked for; the film ends with them`, { lastBeat: reached });
  // pictures kept by hand take part of the range, and the layout runs at least up to the last of them
  const atF = nf(at);
  const keptUnits = keptPictures.reduce((n, k) => n + Math.max(0, k.e - Math.max(k.s, atF)) / fps / unitSec, 0);
  const lastKeptEnd = keptPictures.reduce((x, k) => Math.max(x, k.e), -1);
  let coverJ = 0;
  if (lastKeptEnd > atF) { while (coverJ < maxJ && (boundF(coverJ) ?? Infinity) < lastKeptEnd) coverJ++; }
  if (lastKeptEnd > 0 && coverJ > nTarget) warn('longer_than_target', `a clip kept by hand ends at ${secs(lastKeptEnd - atF)} into the film, after the length asked for; the film runs up to it`, { keptEndFrame: lastKeptEnd });
  const want = Math.max(0, Math.max(nTarget, coverJ) - Math.round(keptUnits));

  // (a) too many picks: drop C, then B, then A (never an included one), spread evenly over the order
  let pool = [...fitting];
  const minU = allowed[0]!;
  const maxCount = Math.min(FILM.maxPicks, Math.max(keptPictures.length ? 0 : 1, Math.floor(want / minU)));
  if (pool.length > maxCount) {
    let drop = pool.length - maxCount;
    for (const cls of ['C', 'B', 'A'] as const) {
      if (drop <= 0) break;
      const list = pool.filter((c) => c.cls === cls && !c.include);
      const gone = spread(list, Math.min(drop, list.length));
      for (const c of gone) exclude(c.asset.id, 'no_room', { class: cls, seconds: P.targetSeconds });
      pool = pool.filter((c) => !gone.includes(c));
      drop -= gone.length;
    }
    if (pool.length > maxCount) warn('longer_than_target', `the ${pool.length} clip(s) you asked to keep do not fit ${P.targetSeconds} s even at the shortest slots; the film is longer`, { assetIds: pool.map((c) => c.asset.id) });
  }
  // (b) base spans by class, capped by what each clip can fill
  const perPick = pool.length ? (want * unitSec) / pool.length : unitSec;
  let base = 0;
  allowed.forEach((u, k) => { if (Math.abs(u * unitSec - perPick) < Math.abs(allowed[base]! * unitSec - perPick)) base = k; });
  const setBase = (c: Cand) => { c.si = Math.min(capUnits(c), clampInt(base + (c.cls === 'A' ? 1 : c.cls === 'C' ? -1 : 0), 0, allowed.length - 1)); };
  pool.forEach(setBase);
  const sum = () => pool.reduce((n, c) => n + allowed[c.si]!, 0);
  const closer = (delta: number) => Math.abs(sum() + delta - want) < Math.abs(sum() - want);
  // (c) too long: shrink C, then B, then A, one step at a time, evenly
  for (const cls of ['C', 'B', 'A'] as const) {
    let changed = true;
    while (sum() > want && changed) {
      changed = false;
      for (const c of spread(pool.filter((x) => x.cls === cls && x.si > 0), pool.length)) {
        if (sum() <= want) break;
        c.si--; changed = true;
      }
    }
  }
  // (d) too short: second windows (>= 4 s apart, next to the first in source order), then grow B, A, C
  if (sum() < want) {
    for (const c of [...pool]) {
      if (pool.length >= FILM.maxPicks || sum() >= want) break;
      if (c.second || !measured(c.rec) || c.rec.flat || c.windowIndex === null) continue;
      const used = c.rec.windows[c.windowIndex]!;
      const rateA = c.asset.video!.frameRate;
      const gapFrames = Math.round((FILM.secondWindowGapSeconds * rateA.num) / rateA.den);
      const idx = c.rec.windows.findIndex((w, i) => i !== c.windowIndex && !removedWindows.get(c.asset.id)?.has(i) && Math.abs(w.peakFrame - used.peakFrame) >= gapFrames);
      if (idx < 0) continue;
      const w = c.rec.windows[idx]!;
      const two: Cand = { ...c, windowIndex: idx, chosen: false, second: true, cls: classOf(c.asset, c.rec, w), include: false, si: 0 };
      setBase(two);
      if (!closer(allowed[two.si]!)) continue;
      const at0 = pool.indexOf(c);
      pool.splice(w.peakFrame < used.peakFrame ? at0 : at0 + 1, 0, two);
    }
    for (const cls of ['B', 'A', 'C'] as const) {
      let changed = true;
      while (sum() < want && changed) {
        changed = false;
        for (const c of spread(pool.filter((x) => x.cls === cls && x.si < Math.min(allowed.length - 1, capUnits(x))), pool.length)) {
          const d = allowed[c.si + 1]! - allowed[c.si]!;
          if (!closer(d)) continue;
          c.si++; changed = true;
        }
      }
    }
  }

  // ===== 5. layout on the grid, around the kept pictures =====
  const firstBoundAtLeast = (fromJ: number, frame: number): number | null => {
    for (let j = Math.max(0, fromJ); j <= maxJ; j++) { const f = boundF(j); if (f === null) return null; if (f >= frame) return j; }
    return null;
  };
  const slots: Slot[] = [];
  const dropped: Cand[] = [];
  let curF = atF, curJ: number | null = startOnGrid ? 0 : null;
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i]!;
    for (const k of keptPictures) if (k.s <= curF && curF < k.e) { curF = k.e; curJ = null; }
    let endJ: number | null;
    if (curJ !== null) {
      // on the grid: the pick's span, shortened while the clip cannot fill it
      let si = c.si;
      endJ = curJ + allowed[si]!;
      while (si > 0 && (boundF(endJ) === null || boundF(endJ)! - curF > c.capacity)) { si--; endJ = curJ + allowed[si]!; }
      c.si = si;
    } else {
      // after a kept clip: to the next boundary at least the shortest slot away
      endJ = firstBoundAtLeast(0, curF + minF);
    }
    const endFrame = endJ !== null && endJ <= maxJ ? boundF(endJ) : null;
    if (endFrame === null) { dropped.push(...pool.slice(i)); break; }
    let endF = endFrame, offEnd = false;
    if (endF - curF > c.capacity) {
      // off the grid and the clip is too short for the next boundary: the latest boundary it can fill, else it waits out
      const j2: number | null = endJ !== null ? ((): number | null => { for (let j = endJ - 1; j >= 0; j--) { const f = boundF(j)!; if (f - curF < minF) return null; if (f - curF <= c.capacity) return j; } return null; })() : null;
      if (j2 === null) { if (!c.second) exclude(c.asset.id, 'no_room', { reason: 'too short for the room next to a clip kept by hand' }); continue; }
      endJ = j2; endF = boundF(j2)!;
    }
    const hit = keptPictures.find((k) => k.s >= curF && k.s < endF);
    if (hit) {
      if (hit.s - curF >= minF) { endF = hit.s; offEnd = true; }
      else {
        const prev = slots[slots.length - 1];
        if (prev && prev.endF === curF && hit.s - prev.startF <= prev.c.capacity) { prev.endF = hit.s; prev.endJ = null; }
        curF = hit.e; curJ = null; i--;
        continue;
      }
    }
    slots.push({ c, startF: curF, endF, startJ: curJ, endJ: offEnd ? null : endJ });
    curF = endF; curJ = offEnd ? null : endJ;
  }
  if (dropped.length) {
    for (const c of dropped) if (!c.second) exclude(c.asset.id, 'no_room', { reason: 'after the music\'s last measured beat' });
    if (!musicShort) warn('music_short', `${dropped.length} clip(s) would end after the music's last measured beat and were left out`, { assetIds: dropped.map((c) => c.asset.id), lastBeat: grid.last });
  }
  // the last new slot reaches a kept picture right after it when that keeps it a slot long
  {
    const last = slots[slots.length - 1];
    const next = last ? keptPictures.find((k) => k.s > last.endF) : undefined;
    if (last && next && !keptPictures.some((k) => k.s < next.s && k.e > last.endF) && next.s - last.startF <= Math.min(last.c.capacity, maxF)) { last.endF = next.s; last.endJ = null; }
  }
  // flash safety: a slot shorter than the flash gap is merged into the slot before it (ADR-0009)
  const merged: string[] = [];
  for (let i = 1; i < slots.length; i++) {
    const s = slots[i]!, prev = slots[i - 1]!;
    if (s.endF - s.startF >= gap || prev.endF !== s.startF || s.endF - prev.startF > prev.c.capacity) continue;
    prev.endF = s.endF; prev.endJ = s.endJ;
    merged.push(s.c.asset.id);
    if (!s.c.second) exclude(s.c.asset.id, 'no_room', { reason: 'merged: its cut would come less than the flash gap after the one before' });
    slots.splice(i--, 1);
  }
  if (merged.length) warn('cuts_merged', `${merged.length} cut(s) would come less than ${gap} frames after the one before; those slots were merged into the slot before them (cuts between bright and dark pictures can trigger seizures)`, { assetIds: merged, gapFrames: gap });
  if (!slots.length && !keptPictures.length) throw new FilmError('nothing_to_do', 'no clip fits before the music\'s last measured beat', 'Choose longer music, or start the film earlier (at).');

  // ===== keys: the next free ordinal (a new pick never takes a key a kept slot holds) =====
  const usedKeys = new Set([...(ctx.keptKeys ?? []), ...removedKeys]); // a deleted pick's key stays its own (its record travels on)
  for (const s of slots) {
    let ord = 0;
    while (usedKeys.has(filmPickKey(s.c.asset.id, ord))) ord++;
    s.c = { ...s.c, key: filmPickKey(s.c.asset.id, ord) };
    usedKeys.add(s.c.key!);
  }

  // ===== 6. the window in the source of each slot =====
  const picks: FilmPick[] = [];
  const windowOf = (c: Cand, F: number) => {
    const a = c.asset;
    if (isStill(a)) return { sourceInFrame: null, sourceFrames: null, kind: 'still' as const, windowIndex: null, reasons: filmReasonsFor(a, null, 0, 0) };
    const frames = videoFrames(a)!;
    const ls = sourceFramesFor(a, F, rate);
    const latest = Math.max(0, latestStart(a, F, rate));
    const w = c.windowIndex !== null && measured(c.rec) && !c.rec.flat ? c.rec.windows[c.windowIndex] ?? null : null;
    let start: number;
    if (w) start = w.toFrame - w.fromFrame >= ls ? clampInt(w.peakFrame - Math.round(FILM.leadIn * ls), w.fromFrame, w.toFrame - ls) : Math.round((w.fromFrame + w.toFrame - ls) / 2);
    else start = Math.floor((frames - ls) / 2);
    start = clampInt(start, 0, latest);
    const kind = start === 0 && ls >= frames ? 'whole-clip' as const : w ? 'measured' as const : 'default-middle' as const;
    return { sourceInFrame: start, sourceFrames: ls, kind, windowIndex: w ? c.windowIndex : null, reasons: filmReasonsFor(a, c.rec, start, ls, { chosenByYou: c.chosen, second: c.second }) as FilmReason[] };
  };
  const spanOf = (s: Slot): FilmPick['span'] => {
    if (s.startJ === null || s.endJ === null) return null;
    const a = unitAt(s.startJ)!, b = unitAt(s.endJ)!;
    return hasBars && a.bar !== null && b.bar !== null ? { count: b.bar - a.bar, unit: 'bar' } : { count: b.beat - a.beat, unit: 'beat' };
  };
  const ownOn = P.ownSound !== 'mute';
  for (const [i, s] of slots.entries()) {
    const w = windowOf(s.c, s.endF - s.startF);
    picks.push({
      key: s.c.key!, assetId: s.c.asset.id, order: i, startFrame: s.startF, frames: s.endF - s.startF, span: spanOf(s),
      sourceInFrame: w.sourceInFrame, sourceFrames: w.sourceFrames, kind: w.kind, windowIndex: w.windowIndex,
      windowsAvailable: measured(s.c.rec) ? s.c.rec.windows.length : 0, reasons: w.reasons, captureAt: s.c.captureAt, ownSound: ownOn && hasSound(s.c.asset),
    });
  }
  const needsMeasurement = [...new Set(slots.filter((s) => !isStill(s.c.asset) && !measured(s.c.rec)).map((s) => s.c.asset.id))];
  if (needsMeasurement.length) warn('not_measured', `${needsMeasurement.length} video(s) have no measured moments yet; the middle of each is used until they are measured`, { assetIds: needsMeasurement });
  const shapes = new Set(slots.map((s) => { const a = s.c.asset; const rot = a.video?.rotation === 90 || a.video?.rotation === 270; const w0 = a.video?.width ?? a.image?.width ?? 1, h0 = a.video?.height ?? a.image?.height ?? 1; const [w, h] = rot ? [h0, w0] : [w0, h0]; return h > w * 1.1 ? 'tall' : w > h * 1.1 ? 'wide' : 'square'; }));
  if (shapes.has('tall') && shapes.has('wide')) warn('mixed_orientation', 'the film mixes upright and wide pictures; some will show with bars or cropped', { shapes: [...shapes].sort() });

  // ===== 7. tracks =====
  const ops: TemplateStep[] = [];
  const plannedSlots: PlannedSlot[] = [];
  const ref = (bind: string, out?: string): Ref => (out ? { $ref: bind, out } : { $ref: bind });
  const trackById = (id: string | undefined) => (id ? seq.tracks.find((t) => t.id === id) : undefined);
  const free = (t: Track, ranges: readonly [number, number][]) => ranges.every(([s, e]) => !t.clips.some((c) => nf(c.start) < e && s < nf(clipEnd(c))));
  const pictureRanges = slots.map((s) => [s.startF, s.endF] as [number, number]);
  type TrackUse = { arg: string | Ref; status: 'reused' | 'empty' | 'new'; name: string };
  const taken = new Set<string>();
  const chooseTrack = (kind: 'video' | 'audio', reuse: string | undefined, bind: string, ranges: readonly [number, number][]): TrackUse => {
    const r = trackById(reuse);
    if (r && r.kind === kind && !r.locked && !(kind === 'video' ? r.hidden : r.muted) && !taken.has(r.id) && (kind === 'audio' || free(r, ranges))) { taken.add(r.id); return { arg: r.id, status: 'reused', name: r.name }; }
    const e = seq.tracks.find((t) => t.kind === kind && !t.locked && !t.hidden && !t.muted && t.clips.length === 0 && !t.audio && !taken.has(t.id));
    if (e) { taken.add(e.id); return { arg: e.id, status: 'empty', name: e.name }; }
    ops.push({ op: 'add_track', args: { kind }, bind });
    return { arg: ref(bind, 'trackId'), status: 'new', name: kind === 'video' ? 'a new picture track' : 'a new sound track' };
  };
  const pictures = slots.length ? chooseTrack('video', ctx.reuseTracks?.pictures, FILM_BINDS.pictures, pictureRanges) : null;
  const sounding = picks.filter((k) => k.ownSound);
  const ownTrack = sounding.length ? chooseTrack('audio', ctx.reuseTracks?.ownSound, FILM_BINDS.ownSound, []) : null;
  const placeMusic = !!music && !music.kept && !removedMusic;
  const musicTrack = placeMusic ? chooseTrack('audio', ctx.reuseTracks?.musicTrack, FILM_BINDS.musicTrack, []) : music?.kept && music.trackId ? { arg: music.trackId, status: 'reused' as const, name: trackById(music.trackId)?.name ?? '' } : null;

  // ===== the picture clips =====
  const fadeF = Math.round(FILM.soundFadeSeconds * fps);
  for (const [i, s] of slots.entries()) {
    const k = picks[i]!;
    const a = s.c.asset;
    ops.push({ op: 'add_clip', args: {
      assetId: a.id, trackId: pictures!.arg, start: ft(k.startFrame), duration: ft(k.frames),
      ...(k.sourceInFrame !== null ? { sourceIn: sourceTimeOfFrame(a, k.sourceInFrame) } : {}),
      withLinkedAudio: k.ownSound, ...(k.ownSound && ownTrack ? { audioTrackId: ownTrack.arg } : {}),
    }, bind: k.key });
    plannedSlots.push({ key: k.key, kind: 'picture', clipId: ref(k.key), accept: isStill(a) ? 'image' : 'video', ...(k.span && s.startJ !== null && k.span.count <= 64 ? { beats: k.span.unit === 'bar' ? { from: unitAt(s.startJ)!.bar!, count: k.span.count, unit: 'bar' as const } : { from: unitAt(s.startJ)!.beat, count: k.span.count, unit: 'beat' as const } } : {}) });
  }
  const shownFades = Math.min(fadeF, Math.floor(Math.min(...picks.map((k) => k.frames)) / 2));
  for (const k of sounding) {
    const f = Math.min(fadeF, Math.floor(k.frames / 2));
    if (f >= 1) ops.push({ op: 'set_clip_fades', args: { clipId: ref(k.key, 'audioClipId'), fadeIn: ft(f), fadeOut: ft(f) } });
  }
  const stills = P.motion === 'full' ? picks.filter((k) => k.kind === 'still' && k.frames >= 2) : [];
  for (const k of stills) ops.push({ op: 'apply_motion_preset', args: { clipId: ref(k.key), presetId: STILL_MOTION } });
  if (slots.length) {
    const first = slots[0]!.startF, last = slots[slots.length - 1]!.endF;
    steps.push(clipText(`Place ${slots.length} clip(s) from ${secs(first - atF)} to ${secs(last - atF)} of the film on ${pictures!.status === 'new' ? pictures!.name : `track ${pictures!.name}`}, cut on ${music ? `the ${hasBars ? 'bars and half-bars' : 'beats'} of "${quote(music.name)}" (${tempoText})` : `a steady ${FILM.fallbackBpm} BPM grid (no music)`}, ${P.order === 'capture' ? 'in the order they were filmed' : P.order === 'arc' ? 'calm first, the most active at two thirds' : 'in the order chosen'}; each shows its measured moment (heuristic)`));
  }
  if (stills.length) steps.push(`Give ${stills.length} photo(s) a slow zoom in (Ken Burns)`);
  else if (P.motion === 'none' && picks.some((k) => k.kind === 'still')) steps.push('No camera moves on the photos (reduced motion)');

  // ===== the mix (filmMix; only where it changes on a track used again) =====
  const mix = filmMix(P.ownSound, !!music && !removedMusic); // music deleted by hand: nothing is lowered under it, nothing is ducked
  const prevKnown = ctx.previousOwnSound !== undefined;
  const prev = prevKnown ? filmMix(ctx.previousOwnSound!, ctx.previousMusic ?? false) : { ownGain: 1, duckDb: null };
  if (ownTrack) {
    const was = ownTrack.status === 'reused' && prevKnown ? prev.ownGain : 1;
    if (mix.ownGain !== was) ops.push({ op: 'set_track_audio', args: { trackId: ownTrack.arg, gain: mix.ownGain } });
    steps.push(clipText(`Keep the clips' own sound on ${ownTrack.status === 'new' ? ownTrack.name : `track ${ownTrack.name}`} with ${(FILM.soundFadeSeconds).toFixed(1)} s fades${mix.ownGain !== 1 ? `, ${Math.round(-20 * Math.log10(mix.ownGain))} dB under the music` : music && !removedMusic && P.ownSound === 'lead' ? ', at full level' : ', at full level (there is no music)'}${shownFades < fadeF ? ' (shorter fades on short clips)' : ''}`));
  } else if (P.ownSound === 'mute') steps.push('Leave the clips\' own sound out (muted)');
  if (musicTrack) {
    const was = musicTrack.status === 'reused' && prevKnown ? prev.duckDb : null;
    const ownNew = !!ownTrack && ownTrack.status !== 'reused';
    if (mix.duckDb !== null && ownTrack && (mix.duckDb !== was || ownNew)) ops.push({ op: 'set_ducking', args: { trackId: musicTrack.arg, sourceTrackIds: [ownTrack.arg], reductionDb: mix.duckDb } });
    else if (mix.duckDb === null && was !== null) ops.push({ op: 'set_ducking', args: { trackId: musicTrack.arg, sourceTrackIds: null } });
    if (mix.duckDb !== null && ownTrack) {
      steps.push(`Lower the music by ${mix.duckDb} dB while a clip has its own sound`);
      const quiet = picks.filter((k) => !k.ownSound).length;
      if (quiet) warn('lead_music_rises', `the music is lowered while a clip has sound; over ${quiet} photo(s) or silent clip(s) it rises to full level`, { assetIds: picks.filter((k) => !k.ownSound).map((k) => k.assetId) });
    }
  }
  if (removedMusic) {
    // the track the last film ducked under its clips' own sound (its music track) keeps no ducking for music that is not there
    const ownIds = new Set([ctx.reuseTracks?.ownSound, typeof ownTrack?.arg === 'string' ? ownTrack.arg : undefined].filter((x): x is string => !!x));
    for (const t of seq.tracks) {
      if (t.kind !== 'audio' || t.locked || !t.audio?.duck || !(t.id === ctx.reuseTracks?.musicTrack || t.audio.duck.sourceTrackIds.some((id) => ownIds.has(id)))) continue;
      ops.push({ op: 'set_ducking', args: { trackId: t.id, sourceTrackIds: null } });
      steps.push(clipText(`Turn the ducking of track ${t.name} off: its music was deleted by hand`));
    }
    const name = P.musicAssetId !== null ? quote(own(doc.assets, P.musicAssetId)?.name ?? P.musicAssetId) : '';
    warn('music_removed', cutOnRemovedMusic
      ? `the music "${name}" was deleted by hand: the clips stay cut on its bars, where they are, with no music under them; their own sound is not lowered and nothing is ducked. Another length or order cuts them on a steady ${FILM.fallbackBpm} BPM grid instead`
      : `the music "${name}" was deleted by hand and another length or order was asked for: the clips are cut on a steady ${FILM.fallbackBpm} BPM grid, with no music; their own sound is not lowered and nothing is ducked`,
    { assetId: P.musicAssetId, cutOn: cutOnRemovedMusic ? 'removed-music' : 'steady' });
  }
  if ((!music || removedMusic) && P.ownSound !== 'mute') basis.push(P.ownSound === 'under' ? 'no music: the clips keep their own sound at full level' : 'no music: nothing to lower, the clips keep their own sound');

  // ===== titles =====
  const allPictures = [...slots.map((s) => [s.startF, s.endF] as const), ...keptPictures.map((k) => [k.s, k.e] as const)].sort((a, b) => a[0] - b[0]);
  const filmStartF = allPictures.length ? Math.min(atF, allPictures[0]![0]) : atF;
  const picturesStart = allPictures.length ? allPictures[0]![0] : atF;
  const picturesEnd = allPictures.reduce((x, r) => Math.max(x, r[1]), atF);
  const lookOf = (id: string | undefined, fallback: string, what: string) => {
    if (id === undefined) return fallback;
    if (findTextPreset(id)) return id;
    basis.push(`the ${what} look "${quote(id)}" is not in this build; the ${fallback} look is used`);
    return fallback;
  };
  const animate = (bind: string, frames: number) => {
    if (P.motion !== 'full') return;
    const f = Math.max(1, Math.min(Math.round(0.5 * fps), Math.floor(frames / 3)));
    if (2 * f > frames) return;
    ops.push({ op: 'set_text_animation', args: { clipId: ref(bind), animation: { by: 'word', in: 'fade', out: 'fade', loop: null, inFrames: f, outFrames: f } } });
  };
  const addTitle = (bind: string, t: FilmText, startF: number, endF: number, presetId: string, y: number) => {
    ops.push({ op: 'add_text', args: { text: t.text, start: ft(startF), duration: ft(endF - startF), transform: { x: 0, y }, ...(t.live ? { fields: true } : {}) }, bind });
    ops.push({ op: 'apply_text_preset', args: { clipId: ref(bind), presetId } });
    animate(bind, endF - startF);
    plannedSlots.push({ key: bind, kind: 'text', clipId: ref(bind) });
  };
  let titleText: FilmText | null = null;
  if (P.openingTitle && !keptTitle && !removedTitle && picturesEnd > picturesStart) {
    titleText = ctx.title ?? { text: P.openingText ?? P.event?.name ?? DEFAULT_TITLE[lang], resolved: null, live: false };
    if (!titleText.live && P.openingText === undefined) warn('title_resolved_static', ctx.title ? 'the opening title is fixed text: not every clip has a capture date to show, or the date of an evening event waits for its sunset answer' : 'the opening title is fixed text: no live title was given', {});
    const minTitle = Math.round(FILM.titleMinSeconds * fps);
    const ends = allPictures.map((r) => r[1]).filter((e) => e - picturesStart >= minTitle);
    const titleEnd = ends.length ? Math.min(...ends) : picturesEnd;
    addTitle(FILM_BINDS.title, titleText, picturesStart, titleEnd, lookOf(ctx.titleLookId, TITLE_LOOK, 'title'), FILM.titleY);
    steps.push(clipText(`Add the opening title "${quote(titleText.text)}" over the first ${secs(titleEnd - picturesStart)}${titleText.live ? ' (live fields: it shows the date of the pictures under it)' : ''}${P.motion === 'full' ? ', fading in and out' : ' without animation (reduced motion)'}`));
  } else if (keptTitle) steps.push('Keep the opening title edited by hand');
  else if (removedTitle && P.openingTitle) steps.push('Leave out the opening title: it was deleted by hand');
  let filmEndF = picturesEnd;
  if (P.closingCard && !keptClosing && !removedClosing) {
    const closing = ctx.closing ?? { text: P.closingText ?? DEFAULT_CLOSING[lang], resolved: null, live: false };
    const lastSlot = slots[slots.length - 1];
    const onGrid = lastSlot && lastSlot.endF === picturesEnd && lastSlot.endJ !== null ? lastSlot.endJ : null;
    const startT = ft(picturesEnd);
    const exact = onGrid !== null ? beatK(unitAt(onGrid)!.beat + closingBeats) : grid.beatAfter(startT, closingBeats);
    const lo = Math.round(FILM.closingMinSeconds * fps), hi = Math.round(FILM.closingMaxSeconds * fps);
    let endF = exact ? nf(exact) : picturesEnd + lo;
    if (endF - picturesEnd < lo - 1 || endF - picturesEnd > hi + 1) endF = picturesEnd + lo;
    addTitle(FILM_BINDS.closing, closing, picturesEnd, endF, lookOf(ctx.closingLookId, CLOSING_LOOK, 'closing'), 0);
    steps.push(clipText(`Add the closing card "${quote(closing.text)}" for ${secs(endF - picturesEnd)} after the last picture${exact && endF - picturesEnd >= lo - 1 ? ' (on the beat grid)' : ''}`));
    filmEndF = endF;
  } else if (keptClosing) steps.push('Keep the closing card edited by hand');
  else if (removedClosing && P.closingCard) steps.push('Leave out the closing card: it was deleted by hand');

  // ===== the music =====
  if (placeMusic && music && musicTrack) {
    ops.push({ op: 'add_clip', args: { assetId: music.assetId, trackId: musicTrack.arg, start: at, sourceIn: music.sourceIn, withLinkedAudio: false }, bind: FILM_BINDS.music });
    ops.push({ op: 'fit_music', args: { clipId: ref(FILM_BINDS.music), to: ft(filmEndF) } });
    plannedSlots.push({ key: FILM_BINDS.music, kind: 'music', clipId: ref(FILM_BINDS.music) });
    steps.push(clipText(`Place the music "${quote(music.name)}" from the start of the film (its first ${music.bars ? 'bar start' : 'beat'} at ${T.toSeconds(music.sourceIn).toFixed(3)} s in the file) on ${musicTrack.status === 'new' ? musicTrack.name : `track ${musicTrack.name}`} and end it on a beat at the end of the film`));
  } else if (music?.kept) steps.push('Keep the music placed by hand; the new cuts follow its beats');
  else if (music && removedMusic) steps.push(clipText(`Leave out the music "${quote(music.name)}": it was deleted by hand; the cuts still follow its beats`));

  // ===== what the plan rests on, and what it predicts =====
  const offGrid = new Set<number>(), cuts = new Set<number>();
  for (const s of slots) {
    // the film's own start, before the first bar start of music moved by hand, is no cut between clips and is not listed
    if (s.startJ !== null) cuts.add(s.startF);
    else if (!(s.startF === atF && !startOnGrid && !keptPictures.some((k) => k.e === atF))) offGrid.add(s.startF);
    (s.endJ !== null ? cuts : offGrid).add(s.endF);
  }
  for (const f of offGrid) cuts.delete(f);
  if (offGrid.size) warn('cut_off_grid_next_to_kept', `${offGrid.size} cut(s) next to clips kept by hand are where those clips are, not on the beat grid`, { frames: [...offGrid].sort((a, b) => a - b) });
  let covered = 0, reach = picturesStart;
  for (const [s, e] of allPictures) { if (e <= reach) continue; covered += e - Math.max(s, reach); reach = e; }
  const gapFrames = Math.max(0, picturesEnd - picturesStart - covered);
  // never a silent black stretch: when the chosen material cannot fill the room up to a clip kept by hand, the plan says how long
  if (gapFrames > 0) warn('pictures_missing', `${Math.round((gapFrames / fps) * 100) / 100} s of the film show no picture: the chosen clips do not fill the room up to the clips kept by hand`, { gapFrames, seconds: Math.round((gapFrames / fps) * 100) / 100 });
  const seconds = Math.round(((filmEndF - filmStartF) / fps) * 100) / 100;
  const bar = m * beatSec;
  const pictureSeconds = Math.round(((picturesEnd - picturesStart) / fps) * 100) / 100;
  if (seconds < P.targetSeconds - bar - 1e-6 && !musicShort) warn('shorter_than_target', `the chosen material fills ${seconds} s of the ${P.targetSeconds} s asked for`, { seconds, targetSeconds: P.targetSeconds, pictureSeconds });
  else if (seconds > P.targetSeconds + bar + 1e-6 && !warnings.some((w) => w.code === 'longer_than_target')) warn('longer_than_target', `the film is ${seconds} s long, more than the ${P.targetSeconds} s asked for`, { seconds, targetSeconds: P.targetSeconds });
  if (kept.some((k) => k.kind === 'picture')) {
    const w = warnings.find((x) => x.code === 'kept_by_hand')!;
    w.details = { ...w.details, seconds, pictureSeconds };
    w.message = `${w.message}; with them the film is ${seconds} s long`;
  }
  const videos = [...new Set(slots.filter((s) => !isStill(s.c.asset)).map((s) => s.c.asset.id))];
  // every plan says it is a heuristic draft and that faces are not used: these lines survive any cap of the basis
  const required = [
    clipText(`${FAMILY_FILM_METHOD}: ${FAMILY_FILM_DRAFT_LABEL.en}`),
    clipText(`${videos.length - needsMeasurement.length} of ${videos.length} video(s) have measured moments (heuristic: motion, sharpness, brightness and sound level; no model)${needsMeasurement.length ? `; ${needsMeasurement.length} are not measured yet, so their middle is used` : ''}`),
    clipText(FAMILY_FILM_FACES_NOTE),
  ];
  basis.push(
    ...required,
    `${P.assetIds.length} chosen file(s), ${slots.length} clip(s) in the film; ${rate.num}/${rate.den} frames a second; cuts at least ${Math.max(gap, minF)} frames apart (flash safety)`,
  );
  if (kept.length) basis.push(`${kept.length} clip(s) edited by hand are kept; the new clips are laid around ${keptPictures.length} kept picture(s)`);

  if (ops.length === 0) throw new FilmError('nothing_to_do', 'every part of this film was edited by hand since the last run; there is nothing to make again', removedKeys.size ? 'Regenerate with restoreRemoved: true to make the parts deleted by hand again.' : undefined);
  if (ops.length > FILM.maxOps) throw new FilmError('invalid_args', `this film would need ${ops.length} operations; at most ${FILM.maxOps} fit in one step`, 'Choose fewer files.');
  if (plannedSlots.length > FILM.maxSlots) throw new FilmError('invalid_args', `this film would record ${plannedSlots.length} slots; a run holds at most ${FILM.maxSlots}`);

  const alternatives: FamilyFilmPlan['alternatives'] = [
    ...([30, 60, 90] as const).filter((t) => t !== P.targetSeconds).map((t) => ({ label: `A ${t}-second film`, params: { targetSeconds: t } })),
    P.order === 'arc' ? { label: 'In the order they were filmed', params: { order: 'capture' as const } } : { label: 'Calm first, the most active clip at two thirds', params: { order: 'arc' as const } },
    ...(music ? (['under', 'lead', 'mute'] as const).filter((o) => o !== P.ownSound).map((o) => ({ label: o === 'under' ? 'The clips\' own sound 12 dB under the music' : o === 'lead' ? 'The voices lead: the music is lowered 9 dB while a clip has sound' : 'Music only: leave the clips\' own sound out', params: { ownSound: o } })) : []),
    P.motion === 'full' ? { label: 'No camera moves or animated titles (reduced motion)', params: { motion: 'none' as const } } : { label: 'With camera moves and animated titles', params: { motion: 'full' as const } },
    // the explicit choice to bring back what was deleted by hand (never taken on its own)
    ...(removedKeys.size ? [{ label: `Restore the ${removedKeys.size} part(s) deleted by hand`, params: {}, restoreRemoved: true as const }] : []),
  ];
  return {
    recipeId: FAMILY_FILM_RECIPE_ID, templateId: FAMILY_FILM_TEMPLATE_ID, version: FAMILY_FILM_VERSION, params: P,
    steps: steps.slice(0, FILM.maxSteps).map(clipText), basis: capKeeping(basis.map(clipText), required, FILM.maxSteps), warnings, blocking, alternatives,
    picks, excluded, needsMeasurement, ops, slots: plannedSlots,
    ...(removedMusic ? { musicRemoved: { cutOn: cutOnRemovedMusic ? 'removed-music' as const : 'steady' as const } } : {}),
    predicted: { startFrame: filmStartF, endFrame: filmEndF, cuts: [...cuts].sort((a, b) => a - b), offGridCuts: [...offGrid].sort((a, b) => a - b), gapFrames, seconds, targetSeconds: P.targetSeconds },
    method: FAMILY_FILM_METHOD,
  };
};

/**
 * What a film regeneration knows about the parts deleted by hand (pure; the server's filmRegeneration and the test double both use
 * it, so they cannot drift): the run's slot records whose clip is gone (none with restoreRemoved), what each deleted pick showed
 * (from params.picked, then params.removedPicks), the mix the run left (with music only when the run placed or kept it: a music
 * slot carried on as deleted is not among its createdIds) and how it was cut (FilmPlanContext.previousCut). Nothing is stored for
 * this beyond the optional params.removedPicks and params.cutOn of the run record (filmRunRecordParams).
 */
export function filmRegenerationRemoved(doc: ProjectDocument, run: RecipeRun, restoreRemoved = false): { removedSlots: SlotRecord[]; removedPicks: FilmRemovedPick[]; previousMusic: boolean; previousCut: NonNullable<FilmPlanContext['previousCut']> } {
  const slots = run.slots ?? [];
  const removedSlots = restoreRemoved ? [] : removedByHand(doc, slots);
  const known = new Map<string, FilmRemovedPick>();
  for (const r of filmRunRemovedPicks(run.params)) known.set(r.key, r);
  for (const k of filmRunPicked(run.params)) known.set(k.key, { key: k.key, assetId: k.assetId, windowIndex: typeof k.windowIndex === 'number' ? k.windowIndex : null });
  const removedPicks = removedSlots.flatMap((x) => { const k = known.get(x.key); return x.kind === 'picture' && k ? [k] : []; });
  const hadMusic = typeof run.params.musicAssetId === 'string';
  const musicSlot = slots.find((x) => x.kind === 'music');
  const previousMusic = hadMusic && (!musicSlot || run.createdIds.includes(musicSlot.clipId));
  const order = run.params.order === 'given' || run.params.order === 'arc' || run.params.order === 'capture' ? run.params.order : FILM_DEFAULTS.order;
  const target = run.params.targetSeconds === 30 || run.params.targetSeconds === 60 || run.params.targetSeconds === 90 ? run.params.targetSeconds : FILM_DEFAULTS.targetSeconds;
  return { removedSlots, removedPicks, previousMusic, previousCut: { targetSeconds: target, order, onMusicBars: hadMusic && (previousMusic || run.params.cutOn === 'removed-music') } };
}
