/**
 * The shorts finder's ranking (ADR-0018, plan §4.3): candidate windows of one video, each with an explained RELATIVE score
 * (weighted percentiles within this video; a heuristic, never a prediction of views — SPEC.md:624). W2 builds the body;
 * this pre-pass fixes the signature and refuses honestly (it throws; it never returns made-up candidates or scores).
 * Contract: shortsContract.ts §4 (SCORE_COMPONENTS, SCORE_WEIGHTS, SCORE_PENALTIES, CANDIDATE_WARNINGS, SHORTS_RANK_METHOD).
 */
import type { FindShortsBody, HighlightInputs, ShortCandidatesResult } from './shortsContract.ts';

export function rankShortCandidates(_inp: HighlightInputs, _body: FindShortsBody): ShortCandidatesResult {
  throw new Error('rankShortCandidates is not built yet (shorts W2)');
}
