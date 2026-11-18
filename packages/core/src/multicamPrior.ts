/**
 * Capture-time priors for multicam sync (ADR-0020 with the life line's capture dates, ADR-0021). Lead-built.
 *
 * A family event filmed by several phones can be PRE-aligned by when each file was taken, before sound sync:
 * - each piece's prior offset = (instant its file started) − (instant the reference piece 0 started), in whole seconds, from
 *   capture.ts shownCapture (its own date, or one inherited through a time-preserving derivative);
 * - both stamps with a stated UTC offset are compared as instants ('utc'); both without one and with the same assumed zone
 *   (or none) are compared as wall clocks ('same_clock_assumed'); anything else has no prior (mixed_offsets);
 * - a day-only date, or no date, has no prior.
 * HOW IT IS USED (and never more): the sync job (W2) reports the prior per piece (MulticamPieceReport.captureOffsetSeconds),
 * orders its candidates by distance from it when the sound peaks are near-equal, and widens maxOffset to cover it; the
 * editor (W3) offers it, labelled «לפי שעת הצילום (משוער)» with its uncertainty, as a HAND choice (set_multicam_sync offset)
 * for a file with no shared sound. It is never attached as a measured sync and never sets a verdict: camera clocks differ by
 * seconds, stamps are whole seconds, and some phones stamp a video when the recording STOPPED, which puts the prior off by
 * the file's own length (endStampedOffsetSeconds gives that reading too).
 */
import * as T from '@pulseframe/time';
import { parseWall, shownCapture } from './capture.ts';
import { rdFromGregorian } from './hebrewCalendar.ts';
import type { MulticamGroup, ProjectDocument } from './schema.ts';

/** Seconds a capture-time prior is trusted to, at best (whole-second stamps from clocks that are not the same clock). */
export const CAPTURE_PRIOR_UNCERTAINTY_SECONDS = 2;
export type CapturePriorBasis = 'utc' | 'same_clock_assumed';
export type CapturePriorWhy = 'reference' | 'no_capture' | 'day_only' | 'reference_no_capture' | 'reference_day_only' | 'mixed_offsets';
export interface CapturePrior {
  angleId: string; pieceIndex: number; assetId: string;
  /** Group time at which this file's source time 0 plays, by capture time (whole seconds, exact); null = no prior (see why). */
  offset: T.RationalTime | null;
  offsetSeconds: number | null;
  /** The same reading if BOTH files were stamped when their recording stopped (some phones do): start = stamp − length. */
  endStampedOffsetSeconds: number | null;
  uncertaintySeconds: number | null;
  basis: CapturePriorBasis | null;
  why: CapturePriorWhy | null;
}
interface Stamp { seconds: number; utcOffsetMinutes: number | null; assumedZone: string | undefined; length: number }
/** Whole seconds of a rational time, rounded down; null when it cannot be counted. */
const wholeSeconds = (t: T.RationalTime): number | null => { const n = T.frameIndexAt(t, { num: 1, den: 1 }); return Number.isSafeInteger(n) ? n : null; };
function stampOf(doc: ProjectDocument, assetId: string): Stamp | 'no_capture' | 'day_only' {
  const shown = shownCapture(doc, assetId);
  if (!shown) return 'no_capture';
  const w = parseWall(shown.wall);
  if (w.seconds === null) return 'day_only';
  const asset = doc.assets[assetId]!;
  return { seconds: rdFromGregorian(w.date) * 86400 + w.seconds, utcOffsetMinutes: shown.capture.utcOffsetMinutes, assumedZone: shown.capture.assumedZone, length: wholeSeconds(asset.duration) ?? 0 };
}
/** The capture-time prior of every piece of the group, in angle order then piece order (the reference piece 0 first of its angle, why 'reference'). Pure. */
export function capturePriors(doc: ProjectDocument, group: MulticamGroup): CapturePrior[] {
  const refAngle = group.angles.find((a) => a.id === group.referenceAngleId);
  const refPiece = refAngle?.pieces[0];
  const ref = refPiece && Object.hasOwn(doc.assets, refPiece.assetId) ? stampOf(doc, refPiece.assetId) : 'no_capture';
  const out: CapturePrior[] = [];
  for (const angle of group.angles) angle.pieces.forEach((piece, pieceIndex) => {
    const base = { angleId: angle.id, pieceIndex, assetId: piece.assetId };
    const none = (why: CapturePriorWhy): CapturePrior => ({ ...base, offset: null, offsetSeconds: null, endStampedOffsetSeconds: null, uncertaintySeconds: null, basis: null, why });
    if (angle.id === group.referenceAngleId && pieceIndex === 0) { out.push({ ...none('reference'), offset: T.ZERO, offsetSeconds: 0, endStampedOffsetSeconds: 0, uncertaintySeconds: 0 }); return; }
    if (typeof ref === 'string') { out.push(none(ref === 'no_capture' ? 'reference_no_capture' : 'reference_day_only')); return; }
    const own = Object.hasOwn(doc.assets, piece.assetId) ? stampOf(doc, piece.assetId) : 'no_capture';
    if (typeof own === 'string') { out.push(none(own)); return; }
    let basis: CapturePriorBasis, diff: number;
    if (own.utcOffsetMinutes !== null && ref.utcOffsetMinutes !== null) { basis = 'utc'; diff = (own.seconds - own.utcOffsetMinutes * 60) - (ref.seconds - ref.utcOffsetMinutes * 60); }
    else if (own.utcOffsetMinutes === null && ref.utcOffsetMinutes === null && own.assumedZone === ref.assumedZone) { basis = 'same_clock_assumed'; diff = own.seconds - ref.seconds; }
    else { out.push(none('mixed_offsets')); return; }
    out.push({ ...base, offset: T.rt(diff, 1), offsetSeconds: diff, endStampedOffsetSeconds: diff - own.length + ref.length, uncertaintySeconds: CAPTURE_PRIOR_UNCERTAINTY_SECONDS, basis, why: null });
  });
  return out;
}
