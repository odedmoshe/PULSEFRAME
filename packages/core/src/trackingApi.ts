/**
 * The tracking job's API shapes (ADR-0015), shared by the server (job, REST, MCP) and the editor.
 * A track is computed by a durable job of type TRACKING_JOB_TYPE and attached through the internal op attach_motion_track.
 */
import { z } from 'zod';
import type { MotionTrack, TrackProblem, TrackStateName } from './tracking.ts';

export const TRACKING_JOB_TYPE = 'tracking';
export const TRACKER_METHOD = 'pf-track 1: pyramidal Lucas-Kanade median flow with forward-backward check and NCC verification (no model)';
export const TRACK_WORK_HEIGHT = 360;
export const TRACK_MARGIN_FRAMES = 15;
/** POST /api/v1/projects/:id/motion-tracks/:motionTrackId/track → 202 { jobId, status }. Source frames, [from, to). */
export const TrackRunBody = z.object({ from: z.number().int().min(0).optional(), to: z.number().int().min(1).optional(), direction: z.enum(['both', 'forward', 'backward']).default('both'), input: z.enum(['proxy', 'original']).default('proxy'), overwrite: z.boolean().optional() }).strict();
export type TrackRun = z.infer<typeof TrackRunBody>;
export interface TrackingJobInput { motionTrackId: string; assetId: string; from: number; to: number; direction: 'both' | 'forward' | 'backward'; input: 'proxy' | 'original'; overwrite?: true; trackVersion: number | null; projectRevision: number }
export interface TrackingJobOutput { motionTrackId: string; revision: number; from: number; to: number; frames: number; decodedFrames: number; trackingFps: number; input: 'proxy' | 'original'; counts: Record<TrackStateName, number>; problems: TrackProblem[] }
/** GET /api/v1/projects/:id/motion-tracks/:motionTrackId; MCP get_motion_track. */
export interface MotionTrackView { revision: number; motionTrackId: string; assetId: string; name: string; kind: MotionTrack['kind']; from: number; to: number; origin: MotionTrack['origin']; counts: Record<TrackStateName, number>; problems: TrackProblem[]; usedBy: { follow: string[]; redact: string[] }; note: string }
/** Job stage text; i18n STAGE_WORDS keys: 'reading frames', 'tracking forward', 'tracking backward', 'saving track'. */
export const trackingStage = (phase: 'reading' | 'forward' | 'backward' | 'saving', done = 0, total = 0): string =>
  phase === 'reading' ? 'reading frames' : phase === 'saving' ? 'saving track' : `tracking ${phase} ${done}/${total}`;
