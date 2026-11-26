/**
 * «מאגר» in both server modes (ADR-0036; integration of wave 8 `sources`): the real server on port 0 against the LABELLED doubles
 * (packages/evals/src/doubles/sources). Open mode: an agent searches, imports and places over REST and over MCP with no approval
 * step; the download limit follows the upload limit IN EFFECT (none set in open mode = the setting alone, null when none; the disk
 * reserve still holds). Both modes: storing a service's key is the owner's own session (FLOOR C9c). Guarded mode: a grant in
 * propose mode, a grant limited to tracks and a grant for another project are refused; an observer cannot import.
 * Never a real service, real media or a real key.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootSources, client, makeFixtures, OV_BY, startDoubles, tmpFiles, type Doubles, type Fixtures } from '../../../../packages/evals/src/doubles/sources/harness.ts';
import type { RunningServer } from '../index.ts';

let root = '', fx: Fixtures, dbl: Doubles;
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-sources-modes-'));
  fx = makeFixtures(root);
  dbl = await startDoubles(fx);
}, 120_000);
afterAll(async () => { await dbl?.close(); fs.rmSync(root, { recursive: true, force: true }); });
const ZERO = { value: '0', timescale: 1 };

describe('open mode: an agent searches, imports and places; the download limit follows the upload limit in effect', () => {
  let s: RunningServer, ddir = '', pid = '';
  const c = client(() => s);
  beforeAll(async () => {
    ddir = path.join(root, 'open');
    s = await bootSources(ddir, dbl, { mode: 'open', modeFromEnv: true });
    pid = s.store.createProject({ name: 'open' }).doc.id;
  }, 60_000);
  afterAll(async () => { await s?.close(); });

  it('REST: search → import with place, as the agent, no approval step; the clip is on the timeline', async () => {
    const found = await c.api('agent', 'GET', '/api/v1/sources/openverse/search?q=red%20cat&kind=photo');
    expect(found.status).toBe(200);
    const row = found.body.rows.find((r: any) => r.itemId === `image:${OV_BY}`);
    const imp = await c.api('agent', 'POST', `/api/v1/projects/${pid}/sources/import`, { provider: 'openverse', itemId: row.itemId, place: { start: ZERO } });
    expect(imp.status).toBe(202);
    const j = await c.finished(imp.body.jobId);
    expect([j.status, j.actor, (j.output as any).placed !== null]).toEqual(['succeeded', 'agent:local', true]);
    const clips = s.store.wholeProject(pid).doc.sequences[s.store.wholeProject(pid).doc.mainSequenceId]!.tracks.flatMap((t) => t.clips);
    expect(clips.some((cl) => cl.type === 'media' && cl.assetId === (j.output as any).assetId)).toBe(true);
    expect(tmpFiles(ddir)).toEqual([]);
  });
  it('MCP: search_sources → import_source with place as the agent; the job commits as the agent', async () => {
    const found = c.toolJson(await c.rpc('agent', 'tools/call', { name: 'search_sources', arguments: { provider: 'openverse', q: 'blue cat', kind: 'photo' } }));
    const itemId = found.rows[0].itemId as string;
    const imp = c.toolJson(await c.rpc('agent', 'tools/call', { name: 'import_source', arguments: { projectId: pid, provider: 'openverse', itemId, place: { start: ZERO } } }));
    const j = await c.finished(imp.jobId);
    expect([j.status, j.actor, (j.output as any).placed !== null]).toEqual(['succeeded', 'agent:local', true]);
  });
  it('storing a service key stays the owner\'s own session (FLOOR C9c), in open mode too', async () => {
    const r = await c.api('agent', 'PUT', '/api/v1/sources/pixabay/credentials', { key: 'x' });
    expect([r.status, r.body.error.code]).toEqual([403, 'owner_required']);
  });
  it('no upload limit set: the download has none of its own (null) unless set; a set one holds (download_too_large); the stored job input says null', async () => {
    expect((await c.api('agent', 'GET', '/api/v1/sources/settings')).body).toEqual({ maxDownloadBytes: null, maxUploadBytes: null, effectiveMaxBytes: null });
    const big = dbl.host.put('/open-big.mp4', { bytes: fx['big.mp4'], contentType: 'video/mp4' });
    const free = await c.api('agent', 'POST', `/api/v1/projects/${pid}/sources/link`, { url: big });
    const fj = await c.finished(free.body.jobId);
    expect([fj.status, (fj.input as any).maxBytes]).toEqual(['succeeded', null]);
    expect((await c.api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: 100_000 })).body).toEqual({ maxDownloadBytes: 100_000, maxUploadBytes: null, effectiveMaxBytes: 100_000 });
    const j = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${pid}/sources/link`, { url: dbl.host.put('/open-big2.mp4', { bytes: fx['big2.mp4'], contentType: 'video/mp4' }) })).body.jobId);
    expect([j.status, (j.error as any).code, (j.error as any).details.maxBytes]).toEqual(['failed', 'download_too_large', 100_000]);
    await c.api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: null });
    expect(tmpFiles(ddir)).toEqual([]);
  });
  it('the owner\'s upload limit, when set, caps the download in open mode too', async () => {
    await s.close();
    s = await bootSources(ddir, dbl, { mode: 'open', modeFromEnv: true, maxUploadBytes: 150_000, maxUploadBytesSet: true });
    expect((await c.api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: 10 ** 9 })).body).toEqual({ maxDownloadBytes: 10 ** 9, maxUploadBytes: 150_000, effectiveMaxBytes: 150_000 });
    await c.api('agent', 'PUT', '/api/v1/sources/settings', { maxDownloadBytes: null });
  }, 60_000);
});

describe('guarded mode: imports are open to an edit credential; grant limits and propose mode refuse with a next step', () => {
  let s: RunningServer, pid = '', other = '';
  const c = client(() => s);
  const grant = async (body: Record<string, unknown>) => (await c.api('owner', 'POST', '/api/v1/grants', { name: `g${Math.random().toString(36).slice(2, 8)}`, ...body })).body.token as string;
  beforeAll(async () => {
    s = await bootSources(path.join(root, 'guarded'), dbl, { mode: 'guarded', modeFromEnv: true });
    pid = s.store.createProject({ name: 'guarded' }).doc.id;
    other = s.store.createProject({ name: 'other' }).doc.id;
  }, 60_000);
  afterAll(async () => { await s?.close(); });

  it('the agent token searches, imports and places; the download limit is the upload limit', async () => {
    const j = await c.finished((await c.api('agent', 'POST', `/api/v1/projects/${pid}/sources/import`, { provider: 'openverse', itemId: `image:${OV_BY}`, place: { start: ZERO } })).body.jobId);
    expect([j.status, (j.output as any).placed !== null]).toEqual(['succeeded', true]);
    expect((await c.api('agent', 'GET', '/api/v1/sources/settings')).body).toEqual({ maxDownloadBytes: null, maxUploadBytes: s.cfg.maxUploadBytes, effectiveMaxBytes: s.cfg.maxUploadBytes });
    expect((await c.api('agent', 'PUT', '/api/v1/sources/pixabay/credentials', { key: 'x' })).body.error.code).toBe('owner_required');
  });
  it('a grant in propose mode, one limited to tracks, one for another project and an observer are refused, each with a next step; nothing is started', async () => {
    const n = (s.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'source_fetch'").get() as { n: number }).n;
    const body = { provider: 'openverse', itemId: `image:${OV_BY}` };
    const propose = await c.api({ bearer: await grant({ mode: 'propose' }) }, 'POST', `/api/v1/projects/${pid}/sources/import`, body);
    expect(propose.status).toBe(403);
    const tracks = await c.api({ bearer: await grant({ mode: 'edit', trackIds: ['trk_x'] }) }, 'POST', `/api/v1/projects/${pid}/sources/import`, body);
    expect([tracks.status, tracks.body.error.code]).toEqual([403, 'out_of_scope']);
    expect(tracks.body.error.hint).toBeTruthy();
    const elsewhere = await c.api({ bearer: await grant({ mode: 'edit', projectIds: [other] }) }, 'POST', `/api/v1/projects/${pid}/sources/import`, body);
    expect(elsewhere.status).toBe(403);
    expect((await c.api('observer', 'POST', `/api/v1/projects/${pid}/sources/import`, body)).status).toBe(403);
    expect((s.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'source_fetch'").get() as { n: number }).n).toBe(n);
  });
  it('an edit grant for this project imports and its job carries the grant id (a restart places as that grant)', async () => {
    const r = await c.api({ bearer: await grant({ mode: 'edit', projectIds: [pid] }) }, 'POST', `/api/v1/projects/${pid}/sources/import`, { provider: 'openverse', itemId: `image:${OV_BY}`, idempotencyKey: 'g-1' });
    const j = await c.finished(r.body.jobId);
    expect(j.status).toBe('succeeded');
    expect((j.input as any).grantId).toMatch(/^grt_/);
    expect((j.input as any).idempotencyKey).toBe('g-1');
  });
});
