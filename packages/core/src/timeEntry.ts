/**
 * Typed time (wave 7 craft; craft-plan.md §4.2 and "Corrected" C5). Pure: no clock, no DOM, no float seconds.
 * Before the command bar's reader (commandBar/time.ts parseTime) it does three things itself: a leading + or − (sets `relative`,
 * stripped), a Latin suffix (`90f`, `3s` → number and unit tokens), and a bare whole number (frames). Everything else goes to the
 * bar's reader unchanged, so `hh:mm:ss:ff`, `m:ss`, «3 שניות», «שנייה וחצי» read the same in both places (a shared golden).
 * Seconds become a frame once, T.nearestFrameIndex, ties up; `rounded` says so. Refused: unreadable, negative (also a relative
 * result before 0), not_whole_frames (`0.5f`), too_large (past 24 hours).
 *
 * THE RULES, IN ORDER (each is one small function below; craft.test.ts has a test that fails when one is broken)
 * 1. Trim. Empty → unreadable.
 * 2. One leading sign: `+`, `-` or `−` (U+2212). Relative = a sign was there. A second sign → unreadable.
 * 3. A bare decimal number: whole → that many frames (`90` → 90); with a fraction (`1.5`) → not_whole_frames (a frame is the
 *    smallest unit; a bare number is never read as seconds).
 * 4. A number glued to a Latin unit (`90f`, `3s`, `2min`, `1.5s`) is split into "number unit" and read by the bar's reader.
 * 5. Everything else goes to the bar's reader unchanged; the reader must read the WHOLE text as one time, else unreadable.
 *    Its refusals map: half_frame → not_whole_frames, out_of_range → too_large; an ambiguous reading → unreadable.
 * 6. Relative: frame = base + sign × amount (base 0 when none is given); below 0 → negative.
 * 7. Above 24 hours at this rate (T.nearestFrameIndex of 86,400 s, the reader's own one rounding) → too_large.
 */
import * as T from '@pulseframe/time';
import type { TimeEntryResult } from './craftContract.ts';
import { tokenizeBar } from './commandBar/match.ts';
import { parseTime } from './commandBar/time.ts';

/** The most a typed time may reach: 24 hours, converted once at the rate. */
export const maxEntryFrame = (rate: T.Rate): number => T.nearestFrameIndex(T.rt(86_400, 1), rate);

/** Rule 2: the sign, and the text after it. */
function splitSign(text: string): { sign: 1 | -1 | 0; rest: string } {
  const c = text[0];
  if (c === '+') return { sign: 1, rest: text.slice(1).trim() };
  if (c === '-' || c === '−') return { sign: -1, rest: text.slice(1).trim() };
  return { sign: 0, rest: text };
}

/** Rule 4: `90f`, `3s`, `1.5min` → `90 f`, `3 s`, `1.5 min`; anything else unchanged. */
const splitLatinSuffix = (text: string): string => text.replace(/^(\d+(?:\.\d+)?)([A-Za-z]+)$/, '$1 $2');

/** Rules 3–5: the amount of an unsigned text, in whole frames, or why it is refused. */
function readAmountFrames(text: string, rate: T.Rate): { frame: number; rounded: boolean } | { reason: 'unreadable' | 'not_whole_frames' | 'too_large' } {
  if (!text) return { reason: 'unreadable' };
  if (/^\d+$/.test(text)) return { frame: Number(text), rounded: false };
  if (/^\d+\.\d+$/.test(text)) return { reason: 'not_whole_frames' };
  const tokens = tokenizeBar(splitLatinSuffix(text)).tokens;
  if (!tokens.length) return { reason: 'unreadable' };
  const r = parseTime(tokens, 0, rate);
  if (!r || 'ambiguous' in r || r.end !== tokens.length) return { reason: 'unreadable' };
  if ('refused' in r) return { reason: r.refused === 'half_frame' ? 'not_whole_frames' : 'too_large' };
  return { frame: r.time.frame, rounded: r.time.rounded };
}

/** `base`: the frame a relative entry counts from (the playhead, a clip's start, or a clip's duration in frames). */
export function parseTimeEntry(text: string, rate: T.Rate, base?: number): TimeEntryResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'unreadable' };
  const { sign, rest } = splitSign(trimmed);
  if (sign !== 0 && /^[+\-−]/.test(rest)) return { ok: false, reason: 'unreadable' };
  const amount = readAmountFrames(rest, rate);
  if ('reason' in amount) return { ok: false, reason: amount.reason };
  const max = maxEntryFrame(rate);
  if (amount.frame > max) return { ok: false, reason: 'too_large' };
  const frame = sign === 0 ? amount.frame : (base ?? 0) + sign * amount.frame;
  if (frame < 0) return { ok: false, reason: 'negative' };
  if (frame > max) return { ok: false, reason: 'too_large' };
  return { ok: true, frame, relative: sign !== 0, rounded: amount.rounded };
}
