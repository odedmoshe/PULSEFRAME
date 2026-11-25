/**
 * Stabilisation, model-free («ייצוב תמונה»; wave 7 stabilise track, .artifacts/wave7/stabilise-decisions.md). LEAD-OWNED CONTRACT:
 * the schemas, units, caps, the integer half-window rule, the job's wire shapes and every refusal sentence of the operations.
 * This file must not import ./schema.ts at runtime (schema.ts imports it), like tracking.ts.
 *
 * What is stored. The camera's motion is measured once per SOURCE frame of a video file (numbered as evaluate.ts barePicture numbers
 * frames, core sourceFrameIndexAt) and kept on the file's analysis record as a list of measured STRETCHES (`analysis.cameraMotion`).
 * Sample i of a stretch is the motion of the static scene from frame from+i-1 to frame from+i, as a similarity about the picture
 * centre: translation dx, dy in 1/STEADY_UNIT of the source picture WIDTH (both axes), rotation dr in micro-radians clockwise
 * (as Transform.rotation), scale dz as ln(scale) × 1e6. Sample 0 of every stretch is `start` and carries no delta. A clip carries
 * only a switch (`stabilise: {strength, zoomPm}`); evaluate composes the correction per picture at that picture's own source frame,
 * so trims, splits, speed, reverse, ramps, freeze frames and time taps are exact by construction.
 *
 * Nothing here calls a model. Everything measured is a heuristic and is said to be one.
 */
import { z } from 'zod';
import type { OpErrorCode } from './ops.ts';
import type { Asset, ProjectDocument } from './schema.ts';

/** Translation unit: 1/100000 of the source picture's WIDTH, on both axes. */
export const STEADY_UNIT = 100_000;
/** Rotation unit: micro-radians, clockwise positive (as Transform.rotation). */
export const STEADY_ANGLE_UNIT = 1_000_000;
/** Scale unit: ln(scale) × 1e6. */
export const STEADY_SCALE_UNIT = 1_000_000;
/** The samples one file's stretches hold together (the motion-track figure, tracking.ts MAX_TRACK_SAMPLES). */
export const MAX_STEADY_SAMPLES = 10_800;
/** Separate measured stretches per file. A stretch that overlaps or touches another merges with it. */
export const MAX_CAMERA_STRETCHES = 16;
/** The longest half-window, in frames (strength 100 at 96 fps would pass it). */
export const MAX_STEADY_HALF_WINDOW = 240;
/** States of a camera sample. start: the first frame of a measured stretch or of a shot (no delta into it). */
export const STEADY_STATES = ['unknown', 'ok', 'weak', 'start'] as const;
export type SteadyStateName = (typeof STEADY_STATES)[number];
export const SST = { unknown: 0, ok: 1, weak: 2, start: 3 } as const satisfies Record<SteadyStateName, number>;
/** The share of a clip's shown frames that must be `ok` or `weak` before it may be stabilised (percent). */
export const STEADY_MIN_MEASURED_PERCENT = 50;
/** Defaults of the one-press action: strength, and the crop the strength is lowered to fit (percent of the picture's area). */
export const STEADY_DEFAULT_STRENGTH = 50;
export const STEADY_DEFAULT_MAX_CROP = 15;
/** The strength `maxCrop` never lowers below. */
export const STEADY_MIN_STRENGTH = 5;
/** Version of the smoothing and zoom maths (steady.ts). Frozen with op version 1 of set_clip_stabilise: replay must give the same bits. */
export const STEADY_MATHS_V1 = 1;
/** The kernel's version, stored as origin.params.algo; frames measured with the same algo and input are not read again. */
export const STEADY_ALGO = 1;

const I = z.number().int();
const Col = (min: number, max: number) => z.array(I.min(min).max(max)).min(1).max(MAX_STEADY_SAMPLES);
/** How a stretch was measured. params.algo (number) and params.input ('proxy' | 'original') are always set; lists are comma-joined strings. */
export const CameraStretchOriginSchema = z.object({ method: z.string().max(200), params: z.record(z.string(), z.union([z.number(), z.string()])), createdAt: z.string(), createdBy: z.string() }).strict();
export const CameraStretchSchema = z.object({
  /** Source frame of sample 0. */
  from: I.min(0),
  dx: Col(-200_000, 200_000),
  dy: Col(-200_000, 200_000),
  dr: Col(-500_000, 500_000),
  dz: Col(-300_000, 300_000),
  st: Col(0, 3),
  origin: CameraStretchOriginSchema,
}).strict();
export type CameraStretch = z.infer<typeof CameraStretchSchema>;
/** analysis.cameraMotion: ascending stretches that neither overlap nor touch (validate.ts camera_motion). */
export const CameraMotionSchema = z.object({ stretches: z.array(CameraStretchSchema).min(1).max(MAX_CAMERA_STRETCHES) }).strict();
export type CameraMotion = z.infer<typeof CameraMotionSchema>;
/** MediaClip.stabilise: the switch. zoomPm = the constant zoom of the clip in 1/1000 (1000 = none). */
export const ClipStabiliseSchema = z.object({ strength: I.min(1).max(100), zoomPm: I.min(1000).max(2000) }).strict();
export type ClipStabilise = z.infer<typeof ClipStabiliseSchema>;

export const stretchLength = (s: CameraStretch): number => s.st.length;
/** The source frame after the stretch's last sample. */
export const stretchEnd = (s: CameraStretch): number => s.from + s.st.length;
export const cameraSamples = (m: CameraMotion | undefined): number => (m ? m.stretches.reduce((n, s) => n + s.st.length, 0) : 0);
/** Camera samples of the whole project (they share MAX_PROJECT_TRACK_SAMPLES with the motion tracks). */
export const projectCameraSamples = (doc: Pick<ProjectDocument, 'analyses'>): number => Object.values(doc.analyses ?? {}).reduce((n, a) => n + cameraSamples(a.cameraMotion), 0);
/** Motion-track samples of the whole project. */
export const projectTrackSamples = (doc: Pick<ProjectDocument, 'motionTracks'>): number => Object.values(doc.motionTracks ?? {}).reduce((n, t) => n + t.x.length, 0);

/**
 * The smoothing half-window R in frames for a strength (1..100) at a frame rate, in integers only:
 * ms = 100 + round(24·s²/100) (s = 1: 100 ms; 50: 700 ms; 100: 2500 ms), R = max(1, min(240, round(ms·rate/1000))), halves up.
 */
export function steadyHalfWindow(strength: number, rate: { num: number; den: number }): number {
  const s = Math.max(1, Math.min(100, Math.trunc(strength)));
  const ms = 100 + Math.floor((48 * s * s + 100) / 200);
  return Math.max(1, Math.min(MAX_STEADY_HALF_WINDOW, Math.floor((2 * ms * rate.num + 1000 * rate.den) / (2000 * rate.den))));
}
/** The frames the job measures on each side of a clip's own frames: R at strength 100 for the file's rate, so the slider never needs a second measurement. */
export const steadyMarginFrames = (rate: { num: number; den: number }): number => steadyHalfWindow(100, rate);
/** The stated crop of a zoom: the share of the picture's area cut off, in percent with one decimal. */
export const cropAreaPercent = (zoomPm: number): number => Math.round(1000 * (1 - 1_000_000 / (zoomPm * zoomPm))) / 10;
/** The frame rate a file's frames are numbered at (its video stream's rate). */
export const assetRate = (asset: Pick<Asset, 'video'>): { num: number; den: number } | null => (asset.video ? { num: asset.video.frameRate.num, den: asset.video.frameRate.den } : null);

// ---------- refusals of the operations (Hebrew: packages/i18n/src/stabilise.ts HE_STABILISE; packages/evals/src/stabilise-wording.test.ts) ----------
interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
/** Every refusal of the stabilise operations, and the shared-budget sentence of the motion tracks. The messages are fixed: HE_STABILISE recognises them by their shape. */
export const STEADY_REFUSALS = {
  notBuilt: refusal('unknown_op', (op: string) => `${op}: stabilisation is not built in this build yet`, 'Update the editor and try again.'),
  notVideo: refusal('incompatible', () => 'only a video clip on a video track can be stabilised', 'Select a video clip.'),
  multicam: refusal('incompatible', () => 'a multicam segment cannot be stabilised yet', 'Detach it from the multicam group first.'),
  notMeasured: refusal('incompatible', () => 'the camera motion has not been measured for the part of the file this clip shows', 'Measure it first: POST /api/v1/projects/{id}/clips/{clipId}/stabilise (MCP stabilise_clip).'),
  tooLittle: refusal('incompatible', (percent: number) => `only ${percent}% of this clip's frames could be measured: the picture has too little detail or moves too fast`, 'Stabilise a calmer, more detailed part of the video.'),
  clipTooLong: refusal('out_of_bounds', (frames: number) => `this clip shows ${frames} frames with its margins; at most ${MAX_STEADY_SAMPLES} can be measured at once`, 'Split the clip and stabilise each part.'),
  fileFull: refusal('out_of_bounds', (frames: number) => `the measurements of this file would hold ${frames} frames; at most ${MAX_STEADY_SAMPLES}`, 'Remove the measurements no stabilised clip uses (remove_camera_motion mode unused-only).'),
  tooManyStretches: refusal('out_of_bounds', () => `this file would have more than ${MAX_CAMERA_STRETCHES} separate measured stretches`, 'Remove the measurements no stabilised clip uses (remove_camera_motion mode unused-only).'),
  budget: refusal('out_of_bounds', (total: number, max: number) => `the motion tracks and camera measurements of a project can hold at most ${max} samples in all; this edit would make ${total}`, 'Delete a motion track or a camera measurement that is no longer needed, or use a shorter stretch.'),
  inUse: refusal('incompatible', (n: number) => `${n} clip(s) are stabilised with this measurement`, 'Pass mode unbind to switch them off too, or mode unused-only to keep what they use.'),
  otherFile: refusal('incompatible', () => 'this clip is stabilised with a measurement of its current file; switch stabilisation off before giving it another file', 'set_clip_stabilise with stabilise null, then replace the file.'),
  noMeasurement: refusal('not_found', () => 'this file has no camera measurement', 'Nothing to remove.'),
  assetMissing: refusal('not_found', () => 'the file of this camera measurement is not in the library', 'Measure again.'),
  noVideoFile: refusal('incompatible', () => 'only a moving picture has camera motion', 'Choose a video file.'),
  badColumns: refusal('invalid_args', (why: string) => `the camera measurement is malformed: ${why}`, 'Measure again.'),
  outsideFile: refusal('out_of_bounds', (end: number, frames: number) => `the camera measurement ends at frame ${end}, but the file has ${frames} frames`, 'Measure again.'),
  firstNotStart: refusal('invalid_args', () => 'the first sample of a camera measurement must be a start sample', 'Measure again.'),
} as const;
export type SteadyRefusalKey = keyof typeof STEADY_REFUSALS;
/** Reasons badColumns carries (the Hebrew table words each). */
export const STEADY_COLUMN_PROBLEMS = ['the columns differ in length', 'a column holds a value out of range'] as const;

// ---------- the job and the read view (apps/server/src/stabilise.ts) ----------
export const STABILISE_JOB_TYPE = 'stabilise' as const;
/** Job stage text; i18n STAGE_WORDS keys: 'reading frames', 'measuring camera motion', 'saving camera motion'. */
export const stabiliseStage = (phase: 'reading' | 'measuring' | 'saving', done = 0, total = 0): string =>
  phase === 'reading' ? 'reading frames' : phase === 'saving' ? 'saving camera motion' : `measuring camera motion ${done}/${total}`;
/** POST …/clips/:clipId/stabilise body. strength/maxCrop default to STEADY_DEFAULT_STRENGTH / STEADY_DEFAULT_MAX_CROP. */
export const StabiliseRunBodySchema = z.object({
  strength: I.min(1).max(100).optional().describe('Smoothing strength 1–100 (default 50)'),
  maxCrop: I.min(1).max(50).optional().describe('Lower the strength until at most this percent of the picture\'s area is cut off (default 15; floor strength 5)'),
  input: z.enum(['proxy', 'original']).optional().describe('Read the editing proxy (default, when ready) or the stored original'),
}).strict();
export type StabiliseRunBody = z.infer<typeof StabiliseRunBodySchema>;
export interface StabiliseJobInput { clipId: string; assetId: string; from: number; to: number; strength: number; maxCrop: number; input: 'proxy' | 'original'; analysisVersion: number | null; projectRevision: number }
/** applied: false never happens in v1 (a changed clip fails the job with clip_changed); kept for the wire shape. */
export interface StabiliseJobOutput { assetId: string; clipId: string; measuredFrames: number; readFrames: number; applied: boolean; crop?: { zoomPm: number; areaPercent: number }; strengthLowered?: boolean }
/** GET …/assets/:assetId/camera-motion. Counts and ranges only: the columns stay in the project document. */
export interface CameraMotionView {
  revision: number; assetId: string;
  stretches: { from: number; to: number; origin: CameraStretch['origin'] }[];
  counts: Record<SteadyStateName, number>;
  /** Runs of weak or unknown samples and the starts inside a stretch (source frames), at most 200. */
  review: { from: number; to: number; state: 'weak' | 'unknown' | 'start' }[];
  usedBy: string[];
  note: string;
}
