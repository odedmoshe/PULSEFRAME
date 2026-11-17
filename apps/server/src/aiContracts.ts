/**
 * Shared contracts of the AI-model wave (ADR-0017). Types only, plus the two request schemas: the frame-job and capability work (W1),
 * the local-tools runner (W2) and the REST/MCP surface (W3) build against these names and shapes.
 */
import { z } from 'zod';
import type { LocalToolDescriptor } from '@pulseframe/providers';
import type { Principal } from './auth.ts';
import type { ModelStore } from './models.ts';
import type { JobRow } from './store.ts';

/** What a run reads: a timeline clip (its exact source span) or a library asset, optionally a frame range of it. */
export const RunSourceSchema = z.union([
  z.object({ clipId: z.string().min(1).max(64) }).strict(),
  z.object({ assetId: z.string().regex(/^ast_[A-Za-z0-9]+$/), range: z.object({ firstFrame: z.number().int().nonnegative(), frameCount: z.number().int().positive() }).strict().optional() }).strict(),
]);
export type RunSource = z.infer<typeof RunSourceSchema>;
/** Where a result goes: only the library, in place of the source clip (replace_clip_asset under preconditions), or onto a new track (add_clip). */
export const ApplyModeSchema = z.enum(['library', 'replace-clip', 'new-track']);
export type ApplyMode = z.infer<typeof ApplyModeSchema>;
export interface RunRequest {
  projectId: string; capabilityId: string; params: Record<string, unknown>; actor: string; principal?: Principal;
  idempotencyKey?: string; attach?: { start: unknown; duration?: unknown; trackId?: string }; dependsOn?: string[];
  source?: RunSource; apply?: ApplyMode; confirmLongRun?: boolean;
}
export type SetupCode = 'ready' | 'provider_not_configured' | 'provider_unreachable' | 'engine_not_configured' | 'engine_not_working'
  | 'engine_unverified' | 'model_missing' | 'licence_blocked' | 'host_not_allowed' | 'disk_insufficient';
/** Every setup code, in the order a person fixes them (for tests and UI tables). */
export const SETUP_CODES: readonly SetupCode[] = ['ready', 'provider_not_configured', 'provider_unreachable', 'engine_not_configured', 'engine_not_working', 'engine_unverified', 'model_missing', 'licence_blocked', 'host_not_allowed', 'disk_insufficient'];
export interface SetupState { code: SetupCode; detail: string; hosts?: string[]; missingBytes?: number; freeBytes?: number; device?: string | null; versions?: Record<string, string> }
export interface JobProgress { unit: 'frames' | 'chunks' | 'phrases' | 'samples'; done: number; total: number; basis: 'measured' }
export interface JobEta { seconds: number | null; basis: 'this-run' | 'measured-profile' | 'none' }
export interface ChunkRecord { k: number; firstFrame: number; frames: number; sha256: string[]; seconds: number; requestId: string }
/** Persisted in job.input.frames before dispatch. */
export interface FramePlan {
  mode: 'per-frame' | 'pairwise' | 'sampled';
  firstFrame: number; frameCount: number; rate: { num: number; den: number }; outputRate: { num: number; den: number };
  width: number; height: number; multiplier: number | null; sampleEvery: number | null;
  chunks: { k: number; first: number; count: number; overlapIn: 0 | 1 }[];
  expectedOutputFrames: number; heldFrames: number[];
}
export interface CapabilityEstimate {
  capabilityId: string; setup: SetupState; frames: number | null; chunks: number | null;
  missingDownloadBytes: number; scratchBytes: number; seconds: number | null; basis: 'measured-profile' | 'none';
  needsConfirm: boolean; blockers: { code: string; message: string }[];
}
export interface ComputeLane {
  /** FIFO single heavy slot. While waiting, the caller shows stage `queued (waiting for compute: <holder label>)`. */
  acquire(label: string, signal?: AbortSignal): Promise<() => void>;
  /** Runs before each heavy holder starts (e.g. release kept speech/tool workers). */
  onBeforeHeavy(fn: () => Promise<void> | void): void;
  busy(): { holder: string | null; waiting: number };
  /** Set by server export; while true, frame jobs dispatch no new chunk. */
  setExportActive(active: boolean): void;
  exportActive(): boolean;
}
/** Implemented by W2 (localtools.ts); called by W1 (capabilities.ts) for provider 'local'. Job type stays 'capability'. */
export interface LocalToolRunner {
  setup(d: LocalToolDescriptor): Promise<SetupState>;
  models(): ModelStore; // on PF_TOOLS_MODELS_DIR
  /** Validates source/params for the task and returns the job.input additions to persist; throws ApiError. */
  prepare(d: LocalToolDescriptor, req: RunRequest): Promise<Record<string, unknown>>;
  /** Drives an already-persisted job row to succeeded/failed/canceled. Never throws. */
  drive(jobId: string, d: LocalToolDescriptor): Promise<void>;
  cancel(jobId: string, actor: string): { jobId: string; status: string; outcome: string };
  recover(jobs: JobRow[]): void;
  releaseKept(): Promise<void>;
}
/** Capabilities' public surface used by W3 (http.ts/mcp.ts). */
export interface CapabilityService {
  start(req: RunRequest): JobRow;
  estimate(req: RunRequest): Promise<CapabilityEstimate>;
  cancel(jobId: string, actor: string): Promise<{ jobId: string; status: string; outcome: string }>;
}
