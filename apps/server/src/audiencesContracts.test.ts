/**
 * Lead contracts of «גרסה לכל קהל» on the server (wave 8 audiences): the change-list route answers 404 for an unknown format, 409
 * not_audience_version for a plain format, and an honest 501 audience_not_built until W1 and W2 have built it. W2 owns this file
 * after the pre-pass and adds the REST and MCP rows of the built view (proof checks 1–5, 9, 14–17).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIENCE_API_REFUSALS, AUDIENCE_PROJECTION_BUILT } from '@pulseframe/core';
import { audienceChangesFor } from './audiences/routes.ts';
import { ApiError, Store } from './store.ts';

let dir: string, store: Store;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-audiences-')); store = new Store(dir); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const caught = (fn: () => unknown): ApiError => { try { fn(); } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error('answered'); };

describe('the change-list route (stub)', () => {
  it('404 for an unknown or inherited format id, 409 for a plain format, 501 audience_not_built for a version while not built', () => {
    const pid = store.createProject({ name: 'aud' }).doc.id;
    expect(caught(() => audienceChangesFor(store, pid, 'var_none')).status).toBe(404);
    expect(caught(() => audienceChangesFor(store, pid, 'constructor')).status).toBe(404);
    const vid = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_variant', args: { profileId: 'square-1x1' } }] }).results[0]!.output!.variantId as string;
    const e = caught(() => audienceChangesFor(store, pid, vid));
    expect([e.status, e.code, e.message]).toEqual([409, AUDIENCE_API_REFUSALS.notAudience.code, AUDIENCE_API_REFUSALS.notAudience.message(vid)]);
    if (!AUDIENCE_PROJECTION_BUILT) {
      // no version can be made while not built (the op refuses notBuilt); a stored one (a later build's archive) still gets the honest 501
      const doc = structuredClone(store.getProject(pid).doc);
      doc.variants[vid] = { ...doc.variants[vid]!, audience: { profile: 'calm', rules: 1 } };
      const fake = { getProject: () => ({ doc, revision: 1 }) } as unknown as Store;
      const n = caught(() => audienceChangesFor(fake, pid, vid));
      expect([n.status, n.code, n.hint]).toEqual([501, 'audience_not_built', AUDIENCE_API_REFUSALS.notBuilt.hint]);
    }
  });
  it.todo('W2: GET …/variants/:variantId/audience and MCP get_audience_changes answer the same AudienceChanges for the owner and for an agent with observe');
  it.todo('W2: the get_summary variants row carries audience { profile } and the override count excludes keep-only overrides (C14)');
});
