/**
 * Named versions on the server (wave 7 craft; craft/contract.ts has the rules). W2 BUILDS THIS: the table (VERSIONS_TABLE,
 * CREATE TABLE IF NOT EXISTS project_versions(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER
 * NOT NULL, transaction_id TEXT, doc TEXT NOT NULL, doc_hash TEXT NOT NULL, bytes INTEGER NOT NULL, frames INTEGER NOT NULL,
 * actor TEXT NOT NULL, privacy_digest TEXT NOT NULL, created_at TEXT NOT NULL)), save, list, rename, delete, the privacy gate,
 * the diff, the still and restore. Until then each function answers 501 craft_not_built.
 */
import type { DiffSummary, ProjectDocument, VersionInfo } from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import type { Exporter } from '../export.ts';
import type { Governance } from '../governance.ts';
import type { Store } from '../store.ts';
import { craftError } from './contract.ts';

export interface RestoreResult { revision: number; transactionId: string | null; summary: string; diff: DiffSummary }
const notBuilt = (): never => { throw craftError('notBuilt'); };

export function saveVersion(store: Store, gov: Governance, p: Principal, projectId: string, name: string): VersionInfo { void store; void gov; void p; void projectId; void name; return notBuilt(); }
export function listVersions(store: Store, p: Principal, projectId: string): VersionInfo[] { void store; void p; void projectId; return notBuilt(); }
export function renameVersion(store: Store, p: Principal, projectId: string, versionId: string, name: string): VersionInfo { void store; void p; void projectId; void versionId; void name; return notBuilt(); }
export function deleteVersion(store: Store, p: Principal, projectId: string, versionId: string): { deleted: string } { void store; void p; void projectId; void versionId; return notBuilt(); }
/** The version's copy as this credential may read it (privacy gate first). */
export function versionDoc(store: Store, p: Principal, projectId: string, versionId: string): ProjectDocument { void store; void p; void projectId; void versionId; return notBuilt(); }
export function diffVersions(store: Store, p: Principal, projectId: string, versionId: string, against: 'current' | string): DiffSummary { void store; void p; void projectId; void versionId; void against; return notBuilt(); }
export async function versionStill(store: Store, exporter: Exporter, p: Principal, projectId: string, versionId: string, index: number): Promise<Buffer> { void store; void exporter; void p; void projectId; void versionId; void index; return notBuilt(); }
export function restoreVersion(store: Store, gov: Governance, p: Principal, projectId: string, versionId: string, opts: { expectRevision?: number; confirmPrivacy?: boolean }): RestoreResult { void store; void gov; void p; void projectId; void versionId; void opts; return notBuilt(); }
