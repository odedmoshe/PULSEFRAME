/**
 * Exact numbers of the command bar (ADR-0027, plan §4.2): Hebrew and English number words and digits → a reduced bigint
 * rational. W1 builds it. PLACEHOLDER of the lead's pre-pass: it reads no number (null), never an approximate one.
 */
import type { ParseNumber } from '../commandBarContract.ts';

export const parseNumber: ParseNumber = () => null;
