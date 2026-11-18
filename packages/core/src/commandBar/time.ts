/**
 * Exact times of the command bar (ADR-0027, plan §4.3): units, compounds, timecodes and positions → one frame index
 * (T.nearestFrameIndex once, ties up). W1 builds it; no parseFloat, toFixed or Math.round on time values here.
 * PLACEHOLDER of the lead's pre-pass: it reads no time (null).
 */
import type { ParseTime } from '../commandBarContract.ts';

export const parseTime: ParseTime = () => null;
