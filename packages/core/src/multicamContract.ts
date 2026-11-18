/**
 * Multicam (ADR-0020, «סנכרון וחיתוך»): sync angles by sound, switch angles on a timeline. The shared contract of the multicam
 * operations, the server's sync job and auto-switch, and the editor. Lead-owned; the bodies are the workers' (W1 core:
 * multicam.ts and multicamOps.ts bodies, validate.ts overlap rule; W2 server: envelopes, sync, auto-switch, routes; W3 editor).
 *
 * FIXED RULES (plan §1 with wave4-decisions.md, which wins):
 * - Flattened group, never nesting: doc.multicam[groupId] holds angles, their files (pieces), a sync map per piece, the look
 *   per angle, speakers and the wide angle; the program is ordinary media clips tagged {groupId, angleId}.
 * - Group time follows the main sound recorder: the reference angle defaults to the first sound angle, else angle 0. Its piece 0
 *   has anchors exactly [{0,0}] and verdict 'reference'; every other piece starts 'unsynced' with no anchors.
 * - Exact maths, one rounding (ADR-0003): maps in BigInt fractions, one quantise to multicam.ts syncGrid. Drift never becomes
 *   speed: picture gets invisible through-edits, a second recorder that drifts is laid as consecutive sound chunks
 *   (≤ 0.5 ms error, 1-frame overlaps with 1-frame fades; nobody has listened to the joins yet).
 * - A look stays with the angle: switching takes the target angle's transform, x/y/scale/rotation keys, non-time effects, mask,
 *   blend, per-format transforms, and its PIECE's redact and follow (privacy regions follow each angle's own file); it keeps
 *   opacity keys, transition, fades, gain and speed; what it drops is reported (SwitchAnglesOutput.dropped).
 * - Measured sync is attached only by the server (internal attach_multicam_sync, the attach_analysis precedent); hand
 *   corrections go through public set_multicam_sync (verdict 'manual'). A tagged segment keeps its group time when its piece's
 *   map changes (it is remapped in the same step).
 * - AI-derived copies on multicam segments are refused in wave 1 (replace_clip_asset, replace_clip_media: taggedClip).
 * - One step changes at most MAX_TOUCHED_ENTITIES entities (its undo fits one restore_entities).
 * - Capture dates (ADR-0021) are a PRIOR only (multicamPrior.ts): they order and window the sound search and are offered as a
 *   labelled hand choice for a file with no shared sound; they are never attached as a measured sync.
 * - evaluate, the compositor, audioPlan, render_frame, both exports and the render cache are unchanged (ADR-0005): the tag is
 *   inert, and a switch changes assetId/sourceIn, which the frame key already covers.
 */
import { z } from 'zod';
import type * as T from '@pulseframe/time';
import { MulticamSpeakerSchema, RationalTimeSchema as RT, SyncAnchorSchema, SyncQualitySchema } from './schema.ts';
import { ANGLE_KINDS, MAX_ANCHORS_PER_PIECE, MAX_ANGLES, MAX_CUTS, MAX_PIECES, MAX_SPEAKERS } from './multicamLimits.ts';
import { OpError } from './ops.ts';
import { MULTICAM_REFUSALS, type MulticamRefusalKey, type MulticamRefusalRow } from './multicamRefusals.ts';

export * from './multicamLimits.ts';
export * from './multicamRefusals.ts';

/** The public multicam operations (MCP exposes them; the operations fuzz draws them once built). */
export const MULTICAM_OPS = ['create_multicam', 'set_multicam_sync', 'update_multicam', 'set_angle_look', 'place_multicam', 'switch_angles', 'detach_from_multicam', 'remove_multicam'] as const;
/** The internal one: measured sync maps from the server's sync job. */
export const MULTICAM_SYNC_OP = 'attach_multicam_sync' as const;

// ---------- arguments (final; W1 may refine descriptions, not shapes) ----------
export const CreateMulticamArgs = z.object({
  name: z.string().min(1).max(80).optional(),
  angles: z.array(z.object({
    label: z.string().min(1).max(40).optional().describe('default «מצלמה N» / «מיקרופון N»'),
    kind: z.enum(ANGLE_KINDS).optional().describe('default: picture when the first file has a picture, else sound'),
    assetIds: z.array(z.string()).min(1).max(MAX_PIECES).describe('the files of this camera or recorder, in recording order'),
  }).strict()).min(2).max(MAX_ANGLES),
  referenceAngleIndex: z.number().int().min(0).max(MAX_ANGLES - 1).optional().describe('default: the first sound angle, else 0 (group time follows the main sound recorder)'),
}).strict();
export const AttachMulticamSyncArgs = z.object({
  groupId: z.string(), createdAt: z.string(), method: z.string().max(200), params: z.record(z.string(), z.union([z.number(), z.string()])),
  pieces: z.array(z.object({ angleId: z.string(), pieceIndex: z.number().int().min(0).max(MAX_PIECES - 1), anchors: z.array(SyncAnchorSchema).max(MAX_ANCHORS_PER_PIECE), quality: SyncQualitySchema }).strict()).min(1).max(MAX_ANGLES * MAX_PIECES),
  overwrite: z.boolean().optional(),
}).strict();
export const SetMulticamSyncArgs = z.object({
  groupId: z.string(), angleId: z.string(), pieceIndex: z.number().int().min(0).max(MAX_PIECES - 1),
  nudge: RT.optional().describe('positive = this file plays LATER against the reference'),
  offset: RT.optional().describe('group time at which this file\'s source time 0 plays (a pure offset)'),
  anchors: z.array(SyncAnchorSchema).min(1).max(MAX_ANCHORS_PER_PIECE).optional(),
  clear: z.literal(true).optional(),
}).strict(); // exactly one of nudge | offset | anchors | clear (checked in apply: syncForm)
export const UpdateMulticamArgs = z.object({
  groupId: z.string(), name: z.string().min(1).max(80).optional(), wideAngleId: z.string().nullable().optional(),
  angles: z.array(z.object({ angleId: z.string(), label: z.string().min(1).max(40) }).strict()).max(MAX_ANGLES).optional(),
  speakers: z.array(MulticamSpeakerSchema.omit({ id: true }).extend({ id: z.string().optional() })).max(MAX_SPEAKERS).optional().describe('replaces the list'),
}).strict();
export const SetAngleLookArgs = z.object({
  groupId: z.string(), angleId: z.string(), fromClipId: z.string().optional(),
  clear: z.literal(true).optional().describe('remove the angle\'s look and every one of its files\' privacy regions and follow'),
  apply: z.enum(['unedited', 'all', 'none']).optional().describe('default unedited: only segments whose look still equals the old one (ids ignored)'),
}).strict();
export const PlaceMulticamArgs = z.object({
  groupId: z.string(), sequenceId: z.string().optional(),
  newSequence: z.object({ name: z.string().min(1).max(128) }).strict().optional().describe('lay the program in a new sequence (origin kind "multicam"), not with sequenceId or trackId'),
  at: RT,
  range: z.object({ from: RT, to: RT }).strict().optional().describe('group time; default the coverage of the sound sources'),
  angleId: z.string(), sound: z.array(z.string()).max(8).optional().describe('angles whose sound plays continuously; default the first sound angle, else the reference'),
  trackId: z.string().optional(), fill: z.boolean().optional(), driftToleranceFrames: z.number().min(0.1).max(2).optional(),
}).strict();
const PointArgs = z.object({ at: RT.optional(), groupTime: RT.optional() }).strict(); // exactly one (pointForm)
export const SwitchAnglesArgs = z.object({
  groupId: z.string(), sequenceId: z.string().optional(), trackId: z.string().optional(),
  cuts: z.array(PointArgs.extend({ angleId: z.string() }).strict()).min(1).max(MAX_CUTS),
  until: PointArgs.optional(),
  coverage: z.enum(['refuse', 'clip']).optional().describe('default refuse'),
  heal: z.boolean().optional().describe('default true'),
  driftToleranceFrames: z.number().min(0.1).max(2).optional(),
}).strict();
export const DetachFromMulticamArgs = z.object({ clipIds: z.array(z.string()).min(1).max(2000) }).strict();
export const RemoveMulticamArgs = z.object({ groupId: z.string(), detach: z.boolean().optional() }).strict();
/** Argument schemas by operation name (registered in multicamOps.ts). */
export const MulticamOpArgs = {
  create_multicam: CreateMulticamArgs, attach_multicam_sync: AttachMulticamSyncArgs, set_multicam_sync: SetMulticamSyncArgs,
  update_multicam: UpdateMulticamArgs, set_angle_look: SetAngleLookArgs, place_multicam: PlaceMulticamArgs,
  switch_angles: SwitchAnglesArgs, detach_from_multicam: DetachFromMulticamArgs, remove_multicam: RemoveMulticamArgs,
} as const;

// ---------- outputs ----------
type Time = { value: string; timescale: number };
export interface CreateMulticamOutput { groupId: string; angleIds: string[]; referenceAngleId: string }
export interface AttachMulticamSyncOutput { pieces: { angleId: string; pieceIndex: number; verdict: string; anchors: number }[]; remappedClipIds: string[] }
export interface SetMulticamSyncOutput { remappedClipIds: string[] }
export interface UpdateMulticamOutput { speakerIds: string[] }
export interface SetAngleLookOutput { appliedClipIds: string[]; keptClipIds: string[]; dropped: SwitchAnglesOutput['dropped']; warnings: SwitchAnglesOutput['warnings'] }
export interface PlaceMulticamOutput {
  sequenceId: string; videoTrackId: string; soundTrackIds: string[];
  createdClipIds: string[];
  /** Stretches shown by another covering angle (fill), and those nothing covers (left empty). Group time. */
  filled: { start: Time; end: Time; angleId: string }[];
  uncovered: { start: Time; end: Time }[];
  soundChunks: number; maxSoundErrorSeconds: number;
  warnings: SwitchAnglesOutput['warnings'];
}
export type SkipReason = 'not_tagged' | 'other_group' | 'gap' | 'reversed' | 'ramped' | 'linked' | 'not_covered' | 'group_time_not_on_track' | 'same_frame' | 'already_on_angle';
export const SKIP_REASONS = ['not_tagged', 'other_group', 'gap', 'reversed', 'ramped', 'linked', 'not_covered', 'group_time_not_on_track', 'same_frame', 'already_on_angle'] as const satisfies readonly SkipReason[];
export const DROPPED_KINDS = ['keyframes', 'effect_keyframes', 'follow', 'variant_transform'] as const;
export const MULTICAM_WARNINGS = ['redaction_missing', 'speed_not_following_sound'] as const;
export interface SwitchAnglesOutput {
  cuts: { at: Time; angleId: string }[];
  switchedClipIds: string[]; createdClipIds: string[]; healedClipIds: string[];
  skipped: { clipId?: string; at?: Time; reason: SkipReason }[];
  dropped: { clipId: string; what: (typeof DROPPED_KINDS)[number] }[];
  warnings: { code: (typeof MULTICAM_WARNINGS)[number]; clipIds: string[] }[];
}
export interface DetachFromMulticamOutput { detachedClipIds: string[] }
export interface RemoveMulticamOutput { detachedClipIds: string[] }

/** The typed refusal of a multicam operation: `throw multicamRefusal('notSynced', { groupId, angleId, why: 'not_synced' }, label)`. */
export function multicamRefusal<K extends MulticamRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof MULTICAM_REFUSALS)[K]['message']>): OpError {
  const r = MULTICAM_REFUSALS[key] as MulticamRefusalRow<unknown[]>;
  return new OpError(r.code, r.message(...values), details, r.hint);
}
/** The summaries of the multicam operations (history and events), fixed like the refusals. */
export const MULTICAM_SUMMARIES = {
  created: (name: string, angles: number) => `Created multicam group "${name}" with ${angles} angles`,
  synced: (pieces: number) => `Stored measured sync of ${pieces} file(s)`,
  corrected: (label: string) => `Corrected the sync of angle "${label}"`,
  updated: (name: string) => `Updated multicam group "${name}"`,
  look: (label: string, applied: number) => `Look of angle "${label}" set (${applied} segment(s))`,
  placed: (name: string, segments: number) => `Laid multicam program "${name}" (${segments} segment(s))`,
  switched: (cuts: number) => `Switched angles (${cuts} cut(s))`,
  detached: (clips: number) => `Detached ${clips} clip(s) from multicam`,
  removed: (name: string) => `Removed multicam group "${name}"`,
} as const;
/** A time in the shape the outputs use. */
export const timeJson = (t: T.RationalTime): Time => ({ value: t.value, timescale: t.timescale });
