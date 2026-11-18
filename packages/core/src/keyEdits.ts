/**
 * Key edits of the editor (ADR-0019, W2 bodies; the lead's contracts commit fixes the signatures): pure functions from a
 * gesture on the keyframe strip, the curve picker or the clipboard to the operations that make it. The editor calls them
 * inside commit(() => …) (apps/web/src/editor/store.ts), so they read the clip as it is when the edit's turn comes.
 *
 * Writes: transform channels through replace_clip_keyframes in its RANGE form (shortsContract.ts; from/to, so keys outside the
 * range, also those before the clip start that a trim or split left, are kept), effect channels through
 * replace_effect_keyframes (keyframe.ts), curves through set_keyframe_curve. Every function returns ≤ 1 op per channel; the
 * caller commits them as one transaction (one undo step). Channels come from keyframeChannels.ts channelsFor.
 *
 * PLACEHOLDERS: every function refuses ("… is not built yet") until W2 fills it.
 */
import type * as T from '@pulseframe/time';
import type { OpCall } from './ops.ts';
import type { Clip, Track } from './schema.ts';
import type { ChannelRef, CurveHandles, Easing } from './keyframe.ts';

const notBuilt = (what: string): never => { throw new Error(`${what} is not built yet (ADR-0019 W2)`); };

/** One key of one channel, by clip-local frame index (may be < 0 or ≥ the clip's frame count: keys a trim or split left). */
export interface KeyRef { channel: ChannelRef; frame: number }
/** The keys at one clip-local frame, across channels (transform and effect). `inside`: 0 ≤ frame < the clip's frame count. */
export interface KeyAt { frame: number; channels: ChannelRef[]; easings: Easing[]; inside: boolean }
/** Every keyed frame of the clip, ascending, aggregated by EXACT frame (T.frameIndexAt of the key time), effect keys included. */
export function keyTimes(clip: Clip, track: Track, rate: T.Rate): KeyAt[] { void clip; void track; void rate; return notBuilt('keyTimes'); }
export type MoveResult = { ops: OpCall[] } | { refused: 'crosses_key' | 'lands_on_key'; channel: ChannelRef };
/**
 * Move the selected keys by `deltaFrames`, counted from their ORIGINAL positions (a drag recomputes from the start each time).
 * One range write per channel over [min(old, new), max(old, new)]. Crossing or landing on an unselected key is refused.
 */
export function moveKeysOps(clip: Clip, track: Track, rate: T.Rate, sel: readonly KeyRef[], deltaFrames: number): MoveResult { void clip; void track; void rate; void sel; void deltaFrames; return notBuilt('moveKeysOps'); }
/** Remove the selected keys: one range write (keys null over the selection's span, or the kept keys) per channel. */
export function deleteKeysOps(clip: Clip, rate: T.Rate, sel: readonly KeyRef[]): OpCall[] { void clip; void rate; void sel; return notBuilt('deleteKeysOps'); }
/** Set the curve on the selected keys: one set_keyframe_curve for the whole selection. */
export function curveOps(clip: Clip, rate: T.Rate, sel: readonly KeyRef[], side: 'after' | 'before' | 'both', easing: Easing, bezier?: CurveHandles): OpCall[] { void clip; void rate; void sel; void side; void easing; void bezier; return notBuilt('curveOps'); }
/** The key clipboard (session state, never stored): values and curves per channel, frames relative to the earliest copied key. */
export interface KeyClipboard {
  entries: {
    channel: ChannelRef;
    /** The effect type of an effect channel: paste finds the target's first effect of this type. */
    effectType?: string;
    keys: { df: number; value: number; easing: Easing; bezier?: CurveHandles }[];
  }[];
}
export function copyKeys(clip: Clip, rate: T.Rate, sel: readonly KeyRef[]): KeyClipboard { void clip; void rate; void sel; return notBuilt('copyKeys'); }
/**
 * Paste at clip-local frame `atFrame` (playhead − clip start, through T.frameTime): one range write per channel over the pasted
 * span. Effect channels map to the target's first effect of the same type; channels the target cannot carry (channelsFor:
 * an adjustment takes opacity and effects only) or whose effect is missing are skipped and reported.
 */
export function pasteKeysOps(target: Clip, track: Track, rate: T.Rate, cb: KeyClipboard, atFrame: number): { ops: OpCall[]; skipped: ChannelRef[] } { void target; void track; void rate; void cb; void atFrame; return notBuilt('pasteKeysOps'); }
