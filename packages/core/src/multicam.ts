/**
 * Multicam maths and queries (ADR-0020). LEAD: the signatures, syncGrid and the rules below; W1: every body marked todo().
 * Pure; no op here writes anything (multicamOps.ts does, through applyTransaction).
 *
 * RULES OF THE BODIES (plan §1 D2–D5, §3; multicamContract.ts header)
 * - Maps are evaluated in BigInt fractions (Frac): make() throws above 2^53 timescale, so a RationalTime is built only by
 *   quantise(). Never T.fromSeconds, never a float stored (ADR-0003).
 * - A piece's map is piecewise-linear through its anchors; the end slopes extend; one anchor = a pure offset (slope 1).
 * - quantise rounds half up to syncGrid(group.sampleRate, settings.frameRate); identity on a value already on the grid, so
 *   offset-only maps are exact both ways (A→B→A is T.eq-exact).
 * - remapSource = Q(fromGroup(to, toGroup(from, s))): the ONE rounding of a switch.
 * - Group time of a segment from its sourceIn and sourceEnd (speed.ts); a timeline frame from a group time with T.snapToFrame.
 * - Lookups by id use own properties (Object.hasOwn): ids that name Object.prototype members are never plain-object keys.
 */
import * as T from '@pulseframe/time';
import type { AngleLook, MediaClip, MulticamAngle, MulticamGroup, MulticamPiece, ProjectDocument, Track } from './schema.ts';
import type { RedactRegion } from './tracking.ts';

const todo = (): never => { throw new Error('not built yet (ADR-0020 W1)'); };
/** An exact fraction (d > 0, not necessarily reduced). Internal map arithmetic never builds a RationalTime until quantise(). */
export interface Frac { n: bigint; d: bigint }
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
/** The one grid of composed source times: lcm(sampleRate, frameRate.num). 48000@30 -> 48000; 48000@30000/1001 -> 240000. */
export const syncGrid = (sampleRate: number, frameRate: { num: number; den: number }): number => (sampleRate / gcd(sampleRate, frameRate.num)) * frameRate.num;
/** The group of a project by id (own property), or undefined. */
export const multicamGroupOf = (doc: ProjectDocument, groupId: string): MulticamGroup | undefined =>
  doc.multicam && Object.hasOwn(doc.multicam, groupId) ? doc.multicam[groupId] : undefined;
/** The groups of a project (none when it has no `multicam` key). */
export const multicamGroups = (doc: ProjectDocument): MulticamGroup[] => Object.values(doc.multicam ?? {});

/** Round half up to the grid; identity for a value already on it. */
export function quantise(x: Frac | T.RationalTime, grid: number): T.RationalTime { void x; void grid; return todo(); }
export function isPlaced(piece: MulticamPiece): boolean { void piece; return todo(); }
/** Exact group time of a source time of this piece (piecewise-linear through anchors; end slopes extend). Throws on an unplaced piece. */
export function toGroupExact(piece: MulticamPiece, source: T.RationalTime | Frac): Frac { void piece; void source; return todo(); }
export function fromGroupExact(piece: MulticamPiece, group: T.RationalTime | Frac): Frac { void piece; void group; return todo(); }
/** Q(fromGroup(to, toGroup(from, s))): the ONE rounding of a switch. */
export function remapSource(from: MulticamPiece, to: MulticamPiece, source: T.RationalTime, grid: number): T.RationalTime { void from; void to; void source; void grid; return todo(); }
/** Group-time span a placed piece covers: [toGroup(0), toGroup(assetDuration)), quantised; null when unplaced. */
export function pieceCoverage(piece: MulticamPiece, assetDuration: T.RationalTime, grid: number): { start: T.RationalTime; end: T.RationalTime } | null { void piece; void assetDuration; void grid; return todo(); }
export interface TaggedSegment { sequenceId: string; track: Track; clip: MediaClip; group: MulticamGroup; angle: MulticamAngle; pieceIndex: number }
/** The tagged clip with its group, angle and the index of the piece whose asset it shows; null for an untagged or unknown clip. */
export function taggedSegment(doc: ProjectDocument, clipId: string): TaggedSegment | null { void doc; void clipId; return todo(); }
/** Group time shown at the segment's start and end (quantised); a freeze has start = end. */
export function groupRangeOf(doc: ProjectDocument, seg: TaggedSegment): { start: T.RationalTime; end: T.RationalTime } { void doc; void seg; return todo(); }
/** Group time of the picture on a program track at timeline time t (the tagged segment under t), or null. */
export function groupTimeAt(doc: ProjectDocument, sequenceId: string, trackId: string, t: T.RationalTime): { groupId: string; g: T.RationalTime; clipId: string } | null { void doc; void sequenceId; void trackId; void t; return todo(); }
/** Frame-snapped timeline time at which the program track shows group time g of groupId; nearest to `near` when it occurs more than once; null when cut out. */
export function timelineAtGroupTime(doc: ProjectDocument, sequenceId: string, trackId: string, groupId: string, g: T.RationalTime, near?: T.RationalTime): T.RationalTime | null { void doc; void sequenceId; void trackId; void groupId; void g; void near; return todo(); }
/** Group time of the master sound (a tagged clip of a sound angle, or of the reference angle, on an audio track) covering t, or null. */
export function masterGroupTimeAt(doc: ProjectDocument, sequenceId: string, groupId: string, t: T.RationalTime): T.RationalTime | null { void doc; void sequenceId; void groupId; void t; return todo(); }
/** How far a picture segment is out of step with the master sound at its start and end (positive = picture late). Null when no master sound covers it. */
export interface SyncOffset { clipId: string; startSeconds: number; endSeconds: number; startFrames: number; endFrames: number; slipBy: T.RationalTime }
export function segmentSyncOffset(doc: ProjectDocument, clipId: string): SyncOffset | null { void doc; void clipId; return todo(); }
export interface PlannedPicture { start: T.RationalTime; duration: T.RationalTime; angleId: string; pieceIndex: number; assetId: string; sourceIn: T.RationalTime; reason: 'angle' | 'fill' | 'piece-boundary' | 'drift' }
export interface PlannedSound { start: T.RationalTime; duration: T.RationalTime; angleId: string; pieceIndex: number; assetId: string; sourceIn: T.RationalTime; fadeIn?: T.RationalTime; fadeOut?: T.RationalTime }
export interface AnglePlanArgs { angleId: string; at: T.RationalTime; g0: T.RationalTime; duration: T.RationalTime; fill: boolean; driftToleranceFrames: number }
/** Picture segments showing group time g0 + (t − at) for t in [at, at+duration): split at piece edges and drift through-edits; gaps filled from covering placed angles when fill. All frame-aligned. */
export function planPicture(doc: ProjectDocument, group: MulticamGroup, a: AnglePlanArgs): { segments: PlannedPicture[]; uncovered: { start: T.RationalTime; end: T.RationalTime }[] } { void doc; void group; void a; return todo(); }
/** Sound of one angle for the same span: one clip, or chunks (1-frame overlap, 1-frame fades) when drift exceeds SOUND_DRIFT_CHUNK_THRESHOLD_S. */
export function planSound(doc: ProjectDocument, group: MulticamGroup, a: Omit<AnglePlanArgs, 'fill' | 'driftToleranceFrames'>): { clips: PlannedSound[]; chunks: number; maxErrorSeconds: number } { void doc; void group; void a; return todo(); }
/** The look a segment carries (for set_angle_look): effect param keyframes stripped; time effects excluded; per-variant transforms collected; the piece's redact and follow. */
export function lookOfClip(doc: ProjectDocument, clip: MediaClip): { look: AngleLook; redact: RedactRegion[] | undefined; follow: MediaClip['follow']; dropped: string[] } { void doc; void clip; return todo(); }
/** Never-saved grid document of the live angles over group span [g0, g0+duration): one video track per piece, cells from layoutPlacements, label text clips, no sound. Frame f shows group time g0 + frameTime(f). */
export function multiviewDocument(doc: ProjectDocument, groupId: string, opts: { liveAngleIds: string[]; g0: T.RationalTime; duration: T.RationalTime; width: number; height: number }): ProjectDocument { void doc; void groupId; void opts; return todo(); }
