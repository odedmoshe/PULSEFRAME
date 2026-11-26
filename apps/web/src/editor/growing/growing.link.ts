/**
 * Memory-only hand-over between the bar and the dialog (wave 8 growing, W3): «החזרת החלקים שנמחקו» asks the dialog to open on the
 * deleted picks, and the last apply / rebuild answer is kept for «למה?». Module variables: never storage, never sent anywhere.
 * Nothing here is an eye mark (the answer holds transforms and numbers the document holds anyway).
 */
import type { GrowingPick, GrowingExclusion } from '@pulseframe/core';

export interface GrowingIntent { restore: { runId: string } | null }
let intent: GrowingIntent = { restore: null };
export const setGrowingIntent = (i: GrowingIntent): void => { intent = i; };
export const takeGrowingIntent = (): GrowingIntent => { const i = intent; intent = { restore: null }; return i; };

export interface GrowingLast { runId: string; picks: GrowingPick[]; excluded: GrowingExclusion[] }
let last: GrowingLast | null = null;
const listeners = new Set<() => void>();
export const setGrowingLast = (v: GrowingLast | null): void => { last = v; listeners.forEach((l) => l()); };
export const getGrowingLast = (): GrowingLast | null => last;
export const subscribeGrowingLast = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
