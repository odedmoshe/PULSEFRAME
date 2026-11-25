/**
 * The craft routes (wave 7 craft; craft/contract.ts CRAFT_ROUTES): named versions and find. Each route checks its scope, the
 * project, and the owner or propose rule first, parses its body with core's schema, then calls versions.ts or findText.ts.
 * The project-scope check of a grant is http.ts's middleware for every /projects/:id route.
 */
import { FindQuerySchema, RenameVersionBodySchema, RestoreVersionBodySchema, SaveVersionBodySchema } from '@pulseframe/core';
import type { Context } from 'hono';
import type { z } from 'zod';
import { isOwnerSession } from '../assistant/contract.ts';
import { ApiError } from '../store.ts';
import { craftError, mayWriteVersions, type CraftApp, type CraftEnv, type CraftRouteDeps } from './contract.ts';
import { findTextFor } from './findText.ts';
import { deleteVersion, diffVersions, listVersions, renameVersion, restoreVersion, saveVersion, versionStill } from './versions.ts';

async function bodyOf<S extends z.ZodType>(c: Context<CraftEnv>, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try { raw = await c.req.json(); } catch { throw new ApiError(400, 'invalid_request', 'the body is not JSON'); }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, 'invalid_request', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), { issues: r.error.issues });
  return r.data;
}

export function registerCraftRoutes(app: CraftApp, deps: CraftRouteDeps): void {
  const { store, gov, exporter, need } = deps;
  const owner = (p: ReturnType<typeof need>) => { if (!isOwnerSession(p)) throw craftError('ownerOnly'); return p; };
  const P = '/api/v1/projects/:id';
  const project = (id: string) => store.getProject(id);

  app.get(`${P}/versions`, (c) => { const p = need(c, 'observe'); project(c.req.param('id')); return c.json({ versions: listVersions(store, p, c.req.param('id')) }); });
  app.post(`${P}/versions`, async (c) => {
    const p = need(c, 'observe'); const id = c.req.param('id'); project(id); mayWriteVersions(gov, p, id);
    const b = await bodyOf(c, SaveVersionBodySchema);
    return c.json({ version: saveVersion(store, gov, p, id, b.name) }, 201);
  });
  app.put(`${P}/versions/:versionId`, async (c) => {
    const p = owner(need(c, 'edit')); const id = c.req.param('id'); project(id);
    const b = await bodyOf(c, RenameVersionBodySchema);
    return c.json({ version: renameVersion(store, p, id, c.req.param('versionId'), b.name) });
  });
  app.delete(`${P}/versions/:versionId`, (c) => { const p = owner(need(c, 'edit')); const id = c.req.param('id'); project(id); return c.json(deleteVersion(store, p, id, c.req.param('versionId'))); });
  app.get(`${P}/versions/:versionId/diff`, (c) => {
    const p = need(c, 'observe'); const id = c.req.param('id'); project(id);
    const against = c.req.query('against') ?? 'current';
    return c.json({ diff: diffVersions(store, p, id, c.req.param('versionId'), against) });
  });
  app.get(`${P}/versions/:versionId/frame`, async (c) => {
    const p = need(c, 'observe'); const id = c.req.param('id'); project(id);
    const q = c.req.query('index');
    const index = q === undefined ? 0 : Number(q);
    const { png, revision } = await versionStill(store, exporter, p, id, c.req.param('versionId'), index);
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'X-PF-Revision': String(revision), 'X-PF-Frame-Index': String(index) });
  });
  app.post(`${P}/versions/:versionId/restore`, async (c) => {
    const p = need(c, 'observe'); const id = c.req.param('id'); project(id); mayWriteVersions(gov, p, id);
    const b = await bodyOf(c, RestoreVersionBodySchema);
    return c.json(restoreVersion(store, gov, p, id, c.req.param('versionId'), b));
  });
  app.post(`${P}/text/find`, async (c) => {
    const p = need(c, 'observe'); const id = c.req.param('id'); project(id);
    return c.json(findTextFor(store, p, id, await bodyOf(c, FindQuerySchema)));
  });
}
