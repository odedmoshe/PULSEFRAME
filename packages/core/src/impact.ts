/**
 * Impact sync planning (wave 7 musicfit; BUILDER A). Final signature; the body throws MusicFitNotBuilt until built. Pure and exact;
 * the op sync_impact (impactOps.ts) and the editor's read-out use the same function, so the line «הרגע 4 פריימים אחרי הפעימה» and
 * the edit agree. Rules: impactOps.ts header.
 */
import type * as T from '@pulseframe/time';
import type { ProjectDocument } from './schema.ts';
import { MusicFitNotBuilt, type MusicFitRefusalKey } from './musicFitContract.ts';

export interface ImpactPlan {
  clipId: string; moment: T.RationalTime;
  /** The frame that shows the moment now, and the frame of the chosen beat. */
  momentFrame: number; targetFrame: number;
  /** The slip for slip_clip (timeline amount; sign per the clip's direction). */
  by: T.RationalTime;
  offsetBefore: { frames: number; ms: number }; residualMs: number;
  musicClipId: string; viaAssetId: string; wanted: T.RationalTime; used: T.RationalTime;
}
/** What sync_impact would do, or the refusal it would give (key and its details). */
export function planImpact(doc: ProjectDocument, clipId: string, moment: T.RationalTime | undefined, to: 'beat' | 'bar', pick: 'nearest' | 'earlier' | 'later' = 'nearest'): ImpactPlan | { refusal: MusicFitRefusalKey; details: Record<string, unknown> } {
  void doc; void clipId; void moment; void to; void pick;
  throw new MusicFitNotBuilt('planImpact');
}
