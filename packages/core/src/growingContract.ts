/**
 * «גדלים מול העיניים» — growing up before your eyes (wave 8 track `growing`; .artifacts/wave8/growing-plan.md, corrected by
 * growing-verify.md, which wins, and decisions.md). The shared contract of the pure planner (growing.ts, W1), the server
 * (apps/server/src/growing.ts, W2) and the interface (apps/web/src/editor/growing/, W3). LEAD: frozen after the pre-pass;
 * a builder who needs a change here reports it.
 *
 * WHAT IT MAKES: pictures of one child (stills, and single frames of videos as held frames: add_clip { freeze: true }) lined up
 * so that the two eyes the owner clicked land on the same two points of the frame, in capture order, each held a fixed number of
 * frames with an optional dissolve and an optional caption of live fields ({date}, {age:personId}) on dated pictures. Planned by
 * planGrowing and applied as ONE internal apply_template (templateId GROWING_TEMPLATE_ID) of ordinary public ops: add_track,
 * add_clip (freeze for a video frame), set_clip_transform, set_transition (dissolve only), add_text. ONE transaction, ONE undo.
 * The run is an ordinary RecipeRun with recipeId GROWING_RUN_RECIPE_ID.
 *
 * EYE MARKS ARE NEVER STORED (verifier C8, lead decision). There is no eyeMarks field, no op that writes marks, no entity kind,
 * no privacy axis. The marks live in the dialog's memory only (no browser storage) and travel ONCE, in the body of the owner-only
 * plan / apply / rebuild request (GrowingParams.picks[].eyes). What is stored is what the owner could set by hand: ordinary clip
 * transforms, and a run record (growingRunRecordParams) that holds the picks ({key, assetId, frame}), their order, and the settings
 * (hold, dissolve, face size, eye line, fill, caption choice, person) — NEVER a coordinate. A rebuild derives the marks of an
 * untouched pick from its clip's current transform (eyesFromTransform, the exact inverse of the solve); a pick edited by hand is
 * kept as it is; a pick deleted by hand needs marking again (refusal needs_marks names it). C7: the transforms give the eye
 * positions back exactly; the product says so (GROWING_PRIVACY_SENTENCE in i18n growing.ts), and never that they "never reach
 * an agent". Every growing route is the owner's own session only (403 owner_required), so no agent supplies eye points.
 *
 * COORDINATES (C4): an eye point is (u, v) in 0..1 of the picture AS SHOWN — after EXIF orientation, the size ingest records in
 * asset.image.width/height (asset.video.width/height for a video frame) — u to the right, v down; the same (u, v) that
 * geometry.ts sourceToFrame takes. The two points must be at least GROWING.minEyeShownPx apart in shown pixels.
 * Which eye is which (C10): the click order as sent (eyes[0] is placed on the frame's left target, eyes[1] on the right). The
 * dialog proposes the default order (suggestEyeOrder: the swap rule, |θ| > 90°) and S swaps; the planner never swaps.
 *
 * THE PLANNER'S RULES (W1; plan §4 with C11, C12): similarity transform per pick, centre without trigonometry (cos = Dx/|D|,
 * sin = −Dy/|D| through Math.sqrt), atan2 only for the stored degrees; each number rounded to 1e-6 once; transform bounds of
 * schema.ts TransformSchema (scale 0.01..20, |x|,|y| ≤ 4), else the pick is excluded outside_transform_range; magnification
 * m = scale·fitScale, m > GROWING.enlargedAbove warns enlarged with the number. Coverage: corner containment, 8 linear bounds in
 * 1/k about the eye midpoint (which must lie inside the picture, else cannot_cover_all); suggestedFaceSize re-checked against the
 * bounds. Time: integer frames (frameTime), cut_i = start + i·holdFrames, never accumulated; every hold ≥ flashGapFrames(fps),
 * a shorter request is refused (hold_too_short), never raised. Dissolve D = 0, ⌊hold/3⌋ or ⌊2·hold/3⌋, capped at 150, at least
 * 1 when not none. Captions only where every field has words (an undated pick gets none; age only on or after the birth date).
 * Order: capture order by compareWall, then asset name, frame, given index; an undated pick stays right after the pick it followed
 * in the given list. No clock, no randomness, no I/O; the document is never mutated.
 * NOT IN VERSION 1 (decisions): blurred backdrop (fill is colour only), beat mode and music, the Hebrew-date caption, the onion
 * skin (replaced by the live preview, C13), the people-sheet entry, automatic eye points.
 */
import { z } from 'zod';
import { RationalTimeSchema, type SlotRecord } from './schema.ts';
import type { ProjectDocument } from './schema.ts';
import type { PlannedSlot, TemplateStep } from './templateContract.ts';
import type { Fit } from './geometry.ts';
import { sha256Hex } from './sha256.ts';

export const GROWING_RECIPE_ID = 'growing' as const;
/** apply_template.templateId (templateContract.ts pattern ^tpl\.[a-z0-9-]{1,40}$). Not in the template catalogue. */
export const GROWING_TEMPLATE_ID = 'tpl.growing' as const;
export const GROWING_RUN_RECIPE_ID = 'template:tpl.growing' as const;
export const GROWING_VERSION = 1 as const;
/** True once planGrowing, solveAlignment, eyesFromTransform and suggestEyeOrder are built (W1 flips it). The editor shows the feature only then. */
export const GROWING_BUILT: boolean = false;
export const GROWING_METHOD = 'a similarity transform from two eye points placed by hand (exact arithmetic); no face detection, no model' as const;

export const GROWING = {
  minPictures: 2, maxPictures: 120,
  /** The two eye points at least this many pixels apart on the picture as shown. */
  minEyeShownPx: 4,
  /** Eye distance as a fraction of the frame width. */
  faceSize: { min: 0.06, max: 0.4, default: 0.14 },
  /** y of the eye line from the frame centre, as a fraction of the frame height (negative = above the centre). */
  eyeLine: { min: -0.3, max: 0.1, default: -0.08 },
  /** Hold of each picture when not given: one second, as round(fps) frames (never below flashGapFrames). */
  defaultHoldSeconds: 1,
  maxHoldFrames: 3000,
  maxDissolveFrames: 150,
  /** Magnification (frame pixels per shown picture pixel) above which the pick warns enlarged, with the number (heuristic). */
  enlargedAbove: 2,
  /** The uncovered share is measured on this grid of frame points (a measurement, shown as a number). */
  coverageGrid: { cols: 64, rows: 36 },
  /** Browser and server transforms agree within this (G17, C11). */
  agreeWithin: 1e-6,
  /** apply_template's limits: 2000 ops, 400 slots, 50 steps. */
  maxOps: 2000, maxSlots: 400, maxSteps: 50,
} as const;

/** An eye point on the picture AS SHOWN (EXIF applied), u right and v down, 0..1 of the shown width and height. */
export const EyePointSchema = z.object({ u: z.number().min(0).max(1), v: z.number().min(0).max(1) }).strict();
export type EyePoint = z.infer<typeof EyePointSchema>;
const Id = z.string().min(1).max(64);
/**
 * One picture of the request. `frame`: the source frame of a video (sourceTimeOfFrame gives its time), null for a still.
 * `eyes`: [first, second] in the order the owner settled (C10); request data only, never stored. Absent only in a rebuild, for a
 * pick whose untouched clip gives them back (eyesFromTransform); a pick without eyes and without such a clip is refused needs_marks.
 */
export const GrowingPickInputSchema = z.object({
  assetId: Id,
  frame: z.number().int().min(0).nullable(),
  eyes: z.tuple([EyePointSchema, EyePointSchema]).optional(),
}).strict();
export type GrowingPickInput = z.infer<typeof GrowingPickInputSchema>;
export const GROWING_SORTS = ['capture', 'given'] as const;
export const GROWING_DISSOLVES = ['none', 'short', 'long'] as const;
export const GrowingCaptionSchema = z.object({ date: z.boolean(), age: z.boolean() }).strict();
/** The body's `params` of POST …/recipes/growing/plan and …/apply (and, partially, of a rebuild). */
export const GrowingParamsSchema = z.object({
  picks: z.array(GrowingPickInputSchema).min(GROWING.minPictures).max(GROWING.maxPictures).describe('Pictures in the order the dialog shows them'),
  sort: z.enum(GROWING_SORTS).optional().describe('default capture: dated picks in capture order, an undated pick right after the pick it followed here'),
  holdFrames: z.number().int().min(1).max(GROWING.maxHoldFrames).optional().describe('project frames per picture; default one second; below flashGapFrames(fps) is refused'),
  dissolve: z.enum(GROWING_DISSOLVES).optional().describe('default short'),
  faceSize: z.number().min(GROWING.faceSize.min).max(GROWING.faceSize.max).optional(),
  eyeLine: z.number().min(GROWING.eyeLine.min).max(GROWING.eyeLine.max).optional(),
  fill: z.literal('colour').optional().describe('version 1: the project background colour shows where a picture does not cover the frame'),
  caption: GrowingCaptionSchema.nullable().optional().describe('live fields on dated pictures: {date} and/or {age:personId}; null = none'),
  personId: Id.optional().describe('the person whose age the caption shows (people sheet)'),
  at: RationalTimeSchema.optional().describe('frame-aligned start on the main sequence; default 0 when it is empty, else the end of the last picture or title'),
}).strict();
export type GrowingParams = z.infer<typeof GrowingParamsSchema>;
/** A rebuild's params: any of the settings, and picks (eyes only for pictures marked again). */
export const GrowingRebuildParamsSchema = GrowingParamsSchema.partial().strict();
export type GrowingRebuildParams = z.infer<typeof GrowingRebuildParamsSchema>;
export const GROWING_DEFAULTS = { sort: 'capture', dissolve: 'short', faceSize: GROWING.faceSize.default, eyeLine: GROWING.eyeLine.default, fill: 'colour', caption: null } as const;
export interface ResolvedGrowingParams {
  picks: GrowingPickInput[]; sort: (typeof GROWING_SORTS)[number]; holdFrames: number; dissolve: (typeof GROWING_DISSOLVES)[number];
  faceSize: number; eyeLine: number; fill: 'colour'; caption: z.infer<typeof GrowingCaptionSchema> | null; personId: string | null; at: z.infer<typeof RationalTimeSchema>;
}

// ---------- the run record: what is stored (never a coordinate) ----------
/** What the run record keeps of a pick: its slot key, file and frame, and its place in the order. */
export interface GrowingPicked { key: string; assetId: string; frame: number | null }
/** The slot key of a pick: 'g' + 12 hex of sha256("assetId:frame"), stable across rebuilds; one pick per (assetId, frame). Pure. */
export function growingPickKey(assetId: string, frame: number | null): string {
  return `g${sha256Hex(`${assetId}:${frame === null ? 'still' : frame}`).slice(0, 12)}`;
}
/** The keys a growing run record may hold (apply_template adds templateVersion). Nothing else is ever written. */
export const GROWING_RECORD_KEYS = ['picked', 'removedPicks', 'sort', 'holdFrames', 'dissolve', 'faceSize', 'eyeLine', 'fill', 'caption', 'personId', 'at'] as const;
/**
 * The params a growing run records, built key by key from the resolved request (a whitelist: the eyes cannot reach the record
 * even if a caller left them in). `picked` in show order. Pure; implemented in the pre-pass (it is the privacy rule, not a body).
 */
export function growingRunRecordParams(params: Pick<ResolvedGrowingParams, 'sort' | 'holdFrames' | 'dissolve' | 'faceSize' | 'eyeLine' | 'fill' | 'caption' | 'personId' | 'at'>, picked: readonly GrowingPicked[], removedPicks: readonly GrowingPicked[] = []): Record<string, unknown> {
  const copy = (p: GrowingPicked): GrowingPicked => ({ key: String(p.key), assetId: String(p.assetId), frame: p.frame === null ? null : Math.trunc(Number(p.frame)) });
  return {
    picked: picked.map(copy), ...(removedPicks.length ? { removedPicks: removedPicks.map(copy) } : {}),
    sort: params.sort, holdFrames: Math.trunc(params.holdFrames), dissolve: params.dissolve, faceSize: Number(params.faceSize), eyeLine: Number(params.eyeLine), fill: params.fill,
    caption: params.caption ? { date: !!params.caption.date, age: !!params.caption.age } : null, ...(params.personId ? { personId: String(params.personId) } : {}),
    at: { value: String(params.at.value), timescale: Number(params.at.timescale) },
  };
}
const isPicked = (x: unknown): x is GrowingPicked => !!x && typeof x === 'object' && typeof (x as GrowingPicked).key === 'string' && typeof (x as GrowingPicked).assetId === 'string'
  && ((x as GrowingPicked).frame === null || Number.isSafeInteger((x as GrowingPicked).frame));
/** The picks a run record keeps (params.picked, or params.removedPicks with which='removed'), or []. Never throws. */
export function growingRunPicked(params: Readonly<Record<string, unknown>>, which: 'picked' | 'removed' = 'picked'): GrowingPicked[] {
  const k = which === 'picked' ? 'picked' : 'removedPicks';
  const p = Object.hasOwn(params, k) ? params[k] : undefined;
  return Array.isArray(p) ? p.filter(isPicked).map((x) => ({ key: x.key, assetId: x.assetId, frame: x.frame })) : [];
}

// ---------- geometry: the solve and its inverse (W1) ----------
export interface GrowingFrame { width: number; height: number; fit: Fit }
/** A picture as shown (EXIF applied): asset.image.width/height, or asset.video.width/height for a video frame. */
export interface ShownSize { width: number; height: number }
export interface GrowingTarget { faceSize: number; eyeLine: number }
/** The four numbers the planner writes with set_clip_transform (opacity is never touched). */
export interface GrowingTransform { x: number; y: number; scale: number; rotation: number }
export interface GrowingSolve {
  transform: GrowingTransform;
  /** Frame pixels per shown picture pixel (scale · fitScale). */
  magnification: number;
  /** Inside the schema's transform bounds (scale 0.01..20, |x|,|y| ≤ 4). */
  inBounds: boolean;
}
/** Pure. The similarity transform that lands eyes[0] on the left target and eyes[1] on the right (C10: never swaps). W1. */
export type SolveAlignment = (eyes: readonly [EyePoint, EyePoint], shown: ShownSize, frame: GrowingFrame, target: GrowingTarget) => GrowingSolve;
/** Pure. The exact inverse (C7): the eye points a transform gives back, [left target, right target], to about 1e-6. W1. */
export type EyesFromTransform = (transform: GrowingTransform, shown: ShownSize, frame: GrowingFrame, target: GrowingTarget) => [EyePoint, EyePoint];
/** Pure. The order the dialog proposes for two clicks: as clicked, swapped when the line between them turns more than 90° (heuristic). W1. */
export type SuggestEyeOrder = (a: EyePoint, b: EyePoint, shown: ShownSize) => [EyePoint, EyePoint];

// ---------- the plan ----------
export const GROWING_WARNING_CODES = [
  'enlarged', 'uncovered_corners', 'cannot_cover_all', 'before_birth', 'undated_no_caption', 'no_birth_date', 'other_formats_not_aligned',
  'orientation_unverified', 'kept_by_hand', 'removed_by_hand', 'moved_back', 'flash_checked_after_export',
] as const;
export type GrowingWarningCode = (typeof GROWING_WARNING_CODES)[number];
export interface GrowingWarning { code: GrowingWarningCode; message: string; details: Record<string, unknown> }
export const GROWING_EXCLUSION_CODES = ['outside_transform_range', 'needs_marks', 'kept_by_hand', 'removed_by_hand'] as const;
export type GrowingExclusionCode = (typeof GROWING_EXCLUSION_CODES)[number];
export interface GrowingExclusion { key: string; assetId: string; frame: number | null; code: GrowingExclusionCode; details: Record<string, unknown> }
export interface GrowingPick {
  key: string; assetId: string; frame: number | null; order: number;
  /** Wall-clock capture as the life line shows it, or null (undated). */
  capture: string | null;
  startFrame: number; frames: number; dissolveFrames: number;
  transform: GrowingTransform; magnification: number;
  /** Share (0..1) of the coverage grid's frame points the picture does not cover (measured on GROWING.coverageGrid). */
  uncoveredShare: number;
  /** The caption's text with its live fields, or null. */
  caption: string | null;
  reasons: GrowingWarningCode[];
}
/** Everything the planner needs that is not in the document (built by the server; the dialog's live preview builds the same from the document it holds). */
export interface GrowingPlanContext {
  /** Wall-clock capture per asset id (life line shownCapture), or null when unknown. */
  capture: Readonly<Record<string, string | null>>;
  // ---- rebuild only (apps/server/src/growing.ts, W2): runHandEdits(…, 'any-move') ----
  keptKeys?: readonly string[];
  removedKeys?: readonly string[];
  movedKeys?: readonly string[];
  reuseTracks?: { pictures?: string; captions?: string };
}
export interface GrowingPlan {
  recipeId: typeof GROWING_RECIPE_ID; templateId: typeof GROWING_TEMPLATE_ID; version: typeof GROWING_VERSION;
  params: ResolvedGrowingParams;
  /** growingRunRecordParams of this plan: what apply_template stores as the run's params. */
  record: Record<string, unknown>;
  steps: string[]; basis: string[];
  warnings: GrowingWarning[];
  picks: GrowingPick[]; excluded: GrowingExclusion[];
  ops: TemplateStep[]; slots: PlannedSlot[];
  /** The smallest face size with no uncovered corner on any pick (≤ GROWING.faceSize.max), or null (cannot_cover_all). */
  suggestedFaceSize: number | null;
  predicted: { startFrame: number; endFrame: number; holdFrames: number; dissolveFrames: number; seconds: number };
  method: typeof GROWING_METHOD;
}
/** Pure. Throws GrowingError. W1 implements it in growing.ts. */
export type PlanGrowing = (doc: ProjectDocument, params: unknown, ctx: GrowingPlanContext) => GrowingPlan;

export class GrowingError extends Error {
  constructor(public code: 'not_found' | 'incompatible' | 'out_of_bounds' | 'invalid_args' | 'not_built', message: string, public details: Record<string, unknown> = {}, public hint?: string) { super(message); }
}
/** Thrown by a stub that is not built yet (never a made-up value). */
export class GrowingNotBuilt extends GrowingError {
  constructor(what: string) { super('not_built', GROWING_REFUSALS.notBuilt.message(), { what }, `${what}: not built in this build yet`); }
}
/** The planner's refusals: code and fixed English sentence (Hebrew with the next step: i18n growing.ts HE_GROWING). */
export const GROWING_REFUSALS = {
  badParams: { code: 'invalid_args', message: (why: string) => `the growing parameters are not valid: ${why}` },
  tooFew: { code: 'invalid_args', message: () => 'at least two pictures are needed' },
  assetMissing: { code: 'not_found', message: () => 'a chosen picture is not in this project' },
  noPicture: { code: 'incompatible', message: () => 'a chosen file has no picture' },
  frameOnStill: { code: 'invalid_args', message: () => 'a still picture has no frame number' },
  noFrame: { code: 'invalid_args', message: () => 'a video needs the number of the frame to hold' },
  noSuchFrame: { code: 'out_of_bounds', message: () => 'the video has no such frame' },
  duplicatePick: { code: 'invalid_args', message: () => 'the same picture is chosen twice' },
  eyesTooClose: { code: 'invalid_args', message: () => 'the two eye marks are too close together' },
  needsMarks: { code: 'invalid_args', message: () => 'a picture has no eye marks' },
  holdTooShort: { code: 'out_of_bounds', message: (min: number) => `each picture must stay at least ${min} frames, so that the film does not flash` },
  personMissing: { code: 'not_found', message: () => 'the person for the age caption is not in the people sheet' },
  notBuilt: { code: 'not_built', message: () => 'growing up before your eyes is not built in this version yet' },
} as const satisfies Record<string, { code: GrowingError['code']; message: (...a: never[]) => string }>;
export type GrowingRefusalKey = keyof typeof GROWING_REFUSALS;
export function growingRefusal<K extends GrowingRefusalKey>(key: K, details: Record<string, unknown>, ...args: Parameters<(typeof GROWING_REFUSALS)[K]['message']>): GrowingError {
  const r = GROWING_REFUSALS[key];
  return new GrowingError(r.code, (r.message as (...a: unknown[]) => string)(...args), details);
}

// ---------- the wire (existing recipe routes; owner's own session only) ----------
/**
 * The calls, all on routes that exist (recipes.ts dispatches recipe 'growing' and runs 'template:tpl.growing'); every one answers
 * 403 owner_required to anything that is not the owner's own session, before anything else is read from the body:
 *   POST /api/v1/projects/{id}/recipes/growing/plan          { params: GrowingParams }                        → GrowingPlanView
 *   POST /api/v1/projects/{id}/recipes/growing/apply         { params: GrowingParams, expectedRevision? }     → GrowingApplyResult
 *   POST /api/v1/projects/{id}/recipe-runs/{runId}/regenerate { params?: GrowingRebuildParams, restoreRemoved?, expectedRevision? } → GrowingRegenerateResult
 *   (and POST …/template-runs/{runId}/regenerate for the same run). MCP plan_recipe / apply_recipe / regenerate_recipe reach the
 *   same functions with an agent credential and are refused 403 owner_required.
 * The eyes are request data only: they are not echoed in any answer (the plan view's params are the record's), not written to the
 * document, the event stream, the transactions table, a summary or a log line.
 */
export const GROWING_ROUTES = {
  plan: '/api/v1/projects/{id}/recipes/growing/plan',
  apply: '/api/v1/projects/{id}/recipes/growing/apply',
  rebuild: '/api/v1/projects/{id}/recipe-runs/{runId}/regenerate',
} as const;
export interface GrowingPlanRequest { params: GrowingParams }
export interface GrowingApplyRequest { params: GrowingParams; expectedRevision?: number }
export interface GrowingRebuildRequest { params?: GrowingRebuildParams; restoreRemoved?: boolean; expectedRevision?: number }
/** The plan view: no ops; params are the run record's (no eyes). */
export type GrowingPlanView = Omit<GrowingPlan, 'ops' | 'slots' | 'params'> & { params: Record<string, unknown>; revision: number; operations: number; note: string };
export interface GrowingApplyResult { revision: number; runId: string; createdIds: string[]; slots: SlotRecord[]; steps: string[]; warnings: GrowingWarning[]; picks: GrowingPick[]; excluded: GrowingExclusion[] }
export interface GrowingRegenerateResult extends GrowingApplyResult { replaced: number; protected: string[]; removed: string[]; movedBack: string[] }
/** The server's fixed refusals of the growing calls (English; Hebrew: i18n growing.ts HE_GROWING_SERVER). */
export const GROWING_API_CODES = { ownerRequired: 'owner_required', notBuilt: 'growing_not_built' } as const;
