/**
 * The browser side of proof F8 (wave 7 craft): window.__pfCraftMatch runs core matchText in THIS browser over the cases the proof
 * passes in (the cases of packages/core/src/findReplace.golden.json), so the proof compares Node and Chromium. Imported by
 * selftest.ts; the editor never loads it.
 */
import { matchText } from '@pulseframe/core';

export interface MatchCase { text: string; needle: string; flags: { wholeWord: boolean; ignoreMarks: boolean; finalsEqual: boolean; ignoreCase: boolean } }
const run = (cases: MatchCase[]): [number, number][][] => cases.map((c) => matchText(c.text, c.needle, c.flags));
(window as unknown as { __pfCraftMatch: typeof run }).__pfCraftMatch = run;
