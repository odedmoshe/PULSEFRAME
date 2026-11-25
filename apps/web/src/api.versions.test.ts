import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.ts';

/** The server wraps these three answers (apps/server/src/craft/routes.ts; its routes.test.ts asserts the envelope keys): the client hands back the inner value. */
describe('api versions envelopes', () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (body: unknown, status = 200) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
  const version = { id: 'ver_1', name: 'לפני', sameAsCurrent: true };
  const diff = { counts: { added: 1, removed: 0, changed: 2 }, rows: [], privacy: { added: 0, removed: 0, changed: 0 } };
  it('saveVersion returns the version, not {version}', async () => { answer({ version }, 201); expect(await api.saveVersion('p1', 'לפני')).toEqual(version); });
  it('renameVersion returns the version, not {version}', async () => { answer({ version }); expect(await api.renameVersion('p1', 'ver_1', 'לפני')).toEqual(version); });
  it('versionDiff returns the diff, not {diff}', async () => { answer({ diff }); expect(await api.versionDiff('p1', 'ver_1')).toEqual(diff); });
});
