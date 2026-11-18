/**
 * Routes of the import queue and the phone drop on the MAIN listener (ADR-0023, amends ADR-0002; lead wiring). Mounted from
 * http.ts; the door's own routes (the upload page, hello, upload, status, bye) are served only by the second listener (drop.ts).
 *   POST /api/v1/projects/:id/imports        edit; x-filename, x-pf-via (browser | folder), x-pf-relative-path?, x-pf-last-modified?,
 *                                            x-pf-batch? → 202 { job: ImportJobView } once the original is stored
 *   GET  /api/v1/projects/:id/imports        observe → { imports: ImportJobView[], room: ImportRoom }
 *   POST /api/v1/jobs/:jobId/dismiss         edit; assertMayHandleImportJob → { jobId, dismissed: true }
 *   GET  /api/v1/drop/addresses              the owner's own session → { addresses }
 *   POST /api/v1/projects/:id/drop           the owner's own session; { address } (required: the owner confirms it) → 201 { drop }
 *   GET  /api/v1/projects/:id/drop           the owner's own session (it holds the url and the PIN while waiting) → { drop | null }
 *   POST /api/v1/projects/:id/drop/:dropId/close, DELETE /api/v1/projects/:id/drop/:dropId   the owner's own session → { drop }
 * Cancel and retry of an import job are branches of the shared POST /jobs/:jobId/cancel | retry (http.ts).
 * An agent can never issue, read or close a code: every drop route is the owner's alone, and MCP has no drop tool.
 */
import { Readable } from 'node:stream';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { Principal, Scope } from './auth.ts';
import type { Config } from './config.ts';
import type { Governance } from './governance.ts';
import { assertMayHandleImportJob, decodeUploadHeader, type DropDoor, type ImportQueue } from './importContracts.ts';
import { ApiError, type Store } from './store.ts';

type Env = { Variables: { principal: Principal } };
const AddressBody = z.object({ address: z.string().min(1).max(64) }).strict();

/** Content-Length as a byte count, or null when the sender gave none (a chunked body). */
export const declaredLength = (raw: string | undefined): number | null => (raw !== undefined && /^\d{1,15}$/.test(raw) ? Number(raw) : null);
/** x-pf-last-modified: milliseconds since the epoch (File.lastModified) → ISO UTC, recorded only; anything else is ignored. */
export const declaredLastModified = (raw: string | undefined): string | undefined => {
  if (!raw || !/^\d{1,15}$/.test(raw)) return undefined;
  const d = new Date(Number(raw));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export function registerImportRoutes(app: Hono<Env>, deps: { cfg: Config; store: Store; gov: Governance; imports: ImportQueue; door: DropDoor | null; need: (c: Context<Env>, scope: Scope) => Principal }) {
  const { cfg, store, gov, imports, door, need } = deps;
  const owner = (c: Context<Env>) => { const p = c.var.principal; if (p.kind !== 'user') throw new ApiError(403, 'owner_required', 'only the owner can issue, see or close a code for a phone, from their own session'); return p; };
  const theDoor = () => { if (!door) throw new ApiError(503, 'drop_listen_failed', 'the phone drop is not available on this server'); return door; };

  app.post('/api/v1/projects/:id/imports', async (c) => {
    const p = need(c, 'edit');
    const projectId = c.req.param('id');
    store.getProject(projectId);
    gov.assertMayAct(p, projectId, 'edit');
    gov.assertUnrestricted(p, 'add media to the library');
    if (!c.req.raw.body) throw new ApiError(400, 'empty_upload', 'request has no body');
    const via = c.req.header('x-pf-via') ?? 'browser';
    if (via !== 'browser' && via !== 'folder') throw new ApiError(400, 'invalid_request', 'x-pf-via must be browser or folder (files from a phone arrive through the phone drop only)', { via: via.slice(0, 16) });
    const name = decodeUploadHeader(c.req.header('x-filename')) ?? 'upload';
    const relativePath = decodeUploadHeader(c.req.header('x-pf-relative-path'), 'relative path') ?? undefined;
    const batchId = decodeUploadHeader(c.req.header('x-pf-batch'), 'batch id', 128) ?? undefined;
    const lastModified = declaredLastModified(c.req.header('x-pf-last-modified'));
    const job = await imports.receive({
      projectId, actor: p.actor, body: Readable.fromWeb(c.req.raw.body as any), name, via, declaredBytes: declaredLength(c.req.header('content-length')),
      maxBytes: cfg.maxUploadBytes, commitKind: 'background', signal: c.req.raw.signal,
      ...(relativePath ? { relativePath } : {}), ...(batchId ? { batchId } : {}), ...(lastModified ? { declaredLastModified: lastModified } : {}),
    });
    return c.json({ job: imports.view(job) }, 202);
  });
  app.get('/api/v1/projects/:id/imports', (c) => {
    need(c, 'observe');
    store.getProject(c.req.param('id'));
    return c.json({ imports: imports.list(c.req.param('id')), room: imports.room() });
  });
  app.post('/api/v1/jobs/:jobId/dismiss', (c) => {
    const p = need(c, 'edit');
    const job = store.getJob(c.req.param('jobId'));
    assertMayHandleImportJob(gov, p, job, 'dismiss');
    imports.dismiss(job.id, p.actor);
    return c.json({ jobId: job.id, dismissed: true });
  });

  // ----- the phone drop: the owner's own session only -----
  app.get('/api/v1/drop/addresses', (c) => { owner(c); return c.json({ addresses: theDoor().addresses() }); });
  app.post('/api/v1/projects/:id/drop', async (c) => {
    const by = owner(c);
    const parsed = AddressBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'send { "address": "<one of GET /drop/addresses>" }: the owner confirms the address the phone will use', { issues: parsed.error.issues });
    return c.json({ drop: await theDoor().open(by, c.req.param('id'), parsed.data.address) }, 201);
  });
  app.get('/api/v1/projects/:id/drop', (c) => { owner(c); store.getProject(c.req.param('id')); return c.json({ drop: door?.current(c.req.param('id')) ?? null }); });
  const close = (c: Context<Env>) => {
    owner(c);
    const d = theDoor();
    const live = d.current(c.req.param('id')!);
    if (!live || live.dropId !== c.req.param('dropId')) throw new ApiError(404, 'drop_not_found', 'no live code with this id for this project', { dropId: c.req.param('dropId') });
    return c.json({ drop: d.close(live.dropId, 'owner') });
  };
  app.post('/api/v1/projects/:id/drop/:dropId/close', close);
  app.delete('/api/v1/projects/:id/drop/:dropId', close);
}
