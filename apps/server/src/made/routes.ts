/**
 * The made routes (wave 8 motioncode; contract.ts MADE_ROUTES). Pre-pass: GET /api/v1/made/templates is complete (the built-in
 * catalogue); every other route checks its scope and the project, then delegates to the runner, which answers 501 made_not_built
 * until W1 lands it. W2 owns this file after the pre-pass: body validation (core MadeRenderRequestSchema, MadeApplyRequestSchema),
 * the page check (checkMadePage: 422 made_bad_page only for problems, warnings returned), the agents-paused rule, the reading rule
 * (owner or submitter), and GET …/page from provenance.made + the page blob. Order of checks: scope → project → body → runner.
 */
import { MADE_LIMITS } from '@pulseframe/core';
import { madeError, notBuiltMadeRunner, type MadeApp, type MadeRouteDeps } from './contract.ts';
import { MADE_TEMPLATES } from './templates/index.ts';

export function registerMadeRoutes(app: MadeApp, deps: MadeRouteDeps): void {
  const { store, need } = deps;
  const runner = deps.runner ?? notBuiltMadeRunner;
  const P = '/api/v1/projects/:id';
  const project = (id: string) => store.getProject(id);

  app.get('/api/v1/made/templates', (c) => { need(c, 'observe'); return c.json({ templates: MADE_TEMPLATES, limits: MADE_LIMITS }); });
  app.post(`${P}/made/render`, async (c) => { need(c, 'edit'); project(c.req.param('id')); throw madeError('notBuilt'); });
  app.get(`${P}/made/jobs/:jobId`, (c) => { const p = need(c, 'observe'); project(c.req.param('id')); return c.json(runner.report(p, c.req.param('id'), c.req.param('jobId'))); });
  app.get(`${P}/made/jobs/:jobId/still/:index`, (c) => {
    const p = need(c, 'observe'); project(c.req.param('id'));
    const k = Number(c.req.param('index'));
    if (k !== 0 && k !== 1 && k !== 2) throw madeError('jobNotFound', { index: c.req.param('index') });
    const { png } = runner.still(p, c.req.param('id'), c.req.param('jobId'), k);
    return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
  });
  app.get(`${P}/made/jobs/:jobId/file`, (c) => { const p = need(c, 'observe'); project(c.req.param('id')); runner.file(p, c.req.param('id'), c.req.param('jobId')); throw madeError('notBuilt'); });
  app.post(`${P}/made/jobs/:jobId/apply`, async (c) => { const p = need(c, 'edit'); project(c.req.param('id')); return c.json(await runner.apply(p, c.req.param('id'), c.req.param('jobId'), {})); });
  app.post(`${P}/made/jobs/:jobId/dismiss`, (c) => { const p = need(c, 'edit'); project(c.req.param('id')); runner.dismiss(p, c.req.param('id'), c.req.param('jobId')); return c.json({ dismissed: true }); });
  app.get(`${P}/made/assets/:assetId/page`, (c) => { need(c, 'observe'); project(c.req.param('id')); throw madeError('notBuilt'); });
}
