/**
 * Pure helpers of the Shorts panel (ADR-0018, W3; tested in shorts.view.test.ts): edge nudges of a candidate in the review
 * list, the list's keys, the selection, the length chips. Lead contracts commit: the signatures are fixed; every body
 * refuses (throws) until W3 builds it. Times are exact rationals (ADR-0003): an edge only ever lands on a word or statement
 * edge of the transcript, never on a float.
 *
 * Keys of the review list (handled = the list's onKeyDown calls preventDefault AND stopPropagation, pattern
 * AudioFxBlock.tsx, so the global trim of commands.ts never runs): Space preview; [ and ] move the start by one statement,
 * Shift+[ and Shift+] the end, with Alt by one word; Enter toggles the selection (at most SHORTS_MAX_SELECTED).
 */
import { SHORTS_CAPS, type Statement } from '@pulseframe/core';
import type * as T from '@pulseframe/time';

/** At most this many shorts are made at once (core SHORTS_CAPS.maxShortsPerApply). */
export const SHORTS_MAX_SELECTED = SHORTS_CAPS.maxShortsPerApply;
/** The length chips of step 1, in seconds. A chip of T asks for windows of 0.6·T to 1.25·T (lengthRange). */
export const LENGTH_CHIPS = [15, 30, 45, 60, 90] as const;
export interface ReviewEdges { start: T.RationalTime; end: T.RationalTime }
export interface NudgeContext { statements: readonly Statement[]; words: readonly { start: T.RationalTime; end: T.RationalTime }[]; minSeconds: number }
export type ReviewKeyAction =
  | { kind: 'preview' }
  | { kind: 'nudge'; edge: 'start' | 'end'; dir: -1 | 1; unit: 'statement' | 'word' }
  | { kind: 'toggle' };

/** minSeconds and maxSeconds of FindShortsBody for a length chip of `seconds`. */
export function lengthRange(_seconds: number): { minSeconds: number; maxSeconds: number } {
  throw new Error('lengthRange is not built yet (shorts W3)');
}
/** Move one edge by one statement or one word; edges never cross and never come closer than minSeconds. */
export function nudgeEdge(_edges: ReviewEdges, _edge: 'start' | 'end', _dir: -1 | 1, _unit: 'statement' | 'word', _ctx: NudgeContext): ReviewEdges {
  throw new Error('nudgeEdge is not built yet (shorts W3)');
}
/** What a key does in the review list, or null (the key is not the list's: let it through). */
export function reviewKey(_e: { code: string; shiftKey: boolean; altKey: boolean; ctrlKey?: boolean; metaKey?: boolean }): ReviewKeyAction | null {
  throw new Error('reviewKey is not built yet (shorts W3)');
}
/** Toggle a candidate in the selection, capped at SHORTS_MAX_SELECTED (a toggle past the cap is ignored and reported). */
export function toggleSelection(_selected: readonly string[], _id: string): { selected: string[]; capped: boolean } {
  throw new Error('toggleSelection is not built yet (shorts W3)');
}
