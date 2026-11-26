/**
 * «ספרו מה היה» — tell what happened (wave 7 story track; .artifacts/wave7/story-decisions.md, binding over story-plan.md): the
 * shared contract of the pure planner (story.ts, W1), the voice measurement (voiceActivity.ts, W1), the server
 * (apps/server/src/story.ts W2, apps/server/src/storyRegeneration.ts W1), the interface (apps/web/src/editor/story/, W3) and agents.
 * LEAD: frozen; builders report a needed change to the lead.
 *
 * HOW A STORY ENTERS THE PROJECT: listed as recipe 'story' (RECIPES, recipes.ts; the recipe routes and MCP recipe tools), planned
 * by planStory and applied as ONE internal apply_template with templateId STORY_TEMPLATE_ID: ordinary public ops (add_track,
 * add_clip, set_clip_fades, apply_motion_preset, set_track_audio, set_ducking, fit_music, add_text), ONE transaction, ONE undo.
 * The run is an ordinary RecipeRun with recipeId STORY_RUN_RECIPE_ID, its slots, its ranges, and params =
 * storyRunRecordParams(plan, removedPicks) (+ templateVersion, added by apply_template). No schema field, no new op, no engine
 * change: the music is ducked under the narration for its whole length (an untranscribed clip is speech throughout, engine
 * audio.ts); a transcript, when one exists, already makes the duck follow its phrases.
 *
 * THE PLANNER'S RULES (W1; the plan's §4.2 with the verifier's corrections C1, C2, C8, C12, C13):
 * - Times: taps are whole milliseconds of the narration's SOURCE time (the coordinate of clip.sourceIn); source ms → timeline time
 *   through the narration clip as it lies → ONE T.nearestFrameIndex. Constants are integers (STORY); never float seconds in
 *   arithmetic; lengths are differences of snapped boundaries (ADR-0003).
 * - Cuts: sorted, de-duplicated taps; then, for pictures without a cut, pause cuts (the nearest unused voice onset within
 *   min(a third of a part, STORY.pauseReachMs) of an even boundary of the last segment) else even cuts. A cut outside the narration
 *   is held outside_narration; closer than flashGapFrames(fps) to the start, the end or the cut before is held too_close; inside a
 *   picture kept by hand is held kept_by_hand; taps beyond the last picture are held no_picture_left. Parts shorter than
 *   STORY.minAutoMs leave the last pictures out (no_room, named).
 * - Per pick record (C1): picked[i] = { key, assetId, cutMs, how }. A first build records every cut. A regeneration reuses each
 *   surviving pick's recorded cut; a removed pick's cut goes with it (the picture before runs on) and its record travels in
 *   params.removedPicks; restoreRemoved puts it back at its cut. A regeneration whose cutsMs differ from the run's is refused by
 *   the server (409 story_retap_not_built): tapping again on an applied story is not in version 1.
 * - Regeneration (C2, apps/server/src/storyRegeneration.ts): runHandEdits(…, 'any-move'); fill rule next to a kept clip (warning
 *   filled_next_to_kept); the narration clip is always kept and read as it lies; deleted → blocking narration_removed; reversed
 *   or at another speed → blocking kept_narration_not_followable.
 * - Videos: the film's source window (familyFilm.ts filmSourceWindow); a video shorter than its slot plays whole and the next
 *   picture starts at its end (clip_ended_early) — that boundary is a cut and obeys the flash gap; a video whose capacity is under
 *   the flash gap is left out (too_short).
 * - Sound: narration on the voice track (bind 'narration', slot kind 'sound'); the clips' own sound on the own-sound track at
 *   STORY.ownGainUnder whenever ownSound is 'under' (the story's own rule: the narration leads, music or not; said in basis);
 *   music (a sound file of the project) fitted with fit_music to the narration's end + STORY.tailMs and ducked STORY.duckDb under
 *   the voice track (set_ducking). A level set by hand on a reused track survives a regeneration that does not change the mix.
 * - Live picture (storyLiveDocument): the same cut rule (a held tap changes nothing on screen), own sound muted, the narration and
 *   music clips with the same ids on every call (deterministic idSeed), so the sound plan never changes while tapping.
 * - Every plan carries STORY_DRAFT_LABEL; no string says synced, perfect, best, score or calls the story AI.
 *
 * CHILDREN'S DATA: the narration is the family's voice. It stays on the machine, is never part of the language assistant's
 * summary, and an agent never records (the recorder is the owner's browser). The server plans from the document the credential
 * may read (names only without the people scope) and refuses (403 people_scope_required) a title with an {age:…} field.
 * FLASH SAFETY (ADR-0009): hard cuts only, never closer than flashGapFrames, in the result and in the live picture.
 */
import { z } from 'zod';
import { RationalTimeSchema, type ProjectDocument, type SlotRecord } from './schema.ts';
import type { PlannedSlot, TemplateStep } from './templateContract.ts';
import { FamilyFilmParamsSchema, FILM, FILM_BINDS, FILM_FORBIDDEN_WORDS, FILM_FORBIDDEN_WORDS_HE, type FilmKeptClip, type FilmReason, type FilmText, type ResolvedFilmParams } from './familyFilmContract.ts';

export const STORY_RECIPE_ID = 'story' as const;
/** apply_template.templateId (templateContract.ts pattern ^tpl\.[a-z0-9-]{1,40}$). */
export const STORY_TEMPLATE_ID = 'tpl.story' as const;
export const STORY_RUN_RECIPE_ID = 'template:tpl.story' as const;
export const STORY_VERSION = 1 as const;
export const STORY_METHOD = 'cuts from the taps and a level measurement of the voice (heuristic); no model, no speech recognition' as const;
export const STORY_DRAFT_LABEL = { he: 'טיוטה שנבנתה מההקשות וממדידות (היוריסטיקה), לא בינה מלאכותית', en: 'A draft built from your taps and measurements (heuristic), not an AI model' } as const;
/** The voice measurement is a level measurement, never speech recognition (said wherever its numbers are shown). */
export const VOICE_LABEL = { he: 'מדידת עוצמה, לא זיהוי דיבור', en: 'A level measurement, not speech recognition' } as const;

/** Integers only (C12): milliseconds, decibels, counts. Frames come from one T.nearestFrameIndex of a rational built from them. */
export const STORY = {
  maxPictures: 200, maxCuts: 400, maxNarrationMs: 20 * 60_000,
  duckDb: 12, duckAttackMs: 200, duckReleaseMs: 800, ownGainUnder: FILM.ownGainUnder,
  tailMs: 500, minAutoMs: 1500, fadeMs: 100, pauseReachMs: 1500,
  /** Plan and apply wait at most this long for the narration's waveform row (moments.ts waitForRow precedent), then voice_pending. */
  waitWaveformMs: 5000,
  /** The recorder stops by itself after this many milliseconds of samples. */
  maxRecordMs: 600_000,
  /** Caps of a plan (apply_template's limits: 2000 ops, 400 slots, 50 steps). */
  maxOps: FILM.maxOps, maxSteps: FILM.maxSteps, maxStepChars: FILM.maxStepChars,
  /** The run record (params with picked and removedPicks) stays at most this many JSON bytes. */
  runRecordBytes: 32_000,
} as const;

/** The voice measurement (voiceActivity.ts, W1). Peaks: level 0 of the waveform derivative, min/max per 256 samples of a mono 48 kHz decode. */
export const VOICE_ALGO = 1 as const;
export const VOICE_RATE = 48_000 as const;
/**
 * The rule's figures (plan §4.1 with C6). Percentiles follow multicamAuto.ts where they mean the same thing (floor = 10th
 * percentile of the frames; speech = 90th percentile of the frames above the floor); W1 states in voiceActivity.ts which figure is
 * which. noiseClamp: the floor never goes below 16 (about −66 dBFS), so digital silence (true zeros) still gives thresholds above 0.
 */
export const VOICE_RULES = {
  samplesPerBucket: 256, frameBuckets: 4, floorPct: 10, speechPct: 90, noiseClamp: 16,
  /** flat when speech < flatRatio × noise (about 12 dB) or speech < flatMin (−40 dBFS of 32768). */
  flatRatio: 4, flatMin: 328,
  holdMs: 350, minRangeMs: 120, padBeforeMs: 60, padAfterMs: 120, maxRanges: 2000,
} as const;
/**
 * Where the voice sounds in a file: ranges in SOURCE samples at VOICE_RATE, counted from the editor's time zero of the file (the
 * coordinate of clip.sourceIn; the waveform is decoded from the file's own start, derive.ts). Never stored in the document (cut 4):
 * the server computes it on every plan, apply and regeneration and passes it in StoryPlanContext. noiseDb10 / voiceDb10: tenths of
 * dBFS, for display only (computed once, so a replay never recomputes a logarithm).
 */
export interface VoiceMeasure {
  algo: typeof VOICE_ALGO;
  noiseDb10: number; voiceDb10: number;
  /** true: no usable contrast; ranges empty; every automatic cut is even (warning voice_flat with both levels). */
  flat: boolean;
  ranges: { start: number; end: number }[];
  truncated?: true;
}
/** The onsets of a measure: the start of every range that follows a pause (the first range's start too), in source samples. Pure. */
export function voiceOnsets(m: Pick<VoiceMeasure, 'ranges' | 'flat'> | null | undefined): number[] {
  return m && !m.flat ? m.ranges.map((r) => r.start) : [];
}

/** Bind names: the film's (title, music, the three track roles) plus the narration and its track. A pick key never equals one. */
export const STORY_BINDS = { ...FILM_BINDS, narration: 'narration', voiceTrack: 'voice-track' } as const;

const Id = z.string().min(1).max(64);
const AssetIds = z.array(Id);
export const StoryParamsSchema = z.object({
  narrationAssetId: Id.describe('A sound file of this project: the recording or a voice memo'),
  assetIds: AssetIds.min(1).max(STORY.maxPictures).describe('Pictures and videos IN SHOW ORDER'),
  cutsMs: z.array(z.number().int().min(0).max(STORY.maxNarrationMs)).max(STORY.maxCuts).optional()
    .describe('Taps: whole milliseconds of the narration\'s source time; tap i starts picture i+1. Absent or empty: cuts at measured pauses, else even'),
  musicAssetId: Id.nullable().optional().describe('A sound file of this project; null or absent = no music. Ducked under the narration for its whole length'),
  ownSound: z.enum(['under', 'mute']).optional().describe('default under: the clips\' own sound 12 dB under the narration'),
  event: FamilyFilmParamsSchema.shape.event,
  openingTitle: z.boolean().optional(),
  openingText: z.string().min(1).max(200).optional(),
  picks: z.object({
    exclude: AssetIds.max(STORY.maxPictures).optional(),
    /** assetId -> index into that video's measured windows (own-property lookups). */
    window: z.record(Id, z.number().int().min(0)).optional(),
  }).strict().optional(),
  at: RationalTimeSchema.optional().describe('Frame-aligned start; default 0 on an empty main sequence, else the end of the last picture or title'),
  lang: z.enum(['he', 'en']).optional(), motion: z.enum(['full', 'none']).optional(),
}).strict();
export type StoryParams = z.infer<typeof StoryParamsSchema>;
export const STORY_DEFAULTS = { ownSound: 'under', openingTitle: true, lang: 'he', motion: 'full' } as const;
export type ResolvedStoryParams = Required<Pick<StoryParams, 'ownSound' | 'openingTitle' | 'lang' | 'motion'>>
  & Pick<StoryParams, 'event' | 'openingText'>
  & { narrationAssetId: string; assetIds: string[]; cutsMs: number[]; musicAssetId: string | null; at: z.infer<typeof RationalTimeSchema>; picks: { exclude: string[]; window: Record<string, number> } };

/** How a pick's cut was made. 'first': the first picture (no cut; starts with the narration). */
export const STORY_CUT_HOW = ['tap', 'pause', 'even', 'first'] as const;
export type StoryCutHow = (typeof STORY_CUT_HOW)[number];
/** What the run record keeps of a pick (params.picked; also params.removedPicks for the picks deleted by hand). */
export interface StoryPicked { key: string; assetId: string; cutMs: number | null; how: StoryCutHow }
export interface StoryPick extends StoryPicked {
  order: number;
  startFrame: number; frames: number;                                   // project frames
  sourceInFrame: number | null; sourceFrames: number | null;            // asset frames; null for a still
  kind: 'measured' | 'default-middle' | 'whole-clip' | 'still';
  windowIndex: number | null;
  reasons: FilmReason[];
  /** A video shorter than its slot: it plays whole and the next picture starts at its end (warning clip_ended_early). */
  endedEarly?: true;
  ownSound: boolean;
}
export const STORY_HELD_REASONS = ['too_close', 'no_picture_left', 'outside_narration', 'kept_by_hand'] as const;
export type StoryHeldReason = (typeof STORY_HELD_REASONS)[number];
/** One per tap of the request, in sorted order: kept (it made a cut at `frame`) or held with its reason. */
export interface StoryChip { index: number; cutMs: number; state: 'kept' | 'held'; reason?: StoryHeldReason; frame?: number }

export const STORY_WARNING_CODES = ['auto_cuts', 'voice_flat', 'voice_pending', 'voice_no_sound', 'clip_ended_early', 'pictures_end_before_voice', 'music_short', 'kept_by_hand', 'removed_by_hand', 'moved_back', 'filled_next_to_kept', 'not_measured', 'title_resolved_static', 'mixed_orientation'] as const;
export type StoryWarningCode = (typeof STORY_WARNING_CODES)[number];
export const STORY_BLOCKING_CODES = ['narration_removed', 'kept_narration_not_followable'] as const;
export type StoryBlockingCode = (typeof STORY_BLOCKING_CODES)[number];
export interface StoryWarning { code: StoryWarningCode | StoryBlockingCode; message: string; details: Record<string, unknown> }
/** The fixed English of the two blocking lines (Hebrew: i18n story.ts). */
export const STORY_BLOCKING_TEXT: Record<StoryBlockingCode, string> = {
  narration_removed: 'the narration was deleted by hand; restore it to build again',
  kept_narration_not_followable: 'the narration kept by hand plays backwards or at another speed, so the pictures cannot follow it',
};
export const STORY_EXCLUSION_CODES = ['no_room', 'too_short', 'excluded_by_you', 'no_picture', 'kept_by_hand', 'removed_by_hand'] as const;
export interface StoryExclusion { assetId: string; code: (typeof STORY_EXCLUSION_CODES)[number]; details: Record<string, unknown> }

/** Everything the planner needs that is not in the document. Built by the server; the plan view carries it, so the browser plans the ghost with the same inputs (C3). */
export interface StoryPlanContext {
  /** The narration's voice measure, or null with voiceState saying why. */
  voice: VoiceMeasure | null;
  /** measured: `voice` is set (flat or not); pending: the waveform was not ready within STORY.waitWaveformMs; no_sound: the file has no sound track to measure. */
  voiceState: 'measured' | 'pending' | 'no_sound';
  /** Wall-clock capture per asset id (life line shownCapture), or null when unknown. */
  capture: Readonly<Record<string, string | null>>;
  title: FilmText | null;
  titleLookId?: string;
  // ---- regeneration only (apps/server/src/storyRegeneration.ts) ----
  /** The run's picks with their recorded cuts (params.picked), used for every surviving pick. */
  picked?: readonly StoryPicked[];
  /** Clips of the previous run kept by hand (any change but a move in time) and their link partners. */
  kept?: readonly FilmKeptClip[];
  keptKeys?: readonly string[];
  /** Keys of slots whose clip was deleted by hand; removedPicks: their records (cuts travel with them). */
  removedKeys?: readonly string[];
  removedPicks?: readonly StoryPicked[];
  /** Keys of the pictures that were only moved in time (C2 'any-move'): placed again on their recorded cuts (warning moved_back). */
  movedKeys?: readonly string[];
  /** The narration clip of the run, as it lies now (it is never made again). */
  narrationClipId?: string;
  reuseTracks?: { pictures?: string; ownSound?: string; musicTrack?: string; voiceTrack?: string };
  previousOwnSound?: ResolvedStoryParams['ownSound'];
  previousMusic?: boolean;
}
export class StoryError extends Error {
  constructor(public code: 'not_found' | 'incompatible' | 'out_of_bounds' | 'nothing_to_do' | 'invalid_args' | 'not_built', message: string, public hint?: string) { super(message); }
}
/** Thrown by a stub that is not built yet (never a made-up value). */
export class StoryNotBuilt extends StoryError {
  constructor(what: string) { super('not_built', STORY_REFUSALS.notBuilt.message(), `${what}: not built in this build yet`); }
}
/** The planner's refusals: code and fixed English sentence (Hebrew with the next step: i18n story.ts HE_STORY). */
export const STORY_REFUSALS = {
  narrationMissing: { code: 'not_found', message: () => 'the narration file is not in this project' },
  narrationNotSound: { code: 'incompatible', message: () => 'the narration must be a sound file' },
  narrationTooLong: { code: 'out_of_bounds', message: () => 'the narration is longer than 20 minutes' },
  nothingToShow: { code: 'nothing_to_do', message: () => 'none of the chosen files can be shown' },
  badParams: { code: 'invalid_args', message: (why: string) => `the story parameters are not valid: ${why}` },
  notBuilt: { code: 'not_built', message: () => 'telling a story is not built in this version yet' },
} as const satisfies Record<string, { code: StoryError['code']; message: (...a: never[]) => string }>;
export type StoryRefusalKey = keyof typeof STORY_REFUSALS;
export function storyRefusal<K extends StoryRefusalKey>(key: K, ...args: Parameters<(typeof STORY_REFUSALS)[K]['message']>): StoryError {
  const r = STORY_REFUSALS[key];
  return new StoryError(r.code, (r.message as (...a: unknown[]) => string)(...args));
}

export interface StoryPlan {
  recipeId: typeof STORY_RECIPE_ID; templateId: typeof STORY_TEMPLATE_ID; version: typeof STORY_VERSION;
  params: ResolvedStoryParams;
  steps: string[]; basis: string[];
  warnings: StoryWarning[]; blocking: StoryWarning[];
  alternatives: { label: string; params: Partial<StoryParams>; restoreRemoved?: true }[];
  picks: StoryPick[]; excluded: StoryExclusion[]; chips: StoryChip[];
  ops: TemplateStep[]; slots: PlannedSlot[];
  predicted: { startFrame: number; endFrame: number; cuts: number[]; tapCuts: number; pauseCuts: number; evenCuts: number; gapFrames: number; seconds: number };
  narration: { seconds: number; onsetsMs: number[]; measured: boolean };
  method: typeof STORY_METHOD;
}
/** Pure. Throws StoryError. Implemented by W1 in story.ts (planStory). */
export type PlanStory = (doc: ProjectDocument, params: unknown, ctx: StoryPlanContext) => StoryPlan;

/** The plan view: no ops (C3); the context the server planned with, so the browser can plan the ghost identically. */
export type StoryPlanView = Omit<StoryPlan, 'ops' | 'slots'> & { revision: number; operations: number; label: typeof STORY_DRAFT_LABEL; note: string; context: StoryPlanContext };
export interface StoryApplyResult { revision: number; runId: string; createdIds: string[]; slots: SlotRecord[]; steps: string[]; warnings: StoryWarning[]; picks: StoryPick[]; excluded: StoryExclusion[]; chips: StoryChip[]; predicted: StoryPlan['predicted'] }
export interface StoryRegenerateResult extends StoryApplyResult { replaced: number; protected: string[]; removed: string[]; movedBack: string[]; alternatives: StoryPlan['alternatives'] }

/** The own-sound gain of a story: ownSound 'under' lowers the clips under the narration whether or not there is music. Pure. */
export function storyMix(ownSound: ResolvedStoryParams['ownSound'], music: boolean): { ownGain: number; duckDb: number | null } {
  return { ownGain: ownSound === 'under' ? STORY.ownGainUnder : 1, duckDb: music ? STORY.duckDb : null };
}

const isPicked = (x: unknown): x is StoryPicked => !!x && typeof x === 'object' && typeof (x as StoryPicked).key === 'string' && typeof (x as StoryPicked).assetId === 'string'
  && ((x as StoryPicked).cutMs === null || Number.isInteger((x as StoryPicked).cutMs)) && STORY_CUT_HOW.includes((x as StoryPicked).how);
const copyPicked = (x: StoryPicked): StoryPicked => ({ key: x.key, assetId: x.assetId, cutMs: x.cutMs, how: x.how });
/** The run's params without what the record adds (picked, removedPicks, templateVersion), ready for StoryParamsSchema. */
export function storyRunParams(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { picked: _p, removedPicks: _r, templateVersion: _v, ...rest } = params;
  return rest;
}
/** The picks a run record keeps (params.picked), or []. Never throws. */
export function storyRunPicked(params: Readonly<Record<string, unknown>>): StoryPicked[] {
  const p = Object.hasOwn(params, 'picked') ? params.picked : undefined;
  return Array.isArray(p) ? p.filter(isPicked).map(copyPicked) : [];
}
/** The picks deleted by hand that a run record carries on (params.removedPicks), or []. Never throws. */
export function storyRunRemovedPicks(params: Readonly<Record<string, unknown>>): StoryPicked[] {
  const p = Object.hasOwn(params, 'removedPicks') ? params.removedPicks : undefined;
  return Array.isArray(p) ? p.filter(isPicked).map(copyPicked) : [];
}
/** The params a story run records: the plan's params, every pick's cut (C1) and, only when there are any, the removed picks. */
export function storyRunRecordParams(plan: Pick<StoryPlan, 'params' | 'picks'>, removedPicks: readonly StoryPicked[]): Record<string, unknown> {
  return { ...plan.params, picked: plan.picks.map(copyPicked), ...(removedPicks.length ? { removedPicks: removedPicks.map(copyPicked) } : {}) };
}
/** Whether two tap lists are the same request (a regeneration with other taps is refused: story_retap_not_built). */
export function sameCuts(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  const x = [...new Set(a ?? [])].sort((p, q) => p - q), y = [...new Set(b ?? [])].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Words the story strings and plan text never use: the film's, plus "in sync" and "perfect" (nothing is called synced before the owner has looked). */
export const STORY_FORBIDDEN_WORDS = new RegExp(`${FILM_FORBIDDEN_WORDS.source}|\\b(synced|in sync|perfect|perfectly)\\b`, 'i');
export const STORY_FORBIDDEN_WORDS_HE = new RegExp(`${FILM_FORBIDDEN_WORDS_HE.source}|מסונכרן|מושלם|מדויק לגמרי`);
export type { ResolvedFilmParams };
