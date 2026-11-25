/**
 * Typed time (wave 7 craft; craft-plan.md §4.2 and "Corrected" C5). W1 BUILDS THIS. Pure: no clock, no DOM, no float seconds.
 * Before the command bar's reader (commandBar/time.ts parseTime) it does three things itself: a leading + or − (sets `relative`,
 * stripped), a Latin suffix (`90f`, `3s` → number and unit tokens), and a bare whole number (frames). Everything else goes to the
 * bar's reader unchanged, so `hh:mm:ss:ff`, `m:ss`, «3 שניות», «שנייה וחצי» read the same in both places (a shared golden).
 * Seconds become a frame once, T.nearestFrameIndex, ties up; `rounded` says so. Refused: unreadable, negative (also a relative
 * result before 0), not_whole_frames (`0.5f`), too_large (past 24 hours).
 */
import * as T from '@pulseframe/time';
import { CraftNotBuilt, type TimeEntryResult } from './craftContract.ts';

/** `base`: the frame a relative entry counts from (the playhead, a clip's start, or a clip's duration in frames). */
export function parseTimeEntry(text: string, rate: T.Rate, base?: number): TimeEntryResult {
  void text; void rate; void base;
  throw new CraftNotBuilt('parseTimeEntry');
}
