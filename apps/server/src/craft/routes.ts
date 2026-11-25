/**
 * The craft routes (wave 7 craft; craft/contract.ts CRAFT_ROUTES). W2 BUILDS THEM. In the lead's pre-pass each route checks its
 * scope, the project, and the owner or propose rule, then answers 501 craft_not_built: nothing is read into an answer, nothing is
 * stored, and no answer is made up.
 */
import { FindQuerySchema, RenameVersionBodySchema, RestoreVersionBodySchema, SaveVersionBodySchema } from '@pulseframe/core';
import { isOwnerSession } from '../assistant/contract.ts';
import { craftError, mayWriteVersions, type CraftApp, type CraftRouteDeps } from './contract.ts';

export function registerCraftRoutes(app: CraftApp, deps: CraftRouteDeps): void {
  const { store, gov, need } = deps;
  const notBuilt = () => { throw craftError('notBuilt'); };
  const owner = (p: ReturnType<typeof need>) => { if (!isOwnerSession(p)) throw craftError('ownerOnly'); };
  // the schemas are the contract of the bodies; kept referenced so the builder starts from them
  void SaveVersionBodySchema; void RenameVersionBodySchema; void RestoreVersionBodySchema; void FindQuerySchema;
  const P = '/api/v1/projects/:id';
  const project = (id: string) => store.getProject(id);

  app.get(`${P}/versions`, (c) => { need(c, 'observe'); project(c.req.param('id')); return notBuilt(); });
  app.post(`${P}/versions`, (c) => { const p = need(c, 'observe'); project(c.req.param('id')); mayWriteVersions(gov, p, c.req.param('id')); return notBuilt(); });
  app.put(`${P}/versions/:versionId`, (c) => { owner(need(c, 'edit')); project(c.req.param('id')); return notBuilt(); });
  app.delete(`${P}/versions/:versionId`, (c) => { owner(need(c, 'edit')); project(c.req.param('id')); return notBuilt(); });
  app.get(`${P}/versions/:versionId/diff`, (c) => { need(c, 'observe'); project(c.req.param('id')); return notBuilt(); });
  app.get(`${P}/versions/:versionId/frame`, (c) => { need(c, 'observe'); project(c.req.param('id')); return notBuilt(); });
  app.post(`${P}/versions/:versionId/restore`, (c) => { const p = need(c, 'observe'); project(c.req.param('id')); mayWriteVersions(gov, p, c.req.param('id')); return notBuilt(); });
  app.post(`${P}/text/find`, (c) => { need(c, 'observe'); project(c.req.param('id')); return notBuilt(); });
}
