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
import type { DerivativeKind, Derivatives } from './derive.ts';
import type { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { ingestUpload } from './ingest.ts';
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

export function createApp(cfg: Config, store: Store, auth: Auth, exporter: Exporter, capabilities: Capabilities, derivatives: Derivatives, presence: Presence, mcp: (req: Request) => Promise<Response>, governance?: Governance) {
  const gov = governance ?? new Governance(store);
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
        c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
    c.header('Set-Cookie', auth.issueSession(c.req.raw));
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
  app.get('/api/v1/projects/:id/summary', (c) => { need(c, 'observe'); const p = store.getProject(c.req.param('id')); return c.json({ revision: p.revision, ...summarize(p.doc) }); });
  app.get('/api/v1/projects/:id/timeline', (c) => { need(c, 'observe'); const p = store.getProject(c.req.param('id')); return c.json({ revision: p.revision, ...timeline(p.doc) }); });
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
    if (!c.req.raw.body) throw new ApiError(400, 'empty_upload', 'request has no body');
    const name = decodeURIComponent(c.req.header('x-filename') ?? 'upload');
    const asset = await ingestUpload(store, c.req.raw.body, name, p.actor, cfg.maxUploadBytes);
    // The ingest job attaches its result through a normal (internal) operation.
    const r = store.commit({ projectId, actor: p.actor, label: `Import ${asset.name}`, allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
    const assetId = r.results[0]!.output!.assetId as string;
    // Thumbnails, waveform peaks and a proxy are produced progressively in the background; editing does not wait for them.
    derivatives.ensure(store.getProject(projectId).doc.assets[assetId]!);
    return c.json({ assetId, revision: r.revision, deduplicated: r.results[0]!.output!.deduplicated, asset: store.getProject(projectId).doc.assets[assetId] }, 201);
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
    const png = await exporter.renderStill(p.doc, p.revision, index);
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'X-PF-Revision': String(p.revision), 'X-PF-Frame-Index': String(index) });
  });

  // ----- jobs / export -----
  app.post('/api/v1/projects/:id/exports', async (c) => {
    const pr = need(c, 'edit');
    gov.assertMayAct(pr, c.req.param('id'), 'job');
    const options = await c.req.json().catch(() => ({}));
    const job = exporter.start(c.req.param('id'), pr.actor, options);
    return c.json({ jobId: job.id, status: job.status, revision: job.input.revision, estimate: job.input.manifest.estimate, warnings: job.input.warnings }, 202);
  });
  /** Dry run: what would be exported, what it depends on, and what blocks it. Starts nothing. */
  app.post('/api/v1/projects/:id/exports/plan', async (c) => {
    need(c, 'observe');
    const p = store.getProject(c.req.param('id'));
    return c.json(exporter.plan(p.doc, p.revision, await c.req.json().catch(() => ({}))));
  });
  app.post('/api/v1/jobs/:jobId/retry', (c) => { const pr = need(c, 'edit'); gov.assertMayAct(pr, store.getJob(c.req.param('jobId')).projectId, 'job'); const job = exporter.retry(c.req.param('jobId'), pr.actor); return c.json({ jobId: job.id, status: job.status, retryOf: job.input.retryOf }, 202); });
  app.get('/api/v1/jobs/:jobId', (c) => { need(c, 'observe'); return c.json(jobView(store.getJob(c.req.param('jobId')))); });
  app.get('/api/v1/jobs/:jobId/output', (c) => {
    need(c, 'observe');
    const j = store.getJob(c.req.param('jobId'));
    if (j.status !== 'succeeded') throw new ApiError(409, 'job_not_finished', `job is ${j.status}`, { status: j.status });
    return sendBlob(c, path.join(store.outDir, path.basename(j.output.file)), j.output.mimeType ?? 'video/mp4', `pulseframe-${j.id}${path.extname(j.output.file)}`);
  });
  // ----- browser export route: the tab renders and encodes; the server holds the durable job and a tab lease -----
  const browserExport = registerBrowserExportRoutes(app, store, exporter);
  (app as any).browserExport = browserExport;

  // ----- optional provider capabilities (Amendment A1). No route accepts a raw graph for execution. -----
  app.get('/api/v1/capabilities', async (c) => { need(c, 'observe'); return c.json(await capabilities.list()); });
  app.post('/api/v1/capabilities/import', async (c) => { need(c, 'edit'); const b = await body(c, ImportBody); return c.json(capabilities.importDraft(b.graph, { id: b.id, title: b.title })); });
  app.post('/api/v1/projects/:id/capabilities/:capabilityId/runs', async (c) => {
    const p = need(c, 'edit');
    gov.assertMayAct(p, c.req.param('id'), 'job');
    const b = await body(c, RunBody);
    const job = capabilities.start({ projectId: c.req.param('id'), capabilityId: c.req.param('capabilityId'), params: b.params, idempotencyKey: b.idempotencyKey, attach: b.attach, dependsOn: b.dependsOn, actor: p.actor });
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
  app.post('/api/v1/jobs/:jobId/cancel', async (c) => {
    const p = need(c, 'edit');
    const j = store.getJob(c.req.param('jobId'));
    if (j.type === 'export' && j.input.route === 'browser') return c.json(browserExport.requestCancel(j.id));
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
