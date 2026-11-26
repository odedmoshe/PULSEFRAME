/**
 * Range marks on the timeline and the range cut (wave 8D P5 b, c): pure parts. The marks are view state (frames, never stored in
 * the project); the cut is the registered op cut_range (ripple on every track, markers follow) in ONE commit, so one undo.
 */
import * as T from '@pulseframe/time';
import type { OpCall, ProjectDocument } from '@pulseframe/core';
import { sequenceDuration } from '@pulseframe/core';

/** The marks: frame indices of the start (I) and the end (O); null when not set. `out` is the first frame NOT in the range. */
export interface RangeMarks { in: number | null; out: number | null }
export const NO_RANGE: RangeMarks = { in: null, out: null };

/**
 * I at `frame`: sets the start there; a second press on the same frame clears the start. A start at or after the end moves
 * the end away (the end is cleared), so the marks never describe an empty or backwards range.
 */
export function markIn(r: RangeMarks, frame: number): RangeMarks {
  if (r.in === frame) return { ...r, in: null };
  return { in: frame, out: r.out !== null && r.out <= frame ? null : r.out };
}
/** O at `frame`: the range ends after the frame the playhead is on (that frame is in the range); a second press there clears it. */
export function markOut(r: RangeMarks, frame: number): RangeMarks {
  const out = frame + 1;
  if (r.out === out) return { ...r, out: null };
  return { in: r.in !== null && r.in >= out ? null : r.in, out };
}
/** A flag dragged to `frame`: the start stays at least one frame before the end and the end one after the start. */
export function dragMark(r: RangeMarks, which: 'in' | 'out', frame: number, last: number): RangeMarks {
  if (which === 'in') { const hi = r.out !== null ? r.out - 1 : last; return { ...r, in: Math.max(0, Math.min(hi, frame)) }; }
  const lo = r.in !== null ? r.in + 1 : 1;
  return { ...r, out: Math.max(lo, Math.min(last + 1, frame)) };
}
export const hasRange = (r: RangeMarks) => r.in !== null || r.out !== null;
export const fullRange = (r: RangeMarks): r is { in: number; out: number } => r.in !== null && r.out !== null && r.in < r.out;

export type RangeCutPlan =
  | { ok: true; ops: OpCall[]; start: number; end: number }
  | { ok: false; why: 'no_project' | 'need_both' | 'past_end' | 'locked'; tracks?: string[] };

/**
 * The range cut: cut_range over [in, out) on every track with ripple, its end held to the end of the sequence. Refused (nothing
 * sent) without both marks, when the range starts at or after the end of the material, or while a track is locked (cut_range
 * would refuse it too: a locked track cannot keep in sync); the refusal names the locked tracks.
 */
export function rangeCutPlan(doc: ProjectDocument | null, r: RangeMarks, rate: T.Rate): RangeCutPlan {
  if (!doc) return { ok: false, why: 'no_project' };
  if (!fullRange(r)) return { ok: false, why: 'need_both' };
  const tracks = doc.sequences[doc.mainSequenceId]?.tracks ?? [];
  const locked = tracks.filter((t) => t.locked).map((t) => t.name);
  if (locked.length) return { ok: false, why: 'locked', tracks: locked };
  const endFrame = Math.min(r.out, T.frameIndexAt(sequenceDuration(doc), rate));
  if (r.in >= endFrame) return { ok: false, why: 'past_end' };
  return { ok: true, start: r.in, end: endFrame, ops: [{ op: 'cut_range', args: { start: T.frameTime(r.in, rate), end: T.frameTime(endFrame, rate) } }] };
}
