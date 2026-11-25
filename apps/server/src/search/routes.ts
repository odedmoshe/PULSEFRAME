/**
 * The search routes (wave 7 search track; search/contract.ts SEARCH_ROUTES). The pre-pass landed the checks, in their order, and the
 * delegation to the runtime (index.ts passes the built runtime; only a test host without one has notBuiltRuntime(), which answers 501
 * footage_search_not_built AFTER the checks).
 * BUILDER B owns this file after the pre-pass and keeps the order: scope observe → owner rule (before anything is read; the owner's session holds every scope, so any other credential hears owner_required, never a scope name) → project → restriction.
 * The project-scope check of a grant is http.ts's middleware for every /projects/:id route.
 */
import { FootageQuerySchema, StartScanBodySchema } from '@pulseframe/core';
import type { Context } from 'hono';
import type { z } from 'zod';
import { isOwnerSession } from '../assistant/contract.ts';
import type { Principal } from '../governance.ts';
import { ApiError } from '../store.ts';
import { searchError, type SearchApp, type SearchEnv, type SearchRouteDeps } from './contract.ts';

async function bodyOf<S extends z.ZodType>(c: Context<SearchEnv>, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { throw new ApiError(400, 'invalid_request', 'the body is not JSON'); }
  const r = schema.safeParse(raw);
  // the issue paths and messages only: a refused query is never echoed back
  if (!r.success) throw new ApiError(400, 'invalid_request', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), { issues: r.error.issues.map((i) => ({ path: i.path, code: i.code })) });
  return r.data;
}

/** A grant limited to tracks or a time range cannot search footage (the answer would show files outside its range). */
export function assertSearchUnrestricted(p: Principal): void {
  const g = p.kind === 'agent' ? p.grant : undefined;
  if (g && (g.trackIds || g.range)) throw searchError('restricted');
}
/** The owner's own session, or 403 owner_required before anything is read. */
export function searchOwner(p: Principal): Principal {
  if (!isOwnerSession(p)) throw searchError('ownerOnly');
  return p;
}

export function registerSearchRoutes(app: SearchApp, deps: SearchRouteDeps): void {
  const { store, runtime, need } = deps;
  const P = '/api/v1/projects/:id';

  app.post(`${P}/search`, async (c) => {
    const p = need(c, 'observe');
    const id = c.req.param('id');
    const { doc } = store.getProject(id); // the reader document of this credential (readingAs at the middleware)
    assertSearchUnrestricted(p);
    const q = await bodyOf(c, FootageQuerySchema);
    return c.json(await runtime.answer(p, id, doc, q, c.req.raw.signal));
  });
  app.get(`${P}/search/index`, async (c) => {
    searchOwner(need(c, 'observe'));
    const id = c.req.param('id');
    return c.json(await runtime.status(id, store.getProject(id).doc));
  });
  app.post(`${P}/search/index`, async (c) => {
    const p = searchOwner(need(c, 'observe'));
    const id = c.req.param('id');
    store.getProject(id);
    const b = await bodyOf(c, StartScanBodySchema);
    return c.json(await runtime.startScan(p, id, b), 202);
  });
  app.delete(`${P}/search/index`, async (c) => {
    searchOwner(need(c, 'observe'));
    const id = c.req.param('id');
    store.getProject(id);
    return c.json(await runtime.forget(id));
  });
  app.delete('/api/v1/search/index', async (c) => {
    searchOwner(need(c, 'observe'));
    return c.json(await runtime.forget(null));
  });
}

/** MCP find_in_footage: the same answer as POST …/search, for the tool's credential (mcp.ts runs it inside readingAs, scope observe). */
export async function findInFootageFor(deps: Pick<SearchRouteDeps, 'store' | 'runtime'>, p: Principal, projectId: string, raw: unknown, signal: AbortSignal) {
  const { doc } = deps.store.getProject(projectId);
  assertSearchUnrestricted(p);
  const parsed = FootageQuerySchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; '));
  return deps.runtime.answer(p, projectId, doc, parsed.data, signal);
}
