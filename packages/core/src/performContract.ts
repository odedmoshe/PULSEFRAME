/**
 * Perform mode («הופעה»; ADR-0025, "stage / perform mode"): the shared contract. LEAD file — W1 (moves.ts), W2 (cameraPath.ts)
 * and W3 (apps/web/src/editor/perform/*) import it and do not edit it; a worker that needs a new value (a held reason, a refusal)
 * asks the lead.
 *
 * The workspace is called `perform` everywhere in code, ids and strings: "stage" already names the viewer (StageHeader.tsx,
 * stage.strings.ts). Plan: .artifacts/stage-plan.md (its "Verifier" and "Corrected notes" sections win over its body) and the
 * lead's answers in .artifacts/wave5-decisions.md ("Stage / perform mode"), which win over both.
 *
 * What a take is: the owner presses play and taps pads (keys 1–8, a pointer, touch). NOTHING is committed while playing: the
 * pure planner (moves.ts planPerformance) turns the taps into ordinary public operations, the browser shows them on an in-memory
 * document through the one evaluate + compositor path, and at stop the take is committed ONCE, as ONE transaction (one undo):
 * POST /api/v1/projects/:id/takes runs the same planner on the server and commits the internal op `apply_take` (takeOps.ts),
 * as templates are applied (ADR-0016 decision 5). The op is internal on purpose (verifier: a public composite op would let a
 * client send 2000 nested steps per call, past the 200-operation request limit, http.ts and mcp.ts).
 *
 * Decided (wave5-decisions.md):
 * - Zoom punch: ONE look everywhere, scale keys on the clip (Canvas2D; the same in preview, still and export). No adjustment-pulse variant.
 * - Freeze pad: wave 2 (freeze_frame adds time and silences the music). There is no `freeze` kind and freeze_frame is not a step.
 * - Strobe pad («הבזק על הפעימה»): never in the default bank; offered only when the music has an analysed beat grid; it goes
 *   through the flash rule like every pad that changes light.
 * - Shake and glitch: GPU only; without an adapter the pad is disabled («דורש כרטיס מסך»). The DEFAULT bank is Canvas2D on every
 *   machine; GPU pads are a second, named bank.
 * - Light: one source of truth (performFlash.ts): an effect changes light unless every numeric parameter it has may follow the
 *   beat (effects.ts modulatableParams, the classification the curve rule and the beat modulators use); light.strobe and the
 *   light transitions are the light the flash schedule already owns.
 * - Default snap: nearest beat at full strength (recorded for the owner to confirm).
 * - Clip switching by keys is NOT in perform mode: multicam (ADR-0020) owns digits 1–9 while its program is live, and perform
 *   mode yields them (apps/web/src/editor/perform/performKeys.ts).
 * - Camera takes are partial retakes: only the x/y/scale keys inside the take's range are replaced (replace_clip_keyframes'
 *   range form, ADR-0019); keys outside stay. One take = one transaction = one undo.
 * - Pads never add people fields or ages; regions (privacy blur) follow the source and are untouched by a take.
 * - No schema change: a take is recorded in the existing recipeRuns (recipeId PERFORM_RECIPE_ID). Pad banks, snap, camera
 *   settings and the tap calibration are browser preferences (PERFORM_PREFS_KEY in the web contract), never project state.
 */
import { z } from 'zod';
import type { Rate } from '@pulseframe/time';
import { RationalTimeSchema, TextAnimationSchema, TextStyleSchema, TransformSchema, type ProjectDocument } from './schema.ts';
import { TemplateStepSchema } from './templateContract.ts';
import type { OpCall } from './ops.ts';
import type { Fit } from './geometry.ts';

// ---------- identity and limits ----------
/** The recipeId of a take's run record (recipeRuns). W1 finds earlier takes' sound lanes through it. */
export const PERFORM_RECIPE_ID = 'perform:take';
/** The run's version (params.version), so a later wave can read old runs. */
export const PERFORM_TAKE_VERSION = 1;
export const PAD_COUNT = 8;
/** Taps a take request may carry (the 201st tap and later are held take_full by the planner, so the request may hold more). */
export const MAX_TAKE_TAPS = 1000;
/** Hits a take keeps at most; later ones are held `take_full`. */
export const MAX_TAKE_HITS = 200;
/** Steps one apply_take may run (enforced by the op's schema). */
export const MAX_TAKE_STEPS = 2000;
/** add_track steps one apply_take may run (enforced by the op): sound lanes and a sticker lane, with room to spare. */
export const MAX_TAKE_TRACKS = 6;
/** Sound lanes a take uses at most (planner); earlier takes' unlocked sound tracks are reused first. */
export const MAX_SOUND_LANES = 4;
/** Summary lines a take records (the run's steps, RecipeRunSchema.steps max 50). */
export const MAX_TAKE_SUMMARY = 50;
/**
 * Key TIMES of one camera take (per property). The camera plan is three replace_clip_keyframes calls (x, y, scale) with the
 * take's range (ADR-0019 range form), so the 200-operation request limit no longer caps it; a property still holds at most 2000
 * keys in all (replace_clip_keyframes), which planCamera checks (`too_many_keys`).
 */
export const MAX_CAMERA_KEYS = 600;
/** Largest allowed difference between the dense camera path and its keys: 0.5 % of the frame. */
export const CAMERA_TOLERANCE = 0.005;
/** The camera never zooms in more than this over the fill scale (and the schema's |x|, |y| ≤ 4 can lower it, cameraLimits). */
export const CAMERA_MAX_ZOOM = 4;
/** A GPU pulse pad without followed music pulses at this rate (one pulse every 3 s), and is held at most this long. */
export const PULSE_FALLBACK_BPM = 20;
export const PULSE_MAX_HOLD_SECONDS = 3;

/**
 * The only operations a take may run as steps (all public; apply_take refuses any other with forbidden_op). freeze_frame is not
 * here (wave 2). replace_clip_keyframes (range form) is how a punch writes its keys in one step per property.
 */
export const TAKE_STEP_OPS = ['add_track', 'add_adjustment', 'set_effect_keyframe', 'set_keyframe', 'replace_clip_keyframes', 'add_clip', 'set_clip_gain', 'set_clip_transform', 'add_text', 'apply_text_preset', 'set_text_animation', 'apply_motion_preset'] as const;
export type TakeStepOp = (typeof TAKE_STEP_OPS)[number];

// ---------- quantise settings ----------
export const SNAP_MODES = ['off', 'beat', 'half'] as const;
export const TEMPO_MODES = ['half', 'normal', 'double'] as const;
/**
 * snap: off / nearest beat / nearest half beat. tempo: ÷2 keeps every other beat (running index parity, counted from the first
 * bar start, or the first beat when no bar start was found; `parity` 1 takes the other half), ×2 adds midpoints between beats
 * no further apart than twice the median period (it never bridges a gap). strength 0..1 moves a tap that far toward its grid point.
 */
export const QuantiseSettingsSchema = z.object({
  snap: z.enum(SNAP_MODES), tempo: z.enum(TEMPO_MODES), strength: z.number().min(0).max(1), parity: z.union([z.literal(0), z.literal(1)]),
}).strict();
export type QuantiseSettings = z.infer<typeof QuantiseSettingsSchema>;
/** The decided default (wave5-decisions.md): nearest beat at full strength. For the owner to confirm. */
export const DEFAULT_QUANTISE: QuantiseSettings = { snap: 'beat', tempo: 'normal', strength: 1, parity: 0 };

// ---------- the op (internal; takeOps.ts) ----------
export const TakeSummarySchema = z.object({
  snap: z.enum(SNAP_MODES), tempo: z.enum(TEMPO_MODES), parity: z.union([z.literal(0), z.literal(1)]), strength: z.number().min(0).max(1),
  /** taps given, hits kept, hits held (planner counts; informative, the op does not trust them) */
  taps: z.number().int().min(0).max(MAX_TAKE_TAPS), hits: z.number().int().min(1).max(MAX_TAKE_HITS), held: z.number().int().min(0).max(MAX_TAKE_TAPS),
  /** Lines for the run record (RecipeRun.steps): what the take did, in the planner's English; the editor shows the chips instead. */
  summary: z.array(z.string().max(400)).max(MAX_TAKE_SUMMARY),
}).strict();
export type TakeSummary = z.infer<typeof TakeSummarySchema>;
export const ApplyTakeArgsSchema = z.object({
  /** The sequence the take was performed on (default the main sequence); the flash rule reads this sequence. */
  sequenceId: z.string().min(1).max(64).optional(),
  take: TakeSummarySchema,
  /** Public ops from TAKE_STEP_OPS, with {"$ref"} bindings to EARLIER steps only (templateContract.ts RefSchema; no $asset here). */
  steps: z.array(TemplateStepSchema).min(1).max(MAX_TAKE_STEPS),
}).strict();
export type ApplyTakeArgs = z.infer<typeof ApplyTakeArgsSchema>;
export interface ApplyTakeOutput { runId: string; createdIds: string[] }

// ---------- moves (a pad holds one; the op never reads these, only the planner does) ----------
/**
 * Lengths are SECONDS (a pad must feel the same at 24 and 60 fps); the planner turns them into whole frames once, from the
 * absolute time. Titles, stickers and moves that change light last at least flashGapFrames(fps) whatever these say (op-enforced).
 * decay: `from` at the hit start to `to` over `seconds` (ease-out), then `to`. release: `from` until the last `seconds`, then linear to `to`.
 */
export const EnvelopeSchema = z.object({ param: z.string().min(1).max(32), from: z.number(), to: z.number(), shape: z.enum(['decay', 'release']), seconds: z.number().min(0.01).max(4) }).strict();
export type Envelope = z.infer<typeof EnvelopeSchema>;
const MoveBase = {
  id: z.string().regex(/^move\.[a-z0-9-]{1,40}$/),
  /** Shortest hit, seconds (a tap shorter than this still lasts this long). */
  minSeconds: z.number().min(0.01).max(10),
};
/** A built-in sound (apps/server/src/sfx.ts catalogue id) or graphic element (elements.ts id, with its colours). Never an asset id: assets belong to one project. */
export const SfxSourceSchema = z.object({ sfxId: z.string().min(1).max(64) }).strict();
export const ElementSourceSchema = z.object({ elementId: z.string().min(1).max(64), color: z.string().max(32).optional(), color2: z.string().max(32).optional() }).strict();
export const MoveSpecSchema = z.discriminatedUnion('kind', [
  /** An adjustment clip over the picture with up to four effects. Whether it needs a graphics adapter is derived (moveNeedsGpu), never declared. */
  z.object({
    ...MoveBase, kind: z.literal('adjust'),
    effects: z.array(z.object({
      type: z.string().min(1).max(64), params: z.record(z.string(), z.unknown()).optional(), envelope: EnvelopeSchema.optional(),
      /** GPU motion effects: follow the music when followed music plays under the hit, else pulse from the hit frame (PULSE_FALLBACK_BPM). */
      onBeat: z.boolean().optional(),
    }).strict()).min(1).max(4),
    /** Linear fade of the adjustment's opacity at its end (monotonic, so ADR-0019's no-turn-back rule on opacity holds). */
    fadeOutSeconds: z.number().min(0).max(1),
  }).strict(),
  /** The zoom punch: scale keys on the topmost picture clip at the hit, about the frame centre (x and y scaled with it). */
  z.object({ ...MoveBase, kind: z.literal('punch'), scale: z.number().min(1.02).max(2), releaseSeconds: z.number().min(0.01).max(1) }).strict(),
  z.object({ ...MoveBase, kind: z.literal('sound'), source: SfxSourceSchema, gain: z.number().min(0).max(2) }).strict(),
  z.object({
    ...MoveBase, kind: z.literal('title'), text: z.string().min(1).max(80), presetId: z.string().max(64).optional(),
    style: TextStyleSchema.partial().optional(), transform: TransformSchema.partial().optional(), animation: TextAnimationSchema.partial().optional(),
  }).strict(),
  z.object({ ...MoveBase, kind: z.literal('sticker'), source: ElementSourceSchema, transform: TransformSchema.partial().optional(), motionId: z.string().max(64).optional() }).strict(),
]);
export type MoveSpec = z.infer<typeof MoveSpecSchema>;
export type MoveKind = MoveSpec['kind'];
export const MOVE_KINDS = ['adjust', 'punch', 'sound', 'title', 'sticker'] as const satisfies readonly MoveKind[];
/** Exactly PAD_COUNT entries; null = an empty pad. */
export type PadBank = readonly (MoveSpec | null)[];
export const PadBankSchema = z.array(MoveSpecSchema.nullable()).length(PAD_COUNT);
/** The two named banks (W1 builds both in moves.ts): Canvas2D works everywhere and is the default; GPU needs an adapter. */
export const BANK_IDS = ['canvas', 'gpu'] as const;
export type BankId = (typeof BANK_IDS)[number];

// ---------- taps, hits, plan ----------
/** One pad press. `down` and `up` are timeline seconds, the tap calibration already subtracted (the web does it). */
export const TapSchema = z.object({ pad: z.number().int().min(0).max(PAD_COUNT - 1), down: z.number().min(0).max(86400), up: z.number().min(0).max(86400) }).strict()
  .refine((t) => t.up >= t.down, { message: 'a tap ends at or after it starts (up >= down)' });
export type Tap = z.infer<typeof TapSchema>;
export interface Hit {
  /** index into the taps */
  tap: number; pad: number;
  /** timeline frame of the hit's start, and its length in frames (≥ 1) */
  frame: number; frames: number;
  /** false: no grid point near enough (outside the grid's coverage by more than half a local period), the tap kept its time */
  snapped: boolean;
  /** how far the start moved, ms (negative = earlier) */
  movedMs: number;
}
/**
 * Why a hit was not kept. Every reason has words in Hebrew and English (i18n perform.held.*). A worker that needs another asks the lead.
 * - flash_limit: a change of light too soon after another, or inside a strobe's or light transition's light (performFlash.ts)
 * - needs_gpu: the pad's effect needs a graphics adapter this machine lacks · no_music: the strobe pad without an analysed beat grid
 * - no_picture: no picture clip under the hit (punch) · has_motion: the punched property moves there, or its curve depends on
 *   neighbouring keys · locked: the clip's track is locked · follows_track: the clip follows a motion track
 * - crosses_cut: the hit crosses the end of the clip it punches · too_many_keys: a property would pass 2000 keys
 * - too_many_sounds: more than MAX_SOUND_LANES overlap · sound_too_short: less than one frame of sound fits before the end
 * - missing_asset: a sound or sticker pad whose built-in is not in the project library yet («הוסיפו לספרייה»)
 * - take_full: past MAX_TAKE_HITS hits or MAX_TAKE_STEPS steps · outside_edit: starts after the last picture or title
 */
export const HELD_REASONS = ['flash_limit', 'needs_gpu', 'no_music', 'no_picture', 'has_motion', 'locked', 'follows_track', 'crosses_cut', 'too_many_keys', 'too_many_sounds', 'sound_too_short', 'missing_asset', 'take_full', 'outside_edit'] as const;
export type HeldReason = (typeof HELD_REASONS)[number];
export interface Chip {
  tap: number; pad: number; moveId: string; frame: number; frames: number;
  /** kept: realised · merged: joined into the previous hit of the same pad · held: not realised (reason says why) */
  state: 'kept' | 'merged' | 'held';
  reason?: HeldReason;
  /** flash_limit: frames since the last kept change of light (or since the light began) */
  since?: number;
  /**
   * flash_limit only, optional and additive: 'shape' when the hit's start fit but its own envelope or fade put a change of light
   * too close to its start, its end or another change (the planner holds it rather than stretching it into another shape).
   * Absent on every other hold, including one whose start came too soon after another change of light.
   */
  why?: 'shape';
}
export interface PlannedTake {
  /** The op's arguments; null when nothing is kept (the route then answers 409 take_empty and changes nothing). */
  args: ApplyTakeArgs | null;
  chips: Chip[];
  /** English sentences for the planner's notices (the editor words chips itself) */
  warnings: string[];
}
export interface PlanInput {
  sequenceId?: string;
  hits: readonly Hit[];
  bank: PadBank;
  /** Per pad (length PAD_COUNT): the project asset a sound or sticker pad resolved to, else null (held missing_asset). */
  assets: readonly (string | null)[];
  settings: QuantiseSettings;
  /** The graphics adapter passed its check on this machine (apps/web/src/gpuProbe.ts). */
  gpu: boolean;
}

/** The body of POST /api/v1/projects/:id/takes (and of the MCP tool perform_take): the raw taps; the server quantises and plans. */
export const TakeRequestSchema = z.object({
  sequenceId: z.string().min(1).max(64).optional(),
  taps: z.array(TapSchema).min(1).max(MAX_TAKE_TAPS),
  bank: PadBankSchema,
  assets: z.array(z.string().min(1).max(64).nullable()).length(PAD_COUNT),
  settings: QuantiseSettingsSchema,
  gpu: z.boolean(),
  /** The revision the take was performed on; refused with stale_revision when the project moved (the editor re-plans). */
  expectedRevision: z.number().int().min(0).optional(),
  /** true: plan only (observe scope), nothing is committed — the determinism proof compares these args with the browser's. */
  dryRun: z.boolean().optional(),
}).strict();
export type TakeRequest = z.infer<typeof TakeRequestSchema>;
/** POST /takes answers: committed (dryRun false) or planned only (dryRun true). */
export interface TakeResult { revision: number; runId: string; createdIds: string[]; chips: Chip[]; warnings: string[] }
export interface TakePlanView { revision: number; args: ApplyTakeArgs | null; chips: Chip[]; warnings: string[] }

// W1 implements these in packages/core/src/moves.ts as `export const name: Type = …` (signatures fixed here)
export type FrameOfSeconds = (seconds: number, rate: Rate) => number;
/** Timeline seconds of the grid a take snaps to (empty when no analysed music is followed, or snap is off). */
export type PerformGrid = (doc: ProjectDocument, settings: QuantiseSettings, sequenceId?: string) => number[];
export type QuantiseTaps = (taps: readonly Tap[], grid: readonly number[], settings: QuantiseSettings, rate: Rate, bank: PadBank) => Hit[];
export type PlanPerformance = (doc: ProjectDocument, input: PlanInput) => PlannedTake;
export type DefaultBank = (id: BankId) => PadBank;

// ---------- virtual camera («צלם»; W2 implements in packages/core/src/cameraPath.ts) ----------
/** Geometry of the MASTER (doc.settings width, height, fit) and the clip's own picture size (compositor2d.ts placedSize). */
export interface CameraGeometry { frameW: number; frameH: number; srcW: number; srcH: number; fit: Fit }
/** Where the operator pointed on a timeline frame: centre in source-normalised coordinates (0..1), zoom ≥ 1 over the fill scale. */
export interface CameraSample { frame: number; u: number; v: number; zoom: number }
export interface CameraSettings {
  settleSeconds: number; leadSeconds: number;
  /** 0..1 of the largest handheld sway (2 % of the visible window) */
  sway: number; seed: number;
}
export const DEFAULT_CAMERA: CameraSettings = { settleSeconds: 0.6, leadSeconds: 0.1, sway: 0, seed: 1 };
export interface CameraPose { u: number; v: number; zoom: number }
export interface ClipPose { x: number; y: number; scale: number }
/** `frame` is clip-local. */
export interface CameraKey extends ClipPose { frame: number }
/**
 * not_picture: not a media clip with a picture on a video track · adjustment · locked · rotated (rotation keys or a rotation ≠ 0)
 * · follows_track · no_room: the picture cannot cover the frame on either axis · no_samples · not_full_frame: the clip's scale is
 * below the fill scale (picture in picture) · too_many_keys: kept keys outside the range plus the new ones would pass 2000.
 */
export const CAMERA_REFUSALS = ['not_picture', 'adjustment', 'locked', 'rotated', 'follows_track', 'no_room', 'no_samples', 'not_full_frame', 'too_many_keys'] as const;
export type CameraRefusal = (typeof CAMERA_REFUSALS)[number];
export interface CameraPlan {
  /** Exactly three replace_clip_keyframes calls (x, y, scale) with the take's clip-local range {from, to} and linear keys: a partial retake, one transaction. */
  ops: OpCall[];
  keys: CameraKey[];
  /** clip-local range the take replaces (both included) */
  range: { from: z.infer<typeof RationalTimeSchema>; to: z.infer<typeof RationalTimeSchema> };
  /** largest remaining difference from the dense path (CAMERA_TOLERANCE units: fraction of the frame) */
  residual: number;
  /** true when the residual is above CAMERA_TOLERANCE at MAX_CAMERA_KEYS: the editor asks for a shorter range and offers no accept */
  overTolerance: boolean;
  /** existing x, y and scale keys inside the range that the take replaces (the confirm counts them) */
  replacedKeys: number;
  /** codes: 'linked_formats' when a linked format does not override this clip's transform (framed differently there);
   *  'cannot_reach_ends' when the picture is wider (or taller) than the camera can pan, |x|, |y| <= 4 (i18n perform.cannotReachEnds) */
  warnings: string[];
}
export type CameraLimits = (g: CameraGeometry) => { fill: number; maxZoom: number };
export type SpringPath = (samples: readonly CameraSample[], fromFrame: number, toFrame: number, g: CameraGeometry, s: CameraSettings, fps: number) => CameraPose[];
export type PoseToClip = (g: CameraGeometry, p: CameraPose) => ClipPose;
export type SimplifyPath = (dense: readonly ClipPose[], tolerance: number, maxKeys: number) => { keep: number[]; residual: number };
/** `from` and `to` are clip-local frames of the take's range; samples outside it are ignored. */
export type PlanCamera = (doc: ProjectDocument, input: { clipId: string; from: number; to: number; samples: readonly CameraSample[]; settings: CameraSettings }) => CameraPlan | { refused: CameraRefusal };
