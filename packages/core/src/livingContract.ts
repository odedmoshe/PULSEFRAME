/**
 * «תמונה חיה» — a still photograph that moves slowly in depth (wave 8 living track; .artifacts/wave8/living-plan.md as corrected by
 * living-verify.md C1–C14 and the lead's decisions). LEAD-OWNED CONTRACT, frozen after the pre-pass: builders report a change here,
 * they do not make it.
 *
 * What is stored. A photo clip carries `depth` (ClipDepth below): the owner's own drawing of what is near and what is far — a base
 * (a ramp below a horizon line, or flat) and up to 64 soft brush strokes «קרוב / רחוק», at most 8192 integers. It is ordinary
 * document data, like a mask or a privacy region (lead decision LD4): agents read it, archives keep it. Nothing computed is stored:
 * there is NO model member in version 1 (decisions: the whole model end is cut; adding a union member later is additive).
 * The motion is the effect `depth.living` (effects.ts row; stir 'none', verifier C12) whose `travel` parameter is keyed 0 → 1 over
 * the clip by set_living_picture. It is added ONLY by that op (opOnlyEffect): add_effect refuses it, and every generic path that
 * adds effects leaves it out (verifier C4).
 *
 * Units. Shifts are fractions of the FRAME HEIGHT (house rule, effects.ts header). Depth coordinates are integers in 1/1000 of the
 * picture AS SHOWN (after the import's orientation handling; asset image.width/height). Nearness 0 = far, 255 = near.
 *
 * Both limits below are rules of thumb, not judged and not a medical check («כלל אצבע, לא בדיקה רפואית»): nobody has looked at
 * the result. This file imports zod only (schema.ts imports it).
 */
import { z } from 'zod';
import type { OpErrorCode } from './ops.ts';

/** The effect registry id (effects.ts). */
export const LIVING_EFFECT = 'depth.living' as const;
/**
 * The two moves of version 1: «התקרבות» (push in, the default: the ramp reads best with it) and «גלישה הצידה» (slide toward the end
 * of reading). Orbit «סיבוב עדין», peek «הצצה» and the direction switch are cut (verifier C1 and Cut first 2).
 */
export const LIVING_MOVES = ['push', 'slide'] as const;
export type LivingMove = (typeof LIVING_MOVES)[number];
/** The curves set_living_picture writes on `travel` (the first key's easing; ADR-0019 ids). */
export const LIVING_CURVES = ['ease-in-out', 'linear', 'gentle'] as const;
export type LivingCurve = (typeof LIVING_CURVES)[number];
export const LIVING_DEFAULTS = { move: 'push', amount: 0.5, curve: 'ease-in-out' } as const satisfies { move: LivingMove; amount: number; curve: LivingCurve };

/** Largest shift between the nearest and the farthest point at amount 1, as a fraction of the frame height. A reasoned rule of thumb (plan §4.2), not judged. */
export const LIVING_MAX_SHIFT = 0.03;
/** Comfort rule of thumb: the relative shift may change by at most this fraction of the frame height per second (plan §4.3). */
export const LIVING_MAX_RATE = 0.02;
/** Shorter clips are refused (living_too_short). */
export const LIVING_MIN_SECONDS = 1;
/** The nearness (0..1) that stays still, per move: push keeps the far plane still, slide turns about the middle. */
export const LIVING_FOCUS: Readonly<Record<LivingMove, number>> = { push: 0, slide: 0.5 };
/**
 * How far the relative shift travels over travel 0 → 1, in units of A = amount · LIVING_MAX_SHIFT: push d = A·u (span 1),
 * slide d = A·(2u − 1) (span 2). The comfort arithmetic uses only this (verifier C1).
 */
export const LIVING_SPAN: Readonly<Record<LivingMove, number>> = { push: 1, slide: 2 };
/**
 * The real peak slope of each curve's shape on [0, 1] (verifier C1): linear 1; ease-in-out (animation.ts 4u³ / 1 − (−2u+2)³/2) 3 at
 * u = ½, in closed form; gentle (cubic-bezier .25,.1,.25,1, keyframe.ts) 2.288061…, found once by a dense search and frozen here
 * rounded UP (livingComfort.test.ts recomputes it). Never searched at run time.
 */
export const LIVING_PEAK_SLOPE: Readonly<Record<LivingCurve, number>> = { linear: 1, 'ease-in-out': 3, gentle: 2.2881 };

// ---------------------------------------------------------------- the depth record
/** The hand grid: long side 256 cells, short side round(256 · short / long), at least 16 (depthGridSize). */
export const DEPTH_HAND_LONG_SIDE = 256;
export const DEPTH_HAND_MIN_SIDE = 16;
/** The nearness a brush paints. */
export const DEPTH_LAYER_VALUE = { near: 255, far: 0 } as const;
export const DEPTH_LAYERS = ['near', 'far'] as const;
export const MAX_DEPTH_STROKES = 64;
/** Numbers (x and y counted apart) in one stroke, and in the whole record. */
export const MAX_STROKE_NUMBERS = 512;
export const MAX_DEPTH_NUMBERS = 8192;
/** The rasteriser's version, frozen with op version 1: a replayed document gives the same bytes (depthKey covers it). */
export const DEPTH_RASTER_V1 = 1;
/**
 * The soft edge of a brush, as integer weights out of 256 (DEPTH_WEIGHT_ONE): full weight inside half the radius, then entry i
 * at distance r/2 + i·(r/2)/16 (i = 0…16), zero at the radius. Values: round(256 · (1 − smoothstep(i/16))). depthGrid (W1) uses
 * exactly these numbers; the contract freezes them so Node and Chromium give the same bytes.
 */
export const DEPTH_FALLOFF: readonly number[] = Object.freeze([256, 253, 245, 232, 216, 197, 175, 152, 128, 104, 81, 59, 40, 24, 11, 3, 0]);
export const DEPTH_WEIGHT_ONE = 256;
/**
 * RESERVED for a model depth map in a later wave, NOT built in version 1 (verifier C8, LD6): widen nearness by 2 texels (a max
 * filter), then a 5×5 binomial blur (weights 1 4 6 4 1 per axis, /256, round half up). Hand strokes are already soft and never get it.
 */
export const DEPTH_MODEL_WIDEN_BLUR = Object.freeze({ dilateTexels: 2, blurWeights: Object.freeze([1, 4, 6, 4, 1]), blurDivisor: 256, appliesTo: 'model maps only (not in version 1)' });

const I = z.number().int();
export const DepthStrokeSchema = z.object({
  layer: z.enum(DEPTH_LAYERS),
  /** Brush radius in 1/1000 of the picture's SHORT side. */
  size: I.min(5).max(300),
  /** x,y pairs in 1/1000 of the shown picture's width and height; an even count (validated: depthProblems). One point = a dab. */
  pts: z.array(I.min(0).max(1000)).min(2).max(MAX_STROKE_NUMBERS),
}).strict();
export type DepthStroke = z.infer<typeof DepthStrokeSchema>;
export const ClipDepthSchema = z.object({
  v: z.literal(1),
  base: z.discriminatedUnion('kind', [
    /** Far (0) above the horizon; below it nearness rises evenly to 255 at the bottom: round(255 · (y − h) / (1000 − h)). */
    z.object({ kind: z.literal('ramp'), horizon: I.min(0).max(999) }).strict(),
    /** The whole picture far (0); the strokes say what is near. */
    z.object({ kind: z.literal('flat') }).strict(),
  ]),
  /** Later strokes are laid over earlier ones. */
  strokes: z.array(DepthStrokeSchema).max(MAX_DEPTH_STROKES),
}).strict();
export type ClipDepth = z.infer<typeof ClipDepthSchema>;
/** The dialog's starting point when the clip has no depth yet (C13): shown, never stored until «שמירה». */
export const LIVING_RAMP_START: ClipDepth = Object.freeze({ v: 1, base: Object.freeze({ kind: 'ramp', horizon: 450 }), strokes: Object.freeze([]) as unknown as DepthStroke[] }) as ClipDepth;

/** Numbers in a depth record (each stroke's pts). */
export const depthNumbers = (depth: ClipDepth): number => depth.strokes.reduce((n, s) => n + s.pts.length, 0);
/** What the schema cannot say about a depth record, in English (empty = valid). Used by validate.ts and the two ops. */
export function depthProblems(depth: ClipDepth): string[] {
  const out: string[] = [];
  depth.strokes.forEach((s, i) => { if (s.pts.length % 2) out.push(`stroke ${i + 1} has an odd number of coordinates`); });
  const n = depthNumbers(depth);
  if (n > MAX_DEPTH_NUMBERS) out.push(`the strokes hold ${n} numbers; at most ${MAX_DEPTH_NUMBERS}`);
  return out;
}
/** The hand grid's size for a picture shown at width × height (any units; only the aspect counts). */
export function depthGridSize(shown: { width: number; height: number }): { width: number; height: number } {
  const w = Math.max(1, shown.width), h = Math.max(1, shown.height);
  const short = Math.max(DEPTH_HAND_MIN_SIDE, Math.round((DEPTH_HAND_LONG_SIDE * Math.min(w, h)) / Math.max(w, h)));
  return w >= h ? { width: DEPTH_HAND_LONG_SIDE, height: short } : { width: short, height: DEPTH_HAND_LONG_SIDE };
}
/** The nearness grid the pass reads: one byte per cell, row-major, 255 = near (depthGrid, W1). */
export interface DepthGrid { width: number; height: number; data: Uint8Array }

/**
 * The search steps of the pass (verifier C7), from the largest relative shift measured in DEPTH-GRID texels, so the count is the same
 * at every output size (draft, paused preview, still and export agree): K = clamp(2·⌈shift⌉ + 3, 9, 64).
 */
export const LIVING_STEPS = { min: 9, max: 64 } as const;
export const livingSteps = (shiftTexels: number): number => Math.min(LIVING_STEPS.max, Math.max(LIVING_STEPS.min, 2 * Math.ceil(Math.max(0, shiftTexels) - 1e-9) + 3));

// ---------------------------------------------------------------- which effects only an op adds
/** Effects that only their own op adds (verifier C4): every generic path that adds or copies effects leaves these out. */
export const OP_ONLY_EFFECTS: Readonly<Record<string, string>> = Object.freeze({ [LIVING_EFFECT]: 'set_living_picture' });
export const opOnlyEffect = (type: string): boolean => Object.hasOwn(OP_ONLY_EFFECTS, type);

/** W1 sets this when set_living_picture's body and depthGrid are built and tested. The op refuses notBuilt until then. */
export const LIVING_BUILT: boolean = false;

// ---------------------------------------------------------------- operations
export const SetLivingPictureArgsSchema = z.object({
  clipId: z.string(),
  depth: ClipDepthSchema.optional().describe('the depth drawn on the photo; required when the clip has none yet (no depth is ever guessed and stored)'),
  move: z.enum(LIVING_MOVES).optional().describe('push = a slow push in (default); slide = a slow slide toward the end of reading'),
  amount: z.number().min(0).max(1).optional().describe('0..1, default 0.5; capped by the clip length (comfort rule of thumb, refused above it with the highest amount that fits)'),
  curve: z.enum(LIVING_CURVES).optional().describe('the shape of the move over the clip, default ease-in-out'),
  remove: z.literal(true).optional().describe('remove the living picture and its keys; the drawn depth stays (set_clip_depth null removes it)'),
}).strict();
export type SetLivingPictureArgs = z.infer<typeof SetLivingPictureArgsSchema>;
export const SetClipDepthArgsSchema = z.object({
  clipId: z.string(),
  depth: ClipDepthSchema.nullable().describe('the whole depth record, replaced at once; null removes it (refused while the clip has a living picture)'),
}).strict();
export type SetClipDepthArgs = z.infer<typeof SetClipDepthArgsSchema>;
export interface SetLivingPictureOutput { effectId: string | null; move: LivingMove; amount: number; maxAmount: number; replacedMotion: string[] }

// ---------------------------------------------------------------- refusals (Hebrew: packages/i18n/src/living.ts HE_LIVING)
export interface LivingRefusalRow<A extends unknown[]> { code: OpErrorCode; why: string; message: (...a: A) => string; hint: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, why: string, message: (...a: A) => string, hint: string): LivingRefusalRow<A> => ({ code, why, message, hint });
/** Existing codes only (multicam precedent); `why` goes into details.why and names the case for the editor and agents. */
export const LIVING_REFUSALS = {
  notBuilt: refusal('unknown_op', 'living_not_built', () => 'set_living_picture: the living picture is not built in this build yet', 'Nothing was changed. Update the editor and try again.'),
  notPhoto: refusal('incompatible', 'living_not_photo', () => 'a living picture works on photos only, not on video or titles', 'Choose a photo clip on a picture track.'),
  tooShort: refusal('out_of_bounds', 'living_too_short', () => 'the clip is shorter than one second, so the picture is not moved', 'Lengthen the clip to at least one second.'),
  tooFast: refusal('out_of_bounds', 'living_too_fast', (max: number) => `this clip is too short for that amount; the highest amount that fits it: ${max}`, 'Lower the amount, choose push, or lengthen the clip.'),
  needsDepth: refusal('incompatible', 'living_needs_depth', () => 'a living picture needs a depth drawn on the photo', 'Pass depth, or draw it first (the Motion tab: «ציירו עומק»; set_clip_depth).'),
  depthInUse: refusal('incompatible', 'living_needs_depth', () => 'remove the living picture first, then its depth', 'set_living_picture with remove true, then set_clip_depth with depth null.'),
  useOp: refusal('incompatible', 'living_use_op', () => 'a living picture is added with set_living_picture (the Motion tab), not with add_effect', 'Call set_living_picture with the clip and its depth.'),
  rotated: refusal('incompatible', 'living_rotated', () => 'a living picture works on a picture that is not rotated', 'Set the rotation to 0 (set_clip_transform), then try again.'),
  depthInvalid: refusal('invalid_args', 'depth_invalid', (why: string) => `the painted depth is not valid: ${why}`, 'Draw the depth again («ציירו עומק»).'),
  depthOtherFile: refusal('incompatible', 'depth_other_file', () => 'the depth of this clip was drawn on its current photo', 'Remove the living picture and its depth first (set_clip_depth null), or keep this photo.'),
} as const;
export type LivingRefusalKey = keyof typeof LIVING_REFUSALS;
/** adjustmentRefusal's sentence for depth.living (validate.ts): an adjustment clip has no picture of its own. */
export const LIVING_ON_ADJUSTMENT = 'a living picture needs a photo of its own; an adjustment clip has none';

/** Why a clip with an enabled living picture cannot be drawn (verifier C6; rotated picture-in-picture is cut): never drawn flat. */
export const LIVING_UNAVAILABLE = ['no_depth', 'rotated'] as const;
export type LivingUnavailable = (typeof LIVING_UNAVAILABLE)[number];

/** Preflight warning codes (W1, apps/server/src/preflight.ts): non-blocking, with jump-to; wording in packages/i18n/src/living.ts. */
export const LIVING_PREFLIGHT = { tooFast: 'living_too_fast', noDepth: 'living_no_depth', rotated: 'living_rotated' } as const;

/** Thrown by a pure function of this track that is not built yet (depthGrid.ts, living.ts stubs). */
export class LivingNotBuiltError extends Error {
  readonly code = 'living_not_built';
  constructor(readonly fn: string) { super(`${fn}: the living picture is not built in this build yet`); }
}
