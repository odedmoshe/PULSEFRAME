/**
 * The change-list route without any stand-in (wave 8 audiences, W2): the refusal order 404 → 409 → 501, and the 501 only while core's
 * AUDIENCE_PROJECTION_BUILT is false. Once W1's rules are merged the same stored version answers with the change list of its own id.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIENCE_API_REFUSALS, AUDIENCE_PROJECTION_BUILT } from '@pulseframe/core';
import { audienceChangesFor } from './routes.ts';
import { ApiError, Store } from '../store.ts';

let dir: string, store: Store;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-audiences-route-')); store = new Store(dir); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const caught = (fn: () => unknown): ApiError => { try { fn(); } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error('answered'); };

describe('audienceChangesFor (no stand-in)', () => {
  it('404, then 409, then 501 audience_not_built while not built; built, the stored version answers', () => {
    const pid = store.createProject({ name: 'aud' }).doc.id;
    expect(caught(() => audienceChangesFor(store, pid, 'var_none')).status).toBe(404);
    expect(caught(() => audienceChangesFor(store, pid, '__proto__')).status).toBe(404);
    const vid = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_variant', args: { profileId: 'square-1x1' } }] }).results[0]!.output!.variantId as string;
    expect(caught(() => audienceChangesFor(store, pid, vid)).status).toBe(409);
    // a stored version (a later build's archive, or one made once built) read through a store stand-in holding that document
    const doc = structuredClone(store.getProject(pid).doc);
    doc.variants[vid] = { ...doc.variants[vid]!, width: doc.settings.width, height: doc.settings.height, audience: { profile: 'calm', rules: 1 } };
    const fake = { getProject: () => ({ doc, revision: 7 }) } as unknown as Store;
    if (!AUDIENCE_PROJECTION_BUILT) {
      const n = caught(() => audienceChangesFor(fake, pid, vid));
      expect([n.status, n.code, n.message, n.hint]).toEqual([501, AUDIENCE_API_REFUSALS.notBuilt.code, AUDIENCE_API_REFUSALS.notBuilt.message(), AUDIENCE_API_REFUSALS.notBuilt.hint]);
    } else {
      expect(audienceChangesFor(fake, pid, vid)).toMatchObject({ variantId: vid, revision: 7, profile: 'calm' });
    }
  });
});
