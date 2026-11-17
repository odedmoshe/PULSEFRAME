/**
 * match_colour (ADR-0014): colour match to a reference clip, or automatic colour balance, for picture clips. Read-only: stills are
 * rendered from scratch documents through the export compositor (Exporter.renderStill), measured and fitted (engine
 * colourMatch.ts), verified by a second render, and returned as candidate set_colour_grade ops. Nothing is stored.
 * Wired by the lead: POST /api/v1/projects/:id/analysis/colour-match (job kind 'colour') and the MCP tool match_colour.
 *
 * SKELETON of the lead's contracts pass (plan "Lead contracts" 12): W3 implements matchColour.
 */
import { z } from 'zod';
import type { OpCall } from '@pulseframe/core';
import type { GradeFit, GradeParams, PictureStats } from '@pulseframe/engine';
import type { Exporter } from './export.ts';
import type { Store } from './store.ts';

export const ColourMatchBody = z.object({
  method: z.enum(['match', 'balance']).default('match'),
  referenceClipId: z.string().optional(),
  targetClipIds: z.union([z.array(z.string()).min(1).max(200), z.literal('all')]),
  amount: z.number().min(0).max(1).default(1),
  samples: z.union([z.literal(1), z.literal(3)]).default(3),
}).strict();
export interface ColourMatchTarget {
  clipId: string; params: GradeParams; residual: { model: number; verified: number | null }; verdict: GradeFit['verdict']; limitedBy: (keyof GradeParams)[];
  warnings: ('changes_within_clip' | 'not_verified' | 'replaces_grade' | 'animated_grade')[];
  statsBefore: PictureStats; statsAfter: PictureStats | null;
}
export interface ColourMatch {
  revision: number; method: 'match' | 'balance'; reference: { clipId: string; stats: PictureStats } | null; targets: ColourMatchTarget[];
  /** set_colour_grade, mode replace; clips with an animated grade are left out */
  ops: OpCall[];
  unavailable: string | null; note: string;
}
export async function matchColour(_store: Store, _exporter: Exporter, _projectId: string, _body: z.infer<typeof ColourMatchBody>): Promise<ColourMatch> {
  throw new Error('not implemented: W3');
}
