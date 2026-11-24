/**
 * The family film maker («סרט משפחתי בלחיצה», wave 5, ADR-0026): the shared contract of the pure planner (familyFilm.ts, W1),
 * the server (apps/server/src/familyFilm.ts: plan / apply / regenerate), the film UI (W3) and the agents. Heuristic: a
 * rule-based first cut from measurements (moments, beats, capture times); no model, no faces (no face model is approved).
 *
 * HOW A FILM ENTERS THE PROJECT: listed as recipe 'family-film' (RECIPES, recipes.ts; callable through the recipe routes and
 * the MCP recipe tools), planned by planFamilyFilm, and applied as ONE internal apply_template (templateOps.ts) with
 * templateId FAMILY_FILM_TEMPLATE_ID: ordinary public ops (add_track, add_clip, add_text, set_clip_fades, apply_motion_preset,
 * set_track_audio, set_ducking, fit_music), ONE transaction, ONE undo. The run record is an ordinary RecipeRun with recipeId
 * FAMILY_FILM_RUN_RECIPE_ID, its slots, and params = { ...resolved params, picked: FilmPicked[], templateVersion }. The server
 * strips `picked` and `templateVersion` before it parses a run's params again (regeneration). Regeneration keeps what was
 * edited by hand (content fingerprints, templates.ts keptByHand) and, unlike templates, a MOVED kept clip is kept, not refused.
 *
 * THE PLANNER'S RULES (the plan's section 5 with the verifier's corrections, which win; W1 implements them):
 * - Frame to time only through sourceTimeOfFrame (speed.ts); never T.frameTime(frame, rate) alone.
 * - Spans in beats: {m/2 when the meter m is even, m, 2m, 4m} inside [FILM.minSlotSeconds, FILM.maxSlotSeconds]; when fewer than
 *   two remain, count on every second beat and say so in `basis`. Every boundary is a grid time snapped ONCE to the nearest frame;
 *   lengths are differences of snapped boundaries (ADR-0003). Cuts closer than flashGapFrames (ADR-0009) are merged (cuts_merged).
 * - Classes: A = both bases or a burst (one step longer); B = one basis, or flat with file.motion >= MOMENTS_GATES.activeMotionPermille
 *   (reason active_throughout); C = flat otherwise, unmeasured, or a still (one step shorter). 'arc' ranks by window values,
 *   else file values, else last. picks.include: never dropped for no_room; other C picks give way first, then spans shrink,
 *   else the plan warns longer_than_target.
 * - Sound: the mix is filmMix(ownSound, music chosen) (below). 'under' = gain FILM.ownGainUnder on the own-sound track WITH music;
 *   WITHOUT music 'under' is gain 1 (one basis line) and 'lead' emits no set_ducking. 'lead' with music: set_ducking FILM.duckDb
 *   on the music track; the existing ducking lowers the music under every sounding clip (engine audio.ts counts an untranscribed
 *   clip as speech throughout), so the music rises over stills and silent clips: the plan then warns lead_music_rises.
 * - Tracks: a track named in ctx.reuseTracks for its role (the previous run's, regeneration) is used again when it is unlocked;
 *   else a completely empty track of the kind with no audio settings; else add_track. Track settings follow the mix as it
 *   SOUNDS, not the parameter alone: a track made now gets set_track_audio only when filmMix(...).ownGain !== 1 and set_ducking
 *   only when duckDb !== null. A track reused from ctx.reuseTracks gets set_track_audio { gain } (own-sound track) only when
 *   ownGain differs from filmMix(ctx.previousOwnSound, ctx.previousMusic).ownGain, and set_ducking (music track; sourceTrackIds
 *   null turns it off) only when duckDb differs from the previous one or the own-sound track it ducks under is made now. So a
 *   level set by hand survives a regeneration that does not change the mix, and adding or removing music changes it. Without
 *   ctx.previousOwnSound a reused track counts as made now; an empty track with no audio settings counts as gain 1, no ducking.
 * - Keys: filmPickKey(assetId, ordinal) with the next free ordinal: a new pick never takes a key a kept slot holds.
 * - Regeneration: kept pictures are occupied intervals; a kept picture beyond the new target stays and the layout runs up to it
 *   (warning kept_by_hand with the real length). predicted.gapFrames counts frames without a picture over
 *   [first slot start, last slot end); the closing card lies outside that range.
 * - Reasons come from filmReasonsFor (below); at most 3 per pick; English text never contains best, score, quality or viral.
 * - Titles: ctx.title / ctx.closing (built by the server from life-line's live fields and the event); without them the text is
 *   fixed and the plan warns title_resolved_static. A FilmText with live: true is added as add_text { text, fields: true } (its
 *   text is in the field grammar: fields, plain braces doubled); live: false is added WITHOUT fields (no `fields`, no
 *   set_text_fields): its text is shown exactly as it is, so braces in an event name are never read as a field.
 *
 * CHILDREN'S DATA (ADR-0021 people section): the server plans from the document the credential may read (an agent without the
 * people scope: names only, no birth dates; peoplePrivacy.ts) and refuses (403 people_scope_required) a film whose opening or
 * closing text holds an {age:…} field for such a credential, so an agent cannot produce a film with ages. {name:…} is allowed.
 * FLASH SAFETY (ADR-0009): hard cuts only, at most one cut per FILM.minSlotSeconds and never closer than flashGapFrames; the
 * export's photosensitivity check runs on the result as on any export.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { RationalTimeSchema, type Asset, type ProjectDocument, type SlotRecord } from './schema.ts';
import type { PlannedSlot, TemplateStep } from './templateContract.ts';
import { MOMENTS_ALGO, MOMENTS_GATES, MOMENTS_MAX_ASSETS, MOMENTS_MAX_WINDOWS, videoFrames, type MomentWindow, type MomentsFile } from './momentsContract.ts';
import { sourceTimeOfFrame } from './speed.ts';

export const FAMILY_FILM_RECIPE_ID = 'family-film' as const;
/** apply_template.templateId (templateContract.ts pattern ^tpl\.[a-z0-9-]{1,40}$). */
export const FAMILY_FILM_TEMPLATE_ID = 'tpl.family-film' as const;
export const FAMILY_FILM_RUN_RECIPE_ID = 'template:tpl.family-film' as const;
export const FAMILY_FILM_VERSION = 1 as const;
export const FAMILY_FILM_METHOD = 'rule-based first cut from measurements (heuristic); no model' as const;
export const FAMILY_FILM_DRAFT_LABEL = { he: 'טיוטה ראשונה שנבנתה ממדידות ומכללים (היוריסטיקה), לא בינה מלאכותית', en: 'A first draft built from measurements and rules (heuristic), not an AI model' } as const;
/** Faces are not used: no face model is approved (ADR-0017). Said in the plan's basis and in the UI. */
export const FAMILY_FILM_FACES_NOTE = 'faces: not used (no approved face model)' as const;
export const FILM = {
  minSlotSeconds: 1.6, maxSlotSeconds: 6.5, leadIn: 0.4, fallbackBpm: 100, maxPicks: 48,
  ownGainUnder: 0.25, duckDb: 9, soundFadeSeconds: 0.1,
  titleMinSeconds: 2, closingMinSeconds: 2, closingMaxSeconds: 4, titleY: 0.28,
  secondWindowGapSeconds: 4, lowBeatConfidence: 0.5,
  /** Caps of a plan (apply_template's own limits). */
  maxOps: 2000, maxSlots: 400, maxSteps: 50, maxStepChars: 400, maxReasons: 3,
  /** The run record (params with picked) stays at most this many JSON bytes. */
  runRecordBytes: 16_000,
} as const;
/**
 * Thresholds of the reason wording (filmReasonsFor). A window's value at or above them is said as a number; below them it is not,
 * and a window none of whose moment values is said states measured_moment (its seconds) instead, so a measured pick always says why.
 */
export const FILM_REASON_RULES = { motionPermille: MOMENTS_GATES.activeMotionPermille, loudDb: 6, sharpRatio: 1.15 } as const;
/** Bind names the planner gives to what is not a pick. A pick key ('m' + 12 hex) never equals one of these. */
export const FILM_BINDS = { pictures: 'pictures-track', ownSound: 'own-sound-track', musicTrack: 'music-track', music: 'music', title: 'title', closing: 'closing' } as const;
/** Stable key of a pick: 'm' + first 12 hex of sha256(`${assetId}:${ordinal}`) (ordinal 0 = first window of that asset in the film). */
export type FilmPickKey = (assetId: string, ordinal: number) => string;
export const FILM_PICK_KEY = /^m[0-9a-f]{12}$/;

const AssetIds = z.array(z.string().min(1).max(64));
export const FamilyFilmParamsSchema = z.object({
  assetIds: AssetIds.min(1).max(MOMENTS_MAX_ASSETS).describe('Pictures and videos of the event, in any order'),
  event: z.object({ id: z.string().max(64).optional(), name: z.string().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict().nullable().optional(),
  targetSeconds: z.union([z.literal(30), z.literal(60), z.literal(90)]).optional().describe('default 60'),
  musicAssetId: z.string().min(1).max(64).nullable().optional().describe('A sound file of this project whose beats were measured (built-in music counts); null or absent = no music'),
  order: z.enum(['capture', 'given', 'arc']).optional().describe('default capture: by capture time; given: as listed; arc: calm first, the most active at two thirds'),
  ownSound: z.enum(['under', 'lead', 'mute']).optional().describe('default under: the clips\' own sound 12 dB under the music (full level without music); lead: the music is lowered 9 dB while a clip has sound; mute'),
  openingTitle: z.boolean().optional(), closingCard: z.boolean().optional(),
  openingText: z.string().min(1).max(200).optional(), closingText: z.string().min(1).max(200).optional(),
  picks: z.object({
    exclude: AssetIds.max(MOMENTS_MAX_ASSETS).optional(),
    /** Never dropped for lack of room («הכנסה»; «קליפ אחר» = exclude the current asset and include the chosen one). */
    include: AssetIds.max(MOMENTS_MAX_ASSETS).optional(),
    /** assetId -> index into that asset's candidate windows. Read with an own-property test (ids that name Object.prototype members find nothing). */
    window: z.record(z.string().min(1).max(64), z.number().int().min(0).max(MOMENTS_MAX_WINDOWS - 1)).optional(),
  }).strict().optional(),
  at: RationalTimeSchema.optional().describe('Frame-aligned start; default 0 on an empty main sequence, else the end of the last picture or title'),
  lang: z.enum(['he', 'en']).optional(), motion: z.enum(['full', 'none']).optional(),
}).strict();
export type FamilyFilmParams = z.infer<typeof FamilyFilmParamsSchema>;
export type ResolvedFilmParams = Required<Omit<FamilyFilmParams, 'event' | 'openingText' | 'closingText' | 'at' | 'picks' | 'musicAssetId'>>
  & Pick<FamilyFilmParams, 'event' | 'openingText' | 'closingText'>
  & { musicAssetId: string | null; at: z.infer<typeof RationalTimeSchema>; picks: { exclude: string[]; include: string[]; window: Record<string, number> } };
/** Defaults of the resolved params. */
export const FILM_DEFAULTS = { targetSeconds: 60, order: 'capture', ownSound: 'under', openingTitle: true, closingCard: true, lang: 'he', motion: 'full' } as const;

export const FILM_REASON_CODES = ['inner_motion', 'measured_moment', 'loud_sound', 'sound_burst', 'sharp', 'active_throughout', 'second_moment', 'chosen_by_you', 'past_clean_stretch', 'not_measured', 'no_clear_moment', 'default_middle', 'whole_clip', 'still'] as const;
export type FilmReasonCode = (typeof FILM_REASON_CODES)[number];
export interface FilmReason { code: FilmReasonCode; /** seconds inside the file, one decimal, for wording only */ fromSecond?: number; toSecond?: number; value?: number; unit?: 'permille' | 'db' | 'ratio' }
/** removed_by_hand (regeneration): a clip of this file in the last film was deleted by hand, so the file is left out (restoreRemoved brings it back). */
export const FILM_EXCLUSION_CODES = ['no_room', 'too_short', 'excluded_by_you', 'no_picture', 'kept_by_hand', 'removed_by_hand'] as const;
export interface FilmExclusion { assetId: string; code: (typeof FILM_EXCLUSION_CODES)[number]; details: Record<string, unknown> }
export const FILM_WARNING_CODES = ['shorter_than_target', 'longer_than_target', 'music_short', 'low_beat_confidence', 'not_measured', 'no_capture_time', 'mixed_orientation', 'cuts_merged', 'kept_by_hand', 'cut_off_grid_next_to_kept', 'title_resolved_static', 'kept_music_not_followable', 'lead_music_rises', 'pictures_missing', 'removed_by_hand', 'music_removed'] as const;
export type FilmWarningCode = (typeof FILM_WARNING_CODES)[number];
export interface FilmWarning { code: FilmWarningCode; message: string; details: Record<string, unknown> }
export interface FilmPick {
  key: string; assetId: string; order: number;
  startFrame: number; frames: number;                                  // project frames
  span: { count: number; unit: 'beat' | 'bar' } | null;                // null off the grid: next to a kept clip, or the first pick when music kept by hand was moved off the film start
  sourceInFrame: number | null; sourceFrames: number | null;           // asset frames; null for a still
  kind: 'measured' | 'default-middle' | 'whole-clip' | 'still';
  windowIndex: number | null; windowsAvailable: number;
  reasons: FilmReason[]; captureAt: string | null; ownSound: boolean;
}
/** What the run record keeps of a pick (params.picked), so "why this clip" survives a reload. */
export type FilmPicked = Pick<FilmPick, 'key' | 'assetId' | 'kind' | 'windowIndex' | 'reasons'>;

/**
 * A title of the film. `text` is what the title clip holds; `resolved` what it shows now, when the server could work it out.
 * live: true = `text` is in the field grammar (fields such as {hebrewDate}, plain braces doubled) and the title is added with
 * add_text fields: true; live: false = plain text shown as it is, added without fields.
 */
export interface FilmText { text: string; resolved: string | null; live: boolean }
export interface FilmKeptClip { key: string | null; clipId: string; assetId: string | null; kind: 'picture' | 'text' | 'music' | 'sound'; startFrame: number; endFrame: number }
/** Everything the planner needs that is not in the document. Built by the server from life-line and content-pack. */
export interface FilmPlanContext {
  /** Wall-clock capture per asset id (life line shownCapture: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss'; compare with events.ts compareWall), or null when unknown. */
  capture: Readonly<Record<string, string | null>>;
  title: FilmText | null; closing: FilmText | null;
  /** TEXT_PRESETS ids (content-pack); default 'title-card' / 'end-card'. */
  titleLookId?: string; closingLookId?: string;
  /** Regeneration: clips of the previous run kept by hand (fingerprint changed) and their link partners. */
  kept?: readonly FilmKeptClip[];
  /** Regeneration: the keys of the slots the kept clips hold (a new pick never takes one). */
  keptKeys?: readonly string[];
  /**
   * Regeneration: the keys of the last film's slots whose clip was deleted by hand (the slot record names a clip no longer in the
   * document; derived, never stored as a flag). Not made again: a pick's file is left out (exclusion removed_by_hand), a title,
   * closing card or music is not placed; warning removed_by_hand says so and an alternative offers restoreRemoved.
   */
  removedKeys?: readonly string[];
  /**
   * Regeneration: what each pick deleted by hand showed (from the run record: params.picked, then params.removedPicks). A pick
   * with a window leaves out only that window when its file has another one to give; a pick without one (a still, an unmeasured
   * or flat video: the file's only possible pick) leaves the file out. A removed pick key this list does not name leaves its file out.
   */
  removedPicks?: readonly FilmRemovedPick[];
  /**
   * Regeneration: how the last film was cut. onMusicBars: on the bars of its music (placed by the run, kept by hand, or deleted by
   * hand and still followed). With the music deleted by hand, the cuts stay on its bars while the length and order are unchanged.
   */
  previousCut?: { targetSeconds: number; order: ResolvedFilmParams['order']; onMusicBars: boolean };
  /** Regeneration: tracks the previous run made, by role (the server finds them from the run's slots), used again when unlocked. */
  reuseTracks?: { pictures?: string; ownSound?: string; musicTrack?: string };
  /** Regeneration: the previous run's ownSound; with previousMusic it gives the mix the reused tracks were set to (filmMix). */
  previousOwnSound?: ResolvedFilmParams['ownSound'];
  /** Regeneration: whether the previous run had music (its musicAssetId was not null). */
  previousMusic?: boolean;
}
export class FilmError extends Error {
  constructor(public code: 'not_found' | 'needs_analysis' | 'invalid_args' | 'nothing_to_do', message: string, public hint?: string) { super(message); }
}
export interface FamilyFilmPlan {
  recipeId: typeof FAMILY_FILM_RECIPE_ID; templateId: typeof FAMILY_FILM_TEMPLATE_ID; version: typeof FAMILY_FILM_VERSION;
  params: ResolvedFilmParams;
  steps: string[]; basis: string[];                                     // <= FILM.maxSteps entries of <= FILM.maxStepChars characters
  warnings: FilmWarning[]; blocking: FilmWarning[];                     // blocking non-empty = apply refuses (409 film_blocked)
  /** restoreRemoved: the choice to regenerate again with what was deleted by hand made again (warning removed_by_hand). */
  alternatives: { label: string; params: Partial<FamilyFilmParams>; restoreRemoved?: true }[];
  picks: FilmPick[]; excluded: FilmExclusion[];
  /** Videos among the picks with no moments record of MOMENTS_ALGO: the dialog and agents measure these first. */
  needsMeasurement: string[];
  /**
   * Regeneration with the music deleted by hand: what the cuts were placed on ('removed-music': its bars, as before; 'steady': a
   * steady grid, because another length or order was asked for). Absent otherwise. The run record keeps it (params.cutOn).
   */
  musicRemoved?: { cutOn: 'removed-music' | 'steady' };
  ops: TemplateStep[]; slots: PlannedSlot[];
  predicted: { startFrame: number; endFrame: number; cuts: number[]; offGridCuts: number[]; gapFrames: number; seconds: number; targetSeconds: number };
  method: typeof FAMILY_FILM_METHOD;
}
/** Pure. Throws FilmError. Implemented by W1 in familyFilm.ts (planFamilyFilm). */
export type PlanFamilyFilm = (doc: ProjectDocument, params: unknown, ctx: FilmPlanContext) => FamilyFilmPlan;

export type FamilyFilmPlanView = Omit<FamilyFilmPlan, 'ops' | 'slots'> & { revision: number; operations: number; label: typeof FAMILY_FILM_DRAFT_LABEL; note: string };
export interface FamilyFilmApplyResult { revision: number; runId: string; createdIds: string[]; slots: SlotRecord[]; steps: string[]; warnings: FilmWarning[]; picks: FilmPick[]; excluded: FilmExclusion[] }
/**
 * removed: the keys of the last film's slots deleted by hand that this regeneration left out (empty with restoreRemoved);
 * alternatives: the plan's, among them the explicit choice to restore them ({restoreRemoved: true}).
 */
export interface FamilyFilmRegenerateResult extends FamilyFilmApplyResult { replaced: number; protected: string[]; removed: string[]; alternatives: FamilyFilmPlan['alternatives'] }
/**
 * The mix a film sounds with: the own-sound track's gain and the music track's ducking (null = none). 'under' lowers the clips
 * only under music; 'lead' ducks only music; 'mute' adds no own sound (gain 1, no ducking). Pure.
 */
export function filmMix(ownSound: ResolvedFilmParams['ownSound'], music: boolean): { ownGain: number; duckDb: number | null } {
  return { ownGain: music && ownSound === 'under' ? FILM.ownGainUnder : 1, duckDb: music && ownSound === 'lead' ? FILM.duckDb : null };
}
/** The run's params without what the run record adds (picked, removedPicks, cutOn, templateVersion), ready to parse with FamilyFilmParamsSchema. */
export function filmRunParams(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { picked: _p, removedPicks: _r, cutOn: _c, templateVersion: _v, ...rest } = params;
  return rest;
}
/** A pick of the film deleted by hand: its key, its file and the window it showed (null: the file's only possible pick). */
export interface FilmRemovedPick { key: string; assetId: string; windowIndex: number | null }
/** The picks deleted by hand a run record carries on (params.removedPicks), or []. Never throws. */
export function filmRunRemovedPicks(params: Readonly<Record<string, unknown>>): FilmRemovedPick[] {
  const p = Object.hasOwn(params, 'removedPicks') ? params.removedPicks : undefined;
  return Array.isArray(p) ? p.filter((x): x is FilmRemovedPick => !!x && typeof x === 'object' && typeof x.key === 'string' && typeof x.assetId === 'string' && (x.windowIndex === null || Number.isInteger(x.windowIndex))).map((x) => ({ key: x.key, assetId: x.assetId, windowIndex: x.windowIndex })) : [];
}
/**
 * The params a film run records (the server and the test double): the plan's params, the picks (picked, so "why this clip"
 * survives a reload), and, only when there are any, the picks deleted by hand that the run carries on (removedPicks) and what
 * the cuts followed after the music was deleted by hand (cutOn). Both are optional additions: a record without them reads as before.
 */
export function filmRunRecordParams(plan: Pick<FamilyFilmPlan, 'params' | 'picks' | 'musicRemoved'>, removedPicks: readonly FilmRemovedPick[]): Record<string, unknown> {
  const picked: FilmPicked[] = plan.picks.map((k) => ({ key: k.key, assetId: k.assetId, kind: k.kind, windowIndex: k.windowIndex, reasons: k.reasons }));
  return { ...plan.params, picked, ...(removedPicks.length ? { removedPicks: removedPicks.map((r) => ({ ...r })) } : {}), ...(plan.musicRemoved ? { cutOn: plan.musicRemoved.cutOn } : {}) };
}
/** The picks a run record keeps (params.picked), or [] for a record without them. Never throws. */
export function filmRunPicked(params: Readonly<Record<string, unknown>>): FilmPicked[] {
  const p = Object.hasOwn(params, 'picked') ? params.picked : undefined;
  return Array.isArray(p) ? (p.filter((x) => x && typeof x === 'object' && typeof (x as FilmPicked).assetId === 'string' && typeof (x as FilmPicked).key === 'string') as FilmPicked[]) : [];
}

// ---------- reasons (lead; the planner and the inspector's «למה» both use this) ----------
/** The moments record of a document (analyses[id].moments), as filmReasonsFor reads it. */
export interface FilmMomentsRecord { algo: number; flat: boolean; file: MomentsFile; windows: readonly MomentWindow[] }
const sec = (asset: Pick<Asset, 'video'>, frame: number) => Math.round(T.toSeconds(sourceTimeOfFrame(asset, frame)) * 10) / 10;
/**
 * Why the clip shows what it shows, from measured values only: at most FILM.maxReasons reasons for a clip of `asset` reading
 * source frames [sourceInFrame, sourceInFrame + sourceFrames). Pure; never a score.
 * - a still: [still];
 * - no record of MOMENTS_ALGO: [not_measured] (+ default_middle when the clip sits in the middle of the file, + whole_clip);
 * - a flat record: [active_throughout] when file.motion >= FILM_REASON_RULES.motionPermille, else [no_clear_moment] (+ default_middle);
 * - otherwise the window whose core (peak +- coreSeconds) the clip covers most (lowest index on ties): inner_motion (its motion, seconds of the moment),
 *   sound_burst (the burst inside the clip) or loud_sound (level), past_clean_stretch (the clip reads outside the clean stretch),
 *   sharp, whole_clip — in that order, cut to FILM.maxReasons. When none of inner_motion, sound_burst and loud_sound is said
 *   (a quiet file: its windows are found against its own 20th percentile, so their values can lie under FILM_REASON_RULES),
 *   measured_moment (seconds of the moment, no value) takes their place, first: a clip on a measured window always has a reason;
 * - the clip covers no window's core: [] (it shows none of the measured moments, e.g. after a hand edit).
 * `opts.chosenByYou` / `opts.second` put chosen_by_you / second_moment first (the planner knows them, the clip does not).
 */
export function filmReasonsFor(asset: Pick<Asset, 'kind' | 'video' | 'duration'>, record: FilmMomentsRecord | null | undefined, sourceInFrame: number, sourceFrames: number, opts: { chosenByYou?: boolean; second?: boolean } = {}): FilmReason[] {
  if (asset.kind === 'image' || !asset.video) return [{ code: 'still' }];
  const frames = videoFrames(asset)!;
  const from = Math.max(0, sourceInFrame), to = Math.min(frames, sourceInFrame + Math.max(0, sourceFrames));
  const whole = from === 0 && to >= frames;
  const middle = Math.floor((frames - (to - from)) / 2);
  const head: FilmReason[] = [...(opts.chosenByYou ? [{ code: 'chosen_by_you' as const }] : []), ...(opts.second ? [{ code: 'second_moment' as const }] : [])];
  const cut = (list: FilmReason[]) => [...head, ...list].slice(0, FILM.maxReasons);
  const tail = (): FilmReason[] => (whole ? [{ code: 'whole_clip' }] : from === middle ? [{ code: 'default_middle' }] : []);
  if (!record || record.algo !== MOMENTS_ALGO) return cut([{ code: 'not_measured' }, ...tail()]);
  if (record.flat || record.windows.length === 0) {
    if (record.file.motion !== null && record.file.motion >= FILM_REASON_RULES.motionPermille) return cut([{ code: 'active_throughout', value: record.file.motion, unit: 'permille' }, ...(whole ? [{ code: 'whole_clip' as const }] : [])]);
    return cut([{ code: 'no_clear_moment' }, ...tail()]);
  }
  // the moment the clip shows: the window whose core (peak ± coreSeconds, inside its clean stretch) the clip covers most (lowest
  // index on ties). Two windows can share one clean stretch, so overlap with the stretch alone would name a moment the clip
  // does not show, with seconds outside it. A clip that covers no window's core shows none of the measured moments.
  const rate = asset.video.frameRate;
  const core = Math.round((MOMENTS_GATES.coreSeconds * rate.num) / rate.den);
  const coreOf = (w: MomentWindow) => [Math.max(w.fromFrame, w.peakFrame - core, from), Math.min(w.toFrame, w.peakFrame + core, to)] as const;
  let best = -1, overlap = 0;
  record.windows.forEach((w, i) => { const [p, q] = coreOf(w); if (q - p > overlap) { overlap = q - p; best = i; } });
  if (best < 0) return head.slice(0, FILM.maxReasons);
  const w = record.windows[best]!;
  const [a, b] = coreOf(w);
  const out: FilmReason[] = [];
  if (w.basis.includes('inner-motion') && w.motion !== null && w.motion >= FILM_REASON_RULES.motionPermille) out.push({ code: 'inner_motion', fromSecond: sec(asset, a), toSecond: sec(asset, b), value: w.motion, unit: 'permille' });
  if (w.burstFrame !== undefined && w.burstFrame >= from && w.burstFrame < to) out.push({ code: 'sound_burst', fromSecond: sec(asset, w.burstFrame) });
  else if (w.basis.includes('sound') && w.level !== null && w.level >= FILM_REASON_RULES.loudDb) out.push({ code: 'loud_sound', value: Math.round(w.level * 10) / 10, unit: 'db' });
  if (out.length === 0) out.push({ code: 'measured_moment', fromSecond: sec(asset, a), toSecond: sec(asset, b) });
  if (from < w.fromFrame || to > w.toFrame) out.push({ code: 'past_clean_stretch' });
  if (w.sharp !== null && w.sharp >= FILM_REASON_RULES.sharpRatio) out.push({ code: 'sharp', value: Math.round(w.sharp * 100) / 100, unit: 'ratio' });
  if (whole) out.push({ code: 'whole_clip' });
  return cut(out);
}
/** Words the plan text, the reasons and the film strings never use (wave4-decisions: no score, no "best"). */
export const FILM_FORBIDDEN_WORDS = /\b(best|score|scores|scored|quality|viral)\b/i;
export const FILM_FORBIDDEN_WORDS_HE = /ציון|הכי טוב|הטוב ביותר/;
