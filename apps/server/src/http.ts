import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { describeOps, RationalTimeSchema, summarize, timeline } from '@pulseframe/core';
import type { Auth, Principal, Scope } from './auth.ts';
import type { Capabilities } from './capabilities.ts';
import type { Config } from './config.ts';
import type { Exporter } from './export.ts';
import { ingestUpload } from './ingest.ts';
import { buildOpenApi } from './openapi.ts';
import { ApiError, type JobRow, type RevisionEvent, type Store } from './store.ts';

const TxBody = z
  .object({
    requestId: z.string().max(128).optional(),
    expectedRevision: z.number().int().nonnegative().optional().describe('Strict: reject unless this is the current revision'),
    baseRevision: z.number().int().nonnegative().optional().describe('Revision the caller last saw; the edit is rebased if nothing it depends on changed since'),
    dependsOn: z.array(z.string()).max(200).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
    label: z.string().max(200).optional(),
    ops: z.array(z.object({ op: z.string(), args: z.unknown() }).strict()).min(1).max(200),
  })
  .strict();
const NewProject = z.object({ name: z.string().min(1).max(200), width: z.number().int().min(16).max(8192).optional(), height: z.number().int().min(16).max(8192).optional(), frameRate: z.object({ num: z.number().int().positive(), den: z.number().int().positive() }).optional() }).strict();

type Env = { Variables: { principal: Principal } };
/** Public job shape, identical for REST and MCP. Snapshots and resolved graphs stay server-side. */
export const jobView = ({ input, ...j }: JobRow) => ({ ...j, revision: input.revision ?? input.projectRevision, ...(j.type === 'capability' ? { capabilityId: input.capabilityId, capabilityVersion: input.capabilityVersion, graphDigest: input.graphDigest, params: input.params } : {}) });

const RunBody = z
  .object({
    params: z.record(z.string(), z.unknown()).default({}),
    idempotencyKey: z.string().min(1).max(128).optional(),
    attach: z.object({ start: RationalTimeSchema, duration: RationalTimeSchema.optional(), trackId: z.string().optional() }).strict().optional().describe('Place the primary output on the timeline when the job finishes, if nothing it depends on changed meanwhile'),
    dependsOn: z.array(z.string()).max(100).optional().describe('Entity ids the placement depends on; a change to any of them turns the placement into a proposal'),
  })
  .strict();
const ImportBody = z.object({ id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/), title: z.string().min(1).max(120), graph: z.unknown() }).strict();

export function createApp(cfg: Config, store: Store, auth: Auth, exporter: Exporter, capabilities: Capabilities, mcp: (req: Request) => Promise<Response>) {
  const app = new Hono<Env>();
  const body = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new ApiError(400, 'invalid_request', z.prettifyError(parsed.error), { issues: parsed.error.issues });
    return parsed.data;
  };
  const need = (c: Context<Env>, scope: Scope) => { auth.require(c.var.principal, scope); return c.var.principal; };

  app.onError((e, c) => {
    if (e instanceof ApiError) return c.json(e.toJSON(), e.status as any);
    console.error(e);
    return c.json({ error: { code: 'internal_error', message: 'unexpected server error' } }, 500);
  });
  app.use('*', async (c, next) => {
    auth.checkHost(c.req.raw);
    const origin = c.req.header('origin');
    if (origin && auth.originAllowed(c.req.raw)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Vary', 'Origin');
      if (c.req.method === 'OPTIONS') {
        c.header('Access-Control-Allow-Headers', 'content-type, authorization, x-filename');
        c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        return c.body(null, 204);
      }
    }
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });

  // ----- render worker routes: single-purpose token, no user credentials -----
  const session = (token: string) => {
    const s = exporter.sessions.get(token);
    if (!s) throw new ApiError(404, 'render_session_not_found', 'unknown render session');
    return s;
  };
  const sendBlob = (c: Context, file: string, mime: string, downloadName?: string) => {
    const size = fs.statSync(file).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(c.req.header('range') ?? '');
    const headers: Record<string, string> = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
    if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName}"`;
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
      if (start > end) return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
      return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as any, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)) as any, { headers: { ...headers, 'Content-Length': String(size) } });
  };
  app.get('/api/v1/render/:token/snapshot', (c) => { const s = session(c.req.param('token')); return c.json({ doc: s.doc, revision: s.revision, frameCount: s.totalFrames }); });
  app.get('/api/v1/render/:token/assets/:assetId', (c) => {
    const a = session(c.req.param('token')).doc.assets[c.req.param('assetId')];
    if (!a) throw new ApiError(404, 'asset_not_found', 'asset not in snapshot');
    return sendBlob(c, store.blobPath(a.contentHash), a.mimeType);
  });
  app.post('/api/v1/render/:token/frames', async (c) => {
    await exporter.acceptFrames(c.req.param('token'), Number(c.req.query('first')), new Uint8Array(await c.req.arrayBuffer()));
    return c.json({ ok: true });
  });

  // ----- session + auth -----
  app.get('/api/v1/session', (c) => {
    c.header('Set-Cookie', auth.issueSession(c.req.raw));
    return c.json({ actor: 'user:local', scopes: ['observe', 'edit'] });
  });
  app.all('/mcp', (c) => mcp(c.req.raw));
  app.use('/api/v1/*', async (c, next) => {
    c.set('principal', auth.authenticate(c.req.raw));
    await next();
  });

  // ----- discovery -----
  app.get('/api/v1/ops', (c) => { need(c, 'observe'); return c.json({ ops: describeOps() }); });
  app.get('/api/v1/openapi.json', (c) => { need(c, 'observe'); return c.json(buildOpenApi()); });
  app.get('/api/v1/whoami', (c) => c.json(c.var.principal));

  // ----- projects -----
  app.get('/api/v1/projects', (c) => { need(c, 'observe'); return c.json({ projects: store.listProjects() }); });
  app.post('/api/v1/projects', async (c) => { need(c, 'edit'); const p = store.createProject(await body(c, NewProject)); return c.json({ project: p.doc, revision: p.revision }, 201); });
  app.get('/api/v1/projects/:id', (c) => {
    need(c, 'observe');
    const rev = c.req.query('revision');
    const p = rev === undefined ? store.getProject(c.req.param('id')) : store.replay(c.req.param('id'), Number(rev));
    return c.json({ project: p.doc, revision: p.revision });
  });
  app.get('/api/v1/projects/:id/summary', (c) => { need(c, 'observe'); const p = store.getProject(c.req.param('id')); return c.json({ revision: p.revision, ...summarize(p.doc) }); });
  app.get('/api/v1/projects/:id/timeline', (c) => { need(c, 'observe'); const p = store.getProject(c.req.param('id')); return c.json({ revision: p.revision, ...timeline(p.doc) }); });
  app.get('/api/v1/projects/:id/history', (c) => { need(c, 'observe'); store.getProject(c.req.param('id')); return c.json({ events: store.eventsSince(c.req.param('id'), Number(c.req.query('since') ?? 0)) }); });

  // ----- edits: one command path for UI, REST and (via store.commit) MCP -----
  const commit = (dryRun: boolean) => async (c: Context<Env>) => {
    const p = need(c, 'edit');
    const b = await body(c, TxBody);
    return c.json(store.commit({ ...b, projectId: c.req.param('id')!, actor: p.actor, dryRun }));
  };
  app.post('/api/v1/projects/:id/transactions', commit(false));
  app.post('/api/v1/projects/:id/operations', commit(false));
  app.post('/api/v1/projects/:id/operations/validate', commit(true));
  const UndoBody = z.object({ transactionId: z.string().optional() }).strict();
  for (const mode of ['undo', 'redo'] as const)
    app.post(`/api/v1/projects/:id/${mode}`, async (c) => {
      const p = need(c, 'edit');
      const parsed = UndoBody.safeParse((await c.req.json().catch(() => ({}))) ?? {});
      if (!parsed.success) throw new ApiError(400, 'invalid_request', z.prettifyError(parsed.error), { issues: parsed.error.issues });
      const b = parsed.data;
      return c.json(store.undo(c.req.param('id'), p.actor, mode, b.transactionId));
    });

  // ----- revision events (SSE), with replay of missed revisions on (re)connect -----
  app.get('/api/v1/projects/:id/events', (c) => {
    need(c, 'observe');
    const projectId = c.req.param('id');
    const current = store.getProject(projectId).revision;
    const since = Number(c.req.query('since') ?? c.req.header('last-event-id') ?? current);
    return streamSSE(c, async (stream) => {
      let last = since;
      const send = async (e: RevisionEvent) => {
        if (e.projectId !== projectId || e.revision <= last) return; // drop duplicates
        last = e.revision;
        await stream.writeSSE({ event: 'revision', id: String(e.revision), data: JSON.stringify(e) });
      };
      const pending: RevisionEvent[] = [];
      let live = false;
      const onEvent = (e: RevisionEvent) => (live ? void send(e) : pending.push(e));
      const onJob = (j: any) => j.projectId === projectId && void stream.writeSSE({ event: 'job', data: JSON.stringify({ id: j.id, type: j.type, status: j.status, stage: j.stage, output: j.output, error: j.error }) });
      store.events.on('revision', onEvent);
      store.events.on('job', onJob);
      try {
        await stream.writeSSE({ event: 'hello', data: JSON.stringify({ revision: current }) });
        for (const e of store.eventsSince(projectId, since)) await send(e);
        for (const e of pending) await send(e);
        live = true;
        await new Promise<void>((resolve) => stream.onAbort(resolve));
      } finally {
        store.events.off('revision', onEvent);
        store.events.off('job', onJob);
      }
    });
  });

  // ----- media -----
  app.post('/api/v1/projects/:id/assets', async (c) => {
    const p = need(c, 'edit');
    const projectId = c.req.param('id');
    store.getProject(projectId);
    if (!c.req.raw.body) throw new ApiError(400, 'empty_upload', 'request has no body');
    const name = decodeURIComponent(c.req.header('x-filename') ?? 'upload');
    const asset = await ingestUpload(store, c.req.raw.body, name, p.actor, cfg.maxUploadBytes);
    // The ingest job attaches its result through a normal (internal) operation.
    const r = store.commit({ projectId, actor: p.actor, label: `Import ${asset.name}`, allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
    const assetId = r.results[0]!.output!.assetId as string;
    return c.json({ assetId, revision: r.revision, deduplicated: r.results[0]!.output!.deduplicated, asset: store.getProject(projectId).doc.assets[assetId] }, 201);
  });
  app.get('/api/v1/projects/:id/assets/:assetId/content', (c) => {
    need(c, 'observe');
    const a = store.getProject(c.req.param('id')).doc.assets[c.req.param('assetId')];
    if (!a) throw new ApiError(404, 'asset_not_found', 'asset not found in this project');
    return sendBlob(c, store.blobPath(a.contentHash), a.mimeType);
  });

  // ----- senses -----
  app.get('/api/v1/projects/:id/frame', async (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const index = c.req.query('index') !== undefined ? Number(c.req.query('index')) : T.frameIndexAt(T.fromSeconds(c.req.query('seconds') ?? '0'), p.doc.settings.frameRate);
    const png = await exporter.renderStill(p.doc, p.revision, index);
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'X-PF-Revision': String(p.revision), 'X-PF-Frame-Index': String(index) });
  });

  // ----- jobs / export -----
  app.post('/api/v1/projects/:id/exports', (c) => {
    const pr = need(c, 'edit');
    const p = store.getProject(c.req.param('id'));
    const job = store.createJob(p.doc.id, 'export', pr.actor, { revision: p.revision, snapshot: p.doc });
    exporter.enqueue(job);
    return c.json({ jobId: job.id, status: job.status, revision: p.revision }, 202);
  });
  app.get('/api/v1/jobs/:jobId', (c) => { need(c, 'observe'); return c.json(jobView(store.getJob(c.req.param('jobId')))); });
  app.get('/api/v1/jobs/:jobId/output', (c) => {
    need(c, 'observe');
    const j = store.getJob(c.req.param('jobId'));
    if (j.status !== 'succeeded') throw new ApiError(409, 'job_not_finished', `job is ${j.status}`, { status: j.status });
    return sendBlob(c, path.join(store.outDir, path.basename(j.output.file)), 'video/mp4', `pulseframe-${j.id}.mp4`);
  });
  // ----- optional provider capabilities (Amendment A1). No route accepts a raw graph for execution. -----
  app.get('/api/v1/capabilities', async (c) => { need(c, 'observe'); return c.json(await capabilities.list()); });
  app.post('/api/v1/capabilities/import', async (c) => { need(c, 'edit'); const b = await body(c, ImportBody); return c.json(capabilities.importDraft(b.graph, { id: b.id, title: b.title })); });
  app.post('/api/v1/projects/:id/capabilities/:capabilityId/runs', async (c) => {
    const p = need(c, 'edit');
    const b = await body(c, RunBody);
    const job = capabilities.start({ projectId: c.req.param('id'), capabilityId: c.req.param('capabilityId'), params: b.params, idempotencyKey: b.idempotencyKey, attach: b.attach, dependsOn: b.dependsOn, actor: p.actor });
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  app.post('/api/v1/jobs/:jobId/cancel', async (c) => { const p = need(c, 'edit'); return c.json(await capabilities.cancel(c.req.param('jobId'), p.actor)); });
  app.get('/api/v1/jobs/:jobId/outputs/:index', (c) => {
    need(c, 'observe');
    const j = store.getJob(c.req.param('jobId'));
    const o = j.status === 'succeeded' ? j.output?.bundle?.[Number(c.req.param('index'))] : undefined;
    if (!o) throw new ApiError(404, 'output_not_found', 'no validated output at that index');
    return sendBlob(c, store.blobPath(o.contentHash), o.mimeType);
  });
  app.all('/api/*', () => { throw new ApiError(404, 'not_found', 'no such API route'); });

  // ----- web app (built bundle) -----
  if (fs.existsSync(cfg.webDist)) {
    const root = path.relative(process.cwd(), cfg.webDist) || '.';
    app.use('*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  } else app.get('/', (c) => c.text('PULSEFRAME server is running. Build the web app with `pnpm build`, or use `pnpm dev`.'));
  return app;
}
