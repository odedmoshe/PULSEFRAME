/**
 * Every refusal of the multicam operations (ADR-0020): code, fixed English wording and hint. Lead contract. The Hebrew table
 * recognises the messages by their shape (packages/i18n/src/multicam.ts HE_MULTICAM) and packages/evals/src/multicam-wording.test.ts
 * keeps the two in step. Kept apart from multicamContract.ts and with no runtime import of ops.ts, because ops.ts itself raises
 * some of them (remove_asset, remove_motion_track, replace_clip_asset, replace_clip_media).
 *
 * The codes are existing OpErrorCodes (no new code): not_synced → incompatible (details.why 'not_synced'), angle_not_covering →
 * range_not_covered (details {coveredFrom, coveredTo}), too_many_changes → out_of_bounds (details.why 'too_many_changes'),
 * ambiguous_track → invalid_args (details.trackIds), a hand-synced file measured again → incompatible with details.why
 * 'would_discard_edits' (the sync route answers 409 would_discard_edits, http.ts precedent). The validation issue code of a
 * bad tag is 'multicam_tag' (validate.ts), not an OpError code.
 * Refusals the bodies share with other edits keep those edits' words: a locked track, a missing clip or track, a frame
 * boundary (ops.ts assertAligned), a transition handle (ops.ts checkTransitionAt → checkTransition's own words).
 */
import type { OpErrorCode } from './ops.ts';
import { MAX_CUTS, MAX_MULTICAM_GROUPS, MAX_PROJECT_ANCHORS, MAX_TOUCHED_ENTITIES } from './multicamLimits.ts';

/** Every row has a hint: the way forward, not only what is wrong (multicam-wording.test.ts checks it, and the Hebrew sentence carries it). */
export interface MulticamRefusalRow<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint: string): MulticamRefusalRow<A> => ({ code, message, hint });
/** Seconds as the messages write them (3 decimals, the replace_clip_asset precedent). */
export const mcSeconds = (s: number): string => `${s.toFixed(3)}s`;

export const MULTICAM_REFUSALS = {
  notBuilt: refusal('unknown_op', (op: string) => `${op} is not built yet`, 'This build has the contract of this operation but not its body.'),
  groupNotFound: refusal('not_found', (groupId: string) => `multicam group ${groupId} not found`, 'get_multicam, or the multicam map of the project document, lists the groups.'),
  angleNotFound: refusal('not_found', (angleId: string, groupId: string) => `angle ${angleId} is not an angle of multicam group ${groupId}`, 'get_multicam lists the angles of a group with their ids.'),
  pieceNotFound: refusal('not_found', (angleId: string, pieceIndex: number) => `angle ${angleId} has no file ${pieceIndex}`, 'Files of an angle are numbered from 0 in the order they were given.'),
  tooManyGroups: refusal('out_of_bounds', () => `a project holds at most ${MAX_MULTICAM_GROUPS} multicam groups`, 'Remove a group you no longer need first (remove_multicam).'),
  angleKind: refusal('incompatible', (assetId: string, kind: 'picture' | 'sound') => `file ${assetId} has no ${kind}, so it cannot be a ${kind} angle`, 'A camera angle needs a video file; a sound angle needs a file with sound.'),
  assetTwice: refusal('invalid_args', (assetId: string) => `file ${assetId} is named twice in this group`, 'Give every file once, in one angle.'),
  referenceFixed: refusal('incompatible', () => 'the first file of the reference angle sets group time, so its sync cannot be changed', 'Correct the other files against it.'),
  syncForm: refusal('invalid_args', () => 'give exactly one of nudge, offset, anchors or clear', 'Send one correction at a time: nudge moves the file a little, offset sets where it starts, anchors follow drift, clear unsyncs it.'),
  anchorsNotIncreasing: refusal('invalid_args', () => 'sync anchors must increase in both group time and source time', 'Sort the anchors by group time and drop any that go back in the file.'),
  anchorOffSample: refusal('invalid_args', (sampleRate: number) => `sync anchors must fall on whole samples at ${sampleRate} Hz`, 'Round each anchor to the nearest sample.'),
  driftTooLarge: refusal('out_of_bounds', () => 'a sync map may not run more than 1000 ppm (0.1%) faster or slower than the reference', 'A file that drifts more than that plays at a different speed, not with clock drift: check whether it was slowed down or sped up.'),
  tooManyAnchors: refusal('out_of_bounds', () => `a project holds at most ${MAX_PROJECT_ANCHORS} sync anchors`, 'Use fewer anchors per file (a straight line needs two).'),
  wouldDiscardManual: refusal('incompatible', (label: string) => `a file of angle "${label}" was synced by hand; measuring again would discard that correction`, 'Pass overwrite: true to replace the hand correction with the measurement.'),
  notSynced: refusal('incompatible', (label: string) => `angle "${label}" is not synced yet`, 'Sync it by sound (the multicam sync route, sync_multicam) or by hand (set_multicam_sync), or choose another angle.'),
  notCovering: refusal('range_not_covered', (label: string, from: number, to: number) => `angle "${label}" has no picture from ${mcSeconds(from)} to ${mcSeconds(to)} of group time`, 'Pass coverage: "clip" to skip what it does not cover, or cut to another angle there.'),
  tooManyChanges: refusal('out_of_bounds', (n: number) => `this step would change ${n} items; one multicam step changes at most ${MAX_TOUCHED_ENTITIES}`, 'Switch a shorter stretch, or send the cuts in several steps.'),
  tooManyCuts: refusal('out_of_bounds', () => `one step takes at most ${MAX_CUTS} cuts`, 'Send the cuts in several steps.'),
  ambiguousTrack: refusal('invalid_args', (n: number) => `${n} video tracks hold segments of this group`, 'Pass trackId to say which program to switch.'),
  noProgram: refusal('not_found', () => 'no video track holds segments of this group', 'Lay the program first (place_multicam).'),
  pointForm: refusal('invalid_args', () => 'each cut gives exactly one of at or groupTime', 'Give each cut at (a time on the timeline) or groupTime (a time of the group), not both.'),
  trackNotEmpty: refusal('incompatible', (trackId: string) => `track ${trackId} already holds clips`, 'Omit trackId to lay the program on new tracks, or empty the track first.'),
  trackKind: refusal('incompatible', (trackId: string, kind: 'video' | 'audio') => `track ${trackId} is not a ${kind} track`, 'Choose a track of that kind, or omit trackId (place_multicam then lays new tracks; switch_angles finds the program).'),
  newSequenceAndTrack: refusal('invalid_args', () => 'a program laid in a new sequence takes new tracks: give newSequence without sequenceId or trackId', 'Drop sequenceId and trackId, or drop newSequence to lay the program in an existing sequence.'),
  taggedClip: refusal('incompatible', () => 'this clip is an angle of a multicam group; its file is set by the group', 'Detach it first (detach_from_multicam), or switch angles (switch_angles). Derived copies (AI tools) cannot stand in for an angle yet.'),
  assetInGroup: refusal('incompatible', (n: number) => `${n} multicam group(s) use this file`, 'Remove the group (remove_multicam) first.'),
  motionTrackInGroup: refusal('incompatible', (n: number) => `${n} multicam file(s) hide a region with this motion track or follow it`, 'Clear that angle\'s look first (set_angle_look clear: true), or remove the group.'),
  tagsExist: refusal('incompatible', (n: number) => `${n} clip(s) on the timeline are segments of this group`, 'Pass detach: true to turn them into ordinary clips in the same step.'),
  notTagged: refusal('incompatible', (clipId: string) => `clip ${clipId} is not a multicam segment`, 'Choose a segment of a multicam program: a clip that place_multicam or switch_angles laid.'),
  notThisAngle: refusal('incompatible', (clipId: string, label: string) => `clip ${clipId} does not show angle "${label}"`, 'Choose a segment of that angle, or switch it to that angle first.'),
  lookForm: refusal('invalid_args', () => 'give exactly one of fromClipId or clear', 'Pass fromClipId to give the angle the look of that segment, or clear: true to remove the angle\'s look.'),
  soundAngleLook: refusal('incompatible', (label: string) => `"${label}" is a sound angle, which has no picture and so no look`, 'Choose a camera (picture) angle.'),
  nothingToUpdate: refusal('invalid_args', () => 'nothing to change: give name, wideAngleId, angles or speakers', 'Give at least one of them.'),
  wideNotPicture: refusal('incompatible', (label: string) => `the wide angle must be a picture angle; "${label}" is a sound angle`, 'Choose a camera (picture) angle, or pass wideAngleId: null for no wide angle.'),
  speakerMic: refusal('incompatible', (label: string) => `the mic of speaker "${label}" must be an angle of this group with sound`, 'Choose as micAngleId a recorder of this group, or a camera of it that recorded sound.'),
} as const;
export type MulticamRefusalKey = keyof typeof MULTICAM_REFUSALS;
