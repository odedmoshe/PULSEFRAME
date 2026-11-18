/**
 * The shared contracts of the phone drop and the import queue (ADR-0023) that the lead pre-pass owns: the optional
 * provenance field and its validation, the one mapping from a job row to a card state, the retryable codes, and the actor
 * names. The queue, the door and the cards are the workers' and are tested in their own files.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  actorKind, applyTransaction, AssetSchema, convertingStage, createProject, diffEntities, IMPORT_ERROR_CODES, IMPORT_RETRYABLE, importCardState, importErrorRetryable, isPhoneActor, OpError, phoneActor, ProjectSchema,
  restoreEntities, SCHEMA_VERSION, UploadProvenanceSchema, validateProject, type OpCall, type ProjectDocument, type UploadProvenance,
} from './index.ts';

let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `pd${n++}_`, actor: 'test', allowInternal: true });
const picture = (upload?: UploadProvenance, origin: 'upload' | 'fixture' = 'upload') => ({
  kind: 'image' as const, name: 'IMG_0001.jpg', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 10, container: 'jpeg', mimeType: 'image/jpeg', duration: T.ZERO,
  image: { width: 4032, height: 3024, codec: 'mjpeg', hasAlpha: false },
  provenance: { origin, importedAt: '2026-11-18T10:00:00.000Z', importedBy: upload?.via === 'phone' ? phoneActor(upload.dropId ?? 'x') : 'user:local', ...(upload ? { upload } : {}) },
});
const importOf = (asset: ReturnType<typeof picture>) => tx(createProject({ id: 'prj_pd', name: 'Drop' }), [{ op: 'import_asset', args: { asset } }]);
const refused = (asset: ReturnType<typeof picture>): string => {
  try { importOf(asset); } catch (e) { if (e instanceof OpError) return `${e.code}: ${e.message}`; throw e; }
  return 'accepted';
};

describe('import provenance (optional field, no version bump)', () => {
  it('the schema version is unchanged; an asset without the field parses as before', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(AssetSchema.omit({ id: true }).safeParse(picture()).success).toBe(true);
  });
  it('the three ways in parse, and a phone file carries its drop id, not a secret', () => {
    for (const up of [{ via: 'browser', jobId: 'job_1' }, { via: 'folder', jobId: 'job_2', relativePath: 'חתונה/IMG_1.jpg' }, { via: 'phone', jobId: 'job_3', dropId: 'drp_1' }] as UploadProvenance[])
      expect(UploadProvenanceSchema.safeParse(up).success).toBe(true);
    expect(UploadProvenanceSchema.safeParse({ via: 'phone', jobId: 'job_3', dropId: 'drp_1', token: 'x' }).success).toBe(false); // strict
    expect(UploadProvenanceSchema.safeParse({ via: 'email', jobId: 'job_3' }).success).toBe(false);
    expect(UploadProvenanceSchema.safeParse({ via: 'folder', jobId: 'job_3', relativePath: 'x'.repeat(513) }).success).toBe(false);
  });
  it('import_asset takes it; undo removes the asset exactly', () => {
    const before = createProject({ id: 'prj_pd', name: 'Drop' });
    const r = tx(before, [{ op: 'import_asset', args: { asset: picture({ via: 'phone', jobId: 'job_3', dropId: 'drp_1' }) } }]);
    const id = r.results[0]!.output!.assetId as string;
    expect(r.doc.assets[id]!.provenance.upload).toEqual({ via: 'phone', jobId: 'job_3', dropId: 'drp_1' });
    expect(ProjectSchema.safeParse(r.doc).success).toBe(true);
    const changes = diffEntities(before, r.doc);
    const back = structuredClone(r.doc);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(back.assets).toEqual(before.assets);
  });
  it('validation: only uploads record it; dropId exactly for phone; a folder path only for folder', () => {
    expect(refused(picture({ via: 'browser', jobId: 'job_1' }, 'fixture'))).toMatch(/^invalid_result: .*only an uploaded file records how it was uploaded/);
    expect(refused(picture({ via: 'phone', jobId: 'job_1' }))).toMatch(/a file from a phone names its drop code/);
    expect(refused(picture({ via: 'browser', jobId: 'job_1', dropId: 'drp_1' }))).toMatch(/a file from a phone names its drop code/);
    expect(refused(picture({ via: 'phone', jobId: 'job_1', dropId: 'drp_1', relativePath: 'a/b.jpg' }))).toMatch(/only a file from a dropped folder has a path inside it/);
    expect(refused(picture({ via: 'folder', jobId: 'job_1', relativePath: 'a/b.jpg' }))).toBe('accepted');
    const doc = importOf(picture({ via: 'folder', jobId: 'job_1', relativePath: 'a/b.jpg' })).doc;
    expect(validateProject(doc)).toEqual([]);
  });
});

describe('importCardState: the one mapping from a job row to a card', () => {
  const s = (status: string, stage: string | null = null) => importCardState({ status, stage });
  it('final states', () => {
    expect(s('succeeded')).toEqual({ state: 'ready', waitingFor: null, percent: null });
    expect(s('failed')).toEqual({ state: 'failed', waitingFor: null, percent: null });
    expect(s('canceled').state).toBe('canceled');
    expect(s('cancel-requested', 'converting:40').state).toBe('canceled');
  });
  it('waiting: queued (also after a restart) is its turn; running is being checked unless it waits for compute or an export', () => {
    expect(s('queued')).toEqual({ state: 'waiting', waitingFor: 'turn', percent: null });
    expect(s('queued', 'recovered-after-restart').waitingFor).toBe('turn');
    expect(s('running', 'probing').waitingFor).toBe('check');
    expect(s('running').waitingFor).toBe('check');
    expect(s('running', 'waiting-compute').waitingFor).toBe('compute');
    expect(s('running', 'waiting-export').waitingFor).toBe('export');
    expect(s('mystery').state).toBe('waiting'); // never ready, never a failure without a reason
  });
  it('converting carries the percent; the stage writer never writes 100', () => {
    expect(s('running', 'converting:42')).toEqual({ state: 'converting', waitingFor: null, percent: 42 });
    expect(s('running', convertingStage(0)).percent).toBe(0);
    expect(convertingStage(100)).toBe('converting:99');
    expect(convertingStage(-3)).toBe('converting:0');
    expect(convertingStage(41.9)).toBe('converting:41');
    expect(convertingStage(Number.NaN)).toBe('converting:0');
    expect(s('running', 'converting:100').state).toBe('waiting'); // not a stage this build writes
  });
});

describe('retry and actors', () => {
  it('only disk_full, canceled and internal_error are retryable', () => {
    expect([...IMPORT_RETRYABLE].sort()).toEqual(['canceled', 'disk_full', 'internal_error']);
    expect(IMPORT_ERROR_CODES.filter(importErrorRetryable).sort()).toEqual(['canceled', 'disk_full', 'internal_error']);
    expect(importErrorRetryable('unsupported_media')).toBe(false);
    expect(importErrorRetryable('conform_failed')).toBe(false);
  });
  it('a phone upload is its own actor, named by the drop id', () => {
    expect(phoneActor('drp_1')).toBe('phone:drp_1');
    expect(isPhoneActor('phone:drp_1')).toBe(true);
    expect(isPhoneActor('user:local')).toBe(false);
    expect(['user:local', 'agent:local', 'agent:observer', 'phone:drp_1', 'system'].map(actorKind)).toEqual(['user', 'agent', 'agent', 'phone', 'other']);
  });
});
