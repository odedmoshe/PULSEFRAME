/**
 * Operations of stabilisation (wave 7 stabilise track; .artifacts/wave7/stabilise-decisions.md §4). Registered on import of this
 * module (index.ts exports it). The lead's pre-pass fixes names, versions, argument schemas, outputs and every refusal (core
 * steadyContract.ts STEADY_REFUSALS; Hebrew packages/i18n/src/stabilise.ts, kept in step by packages/evals/src/stabilise-wording.test.ts).
 *
 * - attach_camera_motion (internal; issued only by the stabilise job) is LEAD-BUILT and final, so the job can commit from round 1.
 * - set_clip_stabilise and remove_camera_motion are W2's: until then each REFUSES with notBuilt and changes nothing.
 *   STEADY_OPS_BUILT turns their fuzz rows on (packages/evals/src/ops-fuzz.gen.ts).
 *
 * RULES OF W2's BODIES (decisions §2, §4)
 * - set_clip_stabilise {clipId, stabilise: {strength?, maxCrop?, zoomPm?} | null}: in order — a media clip on a video track whose
 *   file is a moving picture (notVideo); not a multicam segment (multicam); the file has camera motion covering the clip's shown
 *   frames (notMeasured); at least STEADY_MIN_MEASURED_PERCENT of them ok or weak (tooLittle). strength defaults to 50. maxCrop:
 *   bisect the strength in [STEADY_MIN_STRENGTH, asked] (at most 7 plans), verify, step down from there; at the floor store strength 5
 *   with the zoom of maxCrop and let the cover limit engage (strengthLowered, limitedFrames). zoomPm omitted: the smallest zoom,
 *   rounded UP to 1/1000, covering every frame the clip shows now plus the handle a transition into the next clip plays; given: stored
 *   as is. null switches off (the measurement is kept). The maths is steady.ts STEADY_MATHS_V1, frozen with version 1 of this op.
 *   Output SetClipStabiliseOutput. The editor and the job send dependsOn ['analysis:<assetId>'].
 * - remove_camera_motion {assetId, mode?}: noMeasurement when there is none. mode if-unused (default): refused with inUse while
 *   clips are stabilised with it; unbind: those clips are switched off in the same op; unused-only: removes only the stretches no
 *   stabilised clip shows (its shown frames ± steadyHalfWindow of its strength), keeping the rest. Output RemoveCameraMotionOutput.
 */
import { z } from 'zod';
import { defineOp, OpError } from './ops.ts';
import { analysisEntityId } from './entities.ts';
import { isMovingPicture, videoFrames } from './momentsContract.ts';
import {
  MAX_CAMERA_STRETCHES, MAX_STEADY_SAMPLES, SST, STEADY_COLUMN_PROBLEMS, STEADY_REFUSALS, cameraSamples, projectCameraSamples, projectTrackSamples, stretchEnd,
  type CameraStretch, type ClipStabilise, type SteadyRefusalKey,
} from './steadyContract.ts';
import { MAX_PROJECT_TRACK_SAMPLES } from './tracking.ts';

/** True once W2 has built set_clip_stabilise and remove_camera_motion. */
export const STEADY_OPS_BUILT = false;

interface R<A extends unknown[]> { code: OpError['code']; message: (...a: A) => string; hint?: string }
export function steadyRefusal<K extends SteadyRefusalKey>(key: K, details: Record<string, unknown> = {}, ...args: Parameters<(typeof STEADY_REFUSALS)[K]['message']>): OpError {
  const r = STEADY_REFUSALS[key] as R<unknown[]>;
  return new OpError(r.code, r.message(...args), details, r.hint);
}

const Int = z.number().int();
const Column = z.array(Int).min(1).max(MAX_STEADY_SAMPLES);
export const AttachCameraMotionArgsSchema = z.object({
  assetId: z.string(),
  from: Int.min(0),
  dx: Column, dy: Column, dr: Column, dz: Column, st: Column,
  method: z.string().max(200),
  params: z.record(z.string(), z.union([z.number(), z.string()])),
  createdAt: z.string(),
}).strict();
export type AttachCameraMotionArgs = z.infer<typeof AttachCameraMotionArgsSchema>;
export interface AttachCameraMotionOutput { assetId: string; stretches: number; samples: number; from: number; to: number }

export const SetClipStabiliseArgsSchema = z.object({
  clipId: z.string(),
  stabilise: z.object({
    strength: Int.min(1).max(100).optional().describe('Smoothing strength 1–100 (default 50)'),
    maxCrop: Int.min(1).max(50).optional().describe('Lower the strength until at most this percent of the picture\'s area is cut off (floor strength 5)'),
    zoomPm: Int.min(1000).max(2000).optional().describe('Fixed zoom in 1/1000 (1000 = none); omitted = the smallest zoom that covers the clip'),
  }).strict().nullable().describe('null switches stabilisation off and keeps the measurement'),
}).strict();
export type SetClipStabiliseArgs = z.infer<typeof SetClipStabiliseArgsSchema>;
export interface LimitedFrame { from: number; to: number; reason: 'clip' | 'reach' }
export interface SetClipStabiliseOutput {
  stabilise: ClipStabilise | null;
  crop: { zoomPm: number; areaPercent: number } | null;
  measured: { frames: number; ok: number; weak: number; unknown: number; outside: number };
  strengthLowered: boolean;
  /** Source-frame runs where the cover guarantee weakens the correction (reach: only a ramp or a handle reaches past the clip's range). */
  limitedFrames: LimitedFrame[];
}
export const RemoveCameraMotionArgsSchema = z.object({
  assetId: z.string(),
  mode: z.enum(['if-unused', 'unbind', 'unused-only']).optional().describe('if-unused (default): refused while clips are stabilised with it; unbind: switch those clips off too; unused-only: remove only what no stabilised clip uses'),
}).strict();
export type RemoveCameraMotionArgs = z.infer<typeof RemoveCameraMotionArgsSchema>;
export interface RemoveCameraMotionOutput { assetId: string; removedStretches: number; unbound: string[] }

const RANGES: Record<'dx' | 'dy' | 'dr' | 'dz' | 'st', [number, number]> = { dx: [-200_000, 200_000], dy: [-200_000, 200_000], dr: [-500_000, 500_000], dz: [-300_000, 300_000], st: [0, 3] };

/**
 * Merge a new measured stretch into a file's stretches (pure). Stretches that overlap or touch [a, b) merge with it into one; the
 * new samples replace the frames they cover, except the new sample 0 (a start, no delta): where an old stretch already holds a
 * non-start sample for that frame, it is kept, so extending a stretch is seamless. The merged stretch takes the new origin
 * (v1 has one algorithm; a future algorithm must replace instead of merging). Result ascending, neither overlapping nor touching.
 */
export function mergeCameraStretch(existing: readonly CameraStretch[], next: CameraStretch): CameraStretch[] {
  const a = next.from, b = stretchEnd(next);
  const group = existing.filter((s) => s.from <= b && stretchEnd(s) >= a);
  const rest = existing.filter((s) => !group.includes(s));
  const lo = Math.min(a, ...group.map((s) => s.from)), hi = Math.max(b, ...group.map(stretchEnd));
  const n = hi - lo;
  const out = { dx: new Array<number>(n).fill(0), dy: new Array<number>(n).fill(0), dr: new Array<number>(n).fill(0), dz: new Array<number>(n).fill(0), st: new Array<number>(n).fill(SST.unknown) };
  const cols = ['dx', 'dy', 'dr', 'dz', 'st'] as const;
  const covered = new Uint8Array(n);
  for (const s of group) for (let i = 0; i < s.st.length; i++) { const k = s.from - lo + i; for (const c of cols) out[c][k] = s[c][i]!; covered[k] = 1; }
  for (let i = 0; i < next.st.length; i++) {
    const k = a - lo + i;
    if (i === 0 && next.st[0] === SST.start && covered[k] && out.st[k] !== SST.start) continue;
    for (const c of cols) out[c][k] = next[c][i]!;
  }
  const merged: CameraStretch = { from: lo, ...out, origin: next.origin };
  return [...rest, merged].sort((x, y) => x.from - y.from);
}

defineOp({
  name: 'attach_camera_motion',
  version: 1,
  internal: true,
  checksOwnIds: ['assetId'],
  description: 'Attach camera motion measured by the model-free stabilise job: one sample per source frame of a video file (translation, rotation, scale of the static scene between consecutive frames, and a state). Merges with the file\'s earlier measurements it overlaps or touches; keeps its scene, beat and moment analyses.',
  args: AttachCameraMotionArgsSchema,
  apply(d, a, ctx) {
    const asset = Object.hasOwn(d.assets, a.assetId) ? d.assets[a.assetId] : undefined;
    if (!asset) throw steadyRefusal('assetMissing', { assetId: a.assetId });
    if (!isMovingPicture(asset)) throw steadyRefusal('noVideoFile', { assetId: asset.id });
    const n = a.st.length;
    if (a.dx.length !== n || a.dy.length !== n || a.dr.length !== n || a.dz.length !== n) throw steadyRefusal('badColumns', { assetId: asset.id }, STEADY_COLUMN_PROBLEMS[0]);
    for (const c of ['dx', 'dy', 'dr', 'dz', 'st'] as const) {
      const [min, max] = RANGES[c];
      if (a[c].some((v) => v < min || v > max)) throw steadyRefusal('badColumns', { assetId: asset.id, column: c }, STEADY_COLUMN_PROBLEMS[1]);
    }
    if (a.st[0] !== SST.start) throw steadyRefusal('firstNotStart', { assetId: asset.id });
    const frames = videoFrames(asset)!;
    if (a.from + n > frames) throw steadyRefusal('outsideFile', { assetId: asset.id, end: a.from + n, frames }, a.from + n, frames);
    const cur = Object.hasOwn(d.analyses, asset.id) ? d.analyses[asset.id]! : { assetId: asset.id };
    const next: CameraStretch = { from: a.from, dx: [...a.dx], dy: [...a.dy], dr: [...a.dr], dz: [...a.dz], st: [...a.st], origin: { method: a.method, params: { ...a.params }, createdAt: a.createdAt, createdBy: ctx.actor } };
    const stretches = mergeCameraStretch(cur.cameraMotion?.stretches ?? [], next);
    const samples = cameraSamples({ stretches });
    if (samples > MAX_STEADY_SAMPLES) throw steadyRefusal('fileFull', { assetId: asset.id, samples, max: MAX_STEADY_SAMPLES }, samples);
    if (stretches.length > MAX_CAMERA_STRETCHES) throw steadyRefusal('tooManyStretches', { assetId: asset.id, stretches: stretches.length, max: MAX_CAMERA_STRETCHES });
    const total = projectTrackSamples(d) + projectCameraSamples(d) - cameraSamples(cur.cameraMotion) + samples;
    if (total > MAX_PROJECT_TRACK_SAMPLES) throw steadyRefusal('budget', { samples: total, max: MAX_PROJECT_TRACK_SAMPLES }, total, MAX_PROJECT_TRACK_SAMPLES);
    d.analyses[asset.id] = { ...cur, cameraMotion: { stretches } };
    const output: AttachCameraMotionOutput = { assetId: asset.id, stretches: stretches.length, samples, from: a.from, to: a.from + n };
    return { affectedIds: [analysisEntityId(asset.id)], summary: `Measured the camera motion of ${n} frame(s)`, output: output as unknown as Record<string, unknown> };
  },
});

const notBuilt = (op: string) => () => { throw steadyRefusal('notBuilt', { op }, op); };
defineOp({
  name: 'set_clip_stabilise',
  version: 1,
  description: 'Steady the picture of a video clip with the camera motion measured on its file (model-free: translation, rotation and zoom of the camera; rolling-shutter "jelly" and perspective are not corrected). The edges are cut off by a constant zoom so no empty edge ever shows; the output states the crop. strength 1–100 (default 50); maxCrop lowers the strength until the crop fits; null switches it off and keeps the measurement. Refused until the file\'s motion is measured (stabilise_clip / POST …/clips/{clipId}/stabilise).',
  args: SetClipStabiliseArgsSchema,
  apply: notBuilt('set_clip_stabilise'),
});
defineOp({
  name: 'remove_camera_motion',
  version: 1,
  checksOwnIds: ['assetId'],
  description: 'Remove the camera motion measured on a video file. Refused while clips are stabilised with it, unless mode is unbind (they are switched off too) or unused-only (only the stretches no stabilised clip uses are removed, to free space).',
  args: RemoveCameraMotionArgsSchema,
  apply: notBuilt('remove_camera_motion'),
});
