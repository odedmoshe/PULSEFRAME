/**
 * «גדלים מול העיניים»: the pure planner (wave 8 growing, W1 owns this file). Contract: growingContract.ts (frozen). Until W1 builds
 * them, every function here throws GrowingNotBuilt (never a made-up value) and GROWING_BUILT stays false.
 */
import { GrowingNotBuilt, type EyesFromTransform, type PlanGrowing, type SolveAlignment, type SuggestEyeOrder } from './growingContract.ts';

/** Plan §3.3 and §4 with verifier C10–C12: transforms, order, holds, dissolves, captions, coverage, steps and slots. */
export const planGrowing: PlanGrowing = () => { throw new GrowingNotBuilt('planGrowing'); };
/** Plan §4.1–4.4 with C10, C11: the similarity transform for one pick (no swap; centre without trigonometry). */
export const solveAlignment: SolveAlignment = () => { throw new GrowingNotBuilt('solveAlignment'); };
/** C7/C8: the exact inverse of solveAlignment, used by the rebuild for untouched picks and by the dialog to place computed points. */
export const eyesFromTransform: EyesFromTransform = () => { throw new GrowingNotBuilt('eyesFromTransform'); };
/** C10: the default order of two clicks (the swap rule as a default only). */
export const suggestEyeOrder: SuggestEyeOrder = () => { throw new GrowingNotBuilt('suggestEyeOrder'); };
