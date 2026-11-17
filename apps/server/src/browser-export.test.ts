import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { Principal } from './auth.ts';
import { registerBrowserExportRoutes, type BrowserExport } from './browser-export.ts';
import { Exporter } from './export.ts';
import { ApiError, Store } from './store.ts';

const dirs: string[] = [];
const stops: (() => void)[] = [];
afterEach(() => { for (const s of stops.splice(0)) s(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bx-')); dirs.push(d); return d; };
const R = { num: 30, den: 1 };

function setup(fontFamily = 'Heebo') {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'web/assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'web/assets/heebo-latin-400.woff2'), 'x');
  const store = new Store(path.join(dir, 'data'));
  const exporter = new Exporter(store, {} as any, () => '', path.join(dir, 'web'));
  const { doc } = store.createProject({ name: 'p' });
  const c = store.commit({ projectId: doc.id, actor: 'user:a', ops: [{ op: 'add_text', args: { text: 'hi', start: T.frameTime(0, R), duration: T.rt(1, 1) } }] });
  if (fontFamily !== 'Heebo') store.commit({ projectId: doc.id, actor: 'user:a', ops: [{ op: 'update_text', args: { clipId: c.results[0]!.output!.clipId as string, style: { fontFamily } } }] });
  let now = 1_000_000;
  const app = new Hono<any>();
  app.onError((e, ctx) => (e instanceof ApiError ? ctx.json(e.toJSON(), e.status as any) : ctx.json({ error: { code: 'internal', message: String(e) } }, 500)));
  // Stand-in for the app's /api/v1/* auth middleware: the actor comes from a header only in this test.
  app.use('*', async (ctx, next) => {
    const actor = ctx.req.header('x-actor');
    if (actor) ctx.set('principal', { actor, kind: 'user', scopes: actor === 'observer' ? ['observe'] : ['observe', 'edit'] } satisfies Principal);
    await next();
  });
  const be: BrowserExport = registerBrowserExportRoutes(app, store, exporter, { now: () => now, sweepIntervalMs: 0 });
  stops.push(be.stop, () => store.close());
  const call = async (p: string, body: unknown, actor = 'user:a') => {
    const r = await app.request(`/api/v1${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': actor }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const start = (sessionId = 'session-aaaa', opts: Record<string, unknown> = {}, actor = 'user:a') => call(`/projects/${doc.id}/exports/browser`, { sessionId, ...opts }, actor);
  const complete = (jobId: string, frames: number, sessionId = 'session-aaaa', actor = 'user:a') =>
    call(`/jobs/${jobId}/complete`, { sessionId, bytes: 1234, sha256: 'a'.repeat(64), videoCodec: 'avc', audioCodec: 'opus', frames, container: 'mp4' }, actor);
  return { store, doc, be, app, call, start, complete, advance: (ms: number) => { now += ms; }, clock: () => now };
}

describe('browser export lease', () => {
  it('happy path: leased job over an immutable snapshot, heartbeats extend, complete records the client-side output', async () => {
    const t = setup();
    const s = await t.start();
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ leaseSeconds: 15, heartbeatSeconds: 5, revision: 1 });
    expect(s.body.manifest.output.frames).toBe(30);
    const job = t.store.getJob(s.body.jobId);
    expect(job).toMatchObject({ status: 'running', stage: 'leased' });
    expect(job.input).toMatchObject({ route: 'browser', lease: { sessionId: 'session-aaaa' } });

    // The snapshot does not move when the project is edited afterwards.
    t.store.commit({ projectId: t.doc.id, actor: 'user:a', ops: [{ op: 'add_text', args: { text: 'later', start: T.frameTime(30, R), duration: T.rt(1, 1) } }] });
    expect(t.store.getJob(s.body.jobId).input.snapshot).toEqual(s.body.snapshot);

    for (let i = 1; i <= 3; i++) {
      t.advance(5000);
      const hb = await t.call(`/jobs/${s.body.jobId}/heartbeat`, { sessionId: 'session-aaaa', framesDone: i * 5 });
      expect(hb).toMatchObject({ status: 200, body: { ok: true, canceled: false } });
    }
    expect(t.store.getJob(s.body.jobId).stage).toBe('rendering 15/30 (browser)');
    t.advance(14_000); // still inside the 15 s lease that the last heartbeat extended
    expect(t.be.sweepLeases()).toEqual([]);
    const done = await t.complete(s.body.jobId, 30);
    expect(done).toMatchObject({ status: 200, body: { ok: true, status: 'succeeded' } });
    const out = t.store.getJob(s.body.jobId).output;
    expect(out).toMatchObject({ route: 'browser', location: 'client-download', bytes: 1234, sha256: 'a'.repeat(64), videoCodec: 'avc', audioCodec: 'opus', frames: 30, container: 'mp4' });
    expect(out.manifest.output.frames).toBe(30);
  });

  it('the tab\'s photosensitivity check is recorded with the server\'s method text; a report that disagrees with the export is refused', async () => {
    const t = setup();
    const body = (jobId: string, photosensitivity: unknown) => ({ sessionId: 'session-aaaa', bytes: 10, sha256: 'a'.repeat(64), videoCodec: 'avc', audioCodec: 'opus', frames: 30, container: 'mp4', photosensitivity });
    const s1 = (await t.start()).body;
    const wrongFrames = await t.call(`/jobs/${s1.jobId}/complete`, body(s1.jobId, { verdict: 'pass', frames: 29, ranges: [] }));
    expect(wrongFrames).toMatchObject({ status: 422, body: { error: { code: 'invalid_photosensitivity' } } });
    const failWithoutRanges = await t.call(`/jobs/${s1.jobId}/complete`, body(s1.jobId, { verdict: 'fail', frames: 30, ranges: [] }));
    expect(failWithoutRanges.body.error.code).toBe('invalid_photosensitivity');
    const extraKey = await t.call(`/jobs/${s1.jobId}/complete`, body(s1.jobId, { verdict: 'pass', frames: 30, ranges: [], method: 'mine' }));
    expect(extraKey.status).toBe(400); // the method text is the server's, never the tab's
    const range = { from: T.frameTime(3, R), to: T.frameTime(20, R), kind: 'general', flashesPerSecond: 5, area: 0.5 };
    const ok = await t.call(`/jobs/${s1.jobId}/complete`, body(s1.jobId, { verdict: 'fail', frames: 30, ranges: [range] }));
    expect(ok.status).toBe(200);
    const out = t.store.getJob(s1.jobId).output;
    expect(out.photosensitivity).toMatchObject({ measuredBy: 'browser', verdict: 'fail', frames: 30, ranges: [range] });
    expect(out.photosensitivity.method).toMatch(/WCAG 2\.3\.1/);
  });

  it('only the owning session AND actor may heartbeat, complete or abandon', async () => {
    const t = setup();
    const { body } = await t.start();
    const hb = (sessionId: string, actor: string) => t.call(`/jobs/${body.jobId}/heartbeat`, { sessionId, framesDone: 1 }, actor);
    expect((await hb('session-bbbb', 'user:a')).body.error.code).toBe('lease_not_owned');
    expect((await hb('session-aaaa', 'agent:local')).body.error.code).toBe('lease_not_owned');
    expect((await t.complete(body.jobId, 30, 'session-bbbb')).status).toBe(409);
    expect((await t.complete(body.jobId, 30, 'session-aaaa', 'agent:local')).body.error.code).toBe('lease_not_owned');
    expect((await t.call(`/jobs/${body.jobId}/abandon`, { sessionId: 'session-bbbb' })).body.error.code).toBe('lease_not_owned');
    expect(t.store.getJob(body.jobId).status).toBe('running');
    expect((await hb('session-aaaa', 'user:a')).status).toBe(200);
  });

  it('expiry: the job fails with a retryable lease_lost; later heartbeat/complete are refused and a new job can start', async () => {
    const t = setup();
    const { body } = await t.start();
    t.advance(14_999);
    expect(t.be.sweepLeases()).toEqual([]);
    t.advance(1);
    expect(t.be.sweepLeases()).toEqual([body.jobId]);
    const j = t.store.getJob(body.jobId);
    expect(j.status).toBe('failed');
    expect(j.error).toMatchObject({ code: 'lease_lost', retryable: true });
    const hb = await t.call(`/jobs/${body.jobId}/heartbeat`, { sessionId: 'session-aaaa', framesDone: 3 });
    expect(hb).toMatchObject({ status: 409, body: { error: { code: 'lease_lost' } } });
    expect((await t.complete(body.jobId, 30)).body.error.code).toBe('lease_lost');
    expect(t.store.getJob(body.jobId).output).toBeNull();
    const again = await t.start('session-cccc');
    expect(again.status).toBe(201);
    expect(again.body.jobId).not.toBe(body.jobId);
  });

  it('expiry is also detected by a route hit, without the timer', async () => {
    const t = setup();
    const { body } = await t.start();
    t.advance(20_000);
    const hb = await t.call(`/jobs/${body.jobId}/heartbeat`, { sessionId: 'session-aaaa', framesDone: 1 });
    expect(hb.body.error.code).toBe('lease_lost');
    expect(t.store.getJob(body.jobId).status).toBe('failed');
  });

  it('a second complete is refused: no duplicate final output', async () => {
    const t = setup();
    const { body } = await t.start();
    expect((await t.complete(body.jobId, 30)).status).toBe(200);
    const second = await t.complete(body.jobId, 30);
    expect(second).toMatchObject({ status: 409, body: { error: { code: 'already_completed' } } });
    expect((await t.call(`/jobs/${body.jobId}/heartbeat`, { sessionId: 'session-aaaa', framesDone: 30 })).body.error.code).toBe('already_completed');
    expect(t.store.getJob(body.jobId).status).toBe('succeeded');
  });

  it('a frame count that differs from the manifest is refused and the lease stays alive', async () => {
    const t = setup();
    const { body } = await t.start();
    const r = await t.complete(body.jobId, 29);
    expect(r).toMatchObject({ status: 422, body: { error: { code: 'frames_mismatch', details: { expected: 30, got: 29 } } } });
    expect(t.store.getJob(body.jobId).status).toBe('running');
    expect((await t.complete(body.jobId, 30)).status).toBe(200);
  });

  it('cancel: heartbeat reports canceled, abandon acknowledges, and the job ends canceled', async () => {
    const t = setup();
    const { body } = await t.start();
    expect(t.be.requestCancel(body.jobId)).toMatchObject({ status: 'cancel-requested', outcome: 'stopping' });
    expect(t.store.getJob(body.jobId).status).toBe('cancel-requested');
    t.advance(5000);
    expect((await t.call(`/jobs/${body.jobId}/heartbeat`, { sessionId: 'session-aaaa', framesDone: 4 })).body).toEqual({ ok: true, canceled: true });
    expect((await t.complete(body.jobId, 30)).body.error.code).toBe('job_canceled');
    expect((await t.call(`/jobs/${body.jobId}/abandon`, { sessionId: 'session-aaaa' })).body).toMatchObject({ ok: true, status: 'canceled' });
    expect(t.store.getJob(body.jobId)).toMatchObject({ status: 'canceled', error: { code: 'canceled' } });
    expect(t.be.requestCancel(body.jobId).outcome).toBe('already-finished');
  });

  it('cancel without acknowledgement: the job becomes canceled (not failed) when the lease expires', async () => {
    const t = setup();
    const { body } = await t.start();
    t.be.requestCancel(body.jobId);
    t.advance(16_000);
    t.be.sweepLeases();
    expect(t.store.getJob(body.jobId).status).toBe('canceled');
  });

  it('a cancel right after the start, before any heartbeat, cannot hold anything up: the job ends at lease expiry at the latest and a new export of the same project starts meanwhile', async () => {
    const t = setup();
    const first = await t.start('session-aaaa');
    expect(t.be.requestCancel(first.body.jobId).status).toBe('cancel-requested');
    // the tab never answers; another tab starts an export of the same project straight away (there is no queue on this route)
    const second = await t.start('session-bbbb');
    expect(second.status).toBe(201);
    expect((await t.call(`/jobs/${second.body.jobId}/heartbeat`, { sessionId: 'session-bbbb', framesDone: 1 })).body).toEqual({ ok: true, canceled: false });
    t.advance(15_001);
    expect(t.be.sweepLeases()).toContain(first.body.jobId);
    expect(t.store.getJob(first.body.jobId).status).toBe('canceled');
  });

  it('blockers refuse creation: no job row exists afterwards', async () => {
    const t = setup('Not Installed Sans');
    const r = await t.start();
    expect(r).toMatchObject({ status: 422, body: { error: { code: 'render_blocked', details: { blockers: [{ code: 'missing_font' }] } } } });
    expect(t.store.openJobs('export')).toHaveLength(0);
    const t2 = setup();
    expect((await t2.start('session-aaaa', { range: { startFrame: 500, endFrame: 600 } })).body.error.code).toBe('render_blocked');
    expect(t2.store.openJobs('export')).toHaveLength(0);
  });

  it('requires edit scope and a session id; other formats are refused', async () => {
    const t = setup();
    expect((await t.start('session-aaaa', {}, 'observer')).status).toBe(403);
    expect((await t.call(`/projects/${t.doc.id}/exports/browser`, {})).status).toBe(400);
    expect((await t.start('session-aaaa', { format: 'wav' })).body.error.code).toBe('browser_route_unsupported_format');
    expect(t.store.openJobs('export')).toHaveLength(0);
  });

  it('a browser job left over from a previous process is failed at registration instead of being re-run by the server', async () => {
    const t = setup();
    const { body } = await t.start();
    const app2 = new Hono<any>();
    const exporter2 = new Exporter(t.store, {} as any, () => '', '/nonexistent');
    const be2 = registerBrowserExportRoutes(app2, t.store, exporter2, { sweepIntervalMs: 0 });
    stops.push(be2.stop);
    expect(t.store.getJob(body.jobId)).toMatchObject({ status: 'failed', error: { code: 'lease_lost' } });
  });
});
