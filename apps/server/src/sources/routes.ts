/**
 * The sources routes (wave 8 `sources`; contract.ts SOURCES_ROUTES). LEAD PRE-PASS: every route registered with its checks in
 * order — scope → provider id → the project (governance) → the body (core schemas) → the owner floor where it applies — then the
 * runtime, which answers 501 sources_not_built until W2 builds it. W2 owns this file after the pre-pass and keeps the checks.
 * The only owner-only routes store or remove a service's credential (the owner types keys into the app).
 */
import type { Context } from 'hono';
import { z } from 'zod';
import { SEARCHABLE_SOURCES, SourceCredentialsBodySchema, SourceImportBodySchema, SourceLinkBodySchema, SourceSearchQuerySchema, SourcesSettingsBodySchema } from '@pulseframe/core';
import { isOwnerSession } from '../assistant/contract.ts';
import { ApiError } from '../store.ts';
import { notBuiltSourcesRuntime, sourcesError, type SourcesApp, type SourcesEnv, type SourcesRouteDeps } from './contract.ts';

const parse = async <S extends z.ZodType>(c: Context<SourcesEnv>, schema: S): Promise<z.infer<S>> => {
  let raw: unknown = {};
  try { const t = await c.req.text(); raw = t ? JSON.parse(t) : {}; } catch { throw new ApiError(400, 'invalid_request', 'the body is not JSON'); }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, 'invalid_request', z.prettifyError(r.error), { issues: r.error.issues });
  return r.data;
};
const providerOf = (id: string) => {
  if (!(SEARCHABLE_SOURCES as readonly string[]).includes(id)) throw sourcesError('providerUnknown', { provider: id.slice(0, 40) });
  return id;
};

export function registerSourcesRoutes(app: SourcesApp, deps: SourcesRouteDeps): void {
  const { store, gov, need } = deps;
  const rt = deps.runtime ?? notBuiltSourcesRuntime;
  const P = '/api/v1/projects/:id';
  const owner = (c: Context<SourcesEnv>) => {
    const p = need(c, 'observe');
    if (!isOwnerSession(p)) throw sourcesError('ownerRequired');
    return p;
  };
  app.get('/api/v1/sources', (c) => c.json(rt.list(need(c, 'observe'))));
  // settings before :provider so the literal segment wins
  app.get('/api/v1/sources/settings', (c) => c.json(rt.settings(need(c, 'observe'))));
  app.put('/api/v1/sources/settings', async (c) => { const p = need(c, 'edit'); const b = await parse(c, SourcesSettingsBodySchema); return c.json(rt.setSettings(p, b.maxDownloadBytes)); });
  app.get('/api/v1/sources/:provider/search', async (c) => {
    const p = need(c, 'observe');
    const provider = providerOf(c.req.param('provider'));
    const q = SourceSearchQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!q.success) throw new ApiError(400, 'invalid_request', z.prettifyError(q.error), { issues: q.error.issues }, 'q is 1 to 100 characters of plain words; kind, page, orientation and lang are optional.');
    return c.json(await rt.search(p, provider, q.data));
  });
  app.get('/api/v1/source-previews/:handle', async (c) => { const p = need(c, 'observe'); return rt.preview(p, c.req.param('handle'), c.req.header('range') ?? null); });
  app.put('/api/v1/sources/:provider/credentials', async (c) => { const p = owner(c); const provider = providerOf(c.req.param('provider')); const b = await parse(c, SourceCredentialsBodySchema); return c.json(rt.setCredentials(p, provider, b)); });
  app.delete('/api/v1/sources/:provider/credentials', (c) => { const p = owner(c); const provider = providerOf(c.req.param('provider')); return c.json(rt.deleteCredentials(p, provider)); });
  app.post(`${P}/sources/import`, async (c) => {
    const p = need(c, 'edit'); const id = c.req.param('id');
    store.getProject(id); gov.assertMayAct(p, id, 'job');
    const b = await parse(c, SourceImportBodySchema);
    return c.json(await rt.importItem(p, id, b), 202);
  });
  app.post(`${P}/sources/link`, async (c) => {
    const p = need(c, 'edit'); const id = c.req.param('id');
    store.getProject(id); gov.assertMayAct(p, id, 'job');
    const b = await parse(c, SourceLinkBodySchema);
    return c.json(await rt.importLink(p, id, b), 202);
  });
}
