/**
 * Loudness of single clips (wave 7, track send): POST /api/v1/projects/:id/analysis/clip-loudness and MCP measure_clip_loudness.
 * Worker A's file. The body schema and the signature are the lead's contract; until A lands the measurement every call answers
 * 501 not_built (core SEND_API_REFUSALS.clipLoudnessNotBuilt) after the permission and existence checks the route makes.
 * The measurement (send-plan §4.5): each clip alone through the export mixer (mixToRaw with a one-clip plan: its effects, speed,
 * fades, volume keys, clip × track gain; ducking flat) → ffmpeg R128 + sample peak; under 0.4 s too_short, under 3 s short, silent
 * skipped; the result carries the project revision (commit the match with expectedRevision) and each clip's gain.
 */
import { z } from 'zod';
import { LOUDNESS_MATCH, SEND_API_REFUSALS, type ClipLoudnessResult } from '@pulseframe/core';
import { ApiError, type Store } from './store.ts';

export const ClipLoudnessBody = z.object({
  clipIds: z.array(z.string()).min(1).max(LOUDNESS_MATCH.maxClips).describe('The clips to measure (sound clips on sound tracks)'),
  sequenceId: z.string().optional().describe('The sequence the clips are in; absent = the main edit'),
  background: z.boolean().optional().describe('Run as a durable analysis job (202 with a jobId)'),
}).strict();
export type ClipLoudnessBodyT = z.infer<typeof ClipLoudnessBody>;
export const CLIP_LOUDNESS_BUILT = false;
const A = SEND_API_REFUSALS.clipLoudnessNotBuilt;
export const clipLoudnessNotBuilt = () => new ApiError(A.status, A.code, A.message(), {}, A.hint);

/** Measure each clip as export would mix it alone. Read-only. */
export async function measureClipLoudness(store: Store, projectId: string, body: ClipLoudnessBodyT, isCanceled: () => boolean = () => false): Promise<ClipLoudnessResult> {
  void store; void projectId; void body; void isCanceled;
  throw clipLoudnessNotBuilt();
}
