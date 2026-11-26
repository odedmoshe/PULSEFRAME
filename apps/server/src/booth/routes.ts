/**
 * The booth routes (wave 8 booth track; booth/contract.ts BOOTH_ROUTES). LEAD PRE-PASS lands the owner check COMPLETE on every route
 * (403 owner_required before the id, a query or the body is read) and an honest 501 booth_not_built after it. BUILDER W1 replaces each
 * 501 with the real handler (registry.ts, store.ts, checks.ts, testPicture.ts, media.ts) and owns this file after; the first line of
 * every handler stays `boothOwner(need(c, 'observe'))`.
 */
import { BOOTH_BUILT, boothError, boothOwner, type BoothApp, type BoothRouteDeps } from './contract.ts';

export function registerBoothRoutes(app: BoothApp, deps: BoothRouteDeps): void {
  const { need } = deps;
  const notBuilt = (): never => { throw boothError('notBuilt'); };
  void BOOTH_BUILT;
  app.get('/api/v1/booth', (c) => { boothOwner(need(c, 'observe')); return notBuilt(); });
  app.get('/api/v1/booth/items/:id/audio', (c) => { boothOwner(need(c, 'observe')); return notBuilt(); });
  app.get('/api/v1/booth/test-picture/:which', (c) => { boothOwner(need(c, 'observe')); return notBuilt(); });
  app.get('/api/v1/booth/items/:id/export-still', (c) => { boothOwner(need(c, 'observe')); return notBuilt(); });
  app.put('/api/v1/booth/answers/:id', (c) => { boothOwner(need(c, 'observe')); return notBuilt(); });
  app.delete('/api/v1/booth/answers/:id', (c) => { boothOwner(need(c, 'observe')); return notBuilt(); });
  app.post('/api/v1/booth/checks/:rowId', (c) => { boothOwner(need(c, 'observe')); return notBuilt(); });
}
