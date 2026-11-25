/**
 * Size-fit plan (wave 7, track send). Worker B's file: the signatures are the lead's contract, the bodies are stubs until B lands
 * them (send-decisions §2.1, C4): integer arithmetic only; scale in [1, 1/2, 1/4] (never above maxScale), audio in [96, 64, 48]
 * kb/s inside each scale, the first pair whose video rate meets the heuristic floor wins, so the accepted targets are
 * [minBytes, ∞). The server (apps/server/src/sizeFit.ts) runs the encodes; this file only plans.
 */
import type { SizeFitInput, SizeFitPlan, SizeFitRefusal } from './sendContract.ts';

/** True once B has built the plan; until then the export refuses a target size with the blocker size_fit_not_built. */
export const SIZE_FIT_BUILT = false;
const notBuilt = (name: string): never => { throw new Error(`${name} is not built yet (send B)`); };

/** The fit for a target, or the refusal with the smallest target that works. */
export function planSizeFit(input: SizeFitInput): SizeFitPlan | SizeFitRefusal { void input; return notBuilt('planSizeFit'); }
/** The smallest target planSizeFit accepts for this film (quarter size, 48 kb/s). */
export function sizeFitMinBytes(input: Omit<SizeFitInput, 'targetBytes'>): number { void input; return notBuilt('sizeFitMinBytes'); }
/** The one retry's video rate: v·(target/got)·97/100, floored (integers). */
export function retryBitrate(videoBitrate: number, targetBytes: number, gotBytes: number): number { void videoBitrate; void targetBytes; void gotBytes; return notBuilt('retryBitrate'); }
