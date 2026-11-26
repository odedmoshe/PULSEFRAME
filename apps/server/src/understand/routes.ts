/**
 * The understand routes (wave 8 `understand`; contract.ts UNDERSTAND_ROUTES). LEAD PRE-PASS, frozen: every route registered with its
 * checks in order — scope → the project (store.getProject reads the credential's reader document) → governance → the body / query
 * (core schemas) — then the view (W1, view.ts) or the runtime (W2, runtime.ts), which answer 501 understand_not_built until built.
 * No owner-only route (ADR-0036; decisions «understand»): reading is `observe`, starting a job and the settings are `edit`.
 */
import type { Context } from 'hono';
import { z } from 'zod';
import { NotesQuerySchema, ShotsQuerySchema, StartUnderstandBodySchema, UnderstandSettingsBodySchema } from '@pulseframe/core';
import { ApiError } from '../store.ts';
import { notBuiltUnderstandRuntime, type UnderstandApp, type UnderstandEnv, type UnderstandRouteDeps, type UnderstandView } from './contract.ts';

const parse = async <S extends z.ZodType>(c: Context<UnderstandEnv>, schema: S): Promise<z.infer<S>> => {
  let raw: unknown = {};
  try { const t = await c.req.text(); raw = t ? JSON.parse(t) : {}; } catch { throw new ApiError(400, 'invalid_request', 'the body is not JSON'); }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, 'invalid_request', z.prettifyError(r.error), { issues: r.error.issues });
  return r.data;
};
const query = <S extends z.ZodType>(c: Context<UnderstandEnv>, schema: S): z.infer<S> => {
  const r = schema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!r.success) throw new ApiError(400, 'invalid_request', z.prettifyError(r.error), { issues: r.error.issues });
  return r.data;
};
/** The interface language of a request (Accept-Language he… → he), the default caption language of a notes page. */
export const langOf = (header: string | undefined): 'he' | 'en' => (header && /^\s*en\b/i.test(header) ? 'en' : 'he');

export function registerUnderstandRoutes(app: UnderstandApp, deps: UnderstandRouteDeps & { view: UnderstandView }): void {
  const { store, gov, need, view } = deps;
  const rt = deps.runtime ?? notBuiltUnderstandRuntime;
  const P = '/api/v1/projects/:id';
  app.get(`${P}/understand`, async (c) => {
    const p = need(c, 'observe'); const id = c.req.param('id');
    const { doc } = store.getProject(id);
    return c.json(await rt.status(p, id, doc));
  });
  app.post(`${P}/understand`, async (c) => {
    const p = need(c, 'edit'); const id = c.req.param('id');
    store.getProject(id); gov.assertMayAct(p, id, 'job');
    const b = await parse(c, StartUnderstandBodySchema);
    return c.json(await rt.start(p, id, b), 202);
  });
  app.get(`${P}/assets/:assetId/shots`, (c) => {
    need(c, 'observe'); const id = c.req.param('id');
    const { doc } = store.getProject(id);
    return c.json(view.shots(doc, c.req.param('assetId'), query(c, ShotsQuerySchema)));
  });
  app.get(`${P}/assets/:assetId/notes`, (c) => {
    need(c, 'observe'); const id = c.req.param('id');
    const { doc } = store.getProject(id);
    return c.json(view.notes(doc, c.req.param('assetId'), query(c, NotesQuerySchema), langOf(c.req.header('accept-language'))));
  });
  app.get('/api/v1/understand/settings', (c) => { need(c, 'observe'); return c.json(rt.settings()); });
  app.put('/api/v1/understand/settings', async (c) => { const p = need(c, 'edit'); const b = await parse(c, UnderstandSettingsBodySchema); return c.json(rt.setSettings(p, b)); });
}
