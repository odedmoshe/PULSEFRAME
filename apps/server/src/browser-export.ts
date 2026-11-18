/**
 * Browser-side export route with an explicit tab lease (SPEC §9).
 *
 * A browser job is a normal durable `export` job row with `input.route = 'browser'`. The tab that runs it
 * holds a lease that it must renew with heartbeats; a tab that disappears cannot keep a job alive:
 * once the lease expires the job becomes `failed` / `lease_lost` (retryable from a NEW job on the current or
 * an old snapshot). Ownership is (sessionId AND authenticated actor), both fixed at creation. The finished media
 * bytes stay in the browser (`location: 'client-download'`); the server records size, SHA-256 and codecs.
 *
 * Lease expiry times live in memory by design: after a server restart every unfinished browser job is
 * orphaned (the tab cannot be trusted to still exist) and is failed with `lease_lost` at registration time.
 *
 * Mounting: call `registerBrowserExportRoutes(app, store, exporter)` AFTER the `/api/v1/*` authentication
 * middleware and BEFORE the `app.all('/api/*')` catch-all in http.ts (Hono matches in registration order).
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { RationalTimeSchema } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Exporter, Manifest } from './export.ts';
import { PHOTOSENSITIVITY_METHOD } from './flashCheck.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import { assertMayTakeRendered } from './peoplePrivacy.ts';

export const LEASE_SECONDS = 15;
export const HEARTBEAT_SECONDS = 5;
const BROWSER_FORMATS = ['mp4-h264-aac', 'webm-vp9-opus'];
const TERMINAL = ['succeeded', 'failed', 'canceled'];

const SessionId = z.string().min(8).max(128);
const HeartbeatBody = z.object({ sessionId: SessionId, framesDone: z.number().int().nonnegative() }).strict();
const CompleteBody = z
  .object({
    sessionId: SessionId,
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    videoCodec: z.string().min(1).max(32),
    audioCodec: z.string().min(1).max(32),
    frames: z.number().int().nonnegative(),
    container: z.string().min(1).max(32),
    /** The tab's photosensitivity check of the frames it encoded (ADR-0009 decision 4); optional for older tabs. */
    photosensitivity: z.object({
      verdict: z.enum(['pass', 'fail']),
      frames: z.number().int().nonnegative(),
      ranges: z.array(z.object({ from: RationalTimeSchema, to: RationalTimeSchema, kind: z.enum(['general', 'red']), flashesPerSecond: z.number().int().nonnegative().max(1000), area: z.number().min(0).max(1) }).strict()).max(10_000),
    }).strict().optional(),
  })
  .strict();
const AbandonBody = z.object({ sessionId: SessionId }).strict();

export interface BrowserExportOptions {
  /** Injected clock for tests (milliseconds since epoch). */
  now?: () => number;
  leaseSeconds?: number;
  heartbeatSeconds?: number;
  /** Sweep period; 0 disables the timer (tests call `sweepLeases` directly). */
  sweepIntervalMs?: number;
}
interface Lease { expiresAt: number; cancelRequested: boolean; framesDone: number }

export interface BrowserExport {
  /** Fail (or cancel) every job whose lease passed `expiresAt` without completion. Returns the affected job ids. */
  sweepLeases(now?: number): string[];
  /** Ask the owning tab to stop: its next heartbeat answers `canceled: true`. Use for jobs with `input.route === 'browser'`. */
  requestCancel(jobId: string): { jobId: string; status: string; outcome: string };
  /** True for jobs this module owns. */
  isBrowserJob(job: JobRow): boolean;
  stop(): void;
}

export function registerBrowserExportRoutes(app: Hono<any>, store: Store, exporter: Exporter, opts: BrowserExportOptions = {}): BrowserExport {
  const clock = opts.now ?? Date.now;
  const leaseMs = (opts.leaseSeconds ?? LEASE_SECONDS) * 1000;
  const heartbeatSeconds = opts.heartbeatSeconds ?? HEARTBEAT_SECONDS;
  const leases = new Map<string, Lease>();
  const isBrowserJob = (j: JobRow) => j.type === 'export' && j.input?.route === 'browser';

  const principal = (c: any, ...scopes: ('observe' | 'edit')[]): Principal => {
    const p = c.get('principal') as Principal | undefined;
    if (!p) throw new ApiError(401, 'unauthenticated', 'authentication required');
    for (const s of scopes) if (!p.scopes.includes(s)) throw new ApiError(403, 'insufficient_scope', `this credential lacks the "${s}" scope`, { required: s, granted: p.scopes });
    return p;
  };
  const parse = async <S extends z.ZodType>(c: any, schema: S): Promise<z.infer<S>> => {
    const r = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!r.success) throw new ApiError(400, 'invalid_request', z.prettifyError(r.error), { issues: r.error.issues });
    return r.data;
  };

  const expire = (job: JobRow) => {
    const lease = leases.get(job.id);
    leases.delete(job.id);
    if (lease?.cancelRequested || job.status === 'cancel-requested')
      store.updateJob(job.id, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'export was canceled; the browser tab did not acknowledge before its lease expired', retryable: true } });
    else
      store.updateJob(job.id, { status: 'failed', stage: null, error: { code: 'lease_lost', message: `the browser tab stopped sending heartbeats (lease of ${leaseMs / 1000}s expired); nothing was published. Start a new export; it restarts from a fresh snapshot.`, retryable: true } });
  };

  const sweepLeases = (now = clock()): string[] => {
    const done: string[] = [];
    for (const [jobId, lease] of [...leases]) {
      if (now < lease.expiresAt) continue;
      let job: JobRow;
      try { job = store.getJob(jobId); } catch { leases.delete(jobId); continue; }
      if (TERMINAL.includes(job.status)) { leases.delete(jobId); continue; }
      expire(job);
      done.push(jobId);
    }
    return done;
  };

  // Orphans from a previous process: running browser jobs with no live lease. Runs before the server's own
  // restart recovery, so they are failed here instead of being re-run by the server route behind the user's back.
  for (const j of store.openJobs('export')) {
    if (isBrowserJob(j) && !leases.has(j.id)) store.updateJob(j.id, { status: 'failed', stage: null, error: { code: 'lease_lost', message: 'the server restarted while the browser tab held the lease; start a new export', retryable: true } });
  }

  /** Common checks for heartbeat/complete/abandon: job exists, is a browser job, caller owns it. */
  const owned = (c: any, sessionId: string): { job: JobRow; p: Principal } => {
    const p = principal(c, 'edit');
    sweepLeases();
    const job = store.getJob(c.req.param('jobId'));
    if (!isBrowserJob(job)) throw new ApiError(409, 'not_a_browser_job', 'this job does not use the browser route');
    if (job.input.lease?.sessionId !== sessionId || job.actor !== p.actor) throw new ApiError(409, 'lease_not_owned', 'this job is leased to another session or actor');
    return { job, p };
  };
  const requireLive = (job: JobRow) => {
    if (job.status === 'succeeded') throw new ApiError(409, 'already_completed', 'this job already completed; its output is not duplicated');
    if (job.status === 'failed') throw new ApiError(409, 'lease_lost', 'the lease expired; start a new export', { retryable: true, jobError: job.error });
    if (job.status === 'canceled') throw new ApiError(409, 'job_canceled', 'this job was canceled');
    const lease = leases.get(job.id);
    if (!lease) throw new ApiError(409, 'lease_lost', 'no live lease for this job; start a new export', { retryable: true });
    return lease;
  };

  app.post('/api/v1/projects/:id/exports/browser', async (c) => {
    const p = principal(c, 'edit');
    sweepLeases();
    const { sessionId, ...rawOptions } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const sid = SessionId.safeParse(sessionId);
    if (!sid.success) throw new ApiError(400, 'invalid_request', 'sessionId (string, 8..128 chars) is required');
    const projectId = c.req.param('id')!;
    // The answer carries the document the tab renders the film from. A credential without the people scope is handed it
    // without birth dates (the store answers so), and is refused altogether when a title shows an age: the film would silently
    // lack it (ADR-0021, people section; peoplePrivacy.ts rule 2b).
    assertMayTakeRendered(p, store.wholeProject(projectId).doc, 'export this project');
    const { doc, revision } = store.getProject(projectId);
    const { manifest, blockers, warnings } = exporter.plan(doc, revision, rawOptions);
    // Loudness normalisation needs the R128 measurement pass, which only the server route has. Refuse rather than export at a different level.
    if (doc.settings.loudness) throw new ApiError(409, 'unsupported_in_browser_export', 'this project has a loudness target; the browser export route cannot measure and normalise loudness', { loudness: doc.settings.loudness }, 'Use the server export, or clear the loudness target.');
    if (blockers.length) throw new ApiError(422, 'render_blocked', `export cannot start: ${blockers[0]!.message}`, { blockers, warnings }, 'Fix the listed blockers (relink media, change the font or the range) and try again.');
    if (!BROWSER_FORMATS.includes(manifest.options.format)) throw new ApiError(422, 'browser_route_unsupported_format', `the browser route exports ${BROWSER_FORMATS.join(' or ')}, not ${manifest.options.format}`, { supported: BROWSER_FORMATS });
    const expiresAt = clock() + leaseMs;
    const job = store.createJob(projectId, 'export', p.actor, { revision, snapshot: doc, manifest, warnings, retryOf: null, route: 'browser', lease: { sessionId: sid.data, expiresAt } });
    store.updateJob(job.id, { status: 'running', stage: 'leased' });
    leases.set(job.id, { expiresAt, cancelRequested: false, framesDone: 0 });
    return c.json({ jobId: job.id, revision, snapshot: doc, manifest, warnings, leaseSeconds: leaseMs / 1000, heartbeatSeconds }, 201);
  });

  app.post('/api/v1/jobs/:jobId/heartbeat', async (c) => {
    const b = await parse(c, HeartbeatBody);
    const { job } = owned(c, b.sessionId);
    if (job.status === 'canceled') return c.json({ ok: true, canceled: true });
    const lease = requireLive(job);
    const manifest: Manifest = job.input.manifest;
    if (b.framesDone > manifest.output.frames) throw new ApiError(400, 'invalid_request', `framesDone ${b.framesDone} exceeds the job's ${manifest.output.frames} frames`);
    lease.expiresAt = clock() + leaseMs;
    lease.framesDone = b.framesDone;
    const canceled = lease.cancelRequested || job.status === 'cancel-requested';
    if (!canceled) store.updateJob(job.id, { stage: `rendering ${b.framesDone}/${manifest.output.frames} (browser)` });
    return c.json({ ok: true, canceled });
  });

  app.post('/api/v1/jobs/:jobId/complete', async (c) => {
    const b = await parse(c, CompleteBody);
    const { job } = owned(c, b.sessionId);
    requireLive(job);
    if (job.status === 'cancel-requested') throw new ApiError(409, 'job_canceled', 'a cancel was requested for this job; acknowledge it with /abandon');
    const manifest: Manifest = job.input.manifest;
    if (b.frames !== manifest.output.frames) throw new ApiError(422, 'frames_mismatch', `the tab reports ${b.frames} frames but the snapshot has ${manifest.output.frames}`, { expected: manifest.output.frames, got: b.frames });
    const ps = b.photosensitivity;
    if (ps && (ps.frames !== b.frames || (ps.verdict === 'fail') !== ps.ranges.length > 0)) throw new ApiError(422, 'invalid_photosensitivity', 'the photosensitivity report does not match the export (frames, or verdict and ranges, disagree)', { frames: ps.frames, expected: b.frames, verdict: ps.verdict, ranges: ps.ranges.length });
    leases.delete(job.id);
    const { width, height, firstFrame, frames, frameRate, sampleRate } = manifest.output;
    store.updateJob(job.id, {
      status: 'succeeded', stage: null,
      output: {
        route: 'browser', location: 'client-download', note: 'the media bytes were produced and stay in the browser tab that held the lease; the server stores only this record',
        bytes: b.bytes, sha256: b.sha256, videoCodec: b.videoCodec, audioCodec: b.audioCodec, frames: b.frames, container: b.container,
        mimeType: b.container === 'webm' ? 'video/webm' : 'video/mp4', revision: job.input.revision, options: manifest.options,
        // measured by the tab on the frames it encoded, with the same analyser as the server export; the method text is the server's
        ...(ps ? { photosensitivity: { method: PHOTOSENSITIVITY_METHOD, measuredBy: 'browser', ...ps } } : {}),
        manifest: { engine: manifest.engine, assets: manifest.assets, fonts: manifest.fonts, output: { width, height, firstFrame, frames, frameRate, sampleRate } },
      },
    });
    return c.json({ ok: true, jobId: job.id, status: 'succeeded' });
  });

  app.post('/api/v1/jobs/:jobId/abandon', async (c) => {
    const b = await parse(c, AbandonBody);
    const { job } = owned(c, b.sessionId);
    if (job.status === 'succeeded') throw new ApiError(409, 'already_completed', 'this job already completed');
    if (TERMINAL.includes(job.status)) return c.json({ ok: true, status: job.status });
    const lease = leases.get(job.id);
    const requested = lease?.cancelRequested || job.status === 'cancel-requested';
    leases.delete(job.id);
    store.updateJob(job.id, { status: 'canceled', stage: null, error: { code: requested ? 'canceled' : 'abandoned_by_client', message: requested ? 'export was canceled; the tab stopped and discarded its partial output' : 'the tab abandoned the export and discarded its partial output', retryable: true } });
    return c.json({ ok: true, status: 'canceled' });
  });

  const requestCancel: BrowserExport['requestCancel'] = (jobId) => {
    sweepLeases();
    const job = store.getJob(jobId);
    if (!isBrowserJob(job)) throw new ApiError(409, 'not_a_browser_job', 'this job does not use the browser route');
    if (TERMINAL.includes(job.status)) return { jobId, status: job.status, outcome: 'already-finished' };
    const lease = leases.get(jobId);
    if (!lease) { // nobody holds it: nothing to wait for
      store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; no tab held the lease', retryable: true } });
      return { jobId, status: 'canceled', outcome: 'no-live-lease' };
    }
    lease.cancelRequested = true;
    store.updateJob(jobId, { status: 'cancel-requested' });
    return { jobId, status: 'cancel-requested', outcome: 'stopping' };
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  const every = opts.sweepIntervalMs ?? 1000;
  if (every > 0) { timer = setInterval(() => { try { sweepLeases(); } catch (e) { console.error('lease sweep failed', e); } }, every); timer.unref(); }
  return { sweepLeases, requestCancel, isBrowserJob, stop: () => { if (timer) clearInterval(timer); timer = null; } };
}
