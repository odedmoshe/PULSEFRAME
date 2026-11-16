import type { BackupScheduler } from './backup.ts';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { COLOR_LOOKS, TEXT_PRESETS, SPEED_CURVES, MOTION_PRESETS, CAPTION_LOOKS, LAYOUTS, findFillers, timeOriginSeconds, describeOps, projectVariant, RationalTimeSchema, serializeAss, serializeSrt, serializeVtt, describeRecipes, FORMAT_PROFILES, CAPTION_PRESETS, CLIP_MOTIONS, describeCatalog, FONT_CATALOG, cutOps, sourceRangesToTimeline, summarize, timeline, transcriptView, type Analysis, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, captionCues } from '@pulseframe/engine';
import { measureLoudness, mixToRaw, normalisationGain } from './audiomix.ts';
import type { Auth, Principal, Scope } from './auth.ts';
import { NarrationBody, NarrationScriptBody, Speech, TranscribeBody } from './speech.ts';
import type { Capabilities } from './capabilities.ts';
import type { Config } from './config.ts';
import type { DerivativeKind, Derivatives } from './derive.ts';
import type { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { ingestUpload } from './ingest.ts';
import { BEAT_MAX_SECONDS, BEAT_TOTAL_MAX_SECONDS, detectBeatsOfFile, detectScenes, detectSilences, heavy } from './analysis.ts';
import { makeSfx, SFX, sfxPreview } from './sfx.ts';
import { preflight } from './preflight.ts';
import { collectGarbage, deleteProject, assertStorageRoom, storageReport } from './storage.ts';
import { importArchive, planArchive, writeArchive } from './archive.ts';
import { pipeline } from 'node:stream/promises';
import { applyRecipe, planRecipeFor, regenerateRecipe } from './recipes.ts';
import { variantDoc } from './export.ts';
import { registerBrowserExportRoutes } from './browser-export.ts';
import { buildOpenApi } from './openapi.ts';
import type { Presence } from './presence.ts';
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
export const jobView = ({ input, ...j }: JobRow) => ({ ...j, revision: input.revision ?? input.projectRevision, ...(j.type === 'export' ? { options: input.manifest?.options, estimate: input.manifest?.estimate, warnings: input.warnings ?? [], retryOf: input.retryOf ?? null } : {}), ...(j.type === 'capability' ? { capabilityId: input.capabilityId, capabilityVersion: input.capabilityVersion, graphDigest: input.graphDigest, params: input.params } : {}) });

const RunBody = z
  .object({
    params: z.record(z.string(), z.unknown()).default({}),
    idempotencyKey: z.string().min(1).max(128).optional(),
    attach: z.object({ start: RationalTimeSchema, duration: RationalTimeSchema.optional(), trackId: z.string().optional() }).strict().optional().describe('Place the primary output on the timeline when the job finishes, if nothing it depends on changed meanwhile'),
    dependsOn: z.array(z.string()).max(100).optional().describe('Entity ids the placement depends on; a change to any of them turns the placement into a proposal'),
  })
  .strict();
const ImportBody = z.object({ id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/), title: z.string().min(1).max(120), graph: z.unknown() }).strict();

/** Content security policy of the app's pages: same-origin code only, no inline or blob: scripts, no plugins, no framing. Style attributes set from code are allowed by the browser without 'unsafe-inline'. */
export const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
/** Policy of every non-page response (JSON, media, exports): nothing may load or run if it is ever opened as a document. */
export const DATA_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

export function createApp(cfg: Config, store: Store, auth: Auth, exporter: Exporter, capabilities: Capabilities, derivatives: Derivatives, presence: Presence, mcp: (req: Request) => Promise<Response>, governance?: Governance, backup?: BackupScheduler, speechService?: Speech) {
  const gov = governance ?? new Governance(store);
  const speech = speechService ?? new Speech(store, cfg);
  const app = new Hono<Env>();
  const body = async <S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new ApiError(400, 'invalid_request', z.prettifyError(parsed.error), { issues: parsed.error.issues });
    return parsed.data;
  };
  const need = (c: Context<Env>, scope: Scope) => { auth.require(c.var.principal, scope); return c.var.principal; };

  app.onError((e, c) => {
    if (e instanceof ApiError) { if (e.status === 429 && typeof e.details.retryAfterSeconds === 'number') c.header('Retry-After', String(e.details.retryAfterSeconds)); return c.json(e.toJSON(), e.status as any); }
    // The client went away while sending its request body (e.g. the render worker was stopped by a cancel). Not a server fault.
    if ((e as { code?: string }).code === 'ECONNRESET') return c.json({ error: { code: 'client_disconnected', message: 'the client closed the connection before the request was complete' } }, 400);
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
        c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        return c.body(null, 204);
      }
    }
    // Set before and after the handler: handlers that return their own Response (stored files, streams) would otherwise
    // go out without any of these — which is how media responses used to lack even nosniff.
    const secure = () => {
      const p = new URL(c.req.url).pathname;
      const h = c.res.headers;
      h.set('X-Content-Type-Options', 'nosniff');
      h.set('Referrer-Policy', 'no-referrer');
      h.set('X-Frame-Options', 'DENY');
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      h.set('Cross-Origin-Resource-Policy', 'same-site');
      // API, MCP and stored files are never documents: if one is opened as a page it may load and run nothing.
      // The app's own pages get a policy that allows only this origin's scripts, styles, fonts and media.
      h.set('Content-Security-Policy', p.startsWith('/api/') || p === '/mcp' || p.startsWith('/mcp/') ? DATA_CSP : APP_CSP);
    };
    await next();
    try { secure(); } catch { c.res = new Response(c.res.body, c.res); secure(); } // a Response with immutable headers is re-wrapped
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
  app.get('/api/v1/render/:token/snapshot', (c) => { const s = session(c.req.param('token')); return c.json({ doc: s.doc, revision: s.revision, frameCount: s.totalFrames, firstFrame: s.firstFrame, outWidth: s.outWidth, outHeight: s.outHeight }); });
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
    // A browser that already holds the owner session (reloads, other pages of the app) needs no key again.
    if (!auth.sessionOf(c.req.raw)) c.header('Set-Cookie', auth.issueSession(c.req.raw));
    return c.json({ actor: 'user:local', scopes: ['observe', 'edit'] });
  });
  app.all('/mcp', (c) => mcp(c.req.raw));
  app.use('/api/v1/*', async (c, next) => {
    c.set('principal', auth.authenticate(c.req.raw));
    await next();
  });
  // Grants limited to certain projects cannot even read others.
  app.use('/api/v1/projects/:id/*', async (c, next) => { gov.assertMayAct(c.var.principal, c.req.param('id'), 'observe'); await next(); });
  app.use('/api/v1/projects/:id', async (c, next) => { gov.assertMayAct(c.var.principal, c.req.param('id'), 'observe'); await next(); });
  // Guards must be registered before the routes they protect (Hono applies middleware in registration order).
  // Jobs are reached by id, not by project path: a project-limited grant must not see or touch other projects' jobs.
  const jobScope = async (c: Context<Env>, next: () => Promise<void>) => { gov.assertMayAct(c.var.principal, store.getJob(c.req.param('jobId')!).projectId, 'observe'); await next(); };
  app.use('/api/v1/jobs/:jobId', jobScope);
  app.use('/api/v1/jobs/:jobId/*', jobScope);
  // Starting any job is refused while agents are paused, whichever route creates it.
  app.use('/api/v1/projects/:id/exports/browser', async (c, next) => { gov.assertMayAct(c.var.principal, c.req.param('id'), 'job'); await next(); });


  // ----- discovery -----
  app.get('/api/v1/ops', (c) => { need(c, 'observe'); return c.json({ ops: describeOps() }); });
  app.get('/api/v1/openapi.json', (c) => { need(c, 'observe'); return c.json(buildOpenApi()); });
  app.get('/api/v1/whoami', (c) => c.json(c.var.principal));

  // ----- projects -----
  app.get('/api/v1/projects', (c) => { const p = need(c, 'observe'); const only = p.grant?.projectIds; return c.json({ projects: store.listProjects().filter((x) => !only || only.includes(x.id)) }); });
  app.post('/api/v1/projects', async (c) => { const who = need(c, 'edit'); if (who.grant?.projectIds) throw new ApiError(403, 'out_of_scope', 'this grant is limited to specific projects and cannot create new ones'); const p = store.createProject(await body(c, NewProject)); return c.json({ project: p.doc, revision: p.revision }, 201); });
  app.get('/api/v1/projects/:id', (c) => {
    need(c, 'observe');
    const rev = c.req.query('revision');
    const p = rev === undefined ? store.getProject(c.req.param('id')) : store.replay(c.req.param('id'), Number(rev));
    return c.json({ project: p.doc, revision: p.revision });
  });
  app.post('/api/v1/projects/:id/delete', async (c) => { const p = need(c, 'observe'); const b = await body(c, z.object({ confirmName: z.string() }).strict()); return c.json(deleteProject(store, p, c.req.param('id'), b.confirmName)); });
  // Automatic backups: status for anyone who may observe; running one now is the owner's action (it writes outside the data directory).
  app.get('/api/v1/backup', (c) => { need(c, 'observe'); return c.json(backup?.status() ?? { enabled: false, everyHours: 0, keep: 0, lastAt: null, lastOk: null, lastError: null, nextAt: null, snapshots: 0, running: false }); });
  app.post('/api/v1/backup', async (c) => {
    if (need(c, 'observe').kind !== 'user') throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session');
    if (!cfg.backupDir || !backup) throw new ApiError(409, 'backup_not_configured', 'no backup destination is configured; set PF_BACKUP_DIR and restart the server');
    await backup.runNow();
    const st = backup.status();
    return c.json(st, st.lastOk ? 200 : 500);
  });
  app.get('/api/v1/storage', (c) => { const p = need(c, 'observe'); const rep = storageReport(store, p, Date.now(), cfg.maxStorageBytes); const { hashes: _h, ...unref } = rep.unreferenced; return c.json({ ...rep, unreferenced: unref }); });
  app.post('/api/v1/storage/gc', async (c) => { const p = need(c, 'observe'); const b = await body(c, z.object({ apply: z.boolean().optional() }).strict()); return c.json(collectGarbage(store, p, b.apply === true)); });
  app.get('/api/v1/projects/:id/archive', (c) => {
    need(c, 'observe');
    const plan = planArchive(store, c.req.param('id'));
    const name = plan.doc.name.replace(/[^\p{L}\p{N} _.-]+/gu, '_').slice(0, 60) || 'project';
    return new Response(Readable.toWeb(Readable.from(writeArchive(plan))) as ReadableStream, { headers: { 'content-type': 'application/x-tar', 'content-length': String(plan.bytes), 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.pulseframe.tar` } });
  });
  app.post('/api/v1/projects/import', async (c) => {
    const who = need(c, 'edit');
    if (who.grant?.projectIds) throw new ApiError(403, 'out_of_scope', 'this grant is limited to specific projects and cannot create new ones');
    gov.assertUnrestricted(who, 'import a project');
    if (!c.req.raw.body) throw new ApiError(400, 'empty_upload', 'request has no body');
    assertStorageRoom(store, cfg.maxStorageBytes, Number(c.req.header('content-length') ?? 0) || 1, 'import this project');
    const tmp = path.join(store.tmpDir, `imp_${Date.now()}_${Math.random().toString(36).slice(2)}.tar`);
    let size = 0;
    try {
      await pipeline(Readable.fromWeb(c.req.raw.body as any), async function* (src) { for await (const chunk of src) { size += chunk.length; if (size > cfg.maxUploadBytes * 4) throw new ApiError(413, 'upload_too_large', 'archive is too large'); yield chunk; } }, fs.createWriteStream(tmp, { mode: 0o600 }));
      const r = importArchive(store, tmp);
      for (const a of Object.values(r.doc.assets)) derivatives.ensure(a);
      return c.json({ project: { id: r.doc.id, name: r.doc.name }, revision: r.revision, blobsAdded: r.blobsAdded, blobsAlreadyPresent: r.blobsAlreadyPresent }, 201);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
  app.get('/api/v1/projects/:id/summary', (c) => { need(c, 'observe'); const p = store.getProject(c.req.param('id')); return c.json({ revision: p.revision, ...summarize(p.doc) }); });
  app.get('/api/v1/projects/:id/timeline', (c) => { need(c, 'observe'); const p = store.getProject(c.req.param('id')); return c.json({ revision: p.revision, ...timeline(p.doc) }); });
  app.get('/api/v1/projects/:id/transcripts/:assetId', (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const view = transcriptView(p.doc, c.req.param('assetId'));
    if (!view) throw new ApiError(404, 'not_found', 'this asset has no transcript');
    return c.json({ revision: p.revision, ...view });
  });
  app.get('/api/v1/projects/:id/captions', (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const out = exportCaptions(p.doc, c.req.query('trackId'), c.req.query('format') ?? 'srt', c.req.query('variant'));
    return c.body(out.text, 200, { 'content-type': `${out.mime}; charset=utf-8`, 'content-disposition': `attachment; filename="captions.${out.format}"`, 'x-pulseframe-revision': String(p.revision), 'x-pulseframe-cues': String(out.cues) });
  });
  app.post('/api/v1/projects/:id/analysis/fillers', async (c) => { need(c, 'observe'); return c.json(findFillerWords(store, c.req.param('id'), await body(c, FillerBody))); });
  app.post('/api/v1/projects/:id/analysis/silences', async (c) => {
    const p = need(c, 'observe');
    const { background, ...b } = await body(c, SilenceBody.extend({ background: z.boolean().optional() }).strict());
    // background=true: a durable job (poll get job); the result is the same object, as the job's output. Use it for long recordings.
    if (background) { const j = startMeasurementJob(store, p, c.req.param('id'), 'silences', b); return c.json({ jobId: j.id, status: j.status }, 202); }
    return c.json(await findSilences(store, c.req.param('id'), b));
  });
  app.post('/api/v1/projects/:id/assets/:assetId/analyze', async (c) => {
    const p = need(c, 'edit');
    const { background, ...b } = await body(c, AnalyzeBody.extend({ background: z.boolean().optional() }).strict());
    if (background) { const j = startAnalysisJob(store, gov, p, c.req.param('id'), { assetId: c.req.param('assetId'), ...b }); return c.json({ jobId: j.id, status: j.status }, 202); }
    return c.json(await analyzeAsset(store, gov, p, c.req.param('id'), { assetId: c.req.param('assetId'), ...b }));
  });
  app.get('/api/v1/projects/:id/assets/:assetId/analysis', (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const a = p.doc.analyses?.[c.req.param('assetId')];
    if (!a) throw new ApiError(404, 'not_found', 'this asset has no analysis results');
    return c.json({ revision: p.revision, ...analysisView(a) });
  });
  const RecipeBody = z.object({ params: z.record(z.string(), z.unknown()).optional(), expectedRevision: z.number().int().optional() }).strict();
  app.post('/api/v1/projects/:id/recipes/:recipeId/plan', async (c) => { need(c, 'observe'); store.getProject(c.req.param('id')); return c.json(await planRecipeFor(store, c.req.param('id'), c.req.param('recipeId'), (await body(c, RecipeBody)).params)); });
  app.post('/api/v1/projects/:id/recipes/:recipeId/apply', async (c) => { const p = need(c, 'observe'); const b = await body(c, RecipeBody); return c.json(await applyRecipe(store, gov, p, c.req.param('id'), c.req.param('recipeId'), b.params, b.expectedRevision)); });
  app.post('/api/v1/projects/:id/recipe-runs/:runId/regenerate', async (c) => { const p = need(c, 'observe'); const b = await body(c, RecipeBody); return c.json(await regenerateRecipe(store, gov, p, c.req.param('id'), c.req.param('runId'), b.params)); });
  app.get('/api/v1/projects/:id/preflight', (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const cps = c.req.query('maxCharsPerSecond');
    return c.json(preflight(exporter, p.doc, p.revision, { variantId: c.req.query('variant'), ...(cps ? { maxCharsPerSecond: Number(cps) } : {}) }));
  });
  app.post('/api/v1/projects/:id/exports/batch', async (c) => {
    const pr = need(c, 'edit');
    const projectId = c.req.param('id');
    gov.assertMayAct(pr, projectId, 'job');
    assertStorageRoom(store, cfg.maxStorageBytes, 1, 'start exports');
    const b = await body(c, z.object({ variantIds: z.array(z.string()).min(1).max(8), options: z.record(z.string(), z.unknown()).optional() }).strict());
    const doc = store.getProject(projectId).doc;
    // All-or-nothing: every variant must exist and plan without blockers before any job is created.
    for (const id of b.variantIds) { const plan = exporter.plan(doc, store.getProject(projectId).revision, { ...b.options, variantId: id }); if (plan.blockers.length) throw new ApiError(422, 'render_blocked', `format ${id} cannot be exported: ${plan.blockers[0]!.message}`, { variantId: id, blockers: plan.blockers }); }
    gov.takeExportQuota(pr, b.variantIds.length, true);
    const jobs = b.variantIds.map((id) => exporter.start(projectId, pr.actor, { ...b.options, variantId: id }));
    gov.takeExportQuota(pr, jobs.length);
    return c.json({ jobs: jobs.map((j) => ({ jobId: j.id, variantId: j.input.manifest.options.variantId, status: j.status })) }, 202);
  });
  app.post('/api/v1/projects/:id/analysis/loudness', async (c) => {
    const p = need(c, 'observe');
    const b = await c.req.json().catch(() => ({}));
    if (b && typeof b === 'object' && (b as { background?: unknown }).background === true) { const j = startMeasurementJob(store, p, c.req.param('id'), 'loudness', {}); return c.json({ jobId: j.id, status: j.status }, 202); }
    return c.json(await programmeLoudness(store, c.req.param('id')));
  });
  app.get('/api/v1/projects/:id/history', (c) => { need(c, 'observe'); store.getProject(c.req.param('id')); return c.json({ events: store.eventsSince(c.req.param('id'), Number(c.req.query('since') ?? 0)) }); });

  // ----- edits: one command path for UI, REST and (via store.commit) MCP -----
  const commit = (dryRun: boolean) => async (c: Context<Env>) => {
    // Mode (observe / propose / edit), pause state and track/range limits are decided by governance, not by a coarse scope.
    const b = await body(c, TxBody);
    return c.json(gov.commitAs(c.var.principal, { ...b, projectId: c.req.param('id')!, dryRun }));
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
      void p;
      return c.json(gov.undoAs(c.var.principal, c.req.param('id'), mode, b.transactionId));
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
      const onDerivative = (d: any) => { const a = Object.values(store.getProject(projectId).doc.assets).find((x) => x.contentHash === d.assetHash); if (a) void stream.writeSSE({ event: 'derivative', data: JSON.stringify({ assetId: a.id, kind: d.kind, status: d.status }) }); };
      store.events.on('job', onJob);
      store.events.on('derivative', onDerivative);
      const onGov = (kind: string) => (e: any) => e.projectId === projectId && void stream.writeSSE({ event: kind, data: JSON.stringify(e) });
      const govHandlers = (['control', 'proposal', 'approval'] as const).map((k) => [k, onGov(k)] as const);
      for (const [k, fn] of govHandlers) store.events.on(k, fn);
      const onPresence = (p: any) => p.projectId === projectId && void stream.writeSSE({ event: 'presence', data: JSON.stringify(p) });
      presence.events.on('presence', onPresence);
      try {
        await stream.writeSSE({ event: 'hello', data: JSON.stringify({ revision: current }) });
        for (const e of store.eventsSince(projectId, since)) await send(e);
        for (const e of pending) await send(e);
        live = true;
        await new Promise<void>((resolve) => stream.onAbort(resolve));
      } finally {
        store.events.off('revision', onEvent);
        store.events.off('job', onJob);
        store.events.off('derivative', onDerivative);
        for (const [k, fn] of govHandlers) store.events.off(k, fn);
        presence.events.off('presence', onPresence);
      }
    });
  });

  // ----- human control: grants, pause, proposals, approvals -----
  const owner = (c: Context<Env>) => { const p = c.var.principal; if (p.kind !== 'user') throw new ApiError(403, 'owner_required', 'this action needs the project owner\'s own session'); return p; };
  app.get('/api/v1/grants', (c) => { owner(c); return c.json({ grants: gov.listGrants() }); });
  app.post('/api/v1/grants', async (c) => c.json(gov.createGrant(await c.req.json().catch(() => undefined), owner(c)), 201));
  app.post('/api/v1/grants/:grantId/revoke', (c) => c.json({ grant: gov.revokeGrant(c.req.param('grantId'), owner(c)) }));
  app.get('/api/v1/projects/:id/controls', (c) => { need(c, 'observe'); return c.json({ projectId: c.req.param('id'), agentsPaused: gov.isPaused(c.req.param('id')) }); });
  app.post('/api/v1/projects/:id/agents/pause', (c) => c.json(gov.setPaused(c.req.param('id'), true, owner(c))));
  app.post('/api/v1/projects/:id/agents/resume', (c) => c.json(gov.setPaused(c.req.param('id'), false, owner(c))));
  /** A frame worth looking at for a proposal: the middle of the first clip it changes. */
  const previewFrame = (changes: { before: any; after: any }[], rate: { num: number; den: number }) => {
    const st = changes.map((ch) => ch.after ?? ch.before).find((x) => x?.kind === 'clip');
    return st ? T.frameIndexAt(T.add(st.clip.start, { value: st.clip.duration.value, timescale: st.clip.duration.timescale * 2 }), rate) : 0;
  };
  app.get('/api/v1/projects/:id/proposals', (c) => {
    need(c, 'observe');
    const rate = store.getProject(c.req.param('id')).doc.settings.frameRate;
    return c.json({ proposals: gov.listProposals(c.req.param('id'), c.req.query('status')).map((p) => ({ ...p, previewFrame: previewFrame(p.changes, rate) })) });
  });
  app.post('/api/v1/projects/:id/proposals', async (c) => { const b = await body(c, TxBody); return c.json(gov.propose(c.var.principal, c.req.param('id'), b.ops, b.label), 201); });
  const proposalIn = (c: Context<Env>) => { const pr = gov.getProposal(c.req.param('proposalId')!); if (pr.projectId !== c.req.param('id')) throw new ApiError(404, 'proposal_not_found', 'proposal not found in this project'); return pr; };
  app.get('/api/v1/projects/:id/proposals/:proposalId', (c) => { need(c, 'observe'); return c.json({ proposal: proposalIn(c) }); });
  /** Before/after stills of a proposal, rendered by the same compositor as export. `side=before|after`. */
  app.get('/api/v1/projects/:id/proposals/:proposalId/frame', async (c) => {
    need(c, 'observe');
    const pr = proposalIn(c);
    const docs = gov.proposalDocs(pr.id);
    const side = c.req.query('side') === 'before' ? 'before' : 'after';
    const png = await exporter.renderStill(docs[side], docs.baseRevision, Number(c.req.query('index') ?? 0), c.req.query('scale') === '0.25' ? 0.25 : c.req.query('scale') === '0.5' ? 0.5 : 1);
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'X-PF-Proposal-Side': side });
  });
  for (const decision of ['accept', 'reject'] as const)
    app.post(`/api/v1/projects/:id/proposals/:proposalId/${decision}`, (c) => { proposalIn(c); return c.json(gov.decide(c.req.param('proposalId'), decision, owner(c))); });
  app.get('/api/v1/projects/:id/approvals', (c) => { need(c, 'observe'); return c.json({ approvals: gov.listApprovals(c.req.param('id')) }); });
  /** An agent (or anyone) may ASK for a model download; only the owner's decision starts it, and only for exactly the bytes that were shown. */
  app.post('/api/v1/projects/:id/capabilities/:capabilityId/models/request', async (c) => {
    const p = need(c, 'observe');
    gov.assertMayAct(p, c.req.param('id'), 'propose'); // asking for something is a proposal-level act: refused while paused or in Observe mode
    const info = (await capabilities.list()).capabilities.find((x) => x.id === c.req.param('capabilityId'));
    if (!info) throw new ApiError(404, 'capability_not_found', 'capability not found');
    if (info.missingDownloadBytes === 0) throw new ApiError(409, 'models_already_ready', 'all model files for this capability are present and verified');
    return c.json({ approval: gov.requestApproval({ projectId: c.req.param('id'), kind: 'model-download', requestedBy: p.actor, action: { capabilityId: info.id, bytes: info.missingDownloadBytes, models: info.models.map((m) => ({ path: m.path, sha256: m.sha256 })) } }) }, 201);
  });
  for (const decision of ['approve', 'reject'] as const)
    app.post(`/api/v1/projects/:id/approvals/:approvalId/${decision}`, async (c) => {
      const by = owner(c);
      const a = gov.decideApproval(c.req.param('approvalId'), decision, by);
      if (decision === 'reject' || a.kind !== 'model-download') return c.json({ approval: a });
      // Re-derive the action from the CURRENT state: if the download changed since it was shown, the approval does not cover it.
      const info = (await capabilities.list()).capabilities.find((x) => x.id === a.action.capabilityId);
      const current = { capabilityId: a.action.capabilityId, bytes: info?.missingDownloadBytes ?? 0, models: (info?.models ?? []).map((m) => ({ path: m.path, sha256: m.sha256 })) };
      gov.consumeApproval(a.id, 'model-download', current);
      const job = await capabilities.startDownload(c.req.param('id'), a.action.capabilityId, current.bytes, by.actor);
      return c.json({ approval: gov.getApproval(a.id), jobId: job.id });
    });

  // ----- presence: transient session state, never part of the document or the op log -----
  const PresenceBody = z.object({ sessionId: z.string().min(1).max(64), frame: z.number().int().nonnegative().nullable().optional(), selection: z.array(z.string()).max(200).optional(), label: z.string().max(80).optional() }).strict();
  app.put('/api/v1/projects/:id/presence', async (c) => {
    const p = need(c, 'observe');
    store.getProject(c.req.param('id'));
    const b = await body(c, PresenceBody);
    return c.json(presence.update(c.req.param('id'), { sessionId: b.sessionId, actor: p.actor, kind: p.kind, frame: b.frame ?? null, selection: b.selection ?? [], label: b.label ?? null }));
  });
  app.get('/api/v1/projects/:id/presence', (c) => { need(c, 'observe'); return c.json({ presence: presence.list(c.req.param('id')) }); });

  // ----- media -----
  app.post('/api/v1/projects/:id/assets', async (c) => {
    const p = need(c, 'edit');
    const projectId = c.req.param('id');
    store.getProject(projectId);
    gov.assertMayAct(p, projectId, 'edit');
    gov.assertUnrestricted(p, 'add media to the library');
    if (!c.req.raw.body) throw new ApiError(400, 'empty_upload', 'request has no body');
    const name = decodeURIComponent(c.req.header('x-filename') ?? 'upload');
    // Storage ceiling: refuse up front when the declared size cannot fit, and cut a stream of unknown size off at the room left.
    const room = assertStorageRoom(store, cfg.maxStorageBytes, Number(c.req.header('content-length') ?? 0) || 1, 'store this upload');
    const asset = await ingestUpload(store, c.req.raw.body, name, p.actor, Math.min(cfg.maxUploadBytes, room));
    // The ingest job attaches its result through a normal (internal) operation.
    const r = store.commit({ projectId, actor: p.actor, label: `Import ${asset.name}`, allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
    const assetId = r.results[0]!.output!.assetId as string;
    // Thumbnails, waveform peaks and a proxy are produced progressively in the background; editing does not wait for them.
    derivatives.ensure(store.getProject(projectId).doc.assets[assetId]!);
    return c.json({ assetId, revision: r.revision, deduplicated: r.results[0]!.output!.deduplicated, asset: store.getProject(projectId).doc.assets[assetId] }, 201);
  });
  app.post('/api/v1/projects/:id/sfx', async (c) => {
    const p = need(c, 'edit');
    const projectId = c.req.param('id');
    store.getProject(projectId);
    gov.assertMayAct(p, projectId, 'edit');
    return c.json(await addSfx(store, gov, p, projectId, await body(c, SfxBody)), 201);
  });
  // Listening to a built-in sound before adding it: the same bytes that adding it would store.
  app.get('/api/v1/sfx/:sfxId/audio', async (c) => {
    need(c, 'observe');
    const bytes = await sfxPreview(store.tmpDir, c.req.param('sfxId'));
    return c.body(new Uint8Array(bytes), 200, { 'content-type': 'audio/wav', 'content-length': String(bytes.length), 'cache-control': 'private, max-age=3600' });
  });
  app.get('/api/v1/projects/:id/assets/:assetId/content', (c) => {
    need(c, 'observe');
    const a = store.getProject(c.req.param('id')).doc.assets[c.req.param('assetId')];
    if (!a) throw new ApiError(404, 'asset_not_found', 'asset not found in this project');
    return sendBlob(c, store.blobPath(a.contentHash), a.mimeType);
  });

  const assetOf = (c: Context<Env>) => {
    const a = store.getProject(c.req.param('id')!).doc.assets[c.req.param('assetId')!];
    if (!a) throw new ApiError(404, 'asset_not_found', 'asset not found in this project');
    return a;
  };
  app.get('/api/v1/projects/:id/assets/:assetId/derivatives', (c) => {
    need(c, 'observe');
    const a = assetOf(c);
    const rows = derivatives.list(a.contentHash);
    return c.json({ assetId: a.id, derivatives: (rows.length ? rows : derivatives.ensure(a)).map(({ assetHash: _h, blobHash: _b, ...r }) => r) });
  });
  app.get('/api/v1/projects/:id/assets/:assetId/derivatives/:kind', (c) => {
    need(c, 'observe');
    const row = derivatives.get(assetOf(c).contentHash, c.req.param('kind') as DerivativeKind);
    if (!row || row.status !== 'ready' || !row.blobHash) throw new ApiError(404, 'derivative_not_ready', `derivative is ${row?.status ?? 'unknown'}`, { status: row?.status ?? null, error: row?.error ?? null });
    return sendBlob(c, store.blobPath(row.blobHash), row.mimeType ?? 'application/octet-stream');
  });

  // ----- senses -----
  app.get('/api/v1/projects/:id/frame', async (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    const index = c.req.query('index') !== undefined ? Number(c.req.query('index')) : T.frameIndexAt(T.fromSeconds(c.req.query('seconds') ?? '0'), p.doc.settings.frameRate);
    // ?variant= renders the frame as that linked format would export it.
    const png = await exporter.renderStill(variantDoc(p.doc, c.req.query('variant')), p.revision, index);
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'X-PF-Revision': String(p.revision), 'X-PF-Frame-Index': String(index) });
  });

  // ----- jobs / export -----
  app.post('/api/v1/projects/:id/exports', async (c) => {
    const pr = need(c, 'edit');
    gov.assertMayAct(pr, c.req.param('id'), 'job');
    const options = await c.req.json().catch(() => ({}));
    assertStorageRoom(store, cfg.maxStorageBytes, 1, 'start an export'); // the output size is not known in advance; an export is refused once the ceiling is reached
    gov.takeExportQuota(pr, 1, true);
    const job = exporter.start(c.req.param('id'), pr.actor, options);
    gov.takeExportQuota(pr);
    return c.json({ jobId: job.id, status: job.status, revision: job.input.revision, estimate: job.input.manifest.estimate, warnings: job.input.warnings }, 202);
  });
  /** Dry run: what would be exported, what it depends on, and what blocks it. Starts nothing. */
  app.post('/api/v1/projects/:id/exports/plan', async (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    return c.json(exporter.plan(p.doc, p.revision, await c.req.json().catch(() => ({}))));
  });
  app.post('/api/v1/jobs/:jobId/budget/release', (c) => { const p = need(c, 'observe'); gov.releaseUnknown(p, c.req.param('jobId')); return c.json({ jobId: c.req.param('jobId'), ledger: gov.ledgerFor(c.req.param('jobId')) }); });
  app.post('/api/v1/jobs/:jobId/retry', (c) => { const pr = need(c, 'edit'); gov.assertMayAct(pr, store.getJob(c.req.param('jobId')).projectId, 'job'); const job = exporter.retry(c.req.param('jobId'), pr.actor); return c.json({ jobId: job.id, status: job.status, retryOf: job.input.retryOf }, 202); });
  app.get('/api/v1/jobs/:jobId', (c) => { need(c, 'observe'); return c.json(jobView(store.getJob(c.req.param('jobId')))); });
  app.get('/api/v1/jobs/:jobId/output', (c) => {
    need(c, 'observe');
    const j = store.getJob(c.req.param('jobId'));
    if (j.status !== 'succeeded') throw new ApiError(409, 'job_not_finished', `job is ${j.status}`, { status: j.status });
    return sendBlob(c, path.join(store.outDir, path.basename(j.output.file)), j.output.mimeType ?? 'video/mp4', `pulseframe-${j.id}${path.extname(j.output.file)}`);
  });
  app.get('/api/v1/jobs/:jobId/captions', (c) => {
    need(c, 'observe');
    const j = store.getJob(c.req.param('jobId'));
    if (j.status !== 'succeeded') throw new ApiError(409, 'job_not_finished', `job is ${j.status}`, { status: j.status });
    if (!j.output?.captions) throw new ApiError(404, 'not_found', 'this export has no caption file');
    return sendBlob(c, path.join(store.outDir, path.basename(j.output.captions.file)), j.output.captions.format === 'vtt' ? 'text/vtt' : 'application/x-subrip', `pulseframe-${j.id}.${j.output.captions.format}`);
  });
  // ----- browser export route: the tab renders and encodes; the server holds the durable job and a tab lease -----
  const browserExport = registerBrowserExportRoutes(app, store, exporter);
  (app as any).browserExport = browserExport;

  // ----- optional provider capabilities (Amendment A1). No route accepts a raw graph for execution. -----
  app.get('/api/v1/catalog', (c) => { need(c, 'observe'); return c.json(catalog()); });
  app.get('/api/v1/capabilities', async (c) => { need(c, 'observe'); return c.json(await capabilities.list()); });
  app.post('/api/v1/capabilities/import', async (c) => { need(c, 'edit'); const b = await body(c, ImportBody); return c.json(capabilities.importDraft(b.graph, { id: b.id, title: b.title })); });
  app.post('/api/v1/projects/:id/capabilities/:capabilityId/runs', async (c) => {
    const p = need(c, 'edit');
    gov.assertMayAct(p, c.req.param('id'), 'job');
    gov.assertUnrestricted(p, 'run provider jobs (their results are added to the library and may be placed on any track)');
    const b = await body(c, RunBody);
    const job = capabilities.start({ projectId: c.req.param('id'), capabilityId: c.req.param('capabilityId'), params: b.params, idempotencyKey: b.idempotencyKey, attach: b.attach, dependsOn: b.dependsOn, actor: p.actor, principal: p });
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  // Model downloads are a deliberate human action: not exposed as an MCP tool, and bound to the exact byte count shown.
  app.post('/api/v1/projects/:id/capabilities/:capabilityId/models/download', async (c) => {
    const p = need(c, 'edit');
    if (p.kind !== 'user') throw new ApiError(403, 'human_approval_required', 'model downloads must be started from the owner\'s own session, not by an agent credential');
    const b = await body(c, z.object({ confirmBytes: z.number().int().positive() }).strict());
    const job = await capabilities.startDownload(c.req.param('id'), c.req.param('capabilityId'), b.confirmBytes, p.actor);
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  // ---- local speech recognition (optional; an honest setup state when the engine or the model is absent) ----
  app.get('/api/v1/speech', async (c) => { need(c, 'observe'); return c.json(await speech.status()); });
  // As with capability models: a deliberate human action for the exact byte count shown, never an agent's.
  app.post('/api/v1/projects/:id/speech/models/:modelId/download', async (c) => {
    const p = need(c, 'edit');
    if (p.kind !== 'user') throw new ApiError(403, 'human_approval_required', 'model downloads must be started from the owner\'s own session, not by an agent credential');
    const b = await body(c, z.object({ confirmBytes: z.number().int().positive() }).strict());
    const job = await speech.startDownload(c.req.param('id'), c.req.param('modelId'), b.confirmBytes, p.actor);
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  app.post('/api/v1/projects/:id/assets/:assetId/transcribe', async (c) => {
    const p = need(c, 'edit');
    const b = await body(c, TranscribeBody);
    const job = await speech.startTranscription(gov, p, c.req.param('id'), { ...b, assetId: c.req.param('assetId') });
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  app.post('/api/v1/projects/:id/narration', async (c) => {
    const p = need(c, 'edit');
    const job = await speech.startNarration(gov, p, c.req.param('id'), await body(c, NarrationBody));
    return c.json({ jobId: job.id, status: job.status, type: job.type }, 202);
  });
  app.post('/api/v1/projects/:id/transcribe', async (c) => {
    const p = need(c, 'edit');
    const b = await body(c, z.object({ language: TranscribeBody.shape.language }).strict());
    const r = await speech.startTranscriptionAll(gov, p, c.req.param('id'), b);
    return c.json({ jobs: r.jobs.map((j) => ({ assetId: j.assetId, jobId: j.job.id, status: j.job.status, type: j.job.type })), alreadyQueued: r.skipped }, 202);
  });
  app.post('/api/v1/projects/:id/narration/script', async (c) => {
    const p = need(c, 'edit');
    const r = await speech.startNarrationScript(gov, p, c.req.param('id'), await body(c, NarrationScriptBody));
    return c.json({ sentences: r.sentences, jobs: r.jobs.map((j) => ({ jobId: j.id, status: j.status, type: j.type })) }, 202);
  });
  app.post('/api/v1/jobs/:jobId/cancel', async (c) => {
    const p = need(c, 'edit');
    const j = store.getJob(c.req.param('jobId'));
    assertMayCancel(gov, p, j);
    if (j.type === 'export' && j.input.route === 'browser') return c.json(browserExport.requestCancel(j.id));
    if (j.type === 'analysis') return c.json(cancelAnalysisJob(store, j.id, p.actor));
    if (speech.handles(j)) return c.json(speech.cancel(j.id, p.actor));
    return c.json(j.type === 'export' ? exporter.cancel(j.id, p.actor) : await capabilities.cancel(j.id, p.actor));
  });
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

/** Serialize one caption track (default: the first) as it plays on the timeline. */
export function exportCaptions(master: ProjectDocument, trackId: string | undefined, format: string, variantId?: string) {
  if (format !== 'srt' && format !== 'vtt' && format !== 'ass') throw new ApiError(400, 'invalid_args', 'format must be srt, vtt or ass');
  if (variantId && !master.variants?.[variantId]) throw new ApiError(404, 'not_found', `format ${variantId} not found`, { variantId });
  // A linked format has its own caption style, hidden or reworded cues and reworded transcript phrases.
  const doc = variantId ? projectVariant(master, variantId) : master;
  const seq = doc.sequences[doc.mainSequenceId]!;
  const track = trackId ? seq.tracks.find((t) => t.id === trackId && t.kind === 'caption') : seq.tracks.find((t) => t.kind === 'caption');
  if (!track) throw new ApiError(404, 'not_found', trackId ? `caption track ${trackId} not found` : 'the project has no caption track');
  const cues = captionCues(doc, seq, track);
  const st = track.caption!.style;
  const text = format === 'srt' ? serializeSrt(cues) : format === 'vtt' ? serializeVtt(cues) : serializeAss(cues, { width: doc.settings.width, height: doc.settings.height, fontFamily: st.fontFamily, fontSize: Math.round(st.sizeFrac * doc.settings.height), primaryColor: st.color.slice(0, 7), outlineColor: (st.stroke ?? '#000000').slice(0, 7), alignment: st.position === 'top' ? 8 : st.position === 'center' ? 5 : 2, marginV: Math.round(st.marginFrac * doc.settings.height) });
  return { format, text, cues: cues.length, trackId: track.id, mime: format === 'vtt' ? 'text/vtt' : format === 'srt' ? 'application/x-subrip' : 'text/x-ssa' };
}

export const SilenceBody = z.object({
  assetId: z.string(),
  thresholdDb: z.number().min(-90).max(-10).optional().describe('Quieter than this counts as silence. Default -35 dB'),
  minSeconds: z.number().min(0.1).max(30).optional().describe('Shortest silence to report. Default 0.5 s'),
  keepSeconds: z.number().min(0).max(5).optional().describe('Silence left untouched on each side of a cut. Default 0.1 s'),
}).strict();
/** Silent stretches of an asset and the cuts that would remove them from the current timeline. Read-only: nothing is edited. */
export async function findSilences(store: Store, projectId: string, a: z.infer<typeof SilenceBody>) {
  const p = store.getProject(projectId);
  const asset = p.doc.assets[a.assetId];
  if (!asset) throw new ApiError(404, 'not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
  if (!asset.audio) throw new ApiError(422, 'no_audio', 'this asset has no audio');
  const opts = { thresholdDb: a.thresholdDb ?? -35, minSeconds: a.minSeconds ?? 0.5 };
  const keepSeconds = a.keepSeconds ?? 0.1;
  const source = await heavy(() => detectSilences(store.blobPath(asset.contentHash), opts, timeOriginSeconds(asset)));
  const candidates = sourceRangesToTimeline(p.doc, a.assetId, source, T.fromSeconds(keepSeconds.toFixed(6)));
  const sec = (t: T.RationalTime) => Number(T.toSeconds(t).toFixed(6));
  return {
    revision: p.revision, assetId: a.assetId, method: 'ffmpeg silencedetect on the original file', options: { ...opts, keepSeconds },
    sourceSilences: source.map((r) => ({ startSeconds: sec(r.start), endSeconds: sec(r.end) })),
    candidates: candidates.map((r) => ({ start: r.start, end: r.end, startSeconds: sec(r.start), seconds: sec(T.sub(r.end, r.start)) })),
    removableSeconds: sec(candidates.reduce((n, r) => T.add(n, T.sub(r.end, r.start)), T.ZERO)),
    ops: cutOps(candidates),
    note: 'Candidates only. To apply, send `ops` as ONE transaction with expectedRevision set to this revision (or propose it). Quiet speech can be mistaken for silence: review before applying.',
  };
}

export const FillerBody = z.object({
  assetId: z.string(),
  repeats: z.boolean().optional().describe('Also mark the first of two identical consecutive words (default true)'),
  words: z.array(z.string().min(1).max(40)).max(50).optional().describe('Extra words to treat as fillers in this search (for example a speaker\'s habitual word)'),
}).strict();
/** Filler candidates from the transcript's words, and the timeline cuts that would remove them. Read-only. */
export function findFillerWords(store: Store, projectId: string, a: z.infer<typeof FillerBody>) {
  const p = store.getProject(projectId);
  const tr = p.doc.transcripts[a.assetId];
  if (!p.doc.assets[a.assetId]) throw new ApiError(404, 'not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
  if (!tr) throw new ApiError(404, 'no_transcript', 'this asset has no transcript to search', { assetId: a.assetId }, 'Recognise or import a transcript first.');
  const { candidates: found, skippedPhrases } = findFillers(tr, { repeats: a.repeats, words: a.words });
  const sec = (t: T.RationalTime) => Number(T.toSeconds(t).toFixed(6));
  // Each word is mapped on its own, so a word that is no longer on the timeline simply yields no cut.
  const rows = found.map((c) => ({ ...c, timeline: sourceRangesToTimeline(p.doc, a.assetId, [{ start: c.start, end: c.end }]) }));
  const cuts = sourceRangesToTimeline(p.doc, a.assetId, found.map((c) => ({ start: c.start, end: c.end })));
  return {
    revision: p.revision, assetId: a.assetId, method: 'rules over the transcript\'s words (hesitation sounds, immediate repetitions, listed words); no model, no audio',
    transcript: { origin: tr.origin.kind, language: tr.language, phrasesWithoutWordTiming: skippedPhrases },
    words: rows.map((r) => ({ kind: r.kind, text: r.text, segmentId: r.segmentId, wordIds: r.wordIds, sourceStartSeconds: sec(r.start), sourceEndSeconds: sec(r.end), onTimeline: r.timeline.map((x) => ({ startSeconds: sec(x.start), seconds: sec(T.sub(x.end, x.start)) })) })),
    candidates: cuts.map((r) => ({ start: r.start, end: r.end, startSeconds: sec(r.start), seconds: sec(T.sub(r.end, r.start)) })),
    removableSeconds: sec(cuts.reduce((n, r) => T.add(n, T.sub(r.end, r.start)), T.ZERO)),
    ops: cutOps(cuts),
    note: 'Candidates only. Recognisers often leave hesitation sounds out of their text, so an empty list does not mean there are none. Cuts are snapped inward to whole frames; a word shorter than a frame yields no cut. To apply, send `ops` as ONE transaction with expectedRevision set to this revision (or propose it).',
  };
}

/** Everything creative that is registered in this build: effects, transitions, blends, masks, caption presets, clip motions, fonts. */
export const catalog = () => ({
  ...describeCatalog(),
  captionPresets: [...CAPTION_PRESETS],
  clipMotions: CLIP_MOTIONS.filter((m) => m !== 'none'),
  looks: COLOR_LOOKS.map((l) => ({ id: l.id, name: l.name, effect: 'color.grade', params: l.params, note: 'A setting of the color.grade effect; apply with apply_look. Chosen by description, not graded against reference pictures.' })),
  captionLooks: CAPTION_LOOKS.map((l) => ({ id: l.id, name: l.name, hint: l.hint, style: l.style, needsWordTiming: l.needsWordTiming, note: 'Apply with apply_caption_look. Chosen for readable contrast by rule; not judged on a video.' })),
  layouts: LAYOUTS.map((l) => ({ id: l.id, name: l.name, count: l.count, slots: l.slots, fill: l.fill, note: 'Apply with apply_layout to that many picture clips. Geometry is checked by formula, not judged on footage.' })),
  speedCurves: SPEED_CURVES.map((c) => ({ id: c.id, name: c.name, hint: c.hint, smooth: c.smooth, segments: c.segments, note: 'Apply with apply_speed_curve. The shapes are this project\'s own, written from descriptions of what such curves do; not matched against another editor.' })),
  motionPresets: MOTION_PRESETS.map((m) => ({ id: m.id, kind: m.kind, name: m.name, defaultFrames: m.defaultFrames, properties: m.properties, note: 'Apply with apply_motion_preset. Written as keyframe recipes; not judged on a video.' })),
  textPresets: TEXT_PRESETS.map((p) => ({ id: p.id, name: p.name, style: p.style, shadow: p.shadow, note: 'Apply with apply_text_preset. Written from descriptions, not judged on a video.' })),
  recipes: describeRecipes(),
  formatProfiles: FORMAT_PROFILES.map((p) => ({ ...p, note: 'Generic safe-area guide, editable per variant; not a platform specification.' })),
  soundEffects: SFX.map((s) => ({ id: s.id, version: s.version, name: s.name, seconds: s.seconds, category: s.category, source: 'synthesised by formula in this build; no third-party content' })),
  fonts: FONT_CATALOG,
  note: 'This is the complete list for this build; anything not listed here does not exist. All entries render through the same Canvas2D compositor in preview and export.',
});

/** Mix the current timeline exactly as export would and measure it (EBU R128). Read-only. */
export async function programmeLoudness(store: Store, projectId: string) {
  const p = store.getProject(projectId);
  const plan = audioPlan(p.doc);
  if (plan.totalSamples === 0 || plan.clips.length === 0) return { revision: p.revision, integratedLufs: null, truePeakDbtp: null, rangeLu: null, clips: 0, note: 'The timeline has no audible sound.' };
  if (plan.totalSamples > plan.sampleRate * 3600) throw new ApiError(422, 'too_long', 'loudness measurement is limited to one hour of programme');
  const raw = path.join(store.tmpDir, `loud_${projectId}_${p.revision}_${Date.now()}.f32`);
  return heavy(async () => {
  try {
    const { clips, peak } = await mixToRaw(plan, (assetId) => store.blobPath(p.doc.assets[assetId]!.contentHash), 0, plan.totalSamples, raw, undefined, (assetId) => timeOriginSeconds(p.doc.assets[assetId]), (assetId) => p.doc.assets[assetId]?.audio?.channels === 1);
    const m = await measureLoudness(raw, plan.sampleRate);
    const target = p.doc.settings.loudness ?? null;
    const g = target ? normalisationGain(m, target.target, target.truePeak) : null;
    return {
      revision: p.revision, clips, seconds: Number((plan.totalSamples / plan.sampleRate).toFixed(3)), ...m,
      mixPeakDbfs: peak > 0 ? Number((20 * Math.log10(peak)).toFixed(2)) : null, wouldClipWithoutNormalisation: peak > 1,
      target, exportWouldApplyGainDb: g ? Number(g.gainDb.toFixed(2)) : 0, limitedByPeak: g?.limitedByPeak ?? false,
      method: 'ffmpeg ebur128 (EBU R128 / ITU-R BS.1770) on the same mix export renders',
    };
  } finally {
    fs.rmSync(raw, { force: true });
  }
  });
}

export const SfxBody = z.object({ sfxId: z.string(), start: RationalTimeSchema.optional().describe('Place it on the timeline at this frame-aligned time (omit to only add it to the media library)'), trackId: z.string().optional() }).strict();
/** Synthesise a built-in sound effect, attach it as a normal asset, and optionally place it. Goes through governance like any edit. */
export async function addSfx(store: Store, gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof SfxBody>) {
  gov.assertMayAct(principal, projectId, 'edit'); // same rule as uploading media: needs edit rights and agents must not be paused
  gov.assertUnrestricted(principal, 'add media to the library');
  const asset = await makeSfx(store, a.sfxId, principal.actor);
  const imp = store.commit({ projectId, actor: principal.actor, label: `Add sound ${asset.name}`, allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
  const assetId = imp.results[0]!.output!.assetId as string;
  if (!a.start) return { assetId, revision: imp.revision, placed: null };
  const placed = gov.commitAs(principal, { projectId, ops: [{ op: 'add_clip', args: { assetId, start: a.start, ...(a.trackId ? { trackId: a.trackId } : {}) } }], label: `Place sound ${asset.name}` }) as { revision?: number; results?: { output?: Record<string, unknown> }[]; proposal?: unknown };
  return { assetId, revision: placed.revision ?? imp.revision, placed: placed.results?.[0]?.output ?? null, ...(placed.proposal ? { proposal: placed.proposal } : {}) };
}

const secs = (t: T.RationalTime) => Number(T.toSeconds(t).toFixed(6));
export const analysisView = (a: Analysis) => ({
  assetId: a.assetId, note: 'Times are in the source media. Correct them with edit_analysis; use split_at_scenes to cut a clip into its shots.',
  ...(a.scenes ? { scenes: { ...a.scenes.origin, count: a.scenes.cuts.length, cuts: a.scenes.cuts, cutSeconds: a.scenes.cuts.map(secs) } } : {}),
  ...(a.beats ? { beats: { ...a.beats.origin, bpm: a.beats.bpm, confidence: a.beats.confidence, count: a.beats.beats.length, beatSeconds: a.beats.beats.map(secs), ...(a.beats.downbeats?.length ? { meter: a.beats.meter ?? null, barCount: a.beats.downbeats.length, downbeatSeconds: a.beats.downbeats.map(secs) } : {}) } } : {}),
});
export const AnalyzeBody = z.object({ kind: z.enum(['scenes', 'beats']), overwrite: z.boolean().optional().describe('Required to replace a result that was corrected by hand'), threshold: z.number().min(0.05).max(0.9).optional().describe('scenes only: how different two frames must be to count as a cut (default 0.3; lower finds more)') }).strict();
/** Everything that can be refused before measuring starts: permissions, the asset, hand-made corrections, the right kind of media. */
function checkAnalysis(store: Store, gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof AnalyzeBody> & { assetId: string }) {
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'change analysis data');
  assertAnalysable(store, projectId, a);
}
function assertAnalysable(store: Store, projectId: string, a: z.infer<typeof AnalyzeBody> & { assetId: string }) {
  const p = store.getProject(projectId);
  const asset = p.doc.assets[a.assetId];
  if (!asset) throw new ApiError(404, 'not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
  const existing = a.kind === 'scenes' ? p.doc.analyses?.[a.assetId]?.scenes : p.doc.analyses?.[a.assetId]?.beats;
  if (existing?.origin.edited && !a.overwrite) throw new ApiError(409, 'would_discard_edits', 'this result was corrected by hand; analysing again would discard those corrections', { kind: a.kind }, 'Pass overwrite=true to replace it.');
  if (a.kind === 'scenes' && !asset.video) throw new ApiError(422, 'no_video', 'this asset has no moving picture to analyse');
  if (a.kind === 'beats' && !asset.audio) throw new ApiError(422, 'no_audio', 'this asset has no audio to analyse');
  return asset;
}
/** Measure, then attach the result through a normal (internal) operation. Returns null when `abandoned()` says the caller no longer wants the result. */
async function measureAndAttach(store: Store, actor: string, projectId: string, a: z.infer<typeof AnalyzeBody> & { assetId: string }, abandoned: () => boolean = () => false) {
  const asset = assertAnalysable(store, projectId, a);
  const file = store.blobPath(asset.contentHash);
  let args: Record<string, unknown>;
  if (a.kind === 'scenes') {
    const threshold = a.threshold ?? 0.3;
    args = { method: 'ffmpeg scene score (hard cuts only; dissolves are not detected)', params: { threshold }, times: await heavy(() => detectScenes(file, threshold, asset.video!.frameRate, timeOriginSeconds(asset))) };
  } else {
    const seconds = T.toSeconds(asset.duration);
    const r = await heavy(() => detectBeatsOfFile(file, timeOriginSeconds(asset), seconds));
    // Long files are analysed in 20-minute windows; beyond four hours only the first four are analysed. Both are said in the stored result.
    const partial = seconds > BEAT_TOTAL_MAX_SECONDS + 1;
    args = { method: `spectral-flux onsets + dynamic-programming beat tracking (no model); assumes a steady pulse${r.downbeats.length ? `; bar starts from the loudest beat of each bar (found in ${Math.round(r.barConfidence * 100)}% of the bars)` : '; no regular bar accent found'}${r.windows > 1 ? `; analysed in ${r.windows} consecutive ${BEAT_MAX_SECONDS / 60}-minute windows, each with its own tempo` : ''}${partial ? `; ONLY THE FIRST ${BEAT_TOTAL_MAX_SECONDS / 3600} HOURS were analysed` : ''}`, params: { sampleRate: 22050, hop: 256, ...(r.windows > 1 ? { windows: r.windows } : {}), ...(partial ? { analysedSeconds: BEAT_TOTAL_MAX_SECONDS } : {}) }, times: r.beats.filter((x) => x <= seconds).map((x) => T.fromSeconds(x.toFixed(3))), bpm: r.bpm, confidence: r.confidence, ...(r.downbeats.length ? { downbeats: r.downbeats.filter((x) => x <= seconds).map((x) => T.fromSeconds(x.toFixed(3))), meter: r.meter } : {}) };
  }
  if (abandoned()) return null;
  // Measuring can take a while: the asset may be gone, or the result corrected by hand, since it started.
  assertAnalysable(store, projectId, a);
  const r = store.commit({ projectId, actor, label: a.kind === 'scenes' ? 'Find scene cuts' : 'Find beats', allowInternal: true, ops: [{ op: 'attach_analysis', args: { assetId: a.assetId, kind: a.kind, createdAt: new Date().toISOString(), ...args } }] });
  return { revision: r.revision, summary: r.summary, ...analysisView(store.getProject(projectId).doc.analyses[a.assetId]!) };
}
/** Measure scene cuts or beats from the source file and attach the result to the project as editable data (inside the request). */
export async function analyzeAsset(store: Store, gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof AnalyzeBody> & { assetId: string }) {
  checkAnalysis(store, gov, principal, projectId, a);
  return (await measureAndAttach(store, principal.actor, projectId, a))!;
}

/**
 * The same analysis as a durable job, for media too long to measure inside one request. The job row survives a restart
 * (it is measured again from the start); the result is attached exactly as in the synchronous path.
 */
export function startAnalysisJob(store: Store, gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof AnalyzeBody> & { assetId: string }): JobRow {
  checkAnalysis(store, gov, principal, projectId, a);
  const job = store.createJob(projectId, 'analysis', principal.actor, { assetId: a.assetId, kind: a.kind, ...(a.threshold !== undefined ? { threshold: a.threshold } : {}), ...(a.overwrite ? { overwrite: true } : {}), projectRevision: store.getProject(projectId).revision });
  void runAnalysisJob(store, job.id);
  return store.getJob(job.id);
}
/** Start a silence or loudness measurement as a durable job of type `analysis`. It changes nothing in the project; its output carries the same object the in-request route returns. */
export function startMeasurementJob(store: Store, principal: Principal, projectId: string, kind: 'silences' | 'loudness', options: unknown): JobRow {
  const p = store.getProject(projectId); // 404 before any job exists
  if (kind === 'silences' && !p.doc.assets[(options as { assetId: string }).assetId]) throw new ApiError(404, 'asset_not_found', 'asset not found in this project');
  const job = store.createJob(projectId, 'analysis', principal.actor, { kind, options, projectRevision: p.revision });
  void runAnalysisJob(store, job.id);
  return store.getJob(job.id);
}
async function runAnalysisJob(store: Store, jobId: string) {
  if (store.getJob(jobId).status !== 'queued') return;
  store.updateJob(jobId, { status: 'running', stage: 'measuring' });
  const j = store.getJob(jobId);
  try {
    // Measurements that attach nothing to the project (silence candidates, programme loudness): the result is the job's output.
    if (j.input.kind === 'silences' || j.input.kind === 'loudness') {
      const result = j.input.kind === 'silences' ? await findSilences(store, j.projectId, j.input.options) : await programmeLoudness(store, j.projectId);
      if (store.getJob(jobId).status === 'cancel-requested') { store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled while measuring; the result was discarded' } }); return; }
      store.updateJob(jobId, { status: 'succeeded', stage: null, output: { kind: j.input.kind, result } });
      return;
    }
    const r = await measureAndAttach(store, j.actor, j.projectId, j.input, () => store.getJob(jobId).status === 'cancel-requested');
    if (!r) { store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled while measuring; the result was discarded' } }); return; }
    store.updateJob(jobId, { status: 'succeeded', stage: null, output: { kind: j.input.kind, assetId: j.input.assetId, revision: r.revision, scenes: r.scenes ? { count: r.scenes.count } : undefined, beats: r.beats ? { count: r.beats.count, bpm: r.beats.bpm, confidence: r.beats.confidence } : undefined } });
  } catch (e) {
    if (!(e instanceof ApiError)) console.error(e);
    store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'internal_error', message: 'analysis failed unexpectedly' } });
  }
}
/** Analysis jobs that were queued or running when the process stopped are measured again. */
export function recoverAnalysisJobs(store: Store): number {
  const jobs = store.recoverJobs('analysis');
  for (const j of jobs) void runAnalysisJob(store, j.id);
  return jobs.length;
}
export function cancelAnalysisJob(store: Store, jobId: string, actor: string) {
  const j = store.getJob(jobId);
  if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
  if (j.status === 'queued') { store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor} before it started` } }); return { jobId, status: 'canceled', outcome: 'removed-from-queue' }; }
  store.updateJob(jobId, { status: 'cancel-requested' });
  return { jobId, status: 'cancel-requested', outcome: 'result-will-be-discarded', note: 'the measurement in progress runs to its end; its result is not attached' };
}

/** Cancelling is an action: a paused agent may not do it, and an agent may only cancel jobs it started. The owner may cancel any job. */
export function assertMayCancel(gov: Governance, p: Principal, job: JobRow) {
  if (p.kind !== 'agent') return;
  gov.assertMayAct(p, job.projectId, 'job');
  if (job.actor !== p.actor) throw new ApiError(403, 'not_your_job', 'agents can only cancel jobs they started', { jobId: job.id, startedBy: job.actor });
}
