/**
 * The command bar's grammar (ADR-0027): interpret(text, ctx) → BarResult. W1 builds it (normalize, numbers, time, lexicon,
 * match, resolve, plans) against ../commandBarContract.ts.
 * PLACEHOLDER of the lead's pre-pass: it understands nothing and says so — every request is 'unknown' with all of its text
 * unread — so nothing is ever planned or run before the grammar exists (COMMAND_BAR_GRAMMAR_BUILT is false).
 */
import type { BarContext, BarResult, Interpret } from '../commandBarContract.ts';

export const interpret: Interpret = (text: string, _ctx: BarContext): BarResult => ({ kind: 'unknown', tokens: [], readings: [], unread: text.trim() ? [[0, text.length]] : [], partial: [] });
