/**
 * Which frames of a timeline need more video decoders at once than a pool opens (ADR-0011): those frames are refused with
 * decode_budget (a still or an export refuses, a preview draws them without the time effect).
 *
 * Exact: every candidate frame is evaluated and counted the way drawGraph asks for pictures (frameDecoders), so a picture
 * that several layers or taps of a frame show is counted once. Cheap where it can be: only frames whose upper bound
 * (decodeLaneSteps, the steps of maxDecodeLanes) exceeds the budget are evaluated, so a timeline that fits costs no more
 * than maxDecodeLanes. Where the bound is over budget throughout, each frame is evaluated: about 1 s for 18,000 frames
 * (ten minutes at 30 fps, three stacked echo clips) on the CPU profile, measured once.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { evaluate } from './evaluate.ts';
import { frameDecoders } from './compositor2d.ts';
import { decodeLaneSteps } from './taps.ts';

/** Consecutive frames that each need more decoders than the budget. `toFrame` is exclusive. */
export interface DecodeStretch {
  fromFrame: number;
  toFrame: number;
  /** Most decoders any frame of the stretch needs. */
  peak: number;
  /** The video clips decoded for in the stretch (layers' own clips and taps' carrier clips), in the order first met. */
  clipIds: string[];
}

/** The stretches of frames that need more than `budget` video decoders at once, in frame order; empty when every frame fits. */
export function decodeOverBudget(doc: ProjectDocument, budget: number, sequenceId = doc.mainSequenceId): DecodeStretch[] {
  const rate = doc.settings.frameRate;
  const steps = decodeLaneSteps(doc, sequenceId);
  type Open = DecodeStretch & { ids: Set<string> };
  const out: Open[] = [];
  let open: Open | null = null;
  for (let s = 0; s + 1 < steps.length; s++) {
    const [from, bound] = steps[s]!;
    if (bound <= budget) continue;
    for (let F = from, to = steps[s + 1]![0]; F < to; F++) {
      const need = frameDecoders(evaluate(doc, T.frameTime(F, rate), sequenceId));
      if (need.count <= budget) continue;
      if (!open || open.toFrame !== F) { open = { fromFrame: F, toFrame: F, peak: 0, clipIds: [], ids: new Set() }; out.push(open); }
      open.toFrame = F + 1;
      open.peak = Math.max(open.peak, need.count);
      for (const id of need.clipIds) open.ids.add(id);
    }
  }
  return out.map(({ ids, ...x }) => ({ ...x, clipIds: [...ids] }));
}
