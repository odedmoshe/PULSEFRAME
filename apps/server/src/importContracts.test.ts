/**
 * The server-side contracts of the phone drop and the import queue (ADR-0023) that the lead pre-pass owns: the transaction
 * kind 'background' in the store, the configuration, the header decoder, the free-disk reserve rule and who may handle an
 * import job. The door (drop.test.ts, dropNet.test.ts) and the queue (importQueue.test.ts) are W1's and W2's.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { phoneActor, type OpCall } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { DEFAULT_DROP_PORT, loadConfig } from './config.ts';
import { assertMayHandleImportJob, decodeUploadHeader, DISK_FLOOR_BYTES, diskReserveRefuses, DROP_DEFAULTS, DROP_ROUTES, dropLimitsFrom, importIdempotencyKey, importTempName, MAX_NAME_HEADER_BYTES, SMALL_FILE_BYTES } from './importContracts.ts';
import { ApiError, Store, type JobRow } from './store.ts';

const dirs: string[] = [];
const open = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-import-contract-')); dirs.push(d); return new Store(d); };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? `${e.status} ${e.code}` : `non-api:${e}`; } return 'ok'; };
const picture = (hex: string) => ({ kind: 'image' as const, name: `${hex}.jpg`, contentHash: `sha256:${hex.repeat(64)}`, byteSize: 1, container: 'jpeg', mimeType: 'image/jpeg', duration: T.ZERO, image: { width: 640, height: 480, codec: 'mjpeg', hasAlpha: false }, provenance: { origin: 'upload' as const, importedAt: '2026-11-18T10:00:00.000Z', importedBy: 'user:local', upload: { via: 'browser' as const, jobId: `job_${hex}` } } });
const importOp = (hex: string): OpCall => ({ op: 'import_asset', args: { asset: picture(hex) } });

describe("transaction kind 'background' (the import queue's commits)", () => {
  it('the same actor: Ctrl+Z undoes the edit before a background import, the file stays, and redo is still there', () => {
    const s = open();
    const pid = s.createProject({ name: 'before' }).doc.id;
    s.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'rename_project', args: { name: 'after' } }] });
    const bg = s.commit({ projectId: pid, actor: 'user:local', allowInternal: true, kind: 'background', idempotencyKey: importIdempotencyKey('job_b'), ops: [importOp('b')] });
    expect(bg).toMatchObject({ committed: true, kind: 'background' });
    const assetId = bg.results[0]!.output!.assetId as string;
    expect(s.eventsSince(pid, 1).map((e) => e.kind)).toEqual(['background']);
    const u = s.undo(pid, 'user:local', 'undo');
    expect(u.kind).toBe('undo');
    expect(s.getProject(pid).doc.name).toBe('before');
    expect(s.getProject(pid).doc.assets[assetId]).toBeDefined();
    // a second background import after the undo does not abandon the redo (only a later 'edit' does)
    s.commit({ projectId: pid, actor: 'user:local', allowInternal: true, kind: 'background', ops: [importOp('c')] });
    s.undo(pid, 'user:local', 'redo');
    expect(s.getProject(pid).doc.name).toBe('after');
    // the background import is still reversible by its transaction id
    s.undo(pid, 'user:local', 'undo', bg.transactionId!);
    expect(s.getProject(pid).doc.assets[assetId]).toBeUndefined();
    expect(s.replay(pid).doc).toEqual(s.getProject(pid).doc);
  });
  it("control: the same sequence with kind 'edit' (the synchronous route) makes Ctrl+Z remove the import", () => {
    const s = open();
    const pid = s.createProject({ name: 'before' }).doc.id;
    s.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'rename_project', args: { name: 'after' } }] });
    const r = s.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [importOp('b')] });
    s.undo(pid, 'user:local', 'undo');
    expect(s.getProject(pid).doc.assets[r.results[0]!.output!.assetId as string]).toBeUndefined();
    expect(s.getProject(pid).doc.name).toBe('after');
  });
  it("a phone import is another actor's: the owner's Ctrl+Z never reaches it (separately labelled: true before this track too)", () => {
    const s = open();
    const pid = s.createProject({ name: 'p' }).doc.id;
    s.commit({ projectId: pid, actor: phoneActor('drp_1'), allowInternal: true, kind: 'background', ops: [importOp('d')] });
    expect(code(() => s.undo(pid, 'user:local', 'undo'))).toBe('409 nothing_to_undo');
  });
});

describe('configuration', () => {
  it('defaults: port 8788, 10 minutes, 16 GiB a code, 2 GiB reserve, no admitted addresses', () => {
    const cfg = loadConfig({ PF_DATA_DIR: '/tmp/pf-x' } as NodeJS.ProcessEnv);
    expect(cfg).toMatchObject({ dropPort: DEFAULT_DROP_PORT, dropTtlMinutes: 10, dropCodeBytes: 16 * 1024 ** 3, importReserveBytes: 2 * 1024 ** 3, dropAdmitAddresses: [] });
    expect(DEFAULT_DROP_PORT).toBe(8788);
    expect(cfg.host).toBe('127.0.0.1'); // the main editor stays on loopback
  });
  it('the lifetime is kept within 1–60 minutes; admitted addresses are never read from the environment', () => {
    expect(loadConfig({ PF_DROP_TTL_MINUTES: '600' } as NodeJS.ProcessEnv).dropTtlMinutes).toBe(60);
    expect(loadConfig({ PF_DROP_TTL_MINUTES: '0' } as NodeJS.ProcessEnv).dropTtlMinutes).toBe(1);
    expect(loadConfig({ PF_DROP_PORT: '0' } as NodeJS.ProcessEnv).dropPort).toBe(0);
    for (const name of ['PF_DROP_ADMIT_ADDRESSES', 'PF_DROP_ADMIT', 'PF_DROP_ADDRESS', 'PF_DROP_ADMIT_ADDRESS'])
      expect(loadConfig({ [name]: '192.0.2.10' } as NodeJS.ProcessEnv).dropAdmitAddresses).toEqual([]);
    expect(() => loadConfig({ PF_HOST: '0.0.0.0' } as NodeJS.ProcessEnv)).toThrow(/loopback only/);
  });
  it('the limits of a code follow the configuration; capacities are stated, the route table is exact', () => {
    const l = dropLimitsFrom({ dropTtlMinutes: 3, dropCodeBytes: 1000, maxUploadBytes: 500 });
    expect(l).toMatchObject({ ttlMs: 180_000, idleMs: 180_000, maxLifeMs: 3_600_000, maxCodeBytes: 1000, maxFileBytes: 500 });
    expect(DROP_DEFAULTS).toMatchObject({ helloBurst: 6, uploadBurst: 40, otherBurst: 30, uploadsPerMinute: 600, maxBadHellos: 5, maxFiles: 200 });
    expect([...DROP_ROUTES]).toEqual(['GET /', 'POST /hello', 'POST /upload', 'POST /status', 'POST /bye']);
    expect(importTempName('job_1', 2, 'ab')).toBe('imp_job_1_2_ab');
  });
});

describe('decodeUploadHeader', () => {
  it('decodes percent-encoded UTF-8, Hebrew included; absent is null', () => {
    expect(decodeUploadHeader(encodeURIComponent('חתונה של דנה.mp4'))).toBe('חתונה של דנה.mp4');
    expect(decodeUploadHeader(encodeURIComponent('טיול/יום 1/IMG_0001.HEIC'), 'folder path')).toBe('טיול/יום 1/IMG_0001.HEIC');
    expect(decodeUploadHeader(undefined)).toBeNull();
    expect(decodeUploadHeader('')).toBeNull();
    // a 256-character Hebrew name fits
    expect(decodeUploadHeader(encodeURIComponent('א'.repeat(252) + '.mp4'))).toHaveLength(256);
  });
  it('refuses with 400 invalid_filename: malformed, too long, not encoded, NUL', () => {
    for (const raw of ['%E0%A4%A', '%ZZ', 'x'.repeat(MAX_NAME_HEADER_BYTES + 1), 'שם.mp4', 'a%00b.mp4'])
      expect(code(() => decodeUploadHeader(raw))).toBe('400 invalid_filename');
  });
});

describe('diskReserveRefuses (the free-disk reserve)', () => {
  const GiB = 1024 ** 3, MiB = 1024 ** 2, reserve = 2 * GiB;
  it('refuses only a known size that would eat into the reserve', () => {
    expect(diskReserveRefuses(10 * GiB, reserve, 1 * GiB)).toBe(false);
    expect(diskReserveRefuses(3 * GiB, reserve, 1.5 * GiB)).toBe(true);
    expect(diskReserveRefuses(3 * GiB, reserve, null)).toBe(false); // no declared size: the byte cap applies, not the reserve
    expect(diskReserveRefuses(null, reserve, 1 * GiB)).toBe(false); // free space not measurable here
  });
  it('a small file is never refused while more than 256 MiB stay free after it', () => {
    expect(diskReserveRefuses(1 * GiB, reserve, 10 * MiB)).toBe(false);
    expect(diskReserveRefuses(DISK_FLOOR_BYTES + SMALL_FILE_BYTES + 1, reserve, SMALL_FILE_BYTES)).toBe(false);
    expect(diskReserveRefuses(DISK_FLOOR_BYTES + SMALL_FILE_BYTES, reserve, SMALL_FILE_BYTES)).toBe(true);
    expect(diskReserveRefuses(1 * GiB, reserve, SMALL_FILE_BYTES + 1)).toBe(true);
  });
});

describe('assertMayHandleImportJob (cancel, retry and dismiss of an import)', () => {
  /** A labelled fake of Governance.assertMayAct: refuses agents on the paused project only. */
  const fakeGov = { assertMayAct: (p: Principal, projectId: string) => { if (p.kind === 'agent' && projectId === 'prj_paused') throw new ApiError(423, 'agent_paused', 'paused'); } };
  const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
  const agent: Principal = { actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] };
  const job = (actor: string, over: Partial<JobRow> = {}): JobRow => ({ id: 'job_1', projectId: 'prj_1', type: 'import', actor, status: 'failed', stage: null, attempt: 1, input: {}, output: null, error: null, createdAt: '', updatedAt: '', ...over });
  const may = (p: Principal, j: JobRow) => code(() => assertMayHandleImportJob(fakeGov, p, j, 'retry'));
  it('the owner may handle any import, a phone one included', () => {
    for (const a of ['user:local', 'agent:local', 'agent:other', phoneActor('drp_1')]) expect(may(owner, job(a))).toBe('ok');
  });
  it('an agent only its own; a phone file is the owner alone; a paused agent none', () => {
    expect(may(agent, job('agent:local'))).toBe('ok');
    expect(may(agent, job('user:local'))).toBe('403 not_your_job');
    expect(may(agent, job(phoneActor('drp_1')))).toBe('403 owner_required');
    expect(may(agent, job('agent:local', { projectId: 'prj_paused' }))).toBe('423 agent_paused');
  });
  it('a job of another type is not an import', () => {
    expect(may(owner, job('user:local', { type: 'export' }))).toBe('409 not_an_import');
  });
});
