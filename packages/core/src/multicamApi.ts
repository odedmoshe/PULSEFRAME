/**
 * REST shapes of multicam (ADR-0020), shared by the server (routes, sync job, MCP) and the editor (api.ts); the trackingApi.ts
 * precedent. Lead contract; W2 builds the routes' bodies, W3 the calls.
 *
 * Routes (apps/server/src/http.ts; bodies in multicamSync.ts):
 *   POST /api/v1/projects/:id/multicam/:groupId/sync   (edit; dryRun: observe) -> MulticamSyncReport | 202 { jobId, status }
 *        background:true runs a durable job of type 'analysis' with input.kind MULTICAM_SYNC_KIND (the runAnalysisJob family),
 *        cancelled between pieces and recovered after a restart. A hand-synced file measured again without overwrite answers
 *        409 would_discard_edits (op refusal wouldDiscardManual).
 *   GET  /api/v1/projects/:id/multicam/:groupId        (observe) -> MulticamView
 *   POST /api/v1/projects/:id/assets/:assetId/derivatives/envelope (observe) -> the derivative row (built on demand under heavy())
 * MCP (W2): sync_multicam (the sync route; dryRun for observe credentials) and get_multicam (read-only).
 * Import queue (ADR-0023): a file enters the library (import_asset) only once its upload is complete, so a group is only ever
 * made of whole files; «סנכרון וחיתוך» offers library files only, and a phone drop's files can be grouped as they arrive.
 */
import { z } from 'zod';
import type { MulticamGroup } from './schema.ts';
import type { SyncVerdict } from './multicamLimits.ts';
import { RationalTimeSchema } from './schema.ts';

/** input.kind of the durable analysis job that syncs a group. */
export const MULTICAM_SYNC_KIND = 'multicam-sync' as const;
/** The stage text of that job (i18n STAGE_WORDS); 'measuring sound 2/5' keeps its count. */
export const MULTICAM_SYNC_STAGES = ['measuring sound', 'matching angles', 'fitting sync', 'saving sync'] as const;
export const multicamSyncStage = (stage: (typeof MULTICAM_SYNC_STAGES)[number], done?: number, total?: number): string => (total ? `${stage} ${done ?? 0}/${total}` : stage);
export const MulticamSyncBody = z.object({
  angleIds: z.array(z.string()).min(1).max(9).optional(), overwrite: z.boolean().optional(), dryRun: z.boolean().optional(),
  minOverlapSeconds: z.number().min(5).max(600).optional(), maxOffsetSeconds: z.number().min(1).max(14400).optional(), background: z.boolean().optional(),
  /** Capture-time priors (multicamPrior.ts): order near-equal candidates and widen the search to cover them. Default true. */
  useCapturePriors: z.boolean().optional(),
}).strict();
export type MulticamSyncRequest = z.infer<typeof MulticamSyncBody>;
export type MulticamPieceWhy = 'no_audio' | 'no_shared_sound' | 'ambiguous' | 'too_short' | 'inconsistent' | 'manual_kept' | null;
export interface MulticamPieceReport {
  angleId: string; pieceIndex: number; assetId: string; verdict: SyncVerdict; offsetSeconds: number | null; driftPpm: number | null; peakZ: number | null; peakRatio: number | null; residualMs: number | null; anchors: number; chainDepth: number;
  candidates: { offsetSeconds: number; score: number }[];
  /** The capture-time prior of this file (multicamPrior.ts), or null; reported, never attached. */
  captureOffsetSeconds: number | null;
  why: MulticamPieceWhy;
}
export interface MulticamSyncReport { revision: number; groupId: string; committed: boolean; pieces: MulticamPieceReport[]; method: string; note: string; timingsMs: { envelope: number; coarse: number; fine: number } }
export interface MulticamView {
  revision: number; group: MulticamGroup;
  coverage: { angleId: string; pieceIndex: number; startSeconds: number; endSeconds: number }[];
  programTracks: { sequenceId: string; trackId: string; segments: number }[];
  outOfSync: { clipId: string; startFrames: number; endFrames: number }[];
  envelopes: { assetId: string; status: 'ready' | 'building' | 'missing' | 'failed' }[];
  capturePriors: { angleId: string; pieceIndex: number; offsetSeconds: number | null; uncertaintySeconds: number | null; why: string | null }[];
}
/** The preflight issue of a segment out of step with the master sound (W2 preflight.ts; warn, never block). */
export const MULTICAM_PREFLIGHT_CODE = 'multicam_out_of_sync' as const;

// ---------- auto-switch (recipe 'multicam-auto'; planner multicamAuto.ts) ----------
export const MULTICAM_AUTO_RECIPE_ID = 'multicam-auto' as const;
/** The heuristic's own label, first step of every plan (the editor shows it with the plan). */
export const MULTICAM_AUTO_LABEL = 'Heuristic: the clearly loudest mic decides the shot; this is not speaker identification';
export const MulticamAutoParams = z.object({
  groupId: z.string(), trackId: z.string().optional(), from: RationalTimeSchema.optional(), to: RationalTimeSchema.optional(),
  minShotSeconds: z.number().min(0.5).max(30).default(2), switchHoldMs: z.number().int().min(0).max(3000).default(300),
  bothHoldMs: z.number().int().min(200).max(5000).default(1000), silenceHoldMs: z.number().int().min(200).max(10000).default(2000),
  preRollMs: z.number().int().min(0).max(1000).default(200), marginDb: z.number().min(1).max(20).default(6),
  maxShotSeconds: z.number().min(2).max(120).nullable().default(null), useTranscripts: z.boolean().default(true),
}).strict();
export interface AutoDecision { frame: number; angleId: string; reason: 'speaker' | 'both' | 'silence' | 'max-shot'; speakerId: string | null; marginDb: number | null; unsure: boolean }
