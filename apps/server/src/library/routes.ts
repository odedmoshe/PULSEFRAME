/**
 * The library routes (wave 7 library track). WORKER A builds them against library/contract.ts. In the lead's pre-pass every route
 * checks its scope (and the owner rule) and then answers 501 library_not_built: nothing is read from disk, nothing is stored, and
 * no answer is made up. GET …/credits delegates to credits.ts (worker B) and is registered here so http.ts stays one line.
 */
import { CreditsQuerySchema, LibraryItemsQuerySchema, LibraryRootBodySchema, LibraryUseBodySchema } from '@pulseframe/core';
import { libraryError, libraryOwner, type LibraryApp, type LibraryRouteDeps } from './contract.ts';
import { creditsFor } from './credits.ts';

export function registerLibraryRoutes(app: LibraryApp, deps: LibraryRouteDeps): void {
  const { store, gov, need } = deps;
  const notBuilt = () => { throw libraryError('notBuilt'); };
  // the schemas are the contract of the bodies and queries; kept referenced so the builder starts from them
  void LibraryRootBodySchema; void LibraryItemsQuerySchema; void LibraryUseBodySchema;

  app.get('/api/v1/library/status', (c) => { need(c, 'observe'); return notBuilt(); });
  app.put('/api/v1/library/root', (c) => { libraryOwner(need(c, 'observe')); return notBuilt(); });
  app.post('/api/v1/library/reindex', (c) => { libraryOwner(need(c, 'observe')); return notBuilt(); });
  app.delete('/api/v1/library/reindex', (c) => { libraryOwner(need(c, 'observe')); return notBuilt(); });
  app.get('/api/v1/library/items', (c) => { need(c, 'observe'); return notBuilt(); });
  app.get('/api/v1/library/items/:key', (c) => { need(c, 'observe'); return notBuilt(); });
  app.get('/api/v1/library/items/:key/licence', (c) => { need(c, 'observe'); return notBuilt(); });
  app.get('/api/v1/library/items/:key/audio', (c) => { need(c, 'observe'); return notBuilt(); });
  app.get('/api/v1/library/items/:key/thumb', (c) => { need(c, 'observe'); return notBuilt(); });
  app.post('/api/v1/projects/:id/library/use', (c) => {
    const p = need(c, 'edit');
    const projectId = c.req.param('id');
    store.getProject(projectId);
    gov.assertMayAct(p, projectId, 'edit');
    return notBuilt();
  });
  app.get('/api/v1/projects/:id/credits', (c) => {
    const p = need(c, 'observe');
    const q = CreditsQuerySchema.safeParse({ sequenceId: c.req.query('sequenceId'), lang: c.req.query('lang') });
    return c.json(creditsFor(store, p, c.req.param('id'), q.success ? q.data : {}));
  });
}
