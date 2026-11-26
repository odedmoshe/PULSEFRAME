/**
 * The picmodels routes (wave 8 picmodels; contract.ts PICMODELS_ROUTES). The pre-pass landed GET /picture-models complete (a read-only
 * report through the runtime and core pictureModelsFor) and the eyes route's checks in their order, delegating to the runtime (the
 * not-built runtime answers 501 eyes_not_built AFTER the owner check). W1 owns this file after the pre-pass and keeps the order:
 * scope observe → owner rule (before anything is read) → project → body (strict) → runtime.
 */
import { EyesProposeBodySchema, pictureModelsFor } from '@pulseframe/core';
import { isOwnerSession } from '../assistant/contract.ts';
import { ApiError } from '../store.ts';
import { picmodelsError, type PicmodelsApp, type PicmodelsRouteDeps } from './contract.ts';
import { actsAsOwner } from '../autonomy.ts';

export function registerPicmodelsRoutes(app: PicmodelsApp, deps: PicmodelsRouteDeps): void {
  const { store, runtime, need } = deps;

  app.get('/api/v1/picture-models', async (c) => {
    const p = need(c, 'observe');
    const rows = await runtime.list();
    c.header('cache-control', 'no-store');
    return c.json({ models: pictureModelsFor(actsAsOwner(p), rows), built: rows.some((r) => r.code !== 'not_built') });
  });

  app.post('/api/v1/projects/:id/eyes/propose', async (c) => {
    const p = need(c, 'observe');
    if (!actsAsOwner(p)) throw picmodelsError('ownerOnly');
    const id = c.req.param('id');
    store.getProject(id);
    let raw: unknown;
    try { raw = await c.req.json(); } catch { throw new ApiError(400, 'invalid_request', 'the body is not JSON'); }
    const parsed = EyesProposeBodySchema.safeParse(raw);
    // paths and codes only: a refused body is never echoed back
    if (!parsed.success) throw new ApiError(400, 'invalid_request', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.code}`).join('; '));
    const answer = await runtime.proposeEyes(p, id, parsed.data, c.req.raw.signal);
    c.header('cache-control', 'no-store');
    return c.json(answer);
  });
}
