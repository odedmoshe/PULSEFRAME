/**
 * Provider adapter contract (SPEC §18/§20 + Amendment A1 FF-02). PULSEFRAME's job layer stays
 * authoritative; an adapter only executes. Every progress value says how it was obtained.
 */
import type { CapabilityDescriptor } from './descriptor.ts';

export type Stage = 'preparing' | 'queued' | 'inference' | 'post-processing' | 'transfer';
export interface Progress { stage: Stage; fraction: number | null; basis: 'measured' | 'estimated' | 'unknown'; detail?: string }
export interface Readiness {
  reachable: boolean;
  /** Probing must never start a billable worker (FF-07). */
  wokeWorker: false;
  runtimeVersion: string | null;
  device: { name: string; type: string; vramTotalBytes: number | null } | null;
  hostRamBytes: number | null;
  missingNodeClasses: string[];
  missingModels: string[];
  problems: string[];
}
export interface Estimate { downloadBytes: number; durationSeconds: number | null; costUsd: number | null; basis: 'measured-profile' | 'none' }
export interface Submission { providerJobId: string; clientRequestId: string }
export type RemoteState = { state: 'unknown' } | { state: 'queued'; position: number | null } | { state: 'running' } | { state: 'succeeded' } | { state: 'failed'; message: string };
export interface CollectedOutput { name: string; role: string; mediaType: 'image' | 'video' | 'audio'; encoding: string; fileName: string; bytes: Uint8Array }
export type CancelOutcome = 'removed-from-queue' | 'interrupt-requested' | 'not-found' | 'not-supported';

export interface ProviderAdapter {
  readonly id: string;
  probe(descriptor?: CapabilityDescriptor): Promise<Readiness>;
  estimate(descriptor: CapabilityDescriptor): Estimate;
  /** Copy one local source file to the provider under a caller-chosen, content-addressed name. Idempotent. Returns the reference to bind in the graph. */
  stage(localPath: string, name: string, mimeType: string): Promise<string>;
  /** `clientRequestId` is persisted by the caller BEFORE this call so an ambiguous outcome can be reconciled. */
  submit(graph: Record<string, unknown>, clientRequestId: string): Promise<Submission>;
  status(providerJobId: string): Promise<RemoteState>;
  /** Find a job by the id we generated, for submissions whose response was lost. */
  findByClientRequestId(clientRequestId: string): Promise<string | null>;
  cancel(providerJobId: string): Promise<CancelOutcome>;
  collect(descriptor: CapabilityDescriptor, providerJobId: string): Promise<CollectedOutput[]>;
}
