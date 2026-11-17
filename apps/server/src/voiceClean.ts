/**
 * measure_voice (ADR-0013): the background noise, mains hum and speech level of a sound clip's recording, measured from the
 * original file, and the clean_voice operations that would clean it. Read-only, model-free: nothing is stored in the project;
 * the result carries candidate ops in the findSilences pattern (http.ts), to be sent as ONE transaction with expectedRevision.
 * Wired by the lead: POST /api/v1/projects/:id/analysis/voice (job kind 'voice') and the MCP tool measure_voice.
 *
 * SKELETON of the lead's contracts pass (plan "Lead contracts" 12): W2 implements measureVoiceCheck.
 */
import { z } from 'zod';
import { RationalTimeSchema, type OpCall } from '@pulseframe/core';
import type { VoiceMeasurement } from '@pulseframe/engine';
import type { Store } from './store.ts';

export const VoiceMeasureBody = z.object({
  clipId: z.string(),
  strength: z.number().min(0).max(1).optional(),
  noiseRanges: z.array(z.object({ start: RationalTimeSchema, end: RationalTimeSchema })).max(50).optional().describe('SOURCE-time stretches that hold only noise'),
  scope: z.enum(['clip', 'asset']).optional().describe('asset: one clean_voice op per sound clip of the same recording'),
}).strict();
export interface VoiceCheck {
  revision: number; assetId: string; clipIds: string[]; method: string;
  /** ranges in source seconds */
  report: VoiceMeasurement;
  recommendedStrength: number;
  /** clean_voice with clipId, strength, profile, source: assetId, mainsHz */
  ops: OpCall[];
  /** 'Candidates only. To apply, send `ops` as ONE transaction with expectedRevision set to this revision. Measured, not listened to.' */
  note: string;
}
/** Decode at 48 kHz stereo inside heavy() (analysis.ts), at most 600 s (evenly spaced 20 s windows), streaming into voiceMeter. */
export async function measureVoiceCheck(_store: Store, _projectId: string, _body: z.infer<typeof VoiceMeasureBody>): Promise<VoiceCheck> {
  throw new Error('not implemented: W2');
}
