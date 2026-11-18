/**
 * Perform mode's moves (ADR-0025, W1): the pad catalogue, the two named banks, the grid a take snaps to, quantise and the pure
 * planner. Typed by performContract.ts (lead; do not edit it, ops.ts, schema.ts or index.ts). This pre-pass fixes the
 * signatures and refuses honestly: every function throws until W1 builds it; nothing here returns a made-up plan.
 *
 * W1 brief (the plan's "Corrected notes" and wave5-decisions.md win over the plan body):
 * - Pure: no Date, no Math.random, no engine import. Round every number that enters args to 1e-6; sort hits by (frame, pad, tap).
 * - The flash rule is performFlash.ts (takeFlashBreach, lightRanges, lightChanges, flashClassOf): hold a hit `flash_limit`
 *   instead of planning what the op would refuse. Test plans through the REAL op (applyTransaction with apply_take,
 *   allowInternal); do not write a second step runner.
 * - Steps only from TAKE_STEP_OPS. No freeze (wave 2). The zoom punch is scale keys on the clip (one look everywhere).
 * - Lengths in the specs are seconds; frames come from frameOfSeconds once, from the absolute time.
 * - Set PERFORM_PLANNER_BUILT to true when planPerformance, quantiseTaps and performGrid are built: the route then plans for real.
 */
import type { DefaultBank, FrameOfSeconds, MoveSpec, PerformGrid, PlanPerformance, QuantiseTaps } from './performContract.ts';

/** W1 sets this to true with the bodies; until then POST /takes answers 501 take_not_built. */
export const PERFORM_PLANNER_BUILT: boolean = false;
const notBuilt = (name: string): never => { throw new Error(`${name} is not built yet (perform W1)`); };

/** The pad catalogue, by move id (W1: punch; Canvas2D adjust hits; GPU adjust hits; the beat strobe; sound, title, sticker). Empty until built. */
export const MOVES: readonly MoveSpec[] = [];
export const frameOfSeconds: FrameOfSeconds = () => notBuilt('frameOfSeconds');
export const performGrid: PerformGrid = () => notBuilt('performGrid');
export const quantiseTaps: QuantiseTaps = () => notBuilt('quantiseTaps');
export const planPerformance: PlanPerformance = () => notBuilt('planPerformance');
/** 'canvas' (the default, Canvas2D on every machine) or 'gpu' (shake, glitch, pulse: needs a graphics adapter). */
export const defaultBank: DefaultBank = () => notBuilt('defaultBank');
