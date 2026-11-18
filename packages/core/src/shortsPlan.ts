/**
 * The shorts planner (ADR-0018, plan §4.4): picks → one apply_sequence_plan of public ops with bindings, its origins and a
 * readable plan view. Pure; times exact (ADR-0003): sourceIn is the exact span start, durations are ceiled to whole frames
 * (outward), starts are running sums of whole frames; pieces split at scene cuts by speed.ts sourceFrameIndexAt; 10 ms fades
 * (shortsContract.ts JOIN_FADE) at removal joins only; every added cut respects flashSafety.ts flashGapFrames. W1 builds the
 * body; this pre-pass fixes the signature and refuses honestly (it throws; it never returns a made-up plan).
 */
import type { ProjectDocument } from './schema.ts';
import type { BuildShortsBody, ShortsPlan, ShortsPlanContext } from './shortsContract.ts';

export function planShorts(_doc: ProjectDocument, _body: BuildShortsBody, _ctx: ShortsPlanContext): ShortsPlan {
  throw new Error('planShorts is not built yet (shorts W1)');
}
