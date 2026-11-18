/**
 * Wording of the phone drop and the import queue (ADR-0023): every error code the import and drop routes answer with, and every
 * way an import job can fail, has a headline in Hebrew and in English that say different things; a phone upload has a name in
 * the activity list. The codes come from core (importView.ts) and the server (importContracts.ts), so a code added there
 * without words fails here.
 */
import { describe, expect, it } from 'vitest';
import { actorKind, IMPORT_API_ERROR_CODES, IMPORT_ERROR_CODES, phoneActor } from '@pulseframe/core';
import { en, he } from '../../i18n/src/index.ts';
import { assertMayHandleImportJob, decodeUploadHeader } from '../../../apps/server/src/importContracts.ts';
import { ApiError, type JobRow } from '../../../apps/server/src/store.ts';

const dicts = { he: he as Record<string, string>, en: en as Record<string, string> };
const codeOf = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof ApiError) return e.code; throw e; } return 'ok'; };

describe('phone drop wording', () => {
  it('every new route code and every import failure has a headline in both languages, and they differ', () => {
    const missing: string[] = [];
    for (const code of new Set<string>([...IMPORT_API_ERROR_CODES, ...IMPORT_ERROR_CODES]))
      for (const [lang, d] of Object.entries(dicts)) if (!d[`error.code.${code}`]?.trim()) missing.push(`${lang} error.code.${code}`);
    expect(missing).toEqual([]);
    for (const code of IMPORT_API_ERROR_CODES) {
      expect(dicts.he[`error.code.${code}`]).toMatch(/[֐-׿]/);
      expect(dicts.he[`error.code.${code}`]).not.toBe(dicts.en[`error.code.${code}`]);
    }
  });
  it('the refusals the contracts raise today carry codes that have words', () => {
    const job = { id: 'job_1', projectId: 'p', type: 'export', actor: phoneActor('drp_1'), status: 'failed', stage: null, attempt: 1, input: {}, output: null, error: null, createdAt: '', updatedAt: '' } as JobRow;
    const gov = { assertMayAct: () => undefined }; // labelled fake: allows everything
    const agent = { actor: 'agent:local', kind: 'agent' as const, scopes: ['observe' as const, 'edit' as const] };
    const raised = [
      codeOf(() => decodeUploadHeader('%ZZ')),
      codeOf(() => assertMayHandleImportJob(gov, agent, job, 'retry')),
      codeOf(() => assertMayHandleImportJob(gov, agent, { ...job, type: 'import' }, 'dismiss')),
      codeOf(() => assertMayHandleImportJob(gov, agent, { ...job, type: 'import', actor: 'user:local' }, 'cancel')),
    ];
    expect(raised).toEqual(['invalid_filename', 'not_an_import', 'owner_required', 'not_your_job']);
    for (const code of raised) for (const d of Object.values(dicts)) expect(d[`error.code.${code}`]?.trim(), code).toBeTruthy();
  });
  it('a phone upload is named in the activity list', () => {
    expect(actorKind(phoneActor('drp_1'))).toBe('phone');
    expect(dicts.he['actor.phone']).toBe('העלאה מהטלפון');
    expect(dicts.en['actor.phone']).toBeTruthy();
  });
});
